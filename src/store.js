// AfterHours v2 store — node:sqlite persistence (WAL).
// Persistent: strategies, paper account (cash), paper positions, decisions
// (the strategy-action log), alerts (delivery events).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Integer money/units — no floats in the ledger.
export const PRICE_SCALE = 1_000_000; // $1 == 1_000_000 priceMicro
export const QTY_SCALE = 1_000_000;   // 1 share == 1_000_000 qtyMicro

export function openStore(dbPath) {
  const resolved = dbPath === ":memory:"
    ? ":memory:"
    : path.resolve(dbPath || process.env.AH_DB_PATH || path.join(__dirname, "..", "data", "afterhours.db"));
  if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });

  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    strategy_type TEXT NOT NULL DEFAULT 'alert',
    params TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS paper_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cash_micro INTEGER NOT NULL,
    seed_micro INTEGER NOT NULL,
    peak_nav_micro INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS paper_positions (
    symbol TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    qty_micro INTEGER NOT NULL,
    avg_cost_micro INTEGER NOT NULL,   -- priceMicro per share at avg cost
    realized_pnl_micro INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    nav_micro INTEGER NOT NULL,
    cash_micro INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0
  );
  `);
  // Seed the singleton paper account with a default demo book.
  const acc = db.prepare("SELECT id FROM paper_account WHERE id = 1").get();
  if (!acc) {
    const seed = Math.round(Number(process.env.AH_SEED_USD || 10_000) * PRICE_SCALE);
    db.prepare(
      "INSERT INTO paper_account (id, cash_micro, seed_micro, peak_nav_micro, updated_at) VALUES (1, ?, ?, ?, ?)"
    ).run(seed, seed, seed, Date.now());
  }
}

// ---- strategies ----
export function insertStrategy(db, { text, strategyType, params }) {
  db.prepare(
    "INSERT INTO strategies (text, strategy_type, params, created_at) VALUES (?, ?, ?, ?)"
  ).run(text, strategyType, JSON.stringify(params), Date.now());
  return listStrategies(db);
}
export function listStrategies(db) {
  return db.prepare("SELECT id, text, strategy_type AS strategyType, params, enabled, created_at AS createdAt FROM strategies ORDER BY id").all().map((r) => ({ ...r, params: safeJson(r.params) }));
}

// ---- paper account ----
export function getAccount(db) {
  const a = db.prepare("SELECT * FROM paper_account WHERE id = 1").get();
  return a
    ? { cashMicro: a.cash_micro, seedMicro: a.seed_micro, peakNavMicro: a.peak_nav_micro, updatedAt: a.updated_at }
    : null;
}
export function setCash(db, cashMicro, navMicro, now = Date.now()) {
  db.prepare("UPDATE paper_account SET cash_micro = ?, peak_nav_micro = MAX(peak_nav_micro, ?), updated_at = ? WHERE id = 1")
    .run(cashMicro, navMicro, now);
}
export function listPositions(db) {
  return db.prepare("SELECT symbol, issuer, qty_micro AS qtyMicro, avg_cost_micro AS avgCostMicro, realized_pnl_micro AS realizedPnlMicro FROM paper_positions").all();
}
export function getPosition(db, symbol) {
  return db.prepare("SELECT * FROM paper_positions WHERE symbol = ?").get(symbol) || null;
}
export function upsertPosition(db, p) {
  db.prepare(`
    INSERT INTO paper_positions (symbol, issuer, qty_micro, avg_cost_micro, realized_pnl_micro)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(symbol) DO UPDATE SET
      issuer = excluded.issuer,
      qty_micro = excluded.qty_micro,
      avg_cost_micro = excluded.avg_cost_micro
  `).run(p.symbol, p.issuer, p.qtyMicro, p.avgCostMicro);
}
export function deletePosition(db, symbol) {
  db.prepare("DELETE FROM paper_positions WHERE symbol = ?").run(symbol);
}

// ---- decisions ----
export function lastSeq(db) {
  const r = db.prepare("SELECT seq FROM decisions ORDER BY seq DESC LIMIT 1").get();
  return r ? r.seq : 0;
}
export function insertDecision(db, rec) {
  db.prepare(
    "INSERT INTO decisions (seq, ts, reason, actions_json, nav_micro, cash_micro) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(rec.seq, rec.ts, rec.reason, JSON.stringify(rec.actions), rec.navMicro, rec.cashMicro);
}
export function listDecisions(db, limit = 20) {
  return db.prepare("SELECT id, seq, ts, reason, actions_json AS actionsJson, nav_micro AS navMicro, cash_micro AS cashMicro FROM decisions ORDER BY seq DESC LIMIT ?").all(limit)
    .map((r) => ({ ...r, actions: safeJson(r.actionsJson) }))
    .reverse(); // chronological
}

// ---- alerts ----
export function insertAlert(db, { channel, payload }) {
  db.prepare("INSERT INTO alerts (ts, channel, payload, delivered) VALUES (?, ?, ?, 1)").run(Date.now(), channel, JSON.stringify(payload));
  return listAlerts(db);
}
export function listAlerts(db, limit = 30) {
  return db.prepare("SELECT id, ts, channel, payload, delivered FROM alerts ORDER BY id DESC LIMIT ?").all(limit)
    .map((r) => ({ ...r, payload: safeJson(r.payload) })).reverse();
}

export function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}