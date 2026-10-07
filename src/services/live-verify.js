// live-verify.js, verify REAL blockchain fills against the chain, at request time.
//
// The Proof page must never claim a live execution from a local JSON log or a
// hardcoded hash. This module takes documented real fill hashes, asks the BSC RPC
// for the receipt, and only reports VERIFIED when the chain itself confirms it
// (status 0x1). If the RPC is unreachable or the receipt is missing/failed, the
// fill is reported as UNVERIFIED and never counted as a live execution.
import { BSC_RPC } from "../adapters/bsc.js";

export const BSC_CHAIN_ID = 56;
export const BSCSCAN = "https://bscscan.com";

// Small memo so a burst of Proof loads does not hammer the public RPC. Keyed by
// method+params; short TTL (blocks are ~3s so a confirmed receipt is immutable).
const _memo = new Map();
async function rpc(method, params, ttlMs = 30_000) {
  const key = method + ":" + JSON.stringify(params);
  const hit = _memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.result;
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "AfterHours/0.1 (hackathon build)" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`BSC RPC HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`BSC RPC error: ${j.error.message || JSON.stringify(j.error)}`);
  _memo.set(key, { at: Date.now(), result: j.result });
  return j.result;
}

// Real fills produced by this deployment (documented in docs/BNB.md). These are
// CANDIDATES: they are only shown as live once the chain confirms them here.
export const LIVE_FILL_CANDIDATES = [
  {
    txHash: "0x2c683c4715766aea6904dc07734153f014e8e72ce682e51c9d3403020b411b74",
    venue: "BNB Smart Chain", chainId: BSC_CHAIN_ID,
    wallet: "0xa5de403F977f68c46716fA787205d8E074F8a94F",
    spendUsd: 0.15, received: "0.000659939 IBMB", pair: "USDT → IBMB",
    route: "PancakeSwap V3 (Binance Web3 aggregator)", mode: "LIVE SPOT",
    note: "First bounded live spot fill (0.15 USDT) on BSC mainnet.",
  },
];

// Verify ONE candidate against the chain. Returns a fully-populated record whose
// `verified` flag is derived ONLY from the RPC response.
export async function verifyBscFill(c) {
  const base = {
    venue: c.venue, chainId: c.chainId, wallet: c.wallet, txHash: c.txHash,
    spendUsd: c.spendUsd, received: c.received, pair: c.pair, route: c.route, mode: c.mode, note: c.note,
    explorer: `${BSCSCAN}/tx/${c.txHash}`,
  };
  try {
    const rc = await rpc("eth_getTransactionReceipt", [c.txHash]);
    if (!rc) return { ...base, verified: false, status: "PENDING / NOT FOUND", reason: "No receipt returned by the BSC RPC." };
    const ok = rc.status === "0x1";
    let confirmedAt = null;
    try {
      const blk = await rpc("eth_getBlockByNumber", [rc.blockNumber, false]);
      if (blk && blk.timestamp) confirmedAt = Number(BigInt(blk.timestamp)) * 1000;
    } catch { /* timestamp optional */ }
    return {
      ...base, verified: ok,
      status: ok ? "Confirmed" : "Failed (reverted)",
      blockNumber: Number(BigInt(rc.blockNumber)),
      logsCount: Array.isArray(rc.logs) ? rc.logs.length : 0,
      from: rc.from, to: rc.to, gasUsed: rc.gasUsed,
      confirmedAt,
      reason: ok ? null : "The transaction reverted on-chain, so it is not a live fill.",
    };
  } catch (e) {
    return { ...base, verified: false, status: "UNVERIFIED", reason: `RPC unavailable: ${e.message}` };
  }
}

// Verify every known candidate. Always returns an array; a verification failure is
// reported, never silently upgraded to "live".
export async function verifyLiveFills() {
  const out = [];
  for (const c of LIVE_FILL_CANDIDATES) out.push(await verifyBscFill(c));
  return out;
}
