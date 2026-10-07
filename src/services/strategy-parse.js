// AfterHours v2, natural-language strategy instruction → load-bearing params.
//
// Users type a plain-English rule in the UI ("rotate to discounted tokenized
// equities", "buy SPACEX and OPENAI under 5% over mark", "top 3 biggest
// discounts >10%"). This parser extracts the STRUCTURAL knobs that genuinely
// change what the autonomous 60s loop trades. The result is stored as the
// strategy's `params` and honored by v2.js targetsFor(). Nothing decorative.
import { XSTOCKS } from "../adapters/xstocks.js";
import { PRESTOCKS_SYMBOLS } from "./prestocks-desk.js";

// Every alias a user might type → the dislocation symbols it can match.
// xStocks: `AAPLx` token (symbol) and its NYSE reference `AAPL` (underlying).
// PreStocks: symbol == underlying (SPACEX, OPENAI, …), named by brand.
export function buildAliasRegistry() {
  const reg = new Map(); // alias (upper) -> Set of dislocation symbol keys
  const add = (alias, sym) => {
    alias = alias.trim().toUpperCase();
    if (!reg.has(alias)) reg.set(alias, new Set());
    reg.get(alias).add(sym);
  };
  for (const [sym, cfg] of Object.entries(XSTOCKS)) {
    add(sym, sym);          // AAPLx
    add(cfg.ref, sym);      // AAPL
    add(sym.replace(/x$/, ""), sym); // AAPL (already covered by ref, idempotent)
  }
  for (const s of PRESTOCKS_SYMBOLS) add(s, s); // SPACEX, OPENAI, …
  return reg;
}

const defaultTopN = 6;

// Core parse, pure, testable. Returns params object.
export function parseStrategyInstruction(text, { topNDefault = defaultTopN } = {}) {
  const t = (text || "").toLowerCase();

  // 1) Direction, which side of the gap we rotate into.
  let direction = "discount"; // default = buy-the-dip (core thesis)
  if (/(below|discount|undervalued|cheap|under mark)/.test(t)) direction = "discount";
  else if (/(above|premium|overvalued|expensive|over mark|gap up)/.test(t)) direction = "premium";

  // 2) Threshold, "more than 10%" / "at least 5%" / ">5%".
  let thresholdPct = null;
  const m = t.match(/(?:\d+(?:\.\d+)?)\s*%/);
  if (m) thresholdPct = Number(parseFloat(m[0]));

  // 3) Top N, "top 3", "biggest", "largest".
  let topN = null;
  const tm = t.match(/top\s+(\d+)/);
  if (tm) topN = Number(tm[1]);
  else if (/(biggest|largest|biggest mover|most moved|deepest)/.test(t)) topN = topNDefault;

  // 4) Symbols, any alias present in the text.
  const symbols = [];
  for (const alias of buildAliasRegistry().keys()) {
    if (t.includes(alias.toLowerCase())) symbols.push(alias);
  }

  const params = { direction };
  if (thresholdPct != null) params.minGapPct = thresholdPct;
  if (topN != null) params.topN = topN;
  if (symbols.length) params.symbols = symbols.sort();

  return {
    strategyType: "rotate_to_discount",
    params,
    parsed: {
      ok: true,
      hasSymbols: symbols.length > 0,
      summary: summarize(t, direction, thresholdPct, topN, symbols),
    },
  };
}

function summarize(t, direction, thresholdPct, topN, symbols) {
  const parts = [];
  if (symbols.length) parts.push(symbols.join(" / "));
  else parts.push("any");
  parts.push(direction === "premium" ? "premiums" : "discounts");
  if (thresholdPct != null) parts.push(`≥${thresholdPct}%`);
  if (topN != null) parts.push(`top ${topN}`);
  return `rotate into ${parts.join(" · ")}`;
}