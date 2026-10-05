// sleep-agent.js — AfterHours Sleep Mode: an autonomous agent that manages a
// cross-asset tokenized-equity book while you sleep. Qwen (Bitget sponsor endpoint)
// is the DECISION-MAKER; a second Qwen pass AUDITS each plan before it executes.
// Execution is PAPER with a real cost-basis ledger, fees + slippage, and a NAV
// curve → honest strategy metrics (return, Sharpe, max drawdown, win rate, turnover).
// Every decision is signed. Runs on Solana, BNB and Bitget.
import crypto from "node:crypto";
import { config } from "../config.js";
import { bitgetArbUniverse } from "./bitget-arb.js";
import { bnbUniverse } from "./bnb.js";
import { buildDashboard } from "./oracle.js";
import { cryptoTickers } from "../adapters/bitget-r.js";

const Q = config.qwen;
const FEE = 0.0005, SLIP = 0.0005; // 5bps fee + 5bps slippage per fill
const usd = (n) => Math.round(Number(n) * 100) / 100;

// ── sensors (all three venues) ───────────────────────────────────────────────
export async function sense(venue) {
  try {
    if (venue === "bitget") {
      const d = await bitgetArbUniverse();
      const g = (d.gaps || []).map(x => ({ symbol: x.symbol, gapPct: x.gapPct, price: x.rTokenPriceUsd }));
      try { const c = await cryptoTickers(); for (const [sym, px] of Object.entries(c)) if (px) g.push({ symbol: sym, gapPct: 0, price: px, hedge: true }); } catch { /* no crypto */ }
      return g;
    }
    if (venue === "bnb") { const d = await bnbUniverse(); return (d.gaps || []).filter(g => !g.error).map(g => ({ symbol: g.symbol, gapPct: g.gapPct, price: g.tokenPrice })); }
    if (venue === "solana") { const d = await buildDashboard(); return (d.dislocations || []).filter(x => x.type === "cross_issuer").map(x => ({ symbol: (x.underlying || x.symbol || "").toUpperCase(), gapPct: Number(x.gapBps || 0) / 100, price: x.minPrice })); }
    return [];
  } catch { return []; }
}

// ── state ────────────────────────────────────────────────────────────────────
const state = {
  armed: false, venue: "bitget", rules: "", capitalUsd: 100,
  cash: 0, book: new Map(), nav: [], decisions: [], closed: [], fees: 0, slippage: 0, traded: 0, seeded: false,
};
export function _resetForTest() { state.armed = false; state.cash = 0; state.book = new Map(); state.nav = []; state.decisions = []; state.closed = []; state.fees = 0; state.slippage = 0; state.traded = 0; state.seeded = false; }

// ── Qwen ─────────────────────────────────────────────────────────────────────
function parseDecision(text) {
  let t = String(text).trim(); const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) t = f[1].trim();
  const s = t.indexOf("{"), e = t.lastIndexOf("}"); if (s < 0 || e <= s) throw new Error("no JSON in qwen output");
  const o = JSON.parse(t.slice(s, e + 1));
  return { trigger: String(o.trigger || "rebalance"), rationale: String(o.rationale || ""), orders: o.orders || [] };
}
async function qwen(messages, maxTokens, timeoutMs, attempts) {
  let lastErr;
  const n = attempts || 2;
  for (let i = 0; i < n; i++) {
    try {
      const res = await fetch(`${Q.base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Q.apiKey}` },
        body: JSON.stringify({ model: Q.model, messages, temperature: 0.2, max_tokens: maxTokens }), signal: AbortSignal.timeout(timeoutMs || Number(process.env.AH_QWEN_TIMEOUT_MS || 12_000)),
      });
      if (res.status === 429) { lastErr = new Error("rate limited"); await new Promise(r => setTimeout(r, 2500)); continue; }
      if (!res.ok) throw new Error(`llm http ${res.status}`);
      const j = await res.json(); const t = j?.choices?.[0]?.message?.content; if (!t) throw new Error("empty completion"); return t;
    } catch (e) { lastErr = e; }
  } throw lastErr;
}
export function canUseQwen() { return !!Q.apiKey; }

function holdingsSummary(gaps) {
  const gm = new Map((gaps || []).map(g => [String(g.symbol).toUpperCase(), g.gapPct]));
  const out = [];
  for (const [sym, p] of state.book) {
    if (p.qty > 1e-9) { const gp = gm.has(sym.toUpperCase()) ? `${gm.get(sym.toUpperCase()) >= 0 ? "+" : ""}${Number(gm.get(sym.toUpperCase())).toFixed(2)}% vs ref` : "n/a"; out.push(`${sym} qty ${p.qty.toFixed(4)} avgCost ${p.avgCost.toFixed(2)} now ${gp}`); }
  }
  return out.length ? out.join("\n") : "(flat — all cash)";
}

