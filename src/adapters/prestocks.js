// PreStocks adapter — REAL, verified. GET https://prestocks.com/api/prestocks
// returns tokenized PRE-IPO stocks (Anduril, Anthropic, OpenAI, SpaceX, ...).
// Verified fields: name, symbol, description, contract_address, markPrice,
// markValuation, tokenPrice, impliedValuation, supply.
import { config } from "../config.js";
import { cachedFetch } from "../lib/http.js";

export async function listPreStocks() {
  const raw = await cachedFetch(config.sources.prestocks.base, { ttlMs: config.cacheTtlMs });
  if (!Array.isArray(raw)) throw new Error("PreStocks: expected array response");
  return raw.map((r, i) => ({
    id: `prestocks:${r.symbol}`,
    issuer: "prestocks",
    symbol: r.symbol,
    name: r.name,
    description: r.description,
    image: r.image,
    url: r.external_url,
    contractAddress: r.contract_address,
    markPrice: r.markPrice,
    markValuation: r.markValuation,
    tokenPrice: r.tokenPrice,
    impliedValuation: r.impliedValuation,
    supply: r.supply,
    // Dislocation between the issued token price and the issuer's mark price.
    // (tokenPrice vs markPrice) — a real, verified valuation-premium signal.
    markPremium: r.markPrice ? (r.tokenPrice - r.markPrice) / r.markPrice : null,
    _raw_i: i,
  }));
}