// AfterHours — witness-log snapshot: exports the durable decision log to a
// committed CSV as dated evidence ("the strategy actually ran"). Idempotent +
// change-gated so it only churns git when new decisions land.
import { openStore, listDecisions } from "../src/store.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DB = process.env.AH_DB_PATH || new URL("../data/afterhours.db", import.meta.url).pathname;
const OUT = new URL("../docs/paper-log/afterhours-decisions.csv", import.meta.url);

const db = openStore(DB);
const decs = listDecisions(db, 500);
mkdirSync(dirname(OUT.pathname), { recursive: true });

const header = "seq,ts,reason,actions,navMicro,cashMicro";
const rows = decs.map((d) => [
  d.seq, d.ts, JSON.stringify(d.reason),
  JSON.stringify(d.actionsJson ?? ""), d.navMicro, d.cashMicro,
].join(","));
const csv = [header, ...rows].join("\n") + "\n";
writeFileSync(OUT.pathname, csv);

const last = decs.length ? decs[decs.length - 1].seq : 0;
console.log(`snapshot: ${decs.length} decisions → ${OUT.pathname} (last #${last})`);