// READ-ONLY ERC-8004 IdentityRegistry probe (BSC mainnet). No tx, no signature.
import { keccak256, toHex, encodeFunctionData, parseAbi } from "viem";
const RPC = "https://bsc-dataseed.binance.org";
const REG = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const WALLET = "0xa5de403F977f68c46716fA787205d8E074F8a94F";
async function rpc(m, p) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); return j.result !== undefined ? j.result : { error: j.error };
}
const ABI = parseAbi([
  "function register() returns (uint256)",
  "function register(string agentURI) returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
]);
for (const fn of ["register()", "register(string)"]) {
  const data = fn === "register()" ? encodeFunctionData({ abi: ABI, functionName: "register" })
    : encodeFunctionData({ abi: ABI, functionName: "register", args: [""] });
  const res = await rpc("eth_call", [{ from: WALLET, to: REG, data }, "latest"]);
  console.log(`eth_call ${fn} from our wallet ->`, JSON.stringify(res).slice(0, 200));
}
console.log("totalSupply ->", await rpc("eth_call", [{ to: REG, data: encodeFunctionData({ abi: ABI, functionName: "totalSupply" }) }, "latest"]));
console.log("balanceOf(wallet) ->", await rpc("eth_call", [{ to: REG, data: encodeFunctionData({ abi: ABI, functionName: "balanceOf", args: [WALLET] }) }, "latest"]));
// Is our wallet already an agent? try ownerOf(370902) and a few ids
for (const id of [370902, 1, 2]) {
  console.log(`ownerOf(${id}) ->`, await rpc("eth_call", [{ to: REG, data: encodeFunctionData({ abi: ABI, functionName: "ownerOf", args: [BigInt(id)] }) }, "latest"]));
}
