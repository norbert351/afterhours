// INDEPENDENT on-chain verification of the ERC-8004 registration.
// Reads the registry directly — does not trust the registration script's output.
import { parseAbi, createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const WALLET = "0xa5de403F977f68c46716fA787205d8E074F8a94F";
const ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function totalSupply() view returns (uint256)",
]);
const pc = createPublicClient({ chain: bsc, transport: http("https://bsc-dataseed.binance.org") });
const bal = await pc.readContract({ address: REG, abi: ABI, functionName: "balanceOf", args: [WALLET] });
console.log("wallet agent-NFT balance:", bal.toString());
const agentId = 369879n;
const owner = await pc.readContract({ address: REG, abi: ABI, functionName: "ownerOf", args: [agentId] });
console.log(`ownerOf(${agentId}):`, owner);
console.log("OWNERSHIP MATCHES WALLET:", owner.toLowerCase() === WALLET.toLowerCase());
const uri = await pc.readContract({ address: REG, abi: ABI, functionName: "tokenURI", args: [agentId] }).catch((e) => "read error: " + e.shortMessage);
console.log("tokenURI:", uri);
