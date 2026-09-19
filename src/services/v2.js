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
  const peak = Math.max(book.peakNavMicro, navAfter);
  book.peakNavMicro = peak;
  const drawdownPct = peak > 0 ? (peak - navAfter) / peak : 0;

  // Persist book + cash.
  for (const p of book.positions.values()) store.upsertPosition(db, p);
  // clean zero rows (positions fully sold)
  for (const row of store.listPositions(db)) if (row.qtyMicro === 0) store.deletePosition(db, row.symbol);
  store.setCash(db, book.cashMicro, navAfter);

  const seq = store.lastSeq(db) + 1;
  const reason = `run #${seq} · strategy=${strategy.strategyType} · targets=${Object.keys(targets).join(",") || "(cash)"} · ${actions.length} fills · NAV ${fromMicro(navAfter).toFixed(2)}`;
  store.insertDecision(db, {
    seq, ts: Date.now(), reason,
    actions: actions.map((a) => ({ ...a, qtyUnits: a.qtyMicro / store.QTY_SCALE, usd: fromMicro(a.notionalMicro) })),
    navMicro: navAfter, cashMicro: book.cashMicro,
  });

  let alert;
  if (actions.length > 0) {
    const top = actions.slice(0, 3).map((a) => `${a.action} ${a.symbol} $${fromMicro(a.notionalMicro).toFixed(2)}`).join(" · ");
    const list = store.insertAlert(db, { channel: "paper-log", payload: { text: `AfterHours: ${top}`, navUsd: fromMicro(navAfter).toFixed(2), fills: actions.length } });
    alert = list[list.length - 1];
  }

  const realizedPnlMicro = [...book.positions.values()].reduce((a, p) => a + p.realizedPnlMicro, 0);
  return {
    strategy: strategy.strategyType,
    targets,
    fills: actions.length,
    actions: actions.map((a) => ({ ...a, qtyUnits: a.qtyMicro / store.QTY_SCALE, usd: fromMicro(a.notionalMicro) })),
    nav: fromMicro(navAfter),
    navBefore: fromMicro(navBefore),
    cash: fromMicro(book.cashMicro),
    seed: fromMicro(acc.seedMicro),
    unrealizedPnl: fromMicro(navAfter - book.cashMicro - realizedPnlMicro),
    realizedPnl: fromMicro(realizedPnlMicro),
    pnlTotal: fromMicro(navAfter - acc.seedMicro),
    drawdownPct,
    seq,
    generatedAt: Date.now(),
  };
}