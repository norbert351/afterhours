// fairvalue.js — AfterHours residual-dislocation model.
//
// CORE PRINCIPLE: not every positive gap is an arbitrage opportunity. When many
// tokenized equities are above a frozen NYSE reference at once, much of that is
// simply broad-market repricing the frozen reference hasn't seen yet. We separate
// the market-factor move from genuine RESIDUAL dislocation, subtract the cost of
// acting, and only then does the agent get permission to trade.
//
//   rawGapPct        = (onChainPrice − frozenReferencePrice) / frozenReferencePrice
//   marketMovePct    = the broad-market token's OWN raw gap (SPY / RSPYUSDT / SPYB)
//   beta(asset)      = sensitivity to the market factor
//   expectedMovePct  = beta * marketMovePct
//   residualGapPct   = rawGapPct − expectedMovePct
//   costPct          = fees + slippage + safety buffer
//   netEdgePct       = residualGapPct − costPct
//
// DECISION STATES: BUY · ROTATE · WAIT · BLOCKED · ERROR · EXECUTED
// BNB is SPOT-ONLY: a premium becomes ROTATE (reduce exposure / rotate into a
// cheaper eligible spot asset), a discount becomes BUY (increase exposure).
// We never express "short" / "hedge" / "leverage" as a BNB strategy.

// Cost model (per the brief's example — ~0.14%). Tunable; always reported.
export const COST_MODEL = { feePct: 0.10, slippagePct: 0.04, bufferPct: 0.0 };
export const DEFAULT_COST_PCT = COST_MODEL.feePct + COST_MODEL.slippagePct + COST_MODEL.bufferPct; // 0.14
export const DEFAULT_MIN_NET_EDGE_PCT = 0.20;

// ── ROTATE must be explicit (FROM → TO) ──────────────────────────────────────
// A "ROTATE" only makes sense if there is a real second leg. Pick the best
// DISCOUNT asset (raw gap < 0, best net edge) to rotate INTO. If none exists we
// NEVER invent a destination — the action becomes REDUCE EXPOSURE (or BUY).
export function rotationLeg(gaps, fromSymbol) {
  const pool = (gaps || []).filter((g) => g && !g.error && Number.isFinite(g.netEdgePct)
    && Number.isFinite(g.gapPct) && String(g.symbol).toUpperCase() !== String(fromSymbol || "").toUpperCase());
  const discounts = pool.filter((g) => g.gapPct < 0).sort((a, b) => b.netEdgePct - a.netEdgePct);
  const best = discounts.find((g) => g.netEdgePct > 0) || discounts[0] || null;
  return best ? { symbol: best.symbol, name: best.name || best.rSymbol || "", netEdgePct: best.netEdgePct, gapPct: best.gapPct } : null;
}

// Human action label from a row's decision + its (possibly null) rotation leg.
export function actionLabel({ decision, symbol, leg, amountUsd }) {
  const D = String(decision || "WAIT").toUpperCase();
  const amt = amountUsd ? ` ($${amountUsd})` : "";
  if (D === "ROTATE") {
    return leg && leg.symbol
      ? `ROTATE · Reduce ${symbol} → Increase ${leg.symbol}${amt}`
      : `REDUCE ${symbol} EXPOSURE${amt} · no valid second leg`;
  }
  if (D === "BUY") return `BUY ${symbol}${amt}`;
  if (D === "BLOCKED") return `BLOCKED · ${symbol} not executable`;
  return `WAIT · ${symbol}`;
}

// Mark rows with no edge so the UI can keep them out of the actionable feed.
export function annotateActions(gaps, { minNetEdgePct = DEFAULT_MIN_NET_EDGE_PCT } = {}) {
  const sorted = [...(gaps || [])];
  for (const g of sorted) {
    if (!g || g.error) continue;
    const ne = Number.isFinite(g.netEdgePct) ? g.netEdgePct : null;
    const raw = Number.isFinite(g.gapPct) ? g.gapPct : 0;
    g.hasEdge = ne != null && ne >= minNetEdgePct;
    g.noEdge = ne != null && !g.hasEdge && Math.abs(raw) < minNetEdgePct; // ~0 dislocation
    if (g.decision === "ROTATE") { const leg = rotationLeg(sorted, g.symbol); g.leg = leg; g.actionLabel = actionLabel({ decision: "ROTATE", symbol: g.symbol, leg }); }
    else g.actionLabel = actionLabel({ decision: g.decision, symbol: g.symbol });
  }
  return sorted;
}


