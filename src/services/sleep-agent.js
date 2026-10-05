// sleep-agent.js — AfterHours Sleep Mode: an autonomous agent that trades the
// weekend gap while you sleep. The LLM (Qwen, via Bitget's sponsor endpoint) is the
// DECISION-MAKER; a second Qwen pass AUDITS the plan before anything is recorded.
// Execution is PAPER (honest) with a real cost-basis ledger — no real money until
// a venue is explicitly armed. Every decision is signed and auditable.
import crypto from "node:crypto";
import { config } from "../config.js";
import { bitgetArbUniverse } from "./bitget-arb.js";
import { bnbUniverse } from "./bnb.js";

const Q = config.qwen;

// ── sensors ──────────────────────────────────────────────────────────────────
async function sense(venue) {
  try {
    if (venue === "bitget") { const d = await bitgetArbUniverse(); return (d.gaps || []).map(g => ({ symbol: g.symbol, gapPct: g.gapPct, price: g.rTokenPriceUsd, ref: g.referenceUsd })); }
    if (venue === "bnb") { const d = await bnbUniverse(); return (d.gaps || []).filter(g=>!g.error).map(g => ({ symbol: g.symbol, gapPct: g.gapPct, price: g.tokenPrice })); }
    return [];
  } catch (e) { return []; }
}

// compact state for the LLM (keep token budget small)
function buildState(venue, gaps, navUsd) {
  return {
    venue, navUsd, cashUsd: navUsd,
    market: "closed", // gap thesis is strongest when the reference is frozen
    gaps: gaps.slice(0, 20).map(g => `${g.symbol} ${g.gapPct>0?"+":""}${g.gapPct.toFixed(2)}% ${g.price??""}`),
  };
}

// ── Qwen decision-maker ──────────────────────────────────────────────────────
function parseDecision(text) {
  let t = String(text).trim();
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) t = f[1].trim();
  const s = t.indexOf("{"); const e = t.lastIndexOf("}");
  if (s < 0 || e <= s) throw new Error("no JSON in qwen output");
  const o = JSON.parse(t.slice(s, e + 1));
  return { trigger: String(o.trigger || "rebalance"), rationale: String(o.rationale || ""), orders: o.orders || [] };
}

async function qwen(messages, maxTokens) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${Q.base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Q.apiKey}` },
        body: JSON.stringify({ model: Q.model, messages, temperature: 0.2, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(55_000),
      });
      if (!res.ok) throw new Error(`llm http ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const j = await res.json();
      const text = j?.choices?.[0]?.message?.content;
      if (!text) throw new Error("llm empty completion");
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export function canUseQwen() { return !!Q.apiKey; }

async function decide(state, rules, capitalUsd) {
  if (!Q.apiKey) return decideStub(state, rules, capitalUsd);
  const sys = "You are AfterHours' autonomous overnight agent. You manage a tokenized-equity weekend-gap book while the human sleeps. The reference price is frozen (market closed) and the token trades 24/7; a POSITIVE gap means the token trades ABOVE its frozen ref (sell/hedge the premium), a NEGATIVE gap means it trades BELOW (buy the discount). You are the decision-maker: pick a small, risk-controlled set of orders. Never propose an order above 25% of NAV. Always stay within cash. Prefer few, high-conviction orders over overtrading.";
  const user = [
    `Capital: $${capitalUsd} (NAV).`,
    `Your rules: ${rules || "rotate to the biggest discount over 2%, cap any position at 25% of NAV, prefer liquid names, no overtrading."}`,
    `Venue: ${state.venue} — market ${state.market}.`,
    "Live gaps (symbol %gap tokenPrice):",
    state.gaps.join("\n") || "(no gaps right now)",
    "",
    "Return ONLY JSON: {\"trigger\":\"rebalance|hold|hedge\",\"rationale\":\"2-3 sentences\",\"orders\":[{\"action\":\"BUY\"|\"SELL\",\"symbol\":\"<SYM>\",\"usd\":<amount USD>,\"reason\":\"short\"}]}",
  ].join("\n");
  const text = await qwen([{role:"system",content:sys},{role:"user",content:user}], 2000);
  return parseDecision(text);
}

function decideStub(state, rules, capitalUsd) {
  const orders = [];
  for (const g of state.gaps.slice(0,5)) {
    const m = /^\s*([A-Z0-9.]+)\s+([+-]?\d+\.?\d*)%/.exec(g);
    if (!m) continue;
    const sym = m[1], gap = Number(m[2]);
    if (gap <= -2) orders.push({ action: "BUY", symbol: sym, usd: Math.round(capitalUsd*0.1), reason: "discount-nibble" });
    else if (gap >= 2) orders.push({ action: "SELL", symbol: sym, usd: Math.round(capitalUsd*0.1), reason: "premium-trim" });
  }
  return { trigger: orders.length ? "rebalance" : "hold", rationale: "Deterministic stub (no Qwen key): traded the biggest |gap| beyond 2%.", orders };
}

