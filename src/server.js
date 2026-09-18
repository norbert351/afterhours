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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

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

// Static frontend.
app.use(express.static(path.join(__dirname, "..", "public")));

export function start() {
  return app.listen(config.port, () => {
    console.log(`AfterHours running → http://localhost:${config.port}`);
  });
}