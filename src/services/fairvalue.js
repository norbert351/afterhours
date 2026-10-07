// fairvalue.js — AfterHours residual-dislocation model.
//
// CORE PRINCIPLE: not every positive gap is an arbitrage opportunity. When many
// tokenized equities are above a frozen NYSE reference at once, much of that is
// simply broad-market repricing the frozen reference hasn't seen yet. We separate
// the market-factor move from genuine RESIDUAL dislocation, subtract the cost of
// acting, and only then does the agent get permission to trade.
//
//   rawGapPct        = (onChainPrice - frozenReferencePrice) / frozenReferencePrice
//   marketMovePct    = the broad-market token's OWN raw gap (SPY / RSPYUSDT / SPYB)
//   beta(asset)      = sensitivity to the market factor
//   expectedMovePct  = beta * marketMovePct
//   residualGapPct   = rawGapPct - expectedMovePct
//   costPct          = fees + slippage + safety buffer
//   netEdgePct       = residualGapPct - costPct
//
// CONTROLLED DECISION VOCABULARY (the UI must never contradict itself):
//   BUY      discount + edge + verified, no relevant position held
//   ROTATE   premium + edge, WITH a real second leg (a discount asset to rotate into)
//   REDUCE   premium + edge, a position IS held, but no valid second leg exists
//   WATCH    interesting but not currently executable (premium, no destination leg,
//            or a large gap that still needs verification)
//   WAIT     evaluated, conditions do not justify action (edge below threshold /
//            below costs) — the reason string is always surfaced
//   BLOCKED  liquidity / route check failed
//   ERROR    a data error on the row
// BNB is SPOT-ONLY: a premium becomes ROTATE or REDUCE, a discount becomes BUY.
// We never express "short" / "hedge" / "leverage" as a BNB strategy.

// Cost model (per the brief's example, ~0.14%). Tunable; always reported.
export const COST_MODEL = { feePct: 0.10, slippagePct: 0.04, bufferPct: 0.0 };
export const DEFAULT_COST_PCT = COST_MODEL.feePct + COST_MODEL.slippagePct + COST_MODEL.bufferPct; // 0.14
export const DEFAULT_MIN_NET_EDGE_PCT = 0.20;

// A raw gap bigger than this is not automatically an "opportunity" — it needs
// verification before it is ranked actionable. Small residual dislocations are the
// believable ones; a large raw gap is more often a stale reference or a wrapper /
// denomination artifact (see bnbEquityGaps). We never hide it, we downgrade it.
export const LARGE_GAP_PCT = 3.0;

// Liquidity tiers (the UI must never say "GOOD" just because the backend defaulted).
export const LIQUIDITY = { VERIFIED: "VERIFIED", LIMITED: "LIMITED", UNVERIFIED: "UNVERIFIED", INSUFFICIENT: "INSUFFICIENT" };

// ── ROTATE must be explicit (FROM -> TO) ─────────────────────────────────────
// A "ROTATE" only makes sense if there is a real second leg. Pick the best
// DISCOUNT asset (raw gap < 0, best net edge) to rotate INTO. If none exists we
// NEVER invent a destination — the action becomes WATCH (no position known) or
// REDUCE EXPOSURE (a position is held).
export function rotationLeg(gaps, fromSymbol) {
  const pool = (gaps || []).filter((g) => g && !g.error && Number.isFinite(g.netEdgePct)
    && Number.isFinite(g.gapPct) && String(g.symbol).toUpperCase() !== String(fromSymbol || "").toUpperCase());
  const discounts = pool.filter((g) => g.gapPct < 0 && !g.outlier).sort((a, b) => b.netEdgePct - a.netEdgePct);
  const best = discounts.find((g) => g.netEdgePct > 0) || null;
  return best ? { symbol: best.symbol, name: best.name || best.rSymbol || "", netEdgePct: best.netEdgePct, gapPct: best.gapPct } : null;
}

