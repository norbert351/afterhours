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
  -- v4 scoped tables: every ledger row belongs to a user (multi-tenant).
  CREATE TABLE IF NOT EXISTS strategies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    strategy_type TEXT NOT NULL DEFAULT 'alert',
    params TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    author_address TEXT,
    confirmed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS paper_account (
    user_id INTEGER PRIMARY KEY,
    cash_micro INTEGER NOT NULL,
    seed_micro INTEGER NOT NULL,
    peak_nav_micro INTEGER NOT NULL,
    realized_micro INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS paper_positions (
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    issuer TEXT NOT NULL,
    qty_micro INTEGER NOT NULL,
    avg_cost_micro INTEGER NOT NULL,
    realized_pnl_micro INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, symbol)
  );
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    seq INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    nav_micro INTEGER NOT NULL,
    cash_micro INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  -- PreStocks Desk (bounty-eligible PreStocks-only surface)
  CREATE TABLE IF NOT EXISTS prestocks_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    mark_price REAL NOT NULL,
    token_price REAL NOT NULL,
    mark_valuation REAL,
    implied_valuation REAL,
    supply REAL
  );
  CREATE TABLE IF NOT EXISTS prestocks_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `);
  // Safe forward-migration for pre-existing single-tenant tables. Columns are
  // added BEFORE any index that references them.
  addColIfMissing(db, "paper_account", "user_id", "INTEGER");
  addColIfMissing(db, "paper_positions", "user_id", "INTEGER");
  addColIfMissing(db, "strategies", "user_id", "INTEGER");
  addColIfMissing(db, "strategies", "author_address", "TEXT");
  addColIfMissing(db, "strategies", "confirmed", "INTEGER");
  addColIfMissing(db, "decisions", "user_id", "INTEGER");
  addColIfMissing(db, "alerts", "user_id", "INTEGER");
  // Indexes AFTER the columns exist.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies(user_id);
           CREATE INDEX IF NOT EXISTS idx_decisions_user ON decisions(user_id, seq);
           UPDATE strategies SET user_id = 0 WHERE user_id IS NULL;
           UPDATE paper_positions SET user_id = 0 WHERE user_id IS NULL;
           UPDATE decisions SET user_id = 0 WHERE user_id IS NULL;
           UPDATE alerts SET user_id = 0 WHERE user_id IS NULL;`);
  // Rebuild the legacy singleton paper_account into the multi-tenant shape.
  // A pre-v4 table is `id INTEGER PRIMARY KEY CHECK(id=1) ...` (no user_id);
  // SQLite can't ALTER away a rowid PK + its CHECK, so we copy→drop→rename.
  const acctCols = db.prepare("PRAGMA table_info(paper_account)").all().map((c) => c.name);
  // Old-style = rowid PK `id` (fresh multi-tenant tables never have an `id` col).
  const oldStyle = acctCols.includes("id");
  if (oldStyle) {
    const legacy = db.prepare("SELECT cash_micro, seed_micro, peak_nav_micro, realized_micro, updated_at FROM paper_account WHERE id = 1").get();
    db.exec(`ALTER TABLE paper_account RENAME TO paper_account_legacy;
      CREATE TABLE paper_account (
        user_id INTEGER PRIMARY KEY,
        cash_micro INTEGER NOT NULL,
        seed_micro INTEGER NOT NULL,
        peak_nav_micro INTEGER NOT NULL,
        realized_micro INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );`);
    if (legacy) {
      db.prepare("INSERT OR IGNORE INTO paper_account (user_id, cash_micro, seed_micro, peak_nav_micro, realized_micro, updated_at) VALUES (0, ?, ?, ?, ?, ?)")
        .run(legacy.cash_micro, legacy.seed_micro, legacy.peak_nav_micro, legacy.realized_micro || 0, legacy.updated_at);
    }
    db.exec("DROP TABLE IF EXISTS paper_account_legacy");
  }
  // Rebuild legacy paper_positions (pre-v4 PK was `symbol`, which would block
  // two users holding the same symbol). Rebuild into composite (user_id, symbol).
  const posCols = db.prepare("PRAGMA table_info(paper_positions)").all().map((c) => c.name);
  const posLegacy = posCols.includes("user_id") &&
    !db.prepare(`SELECT 1 FROM pragma_table_info('paper_positions') WHERE pk > 0 AND name='user_id'`).get();
  if (posLegacy) {
    db.exec(`ALTER TABLE paper_positions RENAME TO paper_positions_legacy;
      CREATE TABLE paper_positions (
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        issuer TEXT NOT NULL,
        qty_micro INTEGER NOT NULL,
        avg_cost_micro INTEGER NOT NULL,
        realized_pnl_micro INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, symbol)
      );`);
    db.exec(`INSERT INTO paper_positions (user_id, symbol, issuer, qty_micro, avg_cost_micro, realized_pnl_micro)
      SELECT 0, symbol, issuer, qty_micro, avg_cost_micro, realized_pnl_micro FROM paper_positions_legacy`);
    db.exec("DROP TABLE IF EXISTS paper_positions_legacy");
  }
  // Ensure the system/legacy user 0 has a seeded account so the default loop works.
  ensureAccount(db, 0);
}

