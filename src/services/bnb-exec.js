// bnb-exec.js, LIVE spot execution on BSC for the AfterHours BNB build.
// Spends the BNB execution wallet (AH_BNB_EXEC_PRIVATE_KEY, in .env, never
// printed). Flow: aggregator quote → swap calldata → approve USDT to the router
// → broadcast the swap tx on BSC. This is the "it actually trades" proof.
//
// SAFETY (hackathon compliance):
//  - BSC MAINNET ONLY (chain 56). Rejected otherwise.
//  - SPOT ONLY: the only action is a token⇄token DEX swap. No perps/futures/
//    leverage/short/hedge path exists anywhere in this module.
//  - TRANSACTION API DRY-RUN FIRST: the assembled tx is simulated via the
//    Binance Web3 Transaction API (/api/v1/dex/pre-transaction/simulate) and
//    MUST return SUCCESS before any broadcast. A failed / ambiguous / errored
//    simulation fails CLOSED (no broadcast). This is the official "dry-run with
//    the Transaction API, then demo with small live amounts" requirement.
//  - AMOUNT CAP: enforced server-side here (not only at the route).
//  - IDEMPOTENCY: a per-request key guards against duplicate broadcasts.
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { bnbWeb3Call, bnbSimulateTx, USDT_BSC, BSC_RPC } from "../adapters/bsc.js";
import fs from "node:fs";

// Live-execution proof log, every real BSC fill is persisted here so the Proof
// page can surface it. Never fabricated: only records an actual broadcast result.
// AH_BNB_EXEC_LOG overrides the path (tests use a temp file so they never touch
// the real production log).
const EXEC_LOG = process.env.AH_BNB_EXEC_LOG || new URL("../../data/bnb-exec.json", import.meta.url).pathname;
function readExecLog() { try { return JSON.parse(fs.readFileSync(EXEC_LOG, "utf8")); } catch { return []; } }
function appendExecLog(rec) { try { const l = readExecLog(); l.unshift(rec); fs.writeFileSync(EXEC_LOG, JSON.stringify(l.slice(0, 100), null, 2)); } catch { /* non-fatal */ } }
export function listBnbExecs(limit = 20) { return readExecLog().slice(0, limit); }
export function bnbExecConfigured() { return !!String(process.env.AH_BNB_EXEC_PRIVATE_KEY || "").trim(); }

// Canonical live-fill list for the Proof page and /api/execs. ONE source, so the
// count and the list can never disagree (the earlier bug showed count:1 with an
// empty fills[]). Returns broadcast records newest-first, with only the fields
// the stored evidence supports.
export function listBnbFills(limit = 50) {
  return readExecLog()
    .filter((r) => r && r.swapHash)
    .map((r) => ({
      txHash: r.swapHash, approveHash: r.approveHash || null,
      chain: r.chain || "BNB Smart Chain", chainId: r.chainId || 56,
      symbol: r.symbol, side: r.side || "buy", amountUsd: r.amountUsd,
      mint: r.mint || null, router: r.router || null,
      at: r.at, status: r.status || "broadcast",
      explorer: r.explorer || `https://bscscan.com/tx/${r.swapHash}`,
      source: "data/bnb-exec.json",
    }))
    .slice(0, limit);
}

// --- Execution safety constants (server-side, not client-trusted) ---
export const BNB_CHAIN_ID = 56;
export const EXEC_MIN_USD = 0.05;
export const EXEC_MAX_USD = Number(process.env.AH_BNB_EXEC_MAX_USD || 0.5);
export const EXEC_SLIPPAGE_MAX = 2; // %

const _inflight = new Set(); // idempotency keys currently executing
function idemKey(symbol, amountUsd) {
  // Coarse bucket (~5s) so a double-click cannot fire two identical swaps.
  return `${symbol}:${amountUsd}:${Math.floor(Date.now() / 5000)}`;
}

const ERC20_APPROVE = [{ name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }];

export function execAccount() {
  const key = String(process.env.AH_BNB_EXEC_PRIVATE_KEY || "").trim();
  if (!key) throw Object.assign(new Error("AH_BNB_EXEC_PRIVATE_KEY not configured"), { code: 501 });
  return privateKeyToAccount(key);
}
export function execAddress() { return execAccount().address; }
export function bnbExecAddress() { return execAddress(); }

