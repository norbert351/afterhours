// Oracle — pulls every verified source and normalizes into ONE universe.
// Real data only; a source failure is surfaced per-source, never faked.
import { listPreStocks } from "../adapters/prestocks.js";
import { listTessera } from "../adapters/tessera.js";
import { listReferencePrices, isMarketOpen } from "../adapters/twelvedata.js";
import { feedRegistry, latestAaplPrices } from "../adapters/pyth.js";

// Group key so we can compare the same underlying across issuers.
// PreStocks "OPENAI" == Tessera "T-OpenAI" == "openai".
export function underlyingKey(symbol) {
  return (symbol || "").replace(/^T-/, "").replace(/-/g, "").toLowerCase();
}

export async function buildUniverse() {
  // Fetch each issuer independently: one flaky upstream must never take down
  // the whole universe. Failures are surfaced per-source (no fabricated data).
  const [pre, tess] = await Promise.allSettled([listPreStocks(), listTessera()]);
  const sources = { prestocks: [], tessera: [] };
  const sourceErrors = {};
  if (pre.status === "fulfilled") sources.prestocks = pre.value;
  else sourceErrors.prestocks = pre.reason.message;
  if (tess.status === "fulfilled") sources.tessera = tess.value;
  else sourceErrors.tessera = tess.reason.message;

  const instruments = [...sources.prestocks, ...sources.tessera];
  return {
    market: { open: isMarketOpen(), at: Date.now() },
    instruments,
    issuers: sources,
    sourceErrors,
    generatedAt: Date.now(),
  };
}

export async function buildDashboard() {
  const universe = await buildUniverse();
  const references = await listReferencePrices();
  // Market status computed fresh at render time (not served from a cache).
  const market = { open: isMarketOpen(), at: Date.now() };

  // Group by underlying for cross-issuer comparison.
  const byUnderlying = new Map();
  for (const inst of universe.instruments) {
    const k = underlyingKey(inst.symbol);
    if (!byUnderlying.has(k)) byUnderlying.set(k, []);
    byUnderlying.get(k).push(inst);
  }

  const crossIssuer = [];
  for (const [key, group] of byUnderlying) {
    if (group.length > 1) {
      // Compare mark prices across the multiple issuers holding this underlying.
      const withMark = group.filter((g) => typeof g.markPrice === "number" && g.markPrice > 0);
      if (withMark.length > 1) {
        const max = Math.max(...withMark.map((g) => g.markPrice));
        const min = Math.min(...withMark.map((g) => g.markPrice));
        crossIssuer.push({
          underlying: key,
          pricedBy: withMark.map((g) => ({ issuer: g.issuer, symbol: g.symbol, markPrice: g.markPrice })),
          spreadBps: min > 0 ? ((max - min) / min) * 10_000 : null,
        });
      }
    }
  }

  return {
    market, // { open, at }
    references, // NYSE anchor (TwelveData, market-hours aware)
    instruments: universe.instruments,
    crossIssuer,
    pyth: feedRegistry(),
    ...(feedRegistry().apiKeyConfigured ? { pythLive: await latestAaplPrices() } : {}),
    generatedAt: Date.now(),
  };
}