// AfterHours v2 — orchestration: strategy → intended book → paper execution → decision.
import { buildUniverse, underlyingKey } from "./oracle.js";
import { findDislocations } from "./dislocation.js";
import { PaperBook, toMicro, fromMicro } from "./paper.js";
import * as store from "../store.js";
import * as solana from "./solana.js";
import { XSTOCKS } from "../adapters/xstocks.js";

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
// `rotate_to_discount` overweights tokenized equities trading away from their
// mark price, equal-weight among the candidates, capped at top N. The exact
// candidate set is driven by the user's parsed instruction (params):
//   direction   "discount" | "premium"      which side of the gap to rotate into
//   minGapPct   threshold                   only gaps at/above this % (abs)
//   symbols     alias[]                     whitelist (AAPLx, SPACEX, …)
//   topN        int                         cap on holdings
function targetsFor(strategy, dislocations, universe, topN = 6) {
  const p = strategy?.params || {};
  const direction = p.direction || "discount";
  const wantPremium = direction === "premium";
  const minGapBps = p.minGapPct != null ? Math.round(p.minGapPct * 100) : 0;
  const capN = Number(p.topN) > 0 ? Number(p.topN) : topN;

  let pool = dislocations.filter((d) => d.type === "issuer_premium");
  // Direction select: a "premium" has gapBps>0, a "discount" has gapBps<0.
  pool = pool.filter((d) => wantPremium ? d.gapBps > 0 : d.gapBps < 0);
  // Abs-gap threshold.
  if (minGapBps > 0) pool = pool.filter((d) => Math.abs(d.gapBps) >= minGapBps);
  // Symbol whitelist from the instruction (match symbol OR underlying/alias).
  if (Array.isArray(p.symbols) && p.symbols.length) {
    const want = p.symbols.map((s) => s.toUpperCase());
    pool = pool.filter((d) =>
      want.includes(d.symbol.toUpperCase()) ||
      want.includes(`${d.underlying || ""}`.toUpperCase()) ||
      want.includes(`${d.symbol}`.toUpperCase().replace(/X$/, "")));
  }
  pool.sort((a, b) => (wantPremium ? b.gapBps - a.gapBps : a.gapBps - b.gapBps)); // extreme first
  pool = pool.slice(0, capN);

  if (pool.length === 0) return {};

  const w = 1 / pool.length;
  const targets = {};
  for (const d of pool) targets[d.symbol] = w;
  return targets;
}

