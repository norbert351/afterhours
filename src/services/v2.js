// AfterHours v2 — orchestration: strategy → intended book → paper execution → decision.
import { buildUniverse, underlyingKey } from "./oracle.js";
import { findDislocations } from "./dislocation.js";
import { PaperBook, toMicro, fromMicro } from "./paper.js";
import * as store from "../store.js";

// priceMicro for each instrument: what a buyer actually pays (tokenPrice when the
// issuer splits mark vs token), and the fair-value valuation used for NAV.
function currentPrices(universe) {
  const fill = new Map();
  const mark = new Map();
  for (const i of universe.instruments) {
    const token = typeof i.tokenPrice === "number" ? i.tokenPrice : null;
    const m = typeof i.markPrice === "number" ? i.markPrice : null;
    if (token) fill.set(i.symbol, toMicro(token));
    else if (m) fill.set(i.symbol, toMicro(m));
    if (m) mark.set(i.symbol, toMicro(m));
    else if (token) mark.set(i.symbol, toMicro(token));
  }
  return { fillPricesMicro: fill, markPricesMicro: mark };
}

// Strategy → target weights (fraction of NAV). Honest + deterministic:
// `rotate_to_discount` overweights tokenized equities trading BELOW their mark
// price (buy the float-up), equal-weight among the discounts, capped at top N.
function targetsFor(strategies, dislocations, universe, topN = 6) {
  const discounted = dislocations
    .filter((d) => d.type === "issuer_premium" && d.direction === "token_discount")
    .sort((a, b) => a.gapBps - b.gapBps) // deepest discount first
    .slice(0, topN);

  if (discounted.length === 0) return {};

  // Equal weights across the deepest discounts (this is a rotation strategy demo).
  const w = 1 / discounted.length;
  const targets = {};
  for (const d of discounted) targets[d.symbol] = w;
  return targets;
}

