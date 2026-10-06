import { test } from "node:test";
import assert from "node:assert";
import { bitgetPaperAction, listBitgetDecisions } from "../src/services/bitget-arb.js";
import { evaluateGap, marketFactorMovePct, betaFor } from "../src/services/fairvalue.js";

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

test("bitgetPaperAction: picks the top NET EDGE (spot ROTATE on a premium), not the top raw gap", () => {
  const before = listBitgetDecisions().length;
  const gaps = [
    { symbol: "MSTR", rSymbol: "RMSTRUSDT", gapPct: 2.02, residualGapPct: 1.0, netEdgePct: 0.86, costPct: 0.14, decision: "ROTATE", outlier: false },
    { symbol: "TSLA", rSymbol: "RTSLAUSDT", gapPct: 3.5, residualGapPct: 0.2, netEdgePct: 0.06, costPct: 0.14, decision: "WAIT", outlier: false },
  ];
  const a = bitgetPaperAction({ gaps, amountUsd: 100 });
  assert.equal(a.acted, true);
  assert.equal(a.target, "MSTR"); // top NET EDGE, not the 3.5% raw gap
  assert.equal(a.decision, "ROTATE"); // spot-only; never "short"
  assert.equal(a.notionalUsd, 100);
  assert.equal(listBitgetDecisions().length, before + 1);
});

test("bitgetPaperAction: no residual edge above costs → WAIT logged (agent refuses)", () => {
  const before = listBitgetDecisions().length;
  const a = bitgetPaperAction({ gaps: [{ symbol: "AAPL", rSymbol: "RAAPLUSDT", gapPct: 0.4, residualGapPct: 0.1, netEdgePct: -0.04, costPct: 0.14, decision: "WAIT", outlier: false }] });
  assert.equal(a.acted, false);
  assert.equal(a.decision, "WAIT");
  assert.equal(listBitgetDecisions().length, before + 1); // the WAIT is logged, not a trade
});

test("bitgetPaperAction: no gaps → acted false, nothing logged", () => {
  const before = listBitgetDecisions().length;
  const a = bitgetPaperAction({ gaps: [] });
  assert.equal(a.acted, false);
  assert.equal(listBitgetDecisions().length, before);
});
