import { test } from "node:test";
import assert from "node:assert";
import { bitgetPaperAction, listBitgetDecisions } from "../src/services/bitget-arb.js";
import { evaluateGap, marketFactorMovePct, betaFor, rotationLeg, actionLabel, annotateActions } from "../src/services/fairvalue.js";

test("fairvalue: residual = raw − beta*market; net = residual − costs", () => {
  const ev = evaluateGap({ rawGapPct: 0.81, marketMovePct: 0.32, beta: 1, costPct: 0.14, minNetEdgePct: 0.2 });
  assert.ok(Math.abs(ev.residualGapPct - 0.49) < 1e-9, "residual 0.49");
  assert.ok(Math.abs(ev.netEdgePct - 0.35) < 1e-9, "net 0.35");
  assert.equal(ev.decision, "ROTATE"); // premium + edge above threshold → spot rotate
});

test("fairvalue: edge that does not survive costs → WAIT (never force a trade)", () => {
  const w = evaluateGap({ rawGapPct: 0.18, marketMovePct: 0.32, beta: 1, costPct: 0.14, minNetEdgePct: 0.2 });
  assert.equal(w.decision, "WAIT");
  assert.match(w.reason, /below|costs|threshold/i);
});

test("fairvalue: beta falls back to a LABELLED assumption, never a fake number", () => {
  assert.equal(betaFor("MSTR").beta, 1.0);
  assert.match(betaFor("MSTR").betaSource, /fallback/i);
  assert.equal(betaFor("MSTR", { MSTR: 1.4 }).betaSource, "estimated");
});

test("fairvalue: market factor is the broad-market token's own raw gap", () => {
  assert.equal(marketFactorMovePct([{ symbol: "MSTR", gapPct: 2 }, { symbol: "RSPYUSDT", gapPct: 0.32 }]), 0.32);
  assert.equal(marketFactorMovePct([{ symbol: "MSTR", gapPct: 2 }]), null);
});

test("bitgetPaperAction: picks the top NET EDGE (spot ROTATE on a premium with a real second leg)", () => {
  const before = listBitgetDecisions(1000).length;
  const gaps = [
    { symbol: "MSTR", rSymbol: "RMSTRUSDT", gapPct: 2.02, residualGapPct: 1.0, netEdgePct: 0.86, costPct: 0.14, decision: "ROTATE", outlier: false, verified: true, liquidityTier: "VERIFIED" },
    { symbol: "AAPL", rSymbol: "RAAPLUSDT", gapPct: -0.80, residualGapPct: -0.6, netEdgePct: 0.46, costPct: 0.14, decision: "BUY", outlier: false, verified: true, liquidityTier: "VERIFIED" },
    { symbol: "TSLA", rSymbol: "RTSLAUSDT", gapPct: 3.5, residualGapPct: 0.2, netEdgePct: 0.06, costPct: 0.14, decision: "WAIT", outlier: false },
  ];
  const a = bitgetPaperAction({ gaps, amountUsd: 100 });
  assert.equal(a.acted, true);
  assert.equal(a.target, "MSTR"); // top NET EDGE, not the 3.5% raw gap
  assert.equal(a.decision, "ROTATE"); // spot-only; never "short"
  assert.equal(a.to, "AAPL"); // the real discount second leg
  assert.equal(a.notionalUsd, 100);
  assert.equal(listBitgetDecisions(1000).length, before + 1);
});

// ── Brief §65: the state combinations that caused the observed contradictions ──
test("§65: premium + NO second leg is never ROTATE (it is WATCH, not executable)", () => {
  const gaps = annotateActions([
    { symbol: "ECOon", gapPct: 1.2, residualGapPct: 1.0, netEdgePct: 0.86, decision: "ROTATE", verified: true, liquidityTier: "VERIFIED" },
  ]);
  assert.notEqual(gaps[0].decision, "ROTATE"); // no discount leg → cannot be a rotation
  assert.equal(gaps[0].decision, "WATCH");
  assert.equal(gaps[0].actionable, false);
  assert.doesNotMatch(gaps[0].actionLabel, /ROTATE/); // the badge and label can never disagree
  assert.equal(gaps[0].positionAction, "REDUCE"); // a POSITION-aware surface may show REDUCE
});

test("§65: premium + position + no second leg may produce REDUCE EXPOSURE", () => {
  const g = { symbol: "ECOon", gapPct: 1.2, residualGapPct: 1.0, netEdgePct: 0.86, decision: "ROTATE", verified: true, liquidityTier: "VERIFIED" };
  annotateActions([g]);
  assert.match(g.reduceLabel, /REDUCE ECOon EXPOSURE/);
  assert.match(g.reduceLabel, /no valid second leg/);
});

