// Agent wallet surface tests: identity derivation, key non-exposure, chains.
// NO network broadcast — bnbWalletInfo only reads RPC balances (and tolerates failure).
import { test } from "node:test";
import assert from "node:assert";

process.env.AH_BNB_EXEC_PRIVATE_KEY = process.env.AH_BNB_EXEC_PRIVATE_KEY
  || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const { bnbWalletInfo, bnbExecAddress, execAddress } = await import("../src/services/bnb-exec.js");

test("agent wallet: derives a stable address from the env key", async () => {
  const a = execAddress();
  assert.match(a, /^0x[0-9a-fA-F]{40}$/, "valid EVM address");
  assert.equal(bnbExecAddress(), a, "stable across calls");
});

test("agent wallet: NEVER returns the private key", async () => {
  const info = await bnbWalletInfo();
  const keys = Object.keys(info).map((k) => k.toLowerCase());
  assert.ok(!keys.some((k) => /private|secret|pk$|sign/.test(k)), "no key-like field names");
  const blob = JSON.stringify(info);
  assert.ok(!blob.includes(process.env.AH_BNB_EXEC_PRIVATE_KEY.slice(2)), "key bytes never in payload");
  assert.ok(!/0x[0-9a-fA-F]{64}/.test(blob), "no 32-byte hex secret leaked");
});

test("agent wallet: reports chain 56 and honest wallet type", async () => {
  const info = await bnbWalletInfo();
  assert.equal(info.chainId, 56, "BSC mainnet only");
  assert.equal(info.configured, true);
  assert.match(info.walletType, /NOT the official Binance Agentic Wallet/i, "honest about wallet type");
});
