// Jupiter Price v3 — official xStocks data carried keylessly on the same rail
// the vault executes through (api.jup.ag — verified reachable from this VM).
// Per mint it returns:
//   usdPrice            — on-chain last-swap USD price
//   stockData.price     — the OFFICIAL xStocks print (xStocks publish through
//                         this channel; includes mcap + updatedAt)
//   scaledUiConfig      — the REBASE multiplier schedule: current multiplier,
//                         next multiplier + effective timestamp
//   liquidity           — pool liquidity USD (a better volume proxy)
//   priceChange24h
import { cachedFetch } from "../lib/http.js";
import { XSTOCKS } from "./xstocks.js";

const BASE = "https://api.jup.ag/price/v3";

export async function xstockOfficialData() {
  const mints = Object.values(XSTOCKS).map((c) => c.mint).join(",");
  const raw = await cachedFetch(`${BASE}?ids=${mints}`, { ttlMs: 30_000, retries: 2 });
  if (!raw || typeof raw !== "object") throw new Error("Jupiter price: unexpected response");
  const out = {};
  for (const [mint, v] of Object.entries(raw)) {
    const sym = Object.keys(XSTOCKS).find((s) => XSTOCKS[s].mint === mint);
    if (!sym || !v) continue;
    out[sym] = {
      onChainUsd: Number(v.usdPrice) || null,
      officialUsd: v.stockData?.price != null ? Number(v.stockData.price) : null,
      mcapUsd: v.stockData?.mcap ?? null,
      officialUpdatedAt: v.stockData?.updatedAt ?? null,
      liquidityUsd: v.liquidity ?? null,
      priceChange24h: v.priceChange24h ?? null,
      multiplier: v.scaledUiConfig?.multiplier ?? null,
      nextMultiplier: v.scaledUiConfig?.newMultiplier ?? null,
      nextMultiplierAt: v.scaledUiConfig?.newMultiplierEffectiveAt ?? null,
    };
  }
  return out;
}