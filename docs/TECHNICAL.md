# AfterHours — Technical Documentation

## Stack & dependencies

| Layer | Choice |
|---|---|
| Runtime | Node 22 (`--dns-result-order=ipv4first`; the VM has broken IPv6) |
| Web | Express (static + API, no build step for the pages) |
| Storage | `node:sqlite` (WAL) — two DBs: `afterhours.db` (paper/strategies/auth) + `vault.db` (vault state + fills) |
| Solana | `@solana/web3.js`, `@solana/spl-token`, `@noble/ed25519`, `bs58` |
| Swaps | Jupiter `api.jup.ag/swap/v1` (quote + swap); Orca/Raydium/Meteora SDKs installed (documented attempts / bounty hooks, not the production rail) |
| Auth | `@privy-io/server-auth` (managed), native ed25519 challenge (self-custody) |
| Frontend | Vanilla JS + `esbuild`-bundled Privy React island |

## The gap engine (the signal)

For every xStock in the registry (AAPLx, NVDAx, TSLAx, MSFTx, GOOGLx, COINx):

```
gapPct = (onChainPriceUsd − referencePriceUsd) / referencePriceUsd × 100
```

- **onChainPriceUsd** — GeckoTerminal DEX index by mint (24/7, no key, 30s cache, retry-on-5xx).
- **referencePriceUsd** — TwelveData NYSE close (market-hours aware; `referenceStale` when closed).
- Honest fallback: if a reference is unavailable the row reports `error`, never a fabricated number. If ALL references fail the vault's ≥50bps-plus-live-reference guard blocks every trade.

## Proof: real mainnet fills (all on wallet `7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg`)

