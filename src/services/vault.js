// AfterHours — Weekend Gap Vault.
// The winner-shaped capital-utilization product: deposit SOL, arm the vault,
// and it puts the capital to work across the weekend gap — buys the deepest
// discounted xStock while the NYSE reference is frozen, unwinds to SOL at the
// open. Every real fill is capped (≈$0.25), mint-allowlisted, and recorded
// with its Solscan signature. Never fabricates a fill; paper mode is explicit.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cachedFetch } from "../lib/http.js";
import { XSTOCKS } from "../adapters/xstocks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOL_MINT = "So11111111111111111111111111111111111111112";
const XSTOCK_DECIMALS = 8;

export function vaultConfig() {
  return {
    execMode: String(process.env.AH_VAULT_EXEC || "").trim() === "1" ? "real" : "paper",
    capUsd: Number(process.env.AH_VAULT_CAP_USD || 0.25),
    maxPositions: Number(process.env.AH_VAULT_MAX_POSITIONS || 1),
    minVolUsd: Number(process.env.AH_VAULT_MIN_VOL_USD || 5000),
    minCapLamports: Number(process.env.AH_VAULT_MIN_CAP_LAMPORTS || 500_000),   // ~$0.08
    maxCapLamports: Number(process.env.AH_VAULT_MAX_CAP_LAMPORTS || 4_000_000),  // ~$0.60
  };
}

