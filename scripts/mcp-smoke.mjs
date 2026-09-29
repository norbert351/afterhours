// smoke-test the AfterHours BNB MCP server via stdio.
import { spawn } from "node:child_process";
const child = spawn("node", ["--dns-result-order=ipv4first", "src/mcp/bnb-mcp.js"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "inherit"] });
const msgs = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "bnb_status", arguments: {} } },
];
let buf = "";
child.stdout.on("data", (d) => { buf += d; });
child.stdout.on("end", () => {
  const lines = buf.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const r of lines) {
    if (r.result?.tools) console.log("tools →", r.result.tools.map((t) => t.name).join(", "));
    else if (r.result?.content) console.log("bnb_status →", r.result.content[0].text.slice(0, 130));
    else if (r.result?.serverInfo) console.log("init →", r.result.serverInfo.name, "v" + r.result.serverInfo.version);
  }
});
for (const m of msgs) child.stdin.write(JSON.stringify(m) + "\n");
child.stdin.end();