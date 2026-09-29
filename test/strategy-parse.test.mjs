// AfterHours v2 — natural-language strategy instruction → params.
// Verifies the user's words become LOAD-BEARING engine params (not decorative).
import { test } from "node:test";
import assert from "node:assert";
import { parseStrategyInstruction } from "../src/services/strategy-parse.js";

test("default: rotate to discounted tokenized equities → discount, any symbol", () => {
  const r = parseStrategyInstruction("rotate to discounted tokenized equities");
  assert.equal(r.params.direction, "discount");
  assert.equal(r.params.symbols, undefined);
  assert.equal(r.parsed.hasSymbols, false);
});

test("direction: 'premium' / 'above mark' switches to buy-the-premium", () => {
  const r = parseStrategyInstruction("buy AAPL on premium above mark");
  assert.equal(r.params.direction, "premium");
  assert.ok(r.params.symbols.includes("AAPL"));
});

test("threshold: 'under 10%' / '>10%' sets minGapPct", () => {
  const r1 = parseStrategyInstruction("buy SPACEX and OPENAI under 10% over mark");
  assert.equal(r1.params.minGapPct, 10);
  assert.ok(r1.params.symbols.includes("SPACEX"));
  assert.ok(r1.params.symbols.includes("OPENAI"));
});

test("top N: 'top 3 biggest discounts' caps holdings at 3", () => {
  const r = parseStrategyInstruction("top 3 biggest discounts above 5%");
  assert.equal(r.params.topN, 3);
  assert.equal(r.params.minGapPct, 5);
});

test("xStocks alias: 'AAPL' resolves even though the token symbol is AAPLx", () => {
  const r = parseStrategyInstruction("buy AAPL below mark");
  assert.ok(r.params.symbols.includes("AAPL"), `got: ${r.params.symbols}`);
});

test("summary is human-readable for the UI echo", () => {
  const r = parseStrategyInstruction("buy SPACEX and OPENAI under 10% over mark");
  assert.match(r.parsed.summary, /OPENAI/);
  assert.match(r.parsed.summary, /SPACEX/);
  assert.match(r.parsed.summary, /≥10%/);
});