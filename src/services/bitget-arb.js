// bitget-arb.js — AfterHours Bitget Arbitrage surface (Alpha Factory · Arbitrage).
// Signal: 7×24 Bitget rToken price (R<SYM>USDT) vs its native US reference.
// During NYSE closure the reference is FROZEN while the rToken keeps trading —
// divergence is the arbitrage signal, exactly the S2 Arbitrage sub-theme.
// Honesty: reference fetched sparingly (refreshed only while the market is
// open; reused while closed because it cannot move); implausible gaps flagged.
import { isMarketOpen, getReferencePrice, batchReferencePrices } from "../adapters/twelvedata.js";
import { bitgetRPrice, US_UNIVERSE } from "../adapters/bitget-r.js";
import { annotateGaps, byNetEdgeDesc, COST_MODEL, LIQUIDITY, LARGE_GAP_PCT, isActionableRow } from "./fairvalue.js";
import { annotateActions, rotationLeg, actionLabel } from "./fairvalue.js";
import { recordDecision, listDecisions } from "./paper-log.js";
import fs from "node:fs";

// Bitget rToken liquidity tier from the venue's own 24h USDT volume.
export function bitgetLiquidityTier(g) {
  const v = Number(g?.volumeUsd24h || 0);
  if (!Number.isFinite(v) || v <= 0) return LIQUIDITY.UNVERIFIED;
  if (v < 500) return LIQUIDITY.INSUFFICIENT;
  if (v < 25_000) return LIQUIDITY.LIMITED;
  return LIQUIDITY.VERIFIED;
}
export function bitgetGapVerified(g) {
  return !(Number.isFinite(g?.gapPct) && Math.abs(g.gapPct) > LARGE_GAP_PCT);
}

const GAP_PLAUSIBLE_PCT = 10;
const REF_FILE = new URL("../../.bitget-refs.json", import.meta.url).pathname;

// Reference cache: while the market is closed the reference is FROZEN, so we
// persist it to disk and reuse across restarts (free-tier quota is tiny).
let refCache = new Map();
try { const raw = JSON.parse(fs.readFileSync(REF_FILE, "utf8")); for (const [k, v] of raw) refCache.set(k, v); } catch { /* none yet */ }
function saveRefs() { try { fs.writeFileSync(REF_FILE, JSON.stringify([...refCache])); } catch { /* non-fatal */ } }
export function _resetRefCacheForTest() { refCache = new Map(); }

// Populate missing references in ONE batched request; keep whatever we have on failure.
async function refreshReferences() {
  const open = isMarketOpen();
  const missing = US_UNIVERSE.filter((s) => !refCache.get(s));
  const stale = US_UNIVERSE.every((s) => refCache.get(s)) && ![...refCache.values()].every((c) => Date.now() - c.at < (open ? 10 * 60_000 : 24 * 3600_000));
  if (!missing.length && (open ? !stale : true)) return;
  try {
    const batch = await batchReferencePrices(open && !missing.length ? US_UNIVERSE : missing);
    let got = 0;
    for (const [sym, r] of Object.entries(batch)) { refCache.set(sym, { price: r.price, at: Date.now() }); got++; }
    if (got) saveRefs();
  } catch { /* keep existing cache (honest: reuse frozen refs) */ }
}

function referenceFor(symbol) { return refCache.get(symbol) || { error: "no reference" } };

