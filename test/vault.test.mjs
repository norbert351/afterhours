// Weekend Gap Vault — state-machine tests (injected fakes, no network, no real money).
import { test } from "node:test";
import assert from "node:assert";
import { openVaultStore, createVault, vaultConfig } from "../src/services/vault.js";

function fakeDeps(over = {}) {
  const fills = { buy: [], sell: [] };
  return {
    db: openVaultStore(":memory:"),
    fills,
    cfg: vaultConfig(),
    getGaps: over.getGaps,
    solPriceUsd: async () => 150,
    swapBuy: async (symbol, mint, lamports) => {
      fills.buy.push({ symbol, lamports });
      return { signature: "sig-" + symbol, explorer: "https://solscan.io/tx/sig-" + symbol, outAmount: 50_000 };
    },
    swapSell: async (symbol, mint, atoms) => {
      fills.sell.push({ symbol, atoms });
      return { signature: "sell-" + symbol, explorer: "https://solscan.io/tx/sell-" + symbol };
    },
  };
}
const closed = { marketOpen: false, gaps: [
  { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", gapPct: -5.2, volumeUsd24h: 1_000_000, onChainPriceUsd: 200 },
  { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", gapPct: -1.1, volumeUsd24h: 900_000, onChainPriceUsd: 220 },
] };
const open_ = { marketOpen: true, gaps: closed.gaps };

test("arm -> tick(market closed) buys the deepest gap and goes holding", async () => {
  const d = fakeDeps({ getGaps: async () => closed });
  const v = createVault(d);
  const a = await v.arm();
  assert.equal(a.state.status, "armed");
  const t = await v.tick();
  assert.equal(t.state.status, "holding");
  assert.equal(t.state.positions.length, 1);
  assert.equal(t.state.positions[0].symbol, "NVDAx"); // deepest |gap|
  assert.equal(t.state.positions[0].mode, "paper");
  assert.equal(d.fills.buy.length, 1);
  assert.equal(d.fills.buy[0].symbol, "NVDAx");
});

test("holding tick does NOT double-buy (no churn)", async () => {
  const d = fakeDeps({ getGaps: async () => closed });
  const v = createVault(d);
  await v.arm();
  await v.tick();
  const before = d.fills.buy.length;
  const t2 = await v.tick(); // market still closed, still holding
  assert.equal(t2.action, "hold");
  assert.equal(d.fills.buy.length, before, "must not buy twice");
});

test("market open -> auto-unwind to SOL, back to idle, sell recorded", async () => {
  const d = fakeDeps({ getGaps: async () => closed });
  const v = createVault(d);
  await v.arm();
  await v.tick();
  const g2 = fakeDeps({ getGaps: async () => open_ });
  const v2 = createVault({ ...g2, db: d.db, fills: d.fills }); // same db — same vault state
  const t = await v2.tick();
  assert.equal(t.state.status, "idle");
  assert.equal(t.state.positions.length, 0);
  assert.equal(g2.fills.sell.length, 1);
  assert.equal(g2.fills.sell[0].symbol, "NVDAx");
});

test("stop is a kill-switch from armed", async () => {
  const d = fakeDeps({ getGaps: async () => closed });
  const v = createVault(d);
  await v.arm();
  const s = v.stop();
  assert.equal(s.state.status, "idle");
  const t = await v.tick(); // must be a no-op
  assert.equal(t.action, "idle");
});

test("swap failure is recorded honestly, status stays armed, no crash", async () => {
  const d = fakeDeps({ getGaps: async () => closed });
  d.swapBuy = async () => { throw new Error("jupiter unreachable"); };
  const v = createVault(d);
  await v.arm();
  const t = await v.tick();
  assert.equal(t.action, "buy_failed");
  assert.equal(t.state.status, "armed");
  assert.match(t.state.lastError, /buy failed/);
});

test("cap sizing clamps into the safe lamport band", async () => {
  const d = fakeDeps({ getGaps: async () => closed, solPriceUsd: async () => 150 });
  const v = createVault(d);
  await v.arm();
  await v.tick();
  const lamports = d.fills.buy[0].lamports;
  assert.ok(lamports >= 500_000 && lamports <= 4_000_000, `cap out of band: ${lamports}`);
  // ~0.25 USD at $150/SOL
  assert.ok(Math.abs(lamports - 1_666_667) < 50_000, `cap not near $0.25: ${lamports}`);
});

test("low-volume gaps are not tradeable (min-vol filter)", async () => {
  const d = fakeDeps({ getGaps: async () => ({ marketOpen: false, gaps: [{ symbol: "GOOGLx", mint: "x", gapPct: -9, volumeUsd24h: 100 }] }) });
  const v = createVault(d);
  await v.arm();
  const t = await v.tick();
  assert.equal(t.state.status, "armed"); // stays armed, waiting for a tradeable gap
  assert.match(t.state.lastError, /no tradeable gap/);
  assert.equal(d.fills.buy.length, 0, "must not buy an illiquid gap");
});