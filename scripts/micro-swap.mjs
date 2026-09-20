// REAL micro swap (~$0.24): SOL -> AAPLx via Jupiter /swap/v1 on api.jup.ag (the CURRENT host).
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
const keypair = Keypair.fromSecretKey(bs58.decode(env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)[1].trim()));
const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const SOL = "So11111111111111111111111111111111111111112";
const AAPLx = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const AMOUNT = 1_600_000; // 0.0016 SOL ≈ $0.24

async function aaplxBal() {
  const toks = await conn.getParsedTokenAccountsByOwner(keypair.publicKey, { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") });
  for (const a of toks.value) if (a.account.data.parsed.info.mint === AAPLx) return Number(a.account.data.parsed.info.tokenAmount.uiAmount);
  return 0;
}
const beforeSol = (await conn.getBalance(keypair.publicKey)) / 1e9;
const beforeAaplx = await aaplxBal();
console.log("BEFORE: SOL", beforeSol.toFixed(6), "| AAPLx", beforeAaplx.toFixed(8));

const q = await (await fetch(`https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${AAPLx}&amount=${AMOUNT}&slippageBps=300`)).json();
if (!q?.routePlan?.length) throw new Error("no route: " + JSON.stringify(q).slice(0, 200));
console.log("quote: 0.0016 SOL →", (Number(q.outAmount) / 1e8).toFixed(8), "AAPLx | impact", q.priceImpactPct + "% | amm:", q.routePlan[0].swapInfo.label);
const s = await (await fetch("https://api.jup.ag/swap/v1/swap", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ quoteResponse: q, userPublicKey: keypair.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
})).json();
if (!s.swapTransaction) throw new Error("swap build failed: " + JSON.stringify(s).slice(0, 200));
const tx = VersionedTransaction.deserialize(Buffer.from(s.swapTransaction, "base64"));
tx.sign([keypair]);
const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 8 });
console.log("BROADCAST:", sig);
let state = null;
for (let i = 0; i < 18; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await conn.getSignatureStatuses([sig]);
  const v = st.value?.[0];
  if (v?.err) { state = "ERR " + JSON.stringify(v.err).slice(0, 140); break; }
  if (v?.confirmationStatus === "finalized") { state = "FINALIZED"; break; }
  if (v?.confirmationStatus === "confirmed") state = "confirmed";
}
console.log("STATE:", state ?? "not confirmed in 90s");
if (state === "FINALIZED" || state === "confirmed") {
  await new Promise((r) => setTimeout(r, 3000));
  const afterSol = (await conn.getBalance(keypair.publicKey)) / 1e9;
  const afterAaplx = await aaplxBal();
  console.log("AFTER:  SOL", afterSol.toFixed(6), "| AAPLx", afterAaplx.toFixed(8));
  console.log("DELTA:  AAPLx", (afterAaplx - beforeAaplx).toFixed(8), "| SOL", (afterSol - beforeSol).toFixed(6));
  console.log("EXPLORER: https://solscan.io/tx/" + sig);
} else {
  console.log("EXPLORER: https://solscan.io/tx/" + sig);
  process.exit(2);
}