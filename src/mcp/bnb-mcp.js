#!/usr/bin/env node
// AfterHours BNB — minimal MCP server (stdio JSON-RPC, zero deps).
// Exposes the product's real rails as MCP tools so an AI agent (BNB Agent
// Studio or Binance Agentic Wallet via MCP) can drive it. This is the load-
// bearing surface for the two $2K specials.
//
// Tools:
//   bnb_gap         — weekend-gap surface on BNB (on-chain vs frozen ref)
//   bnb_quote       — keyless KyberSwap route quote (read-only, capped)
//   bnb_status      — what rails are configured (honest configured:false)
//
// Speaks the MCP protocol over stdin/stdout: initialize, tools/list, tools/call.
import { bnbUniverse, bnbStatus, bnbQuote } from "../services/bnb.js";
import { bnbWeb3Configured } from "../adapters/bsc.js";

const readline = (async function* () {
  const rl = (await import("node:readline")).createInterface({ input: process.stdin });
  for await (const line of rl) yield line;
})();

const TOOLS = [
  {
    name: "bnb_gap",
    description: "Weekend-gap surface on BNB Chain: tokenized-equity on-chain price vs frozen reference. Real per-stock values need the Web3 API RWA key; with it unset, gated values are flagged honestly (never fabricated).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "bnb_quote",
    description: "Keyless KyberSwap route quote on BSC (read-only, capped). Returns amountOut for converting BNB to USDT.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "BNB amount (default 0.1). Capped server-side." },
      },
    },
  },
  {
    name: "bnb_status",
    description: "Which BNB rails are configured and reachable (BSC RPC, GeckoTerminal, KyberSwap, TwelveData, Binance Web3 API).",
    inputSchema: { type: "object", properties: {} },
  },
];

async function handle(method, params, id) {
  switch (method) {
    case "initialize":
      return { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "afterhours-bnb", version: "0.1.0" } };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        if (name === "bnb_gap") { const u = await bnbUniverse(); return { content: [{ type: "text", text: JSON.stringify({ chain: "bnb", configured: u.configured, keyNote: (await bnbStatus()).keyNote, gaps: u.gaps }, null, 2) }] }; }
        if (name === "bnb_quote") { const amt = Math.max(Number(args.amount) || 0.1, 0.001); const q = await bnbQuote({ amountAtoms: Math.round(amt * 1e18) }); return { content: [{ type: "text", text: JSON.stringify({ code: q.code, amountOut: q.data?.routeSummary?.amountOut }, null, 2) }] }; }
        if (name === "bnb_status") { return { content: [{ type: "text", text: JSON.stringify(await bnbStatus(), null, 2) }] }; }
        return { isError: true, content: [{ type: "text", text: "unknown tool: " + name }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: "error: " + (e.message || e).slice(0, 300) }] };
      }
    }
    default:
      return { error: { code: -32601, message: "method not found: " + method } };
  }
}

for await (const line of readline) {
  if (!line.trim()) continue;
  let msg;
  try { msg = JSON.parse(line); } catch { continue; }
  if (!msg || typeof msg.method !== "string") continue;
  const result = await handle(msg.method, msg.params, msg.id);
  const out = { jsonrpc: "2.0", id: msg.id ?? null };
  if (typeof result === "object" && result !== null && "error" in result) out.error = result.error;
  else out.result = result;
  process.stdout.write(JSON.stringify(out) + "\n");
}