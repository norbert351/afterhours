// PreStocks Desk — the bounty-eligible surface: this engine consumes ONLY
// PreStocks data (prestocks.com/api/prestocks, no key). No other issuer feed
// is touched here, so the surface satisfies the PreStocks bounty rule
// ("projects that integrate any non-PreStocks pre-IPO tokens are ineligible").
//
// What it does: turns the dual-price structure of pre-IPO tokens into a desk —
//   • dislocation: token price vs issuer mark price (the live trading signal)
//   • valuation opinion: markValuation vs impliedValuation (the reprice view)
//   • history: snapshots every 15 min → sparkline deltas
//   • plain-English rules → fired alerts
//   • honest hold-sim (scenario projections, never a promise)
import { listPreStocks } from "../adapters/prestocks.js";
import * as store from "../store.js";

export const PRESTOCKS_SYMBOLS = ["ANDURIL", "ANTHROPIC", "FIGUREAI", "KALSHI", "NEURALINK", "OPENAI", "POLYMARKET", "SPACEX"];

const pct = (n) => (Number.isFinite(n) ? n * 100 : null);
const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

function deskRow(t, prev) {
  const premium = t.markPrice ? (t.tokenPrice - t.markPrice) / t.markPrice : null;
  const valuationSpread = t.markValuation ? (t.impliedValuation - t.markValuation) / t.markValuation : null;
  let deltaMark = null, deltaToken = null, deltaPremium = null;
  if (prev) {
    if (prev.mark_price) deltaMark = round(((t.markPrice - prev.mark_price) / prev.mark_price) * 100, 3);
    if (prev.token_price) deltaToken = round(((t.tokenPrice - prev.token_price) / prev.token_price) * 100, 3);
    if (prev.mark_price && premium != null) {
      const prevPremium = (prev.token_price - prev.mark_price) / prev.mark_price;
      deltaPremium = round(premium * 100 - prevPremium * 100, 3);
    }
  }
  return {
    symbol: t.symbol, name: t.name, issuer: "prestocks",
    markPrice: round(t.markPrice), tokenPrice: round(t.tokenPrice),
    premiumPct: round(pct(premium), 3),
    markValuation: t.markValuation, impliedValuation: t.impliedValuation,
    valuationSpreadPct: round(pct(valuationSpread), 3),
    supply: round(t.supply, 4),
    contractAddress: t.contractAddress,
    deltaMark, deltaToken, deltaPremium,
  };
}

// Live desk: fetch PreStocks, merge the latest snapshot for deltas.
export async function buildDesk(db) {
  const live = await listPreStocks();
  const rows = [];
  for (const t of live) {
    const prev = store.latestPrestocksSnapshot(db, t.symbol);
    rows.push(deskRow(t, prev));
  }
  rows.sort((a, b) => Math.abs(b.premiumPct || 0) - Math.abs(a.premiumPct || 0));
  return {
    tokens: rows,
    count: rows.length,
    source: "prestocks.com/api/prestocks (no key)",
    generatedAt: Date.now(),
  };
}

// Append a history snapshot for every token (deduped: at most one per 60s).
export async function appendSnapshot(db, now = Date.now()) {
  const last = store.latestPrestocksTs(db);
  if (last && now - last < 60_000) return { appended: 0, skipped: "too soon" };
  const live = await listPreStocks();
  for (const t of live) {
    store.insertPrestocksSnapshot(db, {
      ts: now, symbol: t.symbol,
      markPrice: t.markPrice, tokenPrice: t.tokenPrice,
      markValuation: t.markValuation, impliedValuation: t.impliedValuation,
      supply: t.supply,
    });
  }
  return { appended: live.length };
}

export function deskHistory(db, symbol, limit = 40) {
  return store.prestocksHistory(db, symbol, limit);
}

// ── plain-English rules (PreStocks-scoped) ──
export function parsePrestocksRule(text) {
  const t = (text || "").toLowerCase();
  const sym = PRESTOCKS_SYMBOLS.find((s) => t.includes(s.toLowerCase())) || null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  let direction = null;
  if (/(above|trades above|premium)/.test(t)) direction = "above";
  else if (/(below|trades below|discount)/.test(t)) direction = "below";
  // "flag the biggest dislocation / largest premium / top mover"
  let type = "threshold";
  if (/(biggest|largest|top |biggest mover|most moved)/.test(t)) type = "largest";
  return { text, symbol: sym, direction, thresholdPct: m ? Number(m[1]) : 2, type, ok: true };
}

export function evaluatePrestocksRules(db, desk) {
  const rules = store.listPrestocksRules(db);
  const fired = [];
  for (const rule of rules) {
    const p = parsePrestocksRule(rule.text);
    if (p.type === "largest") {
      const top = desk.tokens[0];
      fired.push({ rule: { ...rule }, parsed: p, result: "fired", matches: [{ symbol: top.symbol, premiumPct: top.premiumPct }] });
      continue;
    }
    const matches = desk.tokens.filter((r) => {
      if (p.symbol && r.symbol !== p.symbol) return false;
      if (r.premiumPct == null) return false;
      if (p.direction === "above") return r.premiumPct >= p.thresholdPct;
      if (p.direction === "below") return r.premiumPct <= -p.thresholdPct;
      return Math.abs(r.premiumPct) >= p.thresholdPct;
    });
    fired.push({ rule: { ...rule }, parsed: p, result: matches.length ? "fired" : "no match", matches: matches.map((x) => ({ symbol: x.symbol, premiumPct: x.premiumPct })) });
  }
  return { rules: rules.length, fired };
}

// ── honest hold-sim: scenario projections, not promises ──
export function holdSim({ symbol, qty, tokenPrice, markPrice, markValuation, impliedValuation, supply }) {
  const entry = Number(qty) * Number(tokenPrice);
  const scenarios = [];
  const push = (label, price) => {
    const p = Number(price);
    scenarios.push({
      label, price: round(p, 2),
      value: round(qty * p, 2),
      movePct: p > 0 && tokenPrice > 0 ? round(((p - tokenPrice) / tokenPrice) * 100, 2) : null,
    });
  };
  push("mark converges to token (issuer catches up)", tokenPrice);
  push("token converges to mark (premium closes)", markPrice);
  const impliedPerToken = supply > 0 && impliedValuation != null ? impliedValuation / supply : null;
  const markPerToken = supply > 0 && markValuation != null ? markValuation / supply : null;
  if (markPerToken && impliedPerToken) {
    push("valuation opinion → implied/supply", impliedPerToken);
    push("valuation opinion → mark/supply", markPerToken);
  }
  push("flat (nothing moves)", tokenPrice);
  return { symbol, qty, entryUsd: round(entry, 2), scenarios, honest: "projections on real published prices — not a promise" };
}

// Keeper loop: snapshot every 15 min (96/day — polite to the free API).
export function startDeskLoop(db, { intervalMs = Number(process.env.AH_DESK_INTERVAL_MS || 15 * 60_000) } = {}) {
  let timer = null, running = false;
  async function tick() {
    if (running) return;
    running = true;
    try { await appendSnapshot(db); } catch (e) { console.error("[desk] snapshot failed:", e.message); }
    finally { running = false; }
  }
  return {
    start() { if (timer) return; timer = setInterval(tick, intervalMs); tick(); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    status: () => ({ enabled: !!timer, intervalMs }),
  };
}