# AfterHours — The Idea, What's Live (BNB + Bitget), and the Hackathon Criteria

> Written from the live repo + verified endpoints. Every claim below was checked this session
> (endpoints returning 200, real data). Honest gaps are marked ⚠️ / ❌ — never dressed up.

---

## PART 1 — THE CORE IDEA

**One sentence:** AfterHours is an autonomous **weekend-gap capture agent for tokenized equities** — it measures the divergence between an on-chain tokenized stock trading 24/7 and its **reference price that freezes when the NYSE closes**, and puts capital to work on that gap.

**The mechanism (why it's real):**
- The reference price of every tokenized equity (Bitget `R<SYM>USDT`, BNB bStocks/Ondo, Solana xStocks) is **frozen** from Friday's close to Monday's open — ~135.5 hours a week.
- The **on-chain token keeps trading** those same 135.5 hours.
- So the token **drifts away from the frozen reference**. That drift *is* the arbitrage signal — and it's live right now (this weekend the Bitget rTokens printed +0.2% to +2.0% over their frozen refs; bStocks printed +0.5%).
- AfterHours computes `gapPct = (on-chain price − frozen reference) / reference` per token, then **acts** on the largest dislocation: premium → short/hedge, discount → buy.

**The same engine, three venues.** One product core, ported to the three places tokenized equities actually trade:
| Venue | Token | Reference | Sponsor tech |
|---|---|---|---|
| **Bitget** | rTokens (`RMSFTUSDT`) | Bitget UTA v3 + native underlying | Bitget UTA v3 spot |
| **BNB Chain** | bStocks / Ondo | Binance Web3 API RWA Data | Binance Web3 API (aggregate) |
| **Solana** | xStocks | GeckoTerminal + frozen NYSE | Jupiter / on-chain vault |

---

## PART 2 — WHAT'S BUILT & LIVE ON **BNB**

**Live:** https://afterhourequity.xyz/bnb

### The idea for BNB
BNB Chain hosts the **largest** tokenized-equity venue (bStocks + Ondo). The weekend gap that AfterHours captures on Solana exists identically on BSC: bStocks reference freezes at the NYSE close, the on-chain market trades 24/7. The port maps the verified BSC rails onto the same engine.

### Sponsor tech — load-bearing (in code, not claims)
| Binance surface | How it's used | File |
|---|---|---|
| **Binance Web3 API** (market / RWA / swap / RFQ) | `bnbWeb3Call()` — real **HMAC-SHA256** signing (`X-OC-APIKEY/TIMESTAMP/SIGN`, `preHash = ts+method+requestPath(/build)+body`). `dex/market/rwa/*` gives on-chain price **and** underlying reference in one call. Honest `configured:false` when the key is unset. | `src/adapters/bsc.js` |
| **Binance Agentic Wallet** ($2K special) | An **MCP server** (`bnb_gap`, `bnb_quote`, `bnb_status`) so the product is drivable by an agent from the Agentic Wallet stack (MCP/Skills) | `src/mcp/bnb-mcp.js` |
| **BNB Agent Studio** ($2K special) | The same MCP server registers in Agent Studio; NL strategy agent + x402 self-funding | `npm run bnb-mcp` · `/api/bnb/agent/*` |
| **bStocks / Ondo on BSC** | Real BEP-20 tokens, symbol-verified on-chain | `src/services/bnb.js` |
| **TwelveData** | Independent frozen-NYSE reference fallback when the RWA key is unset | `src/adapters/twelvedata.js` |

### What's LIVE today (verified this session)
| Endpoint / surface | What it does | Status |
|---|---|---|
| `/bnb` page | Live weekend-gap dashboard + rail status + RWA table + **Paper strategy engine** | ✅ 200 |
| `GET /api/bnb/universe` | **Real** on-chain vs reference gap per BSC equity — **5,350 tokens** (46 bStocks + Ondo), **476 gaps**, sorted by \|gap\|, plausibility-filtered | ✅ real data |
| `GET /api/bnb/web3/rwa-price` | Real per-token `tokenPrice` vs `referencePrice` from the sanctioned RWA Data API | ✅ `code:0`, 8 rows |
| `POST /api/bnb/paper-act` | **Paper strategy engine** (added this session): largest-\|gap\| → premium = short/hedge, discount = buy | ✅ live |
| `GET /api/bnb/decisions` | The paper decision log | ✅ live |
| `POST /api/bnb/exec` | **REAL bounded spot execution** (0.05–0.50 USD) via the Web3 API (PancakeSwap V3) — real on-chain fill verified: `0.15 USDT → 0.000659939 IBMB`, tx `0x2c683c47…0b411b74`, receipt success | ✅ live |
| `/api/bnb/agent/{strategy,arm,actions}` | NL → real bounded BSC execution with an auditable action log (**Agentic Wallet** special) | ✅ wired |
| `/api/bnb/agent/gap` | x402 v2 self-funding (**Agent Studio** special) | ✅ wired |
| `GET /api/bnb/equity-quote` · `/api/bnb/quote` | Sanctioned cross-DEX quote + keyless KyberSwap quote | ✅ |
| `npm run bnb-mcp` | MCP server (stdio): `bnb_gap`, `bnb_quote`, `bnb_status` | ✅ |
| Tests | `node --test test/bnb.test.mjs` — 9/9 | ✅ |

### Honest gaps (BNB)
- ⚠️ **Thin bStocks liquidity** — only liquid tickers route on the SWAP leg (IBMB ✓; CBRSB returns 40374 at $0.15). RFQ mode is the path for illiquid tickers, not yet wired.
- ⚠️ **ERC-8004 on-chain identity mint is registrar-gated** — `register()` on the IdentityRegistry reverts from an arbitrary EOA; the identity NFT must be minted through the **BNB Agent Studio platform registrar**. The durable EIP-8004 registration JSON is hosted at `/agent/afterhours-bnb.json`, ready to register.
- ❌ **xStocks-on-BSC** — unverified (official docs omit BSC); deliberately not claimed. Build anchors on bStocks + Ondo.

---

## PART 3 — WHAT'S BUILT & LIVE ON **BITGET**

**Live:** https://afterhourequity.xyz/bitget · **Sleep Mode:** https://afterhourequity.xyz/sleep

### The idea for Bitget
Bitget lists **rTokens** (`R<SYM>USDT` — e.g. `RMSFTUSDT`) that track a US equity but **trade 7×24**. While the NYSE is shut, the rToken keeps printing against a **frozen** native reference — that divergence is the arbitrage. This is the exact **Track 1 · Alpha Factory → Arbitrage** brief.

### Sponsor tech — load-bearing
| Bitget stack | How it's used | File |
|---|---|---|
| **Bitget UTA v3 spot market** (`R<SYM>USDT`) | The on-chain price leg — live rToken quotes for US names | `src/adapters/bitget-r.js` |
| **US native reference** | The frozen baseline (gated by market-open) | `getReferencePrice` + market-hours |
| **Qwen (Bitget's LLM)** | The autonomous decision-maker in Sleep Mode | `src/services/sleep-agent.js` |
| **Bitget MCP / signal** | Optional signal layer (same tooling as VIGIL) | 🔶 optional |

### What's LIVE today (verified this session)
| Surface | What it does | Status |
|---|---|---|
| `/bitget` page | Live arbitrage surface (rToken vs reference, per symbol, direction) + Paper-act + Refresh | ✅ 200 |
| `GET /api/bitget/arbitrage` | **REAL** Bitget rToken prices vs the frozen reference, per symbol (e.g. NVDA +0.80%, META +0.78%, MSFT +0.68%) | ✅ real data |
| `POST /api/bitget/paper-act` | Paper strategy action: top \|gap\| → premium = short/hedge, discount = buy | ✅ live |
| `GET /api/bitget/decisions` | Paper decision log | ✅ live |
| **Sleep Mode** `/sleep` | **Autonomous Qwen agent** — Qwen decides the overnight moves, a **second Qwen pass audits** them before execution, every fill is **signed** | ✅ live |
| `POST /api/sleep/run` · `/arm` | Run a pass / arm the autopilot (wallet-gated) | ✅ |
| `GET /api/sleep/{status,metrics,report,decisions}` | Strategy metrics (NAV / return / **Sharpe** / **max DD** / **win rate** / turnover / fees / slippage) + equity curve + Night Report | ✅ |
| `GET /api/sleep/fallback-context` · `POST /api/sleep/inject` | **Hermes-agent fallback** — when Qwen times out, a Hermes agent reasons + injects signed orders (same audit) | ✅ |
| Multi-venue autopilot | Runs **Bitget + BNB + Solana** every 5 min (deep Qwen budget), self-healing via a watchdog | ✅ |
| Tests | full suite 54/54 | ✅ |

### Sleep Mode — the agentic layer (the "Alpha Factory" story)
1. **Qwen decides** (primary LLM): given the rules + live gaps + holdings, it returns the orders.
2. **Qwen audits** (second pass): rejects unsafe orders (>25% NAV, unheld sells, over-cash buys).
3. **Signed + logged**: every fill gets a `VIGIL-<sha256>` signature and a Night Report.
4. **Honest fallback**: if Qwen times out, a **Hermes agent** decides (not a dumb stub), and if that's unavailable the deterministic safety engine acts — the agent always acts, and each decision is labelled with *who* decided.
5. **Paper by design**: Sleep Mode trades a **notional paper book** (no real money). The **Solana vault** is the real-mainnet rail.

### Honest gaps (Bitget)
- ⚠️ **Qwen endpoint latency is intermittent** (~5s to >30s under load). Mitigated (short interactive budget + Hermes fallback + `/no_think` orders-only prompt), but the endpoint itself isn't under our control.
- 🔶 **Sharpe / DD / win-rate** — derived from the paper NAV series (add the metrics endpoint done ✅).
- ❌ **Compliant X post** (`#BitgetHackathon` + `@Bitget_AI`) — **user-gated** (this entry needs its own post).
- ⚠️ **v2 weekend-gap book** is idle (its only tradable names were volatile pre-IPO prestocks; excluded to prevent phantom value). Needs reliable tokenized equities added to re-activate.

---

## PART 4 — THE HACKATHON CRITERIA & JUDGE RULES

### A) BNB Hack — **Tokenized Stocks Edition** (bStocks / Ondo / xStocks)
| | |
|---|---|
| **Objective** | Build something people would **actually use** with tokenized stocks **on BSC**, with an agent. |
| **Deadline** | Submissions lock **Sun 11 Oct 2026 12:00 UTC** · judging 12–23 Oct · winners week of 26 Oct. |
| **Prize** | **$20K main track** ($6K / $4K / $3K / $2K / $1K) + **2× $2K specials**: *Best Use of Binance Agentic Wallet / Wallet Skills* and *Best Use of BNB Agent Studio*. |
| **Hard rules** | ≥1 of **bStocks / Ondo / xStocks** central · **spot only** (no perps) · **BSC mainnet only** · the **free Web3 API** (elevated limits) is the sanctioned surface. |
| **Judged axes** | Real user + problem · **working end-to-end demo** (not a deck) · **sponsor tech load-bearing** · quality of execution · honest craft. **Agents are scored on craft, not PnL.** |
| **Suggested ideas** | Market-hours arbitrage / on-chain-vs-reference monitor (their own "Ideas to Build"). |

**AfterHours → criterion mapping**
| Rule / axis | AfterHours evidence | Status |
|---|---|---|
| Build something usable with tokenized stocks on BSC | Live `/bnb` dashboard + MCP server + real RWA API integration | ✅ live |
| Market-hours arb / on-chain-vs-reference monitor | `gapPct = (tokenPrice − referencePrice)/reference` from the sanctioned RWA Data API on **real** BSC equities | ✅ real |
| ≥1 of bStocks / Ondo / xStocks central | **46 bStocks + Ondo** wired from `rwa/tokens`; bStocks demonstrated (IBMB, QCOMB, MSMB…) | ✅ |
| Spot only / BSC mainnet only | All execution spot; reads/quotes on chain 56 | ✅ |
| Agents scored on craft, not PnL | No fabricated gaps; implausible prices (>10% off) **flagged, never reported** | ✅ |
| Free Web3 API | `AH_BNB_WEB3_KEY/SECRET` wired, HMAC per official auth docs | ✅ |

---

### B) Bitget — **AI Base Camp S2**, Track 1 · **Alpha Factory (Quantitative Strategies) → Arbitrage**
| | |
|---|---|
| **Track** | **Track 1 · Alpha Factory** (quant strategy), sub-theme **`Arbitrage`**. |
| **Sub-theme (verbatim)** | *"Sell when rToken price > NAV via mint; cross-platform spreads; same-underlying different issuers… **rToken trades 7×24 while underlying is closed**."* |
| **Deadline** | **8 Oct 2026** (extended; judging 9/22–10/7 in parallel). |
| **Judged axes** | Runnable **event → decision → execution** demo · **real data** · **paper-trading log** · **quant metrics (Sharpe / max DD / win rate)** · compliant **X post** with `#BitgetHackathon` + `@Bitget_AI`. |
| **Metrics labelling** | Test period, Sharpe, max DD, turnover, fee/slippage must be labelled **observed / estimated / targeted**. |

**AfterHours → criterion mapping**
| Axis | AfterHours evidence | Status |
|---|---|---|
| Runnable demo + event→decision→execution | `https://afterhourequity.xyz/bitget` + `POST /api/bitget/paper-act` + Sleep Mode | ✅ live |
| Real data (rToken + volume) | `/api/bitget/arbitrage` returns **real** Bitget rToken vs reference | ✅ verified |
| Paper-trading log | `/api/bitget/decisions` + `/api/sleep/decisions` (signed) | ✅ |
| Sharpe / DD / win-rate (quant) | `/api/sleep/metrics` (NAV / Sharpe / maxDD / win-rate / turnover / fees) | ✅ |
| Compliant X post | needs its own `#BitgetHackathon` + `@Bitget_AI` post | ❌ user-gated |
| Metrics labelled observed/estimated/targeted | to fill in the submission form | 🔶 |

---

### C) The general judging philosophy (applies to all three entries)
Pulled from the live **Stocklana / Solana Foundation** rubric (`docs/rubric.md`) — the same axes the other events judge on:
1. **A real user and a real problem** (can this be a real app people will actually use?).
2. **A working end-to-end demo** — live URL, not slides.
3. **Reason the product belongs on that specific chain** (load-bearing, not decorative).
4. **Quality of execution** (tests, guard rails, security, docs).
5. **Real capital moved** (verifiable on-chain tx links).
6. **Autonomy** (acts on its own, not human-invoked).

---

## PART 5 — ONE-PARAGRAPH SUMMARY (paste-ready)

AfterHours is an autonomous **weekend-gap capture agent for tokenized equities**. When the NYSE closes, the reference price of every tokenized stock freezes — but the on-chain token keeps trading 24/7 — so the token drifts away from that frozen reference. AfterHours measures that dislocation in real time and puts capital to work on the largest one. It's live on **three venues** with the same engine: **Bitget** (rTokens, `R<SYM>USDT`, via the Bitget UTA v3 spot market — with an **autonomous Qwen agent** that decides, audits its own decisions with a second pass, and signs every fill), **BNB Chain** (bStocks + Ondo via the sanctioned **Binance Web3 API** RWA Data — real on-chain vs reference gaps, bounded real spot execution, and an **MCP server** for the Binance Agentic Wallet / BNB Agent Studio specials), and **Solana** (xStocks via a real on-chain vault that has settled verified mainnet fills). Nothing is fabricated: implausible prices are flagged, not reported; when a data source is gated the surface says so; and every decision is labelled with who made it.
