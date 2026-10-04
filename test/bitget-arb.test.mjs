import { test } from "node:test";
import assert from "node:assert";
import { bitgetPaperAction, listBitgetDecisions } from "../src/services/bitget-arb.js";

test("bitgetPaperAction: picks the top |gap| and the right side (premium→hedge, discount→buy)", () => {
  const before = listBitgetDecisions().length;
  const gaps = [
    { symbol: "MSTR", rSymbol: "RMSTRUSDT", gapPct: 2.02, outlier: false },
    { symbol: "TSLA", rSymbol: "RTSLAUSDT", gapPct: 0.41, outlier: false },
    { symbol: "AAPL", rSymbol: "RAAPLUSDT", gapPct: -0.8, outlier: false },
  ];
  const a = bitgetPaperAction({ gaps, amountUsd: 100 });
  assert.equal(a.acted, true);
  assert.equal(a.target, "MSTR"); // top |gap|
  assert.equal(a.side, "short/hedge"); // premium
  assert.equal(a.notionalUsd, 100);
  assert.equal(listBitgetDecisions().length, before + 1); // one new decision logged
});

test("bitgetPaperAction: no tradable gap → acted false, nothing logged", () => {
  const before = listBitgetDecisions().length;
  const a = bitgetPaperAction({ gaps: [] });
  assert.equal(a.acted, false);
  assert.equal(listBitgetDecisions().length, before); // unchanged
});