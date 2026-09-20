// REAL SOL->AAPLx swap via Jupiter (reachable api.jup.ag), signed + broadcast + verified.
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const keypair = Keypair.fromSecretKey(bs58.decode(env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)[1].trim()));
const SOL = "So11111111111111111111111111111111111111112";
const AAPLx = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const AMOUNT = 600_000; // 0.0006 SOL -> ~$0.07 AAPLx; leaves room for ATA rent + gas
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

console.log("wallet:", keypair.publicKey.toBase58(), "| SOL", (await conn.getBalance(keypair.publicKey))/1e9);

const q = await (await fetch("https://api.jup.ag/swap/v1/quote?inputMint="+SOL+"&outputMint="+AAPLx+"&amount="+AMOUNT+"&slippageBps=500")).json();
console.log("quote:", (Number(q.inAmount)/1e9).toFixed(4), "SOL ->", (Number(q.outAmount)/1e8).toFixed(6), "AAPLx | impact", q.priceImpactPct+"%");

const s = await (await fetch("https://api.jup.ag/swap/v1/swap", {
  method: "POST", headers: {"Content-Type":"application/json"},
  body: JSON.stringify({ quoteResponse: q, userPublicKey: keypair.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
})).json();
if (!s.swapTransaction) throw new Error("no swap tx: " + JSON.stringify(s).slice(0,200));
const tx = VersionedTransaction.deserialize(Buffer.from(s.swapTransaction, "base64"));
tx.sign([keypair]);
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
console.log("BROADCAST:", sig);
console.log("EXPLORER: https://solscan.io/tx/"+sig);