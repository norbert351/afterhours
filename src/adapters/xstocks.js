// xStocks (Backed Finance) — live on-chain tokenized-equity prices on Solana.
// Prices from GeckoTerminal's DEX index (reachable, no key) for the verified
// xStocks mint addresses. This is the LIVE, 24/7 on-chain price of the actual
// tokenized-equity tokens (as opposed to the frozen NYSE reference).
import { cachedFetch } from "../lib/http.js";

// Verified Solana mainnet mints (research 2026-09-20; on-chain confirmed for
// AAPLx/NVDAx, CoinGecko-indexed for the rest — spot-check before big funds).
export const XSTOCKS = {
  AAPLx: { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", ref: "AAPL" },
  NVDAx: { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", ref: "NVDA" },
  TSLAx: { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", ref: "TSLA" },
  MSFTx: { mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", ref: "MSFT" },
  GOOGLx: { mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", ref: "GOOGL" },
  COINx: { mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", ref: "COIN" },
};

async function geckoPrice(mint) {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}`;
  const d = await cachedFetch(url, { ttlMs: 30_000, retries: 2 });
  const a = d?.data?.attributes;
  if (!a?.price_usd) return null;
  return {
    priceUsd: Number(a.price_usd),
    volumeUsd24h: Number(a.volume_usd?.h24 || 0),
    reserveUsd: Number(a.total_reserve_in_usd || 0),
  };
}

export async function listXStockPrices({ symbols = null } = {}) {
  const keys = symbols ? Object.keys(XSTOCKS).filter((s) => symbols.includes(s)) : Object.keys(XSTOCKS);
  const out = {};
  for (const sym of keys) {
    const cfg = XSTOCKS[sym];
    try {
      const px = await geckoPrice(cfg.mint);
      out[sym] = { symbol: sym, referenceTicker: cfg.ref, mint: cfg.mint, ...(px || { error: "no price" }) };
    } catch (e) {
      out[sym] = { symbol: sym, referenceTicker: cfg.ref, mint: cfg.mint, error: e.message };
    }
  }
  return out;
}