function addColIfMissing(db, table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch {}
  }
}

export function ensureAccount(db, userId, seedUsd = Number(process.env.AH_SEED_USD || 10_000)) {
  const existing = db.prepare("SELECT user_id FROM paper_account WHERE user_id = ?").get(userId);
  if (existing) return;
  const seed = Math.round(seedUsd * PRICE_SCALE);
  db.prepare("INSERT INTO paper_account (user_id, cash_micro, seed_micro, peak_nav_micro, realized_micro, updated_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(userId, seed, seed, seed, Date.now());
}

// ---- strategies (user-scoped) ----
export function insertStrategy(db, { userId = 0, text, strategyType, params, authorAddress = null, confirmed = 0 }) {
  ensureAccount(db, userId);
  db.prepare(
    "INSERT INTO strategies (user_id, text, strategy_type, params, enabled, author_address, confirmed, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
  ).run(userId, text, strategyType, JSON.stringify(params), authorAddress, confirmed ? 1 : 0, Date.now());
  return listStrategies(db, userId);
}
export function listStrategies(db, userId = 0) {
  return db.prepare("SELECT id, text, strategy_type AS strategyType, params, enabled, author_address AS authorAddress, confirmed, created_at AS createdAt FROM strategies WHERE user_id = ? ORDER BY id").all(userId).map((r) => ({ ...r, params: safeJson(r.params), confirmed: !!r.confirmed }));
}

// ---- paper account (user-scoped) ----
export function getAccount(db, userId = 0) {
  ensureAccount(db, userId);
  const a = db.prepare("SELECT * FROM paper_account WHERE user_id = ?").get(userId);
  return a
    ? { userId: a.user_id, cashMicro: a.cash_micro, seedMicro: a.seed_micro, peakNavMicro: a.peak_nav_micro, realizedMicro: a.realized_micro || 0, updatedAt: a.updated_at }
    : null;
}
export function setCash(db, userId, cashMicro, navMicro, realizedMicro, now = Date.now()) {
  ensureAccount(db, userId);
  db.prepare("UPDATE paper_account SET cash_micro = ?, peak_nav_micro = MAX(peak_nav_micro, ?), realized_micro = ?, updated_at = ? WHERE user_id = ?")
    .run(cashMicro, navMicro, realizedMicro ?? db.prepare("SELECT realized_micro FROM paper_account WHERE user_id=?").get(userId).realized_micro, now, userId);
}
export function listPositions(db, userId = 0) {
  return db.prepare("SELECT symbol, issuer, qty_micro AS qtyMicro, avg_cost_micro AS avgCostMicro, realized_pnl_micro AS realizedPnlMicro FROM paper_positions WHERE user_id = ?").all(userId);
}
export function getPosition(db, userId, symbol) {
  return db.prepare("SELECT * FROM paper_positions WHERE user_id = ? AND symbol = ?").get(userId, symbol) || null;
}
export function upsertPosition(db, userId, p) {
  db.prepare(`
    INSERT INTO paper_positions (user_id, symbol, issuer, qty_micro, avg_cost_micro, realized_pnl_micro)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, symbol) DO UPDATE SET
      issuer = excluded.issuer,
      qty_micro = excluded.qty_micro,
      avg_cost_micro = excluded.avg_cost_micro,
      realized_pnl_micro = excluded.realized_pnl_micro
  `).run(userId, p.symbol, p.issuer, p.qtyMicro, p.avgCostMicro);
}
export function deletePosition(db, userId, symbol) {
  db.prepare("DELETE FROM paper_positions WHERE user_id = ? AND symbol = ?").run(userId, symbol);
}
export function clearAllPositions(db, userId = 0) {
  db.prepare("DELETE FROM paper_positions WHERE user_id = ?").run(userId);
}

// ---- decisions (user-scoped) ----
export function lastSeq(db, userId = 0) {
  const r = db.prepare("SELECT seq FROM decisions WHERE user_id = ? ORDER BY seq DESC LIMIT 1").get(userId);
  return r ? r.seq : 0;
}
export function insertDecision(db, userId, rec) {
  db.prepare(
    "INSERT INTO decisions (user_id, seq, ts, reason, actions_json, nav_micro, cash_micro) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, rec.seq, rec.ts, rec.reason, JSON.stringify(rec.actions), rec.navMicro, rec.cashMicro);
}
export function listDecisions(db, userId = 0, limit = 20) {
  return db.prepare("SELECT id, seq, ts, reason, actions_json AS actionsJson, nav_micro AS navMicro, cash_micro AS cashMicro FROM decisions WHERE user_id = ? ORDER BY seq DESC LIMIT ?").all(userId, limit)
    .map((r) => ({ ...r, actions: safeJson(r.actionsJson) }))
    .reverse(); // chronological
}

// ---- alerts (user-scoped) ----
export function insertAlert(db, { userId = 0, channel, payload }) {
  db.prepare("INSERT INTO alerts (user_id, ts, channel, payload) VALUES (?, ?, ?, ?)").run(userId, Date.now(), channel, JSON.stringify(payload));
  return listAlerts(db, userId);
}
export function listAlerts(db, userId = 0, limit = 30) {
  return db.prepare("SELECT id, ts, channel, payload FROM alerts WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit)
    .map((r) => ({ ...r, payload: safeJson(r.payload) })).reverse();
}

export function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// ---- PreStocks Desk (bounty surface: PreStocks data ONLY) ----
export function insertPrestocksSnapshot(db, row) {
  db.prepare(
    "INSERT INTO prestocks_snapshots (ts, symbol, mark_price, token_price, mark_valuation, implied_valuation, supply) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(row.ts, row.symbol, row.markPrice, row.tokenPrice, row.markValuation ?? null, row.impliedValuation ?? null, row.supply ?? null);
}
export function latestPrestocksSnapshot(db, symbol) {
  return db.prepare("SELECT * FROM prestocks_snapshots WHERE symbol = ? ORDER BY id DESC LIMIT 1").get(symbol) || null;
}
export function prestocksHistory(db, symbol, limit = 40) {
  return db.prepare(
    "SELECT ts, mark_price AS markPrice, token_price AS tokenPrice FROM prestocks_snapshots WHERE symbol = ? ORDER BY id ASC LIMIT ?",
  ).all(symbol, limit);
}
export function latestPrestocksTs(db) {
  const r = db.prepare("SELECT MAX(ts) AS ts FROM prestocks_snapshots").get();
  return r?.ts ?? null;
}
export function insertPrestocksRule(db, text) {
  db.prepare("INSERT INTO prestocks_rules (text, created_at) VALUES (?, ?)").run(text, Date.now());
  return listPrestocksRules(db);
}
export function listPrestocksRules(db) {
  return db.prepare("SELECT id, text, created_at AS createdAt FROM prestocks_rules ORDER BY id").all();
}