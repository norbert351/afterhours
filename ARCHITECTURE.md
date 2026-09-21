# AfterHours — Architecture

**The product spine in one line:** *a keeper agent deploys real capital into the
deepest frozen-reference dislocation on tokenized equities, holds through the
closed-market window, and unwinds at the open — every step signed on Solana.*

> Why this is the spine (Step-2 test): remove the Weekend Gap Vault and AfterHours
> becomes a price-gap dashboard — a monitor, which is exactly the thing the
> tokenized-stock winner field (xPrime / Stretch / xStream at the xStocks ETHCC
> hackathon) and Stocklana's main-track bar ("a real app people actually use")
> do NOT reward. The vault is the only component that moves capital; everything
> else feeds it signals.

## System diagram

```
┌─────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐
│  Frontend   │   │  API (Express :8090) │   │  KEEPER AGENT (the spine)    │
│  landing /  │──▶│  39 routes           │──▶│  vault.js state machine      │
│  /app /docs │   │  auth · v2 · v3 ·    │   │  idle→armed→holding→unwind   │
└─────────────┘   │  vault · watchlist   │   │  60s loop · no-churn · caps  │
                  └──────────┬───────────┘   └──────────┬───────────────────┘
                             │                          │
              ┌──────────────▼─────────────┐  ┌─────────▼───────────┐
              │  SIGNAL LAYER (verified)   │  │  EXECUTION LAYER    │
              │  GeckoTerminal xStock px   │  │  Jupiter /swap/v1   │
              │  TwelveData NYSE refs      │  │  api.jup.ag         │
              │  PreStocks · Tessera       │──▶│  (SOL→xStock, cap)  │
              │  Pyth feed registry (key)  │  │  Solana RPC mainnet │
              └────────────────────────────┘  └─────────────────────┘
                         │                           │
              ┌──────────▼───────────────────────────▼──────────┐
              │  STORAGE: node:sqlite — paper ledger (decisions, │
              │  alerts) · vault.db (state, fills w/ tx sigs)    │
              └──────────────────────────────────────────────────┘
```

## The core value flow (the spine made visible)

1. **Signal** — every 60s the keeper reads: NYSE open/closed (TwelveData),
   on-chain xStock prices (GeckoTerminal by mint), and the computed gap
   (on-chain vs frozen reference) per xStock.
2. **Decision (deterministic rules, not an LLM)** — market **closed** + vault
   **armed** + a real dislocation ≥50bps (reference live, min volume) → BUY the
   deepest gap at a hard cap (~$0.25/fill, 1 position). Market **open** +
   **holding** → SELL to SOL. Otherwise → hold; never churn; never buy blind
   when the reference feed is degraded.
3. **Execution** — Jupiter `/swap/v1` (the live-proven host) builds a signed
   Solana transaction; broadcast + confirm; the fill is recorded with its
   Solscan signature.
4. **Ownership** — wallet balance is reconciled every tick; any growth beyond
   the vault's own buys is recorded **honestly** as dividend/rebase accrual
   (xStocks are rebasing assets) with a self-calibrating baseline so
   pre-existing holdings are never mislabeled.
5. **Evidence** — every decision and fill lands in `vault.db` / the paper
   decision log; the UI renders positions, tx links, gap stats.

## Sponsor counterfactual table ("remove it and what happens")

| Sponsor stack | Where it sits | After removing it |
|---|---|---|
| **GeckoTerminal DEX index** (fallback, no key) | Fallback on-chain xStock price + volume — the gap signal's safety net | Vault falls back to GeckoTerminal pricing; if BOTH feeds die, no live price → refuses to trade (holds cash) |
| **TwelveData** (NYSE reference) | Frozen-reference anchor (market-hours aware) | Gap reads 0/unknown everywhere → vault's ≥50bps guard blocks every buy (no blind trades, but the edge vanishes) |
| **Jupiter `/swap/v1` + Price v3** (execution + official data) | Every real fill (SOL→xStock, xStock→SOL); **official xStocks print + rebase multiplier** feed the vault's dividend labeling | No signed swap transactions → the product becomes a monitor; without the official print/multiplier, accrual falls back to *inference* instead of official labels |
| **Solana RPC + wallet** | Identity + settlement + accrual reconciliation | No mainnet proof `7JL8s…` / txs `62HV8t3F…` `2gh4uPpC…` `8g18g7V3…` — no "verified on mainnet" claim |
| **PreStocks / Tessera** (no key) | Cross-issuer dislocations + universe depth (v2 paper engine) | Paper strategy loses its pre-IPO universe; dislocations table empties |
| **Pyth feed registry** | 5 verified AAPL feeds; live prices honest-gated on key | **No change in behavior** — the gate already reports openly (feed metadata served, prices labeled "key required") |
| **Meteora DBC SDK** | Installed, evaluated, NOT wired (documented) | **No change** — the AAPLx-family vault trades CLMM/whirlpool liquidity via Jupiter; DBC is the bounty hook |

## Key modules

| File | Role |
|---|---|
| `src/index.js` → `server.js` | Entry; Express API (39 routes) + static frontend |
| `src/services/vault.js` | **The spine** — state machine, keeper loop, accrual reconciliation (DI factory) |
| `src/services/markethours.js` | The gap: on-chain vs frozen reference per xStock |
| `src/services/solana.js` | Live rail — wallet, probe, Jupiter swap, balance snapshots |
| `src/services/v2.js` + `paper.js` | Paper strategy engine + honest ledger (cost-basis guard) |
| `src/services/loop.js` | 60s autonomous run loop for the paper engine |
| `src/adapters/*` | PreStocks, Tessera, TwelveData, Pyth, GeckoTerminal xStocks |
| `src/store.js` / `vault db` | node:sqlite (WAL) — strategies, paper ledger, decisions, alerts, vault state + fills |
| `src/auth.js` | Wallet (ed25519), Privy, handle/password + watchlist |
| `public/` | landing, product dashboard, docs (+ vault + live-rail panels) |
| `scripts/micro-swap.mjs` | Reusable "little-by-little" real-swap tester |