// Run the engine once: snapshot live state, build targets, rebalance the paper
// book, persist, log a decision + alert.
export async function runEngine(db, { strategies = null } = {}) {
  const universe = await buildUniverse();
  const disl = await findDislocations();

  const stratList = strategies || store.listStrategies(db);
  const active = stratList.filter((s) => s.enabled && s.strategyType !== "alert");
  const strategy = active[0] || { strategyType: "rotate_to_discount", params: {} };

  const { fillPricesMicro, markPricesMicro } = currentPrices(universe);
  const targets = targetsFor(stratList, disl.dislocations, universe);

  // Load the paper book from the store.
  const acc = store.getAccount(db);
  const positions = new Map(
    store.listPositions(db).map((p) => [p.symbol, {
      symbol: p.symbol, issuer: p.issuer, qtyMicro: p.qtyMicro,
      avgCostMicro: p.avgCostMicro, realizedPnlMicro: p.realizedPnlMicro,
    }]),
  );
  const book = new PaperBook({
    positions,
    cashMicro: acc.cashMicro,
    seedMicro: acc.seedMicro,
    peakNavMicro: acc.peakNavMicro,
  });

  const navBefore = book.navMicro(fillPricesMicro);
  const { actions } = book.rebalance(fillPricesMicro, targets, { top: 12 });
  const navAfter = book.navMicro(fillPricesMicro);

  // ── LEDGER GUARD: cost-basis conservation — the hard integrity invariant ──
  // You can never hold more than you funded. cash plus the total cost basis of
  // every position must equal the seed (+ cumulative realized cash from sells).
  // If it exceeds that, money was created → refuse to persist the bad book and
  // reset to cash (fail-safe). A phantom NAV is structurally impossible.
  const costBasisMicro = [...book.positions.values()].reduce(
    (a, p) => a + Math.floor((p.qtyMicro * p.avgCostMicro) / store.QTY_SCALE), 0);
  const sellRealizedMicro = actions
    .filter((a) => a.action === "sell")
    .reduce((a, x) => a + (x.realizedPnlMicro || 0), 0);
  const nextRealizedMicro = (acc.realizedMicro || 0) + sellRealizedMicro;
  const invested = book.cashMicro + costBasisMicro;           // what the book is made of
  const funded = acc.seedMicro + nextRealizedMicro;           // what we actually put in
  const budget = store.PRICE_SCALE;                            // $1 rounding tolerance
  let guardTripped = false;
  if (invested > funded + budget) {
    guardTripped = true;
    console.error("[ledger-guard] cost-basis violation:", invested, "invested >", funded, "funded — reset to cash");
    book.positions.clear();
    book.cashMicro = acc.seedMicro;   // clean slate
  }

  const peakRealized = guardTripped ? 0 : nextRealizedMicro;
  const peak = Math.max(book.peakNavMicro, guardTripped ? acc.seedMicro : navAfter);
  book.peakNavMicro = peak;
  const drawdownPct = peak > 0 ? (peak - navAfter) / peak : 0;

  // Persist book + cash + realized.
  if (guardTripped) for (const p of [...book.positions.keys()]) store.deletePosition(db, p);
  for (const p of book.positions.values()) store.upsertPosition(db, p);
  // clean zero rows (positions fully sold)
  for (const row of store.listPositions(db)) if (row.qtyMicro === 0) store.deletePosition(db, row.symbol);
  store.setCash(db, book.cashMicro, guardTripped ? acc.seedMicro : navAfter, peakRealized);

  const seq = store.lastSeq(db) + 1;
  const reason = guardTripped
    ? `run #${seq} · LEDGER GUARD tripped (cost-basis violated) → reset to cash \$${fromMicro(acc.seedMicro).toFixed(2)}`
    : `run #${seq} · strategy=${strategy.strategyType} · targets=${Object.keys(targets).join(",") || "(cash)"} · ${actions.length} fills · NAV ${fromMicro(navAfter).toFixed(2)}`;
  store.insertDecision(db, {
    seq, ts: Date.now(), reason,
    actions: guardTripped ? [] : actions.map((a) => ({ ...a, qtyUnits: a.qtyMicro / store.QTY_SCALE, usd: fromMicro(a.notionalMicro) })),
    navMicro: guardTripped ? acc.seedMicro : navAfter, cashMicro: book.cashMicro,
  });

  let alert;
  // Only surface a real rebalance (skip dust fills that would spam the feed;
  // a pure hold logs a decision but not an alert).
  const meaningful = actions.filter((a) => Math.abs(a.notionalMicro) >= Math.floor((1 * store.PRICE_SCALE) * 5)); // ≥ $5
  if (meaningful.length > 0) {
    const top = meaningful.slice(0, 3).map((a) => `${a.action} ${a.symbol} $${fromMicro(a.notionalMicro).toFixed(2)}`).join(" · ");
    const payload = { text: `AfterHours: ${top}`, navUsd: fromMicro(navAfter).toFixed(2), fills: meaningful.length };
    const list = store.insertAlert(db, { channel: "paper-log", payload });
    alert = list[list.length - 1];
    // best-effort real-time push (never blocks)
    try { pushAlert(payload).catch(() => {}); } catch {}
  }

  const realizedPnlMicro = [...book.positions.values()].reduce((a, p) => a + p.realizedPnlMicro, 0);
  const finalNavMicro = guardTripped ? acc.seedMicro : navAfter;
  const shownActions = guardTripped ? [] : actions.map((a) => ({ ...a, qtyUnits: a.qtyMicro / store.QTY_SCALE, usd: fromMicro(a.notionalMicro) }));
  const shownRealized = guardTripped ? 0 : realizedPnlMicro;
  return {
    strategy: strategy.strategyType,
    targets,
    fills: guardTripped ? 0 : actions.length,
    actions: shownActions,
    nav: fromMicro(finalNavMicro),
    navBefore: fromMicro(navBefore),
    cash: fromMicro(book.cashMicro),
    seed: fromMicro(acc.seedMicro),
    unrealizedPnl: fromMicro(finalNavMicro - book.cashMicro - shownRealized),
    realizedPnl: fromMicro(shownRealized),
    pnlTotal: fromMicro(finalNavMicro - acc.seedMicro),
    drawdownPct,
    seq,
    guardTripped,
    generatedAt: Date.now(),
  };
}