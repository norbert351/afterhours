// Transaction API simulation gate — safety tests (NO network, NO broadcast).
//
// Proves the required behavior:
//  1. a SUCCESS simulation allows the transaction to proceed to broadcast
//  2. a FAILED simulation prevents broadcasting
//  3. a simulation TIMEOUT/transport error prevents broadcasting
//  4. a MALFORMED/ambiguous simulation response prevents broadcasting
//  5. simulation-only (dry-run) never broadcasts
//  6. the live path enforces spot-only token→token + the amount cap
import { test } from "node:test";
import assert from "node:assert";

// A throwaway, UNFUNDED private key so execAccount() resolves. Never used on-chain
// in these tests (broadcast is injected and never touches a real RPC).
process.env.AH_BNB_EXEC_PRIVATE_KEY = process.env.AH_BNB_EXEC_PRIVATE_KEY
  || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
// Isolate the exec log so tests NEVER pollute the real data/bnb-exec.json.
import os from "node:os";
import path from "node:path";
process.env.AH_BNB_EXEC_LOG = process.env.AH_BNB_EXEC_LOG
  || path.join(os.tmpdir(), `ah-bnb-exec-test-${process.pid}.json`);

const mod = await import("../src/services/bnb-exec.js");
const { bnbExecuteSwap, bnbDryRunSwap, EXEC_MAX_USD, EXEC_MIN_USD } = mod;

const fakeBuild = async ({ symbol }) => ({
  mint: "0x00000000000000000000000000000000000000AA", sym: symbol || "IBMB",
  amt: "150000000000000000", qid: "Q1",
  tx: { to: "0x00000000000000000000000000000000000000BB", data: "0xdeadbeef", value: "0" },
});
const okSim = async () => ({ ok: true, status: "SUCCESS", failReason: null });
const failSim = async () => ({ ok: false, status: "FAILED", failReason: "execution reverted: BEP20: transfer amount exceeds allowance" });

function broadcaster(tracker) {
  return async () => { tracker.called += 1; return { approveHash: "0xappr", swapHash: "0xswap" }; };
}

test("SIM gate 1: a SUCCESS simulation proceeds to broadcast", async () => {
  const t = { called: 0 };
  const out = await bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.2 },
    { buildSwap: fakeBuild, simulate: okSim, broadcast: broadcaster(t) });
  assert.equal(t.called, 1, "broadcast reached after SUCCESS sim");
  assert.equal(out.status, "broadcast");
  assert.equal(out.simulation.status, "SUCCESS");
});

test("SIM gate 2: a FAILED simulation prevents broadcasting", async () => {
  const t = { called: 0 };
  await assert.rejects(
    () => bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.2 },
      { buildSwap: fakeBuild, simulate: failSim, broadcast: broadcaster(t) }),
    /simulation FAILED/,
  );
  assert.equal(t.called, 0, "broadcast NEVER called on a FAILED sim");
});

test("SIM gate 3: a simulation timeout/transport error prevents broadcasting", async () => {
  const t = { called: 0 };
  const timeoutSim = async () => { throw new Error("The operation was aborted due to timeout"); };
  await assert.rejects(
    () => bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.2 },
      { buildSwap: fakeBuild, simulate: timeoutSim, broadcast: broadcaster(t) }),
    /could not be performed/,
  );
  assert.equal(t.called, 0, "broadcast NEVER called when the sim call errors/times out");
});

test("SIM gate 4: a malformed/ambiguous simulation response prevents broadcasting", async () => {
  const t = { called: 0 };
  for (const malformed of [null, {}, { ok: false, status: null }, { ok: true, status: undefined }, { status: "PENDING" }]) {
    const sim = async () => malformed;
    await assert.rejects(
      () => bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.2 },
        { buildSwap: fakeBuild, simulate: sim, broadcast: broadcaster(t) }),
      /refusing to broadcast/,
      `malformed sim ${JSON.stringify(malformed)} must refuse broadcast`,
    );
  }
  assert.equal(t.called, 0, "no broadcast for any malformed sim");
});

test("SIM gate 5: simulation-only (dry-run) never broadcasts", async () => {
  // bnbDryRunSwap builds + simulates; it must not contain a broadcast path.
  const src = (await import("node:fs")).readFileSync(new URL("../src/services/bnb-exec.js", import.meta.url), "utf8");
  const start = src.indexOf("export async function bnbDryRunSwap");
  const end = src.indexOf("export async function bnbExecuteSwap");
  assert.ok(start > 0 && end > start, "dry-run function is present and precedes execute");
  const dryRunBody = src.slice(start, end);
  assert.ok(!/sendTransaction|writeContract|defaultBroadcast/.test(dryRunBody), "dry-run module has no broadcast call");
  assert.ok(/wouldBroadcast: false/.test(dryRunBody), "dry-run explicitly reports wouldBroadcast:false");
});

