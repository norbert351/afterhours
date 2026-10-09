# AfterHours — Stocklana Submission (paste-ready)

> Live rubric pulled 2026-09-21: deadline **Sep 25, 4:00pm ET**, $126K total
> ($100K main track), judging through Oct 2, one submission per team, original
> work, open-source OK with attribution. No US-exclusion stated on the main track.

## Theme pick

**Main Track** — *Investing / Credit & yield wedge: "an autonomous capital-utilization agent for tokenized equities."* The spine (a vault that puts capital to work across the frozen-reference gap) serves the exact "could this be a real app people use?" question with real money on mainnet.

## Description (paste text, ~3 paragraphs)

AfterHours is an autonomous weekend-gap capture agent for tokenized equities on Solana. The reference price of every xStock (AAPLx, NVDAx, MSFTx…) freezes when the NYSE closes, but the on-chain market trades 24/7 — so from Friday's bell to Monday's open the on-chain price drifts away from the frozen reference. AfterHours continuously measures that dislocation (live on-chain price vs frozen reference, per token), then the **Weekend Gap Vault** puts real capital to work: armed once, a keeper agent buys the deepest verified gap (hard-capped ≈$0.25/fill, mint-allowlisted, ≥50bps real dislocation required) while the market is closed, and unwinds to SOL at the open. Every fill is a real, signed Solana transaction with its Solscan link on the dashboard; the wallet is reconciled every tick so dividend/rebase accrual is detected honestly rather than claimed. It belongs on Solana because the edge IS the difference between a 24/7 on-chain market and a frozen one: no other venue has tokenized equities trading against a frozen reference.

The app is live: connect, watch the gaps, arm the vault — real execution, transparent ledger, no fabricated numbers anywhere.

**Life after the hackathon (written into `docs/ROADMAP.md`):** the vault stays a
self-funded proof on the builder's own capital; the PreStocks Desk is the first
revenue surface (subscription analytics — no custody); user deposits are gated
on a licensed operator + verified net-of-fee edge, never crossed by vibes.

## Links

