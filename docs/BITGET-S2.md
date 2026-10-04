# AfterHours · Bitget AI Base Camp S2 — Alpha Factory · Arbitrage

**Second entry** (VIGIL is the first, Track 2 · Agentic Trading). AfterHours targets
**Track 1 · Alpha Factory (Quantitative Strategies) → sub-theme `Arbitrage`.**
**Repo:** github.com/norbert351/afterhours · **Live:** https://afterhourequity.xyz/bitget
**Deadline (live):** now **8 Oct 2026** (extended; judging 9/22–10/7 in parallel).

> Arbitrage sub-theme (verbatim): *"Sell when rToken price > NAV via mint; cross-platform spreads;
> same-underlying different issuers… **rToken trades 7×24 while underlying is closed**."*

AfterHours' weekend-gap engine is literally this: while the NYSE is shut the Bitget
rToken (`R<SYM>USDT`) keeps trading and diverges from the FROZEN native reference —
that divergence is the arbitrage signal.

## Sponsor-tech residency (load-bearing, not decorative)
| Bitget stack | How AfterHours uses it | Verified |
|---|---|---|
| **Bitget UTA v3 spot market** (`R<SYM>USDT`) | The on-chain price leg — live rToken quotes for 16 US names | ✅ `src/adapters/bitget-r.js`, verified live 2026-10-04: MSTR +2.0%, COIN +1.1%, TSLA +0.4% during NYSE closure |
| **US reference** | Native underlying price (frozen while closed = the arb baseline) | ✅ `getReferencePrice` + market-open gate |
| **Bitget MCP / bitget-signal** | Optional signal layer (same tooling as VIGIL) | 🔶 wiring optional |

## Verified vs unverified
| Axis (S2 rules) | Evidence | Status |
|---|---|---|
| Runnable demo + event→decision→execution | `https://afterhourequity.xyz/bitget` + `POST /api/bitget/paper-act` | ✅ live |
| Real data (rToken+vold) | `/api/bitget/arbitrage` returns REAL Bitget rToken prices vs reference | ✅ verified |
| Paper-trading log | `/api/bitget/decisions` (NAV-based, no real money) | ✅ built |
| Sharpe/DD/win-rate (quant) | derive from paper NAV series | 🔶 add metrics endpoint |
| Compliant X post (`#BitgetHackathon` + `@Bitget_AI`) | 2nd entry needs its own post | ❌ user-gated |
| Metrics: test period, Sharpe, max DD, turnover, fee/slippage | label observed/estimated/targeted | 🔶 to fill |

## Repro
```bash
npm i && node --test        # 13 BNB + bitget arb tests
PORT=8090 node src/index.js # → /bitget, /api/bitget/arbitrage
```