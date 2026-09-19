import { Connection, PublicKey } from "@solana/web3.js";
import { Raydium } from "@raydium-io/raydium-sdk-v2";
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const owner = new PublicKey("7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg");
const raydium = await Raydium.load({ connection: conn, owner, fetchToken: true, disableLoadIntoMemory: false });
function proto(el){ const arr=[]; let o=el; while(o){ arr.push(...Object.getOwnPropertyNames(o)); o=Object.getPrototypeOf(o); } return [...new Set(arr)].filter(n=>typeof el[n]==='function').join(', '); }
console.log("tradeV2 fns:", proto(raydium.tradeV2));
console.log("cpmm fns:", proto(raydium.cpmm));
console.log("api fns:", proto(raydium.api).slice(0,30));
// quoteV2 signature
const q = raydium.tradeV2?.quoteV2; if(q) console.log("quoteV2 sig:\n", q.toString().slice(0,600));
console.log("--- api.api (axios) methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(raydium.api.api||{})).join(", "));