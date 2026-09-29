// AfterHours BNB port — pure gap logic + honesty guards (no network).
import { test } from "node:test";
import assert from "node:assert";
import { bnbGap } from "../src/adapters/bsc.js";

test("real price + reference -> a computed gap with correct sign/direction", async () => {
  const prices = { AAPLx: { symbol: "AAPLx", priceUsd: 210, mint: "0x…" } };
  const gaps = await bnbGap(prices, { AAPLx: 215 });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].gapPct, ((210 - 215) / 215) * 100); // discount (negative)
  assert.ok(gaps[0].gapPct < 0);
});

test("junk micro-cap price (~1e-6) is NEVER labeled as a real equity gap (honest guard)", async () => {
  const prices = { BSTOCKS: { symbol: "BSTOCKS", priceUsd: 0.000008955, mint: "0x…" } };
  const gaps = await bnbGap(prices, { BSTOCKS: 600 });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].error, /junk/);
  assert.equal(gaps[0].gapPct, undefined, "no fabricated equity gap from a junk pool price");
});

test("missing frozen reference -> honest 'no reference' error, never a fake gap", async () => {
  const prices = { ONDO: { symbol: "ONDO", priceUsd: 1.0, mint: "0x…" } };
  const gaps = await bnbGap(prices, {}); // no reference
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].error, /no frozen reference/);
});

test("no on-chain price -> honest error, no gap", async () => {
  const gaps = await bnbGap({ FOO: { symbol: "FOO", error: "RPC timeout" } }, {});
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].error, /RPC timeout/);
});

test("missing price object key is skipped safely", async () => {
  const gaps = await bnbGap(null, {});
  assert.deepEqual(gaps, []);
});