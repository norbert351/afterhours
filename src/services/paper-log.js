// paper-log.js, persistent paper-decision ledger (Phase 16/17).
// Paper decisions must survive a server restart, and the UI shows them as a
// timeline (raw gap → residual → net edge → decision → audit → execution).
// A small JSON file is enough and keeps this honest + inspectable.
import fs from "node:fs";

// Tests must NOT pollute the judge-facing decision timeline (Phase 48, no fake
// data). Under `node --test` (argv[1] is the *.test.mjs file) use an isolated log.
const IS_TEST = /\.test\.(mjs|js|cjs)$/.test(process.argv[1] || "");
const LOG = new URL(IS_TEST ? "../../data/paper-decisions.test.json" : "../../data/paper-decisions.json", import.meta.url).pathname;

function read() { try { return JSON.parse(fs.readFileSync(LOG, "utf8")); } catch { return []; } }

export function recordDecision(rec) {
  const row = { at: Date.now(), ...rec };
  try {
    const list = read();
    list.unshift(row);
    fs.writeFileSync(LOG, JSON.stringify(list.slice(0, 1000), null, 2));
  } catch { /* non-fatal, the decision still returns to the caller */ }
  return row;
}

export function listDecisions(limit = 50, venue) {
  const list = read();
  const filtered = venue ? list.filter((x) => x.venue === venue) : list;
  return filtered.slice(0, limit);
}

export function decisionCount(venue) {
  return listDecisions(1000, venue).length;
}
