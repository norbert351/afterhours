// register-erc8004.mjs — mint the AfterHours agent identity on the ERC-8004
// IdentityRegistry (BSC mainnet, chain 56). Sends ONE real transaction.
//
// Safety:
//  - READ-ONLY preflight: skips if the wallet already holds an agent NFT.
//  - DRY-RUN via the Binance Web3 Transaction API BEFORE broadcasting (fail closed).
//  - Caps gas price; aborts if the wallet cannot afford the tx.
//  - Prints only public hashes/ids — never the private key.
import { encodeFunctionData, parseAbi, createWalletClient, createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { bnbSimulateTx } from "../src/adapters/bsc.js";
import fs from "node:fs";

const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_URI = "https://afterhourequity.xyz/agent/afterhours-bnb.json";
const RPC = "https://bsc-dataseed.binance.org";
const ABI = parseAbi([
  "function register(string agentURI) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

const key = String(process.env.AH_BNB_EXEC_PRIVATE_KEY || "").trim();
if (!key) { console.error("AH_BNB_EXEC_PRIVATE_KEY not set"); process.exit(1); }
const acct = privateKeyToAccount(key);
const pc = createPublicClient({ chain: bsc, transport: http(RPC) });
const wc = createWalletClient({ chain: bsc, transport: http(RPC), account: acct });

console.log("wallet:", acct.address);
const bal = await pc.getBalance({ address: acct.address });
console.log("BNB balance:", formatEther(bal));

// 1) idempotency: already registered?
const held = await pc.readContract({ address: REG, abi: ABI, functionName: "balanceOf", args: [acct.address] });
console.log("existing agent NFTs held:", held.toString());
if (held > 0n) {
  console.log("ALREADY REGISTERED — no action taken.");
  process.exit(0);
}

const data = encodeFunctionData({ abi: ABI, functionName: "register", args: [AGENT_URI] });

// 2) dry-run gate (fail closed)
const sim = await bnbSimulateTx({ from: acct.address, to: REG, data, value: "0", chainId: "56" });
console.log("pre-broadcast simulate:", sim.status, sim.failReason || "");
if (!sim.ok) { console.error("simulation not SUCCESS — refusing to broadcast"); process.exit(1); }

// 3) cost check
const [gasPrice, gasEst] = await Promise.all([pc.getGasPrice(), pc.estimateGas({ account: acct.address, to: REG, data })]);
const cost = gasEst * gasPrice;
console.log("gas:", gasEst.toString(), "cost:", formatEther(cost), "BNB");
if (bal <= cost) { console.error("insufficient BNB for gas"); process.exit(1); }

// 4) broadcast
console.log("broadcasting register() ...");
const hash = await wc.sendTransaction({ to: REG, data, gas: gasEst + 20000n });
console.log("tx:", hash);
const rc = await pc.waitForTransactionReceipt({ hash, timeout: 60000 });
console.log("status:", rc.status, "block:", rc.blockNumber.toString(), "logs:", rc.logs.length);

// extract agentId from the transfer log topic (ERC-721 mint: topic3 = tokenId)
let agentId = null;
for (const lg of rc.logs) {
  if (lg.topics && lg.topics.length >= 4) { try { agentId = BigInt(lg.topics[3]).toString(); } catch {} }
}
console.log("RESULT:", JSON.stringify({
  registered: rc.status === "success", txHash: hash, block: Number(rc.blockNumber),
  agentId, explorer: `https://bscscan.com/tx/${hash}`, agentURI: AGENT_URI, registry: REG,
}, null, 1));
const rec = { at: Date.now(), chainId: 56, registry: REG, txHash: hash, block: Number(rc.blockNumber), status: rc.status, agentId, wallet: acct.address, agentURI: AGENT_URI };
try { const p = new URL("../data/erc8004-registration.json", import.meta.url).pathname; fs.writeFileSync(p, JSON.stringify(rec, null, 2)); } catch {}
