import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import { Raydium } from "@raydium-io/raydium-sdk-v2";

const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const wallet = PublicKey.fromBase58 ? PublicKey.fromBase58("7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg") : new PublicKey("7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg");

const r = await Raydium.load({ connection: conn, owner: wallet, fetchToken: true, disableLoadIntoMemory: false });
console.log("tradeV2:", Object.getOwnPropertyNames(r.tradeV2 || {}).join(", "));
console.log("cpmm:", Object.getOwnPropertyNames(r.cpmm || {}).join(", "));
console.log("clmm:", Object.getOwnPropertyNames(r.clmm || {}).join(", "));

// Show the swap function source for tradeV2 if present
for (const key of ["swapV2", "swap"]) {
  const fn = r.tradeV2?.[key] || r.cpmm?.[key] || r.clmm?.[key];
  if (fn) console.log(`\n${key} signature:\n${fn.toString().slice(0, 400)}`);
}
// api.api is an axios-like: show methods
console.log("\napi.api own methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(r.api?.api || {}))?.join(", "));