test("§65: valid source + valid destination may produce ROTATE", () => {
  const gaps = annotateActions([
    { symbol: "MSTR", gapPct: 1.1, residualGapPct: 0.9, netEdgePct: 0.7, decision: "ROTATE", verified: true, liquidityTier: "VERIFIED" },
    { symbol: "AAPL", gapPct: -0.9, residualGapPct: -0.7, netEdgePct: 0.5, decision: "BUY", verified: true, liquidityTier: "VERIFIED" },
  ]);
  assert.equal(gaps.find((g) => g.symbol === "MSTR").decision, "ROTATE");
  assert.match(gaps.find((g) => g.symbol === "MSTR").actionLabel, /ROTATE · Reduce MSTR → Increase AAPL/);
});

test("§65: a discount is a BUY (net edge is |residual| - costs, not residual - costs)", () => {
  const ev = evaluateGap({ rawGapPct: -1.5, marketMovePct: 0, beta: 1, costPct: 0.14, minNetEdgePct: 0.2 });
  assert.ok(Math.abs(ev.netEdgePct - 1.36) < 1e-9, "a -1.5% dislocation clears costs with +1.36% net edge");
  assert.equal(ev.decision, "BUY");
  assert.equal(ev.premium, false);
});

test("§65: a large unverified gap does not surface as actionable", () => {
  const ev = evaluateGap({ rawGapPct: 6.2, marketMovePct: 0.17, beta: 1, costPct: 0.14, minNetEdgePct: 0.2, verifiedGap: false });
  assert.equal(ev.decision, "WAIT");
  assert.match(ev.reason, /verification/i);
});

test("§65: missing liquidity data must never read as GOOD", () => {
  const ev = evaluateGap({ rawGapPct: 1.0, marketMovePct: 0, beta: 1, liquidityTier: "UNVERIFIED" });
  assert.equal(ev.liquidityTier, "UNVERIFIED");
  assert.notEqual(ev.liquidityTier, "VERIFIED");
});

test("bitgetPaperAction: no residual edge above costs → WAIT logged (agent refuses)", () => {
  const before = listBitgetDecisions(1000).length;
  const a = bitgetPaperAction({ gaps: [{ symbol: "AAPL", rSymbol: "RAAPLUSDT", gapPct: 0.4, residualGapPct: 0.1, netEdgePct: -0.04, costPct: 0.14, decision: "WAIT", outlier: false }] });
  assert.equal(a.acted, false);
  assert.equal(a.decision, "WAIT");
  assert.equal(listBitgetDecisions(1000).length, before + 1); // the WAIT is logged, not a trade
});

test("bitgetPaperAction: no gaps → acted false, nothing logged", () => {
  const before = listBitgetDecisions(1000).length;
  const a = bitgetPaperAction({ gaps: [] });
  assert.equal(a.acted, false);
  assert.equal(listBitgetDecisions(1000).length, before);
});

// ── Brief §41: tests for the residual-model helpers (ROTATE leg / labels / no-edge) ──
test("fairvalue: rotationLeg picks the best DISCOUNT as the TO leg and never invents one", () => {
  const gaps = [
    { symbol: "MSTR", gapPct: 1.2, netEdgePct: 0.6 },
    { symbol: "AAPL", gapPct: -0.8, netEdgePct: 0.3 },
    { symbol: "NVDA", gapPct: -1.5, netEdgePct: 0.1 },
  ];
  assert.equal(rotationLeg(gaps, "MSTR").symbol, "AAPL"); // best net edge among discounts
  assert.equal(rotationLeg([{ symbol: "MSTR", gapPct: 1.2, netEdgePct: 0.6 }], "MSTR"), null); // nothing discount → no leg
});

test("fairvalue: actionLabel is explicit — ROTATE needs a real second leg", () => {
  assert.equal(actionLabel({ decision: "ROTATE", symbol: "MSTR", leg: { symbol: "AAPL" }, amountUsd: 100 }), "ROTATE · Reduce MSTR → Increase AAPL ($100)");
  assert.equal(actionLabel({ decision: "ROTATE", symbol: "MSTR", leg: null }), "REDUCE MSTR EXPOSURE · no valid second leg");
  assert.equal(actionLabel({ decision: "BUY", symbol: "AAPL" }), "BUY AAPL");
  assert.equal(actionLabel({ decision: "WAIT", symbol: "SPY" }), "WAIT · SPY");
});

test("fairvalue: annotateActions flags hasEdge/noEdge, keeps the leg, and never says short", () => {
  const gaps = annotateActions([
    { symbol: "MSTR", gapPct: 1.1, netEdgePct: 0.6, decision: "ROTATE" },
    { symbol: "AAPL", gapPct: -0.9, netEdgePct: 0.3, decision: "BUY" },
    { symbol: "TSLAB", gapPct: 0.01, netEdgePct: -0.13, decision: "WAIT" },
  ]);
  assert.equal(gaps[0].hasEdge, true);
  assert.equal(gaps[2].noEdge, true); // ~zero raw dislocation → kept out of the actionable feed
  assert.match(gaps[0].actionLabel, /ROTATE · Reduce MSTR → Increase AAPL/); // AAPL is the discount leg
  assert.ok(!/short|hedge|perp|leverage/i.test(gaps.map((g) => g.actionLabel).join(" ")), "BNB/spot copy must never imply a derivative");
});
