// AfterHours BNB port — service layer over the BSC data/exec adapters.
// Surfaces the weekend-gap surface + execution on BNB Chain, honestly.
// Real per-stock price/reference requires the sanctioned Binance Web3 API RWA
// key (free during the hackathon). With no key, the adapter still proves the
// rails and flags every gated value — never a fabricated number.
import { listBnbTokenPrices, bnbGap, bnbRwaPrices, bnbWeb3Configured, bnbKyberQuote, WBNB, USDT_BSC, BNB_STOCKS, bnbRealTokens, bnbEquityGaps, bnbAggQuote } from "../adapters/bsc.js";
import { listReferencePrices, isMarketOpen } from "../adapters/twelvedata.js";

export async function bnbStatus() {
  return {
    chain: "bnb",
    chainName: "BNB Chain (BSC)",
    configured: { web3Api: bnbWeb3Configured(), rpc: true, gecko: true, kyber: true, twelvedata: true },
    keyNote: bnbWeb3Configured()
      ? "Binance Web3 API key live — RWA Data API provides real on-chain vs reference per tokenized equity."
      : "Web3 API key NOT set — register free at web3.binance.com dev-portal to unlock real per-stock RWA price/reference. Keyless rails (RPC/Gecko/Kyber/TwelveData) still prove reachability.",
  };
}

// Build the BNB weekend-gap surface. With the Web3 API key, this is REAL data:
// every bStocks/Ondo token's on-chain price vs its underlying reference, from
// the sponsor's sanctioned RWA Data API. Without it, an honest skeleton.
export async function bnbUniverse() {
  const marketOpen = isMarketOpen();
  if (bnbWeb3Configured()) {
    try {
      const [bstock, ondo, stocks] = await Promise.all([
        bnbRealTokens({ platform: "bstock", chain: "56" }),
        bnbRealTokens({ platform: "ondo", chain: "56" }),
        bnbRealTokens({ platform: "xstock", chain: "56" }).catch(() => []),
      ]);
      const tokens = [...bstock, ...ondo, ...stocks];
      const { gaps: raw, flagged } = bnbEquityGaps(tokens);
      const gaps = raw.filter((g) => !g.error).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
      const bstockGaps = gaps.filter((g) => g.platform === "bstock").sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
      return {
        market: { open: marketOpen, at: Date.now() },
        chain: "bnb", configured: true,
        source: "rwa-data-api",
        tokenCount: tokens.length,
        platformCount: { bstock: bstock.length, ondo: ondo.length, xstock: stocks.length },
        tokens,
        gaps,
        topGaps: gaps.slice(0, 25),
        bstockTop: bstockGaps.slice(0, 25),
        flagged: { count: flagged.length, rows: flagged.slice(0, 5) },
        gapNote: `gapPct = (on-chain tokenPrice − underlying referencePrice) / reference. ${flagged.length} on-chain price(s) flagged as implausible (>${10}% from reference, wrapper/denomination artifact) — not reported as real.`,
        generatedAt: Date.now(),
      };
    } catch (e) {
      return {
        market: { open: marketOpen, at: Date.now() },
        chain: "bnb", configured: true, error: `RWA fetch failed: ${e.message}`,
        tokens: [], gaps: [], generatedAt: Date.now(),
      };
    }
  }
  // Keyless honest skeleton (unchanged behaviour).
  const prices = await listBnbTokenPrices();
  const web3 = bnbWeb3Configured() ? await bnbRwaPrices() : null;
  let referenceBySymbol = {};
  if (web3?.configured && Array.isArray(web3.data)) {
    for (const row of web3.data) {
      if (row && row.symbol && row.referencePriceUsd != null) referenceBySymbol[row.symbol] = row.referencePriceUsd;
    }
  } else {
    try { const refs = await listReferencePrices(); for (const [s, r] of Object.entries(refs)) referenceBySymbol[s] = r.price; } catch {}
  }
  const gaps = await bnbGap(prices, referenceBySymbol);
  return {
    market: { open: marketOpen, at: Date.now() },
    chain: "bnb",
    configured: false,
    tokens: prices,
    gaps,
    instruments: Object.entries(BNB_STOCKS).map(([k, v]) => ({ ...v, key: k })),
    generatedAt: Date.now(),
  };
}

// KyberSwap keyless quote (exec fallback; the Web3 API Trading aggregator is the
// sanctioned path once keyed). Capped+allowlisted at the route layer.
export async function bnbQuote({ amountAtoms, tokenOut = USDT_BSC, tokenIn = WBNB } = {}) {
  return bnbKyberQuote({ tokenIn, tokenOut, amountIn: String(amountAtoms) });
}

// Sanctioned cross-DEX quote for a real equity token (SWAP mode) via Trading API.
export async function bnbEquityQuote({ tokenIn = USDT_BSC, tokenOut, amountAtoms }) {
  return bnbAggQuote({ tokenIn, tokenOut, amount: amountAtoms });
}