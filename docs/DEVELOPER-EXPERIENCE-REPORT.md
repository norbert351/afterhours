# AfterHours — Developer Experience Report (BNB Hack: Tokenized Stocks)

> **Status: TECHNICAL SECTIONS COMPLETE · OWNER-EXPERIENCE SECTIONS PENDING.**
> The brief is explicit: the report is **25% of the score** and *"perfunctory or
> AI-generated reports won't be accepted"*; it must contain the **developer's own**
> firsthand measurements and feedback.
>
> This report is split so nothing is fabricated:
> - **PART A — Technical facts** (below) are filled from **verified repository
>   evidence** and reproducible commands. Anyone can re-run them.
> - **PART B — Firsthand developer experience** contains **owner questions**
>   (`← OWNER`) that only the person who did the work can answer. **These are
>   intentionally unfilled.** Do not submit until the owner has answered them.
>
> No secret values appear in this report. Reproduction commands use env **names only**.

---

# PART A — Verified technical facts (filled from repo evidence)

## A1. Architecture & chain-specific design
One Node process serves **both chains**. Shared: gap/decision engine (`fairvalue.js`,
`dislocation.js`), market-hours (`markethours.js`), persistent ledgers (`paper-log.js`,
`node:sqlite` WAL), UI shell (`ah-ui.css`, `ah-shell.js`). Chain-specific: Solana
(`solana.js`, `vault.js`, adapters `xstocks/jupiter-price/prestocks/tessera/pyth`) vs BNB
(`bnb.js`, `bnb-exec.js`, `bnb-agent.js`, `bnb-x402.js`, adapter `bsc.js`). **No shared
execution path** — the BNB executor never calls Solana and vice-versa.

## A2. Installation & setup (both chains)
```bash
git clone https://github.com/norbert351/afterhours && cd afterhours
npm install                        # Node 22+
cp .env.example .env               # fill in only the chain(s) you need
PORT=8090 node --dns-result-order=ipv4first src/index.js
# BNB:     http://localhost:8090/bnb     Solana: http://localhost:8090/app
```
`npm run verify` proves each adapter returns real data or an explicit labeled gate.

## A3. Required environment variables (names only — never values)
Shared: `PORT`, `AH_DB_PATH`, `AH_SEED_USD`, `TWELVEDATA_API_KEY`, `AH_REFERENCE_SYMBOLS`.
BNB: `AH_BNB_WEB3_KEY`, `AH_BNB_WEB3_SECRET`, `AH_BNB_EXEC_PRIVATE_KEY`, optional
`AH_BNB_EXEC_MAX_USD`. Solana: `SOLANA_RPC_URL`, `SOLANA_PRIVATE_KEY`, optional
`PYTH_API_KEY`, `AH_VAULT_EXEC`, `AH_VAULT_CAP_USD`. Agent: `AH_QWEN_KEY/BASE/MODEL`.
Full list in `.env.example`. **Never committed** (`.env` is gitignored).

## A4. BNB sponsor API modules & their actual usage
See the module table in `docs/SUBMISSION.md`. In code: `bnbWeb3Call()` (HMAC-SHA256,
`X-OC-APIKEY/TIMESTAMP/SIGN`) → RWA Data (`dex/market/rwa/tokens`), Market
(`dex/market/rwa/price`), Trading (`dex/aggregator/quote` + `/swap`), **Transaction**
(`dex/pre-transaction/simulate`). Wallet/DeFi/b402 = not implemented.

## A5. Solana integration & its actual usage
Jupiter `/swap/v1` (`api.jup.ag`) for real capped swaps via `solana.js`; xStocks universe via
`xstocks.js`; reference/no-key dislocation sources PreStocks/Tessera; Pyth feed registry
(keyed live). All Solana routes remain live (`/api/v2/*`, `/api/v3/live/*`, `/api/vault/*`,
`/api/prestocks/*`). Kept intact; not part of the BNB path.

## A6. MCP architecture & implemented tools
Local **stdio** JSON-RPC server (`npm run bnb-mcp`), zero deps. Tools: `bnb_gap`, `bnb_quote`,
`bnb_status`, **`bnb_wallet`** (address + live balances, read-only, never the key). Verified:
`tools/list` returns 4; `bnb_wallet` returns the real address + balances.

