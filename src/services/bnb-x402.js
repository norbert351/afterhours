// bnb-x402.js — AfterHours BNB agent *self-funding* via x402.
// Exposes the real BNB weekend-gap report as an x402 pay-per-call resource:
// a buyer sends an EIP-3009 payment in $U (settlement token of the BNB agent
// economy) to the exec wallet; once settled on-chain the report is served.
// The proceeds fund the agent's autonomous loop + gas — the "self-funding via
// x402" axis of the BNB Agent Studio special.
import { createX402Merchant, U_TOKEN } from "@altananetwork/x402-server";
import { parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { execAccount } from "./bnb-exec.js";
import { BSC_RPC } from "../adapters/bsc.js";

const CHAIN = 56; // BSC mainnet
const account = execAccount();

const merchant = createX402Merchant({
  chainId: CHAIN,
  payTo: account.address,                 // agent collects its own earnings
  price: parseEther("0.01"),              // $0.01 per call
  minPrice: parseEther("0.001"),
  maxPrice: parseEther("1"),
  rails: [{ rail: "eip3009", token: U_TOKEN[CHAIN] }], // $U eip3009 (Studio-compatible)
  resource: { url: "https://afterhourequity.xyz/api/bnb/agent/gap", mimeType: "application/json" },
  facilitator: account,                   // broadcasts settlement, pays BNB gas
  rpcUrl: BSC_RPC,
  chain: bsc,
});

export async function requireBnbGapPayment(header) {
  return merchant.requirePayment(header);
}
export function bnbChallengeBody() { return merchant.challengeBody(); }
export function merchantPayTo() { return account.address; }
export function merchantPriceUsd() { return "0.01 $U (eip3009 · $U)"; }