| # | What | Tx | Status |
|---|---|---|---|
| 1 | SOL→AAPLx (0.0016 SOL) | [62HV8t3F…](https://solscan.io/tx/62HV8t3FNVYfXFku5SHQN9PUEuttTciitEkNChiTdETRK6XDjs8ZGecb67qb2HavWMALvVGuAAuYgjGPUm1ZMXQ2) | FINALIZED |
| 2 | SOL→AAPLx via app API | [2gh4uPpC…](https://solscan.io/tx/2gh4uPpC91ou8FHovqKwoNkDK7wxp19S1ZJ39RQce2fyUSML4HUb4ebKnF3TVjqYtxuxCdE2s9YbUguzBQffKouN) | CONFIRMED |
| 3 | Vault round-trip: **buy** AAPLx @ gap −0.16% → **sell** at open | [8g18g7V3…](https://solscan.io/tx/8g18g7V3qVB1ydD7Z2W8oW5LKGD4NcDhHgUvApdBPZVVxzyaAhpseYzkDBJxKfU9XoM5bZyquszXRrgJamQHcDt) · [4UX9k6o7…](https://solscan.io/tx/4UX9k6o7vcVGdfcsdvvpYcxXAPp34ogRPLmdGv4yEvfzcvW4xifsoLwHQcJecqSoVomxbb1DgtvMA2fPuRw8pHnH) | FINALIZED round trip |
| 4 | SOL→AAPLx rail buy (after swap-verification fix) | [7YHRhMtz…](https://solscan.io/tx/7YHRhMtzdW5Eezrzmi4ZZpbhEdF3CKnTJTwjHXkSPm1NT3yxoi7CXBvzzok3eVyCDbc8ay4pznTqmdwMVefAaik) | FINALIZED · err=null |
| 5 | SOL→AAPLx rail buy | [2t5Lmh1Tg…](https://solscan.io/tx/2t5Lmh1TgCDeKunB7pXCWP4V16pxAdngGygTVjLqiXwS12vMsgQ4nQCkr3c6ndftPzvkLZC6bNHyFby6RP5ARAeG) | FINALIZED · err=null |
| 6 | SOL→AAPLx rail buy (the on-camera demo buy) | [3AqwHQu7k…](https://solscan.io/tx/3AqwHQu7kBUiAcSUoF9HMYaSDvQqBHG68zQtUg5BF9awE8HYR7FytdJ9Hy8BTMgor2gcFGfSyxv915grhJEjKGmV) | FINALIZED · err=null |

Ledger currently: **0.00260421 AAPLx** on-chain — the live wallet balance, atom-consistent with the sum of every delivered fill.

> `quote-api.jup.ag` was **retired from DNS** — the old "Jupiter is blocked from this VM" ghost across earlier builds. The live surface is `api.jup.ag/swap/v1` (verified reachable from this VM).

## Vault state machine

```
idle ──arm()──▶ armed ──tick (market CLOSED + real gap ≥50bps)──▶ holding
holding ──tick (market OPEN)──▶ sell→SOL ──▶ idle
holding ──stop()/unwind()──▶ idle (kill-switch; honest fill/error logged)
```

Guards (all tested): per-fill cap `AH_VAULT_CAP_USD=0.25` → clamp [~$0.08, ~$0.60] lamports; `AH_VAULT_MAX_POSITIONS=1`; `AH_VAULT_MIN_VOL_USD=5000`; no-churn (holding ticks never double-buy); ≥50bps + live-reference requirement (no blind buys); in-flight lock in the loop; idempotent accrual reconciliation with a self-calibrating baseline.

**Accrual (dividend) leg** — xStocks are *rebasing* assets (dividends arrive as balance growth). Every tick the wallet token balance is snapshotted; growth beyond `arm-baseline + own buys` is logged as an `accrual` fill with the honest note *"dividend/rebase accrual or external top-up"*. A fresh arm-time snapshot means missing mints were genuinely zero; a mid-cycle upgrade infers the baseline from non-vault holdings — pre-existing tokens can never be mislabeled as dividends.

**On-chain swap verification (the "never a fabricated fill" guarantee)** — the execution rail previously treated *any* signature-confirmed transaction as a success, even when the transaction's instructions errored on-chain (e.g. a `TransferChecked` insufficient-funds on thin DEX liquidity), which could record a "buy" that never delivered a token. Fixes shipped 2026-09-22:
1. `solana.jupiterSwap` now verifies `getSignatureStatuses` shows `err === null` before reporting `confirmed` (and returns the real error otherwise).
2. `vault.tick()` throws on an unconfirmed swap → the ledger records `BUY FAILED` honestly and the vault stays armed/retryable instead of holding a phantom position.
3. A startup **reconcile** cross-checks every real position against the wallet's live mint balances and drops + labels any phantom with a `reconcile` ledger event (the one pre-fix phantom on record is annotated `BUY FAILED ON-CHAIN` in `vault_fills`).
Both behaviors are covered by tests.

A known honest limitation: Solana DEX liquidity for some xStocks is thin, so a swap can occasionally error on-chain; the app now surfaces that truthfully and retries, and never disguises a failed fill as a purchase.

## Auth

- Self-custody: `POST /api/auth/wallet/challenge` → sign message → `POST /api/auth/wallet/verify` (ed25519 via `@noble/ed25519` with the required `hashes.sha512` binding) → HttpOnly session cookie.
- Privy: `POST /api/auth/privy` verifies the ID token server-side (App Secret only in `.env`); `GET /api/auth/providers` honestly reports what's configured.
- Handle/password accounts + per-user watchlist.

## API surface (key endpoints)

- `GET /api/markethours/gap` — the gap table (on-chain vs frozen ref, 24h vol).
- `GET|POST /api/v2/*` — paper strategy engine: strategies, run, book, decisions, alerts, status.
- `GET /api/v3/live/info` · `POST /api/v3/live/probe` · `POST /api/v3/live/swap` — real Solana rail. Swap is **mint-allowlisted (SOL→curated xStocks), value-capped [200k, 4M] lamports, rate-limited 3/min**.
- `GET|POST /api/vault*` — vault state, arm/stop/unwind/tick. Real execution requires `AH_VAULT_EXEC=1`; otherwise explicit paper mode.
- `POST /api/auth/*`, `GET /api/watchlist`, `GET /api/universe|dashboard|dislocations|references|pyth`.

## Data model (vault.db)

```
vault_state(id=1, status, armed_at, last_tick_at, last_error, positions_json,
            baseline_json, baseline_fresh, runs)
vault_fills(id, ts, side [buy|sell|accrual], symbol, mint, in_lamports,
            out_atoms, usd_est, signature, explorer, mode [real|paper], note)
```

## Tests

`npm test` → **25/25** (jupiter price ship; paper-ledger invariants; PreStocks desk; vault state machine: arm→buy→hold no-churn→open unwind→stop→cap clamp→failed-buy honesty→min-vol filter→**no-blind-buy**→accrual detection with official-rebase matching→self-calibrating baseline→**phantom reconcile**).

## Chain facts

- Network: Solana **mainnet** (RPC `api.mainnet-beta.solana.com`).
- Wallet: `7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg` (project wallet, key in `.env` only).
- Deposits sealed in README + docs; never in git.