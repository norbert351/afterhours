// bitget-r.js — AfterHours Bitget Arbitrage leg (Tokenized US stocks).
// The sponsor-tech load-bearing source: Bitget rToken (R<SYM>USDT) trades 7×24
// on Bitget UTA v3. This adapter reads the LIVE rToken price for a universe of
// US stocks so AfterHours can surface the classic Arbitrage sub-theme signal:
// rToken price vs its native US reference, most interesting while the NYSE is
// shut (the reference is frozen, the rToken keeps printing).
import { cachedFetch } from "../lib/http.js";

const BITGET_TICKERS = "https://api.bitget.com/api/v2/spot/market/tickers?productType=spot";

// The tracked US-stock universe (tokenized on Bitget as R<SYM>USDT).
// Kept to 8 liquid names so a single batched reference request fits the free
// data tier's per-minute credit limit (the reference is frozen while closed).
export const US_UNIVERSE = [
  "MSTR", "COIN", "NVDA", "TSLA", "AAPL", "MSFT", "META", "SPY",
];

const TTL = 15_000;
let cache = null;
let cacheAt = 0;

// Fetch all Bitget spot tickers and index rTickers by underlying US symbol.
export async function bitgetRTickers() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const d = await cachedFetch(BITGET_TICKERS, { ttlMs: TTL, retries: 2 });
  const rows = Array.isArray(d?.data) ? d.data : [];
  const r = new Map(); // US symbol -> { rSymbol, priceUsd, change24h }
  for (const t of rows) {
    const s = t.symbol || "";
    if (!s.startsWith("R") || !s.endsWith("USDT")) continue;
    const us = s.slice(1, -4); // RTSLAUSDT -> TSLA
    if (!/[A-Z0-9]{1,6}/.test(us)) continue;
    r.set(us, { rSymbol: s, priceUsd: Number(t.lastPr) || 0, change24h: Number(t.change24h) || 0 });
  }
  cache = r;
  cacheAt = Date.now();
  return r;
}

// Cross-asset hedge sleeve: BTC/ETH spot prices (Bitget), fetched once per cache.
export async function cryptoTickers() {
  const d = await cachedFetch(BITGET_TICKERS, { ttlMs: TTL, retries: 2 });
  const rows = Array.isArray(d?.data) ? d.data : [];
  const out = {};
  for (const t of rows) {
    if (t.symbol === "BTCUSDT" || t.symbol === "ETHUSDT") out[t.symbol.slice(0, -4)] = Number(t.lastPr) || 0;
  }
  return out;
}

// Live rToken price for a US symbol, e.g. TSLA -> RTSLAUSDT.
export async function bitgetRPrice(symbol) {
  const m = await bitgetRTickers();
  const us = String(symbol).toUpperCase();
  if (us === "GOOG") return m.get("GOOGL");
  return m.get(us);
}