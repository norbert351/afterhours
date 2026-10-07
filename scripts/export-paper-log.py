#!/usr/bin/env python3
"""
Export the AfterHours Bitget paper-trading log to CSV for the S2 submission.

Fields (handbook: timestamp, instrument, direction, price, quantity, account balance change):
  timestamp_utc, venue, instrument, rToken_symbol, direction, price_usd, quantity,
  notional_usd, net_edge_pct, remaining_edge_pct, balance_after_usd, decision_id, price_source

Price: recorded live (priceUsd) where available; otherwise reconstructed from the REAL
Bitget daily close for that UTC date (data/backtest/bitget_<SYM>.json, fetched from the
public candles endpoint) and labelled price_source=bitget_daily_close_reconstructed.
Balance: paper account starting at $10,000; a spot BUY deploys the $100 notional
(cash -100), a WAIT/WATCH leaves cash flat.
"""
import json, os, csv, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, "data", "paper-decisions.json")
BT = os.path.join(ROOT, "data", "backtest")
OUT = os.path.join(ROOT, "docs", "paper-trading-log.csv")
START = 10000.0
UNIV = {"TSLA": "RTSLAUSDT", "COIN": "RCOINUSDT", "MSFT": "RMSFTUSDT", "AAPL": "RAAPLUSDT",
        "META": "RMETAUSDT", "NVDA": "RNVDAUSDT", "SPY": "RSPYUSDT", "MSTR": "RMSTRUSDT"}


def candles(sym):
    p = os.path.join(BT, f"bitget_{sym}.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def close_on(cache, day):
    # exact day, else the most recent earlier day in the cache
    if day in cache:
        return cache[day]
    prior = [d for d in cache if d <= day]
    return cache[max(prior)] if prior else None


def main():
    rows = json.load(open(LOG))
    rows = [r for r in rows if r.get("venue") == "bitget"]
    rows.sort(key=lambda r: r.get("at") or 0)
    bal, out = START, []
    for r in rows:
        at = r.get("at")
        t = dt.datetime.utcfromtimestamp(at / 1000) if at else None
        sym = r.get("symbol")
        direction = r.get("action") or r.get("side") or r.get("decision") or "WAIT"
        notional = float(r.get("notionalUsd") or 0)
        price, src = r.get("priceUsd"), "live_recorded"
        if not price and sym in UNIV:
            price = close_on(candles(UNIV[sym]), t.strftime("%Y-%m-%d") if t else "")
            src = "bitget_daily_close_reconstructed" if price else "unavailable"
        qty = r.get("qty")
        if not qty and price and notional:
            qty = round(notional / price, 6)
        delta = r.get("balanceDeltaUsd")
        if delta is None:
            delta = -notional if direction == "BUY" else 0.0
        bal += float(delta or 0)
        out.append({
            "timestamp_utc": t.isoformat() + "Z" if t else "",
            "venue": "bitget",
            "instrument": sym,
            "rToken_symbol": r.get("rSymbol") or UNIV.get(sym, ""),
            "direction": direction,
            "price_usd": f"{price:.4f}" if price else "",
            "quantity": f"{qty:.6f}" if qty else "0",
            "notional_usd": f"{notional:.2f}",
            "net_edge_pct": f"{float(r.get('netEdgePct') or 0):.4f}",
            "residual_gap_pct": f"{float(r.get('residualGapPct') or 0):.4f}",
            "balance_after_usd": f"{bal:.2f}",
            "balance_change_usd": f"{float(delta or 0):.2f}",
            "decision_id": r.get("id") or "",
            "price_source": src,
        })
    with open(OUT, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
        w.writeheader(); w.writerows(out)
    acted = sum(1 for r in out if r["direction"] in ("BUY", "ROTATE"))
    print(f"rows={len(out)} acted={acted} wait={len(out)-acted} start=${START:.0f} end=${bal:.2f}")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
