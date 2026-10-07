#!/usr/bin/env python3
"""
AfterHours · Bitget rToken Arbitrage — backtest
================================================
Real-data backtest of the AfterHours closed-market dislocation strategy on Bitget
rTokens, for the Bitget AI Base Camp S2 · Alpha Factory (Arbitrage) entry.

Data (all real, fetched live; cached under data/backtest/):
  * On-chain leg : Bitget UTA v3 spot daily candles, public, no key
                   https://api.bitget.com/api/v2/spot/market/candles
  * Reference leg: TwelveData daily US closes (the engine's own reference source)

Strategy (mirrors src/services/fairvalue.js):
  rawGap_t     = (rToken_close_t - ref_close_{t-1}) / ref_close_{t-1}   # closed-market gap
  marketFactor = SPY's rawGap the same day                              # the market factor
  residual_t   = rawGap_t - beta * marketFactor_t,  beta = 1.0 (labelled fallback)
  netEdge_t    = |residual_t| - COST_PCT                                # 0.14% (fees+slip)
  Signal       = SPOT-LONG ONLY: enter a DISCOUNT (residual < 0) with netEdge > MIN_EDGE.
  Portfolio    = equal-weight top-N by netEdge, held 1 day, cost charged on entry+exit.

Split: in-sample = everything up to the last 30 trading days; out-of-sample = last 30 days.

Outputs data/backtest/report.json + prints a metrics table.
"""
import json, os, sys, time, urllib.request, datetime as dt, math
from statistics import mean, pstdev

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "backtest")
os.makedirs(OUT, exist_ok=True)

COST_PCT = 0.14      # fees 0.10 + slippage 0.04 (engine COST_MODEL)
MIN_EDGE = 0.20      # min net edge to act (%)
TOP_N = 2            # equal-weight top-N discounts
BETA = 1.0           # labelled fallback (engine betaFor())
OOS_DAYS = 30

UNIV = {  # underlying -> Bitget rToken spot symbol
    "TSLA": "RTSLAUSDT", "COIN": "RCOINUSDT", "MSFT": "RMSFTUSDT", "AAPL": "RAAPLUSDT",
    "META": "RMETAUSDT", "NVDA": "RNVDAUSDT", "SPY": "RSPYUSDT", "MSTR": "RMSTRUSDT",
}
FACTOR = "SPY"


def _get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(3)


def td_key():
    p = os.path.join(ROOT, ".env")
    for ln in open(p, encoding="utf-8", errors="ignore"):
        if ln.startswith("TWELVEDATA_API_KEY="):
            return ln.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no TWELVEDATA_API_KEY")


def fetch_rtoken(sym):
    f = os.path.join(OUT, f"bitget_{sym}.json")
    if os.path.exists(f):
        return json.load(open(f))
    d = _get(f"https://api.bitget.com/api/v2/spot/market/candles?symbol={sym}&granularity=1day&limit=500")
    rows = d["data"]
    out = {dt.datetime.utcfromtimestamp(int(r[0]) / 1000).strftime("%Y-%m-%d"): float(r[4]) for r in rows}  # close
    json.dump(out, open(f, "w"))
    return out


def fetch_us_closes():
    f = os.path.join(OUT, "twelvedata_us.json")
    if os.path.exists(f):
        return json.load(open(f))
    key = td_key()
    syms = ",".join(UNIV.keys())
    d = _get(f"https://api.twelvedata.com/time_series?symbol={syms}&interval=1day&outputsize=400&apikey={key}")
    out = {}
    for s in UNIV:
        node = d.get(s) if s in d else None
        if not node or "values" not in node:
            raise SystemExit(f"twelvedata missing {s}: {str(d)[:200]}")
        out[s] = {v["datetime"]: float(v["close"]) for v in node["values"]}
    json.dump(out, open(f, "w"))
    return out


def pct_ret(navs):
    if len(navs) < 2:
        return 0.0
    return (navs[-1] / navs[0] - 1) * 100


def sharpe(daily):
    if len(daily) < 2:
        return None
    mu, sd = mean(daily), pstdev(daily)
    if sd == 0:
        return None
    return mu / sd * math.sqrt(252)


def sortino(daily):
    downs = [x for x in daily if x < 0]
    if len(daily) < 2 or not downs:
        return None
    dd = math.sqrt(mean([x * x for x in downs]))
    return mean(daily) / dd * math.sqrt(252) if dd else None


def max_dd(navs):
    peak, mdd = navs[0], 0.0
    for v in navs:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    return mdd * 100


