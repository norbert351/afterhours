// PreStocks Desk — metric math, rule parsing/eval, snapshots, hold-sim.
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { openStore, insertPrestocksRule } from "../src/store.js";
import * as desk from "../src/services/prestocks-desk.js";

const FIXTURE = [
  { symbol: "NEURALINK", name: "Neuralink", markPrice: 336.72139513, tokenPrice: 435.3809836667006, markValuation: 64143758835, impliedValuation: 82937922037, supply: 2595.331259192, contract_address: "PrekqLJvJ3" },
  { symbol: "SPACEX", name: "SpaceX", markPrice: 153.93183548148136, tokenPrice: 120.69263085115006, markValuation: 2018217398535, impliedValuation: 1582414493382, supply: 43712.533765345, contract_address: "PreANxuXjs" },
  { symbol: "OPENAI", name: "OpenAI", markPrice: 994.6898225847226, tokenPrice: 1127.3132532599948, markValuation: 1232351358161, impliedValuation: 1396662544629, supply: 2826.4371719845008, contract_address: "PreweJYECq" },
  { symbol: "ANTHROPIC", name: "Anthropic", markPrice: 1045.55745778, tokenPrice: 1048.19672744536, markValuation: 1712981013493, impliedValuation: 1717305040636, supply: 7381.872216546, contract_address: "Pren1FvFX6" },
  { symbol: "ANDURIL", name: "Anduril", markPrice: 154.7432459, tokenPrice: 157.06999763419643, markValuation: 136901203769, impliedValuation: 138959678835, supply: 11805.845472761, contract_address: "PresTj4Yc2" },
  { symbol: "FIGUREAI", name: "Figure AI", markPrice: 181.15175156, tokenPrice: 181.77502801097742, markValuation: 39495970047, impliedValuation: 39631861132, supply: 3012.891093355, contract_address: "PreZad18qf" },
  { symbol: "KALSHI", name: "Kalshi", markPrice: 895.6235712, tokenPrice: 886.2979937170022, markValuation: 32575668033, impliedValuation: 32236477634, supply: 904.895471232, contract_address: "PreLWGkkeq" },
  { symbol: "POLYMARKET", name: "Polymarket", markPrice: 143.96433995, tokenPrice: 145.3426422918097, markValuation: 14198592939, impliedValuation: 14334529060, supply: 4817.026827431, contract_address: "Pre8AREmFP" },
];

beforeEach(() => {
  globalThis.fetch = async () => ({ ok: true, json: async () => FIXTURE });
});

test("desk math: premium/discount computed and sorted by |premium|", async () => {
  const db = openStore(":memory:");
  const d = await desk.buildDesk(db);
  assert.equal(d.count, 8);
  assert.equal(d.tokens[0].symbol, "NEURALINK"); // +29.3% — biggest
  assert.ok(d.tokens[0].premiumPct > 29 && d.tokens[0].premiumPct < 30);
  const spx = d.tokens.find((t) => t.symbol === "SPACEX");
  assert.ok(spx.premiumPct < -21 && spx.premiumPct > -22, "SPACEX discount ≈ −21.6%");
  assert.equal(spx.deltaMark, null, "no previous snapshot yet → no delta");
});

test("rule parsing: symbol, direction, threshold, largest", () => {
  const r1 = desk.parsePrestocksRule("NEURALINK trades more than 10% above its mark price");
  assert.equal(r1.symbol, "NEURALINK"); assert.equal(r1.direction, "above"); assert.equal(r1.thresholdPct, 10);
  const r2 = desk.parsePrestocksRule("spacex trades below its mark price");
  assert.equal(r2.symbol, "SPACEX"); assert.equal(r2.direction, "below"); assert.equal(r2.thresholdPct, 2); // default
  const r3 = desk.parsePrestocksRule("flag the biggest dislocation in pre-IPO tokens");
  assert.equal(r3.type, "largest");
});

test("rules evaluate against the live desk and fire only on real matches", async () => {
  const db = openStore(":memory:");
  const d = await desk.buildDesk(db);
  const bad = "NEURALINK trades more than 10% above its mark price";
  const disc = "SPACEX trades below its mark price";
  const miss = "KALSHI trades more than 50% above its mark price";
  for (const t of [bad, disc, miss]) insertPrestocksRule(db, t);
  const ev = desk.evaluatePrestocksRules(db, d);
  const fired = ev.fired.filter((f) => f.result === "fired");
  assert.equal(fired.length, 2, "NEURALINK + SPACEX fire; KALSHI does not");
  const ne = fired.find((f) => f.rule.text === bad);
  assert.equal(ne.matches[0].symbol, "NEURALINK");
});

test("snapshots: append 8, dedupe within 60s, history readable", async () => {
  const db = openStore(":memory:");
  const a1 = await desk.appendSnapshot(db, 1_000_000);
  assert.equal(a1.appended, 8);
  const a2 = await desk.appendSnapshot(db, 1_000_500); // <60s later
  assert.deepEqual(a2.skipped, "too soon");
  const h = desk.deskHistory(db, "SPACEX", 10);
  assert.equal(h.length, 1);
  assert.equal(h[0].markPrice, 153.93183548148136);
  // a snapshot at t+2min produces a delta for the next desk build
  await desk.appendSnapshot(db, 1_000_000 + 120_000);
  const d = await desk.buildDesk(db);
  const spx = d.tokens.find((t) => t.symbol === "SPACEX");
  assert.equal(spx.deltaToken, 0, "prices unchanged → 0% delta");
});

test("hold-sim: honest scenario projections on real prices", () => {
  const s = desk.holdSim({ symbol: "OPENAI", qty: 10, tokenPrice: 1127.31, markPrice: 994.69, markValuation: 1232351358161, impliedValuation: 1396662544629, supply: 2826.437 });
  assert.equal(s.qty, 10);
  assert.ok(Math.abs(s.entryUsd - 11273.1) < 0.01);
  assert.ok(s.scenarios.length >= 5, "scenario set incl. flat + valuation opinions");
  const flat = s.scenarios.find((x) => x.label.includes("flat"));
  assert.equal(flat.movePct, 0);
  assert.match(s.honest, /not a promise/);
  // the discount scenario must be negative when mark < token
  const close = s.scenarios.find((x) => x.label.includes("token converges to mark"));
  assert.ok(close.movePct < -10, "premium close = downside when trading above mark");
});