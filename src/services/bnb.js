// AfterHours BNB port — service layer over the BSC data/exec adapters.
// Surfaces the weekend-gap surface + execution on BNB Chain, honestly.
// Real per-stock price/reference requires the sanctioned Binance Web3 API RWA
// key (free during the hackathon). With no key, the adapter still proves the
// rails and flags every gated value — never a fabricated number.
import { listBnbTokenPrices, bnbGap, bnbRwaPrices, bnbWeb3Configured, bnbKyberQuote, WBNB, USDT_BSC, BNB_STOCKS, bnbRealTokens, bnbEquityGaps, bnbAggQuote } from "../adapters/bsc.js";
import { listReferencePrices, isMarketOpen } from "../adapters/twelvedata.js";
import { annotateGaps, byNetEdgeDesc, COST_MODEL } from "./fairvalue.js";
import { recordDecision, listDecisions } from "./paper-log.js";

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

// Cache the last SUCCESSFUL universe so an intermittent upstream (RWA API) failure
// serves the last good data instead of a broken "undefined tokens" page.
let lastGoodUniverse = { at: 0, data: null };

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
      const gaps = raw.filter((g) => !g.error);
      // Residual/fair-value layer — adjust each gap for the broad-market move, subtract
      // estimated execution costs, rank by NET EDGE (SPYB = market factor). A raw gap
      // that does not survive adjustment + costs is a WAIT, never an "opportunity".
      const { marketMovePct } = annotateGaps(gaps, { marketRe: /^(R?SPY(USDT)?|SPYB|SPYx|SPY)$/i });
      gaps.sort(byNetEdgeDesc);
      const bstockGaps = gaps.filter((g) => g.platform === "bstock");
      const actionable = gaps.filter((g) => g.decision === "ROTATE" || g.decision === "BUY");
      const out = {
        market: { open: marketOpen, at: Date.now() },
        chain: "bnb", configured: true,
        source: "rwa-data-api",
        tokenCount: tokens.length,
        platformCount: { bstock: bstock.length, ondo: ondo.length, xstock: stocks.length },
        tokens: bstock, // only the ~25 bStocks (for RWA addresses) — NOT the full 5k-token array (was a 4.4MB payload)
        tokenCountTotal: tokens.length,
        gaps,
        topGaps: gaps.slice(0, 25),
        bstockTop: bstockGaps.slice(0, 25),
        actionableCount: actionable.length,
        marketFactorMovePct: marketMovePct,
        costModelPct: COST_MODEL.feePct + COST_MODEL.slippagePct + COST_MODEL.bufferPct,
        reference: {
          source: "Binance Web3 API · RWA underlying reference",
          status: marketOpen ? "LIVE" : "FROZEN",
          note: marketOpen ? "US market open — reference updates." : "US market closed — the RWA underlying reference is frozen (the weekend-gap baseline).",
        },
        flagged: { count: flagged.length, rows: flagged.slice(0, 5) },
        gapNote: `gapPct = (on-chain tokenPrice − underlying referencePrice) / reference. ${flagged.length} on-chain price(s) flagged as implausible (>${10}% from reference, wrapper/denomination artifact) — not reported as real.`,
        generatedAt: Date.now(),
      };
      lastGoodUniverse = { at: Date.now(), data: out };
      return out;
    } catch (e) {
      // Serve the last good universe if recent; else a well-formed object with the
      // SAME fields so the page never renders "undefined tokens".
      if (lastGoodUniverse.data && Date.now() - lastGoodUniverse.at < 600_000) {
        return { ...lastGoodUniverse.data, stale: true, staleAgeMs: Date.now() - lastGoodUniverse.at, note: `serving cached universe (upstream hiccup: ${e.message})` };
      }
      return {
        market: { open: marketOpen, at: Date.now() },
        chain: "bnb", configured: true, error: `RWA fetch failed: ${e.message}`,
        tokenCount: 0, platformCount: { bstock: 0, ondo: 0, xstock: 0 },
        tokens: [], gaps: [], topGaps: [], bstockTop: [], flagged: { count: 0, rows: [] },
        gapNote: "RWA data API temporarily unreachable — retry shortly.",
        generatedAt: Date.now(),
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

// ---- Paper-action strategy engine (mirrors the Bitget surface; SPOT-ONLY) ----
// Residual rule: take the largest NET EDGE; premium → ROTATE, discount → BUY, else WAIT.
export function bnbPaperAction({ gaps = [], amountUsd = 100 } = {}) {
  const pool = (gaps || []).filter((g) => g && !g.error && Number.isFinite(g.netEdgePct));
  if (!pool.length) return { acted: false, venue: "bnb", decision: "WAIT", reason: "no tradable gap right now" };
  const top = [...pool].sort((a, b) => b.netEdgePct - a.netEdgePct)[0];
  // SPOT-ONLY. A raw gap that does not survive market-adjustment + costs is a WAIT,
  // not an opportunity. Premium (on-chain > fair value) → ROTATE (reduce exposure /
  // rotate into a cheaper eligible spot asset); discount → BUY (increase exposure).
  // Never short / hedge / leverage.
  if (top.decision !== "ROTATE" && top.decision !== "BUY") {
    const rec = { at: Date.now(), venue: "bnb", symbol: top.symbol, name: top.name, rawGapPct: top.gapPct, residualGapPct: top.residualGapPct, netEdgePct: top.netEdgePct, decision: "WAIT", reason: top.reason, notionalUsd: 0, model: "residual-fairvalue-rule" };
    recordDecision(rec);
    return { acted: false, venue: "bnb", decision: "WAIT", target: top.symbol, rawGapPct: top.gapPct, residualGapPct: top.residualGapPct, netEdgePct: top.netEdgePct, reason: top.reason };
  }
  const action = top.decision; // ROTATE | BUY (spot)
  const rec = { at: Date.now(), venue: "bnb", symbol: top.symbol, name: top.name, rawGapPct: top.gapPct, residualGapPct: top.residualGapPct, netEdgePct: top.netEdgePct, action, notionalUsd: amountUsd, price: top.onChainPriceUsd ?? top.tokenPrice, model: "residual-fairvalue-rule" };
  recordDecision(rec);
  return { acted: true, venue: "bnb", decision: action, target: top.symbol, name: top.name, rawGapPct: top.gapPct, residualGapPct: top.residualGapPct, costPct: top.costPct, netEdgePct: top.netEdgePct, side: action, notionalUsd: amountUsd, price: rec.price, reason: top.reason };
}
export function listBnbDecisions(limit = 50) { return listDecisions(limit, "bnb"); }