// AfterHours — Express API + static frontend. Serves ONLY verified live data.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { buildDashboard, buildUniverse } from "./services/oracle.js";
import { findDislocations } from "./services/dislocation.js";
import { addRule, listRules, evaluateAll } from "./services/strategies.js";
import { listReferencePrices } from "./adapters/twelvedata.js";
import { feedRegistry, latestAaplPrices } from "./adapters/pyth.js";
import { openStore, getAccount, listPositions, listStrategies, insertStrategy, listDecisions, listAlerts } from "./store.js";
import { runEngine } from "./services/v2.js";
import { startRunLoop } from "./services/loop.js";
import { fromMicro } from "./services/paper.js";
import * as solana from "./services/solana.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// v2 persistent store (node:sqlite, WAL). One DB for the process.
const db = openStore(process.env.AH_DB_PATH);

// Simple error wrapper for async handlers + honest error surfaces.
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) =>
    res.status(e.status || 500).json({ error: e.message, code: e.code || "INTERNAL" }),
  );

app.get("/api/health", (_req, res) => res.json({ ok: true, at: Date.now(), service: "afterhours" }));

app.get("/api/universe", wrap(async (_req, res) => res.json(await buildUniverse())));
app.get("/api/dashboard", wrap(async (_req, res) => res.json(await buildDashboard())));
app.get("/api/dislocations", wrap(async (_req, res) => res.json(await findDislocations())));
app.get("/api/references", wrap(async (_req, res) => res.json(await listReferencePrices())));
app.get("/api/pyth", wrap(async (_req, res) => {
  const reg = feedRegistry();
  if (reg.apiKeyConfigured) return res.json({ ...reg, live: await latestAaplPrices() });
  return res.json(reg);
}));

app.post("/api/strategies", wrap(async (req, res) => res.status(201).json(addRule(String(req.body?.text || "")))));
app.get("/api/strategies", wrap(async (_req, res) => res.json(listRules())));
app.get("/api/strategies/evaluate", wrap(async (_req, res) => res.json(await evaluateAll())));

// ---- v2 : strategy layer + paper execution ledger ----
app.get("/api/v2/strategies", wrap(async (_req, res) => res.json(listStrategies(db))));
app.post("/api/v2/strategies", wrap(async (req, res) => {
  const type = ["rotate_to_discount", "alert"].includes(req.body?.type) ? req.body.type : "rotate_to_discount";
  const list = insertStrategy(db, { text: String(req.body?.text || "").trim() || `rotate_to_discount`, strategyType: type, params: req.body?.params || {} });
  res.status(201).json(list);
}));
// Run the strategy engine once: deploys the current strategy to the paper book.
app.post("/api/v2/run", wrap(async (_req, res) => res.json(await runEngine(db))));
// Paper book snapshot (account + positions), decisions, alerts.
app.get("/api/v2/book", wrap(async (_req, res) => {
  const acc = getAccount(db);
  const uni = await buildUniverse();
  // current token price + issuer per instrument (what a valuation uses)
  const px = new Map();
  const issuer = new Map();
  for (const i of uni.instruments) {
    const t = typeof i.tokenPrice === "number" ? i.tokenPrice : i.markPrice;
    if (typeof t === "number") px.set(i.symbol, t);
    issuer.set(i.symbol, i.issuer);
  }
  const positions = listPositions(db).map((p) => {
    const price = px.get(p.symbol) ?? (p.avgCostMicro / 1_000_000);
    return {
      symbol: p.symbol, issuer: issuer.get(p.symbol) || p.issuer, shares: p.qtyMicro / 1_000_000,
      avgCostUsd: p.avgCostMicro / 1_000_000,
      valueUsd: (p.qtyMicro / 1_000_000) * price,
      realizedPnlUsd: p.realizedPnlMicro / 1_000_000,
    };
  });
  res.json({ account: { seedUsd: fromMicro(acc.seedMicro), cashUsd: fromMicro(acc.cashMicro), peakNavUsd: fromMicro(acc.peakNavMicro) }, positions });
}));
app.get("/api/v2/decisions", wrap(async (req, res) => res.json(listDecisions(db, Number(req.query.limit) || 20))));
app.get("/api/v2/alerts", wrap(async (req, res) => res.json(listAlerts(db, Number(req.query.limit) || 30))));
app.get("/api/v2/status", wrap(async (_req, res) => res.json(runStatus.status())));

// ---- v3 : live Solana execution rail (mainnet) ----
app.get("/api/v3/live/info", wrap(async (_req, res) => res.json(await solana.info())));
app.post("/api/v3/live/probe", wrap(async (req, res) => {
  const lamports = Number.isFinite(Number(req.body?.lamports)) ? Number(req.body.lamports) : 2000;
  res.json(await solana.probe({ lamports: Math.min(Math.max(lamports, 0), 5_000) }));
}));
app.post("/api/v3/live/swap", wrap(async (req, res) => {
  const { inputMint, outputMint, amount } = req.body || {};
  if (!inputMint || !outputMint || !Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: "inputMint, outputMint and amount (base-unit atoms) required" });
  }
  res.json(await solana.jupiterSwap({ inputMint, outputMint, amount: Number(amount) }));
}));

// Autonomous run loop (enabled unless AH_AUTORUN=0). Kicks the paper strategy
// on an interval so the book runs itself; guarded against overlap.
const runLoop = startRunLoop(db, { intervalMs: Number(process.env.AH_RUN_INTERVAL_MS || 60_000) });
if (String(process.env.AH_AUTORUN).trim() !== "0") runLoop.start();
const runStatus = { status: () => runLoop.status() };

// Static frontend.
app.use(express.static(path.join(__dirname, "..", "public")));

export function start() {
  return app.listen(config.port, () => {
    console.log(`AfterHours running → http://localhost:${config.port}`);
  });
}