// Human action label from a decision + an optional rotation leg. ONE vocabulary.
export function actionLabel({ decision, symbol, leg, amountUsd }) {
  const D = String(decision || "WAIT").toUpperCase();
  const amt = amountUsd ? ` ($${amountUsd})` : "";
  if (D === "ROTATE") {
    return leg && leg.symbol
      ? `ROTATE · Reduce ${symbol} → Increase ${leg.symbol}${amt}`
      : `REDUCE ${symbol} EXPOSURE${amt} · no valid second leg`;
  }
  if (D === "REDUCE") return `REDUCE ${symbol} EXPOSURE${amt} · no valid second leg`;
  if (D === "WATCH") return `WATCH ${symbol}${amt} · not executable yet`;
  if (D === "BUY") return `BUY ${symbol}${amt}`;
  if (D === "BLOCKED") return `BLOCKED · ${symbol} not executable`;
  return `WAIT · ${symbol}`;
}

// The set of verdicts that are genuinely actionable this second.
export const ACTIONABLE_DECISIONS = new Set(["BUY", "ROTATE"]);

// Is a row genuinely actionable for a position-less spot view? A discount is a BUY;
// a premium is a ROTATE only if a real discount leg exists. A premium with no
// destination leg is a WATCH (interesting, not executable) and never acts.
export function isActionableRow(g, pool) {
  if (!g || g.error || g.outlier) return false;
  if (g.actionable === true) return true;
  if (!Number.isFinite(g.netEdgePct)) return false;
  if (g.verified === false) return false;
  if (g.liquidityTier === LIQUIDITY.INSUFFICIENT) return false;
  const dec = String(g.decision || "").toUpperCase();
  if (dec === "BUY") return true;
  if (dec === "ROTATE") return !!rotationLeg(pool, g.symbol);
  return false;
}

// Mark rows with no edge so the UI can keep them out of the actionable feed, and
// finalize each row's decision so a premium with no second leg can never be shown
// as ROTATE. We never present a ROTATE badge beside a "no valid second leg" label.
export function annotateActions(gaps, { minNetEdgePct = DEFAULT_MIN_NET_EDGE_PCT } = {}) {
  const sorted = [...(gaps || [])];
  for (const g of sorted) {
    if (!g || g.error) continue;
    const ne = Number.isFinite(g.netEdgePct) ? g.netEdgePct : null;
    const raw = Number.isFinite(g.gapPct) ? g.gapPct : 0;
    const liquid = g.liquidityTier || (g.liquidityOk === false ? LIQUIDITY.INSUFFICIENT : LIQUIDITY.VERIFIED);
    g.liquidityTier = liquid;
    g.liquidityOk = liquid !== LIQUIDITY.INSUFFICIENT;
    g.hasEdge = ne != null && ne >= minNetEdgePct && g.liquidityOk && g.verified !== false;
    g.noEdge = ne != null && Number.isFinite(ne) && !g.hasEdge && Math.abs(raw) < minNetEdgePct;
    g.premium = Number.isFinite(g.residualGapPct) ? g.residualGapPct > 0 : raw > 0;
    if (g.decision === "ROTATE" || g.decision === "BUY") {
      if (g.decision === "ROTATE") {
        const leg = rotationLeg(sorted, g.symbol);
        g.leg = leg;
        if (leg && leg.symbol && g.hasEdge) { g.actionLabel = actionLabel({ decision: "ROTATE", symbol: g.symbol, leg }); }
        else {
          // premium with edge but no destination leg. For a position-less view that
          // is a WATCH; a position-aware surface may render positionAction (REDUCE).
          g.decision = g.hasEdge ? "WATCH" : "WAIT";
          g.positionAction = "REDUCE";
          g.actionLabel = actionLabel({ decision: g.decision, symbol: g.symbol });
          g.reduceLabel = actionLabel({ decision: "REDUCE", symbol: g.symbol });
        }
      } else if (!g.hasEdge) {
        g.decision = "WAIT";
        g.actionLabel = actionLabel({ decision: "WAIT", symbol: g.symbol });
      } else {
        g.actionLabel = actionLabel({ decision: "BUY", symbol: g.symbol });
      }
    } else {
      g.actionLabel = actionLabel({ decision: g.decision, symbol: g.symbol });
    }
    g.actionable = ACTIONABLE_DECISIONS.has(g.decision) && g.hasEdge;
  }
  return sorted;
}


