# AfterHours ⏰ — the market never sleeps

**On-chain equity intelligence for tokenized stocks.** AfterHours watches the gap between
the *frozen* reference price (the last NYSE close) and the *live, 24/7* on-chain price of the
same underlying — then alerts you when tokenized equities trade away from their reference.
Built against **verified** sponsor data, no fabricated prices.

> Target: Solana **STOCKLANA** (Sep 25) · BNB **Tokenized Stocks** (Oct 11) · Monad **Metropolis** (Oct 13)
> Same product core, three sponsor re-tunings — the "one product → N chains" pattern.

---

## The problem it solves (evidence-backed)

> "The closing bell rings and every stock price freezes until Monday. On-chain, nothing stops."
> — *BNB Tokenized Stocks brief*

Tokenized stocks trade **168 hours/week**, but their reference price only updates during the
**32.5 NYSE hours**. Over the 65-hour weekend the on-chain price drifts on thin DEX/oracle
liquidity — off real price discovery. Measured, not anecdote:

- **Binance Research:** 44% of bStocks turnover prints *outside* the regular session; weekend
  on-chain prices anticipate **87% of Monday's open**.
- **Verified right now in this app:** the *same underlying* is priced **178% apart** across two
  issuers (SpaceX @ PreStocks vs Tessera), **114%** (Kalshi), **20%** (OpenAI). Nobody is
  acting on these gaps.

---

## What's verified vs keyed (honest)

| Source | Status | Endpoint | Verified live |
|---|---|---|---|
| **PreStocks** (pre-IPO) | ✅ no key | `GET prestocks.com/api/prestocks` | ANDURIL, ANTHROPIC, OPENAI, SPACEX, KALSHI, FIGUREAI, NEURALINK, POLYMARKET — real prices + contract addrs |
| **Tessera** (private equity) | ✅ no key | `GET rest-api.tessera.pe/v1/public/token-details` | T-OpenAI, T-Kalshi, T-SpaceX (mark prices, holders, mints). Flaky upstream → resilient per-source handling |
| **Twelve Data** (NYSE anchor) | ✅ demo key | `GET api.twelvedata.com/price?symbol=AAPL` | AAPL live `$335.59` (free demo key; real key unlocks more symbols) |
| **Pyth** (the weekend-gap oracle) | ⚠️ feed IDs verified; **live prices need key** | `hermes.pyth.network/v2/price_feeds` | 5 AAPL feeds confirmed (equity-nyse / xStock 24-7 / Ondo 24-7 / pyth-24-7 / redemption). Latest-price pulls return **HTTP 401** without `PYTH_API_KEY` (the Pyth Pro bounty supplies it). Adapter never fabricates — it returns feed metadata + an explicit "key required" gate. |

**No fake data.** Every endpoint the app serves is either a live upstream call, or an explicit,
labeled upstream gate.

---

## Architecture

```
src/
  config.js             env + verified feed IDs/source URLs
  lib/http.js            cached, retry-on-5xx fetch (gentle to flaky upstreams)
  adapters/
    prestocks.js         REAL pre-IPO token prices
    tessera.js           REAL private-equity prices
    twelvedata.js        REAL NYSE reference (market-hours aware)
    pyth.js              verified feed registry + keyed live-price gate
  services/
    oracle.js            unified universe, per-source resilience (one flaky issuer never kills the page)
    dislocation.js       gap engine (issuer-premium + cross-issuer spreads)
    strategies.js        plain-English rule engine → live alerts (v1)
    paper.js             v2 paper execution ledger (integer micro-units, fees/slippage, cost basis, NAV, self-funding)
    v2.js                v2 orchestration: strategy → target book → paper execution → decision log
  store.js               v2 persistence (node:sqlite WAL): strategies, paper account, positions, decisions, alerts
  server.js              Express API (v1 detection + v2 strategy/paper) + static frontend
public/                  mobile-first dashboard (no build step)
test/                    ledger-invariant unit tests (node --test)
```

**Robustness:** per-source `Promise.allSettled` (a flaky issuer degrades that source, never the page), 30s cache TTL, retry-on-5xx, honest error surfaces, WAL persistence, tolerance-based rebalancing (no churn), fees/slippage on every fill.

---

## Run it

```bash
cd afterhours
npm install
npm start          # → http://localhost:8080   (PORT env overrides)
npm run verify     # proves every adapter returns real data or a labeled gate
```

### API
| Route | Returns |
|---|---|
| `GET /api/dashboard` | market status, NYSE references, universe, cross-issuer spreads |
| `GET /api/dislocations` | ranked real pricing gaps |
| `GET /api/pyth` | verified feed registry (+ live prices if key set) |
| `POST /api/strategies` | add a plain-English rule |
| `GET /api/strategies/evaluate` | fire rules against live dislocations |

### v2 (strategy layer · paper execution)
| Route | Returns |
|---|---|
| `POST /api/v2/strategies` | add a strategy (`type: rotate_to_discount` / `alert`) |
| `POST /api/v2/run` | run the strategy → paper book executes (buy/sell), logs decision + alert |
| `GET /api/v2/book` | paper account (seed/cash/peak NAV) + positions |
| `GET /api/v2/decisions` | decision log (reason, fills, NAV) |
| `GET /api/v2/alerts` | delivered alert events |

`rotate_to_discount` deploys paper capital (default $10k) into tokenized equities trading **below** their mark price (buy the float-up), rebalanced with a tolerance band (no churn). Every fill carries **10bp fee + 2bp slippage**, cost basis, realized P&L, and high-water drawdown — the same ledger discipline as a real trading agent. **Honest:** NAV is valued at real token price, so a discount to mark shows as opportunity, never as instant phantom profit.

### Strategy examples (real evaluation)
- `"SPACEX trades more than 10% above its mark price"` → FIRED (SpaceX cross-issuer gap 178.0%)
- `"show the biggest gap"` → top 3
- `"cross-issuer spread for openai both issuers"` → FIRED (20.46%)

---

## Notes / next increments
- `PYTH_API_KEY` unlocks the real weekend-gap live comparison (the Stocklana Pyth bounty).
- A real Twelve Data key unlocks additional anchor symbols beyond `demo`.
- **Scope honesty:** the strategy engine *detects & alerts*. On-chain order *execution*
  (funded wallet + slippage + verified DEX routing) is the next build increment — never fake-ordered.
- BNB port: swap adapters to bStocks/Ondo/xStocks on the Market/Trading/RWA API + Agentic Wallet.