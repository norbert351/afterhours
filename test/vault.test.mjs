// Weekend Gap Vault — state-machine tests (injected fakes, no network, no real money).
import { test } from "node:test";
import assert from "node:assert";
import { openVaultStore, createVault, vaultConfig } from "../src/services/vault.js";

function fakeDeps(over = {}) {
  const fills = { buy: [], sell: [] };
  return {
    db: openVaultStore(":memory:"),
    fills,
    cfg: over.cfg || vaultConfig(),
    getGaps: over.getGaps,
    solPriceUsd: async () => 150,
    balancesOf: over.balancesOf || (async () => ({})),
    rebaseFor: over.rebaseFor || (async () => null),
    swapBuy: async (symbol, mint, lamports) => {
      fills.buy.push({ symbol, lamports });
      return { signature: "sig-" + symbol, explorer: "https://solscan.io/tx/sig-" + symbol, outAmount: 50_000, confirmed: true };
    },
    swapSell: async (symbol, mint, atoms) => {
      fills.sell.push({ symbol, atoms });
      return { signature: "sell-" + symbol, explorer: "https://solscan.io/tx/sell-" + symbol };
    },
  };
}
const closed = { marketOpen: false, gaps: [
  { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", gapPct: -5.2, volumeUsd24h: 1_000_000, onChainPriceUsd: 200, referencePriceUsd: 211 },
  { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", gapPct: -1.1, volumeUsd24h: 900_000, onChainPriceUsd: 220, referencePriceUsd: 222.5 },
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

test("no real dislocation (refs down / gaps ~0) → vault refuses to deploy", async () => {
  const d = fakeDeps({ getGaps: async () => ({ marketOpen: false, gaps: [
    { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", gapPct: 0, volumeUsd24h: 1_000_000, onChainPriceUsd: 200, referencePriceUsd: null },
    { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", gapPct: 0.02, volumeUsd24h: 900_000, onChainPriceUsd: 220, referencePriceUsd: 219.9 },
  ] }) });
  const v = createVault(d);
  await v.arm();
  const t = await v.tick();
  assert.equal(t.state.status, "armed", "must NOT buy when the signal is degraded");
  assert.equal(d.fills.buy.length, 0, "no blind buys without a real dislocation");
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

// ── accrual leg (Stretch/xStream yield pattern, HONEST) ──

test("balance growth beyond baseline+own buys is recorded as dividend/rebase accrual", async () => {
  let bal = {};
  const d = fakeDeps({
    cfg: { ...vaultConfig(), execMode: "real" },
    getGaps: async () => closed,
    balancesOf: async () => bal,
  });
  const v = createVault(d);
  await v.arm(); // baseline snapshot = {} (empty wallet)
  await v.tick(); // buy NVDAx, qtyAtoms 50_000 (fake outAmount)
  const mint = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
  assert.equal(v.state().positions[0].qtyAtoms, 50_000);
  // next tick: wallet balance grew by 6,000 atoms (a dividend/rebase)
  bal = { [mint]: 56_000 };
  const t2 = await v.tick();
  assert.equal(t2.state.positions[0].qtyAtoms, 56_000);
  assert.equal(t2.state.positions[0].accruedAtoms, 6_000);
  const fills = v.state().positions; // positions carry accruedAtoms
  assert.ok(fills[0].accruedAtoms > 0, "accrual must be visible on the position");
  const lastFill = requireFills(d.db);
  assert.equal(lastFill.side, "accrual");
  assert.match(lastFill.note, /accrual or external top-up/, "honest label, never overclaims the source");
});

test("self-calibrating baseline never mislabels pre-existing holdings as dividends (upgraded live vault)", async () => {
  let readOk = false;
  let bal = {};
  const d = fakeDeps({
    cfg: { ...vaultConfig(), execMode: "real" },
    getGaps: async () => closed,
    balancesOf: async () => { if (!readOk) throw new Error("RPC down at arm"); return bal; },
  });
  const v = createVault(d);
  await v.arm(); // snapshot fails -> baselineFresh = false (the live-upgrade case)
  await v.tick(); // buy +50_000 → position qty 50_000
  readOk = true;
  // wallet has 122_754 pre-existing atoms that the vault never bought
  bal = { Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh: 172_754 };
  const t2 = await v.tick(); // holding tick reconciles
  const p = t2.state.positions[0];
  assert.equal(p.accruedAtoms ?? 0, 0, "no false dividend credit");
  assert.equal(p.qtyAtoms, 50_000, "qty unchanged — delta was correctly attributed to baseline");
});

// ── official-rebase labeling (Jupiter Price v3 multiplier schedule) ──

test("balance growth matching the official xStocks multiplier is labeled as an OFFICIAL rebase", async () => {
  let bal = {};
  const d = fakeDeps({
    cfg: { ...vaultConfig(), execMode: "real" },
    getGaps: async () => closed,
    balancesOf: async () => bal,
    rebaseFor: async () => ({ multiplier: 1.03 }), // official schedule says +3%
  });
  const v = createVault(d);
  await v.arm();
  await v.tick(); // qty 50_000
  const mint = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
  bal = { [mint]: 51_500 }; // exactly +3% of 50_000 = 1_500
  const t2 = await v.tick();
  assert.equal(t2.state.positions[0].accruedAtoms, 1_500);
  const fill = dbLastFill(d.db);
  assert.equal(fill.side, "accrual");
  assert.match(fill.note, /official xStocks rebase ×1\.03000000/, "notes the OFFICIAL multiplier");
  assert.match(fill.note, /3\.0000%/, "dividend rate stated");
});

test("balance growth NOT explained by the multiplier keeps the honest generic note", async () => {
  let bal = {};
  const d = fakeDeps({
    cfg: { ...vaultConfig(), execMode: "real" },
    getGaps: async () => closed,
    balancesOf: async () => bal,
    rebaseFor: async () => ({ multiplier: 1.005 }), // official schedule says +0.5% (250 atoms)
  });
  const v = createVault(d);
  await v.arm();
  await v.tick(); // qty 50_000
  const mint = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
  bal = { [mint]: 51_500 }; // +1_500 — does NOT match 250 → external top-up, honest
  const t2 = await v.tick();
  assert.equal(t2.state.positions[0].accruedAtoms, 1_500);
  const fill = dbLastFill(d.db);
  assert.doesNotMatch(fill.note, /official/);
  assert.match(fill.note, /external top-up/, "never overclaims the source");
});

test("reconcile drops a real position the wallet does not hold on-chain (phantom, honest)", async () => {
  const bal = {}; // wallet reports zero for every mint
  const d = fakeDeps({
    cfg: { ...vaultConfig(), execMode: "real" },
    getGaps: async () => closed,
    balancesOf: async () => bal,
  });
  const v = createVault(d);
  await v.arm();
  await v.tick(); // buys NVDAx (mode real, qty 50_000)
  assert.equal(v.state().positions.length, 1);
  const r = await v.reconcile();
  assert.equal(r.reconciled, true, "reconcile detected the phantom");
  assert.equal(v.state().positions.length, 0, "phantom position removed");
  const fill = dbLastFill(d.db);
  assert.equal(fill.side, "reconcile", "removal is an honest, labeled ledger event");
});

function dbLastFill(db) {
  return db.prepare("SELECT side, note FROM vault_fills ORDER BY id DESC LIMIT 1").get() || {};
}

function requireFills(db) {
  const rows = db.prepare("SELECT side, note FROM vault_fills ORDER BY id DESC LIMIT 1").get();
  return rows || { side: "none", note: "" };
}