// ── Qwen auditor (adversarial second opinion) ───────────────────────────────
export async function audit(state, decision) {
  const ordered = decision?.orders || [];
  const nav = Number(state?.navUsd || 0);
  const reason = [];
  for (const o of ordered) { if (Number(o.usd||0) > nav*0.25) reason.push(`${o.symbol} >25% NAV`); if (!o.symbol||!o.action||Number(o.usd||0)<=0) reason.push("malformed"); }
  if (reason.length) return { verdict: "reject", reason: reason.join("; ") };
  if (!Q.apiKey) return { verdict: "pass", reason: "deterministic audit: within caps" };
  try {
    const sys = "You are AfterHours' independent, adversarial AUDITOR. Reject the plan if any single order exceeds 25% of NAV, is malformed, or trades outside cash. Prefer finding the flaw. Return ONLY JSON {\"verdict\":\"pass|reject\",\"reason\":\"1 sentence\"}.";
    const text = await qwen([{role:"system",content:sys},{role:"user",content:`NAV $${nav} cash $${nav}. Plan: `+JSON.stringify(ordered)}], 300);
    const verdict = String(text).toLowerCase().includes("reject") ? "reject" : "pass";
    return { verdict, reason: String(text).replace(/```/g,"").slice(0,200) };
  } catch (e) { return { verdict: "pass", reason: "auditor unreachable → deterministic pass" }; }
}

// ── paper book (real cost-basis) ─────────────────────────────────────────────
let book = new Map(); // venue|symbol -> {qty, avgCost}
let decisions = [];

function paperExecute(venue, orders, gaps) {
  const fills = [];
  for (const o of orders) {
    const g = gaps.find(x => (x.symbol||"").toUpperCase() === String(o.symbol).toUpperCase());
    if (!g || !g.price) { continue; }
    const px = Number(g.price), usd = Number(o.usd||0);
    const key = `${venue}|${o.symbol}`;
    if (o.action === "BUY") {
      const cur = book.get(key) || { qty: 0, avgCost: 0 };
      const qty = usd / px;
      cur.avgCost = (cur.avgCost*cur.qty + usd) / (cur.qty+qty) || px;
      cur.qty += qty;
      book.set(key, cur);
      fills.push({ action: "BUY", symbol: o.symbol, usd, px, qty, reason: o.reason });
    } else if (o.action === "SELL") {
      const cur = book.get(key) || { qty: 0, avgCost: px };
      const qty = Math.min(usd/px, cur.qty);
      if (qty <= 0) continue;
      const pnl = (px - cur.avgCost) * qty;
      cur.qty -= qty;
      book.set(key, cur);
      fills.push({ action: "SELL", symbol: o.symbol, usd: qty*px, px, qty, pnl, reason: o.reason });
    }
  }
  return fills;
}

function signManifest(fields) {
  return "VIGIL-" + crypto.createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0,32);
}

// ── the run ──────────────────────────────────────────────────────────────────
export async function runSleep({ venue = "bitget", rules = "", capitalUsd = 100 } = {}) {
  const gaps = await sense(venue);
  if (!gaps.length) return { ok: true, venue, model: Q.model, acted: false, reason: "no tradable gaps right now" };
  const state = buildState(venue, gaps, capitalUsd);
  const decision = await decide(state, rules, capitalUsd);
  const auditRes = await audit(state, decision);
  let outcomes = [];
  let executed = false;
  if (auditRes.verdict === "pass") {
    const fills = paperExecute(venue, decision.orders, gaps);
    outcomes = fills;
    executed = fills.length > 0;
  }
  const rec = {
    at: Date.now(), venue, model: Q.apiKey ? Q.model : "stub", rules: rules||"(default)",
    capitalUsd, trigger: decision.trigger, rationale: decision.rationale,
    proposed: decision.orders, audit: auditRes, executed: outcomes, naV: navOf(venue),
  };
  rec.signature = signManifest({ at: rec.at, venue, trigger: rec.trigger, proposed: rec.proposed, executed: rec.executed });
  decisions.push(rec);
  return { ok: true, venue, model: Q.apiKey ? Q.model : "stub", trigger: rec.trigger, rationale: rec.rationale, audit: auditRes, executed: rec.executed, signature: rec.signature, counts: { proposed: decision.orders.length, filled: outcomes.length } };
}

function navOf(venue) {
  let v = 0;
  for (const [k, p] of book) if (k.startsWith(venue + "|")) v += p.qty * p.avgCost;
  return Math.round(v);
}

export function sleepStatus() {
  const booked = Object.fromEntries([...book.entries()].map(([k,p]) => [k, { qty: round(p.qty), avgCost: round(p.avgCost) }]));
  return { model: Q.apiKey ? Q.model : "stub (no key)", venueConfigured: Q.apiKey ? "qwen" : "stub", book: booked, decisions: decisions.length };
}
export function listSleepDecisions(limit = 30) { return [...decisions].reverse().slice(0, limit); }

// Night Report — plain-English signed summary of the agent's overnight work
export function nightReport() {
  const d = decisions;
  const fills = d.flatMap(x => x.executed || []);
  const realized = fills.filter(f=>f.pnl!=null).reduce((a,f)=>a+f.pnl,0);
  const buys = fills.filter(f=>f.action==="BUY").length, sells = fills.filter(f=>f.action==="SELL").length;
  const rejects = d.filter(x=>x.audit?.verdict==="reject").length;
  const last = d[d.length-1];
  return {
    runs: d.length, buys, sells, realizedPnlUsd: Math.round(realized*100)/100, rejectedPlans: rejects,
    lastTrigger: last?.trigger || "none", lastSignature: last?.signature || "—",
    summary: d.length
      ? `AfterHours ran ${d.length} natural-language overnight pass(es)${sells?"":""}. ${Q.apiKey?"Qwen (qwen3.8-max) decided":""} ${buys} discount-buys + ${sells} premium-sells; ${d.length>0?rejects+" plan(s) rejected by the auditor before executing":""}. Realized paper P&L: $${Math.round(realized*100)/100}.`
      : "No overnight runs yet.",
    signed: d.length ? d.at(-1).signature : "—",
  };
}
function round(n) { return Number(n.toFixed(6)); }
export function _resetBookForTest(){ book = new Map(); decisions = []; }