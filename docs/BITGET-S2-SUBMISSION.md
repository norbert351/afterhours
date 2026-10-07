# AfterHours — Bitget AI Base Camp S2 · submission (copy-paste ready)

**Entry:** Track 2 · **Agentic Trading** → **Open Theme**
*(Rationale: Alpha Factory is pure-quant scored and our honest backtest shows no alpha — see
Part 3. AfterHours' real, demonstrable strength is an LLM-decided agent with a factor/cost
risk gate, an audit pass and an auditable ledger — exactly what Agentic Trading rewards, 50 %
of the score being judge-assessed architecture / explainability / risk control.)*

---

## FORM FIELDS

| Field | Answer |
|---|---|
| **Competition Track** | Agentic Trading |
| **Competition Sub-theme** | Open Theme |
| **Project Name** | AfterHours |
| **One-line Project Summary** | see below (≤140 chars) |
| **Did this team participate in S1?** | **No** |
| **Apply for Post-event Kimi K3 Token Credits** | Yes |
| **Open to Playbook Review and Listing Discussion** | Yes |

### One-line Project Summary (140 chars max)
> Autonomous 24/7 agent for tokenized-equity (rToken) dislocations: it sizes the cost-adjusted edge and refuses untradeable gaps.

*(127 characters — verified.)*

---

## PROJECT DESCRIPTION  *(paste as one answer into the "Project Description" field)*

### Part 1 · Thesis

AfterHours exists because **tokenized equities trade 24/7 while the market they reference does not.**
A Bitget rToken (`R<SYM>USDT`) keeps trading on weekends and overnight, but its US reference price is
**frozen** at the last close. That creates a visible price gap — and a trap.

**Core hypothesis:** *most* rToken dislocations are not tradeable. A raw gap is mostly the underlying
market moving (the broader tape), which the frozen reference simply has not caught up to. Only the part
of the gap that survives (a) removing the market factor and (b) subtracting real execution costs is a
candidate trade. The product's thesis is therefore **selection and refusal**, not "buy every gap".

**Signal sources**
1. On-chain leg — Bitget UTA v3 public spot market: `R<SYM>USDT` last price for 8 US names
   (TSLA, COIN, MSFT, AAPL, META, NVDA, SPY, MSTR). No key required, refreshed continuously.
2. Reference leg — the native US price (TwelveData, US-native), fetched once per market closure and
   held as the frozen baseline.
3. Market factor — SPY's own gap on the same tick, used to strip the broad tape out of every symbol.

**Decision logic** (`src/services/fairvalue.js`)
```
rawGap    = (rToken − reference) / reference
residual  = rawGap − beta · marketFactor        (beta = 1.0 fallback, published as such in the UI)
netEdge   = |residual| − costModel              (costModel = 0.10 % fees + 0.04 % slippage = 0.14 %)
verdict   = BUY / ROTATE / REDUCE / WATCH / WAIT   (a controlled vocabulary, not free text)
```
A dislocation is only **actionable** when `netEdge > 0.20 %`; otherwise the engine returns `WAIT`
with the reason. The UI always shows the full path — raw gap → market-adjusted residual → costs →
net edge → decision — and labels anything that is a fallback assumption as a fallback.

**Risk-control design**
- **Refusal by default.** The min-net-edge gate, an outlier/plausibility flag for implausible gaps
  (>10 %), and liquidity tiers mean the engine says `WAIT` for the large majority of raw gaps.
- **Spot-only, long-only, no leverage.** A `ROTATE` is an internal reallocation, never a short.
- **Paper-first execution.** `/api/bitget/paper-act` books a $100 paper fill and writes an auditable
  ledger row (timestamp, instrument, direction, price, quantity, notional, balance change).
- **Autonomous agent loop with an adversarial audit.** In Sleep Mode Qwen proposes orders, a
  deterministic rules engine enforces the caps (min net edge, max daily loss, max turnover,
  spot-only), an **independent audit pass can veto**, and a deterministic Hermes fallback takes over
  if the model is unavailable or non-compliant. Every step lands in the decision ledger with the NAV
  after execution.
- **Human takeover on demand.** Live wallet actions are gated — the agent can be disarmed at any time.