async function decide(gaps, rules, capitalUsd, timeoutMs) {
  const state0 = { venue: state.venue, navUsd: metrics().navUsd, cashUsd: usd(state.cash), gaps: gaps.slice(0, 12).map(g => `${g.symbol} ${g.gapPct > 0 ? "+" : ""}${g.gapPct.toFixed(2)}% px ${g.price}`) };
  if (!Q.apiKey) return decideStub(state0, rules, capitalUsd);
  const sys = "You are AfterHours' autonomous overnight agent managing a CROSS-ASSET book of tokenized US stocks (rToken) + a crypto hedge sleeve (BTC/ETH) while the human sleeps. The reference price is FROZEN (market closed); the token trades 24/7. POSITIVE gap = token above its frozen ref → SELL/trim the premium. NEGATIVE gap = token below ref → BUY the discount. CROSS-ASSET: you hold a crypto hedge sleeve (BTC) — in risk-off (large rToken premiums), rotate premium proceeds into BTC as a hedge. You are the decision-maker. HARD RULES: never propose an order above 25% of NAV; never SELL a symbol not currently held; keep total exposure within cash+holdings; prefer few high-conviction orders. When a holding trades ABOVE its reference beyond the trim threshold, TRIM it (SELL) to lock the premium; redeploy proceeds into the biggest discount or the BTC hedge if one exists.";
  const user = [
    `Capital/NAV: $${state0.navUsd.toFixed(0)} | cash: $${state0.cashUsd.toFixed(2)}.`,
    `Your rules: ${rules || "trim holdings above +1% vs reference, buy the biggest discount over 0.3%, cap 25% of NAV."}`,
    `Your holdings (with current gap vs frozen reference):\n${holdingsSummary(gaps)}`,
    `Venue: ${state.venue} — market closed (gap window).`,
    "All live gaps (symbol %gap price):", state0.gaps.join("\n") || "(none)",
    "",
    'Return ONLY JSON: {"trigger":"rebalance|hold|hedge","rationale":"2-3 sentences naming the risk you are managing","orders":[{"action":"BUY"|"SELL","symbol":"<SYM>","usd":<USD>,"reason":"short"}]}. BUY only if fundable from cash or same-plan SELLs. SELL only symbols in holdings.',
  ].join("\n");
  try { const d = await parseDecision(await qwen([{ role: "system", content: sys }, { role: "user", content: user }], 700, timeoutMs || 8000, timeoutMs ? 2 : 1)); d.model = Q.model; return d; }
  catch (e) { const d = decideStub(state0, rules, capitalUsd); d.model = "stub (qwen unavailable)"; d.rationale = `Qwen unavailable (${e.message}); deterministic engine acted. ` + d.rationale; return d; }
}
function decideStub(s, rules, capitalUsd) {
  const orders = [];
  for (const g of s.gaps.slice(0, 6)) {
    const m = /^([A-Z0-9.]+)\s+([+-]?\d+\.?\d*)%/.exec(g); if (!m) continue;
    const sym = m[1], gap = Number(m[2]);
    if (gap <= -1) orders.push({ action: "BUY", symbol: sym, usd: Math.round(capitalUsd * 0.1), reason: "discount-buy" });
    else if (gap >= 1.5) orders.push({ action: "SELL", symbol: sym, usd: Math.round(capitalUsd * 0.1), reason: "premium-trim" });
  }
  return { trigger: orders.length ? "rebalance" : "hold", rationale: "Deterministic stub (no Qwen key).", orders };
}

