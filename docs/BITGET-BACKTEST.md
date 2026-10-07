# AfterHours · Bitget rToken arbitrage — real-data backtest

**Code:** `scripts/bitget-arb-backtest.py` (this file generated `data/backtest/report.json`)
**Run:** `python3 scripts/bitget-arb-backtest.py`
**Data (all real, fetched live, cached under `data/backtest/`):**
- On-chain leg — Bitget UTA v3 spot daily candles, public, no key:
  `GET https://api.bitget.com/api/v2/spot/market/candles?symbol=R<SYM>USDT&granularity=1day`
- Reference leg — TwelveData daily US closes (the engine's own reference source), 400 bars.

**Period:** 2025-11-06 → 2026-10-06 · 291 rToken days (US-market days + weekends).
**Universe:** TSLA, COIN, MSFT, AAPL, META, NVDA, SPY, MSTR (their Bitget `R<SYM>USDT` pairs).

## Strategy (mirrors `src/services/fairvalue.js`)
```
rawGap_t     = (rToken_close_t − ref_close_lastUS) / ref_close_lastUS
marketFactor = SPY's rawGap the same day
residual_t   = rawGap_t − beta · marketFactor_t      beta = 1.0 (labelled fallback)
netEdge_t    = |residual_t| − 0.14%                  (cost model: 0.10 fees + 0.04 slippage)
Signal       = SPOT-LONG ONLY: enter a DISCOUNT (residual < 0) with netEdge > 0.20%
Portfolio    = equal-weight top-2 by netEdge; enter at close, exit at the next rToken close.
```
Realised P&L uses the **actual next-day rToken move** (not the theoretical edge), minus the 0.14% round-trip cost — i.e. no "the gap always closes" assumption.

## Results

| Variant | Window | n | Return | Sharpe | Sortino | Max DD | Win rate | Trades | Turnover/yr |
|---|---|---|---|---|---|---|---|---|---|
| All days | In-sample (261) | 261 | **−15.54 %** | −0.14 | −0.14 | −41.82 % | 47.6 % | 468 | 452 |
| All days | Out-of-sample (30) | 30 | +11.79 % | 2.89 | 4.23 | −6.51 % | 51.0 % | 49 | 412 |
| All days | Full | 291 | **−5.66 %** | **0.11** | 0.11 | −41.82 % | 48.0 % | 519 | 449 |
| Closed-window only | In-sample (43) | 43 | **−23.83 %** | −1.20 | −1.04 | −43.34 % | 53.3 % | 75 | 440 |
| Closed-window only | Out-of-sample (8) | 8 | +14.08 % | 9.29 | 9.45 | −4.47 % | 76.9 % | 13 | 410 |
| Closed-window only | Full | 51 | **−13.11 %** | **−0.31** | −0.27 | −43.34 % | 56.7 % | 90 | 445 |

## Honest read
**The naive mean-reversion form of the AfterHours signal does not produce positive risk-adjusted
returns on this data.** Full-period Sharpe ≈ 0.11 (all days) / −0.31 (closed-window only), with a
≈ −42 % maximum drawdown and a negative full-period expectancy after the 0.14 % cost model. The
positive out-of-sample numbers sit on 8–30 observations — noise, not signal (OOS Sharpe is *larger*
than IS, the opposite of a real edge decaying).

**Interpretation:** the rToken price appears to **lead** the frozen US reference rather than lag it.
A "discount vs the last US close" is therefore often the market pricing in an overnight move that
the underlying then confirms — not a mispricing to be harvested. Buying that discount is buying
into the move.

**What this means for the product (and any submission):**
- The defensible, demonstrable value of AfterHours is the **cost-and-factor-aware selection +
  risk gate** — correctly refusing to trade the ~97 % of raw gaps that do not survive the market
  factor and the 0.14 % cost floor (the `WAIT` state), with a controlled verdict vocabulary,
  liquidity/plausibility tiers and an auditable decision ledger. That is a *risk/selection* story,
  not a claimed alpha source.
- Any submission must **not** claim arbitrage alpha. It should present these metrics as the
  observed result and the gate/no-trade behaviour as the value.

## Caveats (stated, not hidden)
- Daily-close proxy of an intraday engine; the live engine evaluates intraday closed-market windows.
- Instantaneous snapshot backtest (no queue/liquidity model); `beta = 1.0` fallback, as in the live engine.
- 8-symbol universe; rToken candle history begins 2026-03-05 for some pairs (full universe used from 2025-11-06).
