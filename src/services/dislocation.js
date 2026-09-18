// Dislocation engine — finds and ranks real, verified pricing gaps.
//
// Two signals, both computable from VERIFIED live data:
//  1. issuer-internal premium : PreStocks tokenPrice vs its own markPrice
//  2. cross-issuer spread     : same underlying priced by ≥2 issuers (e.g.
//                               OpenAI on PreStocks vs Tessera)
import { buildUniverse, underlyingKey } from "./oracle.js";

export async function findDislocations({ rankLimit = 20 } = {}) {
  const universe = await buildUniverse();
  const rows = [];

  for (const inst of universe.instruments) {
    // 1) Issuer-internal premium (token price trading away from mark).
    if (typeof inst.markPremium === "number" && inst.markPrice > 0) {
      rows.push({
        type: "issuer_premium",
        symbol: inst.symbol,
        issuer: inst.issuer,
        underlying: underlyingKey(inst.symbol),
        markPrice: inst.markPrice,
        tokenPrice: inst.tokenPrice,
        gapBps: Math.round(inst.markPremium * 10_000),
        direction: inst.markPremium > 0 ? "token_premium" : "token_discount",
        note: `${inst.symbol}: token trades ${inst.markPremium >= 0 ? "+" : ""}${(
          inst.markPremium * 100
        ).toFixed(2)}% vs issuer mark price`,
      });
    }
  }

  // 2) Cross-issuer spread on the same underlying.
  const byUnderlying = new Map();
  for (const inst of universe.instruments) {
    const k = underlyingKey(inst.symbol);
    if (!byUnderlying.has(k)) byUnderlying.set(k, []);
    byUnderlying.get(k).push(inst);
  }
  for (const [key, group] of byUnderlying) {
    const withMark = group.filter((g) => typeof g.markPrice === "number" && g.markPrice > 0);
    if (withMark.length < 2) continue;
    const max = Math.max(...withMark.map((g) => g.markPrice));
    const min = Math.min(...withMark.map((g) => g.markPrice));
    rows.push({
      type: "cross_issuer",
      symbol: key,
      issuer: withMark.map((g) => `${g.issuer}:${g.symbol}`).join(" vs "),
      underlying: key,
      gapBps: Math.round(((max - min) / min) * 10_000),
      minPrice: min,
      maxPrice: max,
      note: `${key} priced ${((max - min) / min * 100).toFixed(2)}% apart across issuers`,
    });
  }

  rows.sort((a, b) => Math.abs(b.gapBps) - Math.abs(a.gapBps));
  return {
    market: universe.market,
    count: rows.length,
    dislocations: rows.slice(0, rankLimit),
    generatedAt: Date.now(),
  };
}