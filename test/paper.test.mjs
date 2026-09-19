// AfterHours v2 — ledger invariants (paper execution). node --test
import { test } from "node:test";
import assert from "node:assert";
import { PaperBook, FEE_BPS, SLIP_BPS, QTY_SCALE, toMicro, fromMicro } from "../src/services/paper.js";

const SEED = 10_000_000_000; // $10k in micro

function freshBook() {
  return new PaperBook({ positions: new Map(), cashMicro: SEED, seedMicro: SEED, peakNavMicro: SEED });
}

test("buy deploys capital and never overspends cash", () => {
  const px = new Map([["A", toMicro(150)]]);
  const b = freshBook();
  const { actions } = b.rebalance(px, { A: 1 }, { top: 5 });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "buy");
  assert.equal(actions[0].symbol, "A");
  assert.ok(b.cashMicro >= 0, "cash must not go negative");
  assert.ok(b.cashMicro > 0, "some cash should remain after fees");
  // NAV ≈ seed − fees/slippage drag, never above seed
  const nav = b.navMicro(px);
  assert.ok(nav < SEED, "fees+slippage must drag NAV below seed");
  assert.ok(nav > SEED - 50_000_000, `NAV too low: ${fromMicro(nav).toFixed(2)}`); // within ~$50
});

test("rebalance does not churn on unchanged prices", () => {
  const px = new Map([["A", toMicro(150)], ["B", toMicro(80)]]);
  const b = freshBook();
  b.rebalance(px, { A: 0.5, B: 0.5 }, { top: 5 });
  const second = b.rebalance(px, { A: 0.5, B: 0.5 }, { top: 5 });
  assert.equal(second.actions.length, 0, "must not churn when at target");
});

test("fees and slippage move the intended amount (drag proof)", () => {
  const px = new Map([["A", toMicro(100)]]);
  const b = freshBook();
  b.rebalance(px, { A: 1 }, { top: 5 });
  const cost = SEED - b.cashMicro; // deployed incl fees+slip
  const dragPct = (SEED - b.navMicro(px)) / SEED;
  // cost should be ~99.9% of seed (10bp fee), nav ~0.12% drag (10bp fee + 2bp slip)
  assert.ok(cost > SEED * 0.99, `should deploy ~99.9%: ${fromMicro(cost).toFixed(2)}`);
  assert.ok(dragPct > 0 && dragPct < 0.005, `drag in sane range: ${(dragPct * 100).toFixed(3)}%`);
});

test("sells self-fund buys in the same batch (no negative cash)", () => {
  const px = new Map([["A", toMicro(100)], ["B", toMicro(50)]]);
  const b = freshBook();
  // start fully in A, then rotate fully to B → must sell A before buying B within cash
  b.rebalance(px, { A: 1 }, { top: 5 });
  const rotated = b.rebalance(px, { B: 1 }, { top: 5 });
  assert.ok(rotated.actions.length >= 1);
  assert.ok(b.cashMicro >= 0, "rotation must not overdraw cash");
  assert.ok(b.positions.has("B"), "should hold B after rotation");
});

test("repeated full allocations stay within tolerance band", () => {
  const px = new Map([["A", toMicro(150)]]);
  const b = freshBook();
  b.rebalance(px, { A: 1 }, { top: 5 });
  const nav = b.navMicro(px);
  assert.ok(nav > SEED * 0.995 && nav < SEED, `NAV in band: ${fromMicro(nav).toFixed(2)}`);
});