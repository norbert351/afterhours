// AfterHours v3 — live Solana execution rail.
// Reads the project wallet from .env (SOLANA_PRIVATE_KEY, base58), talks to the
// Solana RPC, and can broadcast REAL mainnet transactions.
//
// Honesty rules:
//  • No wallet key in .env -> every live function returns a clear NOT_CONFIGURED.
//  • The "probe" path signs + broadcasts a REAL tiny transfer to prove liveness.
//  • The Jupiter swap path is wired for the deployed host (Jupiter is blocked
//    from this dev VM, but reachable from Render); never fake a fill.
import { Keypair, Connection, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { cachedFetch } from "../lib/http.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export function walletKey() {
  return (process.env.SOLANA_PRIVATE_KEY || "").trim();
}
export function isConfigured() {
  return Boolean(walletKey());
}
export function conn() {
  return new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC, "confirmed");
}
export function getWallet() {
  const k = walletKey();
  if (!k) throw Object.assign(new Error("SOLANA_PRIVATE_KEY not configured"), { code: "SOL_NOT_CONFIGURED", status: 501 });
  return Keypair.fromSecretKey(bs58.decode(k));
}
export function address() {
  return getWallet().publicKey.toBase58();
}

export async function getBalance(connection = conn()) {
  if (!isConfigured()) return null;
  const lamports = await connection.getBalance(getWallet().publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

export async function info() {
  if (!isConfigured()) return { configured: false, error: "SOLANA_PRIVATE_KEY not configured" };
  return { configured: true, address: address(), balanceSol: await getBalance(), rpc: process.env.SOLANA_RPC_URL || DEFAULT_RPC };
}

// PROBE: sign + broadcast a real tiny transfer to/from the wallet to prove the
// rail works on mainnet. Safe amount default 2000 lamports (≈0.000002 SOL).
export async function probe({ lamports = 2000, connection = conn() } = {}) {
  if (!isConfigured()) throw Object.assign(new Error("not configured"), { code: "SOL_NOT_CONFIGURED", status: 501 });
  const wallet = getWallet();
  const from = wallet.publicKey;
  // self-transfer: proves signing + broadcast without moving funds meaningfully
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: from, lamports }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  return { signature: sig, from: from.toBase58(), lamports, explorer: `https://solscan.io/tx/${sig}` };
}

// Jupiter swap (SOL or SPL input; USDC etc). Returns the broadcast
// signature; never fabricates. Base URL note: quote-api.jup.ag was retired
// from DNS (2026); api.jup.ag/swap/v1 is the live surface (verified from
// this VM 2026-09-21 — real SOL->AAPLx fill FINALIZED).
const JUP_BASE = "https://api.jup.ag/swap/v1";

export async function jupiterSwap({
  inputMint, outputMint, amount, slippageBps = 300, connection = conn(),
} = {}) {
  if (!isConfigured()) throw Object.assign(new Error("not configured"), { code: "SOL_NOT_CONFIGURED", status: 501 });
  const wallet = getWallet();
  const quote = await cachedFetch(
    `${JUP_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`,
    { ttlMs: 0, retries: 3 },
  );
  if (!quote?.routePlan?.length) throw new Error("no route found");
  // Get a signed-able swap transaction
  const swapRes = await fetch(`${JUP_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: wallet.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  if (!swapRes.ok) throw new Error(`swap build failed ${swapRes.status}`);
  const { swapTransaction } = await swapRes.json();
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([wallet]);
  const sig = await connection.sendRawTransaction(await tx.serialize(), { skipPreflight: true, maxRetries: 8 });
  let confirmed = true;
  try { await connection.confirmTransaction(sig, "confirmed"); } catch { confirmed = false; } // never let a slow block kill the response
  return { signature: sig, explorer: `https://solscan.io/tx/${sig}`, outAmount: quote.outAmount, routes: quote.routePlan?.length ?? 0, confirmed };
}