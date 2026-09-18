// Strategy engine — turns plain-English market rules into real, live checks
// against verified dislocation data, and fires alerts when a rule trips.
//
// SCOPE HONESTY: this engine DETECTS + ALERTS on real live gaps. It does not
// yet execute on-chain orders — that needs a funded wallet, slippage math and
// a verified DEX-routing venue, which is the next build increment. Never fakes
// an order.
//
// Supported natural-language patterns (case-insensitive, keywords):
//   "<TOKEN> trades more than <N>% above its mark price"
//   "<TOKEN> trades <N>% below its mark price"
//   "flag the biggest gap", "show the largest dislocation"
//   "cross-issuer spread for <TOKEN> both issuers"
import { findDislocations } from "./dislocation.js";
import { underlyingKey } from "./oracle.js";

const store = []; // in-memory rule store (reset on restart; fine for scaffold)

export function parseRule(text) {
  const t = (text || "").toLowerCase();
  const tokenMatch = t.match(/(openai|spacex|anduril|anthropic|figureai|kalshi|neuralink|polymarket|apple|aapl|msft|nvda)/);
  const pctMatch = t.match(/(\d+(?:\.\d+)?)\s*%/);
  let direction = null;
  if (/(above|price should be above|trades above|> mark|premium)/.test(t)) direction = "above";
  else if (/(below|trades below|discount)/.test(t)) direction = "below";

  let type = "issuer_premium";
  if (/(cross-issuer|across issuers|spread between)/.test(t)) type = "cross_issuer";
  else if (/(biggest|largest|top gap|all)/.test(t)) type = "largest";

  const pct = pctMatch ? Number(pctMatch[1]) : 2;

  return {
    text,
    underlying: tokenMatch ? tokenMatch[1] : null,
    direction,
    type,
    thresholdPct: pct,
    ok: true,
  };
}

function matchesDislocation(d, rule) {
  if (rule.type === "largest") return true; // representational: engine ranks later
  if (rule.type !== "largest" && d.type === "largest") return false;

  if (rule.underlying && underlyingKey(d.underlying) !== underlyingKey(rule.underlying)) return false;

  // issuer_premium uses direction; cross_issuer uses absolute spread.
  if (d.type === "issuer_premium") {
    const gapPct = (d.gapBps / 100); // % per 100bp... treat bps->pct
    if (rule.direction === "above") return d.direction === "token_premium" && Math.abs(d.gapBps) >= rule.thresholdPct * 100;
    if (rule.direction === "below") return d.direction === "token_discount" && Math.abs(d.gapBps) >= rule.thresholdPct * 100;
    return Math.abs(d.gapBps) >= rule.thresholdPct * 100;
  }
  if (d.type === "cross_issuer") {
    return Math.abs(d.gapBps) >= rule.thresholdPct * 100;
  }
  return false;
}

export function addRule(text) {
  const rule = parseRule(text);
  const entry = { id: `rule_${store.length + 1}`, ...rule, createdAt: Date.now() };
  store.push(entry);
  return entry;
}

export function listRules() {
  return store;
}

// Evaluate every stored rule against live verified dislocations.
export async function evaluateAll() {
  const { dislocations } = await findDislocations();
  const results = [];
  for (const rule of store) {
    let matched = [];
    if (rule.type === "largest") {
      matched = dislocations.slice(0, 3);
    } else {
      matched = dislocations.filter((d) => matchesDislocation(d, rule)).slice(0, 3);
    }
    results.push({
      rule,
      fired: matched.length > 0,
      matches: matched,
    });
  }
  return { evaluatedAt: Date.now(), results };
}