## A7. Transaction simulation flow & execution safety
`bnbExecuteSwap` order: **safety gates** (spot-only, chain 56, amount cap, slippage cap,
idempotency) → build swap calldata → **Transaction API dry-run** → **only if `SUCCESS`** →
broadcast (approve + swap). Failure/timeout/malformed/missing verdict ⇒ **fail closed**. The
gate lives **inside the single execution function**, so no route, MCP tool, or agent action
can bypass it (asserted by tests). Proof: `/api/bnb/exec/dry-run` (public, never broadcasts).

## A8. Agent & ERC-8004 integration
`bnb-agent.js`: NL strategy → parsed rule → live gap match → bounded `bnbExecuteSwap` →
durable `agent_action` log (`data/bnb-agent-actions.json`, atomic writes). **ERC-8004 identity:
MINTED and verified** — agentId `369879`, registry `0x8004A169…` (BSC mainnet), tx
`0x99521f8d…`, `ownerOf`/`tokenURI` verified read-only; served at `/api/bnb/agent/info`.

## A9. x402 status & limitations
`bnb-x402.js` (`@altananetwork/x402-server`) → `/api/bnb/agent/gap` returns a **real x402 v2
challenge** ($U · EIP-3009 · eip155:56 → exec wallet) — verified. **Limitation:** settlement
*proceeds* have not been observed end-to-end in this environment; only the challenge is proven.

## A10. Testing strategy & actual commands
`npm test` (== `node --test`, no external calls). Current: **90 tests, 90 pass**. Covers:
simulation gate Cases A–E, execution-boundary invariants, spot-only/chain-56, idempotency,
persistence/atomicity, wallet-key non-exposure, ERC-8004 record shape, plus the original BNB
gap-engine and agent-parser suites. Solana suites run in the same command.

## A11. Deployment & persistence architecture
`afterhours.service` (systemd `--user`) → `/usr/bin/node … src/index.js`, `EnvironmentFile=/etc/afterhours/afterhours.env`
(root:ubuntu `0640`, outside web root/VCS), `PORT=8090`, `Restart=always`/`RestartSec=5`,
`MemoryMax=1200M`. Caddy reverse-proxies `afterhourequity.xyz → 127.0.0.1:8090`. Persistence:
`data/afterhours.db` (sqlite WAL) + `data/bnb-exec.json` + `data/bnb-agent-actions.json`.
**All local to the VM** — not replicated/backed up.

## A12. Reproduction steps
`npm install` → `npm test` (90/90) → `PORT=8090 node … src/index.js` → open `/bnb` (guest) →
`POST /api/bnb/exec/dry-run {"symbol":"IBMB","amountUsd":0.2}` → `/proof` → `/api/bnb/agent/info`.

## A13. Known integration gaps
RFQ not wired · Wallet/DeFi/b402 not implemented · Agentic Wallet NOT VERIFIED (private-key
wallet) · Agent Studio PARTIAL (no deployed agent) · xStocks-on-BSC unverified · x402
settlement unobserved.

## A14. Troubleshooting
- **`40101` "API Key is required"** → `.env` not loaded; run with `--env-file=.env`.
- **401 / null responses on Web3 API** → the signed path is missing the `/build` prefix.
- **`40434` KYT** → the `from` address is flagged; use a clean funded wallet.
- **`EADDRINUSE :8090`** → another instance owns the port; `ss -tlnp | grep 8090` then stop it.
- **BSC RPC timeouts** → transient; the app returns labeled errors, never fake data.
- **Blank `/bnb` tables** → Web3 key unset; the page shows "key not configured", not zeros.

## A15. Environment & setup (host)
- **Runtime:** Node.js **v22.23.1** (`node:sqlite`, ESM). No build step.
- **OS:** Linux 6.8 (Ubuntu), behind **Caddy** (auto-TLS), supervised by systemd `--user`.

