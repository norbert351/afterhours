// Tessera adapter — REAL, verified. GET https://rest-api.tessera.pe/v1/public/token-details
// returns tokenized PRIVATE EQUITY (T-OpenAI, T-Kalshi, T-SpaceX).
// Verified fields: id, name, symbol, code, sector, mint, markPrice, holders, markValuation.
import { config } from "../config.js";
import { cachedFetch } from "../lib/http.js";

export async function listTessera() {
  const raw = await cachedFetch(config.sources.tessera.base, { ttlMs: config.cacheTtlMs });
  if (!Array.isArray(raw)) throw new Error("Tessera: expected array response");
  return raw.map((r) => ({
    id: `tessera:${r.symbol}`,
    issuer: "tessera",
    symbol: r.symbol,
    name: r.name,
    code: r.code,
    sector: r.sector,
    mintAddress: r.mint,
    markPrice: r.markPrice,
    markValuation: r.markValuation,
    holders: r.holders,
    // Tessera exposes a single mark price (no separate token price) for now.
    markPremium: null,
  }));
}