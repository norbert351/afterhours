// AfterHours v4 — multi-tenant isolation: user A's book never leaks to user B.
import { test } from "node:test";
import assert from "node:assert";
import { openStore, ensureAccount, getAccount, setCash, insertStrategy, listStrategies,
  insertDecision, listDecisions, upsertPosition, listPositions, listAlerts, insertAlert } from "../src/store.js";
import { activeUserIds } from "../src/services/loop.js";

test("accounts are per-user: seeding user A does not touch user B", () => {
  const db = openStore(":memory:");
  ensureAccount(db, 42);
  ensureAccount(db, 43);
  const a = getAccount(db, 42);
  const b = getAccount(db, 43);
  assert.ok(a.seedMicro === b.seedMicro, "same default seed");
  // spent only from A
  setCash(db, 42, a.cashMicro - 1_000_000, a.peakNavMicro, 0);
  const b2 = getAccount(db, 43);
  assert.equal(b2.cashMicro, b.cashMicro, "B's cash untouched by A's spend");
});

test("strategies + decisions + alerts + positions are isolated by user_id", () => {
  const db = openStore(":memory:");
  insertStrategy(db, { userId: 1, text: "mine", strategyType: "rotate_to_discount", params: { direction: "discount" }, confirmed: 1, authorAddress: "AAA" });
  insertStrategy(db, { userId: 2, text: "theirs", strategyType: "rotate_to_discount", params: { direction: "premium" }, confirmed: 1, authorAddress: "BBB" });

  const s1 = listStrategies(db, 1);
  const s2 = listStrategies(db, 2);
  assert.equal(s1.length, 1);
  assert.equal(s2.length, 1);
  assert.equal(s1[0].text, "mine");
  assert.equal(s2[0].text, "theirs");
  assert.equal(s2[0].confirmed, true, "confirmed flag stored");

  insertDecision(db, 1, { seq: 1, ts: Date.now(), reason: "A run", actions: [], navMicro: 1000, cashMicro: 1000 });
  insertDecision(db, 2, { seq: 1, ts: Date.now(), reason: "B run", actions: [], navMicro: 999, cashMicro: 999 });
  const d1 = listDecisions(db, 1);
  const d2 = listDecisions(db, 2);
  assert.equal(d1.length, 1); assert.equal(d2.length, 1);
  assert.match(d1[0].reason, /A run/);
  assert.match(d2[0].reason, /B run/);
  assert.equal(d1[0].seq, 1, "seq resets per user");

  upsertPosition(db, 1, { symbol: "AAPLx", issuer: "x", qtyMicro: 5, avgCostMicro: 100 });
  upsertPosition(db, 2, { symbol: "NVDAx", issuer: "x", qtyMicro: 7, avgCostMicro: 200 });
  const p1 = listPositions(db, 1), p2 = listPositions(db, 2);
  assert.deepEqual(p1.map((x) => x.symbol), ["AAPLx"]);
  assert.deepEqual(p2.map((x) => x.symbol), ["NVDAx"]);

  insertAlert(db, { userId: 1, channel: "c", payload: { text: "A alert" } });
  insertAlert(db, { userId: 2, channel: "c", payload: { text: "B alert" } });
  assert.equal(listAlerts(db, 1).length, 1);
  assert.equal(listAlerts(db, 2).length, 1);
});

test("activeUserIds returns exactly the users with enabled strategies", () => {
  const db = openStore(":memory:");
  assert.deepEqual(activeUserIds(db).sort(), [0], "defaults to legacy/system user 0");
  insertStrategy(db, { userId: 7, text: "x", strategyType: "rotate_to_discount", params: {} });
  const ids = activeUserIds(db);
  assert.ok(ids.includes(7), `user 7 should be active, got ${ids}`);
});