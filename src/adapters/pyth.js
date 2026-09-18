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
// Returns the actual weekend-gap you'd trade: equality frozen vs token live.
export async function latestAaplPrices() {
  if (!config.sources.pyth.apiKey) {
    throw Object.assign(
      new Error("Pyth live prices need PYTH_API_KEY (401 without it) — feed registry only"),
      { code: "PYTH_KEY_REQUIRED", status: 501 },
    );
  }
  const ids = Object.values(config.sources.pyth.aaplFeeds);
  const url =
    `${config.sources.pyth.base}/v2/updates/price/latest?` +
    ids.map((id) => `ids[]=${id}`).join("&") +
    "&parsed=true";
  const data = await cachedFetch(url, {
    ttlMs: 15_000,
    headers: { Authorization: `Bearer ${config.sources.pyth.apiKey}` },
  });
  const parsed = data?.parsed || [];
  return parsed.map((p) => ({
    id: p.id,
    price: p.price ? p.price.price * Math.pow(10, p.price.expo) : null,
    confidence: p.price ? p.price.conf * Math.pow(10, p.price.expo) : null,
    publishTime: p.price?.publish_time ?? null,
  }));
}