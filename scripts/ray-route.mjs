import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const key = env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)?.[1];
const wallet = key ? Keypair.fromSecretKey(bs58.decode(key.trim())) : null;

const RPC = "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
const AAPLx = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const owner = wallet ? wallet.publicKey : new PublicKey("7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg");
const raydium = await Raydium.load({ connection: conn, owner, fetchToken: true, disableLoadIntoMemory: false });
console.log("raydium loaded; wallet:", owner.toBase58());

// amount in base units (AAPLx has 8 decimals; 1 token = 1e8 atoms)
const AMOUNT = 1e8;
try {
  const routes = await raydium.tradeV2.fetchSwapRoutesData({
    inputMint: new PublicKey(AAPLx), outputMint: new PublicKey(USDC),
    amountIn: AMOUNT, slippageBps: 300,
  });
  console.log("routes keys:", Object.keys(routes || {}));
  console.log("routeInfos count:", routes?.routeInfos?.length ?? routes?.routeInfo?.length);
  for (const r of (routes?.routeInfos || routes?.routeInfo || []).slice(0,5)) {
    console.log("  route:", r?.legs?.length, "legs | poolType", r?.legs?.[0]?.poolType, "| program", (r?.legs?.[0]?.programId||"").toString?.().slice(0,8));
  }
} catch (e) {
  console.log("getAvailableRoutes ERR:", e.message);
}
console.log("DONE");