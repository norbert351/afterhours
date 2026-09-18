// Twelve Data adapter — REAL, verified. Free demo key provides live NYSE
// reference prices (market-hours aware). GET /price?symbol=AAPL&apikey=demo
// verified returning {"price":"335.59"} during this build.
// This is the "frozen reference" anchor: while the market is CLOSED this price
// is stale (it is the last close), which is exactly the after-hours signal.
import { config } from "../config.js";
import { cachedFetch } from "../lib/http.js";

// NYSE market open? Returns true when the anchor feed should be "live".
export function isMarketOpen(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false; // weekend closed
  const nyOffset = -4; // EDT (we treat as fixed for simplicity in the scaffold)
  const ny = new Date(d.getTime() + nyOffset * 3600e3);
  const mins = ny.getUTCHours() * 60 + ny.getUTCMinutes();
  return mins >= 570 && mins <= 960; // 09:30–16:00 ET
}

export async function getReferencePrice(symbol) {
  const url =
    `${config.sources.twelvedata.base}/price?symbol=${encodeURIComponent(symbol)}` +
    `&apikey=${encodeURIComponent(config.sources.twelvedata.apiKey)}`;
  const data = await cachedFetch(url, { ttlMs: 20_000 });
  const price = Number(data?.price);
  if (!isFinite(price)) {
    throw new Error(`TwelveData: no price for ${symbol} (${JSON.stringify(data)})`);
  }
  return {
    symbol,
    price,
    currency: "USD",
    marketOpen: isMarketOpen(),
    source: "twelvedata",
    at: Date.now(),
  };
}

export async function listReferencePrices() {
  const symbols = config.sources.twelvedata.symbols;
  const out = {};
  for (const s of symbols) {
    try {
      out[s] = await getReferencePrice(s);
    } catch (e) {
      out[s] = { symbol: s, error: e.message, marketOpen: isMarketOpen() };
    }
  }
  return out;
}