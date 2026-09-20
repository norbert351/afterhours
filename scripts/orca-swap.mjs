// REAL wSOL->AAPLx swap on the AAPLx/SOL Orca Whirlpool.
// wSOL already on-chain (wrap done). This broadcasts the actual token purchase.
import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT,
  getAssociatedTokenAddress, getAccount,
} from "@solana/spl-token";
import anchor from "@coral-xyz/anchor";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import BN from "bn.js";
import {
  WhirlpoolContext, buildWhirlpoolClient, swapQuoteByInputToken,
  toTx, ORCA_WHIRLPOOL_PROGRAM_ID,
} from "@orca-so/whirlpools-sdk";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const keypair = Keypair.fromSecretKey(bs58.decode(env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)[1].trim()));
const wallet = new anchor.Wallet(keypair);
const POOL = new PublicKey("5VgwxAPD37EHPqtW6v6gWq2bznPDqvpaGDuJoyGm6aJG");
const AAPLx = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
console.log("wallet:", keypair.publicKey.toBase58(), "| SOL", (await conn.getBalance(keypair.publicKey))/1e9);

// wSOL ATA (Token v1 owned per on-chain wrap)
const wSolAta = await getAssociatedTokenAddress(NATIVE_MINT, keypair.publicKey, false, TOKEN_PROGRAM_ID);
const wSolBal = (await getAccount(conn, wSolAta)).amount;
console.log("wSOL ATA balance:", (await conn.getTokenAccountBalance(wSolAta)).value.uiAmount, "wSOL |", wSolBal.toString());

const ctx = WhirlpoolContext.from(conn, wallet, undefined, undefined, undefined, ORCA_WHIRLPOOL_PROGRAM_ID);
const client = buildWhirlpoolClient(ctx);
const pool = await client.getPool(POOL);
console.log("pool loaded:", pool.getAddress().toBase58());

const inputMint = NATIVE_MINT; // sell wSOL, buy AAPLx
const amount = new BN(wSolBal.toString()); // whole wSOL balance (9 decimals)
const slippage = { numerator: new BN(5000), denominator: new BN(10000) }; // 50% (tiny pool)
const quote = await swapQuoteByInputToken(pool, inputMint, amount, slippage, ORCA_WHIRLPOOL_PROGRAM_ID, ctx.fetcher);
console.log("quote keys:", Object.keys(quote||{}).join(","));
const minOut = (quote.otherAmountThreshold?.toNumber() ?? 0) / 1e8;
console.log("quote ok: sell", (quote.amount?.toNumber?.() ?? 0)/1e9, "wSOL -> recv ≥", minOut, "AAPLx");
const tx = await pool.swap(quote);
const br = await tx.build();
const vtx = br.transaction; // already a VersionedTransaction
vtx.sign([keypair]);
const sig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: true });
console.log("SWAP_BROADCAST:", sig);
console.log("EXPLORER: https://solscan.io/tx/"+sig);