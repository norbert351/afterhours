// AfterHours v2 — paper execution ledger (the "acted, not just alerted" layer).
//
// Integer micro-units only (no floats in money). Qty in qtyMicro (1e6 = 1 share),
// prices in priceMicro ($1 = 1e6). Cash in cashMicro. Fees/slippage in basis points.
//
// Source of truth for this pattern: zerodep-node-backend → agentic-trading-cash-ledger
// (VIGIL). Self-funding sells-before-buys, cost basis, realized P&L, NAV, high-water
// drawdown.

export const FEE_BPS = 10;    // 0.10% per fill
export const SLIP_BPS = 2;    // 0.02% adverse price impact
export const QTY_SCALE = 1_000_000;
export const PRICE_SCALE = 1_000_000;

// priceMicro = Math.round(usd * PRICE_SCALE)
export function toMicro(usd, scale = PRICE_SCALE) {
  return Math.round(usd * scale);
}
export function fromMicro(micro, scale = PRICE_SCALE) {
  return micro / scale;
}

// A paper book = positions Map + cashMicro. Returns new state.
export class PaperBook {
  constructor({ positions = new Map(), cashMicro = 0, seedMicro = 0, peakNavMicro = 0 }) {
    this.positions = positions; // symbol -> {symbol, issuer, qtyMicro, avgCostMicro, realizedPnlMicro}
    this.cashMicro = cashMicro;
    this.seedMicro = seedMicro;
    this.peakNavMicro = Math.max(peakNavMicro, seedMicro);
  }

  navMicro(pricesMicro) {
    let v = this.cashMicro;
    for (const p of this.positions.values()) {
      const px = pricesMicro.get(p.symbol) || p.avgCostMicro;
      v += Math.floor((p.qtyMicro * px) / QTY_SCALE);
    }
    return v;
  }

  // Rebalance toward targets (symbol -> weight 0..1 of NAV). Self-funding:
  // process sells BEFORE buys in the same batch. Returns { actions, newBook }.
  rebalance(pricesMicro, targets, { top = 20, tolerance = 0.0015 } = {}) {
    const nav = this.navMicro(pricesMicro);
    const actions = [];
    // Deviation tolerance: skip rebalancing a leg whose drift is within this
    // fraction of NAV, so fees/slippage dust never cause per-run churn.
    const tolMicro = Math.floor(nav * tolerance);

    // normalize + cap weights
    const totalW = Object.values(targets).reduce((a, b) => a + b, 0) || 0;
    const shares = Object.entries(targets)
      .filter(([, w]) => w > 0)
      .map(([sym, w]) => ({ sym, w: w / totalW }))
      .sort((a, b) => b.w - a.w)
      .slice(0, top);

    const perSymbolWantMap = new Map(shares.map((s) => [s.sym, s.w * nav]));

    // 1) SELL anything overweight or not targeted
    const wantOrder = new Map(shares.map((s, i) => [s.sym, i]));
    for (const [sym, p] of this.positions) {
      const want = perSymbolWantMap.get(sym);
      if (want === undefined) {
        // Not in the current target set → trim fully (sells before buys).
        actions.push(...this._sellAll(p, pricesMicro));
      } else {
        const heldVal = this._feesIncl(Math.floor((p.qtyMicro * (pricesMicro.get(sym) || p.avgCostMicro)) / QTY_SCALE));
        if (heldVal > want + tolMicro) {
          const excess = heldVal - want; // fee-inclusive excess to trim
          const px = pricesMicro.get(sym) || p.avgCostMicro;
          const qty = Math.min(p.qtyMicro, Math.floor((excess * QTY_SCALE) / px));
          if (qty > 0) actions.push(this._sellQty(p, qty, pricesMicro));
        }
      }
    }

    // 2) BUY anything underweight, capped by fee-inclusive cash budget.
    // budget is the max we may debit; we compute qty from per-share fee-inclusive
    // cost so notional+fee can never exceed the available cash.
    const budgetStart = Math.floor((this.cashMicro * 10000) / (10000 + FEE_BPS));
    const budget = budgetStart;
    const buyOrder = [...shares].sort((a, b) => (a.w - b.w)); // lightest weight first
    let remaining = budget;
    for (const s of buyOrder) {
      if (remaining <= 0) break;
      const px = pricesMicro.get(s.sym);
      if (!px || px <= 0) continue;
      const heldNotional = this._feesIncl(this._heldValue(s.sym, pricesMicro));
      let want = perSymbolWantMap.get(s.sym) - heldNotional; // extra notional (fee-incl)
      if (want <= tolMicro) continue;   // within tolerance → no dust churn
      want = Math.min(want, remaining);
      const perShareCost = Math.floor(px * (10000 + SLIP_BPS) / 10000 * (10000 + FEE_BPS) / 10000); // fee+slip inclusive
      const qty = Math.floor((want * QTY_SCALE) / perShareCost);
      if (qty <= 0) continue;
      const filled = this._buyQty(this.positions.get(s.sym), s.sym, this._issuerFor(s.sym), qty, px);
      actions.push(filled);
      remaining -= filled.totalCostMicro;
    }

    return {
      actions,
      newBook: { positions: this.positions, cashMicro: this.cashMicro },
    };
  }

