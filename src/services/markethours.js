// AfterHours — the live "market never sleeps" gap.
// On-chain tokenized-equity price (xStock, 24/7, from GeckoTerminal DEX index)
// vs the frozen NYSE reference price (TwelveData). The gap is the real signal
// this product acts on. Reference is STALE when NYSE is closed.
import { listXStockPrices, XSTOCKS } from "../adapters/xstocks.js";
import { getReferencePrice, isMarketOpen } from "../adapters/twelvedata.js";

export async function marketHoursGap() {
  const xs = await listXStockPrices();
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
    const x = xs[sym];
    if (!x?.priceUsd) { rows.push({ symbol: sym, ref: cfg.ref, error: x?.error || "no price" }); continue; }
    let refPrice = refMap[cfg.ref];
    const basis = typeof refPrice === "number" ? refPrice : x.priceUsd; // fall back to self if ref missing
    const gapPct = basis > 0 ? ((x.priceUsd - basis) / basis) * 100 : null;
    rows.push({
      symbol: sym, ref: cfg.ref, mint: cfg.mint,
      onChainPriceUsd: x.priceUsd,
      referencePriceUsd: typeof refPrice === "number" ? refPrice : null,
      referenceStale: typeof refPrice === "number" && !open,
      gapPct,
      volumeUsd24h: x.volumeUsd24h, reserveUsd: x.reserveUsd,
    });
  }

  rows.sort((a, b) => Math.abs(b.gapPct || 0) - Math.abs(a.gapPct || 0));
  return { marketOpen: open, count: rows.length, gaps: rows, generatedAt: Date.now() };
}