export function openVaultStore(dbPath) {
  const resolved = dbPath === ":memory:"
    ? ":memory:"
    : path.resolve(dbPath || process.env.AH_VAULT_DB_PATH || path.join(__dirname, "..", "data", "vault.db"));
  if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      armed_at INTEGER,
      last_tick_at INTEGER,
      last_error TEXT,
      positions_json TEXT NOT NULL DEFAULT '[]',
      runs INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS vault_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      side TEXT NOT NULL,
      symbol TEXT NOT NULL,
      mint TEXT NOT NULL,
      in_lamports INTEGER,
      out_atoms INTEGER,
      usd_est REAL,
      signature TEXT,
      explorer TEXT,
      mode TEXT NOT NULL,
      note TEXT
    );
    INSERT OR IGNORE INTO vault_state (id, status) VALUES (1, 'idle');
  `);
  return db;
}

export function readState(db) {
  const r = db.prepare("SELECT * FROM vault_state WHERE id = 1").get();
  return {
    status: r.status,
    armedAt: r.armed_at,
    lastTickAt: r.last_tick_at,
    lastError: r.last_error,
    positions: safeJson(r.positions_json),
    runs: r.runs,
  };
}

export function listFills(db, limit = 20) {
  return db.prepare(
    "SELECT ts, side, symbol, mint, in_lamports AS inLamports, out_atoms AS outAtoms, usd_est AS usdEst, signature, explorer, mode, note FROM vault_fills ORDER BY id DESC LIMIT ?",
  ).all(limit).reverse();
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}

// ── the vault: pure-ish state machine, deps injected for testability ──
export function createVault({ db, getGaps, swapBuy, swapSell, solPriceUsd, cfg = vaultConfig() }) {
  function persist(state) {
    db.prepare(
      "UPDATE vault_state SET status = ?, armed_at = ?, last_tick_at = ?, last_error = ?, positions_json = ?, runs = ? WHERE id = 1",
    ).run(state.status, state.armedAt, state.lastTickAt, state.lastError, JSON.stringify(state.positions), state.runs);
  }
  function recordFill(f) {
    db.prepare(
      "INSERT INTO vault_fills (ts, side, symbol, mint, in_lamports, out_atoms, usd_est, signature, explorer, mode, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(f.ts, f.side, f.symbol, f.mint, f.inLamports ?? null, f.outAtoms ?? null, f.usdEst ?? null, f.signature ?? null, f.explorer ?? null, f.mode, f.note ?? null);
  }

  function load() {
    const s = readState(db);
    return {
      status: s.status, armedAt: s.armedAt, lastTickAt: s.lastTickAt,
      lastError: s.lastError, positions: s.positions, runs: s.runs,
    };
  }

  async function capLamportsUsd() {
    const price = await solPriceUsd(); // SOL/USD
    if (!price || price <= 0) throw new Error("no SOL price for cap sizing");
    return Math.min(Math.max(Math.round((cfg.capUsd / price) * 1e9), cfg.minCapLamports), cfg.maxCapLamports);
  }

  function pickBest(gaps) {
    const tradeable = (gaps.gaps || []).filter(
      (g) => !g.error && g.mint && XSTOCKS[g.symbol] && (g.volumeUsd24h || 0) >= cfg.minVolUsd,
    );
    if (!tradeable.length) return null;
    return [...tradeable].sort((a, b) => Math.abs(b.gapPct || 0) - Math.abs(a.gapPct || 0))[0];
  }

  // One keeper step: decides buy/hold/unwind from market state.
  async function tick() {
    const s = load();
    if (s.status !== "armed" && s.status !== "holding") return { state: s, action: "idle" };
    const gaps = await getGaps();
    const best = pickBest(gaps);
    const now = Date.now();
    let action = "none";

    if (gaps.marketOpen) {
      // NYSE open → the edge window is over → unwind to SOL (honest).
      const out = [];
      for (const p of s.positions) {
        try {
          const r = await swapSell(p.symbol, p.mint, p.qtyAtoms);
          recordFill({ ts: now, side: "sell", symbol: p.symbol, mint: p.mint, outAtoms: p.qtyAtoms, signature: r?.signature, explorer: r?.explorer, mode: cfg.execMode, note: "unwind at open" });
          out.push({ ...p, soldAt: now, tx: r?.signature || null });
        } catch (e) {
          recordFill({ ts: now, side: "sell", symbol: p.symbol, mint: p.mint, outAtoms: p.qtyAtoms, mode: cfg.execMode, note: "SELL FAILED: " + (e.message || "").slice(0, 120) });
        }
      }
      s.positions = [];
      s.status = "idle";
      s.lastError = out.length ? null : s.lastError;
      action = "unwound";
    } else if (s.status === "holding") {
      action = "hold"; // already positioned; the gap does the work
    } else if (best) {
      // NYSE closed + armed + a tradeable gap exists → deploy capital.
      const lamports = await capLamportsUsd();
      try {
        const r = await swapBuy(best.symbol, best.mint, lamports);
        const qtyAtoms = r?.outAmount ? Number(r.outAmount) : Math.round((cfg.capUsd / best.onChainPriceUsd) * 10 ** XSTOCK_DECIMALS);
        const p = {
          symbol: best.symbol, mint: best.mint,
          qtyAtoms, qtyUnits: qtyAtoms / 10 ** XSTOCK_DECIMALS,
          avgPriceUsd: best.onChainPriceUsd,
          gapPctAtBuy: best.gapPct,
          tx: r?.signature || null, explorer: r?.explorer || null,
          boughtAt: now, mode: cfg.execMode,
        };
        s.positions = [...s.positions, p].slice(-cfg.maxPositions);
        s.status = "holding";
        recordFill({ ts: now, side: "buy", symbol: best.symbol, mint: best.mint, inLamports: lamports, outAtoms: qtyAtoms, usdEst: cfg.capUsd, signature: r?.signature, explorer: r?.explorer, mode: cfg.execMode, note: `gap ${best.gapPct?.toFixed(2)}%` });
        action = `bought ${best.symbol}`;
      } catch (e) {
        s.lastError = `buy failed: ${(e.message || "").slice(0, 140)}`;
        recordFill({ ts: now, side: "buy", symbol: best.symbol, mint: best.mint, mode: cfg.execMode, note: "BUY FAILED: " + (e.message || "").slice(0, 140) });
        action = "buy_failed";
      }
    } else {
      s.lastError = "no tradeable gap right now";
    }

    s.lastTickAt = now;
    s.runs += 1;
    persist(s);
    return { state: s, action, best: best ? { symbol: best.symbol, gapPct: best.gapPct } : null };
  }

  async function arm() {
    const s = load();
    if (s.status === "holding") return { error: "vault already holding — stop or unwind first", state: s };
    s.status = "armed";
    s.armedAt = Date.now();
    s.lastError = null;
    // fresh cycle: clear any stale positions from a previous interrupted cycle
    s.positions = s.positions.filter((p) => p.tx === null || p.tx === undefined);
    persist(s);
    return { state: s };
  }

  function stop() {
    const s = load();
    s.status = "idle";
    s.lastError = "stopped by operator";
    persist(s);
    return { state: s };
  }

  async function unwind() {
    const s = load();
    if (s.status === "holding") { await tick(); return { state: load(), action: "unwound" }; }
    s.status = "idle";
    persist(s);
    return { state: s, action: "nothing to unwind" };
  }

  // Keeper loop — mirrors loop.js guardrails (in-flight lock, no overlap).
  function loop({ intervalMs = Number(process.env.AH_VAULT_INTERVAL_MS || 60_000) } = {}) {
    let timer = null, running = false;
    async function onTick() {
      if (running) return;
      running = true;
      try { const s = load(); if (s.status === "armed" || s.status === "holding") await tick(); }
      catch { /* next tick */ }
      finally { running = false; }
    }
    return {
      start() { if (timer) return; timer = setInterval(onTick, intervalMs); onTick(); },
      stop() { if (timer) { clearInterval(timer); timer = null; } },
      status: () => ({ enabled: !!timer, intervalMs, running }),
    };
  }

  return { tick, arm, stop, unwind, loop, state: load };
}

// Live SOL price for CAP SIZING ONLY (never a valuation). Resilient chain:
// Jupiter price API (proven host) -> CoinGecko -> GeckoTerminal -> documented
// fallback. Cached 60s. A missing price must never stop the safety cap.
const SOL_PRICE_FALLBACK_USD = 150; // documented constant; conservative enough for a ~$0.25 cap
let solPriceCache = { ts: 0, price: null };
export async function liveSolPriceUsd() {
  if (solPriceCache.price && Date.now() - solPriceCache.ts < 60_000) return solPriceCache.price;
  for (const fn of [
    async () => {
      const d = await cachedFetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`, { ttlMs: 60_000, retries: 1 });
      return Number(d?.data?.[SOL_MINT]?.price);
    },
    async () => {
      const d = await cachedFetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { ttlMs: 60_000, retries: 1 });
      return Number(d?.solana?.usd);
    },
    async () => {
      const d = await cachedFetch(
        `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${SOL_MINT}`,
        { ttlMs: 60_000, retries: 1 },
      );
      return Number(d?.data?.attributes?.price_usd);
    },
  ]) {
    try {
      const p = await fn();
      if (p && p > 0) { solPriceCache = { ts: Date.now(), price: p }; return p; }
    } catch { /* next source */ }
  }
  return SOL_PRICE_FALLBACK_USD; // documented cap-sizing constant only
}

export const VAULT_SOL_MINT = SOL_MINT;
export const VAULT_XSTOCK_DECIMALS = XSTOCK_DECIMALS;