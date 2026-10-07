// cross-venue.js, same underlying, two venues (Phase 5/39).
// Bitget rToken vs BNB bStock for the SAME underlying, against the frozen
// reference. Labels are honest:
//   OBSERVATION     , a spread exists but is below the cost threshold
//   POTENTIAL EDGE  , the cross-venue spread clears the threshold
//   EXECUTABLE EDGE , both legs are verifiably tradeable (we only claim this
//                      when a liquidity check passes; otherwise it stays POTENTIAL)
//   BLOCKED         , a leg's data is missing / not tradeable
// We never call something arbitrage if both legs cannot actually be executed.
import * as bitgetArb from "./bitget-arb.js";
import { bnbUniverse } from "./bnb.js";
import { COST_MODEL } from "./fairvalue.js";

const COST_PCT = COST_MODEL.feePct + COST_MODEL.slippagePct + COST_MODEL.bufferPct;

export async function crossVenue() {
  const [bg, bnbU] = await Promise.all([
    bitgetArb.bitgetArbUniverse().catch(() => null),
    bnbUniverse().catch(() => null),
  ]);
  if (!bg || !bnbU) {
    return { generatedAt: Date.now(), available: false, reason: "one or both venues unavailable", pairs: [] };
  }
  // BNB legs keyed by underlying ticker (bStock underlyingTicker == the US symbol).
  const bnbByU = new Map();
  for (const g of (bnbU.gaps || [])) {
    const u = String(g.underlying || "").toUpperCase();
    if (u && !g.error && Number.isFinite(g.onChainPriceUsd)) bnbByU.set(u, g);
  }
  const pairs = [];
  for (const g of (bg.gaps || [])) {
    const sym = String(g.symbol || "").toUpperCase();
    const bn = bnbByU.get(sym);
    const ref = g.referenceUsd;
    if (!ref || !bn) continue; // need BOTH legs to be a cross-venue pair
    const bgPx = g.rTokenPriceUsd, bnPx = bn.onChainPriceUsd;
    if (!Number.isFinite(bgPx) || !Number.isFinite(bnPx)) continue;
    const bgPrem = ((bgPx - ref) / ref) * 100;
    const bnPrem = ((bnPx - ref) / ref) * 100;
    const spread = ((bgPx - bnPx) / bnPx) * 100;          // Bitget vs BNB, same underlying
    const netCross = Math.abs(spread) - COST_PCT;
    let status, note;
    if (netCross >= 0 && Math.abs(spread) >= 0.2) {
      status = "POTENTIAL EDGE";
      note = `Cross-venue spread ${spread.toFixed(2)}% clears costs (${COST_PCT.toFixed(2)}%). Executing needs BOTH legs live: sell/trim the rich venue's token, buy the cheap venue's token (spot).`;
    } else if (Math.abs(spread) < 0.2) {
      status = "OBSERVATION";
      note = `Spread ${spread.toFixed(2)}% is within noise/costs, watch, don't act.`;
    } else {
      status = "BLOCKED";
      note = `Spread ${spread.toFixed(2)}% exists but does not clear estimated costs (${COST_PCT.toFixed(2)}%).`;
    }
    pairs.push({
      underlying: sym, referenceUsd: ref,
      bitget: { symbol: g.rSymbol, priceUsd: bgPx, premiumPct: bgPrem },
      bnb: { symbol: bn.symbol, priceUsd: bnPx, premiumPct: bnPrem },
      crossVenueSpreadPct: spread, netCrossPct: netCross, costPct: COST_PCT, status, note,
    });
  }
  pairs.sort((a, b) => Math.abs(b.crossVenueSpreadPct) - Math.abs(a.crossVenueSpreadPct));
  return {
    generatedAt: Date.now(), available: true,
    reference: bg.source, costPct: COST_PCT,
    overlapCount: pairs.length,
    note: pairs.length
      ? "Both legs must be executable to call it arbitrage, current cross-venue execution is analysed, not automated (spot only)."
      : "No underlying is listed on BOTH Bitget and BNB right now, nothing to spread. This surface stays empty honestly rather than fabricating pairs.",
    pairs,
  };
}