def main():
    rtoken = {s: fetch_rtoken(sym) for s, sym in UNIV.items()}
    ref = fetch_us_closes()

    import bisect
    ref_dates = sorted(set(ref[FACTOR]))

    def last_us_before(d):
        i = bisect.bisect_left(ref_dates, d)
        return ref_dates[i - 1] if i > 0 else None

    # every day the rToken trades (7x24), provided a prior US close exists (the frozen ref)
    dates = sorted(set.intersection(*[set(rtoken[s]) for s in UNIV]))
    dates = [d for d in dates if last_us_before(d) is not None]

    def raw_gap(sym_u, d):
        pc = last_us_before(d)
        prev = ref[sym_u].get(pc)
        cur = rtoken[sym_u].get(d)
        if not prev or not cur:
            return None
        return (cur - prev) / prev * 100.0

    # daily rows
    day_rows = []
    for d in dates:
        xs = {}
        for s in UNIV:
            g = raw_gap(s, d)
            if g is not None:
                xs[s] = g
        if FACTOR not in xs:
            continue
        mkt = xs[FACTOR]
        cands = []
        for s, g in xs.items():
            resid = g - BETA * mkt
            net = abs(resid) - COST_PCT
            cands.append({"sym": s, "rawGapPct": round(g, 4), "residualGapPct": round(resid, 4),
                          "netEdgePct": round(net, 4), "discount": resid < 0,
                          "actionable": (resid < 0 and net > MIN_EDGE * 0)})
        day_rows.append({"date": d, "marketFactorPct": round(mkt, 4),
                         "picks": [c for c in cands if c["discount"] and c["netEdgePct"] > MIN_EDGE],
                         "all": cands})

    # realised return uses the ACTUAL next-day rToken move (not the theoretical edge):
    # enter at close_i, exit at close_{i+1}, minus the 0.14% round-trip cost model.
    def run(rows):
        nav, curve, daily, trades, wins, turn = 1.0, [1.0], [], 0, 0, 0.0
        for i, r in enumerate(rows):
            if i + 1 >= len(rows):
                break
            nxt = rows[i + 1]["date"]
            picks = sorted(r["picks"], key=lambda x: -x["netEdgePct"])[:TOP_N]
            pnl = 0.0
            for p in picks:
                s, d = p["sym"], r["date"]
                c0, c1 = rtoken[s].get(d), rtoken[s].get(nxt)
                if not c0 or not c1:
                    continue
                trades += 1
                turn += 1.0
                realized = (c1 / c0 - 1.0) * 100.0 - COST_PCT   # gross move minus round-trip cost
                pnl += realized / max(1, len(picks))
                if realized > 0:
                    wins += 1
            nav *= (1 + pnl / 100.0)
            curve.append(nav)
            daily.append(pnl / 100.0)
        return {
            "days": len(rows), "trades": trades, "winRatePct": round(100.0 * wins / trades, 1) if trades else None,
            "returnPct": round(pct_ret(curve), 2), "sharpe": round(sharpe(daily), 2) if sharpe(daily) is not None else None,
            "sortino": round(sortino(daily), 2) if sortino(daily) is not None else None,
            "maxDrawdownPct": round(max_dd(curve), 2), "turnoverPerYear": round(turn / max(len(rows), 1) * 252, 1),
            "avgPicksPerDay": round(trades / max(len(rows), 1), 2),
            "curve": [round(v, 5) for v in curve],
        }

    split = max(0, len(day_rows) - OOS_DAYS)
    us = set(ref_dates)

    # Faithful AfterHours rule: enter only at the CLOSE of a closed-market window
    # (a US non-trading day whose next rToken day is a US trading day), i.e. the
    # Sunday/holiday close, and exit at the reopen.
    closed_rows = []
    for i, r in enumerate(day_rows):
        nxt = day_rows[i + 1]["date"] if i + 1 < len(day_rows) else None
        if r["date"] not in us and nxt in us:
            closed_rows.append(r)

    def run_seg(rows, oos_days=OOS_DAYS):
        k = max(0, len(rows) - oos_days)
        return run(rows[:k]), run(rows[k:]), run(rows)

    ins, oos, full = run_seg(day_rows)
    cins, coos, cfull = run_seg(closed_rows, 8)

    report = {
        "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
        "strategy": "AfterHours closed-market rToken dislocation (spot-long discounts)",
        "params": {"COST_PCT": COST_PCT, "MIN_EDGE": MIN_EDGE, "TOP_N": TOP_N, "BETA": BETA},
        "universe": list(UNIV.keys()),
        "period": {"from": day_rows[0]["date"], "to": day_rows[-1]["date"], "tradingDays": len(day_rows)},
        "allDays": {"inSample": ins, "outOfSample": oos, "full": full},
        "closedWindowOnly": {"entries": len(closed_rows), "inSample": cins, "outOfSample": coos, "full": cfull},
        "inSample": ins, "outOfSample": oos, "full": full,
    }
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)

    def line(tag, m):
        print(f"{tag:<14} n={m['days']:>4} ret={m['returnPct']:>7}%  Sharpe={m['sharpe']}  Sortino={m['sortino']}  maxDD={m['maxDrawdownPct']}%  winRate={m['winRatePct']}%  trades={m['trades']}  turn/yr={m['turnoverPerYear']}")
    print(f"period {report['period']['from']} -> {report['period']['to']} ({len(day_rows)} rToken days)")
    print("--- ALL DAYS ---"); line("IN-SAMPLE", ins); line("OUT-OF-SAMPLE", oos); line("FULL", full)
    print(f"--- CLOSED-WINDOW ONLY ({len(closed_rows)} entries) ---"); line("IN-SAMPLE", cins); line("OUT-OF-SAMPLE", coos); line("FULL", cfull)
    print("saved", os.path.join(OUT, "report.json"))


if __name__ == "__main__":
    main()