// The market factor is the broad-market token's own raw gap. Any of these symbol
// shapes resolve to "the market": SPY, RSPYUSDT (Bitget rToken), SPYB (bStocks), SPYx.
export const MARKET_SYMBOL_RE = /^(R?SPY(USDT)?|SPYB|SPYx)$/i;

export function marketFactorMovePct(gaps = [], marketRe = MARKET_SYMBOL_RE) {
  const g = (gaps || []).find((x) => x && !x.error && !x.outlier && Number.isFinite(x.gapPct) && marketRe.test(String(x.symbol || "")));
  return g ? Number(g.gapPct) : null;
}

// Beta: use a real estimate when available; otherwise a CLEARLY LABELLED fallback.
// We never hardcode fake betas — an absent beta is reported as an assumption.
export function betaFor(symbol, betaMap = {}) {
  const b = betaMap[String(symbol || "").toUpperCase()];
  if (Number.isFinite(b)) return { beta: b, betaSource: "estimated" };
  return { beta: 1.0, betaSource: "fallback: beta=1 (market-neutral assumption; no beta history)" };
}

// Evaluate one gap -> the full residual/net-edge/decision record. `marketMovePct`
// may be null when no broad-market factor is available: then the fair-value
// adjustment is UNAVAILABLE (we never fabricate residual precision) and the row
// cannot be more than a WAIT.
export function evaluateGap({
  rawGapPct, marketMovePct, beta = 1,
  costPct = DEFAULT_COST_PCT, minNetEdgePct = DEFAULT_MIN_NET_EDGE_PCT,
  liquidityOk = true, liquidityTier = null, verifiedGap = true, stale = false,
} = {}) {
  const raw = Number(rawGapPct);
  const market = Number.isFinite(marketMovePct) ? Number(marketMovePct) : null;
  const expected = market == null ? null : beta * market;
  const residual = market == null ? null : raw - expected;
  const costs = Number.isFinite(costPct) ? Number(costPct) : DEFAULT_COST_PCT;
  // The edge is the SIZE of the residual dislocation minus the cost of acting, in
  // EITHER direction: a premium is sold (ROTATE/REDUCE) and a discount is bought
  // (BUY). So netEdge = |residual| - costs, and the sign of the residual only sets
  // the direction. (Charging costs against a negative residual would score every
  // buyable discount as worse for being bigger, which is backwards.)
  const netEdge = residual == null ? null : Math.abs(residual) - costs;
  const tier = liquidityTier || (liquidityOk ? LIQUIDITY.VERIFIED : LIQUIDITY.INSUFFICIENT);

  let decision = "WAIT", reason;
  if (stale) { decision = "WAIT"; reason = "Reference price is stale. Refresh before acting."; }
  else if (tier === LIQUIDITY.INSUFFICIENT) { decision = "BLOCKED"; reason = "Liquidity is insufficient for the selected amount. Not executable."; }
  else if (netEdge == null) { decision = "WAIT"; reason = "Fair value adjustment unavailable: no broad-market factor to adjust for the market move."; }
  else if (verifiedGap === false) { decision = "WAIT"; reason = `Large gap (${raw.toFixed(2)}%) needs verification before it can be treated as an opportunity.`; }
  else if (netEdge >= minNetEdgePct) {
    decision = residual > 0 ? "ROTATE" : "BUY";
    reason = residual > 0
      ? `Premium residual ${residual.toFixed(2)}% minus ${costs.toFixed(2)}% costs = ${netEdge.toFixed(2)}% net edge, above the ${minNetEdgePct}% threshold.`
      : `Discount residual ${residual.toFixed(2)}% minus ${costs.toFixed(2)}% costs = ${netEdge.toFixed(2)}% net edge, above the ${minNetEdgePct}% threshold.`;
  } else if (netEdge > 0) {
    decision = "WAIT";
    reason = `Net edge ${netEdge.toFixed(2)}% is below the ${minNetEdgePct}% threshold (costs ${costs.toFixed(2)}%).`;
  } else {
    decision = "WAIT";
    reason = `Dislocation does not exceed estimated execution costs (${costs.toFixed(2)}%).`;
  }

  return {
    rawGapPct: raw,
    marketMovePct: market,
    beta,
    expectedMovePct: expected,
    residualGapPct: residual,
    costPct: costs,
    netEdgePct: netEdge,
    minNetEdgePct,
    decision,
    premium: residual == null ? null : residual > 0,
    reason,
    liquidityOk: tier !== LIQUIDITY.INSUFFICIENT,
    liquidityTier: tier,
    verified: verifiedGap !== false,
    stale,
  };
}

