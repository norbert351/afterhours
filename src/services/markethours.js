// AfterHours — the live "market never sleeps" gap.
// On-chain tokenized-equity price (xStock, 24/7, from Jupiter Price v3's
// last-swap USD — official xStocks print embedded) vs the frozen NYSE
// reference price (TwelveData). The gap is the real signal this product acts
// on. Reference is STALE when NYSE is closed.
import { listXStockPrices, XSTOCKS } from "../adapters/xstocks.js";
import { getReferencePrice, isMarketOpen } from "../adapters/twelvedata.js";
import { xstockOfficialData } from "../adapters/jupiter-price.js";

export async function marketHoursGap() {
  const [xs, official] = await Promise.allSettled([listXStockPrices(), xstockOfficialData()]);
  const geo = xs.status === "fulfilled" ? xs.value : {};
  const off = official.status === "fulfilled" ? official.value : {};
  const open = isMarketOpen();
  const rows = [];
  const refs = await Promise.allSettled(
    Object.values(XSTOCKS).map((c) => getReferencePrice(c.ref)),
  );
  const refMap = {};
  Object.values(XSTOCKS).forEach((c, i) => {
    const r = refs[i];
    refMap[c.ref] = r.status === "fulfilled" ? r.value.price : r.reason?.message;
  });

  for (const [sym, cfg] of Object.entries(XSTOCKS)) {
    const x = geo[sym] || {};
    const o = off[sym] || {};
    const onChain = o.onChainUsd || x.priceUsd;
    if (!onChain) { rows.push({ symbol: sym, ref: cfg.ref, error: x.error || "no price" }); continue; }
    let refPrice = refMap[cfg.ref];
    const basis = typeof refPrice === "number" ? refPrice : onChain; // fall back to self if ref missing
    const gapPct = basis > 0 ? ((onChain - basis) / basis) * 100 : null;
    rows.push({
      symbol: sym, ref: cfg.ref, mint: cfg.mint,
      onChainPriceUsd: onChain,
      officialPriceUsd: o.officialUsd,        // official xStocks print (via Jupiter Price v3)
      officialUpdatedAt: o.officialUpdatedAt,
      mcapUsd: o.mcapUsd,
      referencePriceUsd: typeof refPrice === "number" ? refPrice : null,
      referenceStale: typeof refPrice === "number" && !open,
      gapPct,
      volumeUsd24h: x.volumeUsd24h, reserveUsd: x.reserveUsd,
      liquidityUsd: o.liquidityUsd,            // pool liquidity (honest thin-pool guard)
      priceChange24h: o.priceChange24h,
      multiplier: o.multiplier,                // official rebase schedule
      nextMultiplier: o.nextMultiplier,
      nextMultiplierAt: o.nextMultiplierAt,
      priceSource: o.onChainUsd ? "jupiter-price-v3" : "geckoterminal",
    });
  }

  rows.sort((a, b) => Math.abs(b.gapPct || 0) - Math.abs(a.gapPct || 0));
  return { marketOpen: open, count: rows.length, gaps: rows, generatedAt: Date.now() };
}