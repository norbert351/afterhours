// Dry-run the ERC-8004 register() tx via the Binance Web3 Transaction API.
// No broadcast. Gives a definitive SUCCESS/FAILED verdict before spending gas.
import { encodeFunctionData, parseAbi } from "viem";
import { bnbSimulateTx } from "../src/adapters/bsc.js";
const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const WALLET = "0xa5de403F977f68c46716fA787205d8E074F8a94F";
const ABI = parseAbi(["function register(string agentURI) returns (uint256)"]);
const data = encodeFunctionData({ abi: ABI, functionName: "register", args: ["https://afterhourequity.xyz/agent/afterhours-bnb.json"] });
console.log("simulating register() from", WALLET, "→", REG);
const sim = await bnbSimulateTx({ from: WALLET, to: REG, data, value: "0", chainId: "56" });
console.log("simulate verdict:", JSON.stringify({ ok: sim.ok, status: sim.status, failReason: sim.failReason }, null, 1));
