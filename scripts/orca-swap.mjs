// Attempt a REAL SOL->AAPLx swap on the AAPLx/SOL Orca Whirlpool.
// Uses the funded wallet's SOL; broadcasts a genuine mainnet tx if it assembles.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Token, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import {
  WhirlpoolContext, buildWhirlpoolClient, swapQuoteByInputToken,
  ORCA_WHIRLPOOL_PROGRAM_ID, PDAUtil, getTokenAmount,
} from "@orca-so/whirlpools-sdk";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const key = env.match(/^SOLANA_PRIVATE_KEY=(.*)$/m)?.[1];
const wallet = Keypair.fromSecretKey(bs58.decode(key.trim()));

const POOL = new PublicKey("5VgwxAPD37EHPqtW6v6gWq2bznPDqvpaGDuJoyGm6aJG");
const AAPLx = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const SOL = NATIVE_MINT;
const swapAmtSOL = 0.001; // 0.001 SOL of the wallet's 0.0099 SOL

const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const ctx = WhirlpoolContext.from(conn, wallet, ORCA_WHIRLPOOL_PROGRAM_ID);
const client = buildWhirlpoolClient(ctx);
console.log("wallet:", wallet.publicKey.toBase58(), "| balance:", (await conn.getBalance(wallet.publicKey))/1e9, "SOL");
const whirlpool = await client.getPool(POOL);
const [wSolAta] = PDAUtil.getAssociatedTokenPDA(TOKEN_PROGRAM_ID, ctx.walletAddr, SOL);

// Ensure wSOL ATA exists + funded (wrap native SOL)
try {
  const info = await conn.getAccountInfo(wSolAta);
  if (!info) {
    const wSolTok = new Token(conn, SOL, TOKEN_PROGRAM_ID, wallet);
    await wSolTok.createAssociatedTokenAccount(ctx.walletAddr);
  }
  await new Token(conn, SOL, TOKEN_PROGRAM_ID, wallet).transferNative(
    wSolAta, swapAmtSOL * 1e9 /* or SystemProgram.transfer + syncNative */,
  );
  console.log("wSOL funded:", (await conn.getTokenAccountBalance(wSolAta)).value.uiAmount, "wSOL");
} catch (e) { console.log("wrap ERR:", e.message); }

// quote: sell wSOL (input token A) for AAPLx
try {
  const inputToken = whirlpool.getTokenA(); // wSOL side
  const amount = getTokenAmount(inputToken, swapAmtSOL * 1e9);
  const quote = swapQuoteByInputToken(whirlpool, inputToken, amount, 300 /* 3% slippage */);
  console.log("quote ok: sell", swapAmtSOL, "wSOL -> recv", quote.getMinOutputAmount().toNumber()/1e8, "AAPLx (min)");
  const tx = await whirlpool.swap(quote);
  const sig = await ctx.provider.sendAndConfirm(tx, [], { skipPreflight: false });
  console.log("SWAP_SUBMITTED:", sig);
} catch (e) {
  console.log("SWAP_ERR:", e.message);
}
console.log("DONE");