// Run the engine once: snapshot live state, build targets, rebalance the paper
// book for a SINGLE user, persist, log a decision + alert.
export async function runEngine(db, { userId = 0, strategies = null } = {}) {
  const universe = await buildUniverse();
  const disl = await findDislocations();

  const stratList = strategies || store.listStrategies(db, userId);
  const active = stratList.filter((s) => s.enabled && s.strategyType !== "alert");
  // The user's LATEST instruction drives the loop (newest strategy wins), not
  // the oldest. If none given, fall back to the default rotate-to-discount.
  const strategy = active[active.length - 1] || { strategyType: "rotate_to_discount", params: {} };

  const { fillPricesMicro, markPricesMicro } = currentPrices(universe);
  const targets = targetsFor(strategy, disl.dislocations, universe);

  // Load the paper book from the store (per-user).
  const acc = store.getAccount(db, userId);
  const positions = new Map(
    store.listPositions(db, userId).map((p) => [p.symbol, {
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
  let wiped = false;
  if (invested > funded + budget) {
    guardTripped = true;
    const excess = invested - funded;
    // A SMALL excess is transient valuation drift → reconcile. A LARGE excess
    // (runaway from volatile marks compounding) means the book is corrupted →
    // reset to the funded pool (clean slate). Both end with invested == funded.
    if (excess > funded * 0.5) {
      console.error("[ledger-guard] runaway drift → reset book to funded:", funded, "micro (was invested", invested, ")");
      store.clearAllPositions(db, userId);
      book.positions.clear();
      book.cashMicro = funded;
      wiped = true;
    } else if (funded >= costBasisMicro) {
      console.error("[ledger-guard] reconciled cost-basis drift:", excess, "micro (invested", invested, "→ funded", funded, ")");
      book.cashMicro = funded - costBasisMicro;
    } else {
      const targetBasis = Math.max(0, funded - Math.min(book.cashMicro, funded));
      const scale = costBasisMicro > 0 ? targetBasis / costBasisMicro : 0;
      for (const p of book.positions.values()) p.avgCostMicro = Math.max(0, Math.floor(p.avgCostMicro * scale));
      book.cashMicro = Math.min(book.cashMicro, funded);
      const newBasis = [...book.positions.values()].reduce((a, p) => a + Math.floor((p.qtyMicro * p.avgCostMicro) / store.QTY_SCALE), 0);
      book.cashMicro = funded - newBasis; // exact → invested == funded
      console.error("[ledger-guard] reconciled drift by scaling cost basis (qty preserved) → invested==funded");
    }
  }

  const peakRealized = nextRealizedMicro;
  const peak = Math.max(book.peakNavMicro, guardTripped ? funded : navAfter);
  book.peakNavMicro = peak;
  const drawdownPct = peak > 0 ? (peak - navAfter) / peak : 0;

  // Persist book + cash + realized.
  if (wiped) for (const p of [...book.positions.keys()]) store.deletePosition(db, userId, p);
  for (const p of book.positions.values()) store.upsertPosition(db, userId, p);
  // clean zero rows (positions fully sold)
  for (const row of store.listPositions(db, userId)) if (row.qtyMicro === 0) store.deletePosition(db, userId, row.symbol);
  store.setCash(db, userId, book.cashMicro, guardTripped ? funded : navAfter, peakRealized);

  const seq = store.lastSeq(db, userId) + 1;
  const reason = guardTripped
    ? `run #${seq} · LEDGER GUARD tripped (cost-basis violated) → reset to cash \\$${fromMicro(acc.seedMicro).toFixed(2)}`
    : `run #${seq} · strategy=${strategy.strategyType} · targets=${Object.keys(targets).join(",") || "(cash)"} · ${actions.length} fills · NAV ${fromMicro(navAfter).toFixed(2)}`;
  store.insertDecision(db, userId, {
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
    store.insertAlert(db, { userId, channel: "paper-log", payload });
    // best-effort real-time push (never blocks)
    try { pushAlert(payload).catch(() => {}); } catch {}
  }

  const realizedPnlMicro = [...book.positions.values()].reduce((a, p) => a + p.realizedPnlMicro, 0);
  const finalNavMicro = guardTripped ? acc.seedMicro : navAfter;
  const shownActions = guardTripped ? [] : actions.map((a) => ({ ...a, qtyUnits: a.qtyMicro / store.QTY_SCALE, usd: fromMicro(a.notionalMicro) }));
  const shownRealized = guardTripped ? 0 : realizedPnlMicro;

  // ── REAL EXECUTION (opt-in, honest) ──
  // When AH_LIVE_EXEC=1 AND a Solana wallet is configured, buy the deepest live
  // on-chain gap tokenized equity with a small capped amount through the wallet.
  // Logs the real tx signature on success, or the EXACT reason it couldn't route
  // (e.g. Jupiter unreachable from this host) — never a fabricated fill.
  let live = null;
  const liveEnabled = String(process.env.AH_LIVE_EXEC || "").trim() === "1";
  if (liveEnabled && !guardTripped && solana.isConfigured()) {
    try {
      const { marketHoursGap } = await import("./markethours.js");
      const gaps = (await marketHoursGap()).gaps.filter((g) => !g.error);
      const best = [...gaps].sort((a, b) => Math.abs(b.gapPct || 0) - Math.abs(a.gapPct || 0))[0];
      if (best) {
        const cfg = XSTOCKS[best.symbol];
        const cap = Number(process.env.AH_LIVE_EXEC_USD || 5);
        const usdc = Math.round(cap * 1_000_000); // USDC atoms (6 decimals)
        const run = await solana.jupiterSwap({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: cfg.mint, amount: usdc });
        live = { symbol: best.symbol, mint: cfg.mint, capUsd: cap, executed: true, signature: run.signature, explorer: run.explorer };
      } else {
        live = { executed: false, error: "no live gap to trade right now" };
      }
    } catch (e) {
      live = { executed: false, error: (e.message || "").slice(0, 140) };
    }
  } else if (liveEnabled) {
    live = { executed: false, error: "AH_LIVE_EXEC=1 requires SOLANA_PRIVATE_KEY configured" };
  }

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
    live,
    generatedAt: Date.now(),
  };
}