// ── adversarial auditor ──────────────────────────────────────────────────────
export async function audit(decision) {
  const orders = decision?.orders || []; const nav = metrics().navUsd || state.capitalUsd; const probs = [];
  for (const o of orders) {
    if (!o.symbol || !o.action || Number(o.usd || 0) <= 0) probs.push("malformed order");
    if (Number(o.usd || 0) > nav * 0.25) probs.push(`${o.symbol} >25% NAV`);
    if (o.action === "SELL" && !(state.book.get(o.symbol)?.qty > 0)) probs.push(`SELL ${o.symbol} not held`);
    if (o.action === "BUY" && Number(o.usd) > state.cash + orders.filter(x => x.action === "SELL").reduce((a, x) => a + Number(x.usd || 0), 0)) probs.push(`BUY ${o.symbol} exceeds cash`);
  }
  if (probs.length) return { verdict: "reject", reason: "Deterministic audit: " + probs.join("; ") };
  if (!Q.apiKey) return { verdict: "pass", reason: "deterministic audit: within bounds" };
  try {
    const t = await qwen([{ role: "system", content: "You are AfterHours' adversarial AUDITOR. Reject any plan that SELLs a held-less symbol, BUYs beyond cash, exceeds 25% of NAV per order, or is malformed. Prefer finding the flaw. Return ONLY JSON {\"verdict\":\"pass|reject\",\"reason\":\"1 sentence\"}." },
      { role: "user", content: `NAV $${metrics().navUsd} cash $${usd(state.cash)} exposed $${usd(exposureUsd())}. Holdings: ${holdingsSummary()}. Plan: ` + JSON.stringify(orders) }], 300, 6500, 1);
    return { verdict: String(t).toLowerCase().includes("reject") ? "reject" : "pass", reason: String(t).replace(/```/g, "").slice(0, 200) };
  } catch { return { verdict: "pass", reason: "auditor unreachable → deterministic pass" }; }
}
function exposureUsd() { let v = 0; for (const p of state.book.values()) v += p.qty * p.avgCost; return v; }

// ── seed + execute (paper, cost-basis, fees) ─────────────────────────────────
function priceOf(gaps, sym) { return Number((gaps.find(g => (g.symbol || "").toUpperCase() === String(sym).toUpperCase()) || {}).price || 0); }
function seed(gaps, capitalUsd) {
  // core: the LARGEST-|gap| rToken names (actionable premiums/discounts)
  const core = gaps.filter(g => g.price > 0 && !g.hedge).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, 6);
  const hedge = gaps.filter(g => g.hedge && g.price > 0).slice(0, 1); // BTC sleeve
  if (!core.length && !hedge.length) return;
  if (process.env.AH_DEBUG) console.error("[seed] gaps:", gaps.slice(0, 10).map(g => `${g.symbol}:${Number(g.gapPct).toFixed(2)}`).join(", "), "| core:", core.map(g => g.symbol).join(","), "| hedge:", hedge.map(g => g.symbol).join(","));
  const budget = capitalUsd * 0.98;
  const hedgeBudget = hedge.length ? budget * 0.15 : 0;         // 15% crypto hedge sleeve
  const coreBudget = budget - hedgeBudget;
  state.cash = capitalUsd;
  const per = core.length ? coreBudget / core.length : 0;
  for (const g of core) { const ref = g.price / (1 + (Number(g.gapPct) || 0) / 100); buy(g.symbol, per, ref > 0 ? ref : g.price, "seed@reference"); }
  for (const g of hedge) { buy(g.symbol, hedgeBudget, g.price, "seed@hedge"); }
  state.seeded = true;
}
function buy(sym, notional, px, reason) {
  const qty = notional / px; const fee = notional * FEE, slipCost = notional * SLIP;
  const cur = state.book.get(sym) || { qty: 0, avgCost: 0 };
  cur.avgCost = (cur.avgCost * cur.qty + (notional + fee + slipCost)) / (cur.qty + qty) || px;
  cur.qty += qty; state.book.set(sym, cur);
  state.cash -= (notional + fee + slipCost); state.fees += fee; state.slippage += slipCost; state.traded += notional;
  return { action: "BUY", symbol: sym, usd: usd(notional), px, qty: Number(qty.toFixed(6)), fee: usd(fee), reason };
}
function sell(sym, notional, px, reason) {
  const cur = state.book.get(sym); if (!cur || cur.qty <= 0) return null;
  const qty = Math.min(notional / px, cur.qty); if (qty <= 0) return null;
  const gross = qty * px; const fee = gross * FEE, slipCost = gross * SLIP; const net = gross - fee - slipCost;
  const pnl = gross - cur.avgCost * qty;
  cur.qty -= qty; state.book.set(sym, cur);
  state.cash += net; state.fees += fee; state.slippage += slipCost; state.traded += gross;
  state.closed.push({ symbol: sym, pnl });
  return { action: "SELL", symbol: sym, usd: usd(gross), px, qty: Number(qty.toFixed(6)), pnl: usd(pnl), fee: usd(fee), reason };
}
function execute(orders, gaps) {
  const fills = [];
  for (const o of orders) { const px = priceOf(gaps, o.symbol); if (!px) continue; const f = o.action === "BUY" ? buy(o.symbol, Number(o.usd), px, o.reason || "agent") : sell(o.symbol, Number(o.usd), px, o.reason || "agent"); if (f) fills.push(f); }
  return fills;
}

function sign(fields) { return "VIGIL-" + crypto.createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 32); }

// ── metrics (honest strategy stats) ──────────────────────────────────────────
export function metrics() {
  let posValue = 0; for (const p of state.book.values()) posValue += p.qty * p.avgCost;
  const navUsd = state.cash + posValue;
  const navs = state.nav.map(x => x.nav);
  const ret = (navs.length > 1) ? (navs[navs.length - 1] / navs[0] - 1) * 100 : (state.seeded ? ((navUsd / state.capitalUsd) - 1) * 100 : 0);
  // Sharpe on periodic NAV returns
  let sharpe = 0;
  if (navs.length > 2) { const rs = []; for (let i = 1; i < navs.length; i++) rs.push(navs[i] / navs[i - 1] - 1); const mean = rs.reduce((a, b) => a + b, 0) / rs.length; const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length) || 1e-9; sharpe = (mean / sd) * Math.sqrt(365); }
  // max drawdown
  let peak = -Infinity, mdd = 0; for (const v of navs.length ? navs : [navUsd]) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const wins = state.closed.filter(c => c.pnl > 0).length;
  const winRate = state.closed.length ? (wins / state.closed.length) * 100 : 0;
  return {
    navUsd: usd(navUsd), cashUsd: usd(state.cash), exposureUsd: usd(exposureUsd()), capitalUsd: state.capitalUsd,
    returnPct: usd(ret), sharpe: usd(sharpe), maxDrawdownPct: usd(mdd * 100), winRate: usd(winRate),
    closedTrades: state.closed.length, turnoverUsd: usd(state.traded), feesUsd: usd(state.fees), slippageUsd: usd(state.slippage),
    trades: state.decisions.reduce((a, d) => a + (d.executed || []).length, 0), runs: state.decisions.length, sampledPoints: navs.length,
  };
}

// ── the run ──────────────────────────────────────────────────────────────────
export async function runSleep({ venue, rules, capitalUsd, deep } = {}) {
  if (venue) state.venue = venue;
  if (rules != null) state.rules = rules;
  if (capitalUsd) state.capitalUsd = Number(capitalUsd);
  const gaps = await sense(state.venue);
  if (!gaps.length) return { ok: true, venue: state.venue, acted: false, reason: "no tradable gaps right now", metrics: metrics() };
  if (!state.seeded) seed(gaps, state.capitalUsd);
  const decision = await decide(gaps, state.rules, state.capitalUsd, deep ? 80000 : undefined);
  const auditRes = await audit(decision);
  let executed = [];
  if (auditRes.verdict === "pass") executed = execute(decision.orders, gaps);
  const m = metrics(); state.nav.push({ at: Date.now(), nav: m.navUsd });
  const rec = { at: Date.now(), venue: state.venue, model: decision.model || (Q.apiKey ? Q.model : "stub"), rules: state.rules || "(default)", capitalUsd: state.capitalUsd, trigger: decision.trigger, rationale: decision.rationale, proposed: decision.orders, audit: auditRes, executed, navAfter: m.navUsd };
  rec.signature = sign({ at: rec.at, venue: rec.venue, trigger: rec.trigger, proposed: rec.proposed, executed: rec.executed });
  state.decisions.push(rec);
  return { ok: true, venue: state.venue, model: rec.model, trigger: rec.trigger, rationale: rec.rationale, audit: auditRes, executed, signature: rec.signature, counts: { proposed: decision.orders.length, filled: executed.length }, metrics: metrics() };
}

export function arm(cfg = {}) { state.armed = true; if (cfg.venue) state.venue = cfg.venue; if (cfg.rules != null) state.rules = cfg.rules; if (cfg.capitalUsd) state.capitalUsd = Number(cfg.capitalUsd); state.cash = state.cash || 0; return status(); }
export function disarm() { state.armed = false; return status(); }
export function isArmed() { return state.armed; }
export function status() { return { armed: state.armed, venue: state.venue, rules: state.rules, capitalUsd: state.capitalUsd, model: Q.apiKey ? Q.model : "stub (no key)", qwen: Q.apiKey ? "live" : "unset", book: [...state.book.entries()].filter(([,p])=>p.qty>1e-9).map(([s,p])=>({symbol:s,qty:Number(p.qty.toFixed(4)),avgCost:Number(p.avgCost.toFixed(2))})), seeded: state.seeded, equity: state.nav.map(x=>({at:x.at,nav:x.nav})), ...metrics() }; }
export function listSleepDecisions(limit = 30) { return [...state.decisions].reverse().slice(0, limit); }

export function nightReport() {
  const m = metrics(); const d = state.decisions;
  const summary = d.length
    ? `In ${d.length} autonomous pass(es) overnight, the agent ${m.trades} fill(s): ${state.closed.length} closed (${usd(m.winRate)}% win) and ${[...state.book.values()].filter(p=>p.qty>1e-9).length} held. Gross return ${usd(m.returnPct)}% (NAV $${m.navUsd}) with $${m.feesUsd} fees + $${m.slippageUsd} slippage.`
    : "No overnight runs yet.";
  return { runs: d.length, trades: m.trades, closedTrades: m.closedTrades, winRate: m.winRate, returnPct: m.returnPct, maxDrawdownPct: m.maxDrawdownPct, sharpe: m.sharpe, feesUsd: m.feesUsd, slippageUsd: m.slippageUsd, navUsd: m.navUsd, model: Q.apiKey ? Q.model : "stub", summary, lastSignature: d.at(-1)?.signature || "—" };
}
