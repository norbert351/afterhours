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

## A1. Environment & setup
- **Runtime:** Node.js **v22.23.1** (`node:sqlite`, ESM). No build step (vanilla JS frontend, Express server).
- **OS:** Linux 6.8 (Ubuntu), served behind **Caddy** (auto-TLS) on the project VM.
- **Backup env file for production:** `/etc/afterhours/afterhours.env` — root:ubuntu, mode `0640`, **outside** the web root and **outside** version control.
- **Run:** `cd backend-root && PORT=8090 /usr/bin/node --dns-result-order=ipv4first src/index.js` (production runs exactly this under `afterhours.service`).

## A2. Required environment variables (names only — never values)
`AH_BNB_WEB3_KEY`, `AH_BNB_WEB3_SECRET` (Binance Web3 API, HMAC auth) · `AH_BNB_EXEC_PRIVATE_KEY`
(BSC execution/agent wallet) · `AH_DB_PATH` (optional; defaults to `data/afterhours.db`) ·
`TWELVEDATA_API_KEY`, `PYTH_API_KEY` (reference/price fallbacks) · `AH_QWEN_KEY`,
`AH_QWEN_BASE`, `AH_QWEN_MODEL` (agent model) · plus Solana/Privy vars used by the
non-BNB surfaces. The BNB track needs the four `AH_BNB_*` vars.

## A3. First successful API call — the exact steps that work
The Binance Web3 API auth is **HMAC-SHA256**, signing a pre-hash of
`timestamp + UPPERCASE_METHOD + requestPath + body`, sent as
`X-OC-APIKEY` / `X-OC-TIMESTAMP` / `X-OC-SIGN` (Base64).
- **Confirmed request-path prefix:** the implementation signs the path **including a
  `/build` prefix** (`requestPath = "/build" + wirePath`) and calls
  `https://web3.binance.com/build/...`. Omitting `/build` is the most common auth failure.
- Verified working calls (see `src/adapters/bsc.js`): `GET /api/v1/dex/market/rwa/tokens`,
  `GET /api/v1/dex/aggregator/quote`, `GET /api/v1/dex/aggregator/swap`,
  `POST /api/v1/dex/pre-transaction/simulate`.

## A4. Errors observed (exact API `code`/`msg`, secrets removed)
Reproduced during integration (probe scripts, sanitised):
| code | endpoint | meaning | action taken |
|---|---|---|---|
| `40101` | any | *"API Key is required"* — key not loaded | load `.env`; keep key out of the process env dump |
| `40442` | `dex/aggregator/quote` | from/to token addresses must differ | validate inputs before quoting |
| `40434` | `dex/aggregator/swap` | *"KYT verification failed … high-risk address"* | correct safety signal; a flagged `from` is refused at build |
| `40465` | `dex/aggregator/swap` | swap-build rejected for the given wallet/params | surface the exact reason, never generalize |
| *(none)* | `pre-transaction/simulate` | returns `data.status = "FAILED"`, `data.failReason="execution reverted: BEP20: transfer amount exceeds allowance"` | **this is the dry-run gate** — it correctly blocks a broadcast before approve |

## A5. Transaction API simulation — the core DX insight
- **Endpoint:** `POST /api/v1/dex/pre-transaction/simulate`
- **Body:** `{ binanceChainId: "56", evmTx: { from, to, data, value } }`
- **Response:** `{ code: 0, data: { status: "SUCCESS"|"FAILED", failReason, balanceChanges, allowanceChanges } }`
- **Behaviour verified live:** with an unapproved USDT allowance the simulate call returned
  `status: "FAILED"` and the exact revert reason — i.e. it is a **real preflight**, not a
  quote. The app **fails closed**: `bnbExecuteSwap` refuses to broadcast unless
  `status === "SUCCESS"`. Public proof surface: `POST /api/bnb/exec/dry-run`.
- **Gotcha:** a quote is NOT a simulation; only the simulate endpoint returns a verdict.

## A6. bStocks vs Ondo behaviour observed in real data
- The RWA Data API returns **46 bStocks + Ondo** tokens on BSC; the engine **dedups by
  contract address** and **flags** any on-chain↔reference deviation **>10%** as an
  implausible wrapper/denomination artifact (e.g. an Ondo token priced ~×10 vs reference)
  rather than reporting it as a tradeable gap.
- Real gaps in a closed market are typically **small (< 3%)**; `+0.00%` is common for
  liquid, tightly-pegged names — the engine does not inflate those.
- Route availability is **token- and size-specific**: a liquid bStock routed on the SWAP
  leg while an illiquid ticker returned `40374` at the tested size — reported per-asset.

## A7. Testing, deployment, reproducibility
- **Tests:** `npm test` → **88 tests, 88 pass** (was 67). Includes the Transaction-API
  simulation gate (Cases A–E), execution-boundary invariants, spot-only/chain-56 checks,
  idempotency, persistence/atomicity, and wallet-key non-exposure.
- **Deployment:** `afterhours.service` (systemd `--user`, `Restart=always`, `RestartSec=5`,
  `MemoryMax=1200M`), `EnvironmentFile=/etc/afterhours/afterhours.env`, `PORT=8090`,
  Caddy `afterhourequity.xyz → 127.0.0.1:8090`. Restart + SIGKILL crash-recovery both verified.
- **Persistence:** `data/afterhours.db` (sqlite), `data/bnb-exec.json` (fill proof),
  `data/bnb-agent-actions.json` (agent audit log, atomic writes). Transaction proof
  survives a process restart (verified).

## A8. MCP architecture & actual tools
Local **stdio** MCP server (`npm run bnb-mcp`). Tools: `bnb_gap`, `bnb_quote`,
`bnb_status`, **`bnb_wallet`** (real BSC wallet address + live balances, read-only, never
the key). It is **prepared for** Agent Studio / Agentic Wallet but is **not** a deployed
Studio agent and **not** an official Agentic Wallet integration.

## A9. Known limitations & integration gaps (honest)
- **RFQ not wired** (mentioned only where relevant; illiquid tickers are shown as
  unavailable for that size, not traded).
- **Wallet API / DeFi API / b402** — not implemented.
- **Agentic Wallet** — NOT VERIFIED (private-key wallet).
- **Agent Studio agent / ERC-8004 identity** — PARTIAL: x402 self-funding endpoint is real;
  the **ERC-8004 identity is MINTED and verified** (agentId `369879`, tx `0x99521f8d…`, registry
  `0x8004A169…`, owner = exec wallet). The earlier "registrar-gated" note was **corrected** —
  `register(string)` is permissionless. Still missing for the special: a *deployed* Studio agent.
- **xStocks-on-BSC** — unverified, deliberately not claimed.

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
