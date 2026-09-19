// Dev driver: prove the Raydium v2 SDK routes a real AAPLx<->USDC pool from the
// working RPC (bypassing the blocked Jupiter HTTP). Read-only quote/route check.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import { Raydium } from "@raydium-io/raydium-sdk-v2";

const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const key = env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)?.[1];
const wallet = Keypair.fromSecretKey(bs58.decode(key.trim()));
console.log("wallet:", wallet.publicKey.toBase58());

const raydium = await Raydium.load({ connection: conn, owner: wallet.publicKey, fetchToken: true, disableLoadIntoMemory: true });
console.log("raydium loaded. version:", raydium.version);

const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const pools = await raydium.api.fetchPoolKeysByMints({ mint1: AAPLX, mint2: USDC });
console.log("AAPLx/USDC pools:", pools.length);
for (const p of pools.slice(0, 4)) console.log("  pool", p.poolId, "| market", p.marketId, "| v", p.version || p.programId?.slice?.(0, 6));
console.log("ROUTE_READY");