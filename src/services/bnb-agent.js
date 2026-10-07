// bnb-agent.js, AfterHours BNB *agent*: natural-language commands → real BSC
// execution. This is the "agentic" layer: a user types a plain-English rule
// (e.g. "buy IBMB if it dips 5% below mark over the weekend"), the agent parses
// it, watches the real RWA gap, and when the rule triggers it executes a BOUNDED
// fill from the exec wallet via bnb-exec, logging every decision as an auditable
// agent_action. Covers the Agentic Wallet special (NL → onchain exec) and the
// main-track "agents expected" axis. The x402 merchant (bnb-x402) self-funds it.
import { bnbExecuteSwap } from "./bnb-exec.js";
import { bnbWeb3Call } from "../adapters/bsc.js";

// Simple in-process action ledger (auditable; could persist to sqlite later).
const actions = [];
export function logBnbAction(entry) { actions.push({ at: Date.now(), ...entry }); }
export function listBnbActions(limit = 50) { return [...actions].reverse().slice(0, limit); }

// A tiny symbol cache so the agent resolver doesn't hammer the RWA Data API.
let universeCache = null;
let universeAt = 0;
async function tokensNow() {
  if (universeCache && Date.now() - universeAt < 60000) return universeCache;
  const all = [];
  for (const plat of ["bstock", "ondo"]) {
    for (let page = 1; page <= 6; page++) {
      const r = await bnbWeb3Call("/api/v1/dex/market/rwa/tokens", {
        params: { binanceChainId: "56", platformId: plat, pageSize: "100", page: String(page) },
      });
      if (r.code !== 0 || !r.data) break;
      const batch = Array.isArray(r.data) ? r.data : [];
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < 100) break;
    }
  }
  universeCache = all;
  universeAt = Date.now();
  return all;
}

// Build an alias registry over the REAL BSC universe: token symbol + underlying ticker.
export async function bnbAliasRegistry() {
  const reg = new Map(); // UPPER alias -> mint
  for (const t of await tokensNow()) {
    reg.set(String(t.tokenSymbol).toUpperCase(), t.tokenContractAddress);
    if (t.underlyingTicker) reg.set(String(t.underlyingTicker).toUpperCase(), t.tokenContractAddress);
  }
  return reg;
}

// Pure parse of an NL instruction into BNB strategy params. Reuses the
// direction/threshold/topN philosophy of the Solana strategy-parse.
export function parseBnbStrategy(text) {
  const t = (text || "").toLowerCase();
  let direction = "discount";
  if (/(below|discount|undervalued|cheap|under mark|dip)/.test(t)) direction = "discount";
  else if (/(above|premium|overvalued|expensive|over mark|gap up)/.test(t)) direction = "premium";
  let minGapPct = null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) minGapPct = Number(parseFloat(m[0]));
  let topN = null;
  const tm = t.match(/top\s+(\d+)/);
  if (tm) topN = Number(tm[1]);
  else if (/(biggest|largest|deepest|most)/.test(t)) topN = 6;
  const params = { direction };
  if (minGapPct != null) params.minGapPct = minGapPct;
  if (topN != null) params.topN = topN;
  return { strategyType: "bnb_rotate_gap", params, parsed: { ok: true, summary: summarizeBnb(t, direction, minGapPct, topN) } };
}

function summarizeBnb(t, direction, minGapPct, topN) {
  const p = [];
  p.push(direction === "premium" ? "premiums (over mark)" : "discounts (under mark)");
  if (minGapPct != null) p.push(`≥${minGapPct}%`);
  if (topN != null) p.push(`top ${topN}`);
  return `rotate into ${p.join(" · ")}`;
}

// Decide what the agent WOULD trade right now from live gaps + a strategy. Pure-ish.
export function bnbAgentDecide(gaps, params) {
  const dir = params.direction === "premium" ? "premium" : "discount";
  let pool = gaps.filter((g) => !g.error);
  if (dir === "discount") pool = pool.filter((g) => g.gapPct < 0);
  else pool = pool.filter((g) => g.gapPct > 0);
  if (params.minGapPct != null) pool = pool.filter((g) => Math.abs(g.gapPct) >= params.minGapPct);
  if (params.topN != null) pool = pool.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, params.topN);
  return pool;
}

// Execute the top target of a strategy with a bounded amount. Returns tx evidence.
export async function bnbAgentAct({ params, gaps, amountUsd = 0.2 }) {
  const targets = bnbAgentDecide(gaps, params);
  if (!targets.length) return { acted: false, reason: "no target meets the rule right now", targets: 0 };
  const top = targets[0];
  const res = await bnbExecuteSwap({ symbol: top.symbol, amountUsd });
  logBnbAction({
    kind: "swap", symbol: top.symbol, mint: top.mint, direction: params.direction,
    gapPct: top.gapPct, amountUsd, swapHash: res.swapHash, approveHash: res.approveHash,
  });
  return { acted: true, target: top.symbol, gapPct: top.gapPct, ...res };
}