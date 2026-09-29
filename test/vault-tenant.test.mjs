// Weekend Gap Vault — multi-tenant isolation: user A's vault never leaks to B.
import { test } from "node:test";
import assert from "node:assert";
import { openVaultStore, createVault, vaultConfig, readState, activeVaultUserIds, getDeposit, setDeposit } from "../src/services/vault.js";

function deps(db, userId = 0, over = {}) {
  return {
    db,
    cfg: over.cfg || vaultConfig(),
    getGaps: over.getGaps || (async () => ({ marketOpen: false, gaps: [
      { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", gapPct: -5, volumeUsd24h: 1_000_000, onChainPriceUsd: 200, referencePriceUsd: 211 },
    ] })),
    solPriceUsd: async () => 150,
    balancesOf: over.balancesOf || (async () => ({})),
    rebaseFor: over.rebaseFor || (async () => null),
    swapBuy: async (symbol, mint, l) => ({ signature: `buy-${symbol}-u${userId}`, outAmount: 50_000, confirmed: true }),
    swapSell: async (symbol, mint, a) => ({ signature: `sell-${symbol}-u${userId}` }),
  };
}

test("vault state + fills are isolated by user_id", async () => {
  const db = openVaultStore(":memory:");
  const a = createVault({ ...deps(db, 7), userId: 7 });
  const b = createVault({ ...deps(db, 9), userId: 9 });

  await a.arm();
  await a.tick(); // A buys NVDAx -> holding

  // B is untouched
  assert.equal(b.state().status, "idle");
  assert.equal(readState(db, 9).positions.length, 0);
  assert.equal(readState(db, 7).positions.length, 1, "A holds its position");

  // activeVaultUserIds returns only A (armed/holding)
  assert.deepEqual(activeVaultUserIds(db), [7]);

  // A's fills exist, B's do not
  const aFills = db.prepare("SELECT side, symbol FROM vault_fills WHERE user_id=7").all();
  const bFills = db.prepare("SELECT side, symbol FROM vault_fills WHERE user_id=9").all();
  assert.equal(aFills.length, 1);
  assert.equal(aFills[0].symbol, "NVDAx");
  assert.equal(bFills.length, 0, "B must see zero fills from A's activity");
});

test("per-user deposit balances are independent", () => {
  const db = openVaultStore(":memory:");
  setDeposit(db, 1, 10_000_000);
  setDeposit(db, 2, 25_000_000);
  assert.equal(getDeposit(db, 1), 10_000_000);
  assert.equal(getDeposit(db, 2), 25_000_000);
  // setting one never changes the other
  setDeposit(db, 2, 5_000_000);
  assert.equal(getDeposit(db, 1), 10_000_000, "A's deposit must be untouched");
});