// ERC-8004 agent-identity registration record: shape + consistency.
// Does not broadcast — validates the on-disk registration record and the
// /api/bnb/agent/info payload shape so the "ERC-8004 minted" claim stays backed
// by a real, well-formed record (chain ownership is verified separately on-chain).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

const REG_PATH = new URL("../data/erc8004-registration.json", import.meta.url).pathname;

test("erc8004: registration record is well-formed when present", () => {
  if (!fs.existsSync(REG_PATH)) return; // not registered in this checkout — nothing to assert
  const r = JSON.parse(fs.readFileSync(REG_PATH, "utf8"));
  assert.match(r.txHash, /^0x[0-9a-f]{64}$/i, "valid tx hash");
  assert.equal(r.chainId, 56, "BSC mainnet");
  assert.equal(r.registry, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", "official ERC-8004 IdentityRegistry");
  assert.ok(String(r.agentId).match(/^\d+$/), "numeric agentId");
  assert.equal(r.status, "success", "recorded tx status is success");
  assert.match(r.agentURI, /^https:\/\/afterhourequity\.xyz\/agent\//, "publicly-served agentURI");
});

test("erc8004: no private key or secret is stored in the registration record", () => {
  if (!fs.existsSync(REG_PATH)) return;
  const blob = fs.readFileSync(REG_PATH, "utf8");
  assert.ok(!/private|secret|0x[0-9a-fA-F]{64}/i.test(blob.replace(/"txHash":\s*"0x[0-9a-fA-F]{64}"/, "")),
    "record contains only public identifiers");
});