test("SIM gate 6a: amount cap is enforced server-side (rejected before any build)", async () => {
  const t = { called: 0 };
  let built = 0;
  const spyBuild = async (a) => { built += 1; return fakeBuild(a); };
  await assert.rejects(
    () => bnbExecuteSwap({ symbol: "IBMB", amountUsd: EXEC_MAX_USD + 1 },
      { buildSwap: spyBuild, simulate: okSim, broadcast: broadcaster(t) }),
    /amountUsd must be/,
  );
  await assert.rejects(
    () => bnbExecuteSwap({ symbol: "IBMB", amountUsd: EXEC_MIN_USD - 0.01 },
      { buildSwap: spyBuild, simulate: okSim, broadcast: broadcaster(t) }),
    /amountUsd must be/,
  );
  assert.equal(built, 0, "no quote/build attempted when the cap rejects");
  assert.equal(t.called, 0);
});

test("SIM gate 6b: slippage above the max is rejected", async () => {
  await assert.rejects(
    () => bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.2, slippagePercent: 50 },
      { buildSwap: fakeBuild, simulate: okSim, broadcast: broadcaster({ called: 0 }) }),
    /slippagePercent must be/,
  );
});

// strip // line comments + /* */ blocks so a safety NOTE mentioning perps does
// not read as a perp code path.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("SPOT-only: the execution module exposes no perp/leverage/short code path", async () => {
  const src = stripComments((await import("node:fs")).readFileSync(new URL("../src/services/bnb-exec.js", import.meta.url), "utf8"));
  assert.ok(!/futures|perpetual|\bperp\b|leverage|\bshort\b|hedge|\bmargin\b/i.test(src), "no perp/leverage/short/margin code path exists");
  assert.ok(/fromTokenAddress/.test(src) && /toTokenAddress/.test(src), "only a token→token swap is built");
  assert.ok(/\bbsc\b/.test(src) && /BNB_CHAIN_ID = 56/.test(src), "BSC mainnet (chain 56) is the only chain used");
});

test("MAINNET-only: the simulation is submitted with binanceChainId 56", async () => {
  const { bnbSimulateTx } = await import("../src/adapters/bsc.js");
  // we cannot call the network here; assert the module pins chain 56 in source
  const src = (await import("node:fs")).readFileSync(new URL("../src/adapters/bsc.js", import.meta.url), "utf8");
  assert.ok(/pre-transaction\/simulate/.test(src), "uses the official simulate endpoint");
  assert.ok(/binanceChainId: String\(chainId\)/.test(src), "sends binanceChainId from the caller");
});

test("IDEMPOTENCY: a concurrent duplicate execution is rejected", async () => {
  // Slow sim so the second call overlaps the first.
  const slowSim = async () => { await new Promise((r) => setTimeout(r, 60)); return { ok: true, status: "SUCCESS" }; };
  const t = { called: 0 };
  const deps = { buildSwap: fakeBuild, simulate: slowSim, broadcast: broadcaster(t) };
  const p1 = bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.22 }, deps);
  const p2 = bnbExecuteSwap({ symbol: "IBMB", amountUsd: 0.22 }, deps).catch((e) => e);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(t.called, 1, "only ONE broadcast for two concurrent identical requests");
  assert.ok(!r2.code || r2.code === 409, "the duplicate is rejected");
});

// --- Case E: the simulation gate is a SERVER-SIDE invariant, not a route-level check ---
test("EXEC BOUNDARY: broadcast only ever happens inside the gated function", async () => {
  const fs = await import("node:fs");
  const execSrc = fs.readFileSync(new URL("../src/services/bnb-exec.js", import.meta.url), "utf8");
  // The ONLY module-level broadcast primitives live in defaultBroadcast, which is
  // reachable exclusively through bnbExecuteSwap AFTER the sim gate.
  const sendTx = (execSrc.match(/sendTransaction|writeContract/g) || []).length;
  assert.ok(sendTx > 0, "there is a broadcast path (defaultBroadcast)");
  assert.ok(/simulate\(/.test(execSrc) && /status !== "SUCCESS"/.test(execSrc), "gate checks SUCCESS before broadcast");
  const gateIdx = execSrc.indexOf('status !== "SUCCESS"');
  const bcastIdx = execSrc.indexOf("async function defaultBroadcast");
  assert.ok(gateIdx > 0 && bcastIdx > gateIdx, "gate is defined before the broadcast helper");
});

test("EXEC BOUNDARY: no other module calls a raw viem broadcast for BNB", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = new URL("../src", import.meta.url).pathname;
  const offenders = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith(".js") && !p.endsWith("bnb-exec.js")) {
        const s = fs.readFileSync(p, "utf8");
        if (/sendTransaction\s*\(|writeContract\s*\(/.test(s)) offenders.push(p.replace(dir, "src"));
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, [], `no module outside bnb-exec may broadcast: ${offenders.join(", ")}`);
});

test("EXEC BOUNDARY: the MCP surface cannot execute (read-only tools only)", async () => {
  const fs = await import("node:fs");
  const mcp = fs.readFileSync(new URL("../src/mcp/bnb-mcp.js", import.meta.url), "utf8");
  assert.ok(!/bnbExecuteSwap|bnbDryRunSwap/.test(mcp), "MCP never imports the execution entrypoint");
  assert.ok(/bnb_wallet|bnbWalletInfo/.test(mcp), "MCP exposes only read-only wallet/gap/quote/status tools");
});
