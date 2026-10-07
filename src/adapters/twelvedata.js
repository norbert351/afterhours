// Twelve Data adapter, REAL, verified. Free demo key provides live NYSE
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
  const data = await cachedFetch(url, { ttlMs: 600_000 }); // 10min cache: free-tier quotas are ~800 credits/day
  const price = Number(data?.price);
  if (!isFinite(price)) {
    throw new Error(`TwelveData: no price for ${symbol} (${JSON.stringify(data).slice(0, 80)})`);
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

// Batched reference fetch, ONE request for many symbols (avoids per-request
// rate-limits so every rToken gets a live frozen reference).
export async function batchReferencePrices(symbols = []) {
  const uniq = [...new Set(symbols.map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (!uniq.length) return {};
  const url = `${config.sources.twelvedata.base}/price?symbol=${encodeURIComponent(uniq.join(","))}&apikey=${encodeURIComponent(config.sources.twelvedata.apiKey)}`;
  const data = await cachedFetch(url, { ttlMs: 600_000 });
  const out = {};
  const open = isMarketOpen();
  for (const s of uniq) {
    const raw = uniq.length === 1 ? data?.price : data?.[s]?.price;
    const price = Number(raw);
    if (isFinite(price) && price > 0) out[s] = { symbol: s, price, currency: "USD", marketOpen: open, source: "twelvedata(batch)", at: Date.now() };
  }
  return out;
}