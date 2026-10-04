// AfterHours BNB port — pure gap logic + honesty guards (no network).
import { test } from "node:test";
import assert from "node:assert";
import { bnbGap, bnbEquityGaps } from "../src/adapters/bsc.js";

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

// ---- real RWA-shape gap engine (bnbEquityGaps) ----
const rwa = (symbol, price, ref, mint, extra = {}) => ({
  tokenContractAddress: mint, platformId: "bstock", tokenSymbol: symbol,
  tokenName: symbol, underlyingTicker: symbol, decimals: "18",
  tokenPrice: String(price), referencePrice: String(ref),
  statusInfo: { openState: true }, ...extra,
});

test("bnbEquityGaps: clean weekend gap computed (on-chain vs reference)", () => {
  const { gaps, flagged } = bnbEquityGaps([
    rwa("IBMB", 224.68, 223.56, "0x1"),
    rwa("QCOMB", 187.17, 186.46, "0x2"),
  ]);
  assert.equal(gaps.length, 2);
  assert.equal(flagged.length, 0);
  assert.ok(gaps[0].gapPct > 0 && gaps[0].gapPct < 1); // +0.5% plausible
  assert.equal(gaps[0].onChainPriceUsd, 224.68);
  // sorted expectation done in service, engine keeps order
});

test("bnbEquityGaps: DEDUPS by contract address", () => {
  const dup = [
    rwa("KLAon", 20801, 2074, "0xAA"),
    rwa("KLAon", 20801, 2074, "0xAA"), // same mint
    rwa("IBMB", 224, 223, "0x1"),
  ];
  const { gaps, flagged } = bnbEquityGaps(dup);
  const total = gaps.length + flagged.length;
  assert.equal(total, 2, "duplicate contract appears once");
});

test("bnbEquityGaps: implausible (>10% from ref) is FLAGGED, not reported as a real gap", () => {
  const { gaps, flagged } = bnbEquityGaps([
    rwa("KLAon", 20801, 2074, "0xAA"),   // +902% wrapper/denomination artifact
    rwa("IBMB", 224, 223, "0x1"),
  ]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].symbol, "IBMB");
  assert.equal(flagged.length, 1);
  assert.ok(flagged[0].outlier && flagged[0].note);
  assert.match(flagged[0].note, /implausible/);
});

test("bnbEquityGaps: missing/zero price is an honest error row, never a fake gap", () => {
  const { gaps } = bnbEquityGaps([
    { tokenContractAddress: "0x0", platformId: "bstock", tokenSymbol: "X",
      tokenPrice: null, referencePrice: "10" },
  ]);
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].error.length > 0);
  assert.equal(gaps[0].gapPct, undefined);
});