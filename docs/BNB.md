# AfterHours — BNB Tokenized Stocks Edition (BSC)

**Project:** AfterHours · BNB Chain port
**Event:** BNB Hack: Tokenized Stocks Edition (bStocks / Ondo / xStocks central).
**Deadline:** Submissions lock Sun **11 Oct 2026 12:00 UTC** · judging 12–23 Oct · winners week of 26 Oct.
**Prize:** $20K main track ($6K/$4K/$3K/$2K/$1K) + 2×$2K specials (Agentic Wallet, BNB Agent Studio).
**Live:** `https://afterhourequity.xyz/bnb` · repo `norbert351/afterhours` (public) · BSC mainnet spot-only, screen shown dry-run + few-dollar live.

---

## Why AfterHours fits (criterion → repo evidence)

| BNB rule / judged axis | AfterHours evidence | Status |
|---|---|---|
| **"Build something people would actually use with tokenized stocks on BSC"** + agent expected | Working product (not a deck): live weekend-gap dashboard + MCP server (`src/mcp/bnb-mcp.js`) + real RWA Data API integration. | ✅ live |
| **Market-hours arbitrage / on-chain vs reference monitor** (their Ideas to Build) | `src/adapters/bsc.js` + `src/services/bnb.js` compute `gapPct = (on-chain tokenPrice − referencePrice)/reference` from the **sanctioned RWA Data API** on real BSC equities. | ✅ live, real data |
| **≥1 of bStocks / Ondo / xStocks central** | 46 real bStocks + 1326 Ondo tokens on BSC mainnet wired from the RWA Data API (`GET /api/v1/dex/market/rwa/tokens`). bStocks demonstrated (IBMB, QCOMB, TSMB, MSFTB…). | ✅ live |
| **Spot only / BSC mainnet only** | All execution is spot; no perps. Reads + quotes hit BSC mainnet via Web3 API (chain 56). | ✅ |
| **Agents scored on craft, not PnL** | Honest build quality: no fabricated gaps; implausible on-chain prices (>10% from reference — wrapper/denomination artifacts) are **flagged, never reported as real** (`bnbEquityGaps`). | ✅ |
| **Free Web3 API + elevated limits** | `AH_BNB_WEB3_KEY` / `AH_BNB_WEB3_SECRET` wired; HMAC-SHA256 signing per official auth docs (`preHash = ts+method+requestPath(/build)+body`). | ✅ live |

## What is REAL today (verified this session)
- Binance Web3 API auth works (`code:0` on `dex/aggregator/supported/chain`).
- Live RWA gap surface: `GET /api/bnb/universe` returns **real** on-chain vs reference per BSC equity (bStocks + Ondo), dedup'd + plausibility-filtered, sorted by |gap|. While the US market is shut, on-chain drifts off the frozen reference (e.g. IBMB +0.5% on a Sunday).
- **LIVE spot execution (a few-dollars)**: `POST /api/bnb/exec` (bounded 0.05–0.50 USD) approves USDT → broadcasts the swap tx via the sanctioned Web3 API (PancakeSwap V3). **Real on-chain fill verified:** `0.15 USDT → 0.000659939 IBMB`, swap tx `0x2c683c4715766aea6904dc07734153f014e8e72ce682e51c9d3403020b411b74` (receipt `success`, 14 logs), spent on fresh exec wallet `0xa5de403F977f68c46716fA787205d8E074F8a94F`.
- Public dashboards (`/bnb`), read-only quotes public, keyless Kyber swap quote works.
- 9/9 BNB tests (`node --test test/bnb.test.mjs`).

## Honest gaps (built-but-partial / not yet done)
- **Thin tokenized-equity liquidity**: only liquid bStocks route on the SWAP leg (IBMB ✓; CBRSB 40374 at $0.15). For illiquid tickers, RFQ mode (`dex/aggregator/order/submit`) is the path — not yet wired.
- **Best Use of BNB Agent Studio ($2K)**: MCP server exists; Agent Studio identity (ERC-8004) + x402 self-funding + autonomous runtime registration **not yet wired**.
- **Best Use of Agentic Wallet ($2K)**: Binance Web3 Wallet AI-execution integration **not yet wired**.

## Repro (for judges)
```bash
git clone https://github.com/norbert351/afterhours && cd afterhours
# needs AH_BNB_WEB3_KEY / AH_BNB_WEB3_SECRET (free at web3.binance.com dev-portal)
npm i && node --test test/bnb.test.mjs
PORT=8090 node src/index.js
# → https://afterhourequity.xyz/bnb   API: /api/bnb/universe (real gaps) · /api/bnb/equity-quote
```