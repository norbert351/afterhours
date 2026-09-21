// Jupiter Price v3 adapter — official xStocks data (prices, multiplier schedule).
import { test, beforeEach } from "node:test";
import assert from "node:assert";
import { xstockOfficialData } from "../src/adapters/jupiter-price.js";

const FIXTURE = {
  XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp: { // AAPLx
    usdPrice: 337.11, liquidity: 898995.22, priceChange24h: 0.934,
    stockData: { id: "xstocks", price: 336.04, mcap: 4905541723400, updatedAt: "2026-09-21T13:05:23.834Z" },
    scaledUiConfig: { multiplier: 1.0026642075893797, newMultiplier: 1.0032690125398187, newMultiplierEffectiveAt: "2026-08-08T00:30:00Z" },
  },
};

beforeEach(() => {
  globalThis.fetch = async () => ({ ok: true, json: async () => FIXTURE });
});

test("adapter maps mint → symbol with prices, liquidity and multiplier schedule", async () => {
  const d = await xstockOfficialData();
  const a = d.AAPLx;
  assert.ok(a, "AAPLx present");
  assert.equal(a.onChainUsd, 337.11);
  assert.equal(a.officialUsd, 336.04);           // official xStocks print
  assert.ok(a.mcapUsd > 0);
  assert.ok(a.liquidityUsd > 0);
  assert.equal(a.multiplier, 1.0026642075893797); // current rebase multiplier
  assert.equal(a.nextMultiplier, 1.0032690125398187);
  assert.ok(a.nextMultiplierAt.includes("2026-08-08"));
});