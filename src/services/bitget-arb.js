// bitget-arb.js — AfterHours Bitget Arbitrage surface (Alpha Factory · Arbitrage).
// Signal: 7×24 Bitget rToken price (R<SYM>USDT) vs its native US reference.
// During NYSE closure the reference is FROZEN while the rToken keeps trading —
// divergence is the arbitrage signal, exactly the S2 Arbitrage sub-theme.
// Honesty: reference fetched sparingly (refreshed only while the market is
// open; reused while closed because it cannot move); implausible gaps flagged.
import { isMarketOpen, getReferencePrice } from "../adapters/twelvedata.js";
import { bitgetRPrice, US_UNIVERSE } from "../adapters/bitget-r.js";

const GAP_PLAUSIBLE_PCT = 10;

// Reference cache: while the market is closed the reference is frozen, so we
// hold the last-fetched value and do not re-hit TwelveData (free-tier quota).
let refCache = new Map(); // symbol -> {price, at}
export function _resetRefCacheForTest() { refCache = new Map(); }

async function referenceFor(symbol) {
  const open = isMarketOpen();
  const cached = refCache.get(symbol);
  const freshEnough = cached && Date.now() - cached.at < (open ? 10 * 60_000 : 24 * 3600_000);
  if (cached && (freshEnough || !open)) return cached; // closed => frozen, reuse
  try {
    const r = await getReferencePrice(symbol);
    refCache.set(symbol, { price: r.price, at: Date.now() });
    return { price: r.price, at: Date.now() };
  } catch (e) {
    if (cached) return cached; // stale-but-something better than nothing (honest)
    return { error: e.message };
  }
}

export async function bitgetArbUniverse() {
  const marketOpen = isMarketOpen();
  const gaps = [];
  const flagged = [];
  const errors = [];
  for (const sym of US_UNIVERSE) {
    const tok = await bitgetRPrice(sym);
    if (!tok || !tok.priceUsd) { errors.push({ symbol: sym, error: "no Bitget rToken ticker" }); continue; }
    const ref = await referenceFor(sym);
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