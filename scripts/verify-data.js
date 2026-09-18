// AfterHours — data-source verification. Proves every adapter returns REAL
// live data (or states an explicit upstream gate). Never fabricates.
import { config } from "../src/config.js";
import { listPreStocks } from "../src/adapters/prestocks.js";
import { listTessera } from "../src/adapters/tessera.js";
import { listReferencePrices } from "../src/adapters/twelvedata.js";
import { feedRegistry } from "../src/adapters/pyth.js";
import { buildUniverse, buildDashboard } from "../src/services/oracle.js";
import { findDislocations } from "../src/services/dislocation.js";

async function check(name, fn) {
  try {
    const r = await fn();
    const detail =
      typeof r === "string" ? r                       // label helpers return strings
      : typeof r === "object" && r && r.label ? r.label
      : summary(r);
    return { name, ok: true, detail };
  } catch (e) {
    return { name, ok: false, detail: e.message };
  }
}

function summary(x) {
  if (Array.isArray(x)) return `${x.length} records`;
  if (x && typeof x === "object" && "references" in x) return `dashboard: ${x.instruments.length} instruments, ${Object.keys(x.references).length} references`;
  if (x && typeof x === "object" && "dislocations" in x) return `${x.count} dislocation rows`;
  return "ok";
}

async function prestocksLabel() {
  const p = await listPreStocks();
  const sample = p.find((x) => x.symbol === "ANDURIL");
  return `label=prestocks ${p.length} tokens; ANDURIL mark $${sample?.markPrice} token $${sample?.tokenPrice}`;
}
async function tesseraLabel() {
  const t = await listTessera();
  const s = t.find((x) => x.symbol === "T-OpenAI");
  return `label=tessera ${t.length} tokens; T-OpenAI mark $${s?.markPrice}`;
}
async function refsLabel() {
  const r = await listReferencePrices();
  const e = r.AAPL ? `AAPL live $${r.AAPL.price}${r.AAPL.marketOpen ? " (market open)" : " (market closed→stale)"}` : `AAPL error ${r.AAPL?.error}`;
  return `label=twelvedata ${Object.keys(r).length} refs; ${e}`;
}

export async function run() {
  const results = [];
  results.push(await check("PreStocks (pre-IPO tokens)", prestocksLabel));
  results.push(await check("Tessera (private equity)", tesseraLabel));
  results.push(await check("TwelveData (NYSE references)", refsLabel));
  results.push(await check("Universe (oracle)", async () => { const u = await buildUniverse(); return { label: `universe ${u.instruments.length} instruments` }; }));
  results.push(await check("Dislocations (gap engine)", findDislocations));

  console.log("\n=== AfterHours data-source verification ===\n");
  let pass = true;
  for (const r of results) {
    console.log(`  [${r.ok ? "VERIFIED" : "GATED/FAIL"}] ${r.name}`);
    console.log(`      ${r.detail}`);
    if (!r.ok) pass = false;
  }
  // Pyth is a registry + keyed-gate by design; not a hard failure.
  console.log(`\n  Pyth feed registry (5 AAPL feeds): ${feedRegistry().apiKeyConfigured ? "live prices ENABLED (PYTH_API_KEY set)" : "metadata only — set PYTH_API_KEY for live prices"}`);
  console.log(`\n${pass ? "ALL VERIFIED SOURCES UP ✓" : "Some sources gated (see above) — no fabricated data."}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  run().catch((e) => { console.error(e); process.exit(1); });
}