// AfterHours BNB port — BSC data adapter.
// Builds the SAME weekend-gap surface on BNB Chain, anchored on the VERIFIED
// tokenized equities there: bStocks (Backed/Binance, BEP-20 verified on-chain)
// and Ondo (official documented BSC addresses). xStocks-on-BSC is UNVERIFIED
// (official docs omit BSC; GeckoTerminal shows only a junk pool) — deliberately
// not claimed.
//
// Price rails (verified reachable from this VM):
//   • GeckoTerminal network=bsc  — keyless on-chain price per token (HTTP 200)
//   • BSC public RPC (bsc-dataseed.binance.org) — on-chain reads (viem, HTTP 200)
//   • Binance Web3 API /build/api/v1/dex/market/rwa/* — the SANCTIONED sponsor
//     surface: "on-chain price + underlying reference" in one call. [NEEDS-KEY;
//     free during the event]. Honest configured:false when no key is set.
// Reference (frozen NYSE): TwelveData (same as Solana) as the independent
// fallback when the Web3 RWA key is not set.
import { cachedFetch } from "../lib/http.js";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";

export const BSC_RPC = process.env.AH_BNB_RPC || "https://bsc-dataseed.binance.org";
export const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // verified symbol WBNB
export const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";
export const USDC_BSC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

// The BNB equities universe (verified):
// bStocks — Binance/Backed product token (BEP-20), symbol verified on-chain.
// Ondo — official documented BSC addresses (docs.ondo.finance/addresses).
export const BNB_STOCKS = {
  // product-level bStocks token; per-stock wrappers surface via Web3 API Trading RFQ
  BSTOCKS: {
    symbol: "bStocks", name: "Binance Stocks", mint: "0x2F701b108a9aF5558960325A0239D0a13c2C4444",
    decimals: 18, verified: "eth_call symbol() → 'bStocks'", reference: "BNB",
  },
  ONDO_USD: {
    symbol: "USDon", name: "Ondo U.S. Dollar Token", mint: "0x1f8955E640Cbd9abc3C3Bb408c9E2E1f5F20DfE6",
    decimals: 18, verified: "Ondo official docs", reference: "USDC",
  },
};
// Ondo individual stock tokens are dynamic / trade via RFQ — surfaced once the
// Web3 API RWA key is present. We never invent an AMM BEP-20 for them.
export const ONDO_MANAGER = "0x91f8Aff3738825e8eB16FC6f6b1A7A4647bDB299"; // GMTokenManager (official)
export const ONDO_ORACLE = "0xF4Fd8a1B412633e10527454137A29Db7Aa35F15e"; // SyntheticSharesOracle (official)

// Honesty endpoint: is the sanctioned Web3 API key configured?
export function bnbWeb3Configured() {
  return Boolean(String(process.env.AH_BNB_WEB3_KEY || "").trim());
}

const gt = (mint) =>
  cachedFetch(`https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${mint.toLowerCase()}`, {
    ttlMs: 30_000, retries: 2,
  });

// Keyless on-chain price via GeckoTerminal bsc (verified HTTP 200 for bStocks/USDon).
export async function listBnbTokenPrices() {
  const out = {};
  for (const [sym, cfg] of Object.entries(BNB_STOCKS)) {
    try {
      const d = await gt(cfg.mint);
      const a = d?.data?.attributes;
      out[sym] = {
        symbol: sym, name: a?.name || cfg.name, mint: cfg.mint,
        priceUsd: Number(a?.price_usd) || null,
        volumeUsd24h: Number(a?.volume_usd?.h24 || 0),
        reserveUsd: Number(a?.total_reserve_in_usd || 0),
        verified: cfg.verified,
      };
    } catch (e) {
      out[sym] = { symbol: sym, mint: cfg.mint, error: e.message.slice(0, 140) };
    }
  }
  return out;
}

// On-chain reads via the public BSC RPC (viem). Used for wallet balance + symbol
// verification. Reuses a lazily-created client.
let _client = null;
export function bscClient() {
  if (!_client) _client = createPublicClient({ chain: bsc, transport: http(BSC_RPC) });
  return _client;
}