**Why existing solutions fall short.** Broker/bank tokenized-stock screens show a single last price
with no reference discipline, no cost model and no notion of when the market is closed; generic
"arbitrage scanners" surface raw percentage gaps without removing the market factor or subtracting
fees, so almost every "opportunity" they show is uneconomic at any real size. No mainstream screen
tells the user, honestly, *"this looks like a 2 % gap but after the tape and costs there is nothing
here — WAIT."* AfterHours is built around that sentence.

### Part 2 · Target user and product value

**Primary segment (concrete):** *self-directed retail-to-semi-pro crypto-native traders who already
hold tokenized US equities and want to monetise the closed-market window.*
- Profile: 25–45, **Retail/VIP tier** (not institutional), **moderate-to-high risk appetite**,
  **$5k–$250k** of discretionary capital, **high frequency in the crypto venue / low frequency in
  equities** (they cannot trade equities when the market is shut, which is exactly their problem).
- Primary market: **Bitget tokenized US equities (rTokens), USDT-quoted, 24/7**.
- Specific use case: the **weekend / overnight window** — they hold rTokens, the NYSE is closed, and
  they want to know whether a visible gap is worth acting on, and if so, how big and in which
  direction, without being fooled by the frozen reference.

**Secondary segment:** agents/quant developers who want a *cost-aware, closed-market* signal feed
(the JSON endpoints are public and machine-readable).

**Why they need it (the pain), and what current tools fail to solve**
1. **They cannot see the real edge.** Every screen shows the raw gap. Nobody subtracts the market
   factor and the fee/slippage floor, so users chase gaps that are already gone after costs.
2. **They misread the frozen reference as a stale feed.** The reference is *supposed* to be frozen —
   it is the baseline, and knowing that is the whole product. Tools that silently show it as "live"
   create phantom arbitrage.
3. **They have no discipline layer.** Nothing enforces "do not trade this", so a weekend of watching
   gaps becomes a weekend of paying spreads.
4. **They have no audit trail.** There is no record of *why* a decision was taken, so the strategy
   cannot be reviewed or improved.

**Product value:** AfterHours converts a noisy 24/7 price feed into a small number of
cost-and-factor-adjusted, risk-gated, auditable decisions — and, when nothing qualifies, it says so
plainly instead of manufacturing a trade.

### Part 3 · Validation data and key metrics

**Strategy/agent performance — observed, from real data.**

*Backtest (real, reproducible):* Bitget UTA v3 public daily candles for the 8 `R<SYM>USDT` pairs,
**2025-11-06 → 2026-10-06 (291 rToken days**) vs TwelveData US daily closes. Strategy mirrors
`fairvalue.js`; realised P&L uses the **actual next-day rToken move**, not the theoretical edge, minus
the 0.14 % round-trip cost. Code + report: `scripts/bitget-arb-backtest.py`, `docs/BITGET-BACKTEST.md`.

| Variant | Window | n | Return | Sharpe | Sortino | Max DD | Win rate | Turnover/yr |
|---|---|---|---|---|---|---|---|---|
| Closed-window (the thesis) | in-sample | 43 | −23.8 % | −1.20 | −1.04 | −43.3 % | 53.3 % | 440 |
| Closed-window | out-of-sample | 8 | +14.1 % | 9.29 | 9.45 | −4.5 % | 76.9 % | 410 |
| Closed-window | full | 51 | −13.1 % | **−0.31** | −0.27 | −43.3 % | 56.7 % | 445 |
| All days | full | 291 | −5.7 % | **0.11** | 0.11 | −41.8 % | 48.0 % | 449 |

**Observed result, stated plainly: the naive mean-reversion form of this signal does not produce
positive risk-adjusted returns after the 0.14 % cost model.** The positive out-of-sample numbers sit
on 8–30 observations, and OOS Sharpe is *larger* than IS — the signature of noise, not edge.
**Interpretation:** the rToken price appears to **lead** the frozen reference rather than lag it, so a
"discount vs the last US close" is often the market pricing an overnight move the underlying then
confirms — not a harvestable mispricing. We report this rather than hide it, and it is now the
pivot for the next iteration (below).

*Paper-trading log (observed):* **72 decisions, 43 acted / 29 refused**, 2026-10-06 → 2026-10-07,
paper account tracked from **$10,000 → $9,100** (fees + adverse fills on paper). Log:
`docs/paper-trading-log.csv` — every row carries timestamp, instrument, direction, price, quantity,
notional, net edge and the account balance after. Period is short (2 days) and is labelled as such.