- **Live demo:** https://afterhourequity.xyz (landing) · https://afterhourequity.xyz/app (product) · https://afterhourequity.xyz/docs (docs)
- **GitHub:** https://github.com/norbert351/afterhours
- **Video:** https://afterhourequity.xyz/demo/afterhours-demo-v2.mp4 (verified real-buy take: on-camera mainnet SOL→AAPLx buy `3AqwHQu…`, finalized `err=null`, wallet balance moved; 65s, 720p, +faststart)
- **Mainnet proof:** wallet `7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg` · fills [62HV8t3F…](https://solscan.io/tx/62HV8t3FNVYfXFku5SHQN9PUEuttTciitEkNChiTdETRK6XDjs8ZGecb67qb2HavWMALvVGuAAuYgjGPUm1ZMXQ2) [2gh4uPpC…](https://solscan.io/tx/2gh4uPpC91ou8FHovqKwoNkDK7wxp19S1ZJ39RQce2fyUSML4HUb4ebKnF3TVjqYtxuxCdE2s9YbUguzBQffKouN) [8g18g7V3…](https://solscan.io/tx/8g18g7V3qVB1ydD7Z2W8oW5LKGD4NcDhHgUvApdBPZVVxzyaAhpseYzkDBJxKfU9XoM5bZyquszXRrgJamQHcDt)

## Replication guide (judge cold-start, 5 min)

```bash
git clone https://github.com/norbert351/afterhours.git && cd afterhours
npm install
cp .env.example .env          # optional keys; app works keyless on verified no-key sources
npm test                      # 25/25
npm start                     # → http://localhost:8080
# API smoke (local or the live origin):
curl -s localhost:8080/api/markethours/gap        # the gap table
curl -s localhost:8080/api/vault                  # vault state (idle until armed)
curl -s localhost:8080/api/v3/live/info           # live rail (configured:false w/o key)
```

Real execution needs a funded wallet (`SOLANA_PRIVATE_KEY`, `AH_VAULT_EXEC=1`,
`AH_VAULT_CAP_USD=0.25`) — see `docs/TECHNICAL.md`.

## Verified / unverified matrix (the honest map)

| Claim | Status | Evidence |
|---|---|---|
| Live site on custom domain | ✅ | https://afterhourequity.xyz (200 on `/`, `/app`, `/docs`) |
| Real mainnet fills | ✅ | 6 verified fills (above links + [7YHRhMtz…](https://solscan.io/tx/7YHRhMtzdW5Eezrzmi4ZZpbhEdF3CKnTJTwjHXkSPm1NT3yxoi7CXBvzzok3eVyCDbc8ay4pznTqmdwMVefAaik) [2t5Lmh1Tg…](https://solscan.io/tx/2t5Lmh1TgCDeKunB7pXCWP4V16pxAdngGygTVjLqiXwS12vMsgQ4nQCkr3c6ndftPzvkLZC6bNHyFby6RP5ARAeG) [3AqwHQu7k…](https://solscan.io/tx/3AqwHQu7kBUiAcSUoF9HMYaSDvQqBHG68zQtUg5BF9awE8HYR7FytdJ9Hy8BTMgor2gcFGfSyxv915grhJEjKGmV)), wallet holds **0.00260421 AAPLx** on-chain |
| Vault buys the deepest gap, holds, unwinds | ✅ **round trip VERIFIED** — bought at gap −0.16% (8g18g7V3…), sold exactly 0.00074359 at the 13:30 UTC open (4UX9k6o7…, slot 449069399), vault idle | tx links on landing + vault DB |
| Honest ledger (phantom-NAV impossible) | ✅ | 25/25 tests incl. cost-basis guard + **swap-verification** (fill only when `err===null`) + startup **phantom reconcile** (pre-fix failed fill annotated `BUY FAILED ON-CHAIN` in `vault_fills`) |
| No blind trades when data degrades | ✅ | ≥50bps + live-reference guard, tested |
| Pyth live prices | ⚠️ key-gated (Pro grant is the bounty prize) | `/api/pyth` reports the gate honestly |
| Demo video | ✅ | https://afterhourequity.xyz/demo/afterhours-demo-v2.mp4 — on-camera verified mainnet buy (65s, 720p) |
| Bounties: PreStocks ($10K) … | ✅ **ELIGIBLE via the PreStocks Desk surface** (`/prestocks` — PreStocks-only data, satisfies the no-other-issuer rule) | live page + `docs/rubric.md` |
| Bounties: Meteora DBC / Clawpump | ❌ not shipped (honest) | `docs/rubric.md` |

## PreStocks bounty ($10K) — separate paste-ready entry

**Bounty description:** PreStocks Desk is a live intelligence desk for tokenized
pre-IPO stocks built **exclusively** on PreStocks data. Pre-IPO tokens carry two
prices at once — the issued token price and the issuer's mark price — and the
spread is the story. The desk screens all 8 PreStocks tokens (ANDURIL,
ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX) for
token-vs-mark dislocations, tracks price history in 15-minute snapshots with
per-token sparklines, evaluates plain-English alert rules ("NEURALINK trades
more than 10% above its mark price"), and projects honest hold scenarios
(mark-convergence / valuation opinion / flat) — with a built-in eligibility
note on the page itself. Why PreStocks: discovery and analysis are exactly what
the bounty asks for, the data is real and keyless, and the dual-price structure
is a verified, visible signal right now (NEURALINK +29%, SPACEX −22%).

**Bounty links:** Live: https://afterhourequity.xyz/prestocks · API:
`/api/prestocks/*` · GitHub: github.com/norbert351/afterhours
**Eligibility note:** this surface references `prestocks.com/api/prestocks`
only — no other pre-IPO issuer is integrated here (the main-track app also
reads Tessera for cross-issuer analysis; the two surfaces are separate and this
one is single-source by design).
---

# AfterHours — BNB Tokenized Stocks Submission (paste-ready)

> Deadline **Oct 11 2026**, $20K main pool (1st $6K/4th $2K…), plus **2×$2K
> specials** (Best Use of Binance Agentic Wallet / Wallet Skills; Best Use of
> BNB Agent Studio). Same product core ported to BNB Chain with BSC sponsor tech
> load-bearing. Web3 API is the sanctioned aggregate surface.

## Theme pick

**Main track** — *Tokenized-stock product / autonomous agent on BSC.* The weekend
gap that AfterHours captures on Solana exists identically on BNB Chain: the reference
price freezes at the NYSE close, while the on-chain market trades 24/7. The port
maps the verified BSC rails (bStocks + Ondo, Binance Web3 API RWA) onto the same engine.

> **Venue-size claim removed.** Earlier drafts stated BNB Chain is "88% of tokenized-stock
> DEX volume" (and "#1 tokenized-equity venue"). That figure's scope, date and denominator
> could not be sourced to a trustworthy, directly-relevant reference, so it is **removed**
> rather than cited. The product does not depend on it.

## Description (paste text, ~3 paragraphs)

AfterHours on BNB Chain brings the weekend-gap capture agent to BSC. bStocks (BEP-20,
symbol-verified on-chain) and Ondo (documented BSC addresses) trade while their NYSE
reference freezes. AfterHours reads the **Binance Web3 API** for the on-chain price **and**
the underlying reference, computes the weekend-gap dislocation per token, and — after the
official **Transaction API dry-run** returns SUCCESS — routes bounded spot execution through
the Web3 API Trading aggregator (token→token SWAP) with hard caps, mint allowlists and rate
limits. *(RFQ execution is **not** wired; illiquid tickers that don't route on the SWAP leg
are shown as unavailable for that size, not traded.)*

The product is a **multi-tenant, account-gated app**: every user owns an isolated paper
book and an isolated Weekend Gap Vault (per-user deposit/state/fills), and every strategy
add is confirmed in your wallet. The same rails are also exposed as a **local stdio MCP
server** (`bnb_gap`, `bnb_quote`, `bnb_status`) and an **x402 self-funding endpoint**
(`/api/bnb/agent/gap`, real x402 v2 challenge). Both are **prepared for** Agent Studio /
Agentic Wallet, but neither an official Agentic Wallet integration nor a deployed Agent
Studio agent is claimed (see the matrix below).

## Load-bearing BNB sponsor tech (in code, not claims)

| Sponsor surface | How it's used (in the repo) | Status |
|---|---|---|
| **Binance Web3 API — RWA Data API** | `src/adapters/bsc.js` `bnbRealTokens()` → `GET /api/v1/dex/market/rwa/tokens` (on-chain + reference price, market status) | **VERIFIED** (keyed) |
| **Binance Web3 API — Market API** | `bnbRwaPrices()` → `dex/market/rwa/price`; `/api/bnb/web3/rwa-price` | **VERIFIED** (keyed) |
| **Binance Web3 API — Trading API** | `bnbAggQuote()` / swap build → `/api/v1/dex/aggregator/quote` + `/swap` (token→token SWAP) | **VERIFIED** (keyed) |
| **Binance Web3 API — Transaction API** | `bnbSimulateTx()` → `POST /api/v1/dex/pre-transaction/simulate`; the **pre-broadcast dry-run gate** in `bnbExecuteSwap` (fails closed) | **VERIFIED live** (keyed) |
| **Binance Web3 API — Wallet API** | not used (balances read via BSC RPC) | **NOT IMPLEMENTED** |
| **Binance Web3 API — DeFi API / b402** | not used | **NOT IMPLEMENTED** |
| **bStocks / Ondo on BSC** | bStocks BEP-20 symbol-verified on-chain; Ondo documented addresses; 46 bStocks + Ondo tokens from the RWA Data API | **VERIFIED** |
| **x402 self-funding** | `src/services/bnb-x402.js` (`@altananetwork/x402-server`) → `/api/bnb/agent/gap` returns a real x402 v2 challenge ($U · EIP-3009 · eip155:56) | **VERIFIED** (challenge); settlement proceeds not yet observed |
| **TwelveData** | independent frozen-NYSE reference fallback when the RWA key is unset | **VERIFIED** |

## Special prizes — honest state

| Special | State | Why |
|---|---|---|
| Best Use of Agentic Wallet / Wallet Skills | **NOT PURSUING as "complete"** | Live exec uses a **private-key wallet** (`AH_BNB_EXEC_PRIVATE_KEY`), **not** the official Agentic Wallet. The MCP surface is available; the official wallet integration is **not verified**. |
| Best Use of BNB Agent Studio | **PARTIAL** | Local stdio MCP server + a real x402 self-funding endpoint + a **VERIFIED ERC-8004 on-chain identity** (agentId `369879`, tx `0x99521f8d…`, registry `0x8004A169…`, owner = exec wallet, verified via `ownerOf`/`tokenURI`). No **deployed Agent Studio agent** yet. |

## Links

- **Live:** https://afterhourequity.xyz/bnb (BNB port) · https://afterhourequity.xyz (product)
- **GitHub:** https://github.com/norbert351/afterhours
- **MCP:** `npm run bnb-mcp` (stdio; tools `bnb_gap`, `bnb_quote`, `bnb_status`)

## Verified / unverified matrix (BNB)

| Claim | Status | Evidence |
|---|---|---|
| bStocks BEP-20 on BSC | ✅ | `eth_call symbol()` → "bStocks"; `eth_getCode` returns bytecode (public BSC RPC) |
| BSC public RPC reachable | ✅ | `bsc-dataseed.binance.org` → eth_blockNumber 200 |
| GeckoTerminal bsc prices | ✅ | HTTP 200 for bStocks/USDon |
| Keyless KyberSwap quote | ✅ | `aggregator-api.kyberswap.com/bsc` routes → code 0, real amountOut |
| Web3 API RWA (real per-stock gap) | ✅ keyed | 46 bStocks resolved from `dex/market/rwa/tokens`; `/api/bnb/web3/rwa-price` returns 501 when key unset — honest |
| **Transaction API dry-run** | ✅ | `POST /api/bnb/exec/dry-run` → real simulate verdict (`SUCCESS`/`FAILED` + `failReason`); gate blocks broadcast on non-SUCCESS |
| Trading API quote/swap-build | ✅ | `code 0` quote with `quoteId`; swap build returns `tx{to,data}` |
| RFQ execution | ❌ not wired | mentioned only in comments; no RFQ endpoint is called |
| xStocks-on-BSC | ❌ unverified | official docs omit BSC; deliberately not claimed; anchors on bStocks + Ondo |
| PancakeSwap V2 Router | ✅ | `0x10ED…024E` `eth_getCode` bytecode |
| "88% of tokenized-stock DEX volume" | ❌ removed | no trustworthy source for scope/date/denominator |
| Agentic Wallet integrated | ❌ NOT VERIFIED | private-key wallet only |
| Agent Studio agent deployed / ERC-8004 minted | ⚠️ PARTIAL | ERC-8004 identity **MINTED + verified** (agentId `369879`, tx `0x99521f8d…`, registry `0x8004A169…`); **no deployed Studio agent** |