// The market factor is the broad-market token's own raw gap. Any of these symbol
// shapes resolve to "the market": SPY, RSPYUSDT (Bitget rToken), SPYB (bStock), SPYx.
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

// Evaluate one gap → the full residual/net-edge/decision record.
export function evaluateGap({
  rawGapPct, marketMovePct, beta = 1,
  costPct = DEFAULT_COST_PCT, minNetEdgePct = DEFAULT_MIN_NET_EDGE_PCT,
  liquidityOk = true, stale = false,
} = {}) {
  const raw = Number(rawGapPct);
  const market = Number.isFinite(marketMovePct) ? Number(marketMovePct) : null;
  const expected = market == null ? null : beta * market;
  const residual = market == null ? null : raw - expected;
  const costs = Number.isFinite(costPct) ? Number(costPct) : DEFAULT_COST_PCT;
  const netEdge = residual == null ? null : residual - costs;

  let decision = "WAIT", reason;
  if (stale) { decision = "WAIT"; reason = "Reference/data is stale — refresh before acting."; }
  else if (!liquidityOk) { decision = "BLOCKED"; reason = "Liquidity/route check failed — not executable."; }
  else if (netEdge == null) { decision = "WAIT"; reason = "No market factor available to adjust for the broad-market move."; }
  else if (netEdge >= minNetEdgePct) {
    decision = residual > 0 ? "ROTATE" : "BUY";
    reason = `Residual ${residual.toFixed(2)}% − ${costs.toFixed(2)}% costs = ${netEdge.toFixed(2)}% net edge, above the ${minNetEdgePct}% threshold.`;
  } else if (netEdge > 0) {
    decision = "WAIT";
    reason = `Residual edge ${netEdge.toFixed(2)}% is below the ${minNetEdgePct}% threshold (costs ${costs.toFixed(2)}%).`;
  } else {
    decision = "WAIT";
    reason = `Residual edge does not exceed estimated execution costs (${costs.toFixed(2)}%).`;
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
    reason,
    liquidityOk,
    stale,
  };
}

// Annotate a whole gap list in place: computes the market factor once, then adds
// the residual/net-edge/decision fields to each tradeable row (and to error rows
// a WAIT/ERROR marker so the UI never blanks).
export function annotateGaps(gaps = [], { marketRe = MARKET_SYMBOL_RE, betaMap = {}, costPct = DEFAULT_COST_PCT, minNetEdgePct = DEFAULT_MIN_NET_EDGE_PCT, liquidityFn, staleness } = {}) {
  const marketMovePct = marketFactorMovePct(gaps, marketRe);
  for (const g of gaps) {
    if (!g) continue;
    if (g.error) { g.decision = "ERROR"; g.reason = g.error; continue; }
    const { beta, betaSource } = betaFor(g.symbol, betaMap);
    const liquidityOk = liquidityFn ? !!liquidityFn(g) : true;
    const stale = staleness ? !!staleness(g) : false;
    const ev = evaluateGap({ rawGapPct: g.gapPct, marketMovePct, beta, costPct, minNetEdgePct, liquidityOk, stale });
    Object.assign(g, ev, { betaSource });
  }
  return { marketMovePct, gaps };
}

// Sort helper: opportunities are ranked by NET EDGE, never by raw gap.
export function byNetEdgeDesc(a, b) {
  const av = Number.isFinite(a?.netEdgePct) ? a.netEdgePct : -Infinity;
  const bv = Number.isFinite(b?.netEdgePct) ? b.netEdgePct : -Infinity;
  return bv - av;
}

// A compact human summary of one evaluation (used in decision logs / receipts).
export function describe(asset, ev) {
  const pct = (n) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%`);
  return `${asset} raw ${pct(ev.rawGapPct)} · market ${pct(ev.marketMovePct)} · residual ${pct(ev.residualGapPct)} · costs −${pct(ev.costPct)} · NET ${pct(ev.netEdgePct)} → ${ev.decision}`;
}