// Read-only wallet identity + balances for the agent surface. NEVER returns the
// private key. Balances come from the public BSC RPC (native BNB) and an ERC-20
// balanceOf for USDT — best-effort, returns nulls (not fabricated zeros) on RPC error.
export async function bnbWalletInfo() {
  if (!bnbExecConfigured()) return { configured: false, address: null, chain: "BNB Smart Chain (BSC)", chainId: 56 };
  const addr = execAddress();
  const out = { configured: true, address: addr, chain: "BNB Smart Chain (BSC)", chainId: 56,
    walletType: "local signing key (env AH_BNB_EXEC_PRIVATE_KEY) — NOT the official Binance Agentic Wallet",
    nativeBnb: null, usdt: null, rpcError: null };
  try {
    const pc = createPublicClient({ chain: bsc, transport: http(BSC_RPC) });
    const [bnbBal, usdtBal] = await Promise.all([
      pc.getBalance({ address: addr }),
      pc.readContract({ address: USDT_BSC, abi: [{ name: "balanceOf", type: "function", stateMutability: "view",
        inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
        functionName: "balanceOf", args: [addr] }).catch(() => null),
    ]);
    out.nativeBnb = Number(bnbBal) / 1e18;
    out.usdt = usdtBal == null ? null : Number(usdtBal) / 1e18;
  } catch (e) { out.rpcError = String(e.message || e).slice(0, 120); }
  return out;
}

// Resolve a bStocks/Ondo symbol to its BSC mint via the RWA universe (reuse bnbRealTokens).
async function resolveMint(symbol) {
  const { bnbRealTokens } = await import("../adapters/bsc.js");
  const tokens = [...(await bnbRealTokens({ platform: "bstock" })), ...(await bnbRealTokens({ platform: "ondo" }))];
  const t = tokens.find((x) => x.tokenSymbol?.toUpperCase() === symbol.toUpperCase()
    || x.underlyingTicker?.toUpperCase() === symbol.toUpperCase());
  if (!t) throw Object.assign(new Error(`no "${symbol}" in BSC RWA universe`), { code: 404 });
  return { mint: t.tokenContractAddress, symbol: t.tokenSymbol, name: t.tokenName };
}

// Build the swap calldata via the sanctioned Trading API (no signature, no broadcast).
export async function bnbBuildSwap({ symbol, amountUsd = 0.15, slippagePercent = 1, wallet }) {
  const acct = wallet ? { address: wallet } : execAccount();
  const { mint, symbol: sym } = await resolveMint(symbol);
  const amt = String(Math.round(amountUsd * 1e18)); // USDT 18dp on BSC
  const q = await bnbWeb3Call("/api/v1/dex/aggregator/quote", {
    params: { binanceChainId: "56", fromTokenAddress: USDT_BSC, toTokenAddress: mint, amount: amt },
  });
  if (q.code !== 0) throw Object.assign(new Error(`quote failed: ${q.code} ${q.msg}`), { code: 400 });
  const qid = Array.isArray(q.data) ? q.data[0].quoteId : q.data?.quoteId;
  const s = await bnbWeb3Call("/api/v1/dex/aggregator/swap", {
    params: { binanceChainId: "56", fromTokenAddress: USDT_BSC, toTokenAddress: mint,
      amount: amt, quoteId: qid, userWalletAddress: acct.address, slippagePercent: String(slippagePercent) },
  });
  if (s.code !== 0) throw Object.assign(new Error(`swap build failed: ${s.code} ${s.msg}`), { code: 400 });
  const { tx } = s.data;
  if (!tx?.to || !tx?.data) throw new Error("swap tx missing to/data");
  return { mint, sym, amt, qid, tx, acct, quote: Array.isArray(q.data) ? q.data[0] : q.data };
}

// Dry-run ONLY: build + simulate, never broadcast. Safe to call anywhere.
export async function bnbDryRunSwap({ symbol, amountUsd = 0.15, slippagePercent = 1 }) {
  const { mint, sym, tx, acct, quote } = await bnbBuildSwap({ symbol, amountUsd, slippagePercent });
  const sim = await bnbSimulateTx({ from: acct.address, to: tx.to, data: tx.data, value: "0", chainId: "56" });
  return {
    symbol: sym, mint, amountUsd, dryRun: true,
    router: tx.to, quotePriceImpactPct: quote?.priceImpactPercent ?? null,
    simulation: { ok: sim.ok, status: sim.status, failReason: sim.failReason },
    wouldBroadcast: false,
  };
}

// Execute a live USDT→tokenizedEquity spot swap for amountUsd.
// Returns hashes (never fabricated). Fails CLOSED on any gate failure.
// `deps` is injectable for tests (buildSwap / simulate / broadcast); production
// callers omit it and get the real Binance Web3 + viem path.
export async function bnbExecuteSwap({ symbol, amountUsd = 0.15, slippagePercent = 1 }, deps = {}) {
  const buildSwap = deps.buildSwap || bnbBuildSwap;
  const simulate = deps.simulate || bnbSimulateTx;
  const broadcast = deps.broadcast || defaultBroadcast;
  // --- server-side safety gates (never trust the caller) ---
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt < EXEC_MIN_USD || amt > EXEC_MAX_USD) {
    throw Object.assign(new Error(`amountUsd must be ${EXEC_MIN_USD}–${EXEC_MAX_USD}`), { code: 400 });
  }
  if (!Number.isFinite(Number(slippagePercent)) || Number(slippagePercent) > EXEC_SLIPPAGE_MAX) {
    throw Object.assign(new Error(`slippagePercent must be ≤ ${EXEC_SLIPPAGE_MAX}`), { code: 400 });
  }
  // Spot-only: this function only ever swaps token→token. Nothing else exists.

  const acct = execAccount();
  const key = idemKey(String(symbol).toUpperCase(), amt);
  if (_inflight.has(key)) throw Object.assign(new Error("duplicate execution in progress — ignored"), { code: 409 });
  _inflight.add(key);
  try {
    const { mint, sym, amt: atomAmt, tx } = await buildSwap({ symbol, amountUsd: amt, slippagePercent });

    // --- TRANSACTION API DRY-RUN GATE (fail closed) ---
    let sim;
    try { sim = await simulate({ from: acct.address, to: tx.to, data: tx.data, value: "0", chainId: "56" }); }
    catch (e) { throw Object.assign(new Error(`simulation could not be performed (${e.message}) — refusing to broadcast`), { code: 400 }); }
    if (!sim || !sim.ok || sim.status !== "SUCCESS") {
      const why = !sim || sim.status == null
        ? `simulation could not be performed (${(sim && sim.failReason) || "no verdict"}) — refusing to broadcast`
        : `simulation FAILED (${sim.failReason || "unknown"}) — refusing to broadcast`;
      throw Object.assign(new Error(why), { code: 400, simulation: sim || null });
    }

    // --- broadcast (only reached after a SUCCESS simulation) ---
    const { approveHash, swapHash } = await broadcast({ acct, tx, atomAmt });
    const out = {
      symbol: sym, amountUsd: amt, mint, router: tx.to, approveHash, swapHash,
      explorer: `https://bscscan.com/tx/${swapHash}`, liveLedger: true, status: "broadcast",
      simulation: { status: sim.status, ok: true },
    };
    appendExecLog({ at: Date.now(), chain: "BNB Smart Chain", chainId: BNB_CHAIN_ID, ...out });
    return out;
  } finally {
    _inflight.delete(key);
  }
}

// The real broadcast: approve USDT to the router, then send the swap tx.
async function defaultBroadcast({ acct, tx, atomAmt }) {
  const wc = createWalletClient({ chain: bsc, transport: http(BSC_RPC), account: acct });
  const approveHash = await wc.writeContract({
    address: USDT_BSC, abi: ERC20_APPROVE, functionName: "approve",
    args: [tx.to, BigInt(atomAmt)],
  });
  const swapHash = await wc.sendTransaction({ to: tx.to, data: tx.data, value: 0n, gas: 500000n });
  return { approveHash, swapHash };
}