*Live observation (observed):* at peak the engine tracked **8 rTokens → 8 signals → 4 candidates →
4 tradeable**, and during the closed window the top dislocation was **COIN: rToken $181.82 vs frozen
reference $185.75, raw −2.12 %, residual −2.08 %, costs −0.14 %, net +1.94 %, verdict BUY** — the
exact numbers shown in the demo video.

**Labels:** all backtest and paper figures above are **observed**. The following are **targeted**:
- Sharpe **> 0.5** and max DD **< 15 %** on a ≥60-day paper run after the lead-lag signal revision
  (use the rToken as the *leading* leg, trade in the direction the reference is about to move).
- ≥ **2 weeks** continuous paper trading before the next submission window (handbook minimum).
- **Targeted distribution:** 25 beta users / **$50k paper AUM** in month one; activation measured as
  % of sessions that open the opportunity review; retention as week-2 return rate. **Incremental fee**
  is modelled, not observed (0.10 % taker × turnover).

**How we will prove real usage:** the public endpoints (`/api/bitget/arbitrage`,
`/api/bitget/decisions`) make activation measurable from server-side hits; the ledger makes retention
and decision consistency measurable; paper AUM and turnover are already tracked per decision.

### Part 4 · Progress

**Built (working, live):**
- Bitget rToken adapter (public UTA v3 spot market, `R<SYM>USDT`, no key) — `src/adapters/bitget-r.js`
- Residual fair-value engine + cost model — `src/services/fairvalue.js`
- Arbitrage service + routes — `src/services/bitget-arb.js`; `GET /api/bitget/arbitrage`,
  `GET /api/bitget/decisions`, `POST /api/bitget/paper-act`
- Bitget page with the opportunity card, review sheet, live arbitrage surface and decision timeline —
  `public/bitget.html`
- Autonomous agent loop with rules engine, adversarial audit pass, Hermes fallback and NAV tracking —
  `src/services/sleep-agent.js`
- Auditable paper ledger (now with price/quantity/balance) + CSV export — `scripts/export-paper-log.py`
- Real-data backtest harness — `scripts/bitget-arb-backtest.py`
- 67 automated tests pass (`npm test`), 0 failures.

**Not built / honest gaps:** live Bitget order execution is deliberately **gated off** (paper only);
the cross-venue view is informational; the backtest is a daily-close proxy of an intraday engine
(no queue/liquidity model, `beta = 1.0` fallback); the paper window is 2 days, below the handbook's
2-week recommendation; Bitget Agent Hub / MCP wiring is **not** used yet.

**Problems hit and how we solved them:**
1. *rToken symbol discovery was inconsistent* → explicit symbol map + outlier flagging for implausible
   gaps (a mangled symbol used to produce a fake 30 % "opportunity").
2. *The reference looked "broken" (frozen)* → made the frozen state a first-class, explained UI state
   (`NYSE: CLOSED · reference frozen`) instead of a bug, which removed the phantom-arbitrage failure.
3. *A backtest that assumed "the gap always closes"* produced a flattering equity curve; replacing the
   theoretical edge with the **actual next-day move** turned the result negative. We kept the honest
   version — it is the finding that redirects the strategy.
4. *Fabricated-success risk on execution* → an earlier iteration recorded a fill that had not actually
   settled; fill recording is now gated on verified execution and failures surface openly as "BUY
   FAILED" rather than a phantom position.

**Next:** (a) rebuild the signal around the lead-lag finding — use the rToken as the *leading* leg;
(b) run a ≥2-week continuous paper period; (c) wire Bitget Agent Hub / Agentic account for a
`--paper-trading` execution path; (d) add rolling 30-day Sharpe stability to the report.

**Frameworks / models / APIs:** Node 22 (ESM, zero framework), Qwen **`qwen3.8-max`** (the agent's
decision model), a Hermes (Nous Research) agent as the compliant fallback, **Bitget UTA v3 public spot
market API** (`/api/v2/spot/market/tickers`, `/candles`), TwelveData (US reference).

### Part 5 · Your take on AI Trading *(optional)*

