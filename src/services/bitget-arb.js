// bitget-arb.js — AfterHours Bitget Arbitrage surface (Alpha Factory · Arbitrage).
// Signal: 7×24 Bitget rToken price (R<SYM>USDT) vs its native US reference.
// During NYSE closure the reference is FROZEN while the rToken keeps trading —
// divergence is the arbitrage signal, exactly the S2 Arbitrage sub-theme.
// Honesty: reference fetched sparingly (refreshed only while the market is
// open; reused while closed because it cannot move); implausible gaps flagged.
import { isMarketOpen, getReferencePrice, batchReferencePrices } from "../adapters/twelvedata.js";
import { bitgetRPrice, US_UNIVERSE } from "../adapters/bitget-r.js";
import fs from "node:fs";

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
    };
    if (Math.abs(gapPct) > GAP_PLAUSIBLE_PCT) { row.outlier = true; flagged.push(row); }
    else gaps.push(row);
  }
  gaps.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
  return {
    market: { open: marketOpen, at: Date.now(), note: marketOpen ? "NYSE OPEN" : "NYSE CLOSED — reference frozen, rToken 7×24 keeps trading (the arbitrage window)" },
    chain: "bitget", source: "bitget-uta-v3-rToken · twelvedata-reference",
    universe: US_UNIVERSE.length, gaps, flaggedCount: flagged.length, errors,
    generatedAt: Date.now(),
  };
}

// Paper decision: pick the top |gap| in the arbitrage direction and log a NAV-based
// paper action (no real money — Bitget S2 accepts paper). Auditable decision log.
const decisions = [];
export function bitgetPaperAction({ gaps, amountUsd = 100 } = {}) {
  const pool = gaps.filter((g) => !g.outlier);
  if (!pool.length) return { acted: false, reason: "no tradable gap right now" };
  const top = pool[0];
  const side = top.gapPct >= 0 ? "short/hedge" : "buy-discount"; // premium→hedge, discount→buy
  const notional = amountUsd;
  decisions.push({ at: Date.now(), symbol: top.symbol, rSymbol: top.rSymbol, gapPct: top.gapPct, side, notionalUsd: notional, model: "arbitrage-rule" });
  return { acted: true, target: top.symbol, gapPct: top.gapPct, side, notionalUsd: notional };
}
export function listBitgetDecisions(limit = 50) { return [...decisions].reverse().slice(0, limit); }