// The week-gap surface: on-chain price vs the frozen reference for each equity.
// referenceUsd: Web3 API RWA underlying reference when keyed, else the provided
// fallback reference map (TwelveData). Honest — never gainsay a missing reference.
// Note on bStocks: the bare product token's GeckoTerminal price is a junk
// micro-cap (~1e-6 USD), NOT the equity price. Real per-stock prices surface
// through the Web3 API RWA/Trading surface (RFQ). We flag that honestly rather
// than passing a junk number off as an equity price.
export async function bnbGap(prices, referenceBySymbol = {}, { requireRealPrice = true } = {}) {
  const gaps = [];
  for (const [sym, p] of Object.entries(prices || {})) {
    if (!p.priceUsd) { gaps.push({ symbol: sym, error: p.error || "no on-chain price" }); continue; }
    // Junk-price guard: a tokenized equity near $1e-6 is a mis-tagged pool, not
    // the stock. Never label it as a real equity gap.
    if (requireRealPrice && p.priceUsd < 0.01) {
      gaps.push({ symbol: sym, error: "on-chain pool price is junk (≈1e-6 USD) — real price requires the Web3 API RWA key (RFQ)" });
      continue;
    }
    const ref = referenceBySymbol[sym] ?? referenceBySymbol[p.symbol] ?? referenceBySymbol[p.name] ?? null;
    if (ref == null) {
      gaps.push({ symbol: sym, error: "no frozen reference (Web3 RWA key unset / TwelveData miss)" });
      continue;
    }
    const gapPct = ((p.priceUsd - ref) / ref) * 100;
    gaps.push({
      symbol: sym, mint: p.mint,
      onChainPriceUsd: p.priceUsd, referencePriceUsd: ref,
      gapPct, volumeUsd24h: p.volumeUsd24h || 0,
    });
  }
  return gaps;
}

// Binance Web3 API — the sanctioned aggregate surface. All reads keyed; a call
// without a key returns the honest 4010x body. Signature per docs (HMAC-SHA256,
// X-OC-APIKEY / X-OC-TIMESTAMP / X-OC-SIGN base64).
import { createHmac } from "node:crypto";

export async function bnbWeb3Call(path, { params = {}, method = "GET" } = {}) {
  const key = String(process.env.AH_BNB_WEB3_KEY || "").trim();
  const secret = String(process.env.AH_BNB_WEB3_SECRET || "").trim();
  if (!key || !secret) {
    return { code: 40101, msg: "API Key is required — register at web3.binance.com dev-portal" };
  }
  const base = "https://web3.binance.com/build/api/v1";
  const fullPath = `/build/api/v1/${path}`;
  const ts = new Date().toISOString();
  const qs = new URLSearchParams(params).toString();
  const toSign = `${method}\n${fullPath}\n${qs}\n${ts}\n${secret}`;
  const sign = createHmac("sha256", secret).update(toSign).digest("base64");
  const url = `${base}/${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "X-OC-APIKEY": key, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sign,
      "X-OC-RECV-WINDOW": "15000", Accept: "application/json",
    },
    timeout: 12_000,
  });
  return res.json().catch(() => ({ code: -1, msg: "non-JSON response" }));
}

// Sanctioned RWA price surface (on-chain + underlying reference in one call).
export async function bnbRwaPrices() {
  const r = await bnbWeb3Call("dex/market/rwa/price", { params: {}, method: "POST" });
  if (r.code && r.code !== 0 && r.code !== 200) {
    return { configured: bnbWeb3Configured(), data: [], error: r.msg };
  }
  // shape is per the Web3 API docs; adapt when key is live (we never guess the body)
  return { configured: true, data: r?.data || [] };
}

// KyberSwap keyless route quote (verified HTTP 200 from this VM) — the exec fallback.
export async function bnbKyberQuote({ tokenIn, tokenOut, amountIn }) {
  const url = `https://aggregator-api.kyberswap.com/bsc/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}`;
  const d = await cachedFetch(url, { ttlMs: 15_000, retries: 1 });
  if (d?.code !== 0) throw new Error(d?.message || "Kyber route failed");
  return d;
}