Building this changed what we expect from an "AI trading agent". The interesting output is not a
signal — it is a **refusal with a reason**. Two lessons:
1. **Most of the "alpha" in a 24/7 tokenized market is a data artefact.** Until you strip the market
   factor and subtract the real cost floor, you are measuring the tape, not an edge. Our own backtest
   is the proof: a strategy that looks obvious on a raw-gap screen has **negative** expectancy after
   costs, and the honest version of that test is more valuable than the flattering one.
2. **Agentic trading needs a veto, not just a model.** The architecture that we trust is
   propose → deterministic limits → independent audit → execute, with a non-LLM fallback. Put the LLM
   where judgement helps (ranking, explaining, deciding *whether* to act) and keep the hard limits in
   code. The `WAIT` state should be a first-class product feature, not an error.
   Direction of travel: agents that are judged on **decision consistency, risk-violation rate and
   incremental value over a fixed-rule baseline** — which is the benchmark we would now build for
   ourselves.

---

## ROLE OF THE LLM / AI IN YOUR PROJECT  *(separate required field)*

The LLM is the **decision-maker and orchestrator** of the trading loop, not a code assistant:
- **Agent decision-making (primary):** in Sleep Mode, **Qwen (`qwen3.8-max`)** receives the live
  dislocation set plus the rules context and returns a **structured, orders-only JSON** decision
  (which rToken to act on, direction, size), which the engine then validates. (`src/services/sleep-agent.js`)
- **Independent audit / self-check:** a second model pass reviews the proposed orders against the
  rules and can **veto** them before execution (an adversarial check, not a rubber stamp).
- **Resilience fallback:** if Qwen is unavailable, times out or returns non-compliant output, a
  **Hermes (Nous Research) agent** takes over the same contract, so the loop never fails silently.
- **Explanation generation:** the plain-English `Why?` line on every decision ("discount residual
  −2.08 % minus 0.14 % costs = 1.94 % net edge, above the 0.2 % threshold") is model-written from the
  computed numbers; the numbers themselves are deterministic.
- **Coding assistance:** the engine, adapters, routes and backtest harness were built with LLM coding
  agents (Qwen via the hackathon endpoint; general coding agents).

**Hard boundary:** the LLM never computes the edge and never sets the risk limits. Prices, the market
factor, costs, the min-net-edge gate and the position caps are deterministic code. The model decides
*what to do within those limits* and *how to explain it* — so a bad model call degrades quality, never
safety. We used Qwen credits during the hackathon for this agent loop and for development; the
structured orders-only contract with the `/no_think` path kept latency ≈5 s, which suited the loop.

---

## SUBMISSION MATERIAL LINKS  *(one per line)*

```
Project (live Demo, no login): https://afterhourequity.xyz/bitget
Demo video (96 s, real browser recording, no login): https://afterhourequity.xyz/demo/afterhours-bitget-demo.mp4
GitHub (public, README): https://github.com/norbert351/afterhours
Run records — paper-trading log (CSV: timestamp, instrument, direction, price, quantity, balance): https://github.com/norbert351/afterhours/blob/main/docs/paper-trading-log.csv
Run records — backtest report + method: https://github.com/norbert351/afterhours/blob/main/docs/BITGET-BACKTEST.md
Run records — backtest raw output (JSON): https://github.com/norbert351/afterhours/blob/main/docs/backtest-report.json
Run records — backtest code that generated the report: https://github.com/norbert351/afterhours/blob/main/scripts/bitget-arb-backtest.py
X post: <PASTE YOUR X POST URL HERE>
```

---

## X PROJECT POST URL
**<PASTE YOUR X POST URL>** — must contain `#BitgetHackathon` + `@Bitget_AI` and quote
https://x.com/Bitget_AI/status/2100519318824055159 , and introduce the product (not a bare repost).

## MATERIAL ADDITIONS SINCE S1
**N/A — this team did not participate in S1** (answer to "Did this team participate in S1?" = **No**).
Leave this field blank in the form.

---

## STILL GATED ON YOU
1. **X post URL** (required; must carry `#BitgetHackathon` + `@Bitget_AI` and quote the Bitget post).
   Draft copy is in `docs/X-POST-DRAFT.md`.
2. **University name** (optional) if you want the University pool.
3. Confirm the **track choice** (Agentic Trading · Open Theme) — if you prefer Alpha Factory, the only
   change is the sub-theme line and swapping Part 1's positioning; the backtest metrics above are the
   (negative) truth either way.
