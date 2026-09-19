// AfterHours v4 — zero-dep accounts + watchlist (self-contained, no external IdP).
// Pattern: zerodep-node-backend → native auth (scrypt + timingSafeEqual + HttpOnly
// session cookie). Auth answers "who's signed in"; the wallet answers "which keys
// move money" — separate layers.
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { openStore } from "./store.js";

export function migrateAuth(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    password_salt TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
  );
  `);
}

function hashPassword(pw, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(pw, hash, salt) {
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerUser(db, { handle, password }) {
  const existing = db.prepare("SELECT id FROM users WHERE handle = ?").get(handle);
  if (existing) return { error: "handle already registered", status: 409 };
  if (!handle || !password || password.length < 6) return { error: "password must be ≥ 6 chars", status: 400 };
  const { hash, salt } = hashPassword(password);
  db.prepare("INSERT INTO users (handle, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)")
    .run(handle, hash, salt, Date.now());
  return { handle };
}

export function loginUser(db, { handle, password }) {
  const u = db.prepare("SELECT * FROM users WHERE handle = ?").get(handle);
  if (!u || !u.password_hash || !verifyPassword(password, u.password_hash, u.password_salt)) {
    return { error: "invalid handle or password", status: 401 };
  }
  const token = "ah_" + randomBytes(32).toString("hex");
  const expires = Date.now() + 7 * 86400e3;
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, u.id, expires);
  return { token, expires, handle: u.handle, userId: u.id };
}

export function userFromToken(db, token) {
  if (!token) return null;
  const s = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token = ? AND expires_at > ?").get(token, Date.now());
  if (!s) return null;
  const u = db.prepare("SELECT id, handle, created_at AS createdAt FROM users WHERE id = ?").get(s.user_id);
  return u || null;
}
export function logout(db, token) {
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function watchlistFor(db, userId) {
  return db.prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY created_at").all(userId).map((r) => r.symbol);
}
export function addWatch(db, userId, symbol) {
  db.prepare("INSERT OR IGNORE INTO watchlist (user_id, symbol, created_at) VALUES (?, ?, ?)").run(userId, String(symbol).toUpperCase(), Date.now());
  return watchlistFor(db, userId);
}
export function removeWatch(db, userId, symbol) {
  db.prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?").run(userId, String(symbol).toUpperCase());
  return watchlistFor(db, userId);
}

// cookie helpers
export function parseCookies(req) {
  const h = req.headers.cookie || "";
  const out = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export const AUTH_COOKIE = "ah_session";