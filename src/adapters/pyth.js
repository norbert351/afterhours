// Pyth adapter — feed IDs VERIFIED to exist on Pyth Hermes (price_feeds query
// for AAPL returns 5 distinct live feeds). HONEST GATE: live latest-price pulls
// returned HTTP 401 from this environment without an API key. So this adapter:
//   • always exposes the verified feed registry (no key needed)
//   • fetches LATEST PRICES only when PYTH_API_KEY is set (else 501)
// Never fabricates a price — if we lack a key, we say so explicitly.
import { config } from "../config.js";
import { cachedFetch } from "../lib/http.js";

export function feedRegistry() {
  const feeds = config.sources.pyth.aaplFeeds;
  return {
    apiKeyConfigured: Boolean(config.sources.pyth.apiKey),
    base: config.sources.pyth.base,
    underlying: "AAPL (Apple)",
    feeds: [
      { role: "equity (NYSE, weekend-frozen)", id: feeds.equity },
      { role: "xStock token (24/7)", id: feeds.xstock },
      { role: "Ondo tokenized (24/7)", id: feeds.ondo },
      { role: "AAPL 24/7 (Pyth)", id: feeds.aapl24 },
      { role: "xStock redemption rate", id: feeds.redemption },
    ],
  };
}

// Live prices for all five AAPL feeds. Requires PYTH_API_KEY.
// Returns per-feed status so a key that lacks a grant on a feed is reported
// honestly (e.g. public-crypto-only keys get 403 on the tokenized-equity feeds
// until a Pyth Pro grant covers them). Never fabricates — absent grants = error.
export async function latestAaplPrices() {
  if (!config.sources.pyth.apiKey) {
    throw Object.assign(new Error("PYTH_API_KEY required for live Pyth prices"), { code: "PYTH_KEY_REQUIRED", status: 501 });
  }
  const feeds = [
    { role: "equity (NYSE, weekend-frozen)", id: config.sources.pyth.aaplFeeds.equity },
    { role: "xStock token (24/7)", id: config.sources.pyth.aaplFeeds.xstock },
    { role: "Ondo tokenized (24/7)", id: config.sources.pyth.aaplFeeds.ondo },
    { role: "AAPL 24/7 (Pyth)", id: config.sources.pyth.aaplFeeds.aapl24 },
    { role: "xStock redemption rate", id: config.sources.pyth.aaplFeeds.redemption },
  ];
  const out = [];
  for (const f of feeds) {
    try {
      const url = `${config.sources.pyth.base}/v2/updates/price/latest?ids[]=${f.id}&parsed=true`;
      const data = await cachedFetch(url, { ttlMs: 15_000, headers: { Authorization: `Bearer ${config.sources.pyth.apiKey}` } });
      const p = (data?.parsed || [])[0];
      out.push({
        role: f.role,
        price: p?.price ? p.price.price * Math.pow(10, p.price.expo) : null,
        confidence: p?.price ? p.price.conf * Math.pow(10, p.price.expo) : null,
        publishTime: p?.price?.publish_time ?? null,
        ok: Boolean(p?.price),
      });
    } catch (e) {
      out.push({ role: f.role, ok: false, error: (e.message || "").slice(0, 160) });
    }
  }
  const entitled = out.filter((x) => x.ok).length;
  return { feeds: out, entitledCount: entitled, blockedCount: out.length - entitled };
}