## A16. First successful API call — the exact steps
HMAC-SHA256 over `timestamp + UPPERCASE_METHOD + requestPath + body`, sent as
`X-OC-APIKEY` / `X-OC-TIMESTAMP` / `X-OC-SIGN` (Base64). The path **includes a `/build`
prefix** (`/build` + wirePath → `https://web3.binance.com/build/...`). Verified working:
`GET /api/v1/dex/market/rwa/tokens`, `…/aggregator/quote`, `…/aggregator/swap`,
`POST …/dex/pre-transaction/simulate`.

## A17. Errors observed (exact API `code`/`msg`, secrets removed)
| code | endpoint | meaning | action taken |
|---|---|---|---|
| `40101` | any | *"API Key is required"* | load `.env` |
| `40442` | `aggregator/quote` | from/to addresses must differ | validate inputs |
| `40434` | `aggregator/swap` | *"KYT verification failed … high-risk address"* | correct safety refuse |
| `40465` | `aggregator/swap` | swap-build rejected for wallet/params | surface exact reason |
| *(none)* | `pre-transaction/simulate` | `data.status="FAILED"`, `failReason="execution reverted: BEP20: transfer amount exceeds allowance"` | **the dry-run gate blocking a broadcast** |

## A18. Transaction API simulation — the core DX insight
`POST /api/v1/dex/pre-transaction/simulate`, body
`{ binanceChainId:"56", evmTx:{from,to,data,value} }`, response
`{ code:0, data:{ status:"SUCCESS"|"FAILED", failReason, balanceChanges, allowanceChanges } }`.
It is a **real preflight**, not a quote — verified live returning `FAILED` + the exact revert
reason on an unapproved allowance. **A quote is NOT a simulation.**

## A19. bStocks vs Ondo behaviour observed in real data
RWA Data API returns bStocks + Ondo on BSC; the engine **dedups by contract** and **flags**
any on-chain↔reference deviation **>10%** as an implausible wrapper/denomination artifact.
Closed-market gaps are typically **< 3%**; `+0.00%` is common for tightly-pegged names and is
not inflated. Route availability is **token- and size-specific** (a liquid bStock routed; an
illiquid ticker returned `40374` at the tested size).

---

# PART B — Firsthand developer experience (OWNER INPUT REQUIRED)

> Answer each directly. These are the sections the judges read most closely. **Do not
> let an AI write them for you** — the brief penalises generic reports.

### B1. Context
- Developer / handle: ← OWNER
- Date range of the integration work: ← OWNER
- Total hours spent end-to-end: ← OWNER
- AI tooling used, and your honest take: ← OWNER

### B2. Time-to-first-call (measure it)
- Wall-clock minutes from opening the docs to your first `code:0` response: ← OWNER
- The single biggest time sink in that path: ← OWNER

### B3. Latency & rate limits (measure them)
- Method used + ≥10 samples for `rwa/tokens`, `aggregator/quote`, `pre-transaction/simulate`: ← OWNER
- Did you hit a rate limit? What code, what RPS: ← OWNER

### B4. Authentication friction
- What specifically tripped you up about the HMAC `/build` prefix or timestamp precision: ← OWNER
- Did you ever hit *"Duplicate request detected"*? When: ← OWNER

### B5. Real market observations you personally noticed
- bStocks-vs-Ondo differences you saw in live data: ← OWNER
- How common were `+0.00%` gaps, and what you concluded: ← OWNER
- A case where reference ≈ token price but the numbers still surprised you: ← OWNER

### B6. Execution / simulation
- Did the Transaction API dry-run ever save you from a bad broadcast? Describe: ← OWNER
- What token/sizes actually routed, and what didn't: ← OWNER

### B7. Documentation friction & asks
- Doc inconsistencies you hit, and the fix you'd suggest: ← OWNER
- API capabilities you wish existed (batch prices, eligibility flags, testnet faucet…): ← OWNER

### B8. Honest craft note
- What worked, what was hard, what you'd do differently: ← OWNER

---
### Reviewer checklist (submission gate)
- [x] Technical sections (A1–A9) filled from verifiable evidence
- [ ] **B1–B8 answered by the owner** (must be done before submission)
- [x] Latency/rate-limit *methods* documented (A7) — *results pending owner measurement*
- [ ] Owner has re-read for accuracy — no fabricated first-person claims
- [x] No secret values present