  // ---- fees / valuation helpers ----
  _feesIncl(notionalMicro) {
    return notionalMicro + Math.floor((notionalMicro * FEE_BPS) / 10000);
  }
  _issuerFor(sym) {
    const p = this.positions.get(sym);
    return p ? p.issuer : "unknown";
  }
  _heldValue(sym, pricesMicro) {
    const p = this.positions.get(sym);
    if (!p) return 0;
    return Math.floor((p.qtyMicro * (pricesMicro.get(sym) || p.avgCostMicro)) / QTY_SCALE);
  }

  _sellAll(p, pricesMicro) {
    return [this._sellQty(p, p.qtyMicro, pricesMicro)];
  }
  _sellQty(p, qtyMicro, pricesMicro) {
    const px = pricesMicro.get(p.symbol) || p.avgCostMicro;
    const fillPx = Math.floor(px * (10000 - SLIP_BPS) / 10000);
    const gross = Math.floor((qtyMicro * fillPx) / QTY_SCALE);
    const fee = Math.floor((gross * FEE_BPS) / 10000);
    const proceeds = gross - fee;
    const basis = Math.floor((qtyMicro * p.avgCostMicro) / QTY_SCALE);
    const realized = proceeds - basis;
    p.qtyMicro -= qtyMicro;
    p.realizedPnlMicro += realized;
    p.avgCostMicro = p.qtyMicro > 0 ? p.avgCostMicro : 0;
    this.cashMicro += proceeds;
    if (p.qtyMicro === 0) this.positions.delete(p.symbol);
    return {
      action: "sell",
      symbol: p.symbol,
      qtyMicro, fillPxMicro: fillPx, notionalMicro: gross, feeMicro: fee, realizedPnlMicro: realized,
    };
  }
  _buyQty(existing, symbol, issuer, qtyMicro, px) {
    const fillPx = Math.floor(px * (10000 + SLIP_BPS) / 10000);
    const notional = Math.floor((qtyMicro * fillPx) / QTY_SCALE);
    const fee = Math.floor((notional * FEE_BPS) / 10000);
    const totalCost = notional + fee;
    const prev = existing || { qtyMicro: 0, avgCostMicro: 0 };
    const newQty = prev.qtyMicro + qtyMicro;
    const newAvg = newQty > 0 ? Math.floor((prev.qtyMicro * prev.avgCostMicro + qtyMicro * fillPx) / newQty) : 0;
    this.positions.set(symbol, {
      symbol, issuer, qtyMicro: newQty, avgCostMicro: newAvg, realizedPnlMicro: prev.realizedPnlMicro || 0,
    });
    this.cashMicro -= totalCost;
    return { action: "buy", symbol, qtyMicro, fillPxMicro: fillPx, notionalMicro: notional, feeMicro: fee, totalCostMicro: totalCost };
  }
}