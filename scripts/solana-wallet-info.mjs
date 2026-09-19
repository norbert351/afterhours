import { Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const key = env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)?.[1];
const rpc = env.match(/^SOLANA_RPC_URL=(.*)$/m)?.[1];
if (!key) { console.log("No SOLANA_PRIVATE_KEY set."); process.exit(1); }
const kp = Keypair.fromSecretKey(bs58.decode(key.trim()));
console.log("Address:", kp.publicKey.toBase58());
const conn = new Connection(rpc || "https://api.mainnet-beta.solana.com", "confirmed");
const bal = await conn.getBalance(kp.publicKey);
console.log("Balance:", (bal / LAMPORTS_PER_SOL).toFixed(4), "SOL");
console.log("RPC:", rpc || "https://api.mainnet-beta.solana.com");