// Annotate a whole gap list in place: computes the market factor once, then adds
// the residual/net-edge/decision fields to each tradeable row (and to error rows
// a WAIT/ERROR marker so the UI never blanks).
export function annotateGaps(gaps = [], { marketRe = MARKET_SYMBOL_RE, betaMap = {}, costPct = DEFAULT_COST_PCT, minNetEdgePct = DEFAULT_MIN_NET_EDGE_PCT, liquidityFn, staleness, plausibilityFn } = {}) {
  const marketMovePct = marketFactorMovePct(gaps, marketRe);
  const marketAvailable = marketMovePct != null;
  for (const g of gaps) {
    if (!g) continue;
    if (g.error) { g.decision = "ERROR"; g.reason = g.error; continue; }
    const { beta, betaSource } = betaFor(g.symbol, betaMap);
    const liquidityTier = liquidityFn ? liquidityFn(g) : (g.liquidityOk === false ? LIQUIDITY.INSUFFICIENT : LIQUIDITY.VERIFIED);
    const liquidityOk = liquidityTier !== LIQUIDITY.INSUFFICIENT;
    const stale = staleness ? !!staleness(g) : false;
    // A large raw gap must be explicitly verified (plausibilityFn) or it stays a
    // WATCH; a row with no market factor cannot claim a residual net edge.
    const verifiedGap = plausibilityFn ? !!plausibilityFn(g) : !(Number.isFinite(g.gapPct) && Math.abs(g.gapPct) > LARGE_GAP_PCT);
    const ev = evaluateGap({ rawGapPct: g.gapPct, marketMovePct, beta, costPct, minNetEdgePct, liquidityOk, liquidityTier, verifiedGap, stale });
    Object.assign(g, ev, { betaSource, marketFactorAvailable: marketAvailable });
  }
  return { marketMovePct, marketAvailable, gaps };
}

// Sort helper: opportunities are ranked by NET EDGE, never by raw gap. Rows with
// no usable edge sink; verified, liquid rows float.
export function byNetEdgeDesc(a, b) {
  const score = (x) => {
    if (!x) return -Infinity;
    if (x.verified === false) return -Infinity;              // unverified large gaps never lead
    if (x.liquidityTier === LIQUIDITY.INSUFFICIENT) return -1e9;
    return Number.isFinite(x.netEdgePct) ? x.netEdgePct : -Infinity;
  };
  return score(b) - score(a);
}

// A compact human summary of one evaluation (used in decision logs / receipts).
export function describe(asset, ev) {
  const pct = (n) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`);
  return `${asset} raw ${pct(ev.rawGapPct)} · market ${pct(ev.marketMovePct)} · residual ${pct(ev.residualGapPct)} · costs ${pct(ev.costPct)} · NET ${pct(ev.netEdgePct)} -> ${ev.decision}`;
}
