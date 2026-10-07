// Cache-bust the shared shell assets.
// Recomputes a content hash of ah-shell.js + ah-ui.css and rewrites the ?v= query
// in every public/*.html that references them, so a deployed client can never keep
// a stale shell after a release. Idempotent. Run as a release step:  npm run stamp
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const ASSETS = ["ah-shell.js", "ah-ui.css"];

const h = createHash("sha256");
for (const a of ASSETS) h.update(readFileSync(join(pub, a)));
const v = h.digest("hex").slice(0, 10);

const pat = (name) => new RegExp(`(["'/])${name.replace(".", "\\.")}(\\?v=[0-9a-f]+)?(["'])`, "g");
let changed = 0;
for (const f of readdirSync(pub).filter((x) => x.endsWith(".html"))) {
  const p = join(pub, f);
  const before = readFileSync(p, "utf8");
  let after = before;
  for (const a of ASSETS) after = after.replace(pat(a), (_m, pre, _q, post) => `${pre}${a}?v=${v}${post}`);
  if (after !== before) { writeFileSync(p, after); changed++; }
}
console.log(`stamped ${changed} html file(s) with shell v=${v}`);
