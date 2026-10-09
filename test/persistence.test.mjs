// Persistence + atomicity + secret-safety tests for the durable runtime state.
// These prove that evidence advertised as persistent actually survives a restart,
// and that malformed/partial records cannot crash or corrupt the store.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate the agent action log per test run.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ah-persist-"));
process.env.AH_BNB_AGENT_LOG = path.join(TMP, "agent-actions.json");

// fresh import so the module hydrates from the (empty) temp file
async function freshAgent() {
  const mod = await import(`../src/services/bnb-agent.js?t=${Date.now()}${Math.random()}`);
  return mod;
}

test("persistence: agent actions survive a module reload (process restart proxy)", async () => {
  const a = await freshAgent();
  a.logBnbAction({ kind: "decision", symbol: "IBMB", action: "BUY", reason: "test" });
  a.logBnbAction({ kind: "decision", symbol: "QCOMB", action: "WAIT", reason: "test2" });
  assert.equal(a.listBnbActions().length, 2, "two actions logged in-memory");

  // Simulate a restart: a fresh import hydrates from disk.
  const b = await freshAgent();
  const after = b.listBnbActions();
  assert.equal(after.length, 2, "actions persisted across reload");
  assert.equal(after[0].symbol, "QCOMB", "newest-first ordering preserved");
});

test("persistence: secrets are stripped from the audit log", async () => {
  const a = await freshAgent();
  a.logBnbAction({ kind: "exec", symbol: "IBMB", apiKey: "SECRET", privateKey: "0xdead", signature: "sig", authToken: "t" });
  const rec = a.listBnbActions(1)[0];
  assert.equal(rec.apiKey, undefined, "apiKey stripped");
  assert.equal(rec.privateKey, undefined, "privateKey stripped");
  assert.equal(rec.signature, undefined, "signature stripped");
  assert.equal(rec.authToken, undefined, "authToken stripped");
  assert.equal(rec.symbol, "IBMB", "non-secret fields kept");
  // and never written to disk
  const raw = fs.readFileSync(process.env.AH_BNB_AGENT_LOG, "utf8");
  assert.ok(!/SECRET|0xdead|"sig"/.test(raw), "no secret bytes on disk");
});

test("persistence: malformed/partial records are dropped, not fatal", async () => {
  // Write a corrupt file (mixed valid + junk)
  fs.writeFileSync(process.env.AH_BNB_AGENT_LOG, JSON.stringify([
    { at: 1, symbol: "OK" }, null, "junk", { noAt: true }, { at: 2, symbol: "OK2" },
  ]));
  const b = await freshAgent();
  const list = b.listBnbActions(10);
  assert.equal(list.length, 2, "only well-formed records survive");
  assert.deepEqual(list.map((x) => x.symbol).sort(), ["OK", "OK2"]);
});

test("persistence: a non-array / corrupt JSON file degrades to empty, never throws", async () => {
  fs.writeFileSync(process.env.AH_BNB_AGENT_LOG, "{ not: valid json ]");
  const b = await freshAgent();
  assert.deepEqual(b.listBnbActions(10), [], "corrupt file → empty list, no throw");
});

test("persistence: writes are atomic (no .tmp residue left behind)", async () => {
  const a = await freshAgent();
  a.logBnbAction({ kind: "decision", symbol: "X" });
  const dir = path.dirname(process.env.AH_BNB_AGENT_LOG);
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));
  assert.equal(leftovers.length, 0, "rename() left no partial temp file");
});
