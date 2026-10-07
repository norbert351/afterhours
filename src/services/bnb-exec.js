// bnb-exec.js, LIVE spot execution on BSC for the AfterHours BNB build.
// Spends the BNB execution wallet (AH_BNB_EXEC_PRIVATE_KEY, in .env, never
// printed). Flow: aggregator quote → swap calldata → approve USDT to the router
// → broadcast the swap tx on BSC. This is the "it actually trades" proof.
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { bnbWeb3Call, USDT_BSC, BSC_RPC } from "../adapters/bsc.js";
import fs from "node:fs";

// Live-execution proof log, every real BSC fill is persisted here so the Proof
// page can surface it. Never fabricated: only records an actual broadcast result.
const EXEC_LOG = new URL("../../data/bnb-exec.json", import.meta.url).pathname;
function readExecLog() { try { return JSON.parse(fs.readFileSync(EXEC_LOG, "utf8")); } catch { return []; } }
function appendExecLog(rec) { try { const l = readExecLog(); l.unshift(rec); fs.writeFileSync(EXEC_LOG, JSON.stringify(l.slice(0, 100), null, 2)); } catch { /* non-fatal */ } }
export function listBnbExecs(limit = 20) { return readExecLog().slice(0, limit); }
export function bnbExecConfigured() { return !!String(process.env.AH_BNB_EXEC_PRIVATE_KEY || "").trim(); }

const ERC20_APPROVE = [{ name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }];

export function execAccount() {
  const key = String(process.env.AH_BNB_EXEC_PRIVATE_KEY || "").trim();
  if (!key) throw Object.assign(new Error("AH_BNB_EXEC_PRIVATE_KEY not configured"), { code: 501 });
  return privateKeyToAccount(key);
}
export function execAddress() { return execAccount().address; }
export function bnbExecAddress() { return execAddress(); }

// Resolve a bStocks/Ondo symbol to its BSC mint via the RWA universe (reuse bnbRealTokens).
async function resolveMint(symbol) {
  const { bnbRealTokens } = await import("../adapters/bsc.js");
  const tokens = [...(await bnbRealTokens({ platform: "bstock" })), ...(await bnbRealTokens({ platform: "ondo" }))];
  const t = tokens.find((x) => x.tokenSymbol?.toUpperCase() === symbol.toUpperCase()
    || x.underlyingTicker?.toUpperCase() === symbol.toUpperCase());
  if (!t) throw Object.assign(new Error(`no "${symbol}" in BSC RWA universe`), { code: 404 });
  return { mint: t.tokenContractAddress, symbol: t.tokenSymbol, name: t.tokenName };
}

// Execute a live USDT→tokenizedEquity swap for amountUsd. Returns hashes (never fabricated).
export async function bnbExecuteSwap({ symbol, amountUsd = 0.15, slippagePercent = 1 }) {
  const acct = execAccount();
  const { mint, symbol: sym } = await resolveMint(symbol);
  const amt = String(Math.round(amountUsd * 1e18)); // USDT 18dp on BSC
  // 1) quote
  const q = await bnbWeb3Call("/api/v1/dex/aggregator/quote", {
    params: { binanceChainId: "56", fromTokenAddress: USDT_BSC, toTokenAddress: mint, amount: amt },
  });
  if (q.code !== 0) throw Object.assign(new Error(`quote failed: ${q.code} ${q.msg}`), { code: 400 });
  const qid = Array.isArray(q.data) ? q.data[0].quoteId : q.data?.quoteId;
  // 2) swap calldata
  const s = await bnbWeb3Call("/api/v1/dex/aggregator/swap", {
    params: { binanceChainId: "56", fromTokenAddress: USDT_BSC, toTokenAddress: mint,
      amount: amt, quoteId: qid, userWalletAddress: acct.address, slippagePercent: String(slippagePercent) },
  });
  if (s.code !== 0) throw Object.assign(new Error(`swap build failed: ${s.code} ${s.msg}`), { code: 400 });
  const { tx } = s.data;
  if (!tx?.to || !tx?.data) throw new Error("swap tx missing to/data");
  // 3) approve USDT to the router
  const wc = createWalletClient({ chain: bsc, transport: http(BSC_RPC), account: acct });
  const approveHash = await wc.writeContract({
    address: USDT_BSC, abi: ERC20_APPROVE, functionName: "approve",
    args: [tx.to, BigInt(amt)],
  });
  // 4) broadcast the swap tx
  const swapHash = await wc.sendTransaction({
    to: tx.to, data: tx.data, value: 0n, gas: 500000n,
  });
  const out = {
    symbol: sym, amountUsd, mint, router: tx.to, approveHash, swapHash,
    explorer: `https://bscscan.com/tx/${swapHash}`, liveLedger: true,
  };
  appendExecLog({ at: Date.now(), chain: "BNB Smart Chain", chainId: 56, ...out });
  return out;
}