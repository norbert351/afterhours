// AfterHours BNB port — service layer over the BSC data/exec adapters.
// Surfaces the weekend-gap surface + execution on BNB Chain, honestly.
// Real per-stock price/reference requires the sanctioned Binance Web3 API RWA
// key (free during the hackathon). With no key, the adapter still proves the
// rails and flags every gated value — never a fabricated number.
import { listBnbTokenPrices, bnbGap, bnbRwaPrices, bnbWeb3Configured, bnbKyberQuote, WBNB, USDT_BSC, BNB_STOCKS } from "../adapters/bsc.js";
import { listReferencePrices, isMarketOpen } from "../adapters/twelvedata.js";

export async function bnbStatus() {
  return {
    chain: "bnb",
    chainName: "BNB Chain (BSC)",
    configured: { web3Api: bnbWeb3Configured(), rpc: true, gecko: true, kyber: true, twelvedata: true },
    keyNote: bnbWeb3Configured()
      ? "Web3 API key present"
      : "Web3 API key NOT set — register free at web3.binance.com dev-portal to unlock real per-stock RWA price/reference. Keyless rails (RPC/Gecko/Kyber/TwelveData) still prove reachability.",
  };
}

// Build the BNB weekend-gap surface.
export async function bnbUniverse() {
  const prices = await listBnbTokenPrices();
  const web3 = bnbWeb3Configured() ? await bnbRwaPrices() : null;

  // Reference: prefer Web3 API RWA (sanctioned, one call = on-chain + ref); else
  // fall back to TwelveData NYSE reference for the tokenized tickers we know.
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
    market: { open: isMarketOpen(), at: Date.now() },
    chain: "bnb",
    configured: bnbWeb3Configured(),
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