// Estimate the cost of an ERC-8004 register() tx WITHOUT sending it.
import { encodeFunctionData, parseAbi, createPublicClient, http, formatEther } from "viem";
import { bsc } from "viem/chains";
const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const WALLET = "0xa5de403F977f68c46716fA787205d8E074F8a94F";
const ABI = parseAbi(["function register(string agentURI) returns (uint256)"]);
const pc = createPublicClient({ chain: bsc, transport: http("https://bsc-dataseed.binance.org") });
const data = encodeFunctionData({ abi: ABI, functionName: "register", args: ["https://afterhourequity.xyz/agent/afterhours-bnb.json"] });
const [balance, gasPrice, est] = await Promise.all([
  pc.getBalance({ address: WALLET }),
  pc.getGasPrice(),
  pc.estimateGas({ account: WALLET, to: REG, data }).catch((e) => ({ error: e.shortMessage || e.message })),
]);
console.log("wallet BNB balance:", formatEther(balance));
console.log("gasPrice (gwei):", Number(gasPrice) / 1e9);
if (est.error) console.log("estimateGas ERROR:", est.error);
else {
  const cost = est * gasPrice;
  console.log("estimated gas:", est.toString());
  console.log("estimated cost:", formatEther(cost), "BNB ≈ $" + (Number(formatEther(cost)) * 600).toFixed(3));
  console.log("AFFORDABLE:", balance > cost);
}