export async function bitgetArbUniverse() {
  const marketOpen = isMarketOpen();
  await refreshReferences();
  const gaps = [];
  const flagged = [];
  const errors = [];
  for (const sym of US_UNIVERSE) {
    const tok = await bitgetRPrice(sym);
    if (!tok || !tok.priceUsd) { errors.push({ symbol: sym, error: "no Bitget rToken ticker" }); continue; }
    const ref = referenceFor(sym);
    if (ref.error || !ref.price) { errors.push({ symbol: sym, error: ref.error || "no reference" }); continue; }
    const gapPct = ((tok.priceUsd - ref.price) / ref.price) * 100;
    const row = {
      symbol: sym, rSymbol: tok.rSymbol, rTokenPriceUsd: tok.priceUsd,
      referenceUsd: ref.price, gapPct, change24h: tok.change24h,
      volumeUsd24h: Number(tok.volumeUsd24h || 0),
      // Reference honesty (Phase 15): every reference carries source + capture + status.
      referenceSource: "TwelveData (US native)",
      referenceCapturedAt: ref.at || null,
      referenceStatus: marketOpen ? "LIVE" : "FROZEN",
    };
    if (Math.abs(gapPct) > GAP_PLAUSIBLE_PCT) { row.outlier = true; flagged.push(row); }
    else gaps.push(row);
  }
  // Residual/fair-value layer: adjust each gap for the broad-market move, subtract
  // estimated execution costs, and rank by NET EDGE (never by raw gap). SPY rToken
  // is the market factor; the agent may WAIT when no residual edge survives costs.
  const { marketMovePct } = annotateGaps(gaps, { marketRe: /^(R?SPY(USDT)?|SPYB|SPYx)$/i, liquidityFn: bitgetLiquidityTier, plausibilityFn: bitgetGapVerified });
  annotateActions(gaps);
  gaps.sort(byNetEdgeDesc);
  const actionable = gaps.filter((g) => g.actionable);
  const candidates = gaps.filter((g) => g.hasEdge);
  return {
    market: { open: marketOpen, at: Date.now(), note: marketOpen ? "NYSE OPEN" : "NYSE CLOSED · reference frozen, rToken 7x24 keeps trading (the arbitrage window)" },
    chain: "bitget", source: "bitget-uta-v3-rToken · twelvedata-reference",
    universe: US_UNIVERSE.length, marketFactorMovePct: marketMovePct, marketFactorAvailable: marketMovePct != null,
    costModelPct: COST_MODEL.feePct + COST_MODEL.slippagePct + COST_MODEL.bufferPct,
    reference: {
      source: "TwelveData (US native)", status: marketOpen ? "LIVE" : "FROZEN",
      capturedAt: Math.max(0, ...[...refCache.values()].map((c) => c.at || 0)) || null,
      note: marketOpen ? "US market open. Reference updates." : "US market closed. Reference frozen at last capture (the arbitrage baseline).",
    },
    actionableCount: actionable.length,
    actionableTop: [...actionable, ...gaps.filter((g) => !g.actionable)].slice(0, 10),
    counts: {
      tracked: US_UNIVERSE.length, signals: gaps.length,
      candidates: candidates.length,
      tradeable: actionable.length,
      noEdge: gaps.filter((g) => g.noEdge).length,
    },
    session: {
      state: marketOpen ? "OPEN" : "CLOSED",
      label: marketOpen ? "NYSE OPEN" : "NYSE CLOSED · closed-market gap",
      note: marketOpen ? "US market open. Reference updating." : "US market closed. The reference is frozen, the rToken keeps trading 7x24 (the dislocation window).",
    },
    gaps, flaggedCount: flagged.length, errors,
    generatedAt: Date.now(),
  };
}

// Is a row genuinely actionable for a position-less spot view? A discount is a BUY;
// a premium is a ROTATE only if a real discount leg exists. A premium with no
// destination leg is a WATCH (interesting, not executable) and never acts.
// (Shared helper lives in fairvalue.js so BNB + Bitget use ONE definition.)

// Paper decision: pick the top ACTIONABLE row (a discount BUY, or a premium ROTATE
// with a real second leg) and log a NAV-based paper action (no real money, Bitget S2
// accepts paper). If nothing is actionable the agent WATCHes/WAITs with a real reason.
// Persistent, auditable log.
export function bitgetPaperAction({ gaps, amountUsd = 100 } = {}) {
  const pool = (gaps || []).filter((g) => g && !g.outlier && !g.error && Number.isFinite(g.netEdgePct)).sort(byNetEdgeDesc);
  if (!pool.length) return { acted: false, decision: "WAIT", reason: "no tradable gap right now" };
  const top = pool[0];
  const act = pool.find((g) => isActionableRow(g, pool));
  if (!act) {
    const decision = top.decision === "WATCH" ? "WATCH" : "WAIT";
    const reason = top.reason || `No actionable edge. Top dislocation ${top.symbol} is a ${top.decision.toLowerCase()}, not an executable trade.`;
    const rec = { at: Date.now(), id: `${decision}-${top.symbol}-${Date.now()}`, venue: "bitget", symbol: top.symbol, rSymbol: top.rSymbol, rawGapPct: top.gapPct, residualGapPct: top.residualGapPct, netEdgePct: top.netEdgePct, decision, reason, notionalUsd: 0, model: "residual-fairvalue-rule" };
    recordDecision(rec);
    return { acted: false, decision, target: top.symbol, rawGapPct: top.gapPct, residualGapPct: top.residualGapPct, netEdgePct: top.netEdgePct, reason };
  }
  const action = act.decision; // ROTATE | BUY (spot)
  const leg = action === "ROTATE" ? rotationLeg(pool, act.symbol) : null;
  const label = actionLabel({ decision: action, symbol: act.symbol, leg, amountUsd });
  recordDecision({ at: Date.now(), id: `${action}-${act.symbol}-${Date.now()}`, venue: "bitget", symbol: act.symbol, rSymbol: act.rSymbol, rawGapPct: act.gapPct, residualGapPct: act.residualGapPct, netEdgePct: act.netEdgePct, action, from: act.symbol, to: leg ? leg.symbol : null, actionLabel: label, notionalUsd: amountUsd, model: "residual-fairvalue-rule" });
  return { acted: true, decision: action, target: act.symbol, from: act.symbol, to: leg ? leg.symbol : null, actionLabel: label, rawGapPct: act.gapPct, residualGapPct: act.residualGapPct, costPct: act.costPct, netEdgePct: act.netEdgePct, side: action, notionalUsd: amountUsd, reason: act.reason };
}
export function listBitgetDecisions(limit = 50) { return listDecisions(limit, "bitget"); }