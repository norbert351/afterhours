# AfterHours — Judge-Verification Map (docs/rubric.md)

Every main-track judging axis (Stocklana live rubric: *"could this be a real
app that people will actually use?"*) mapped to the exact evidence a judge can
verify in one click — repo path, live endpoint, or mainnet tx. The honest "we
did not do that" rows are deliberate: self-flagged gaps are the signature of
trust.

## Main track ($100K — Solana Foundation)

| Axis (judge looks for) | Where the evidence is | Depth |
|---|---|---|
| **A real user and problem** | README "problem it solves": tokenized equities trade 168h/wk, references freeze 135.5h/wk; Binance Research: 44% of bStocks turnover prints outside the session, weekend prices anticipate 87% of Monday's open | Cited + measured in-app (cross-issuer SpaceX 178% apart, verified) |
| **A working end-to-end demo** | **Live URL** `https://afterhourequity.xyz` → `/app` — vault panel (HOLDING state, position, tx links) + Live Solana rail (real wallet + probe button) + gap table | Verified E2E; the vault has settled **real** mainnet fills (txs below) |
| **Reason it belongs on Solana** | ARCHITECTURE counterfactual table: gap signal (GeckoTerminal by mint), execution (Jupiter on Solana), rebasing xStocks, accrual reconciliation — all chain-native; "24/7 market" is impossible on a closed venue | Load-bearing, not decorative |
| **Quality of execution** | 16/16 tests; ledger GUARD (phantom-NAV impossible); caps/allowlist/rate-limits on money endpoints; key-redaction security fix; docs set (README/ARCHITECTURE/TECHNICAL/ROADMAP/this map) | Defensive depth |
| **Real capital moved** | Wallet `7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg` holds **0.00197113 AAPLx** (on-chain); fills: [62HV8t3F…](https://solscan.io/tx/62HV8t3FNVYfXFku5SHQN9PUEuttTciitEkNChiTdETRK6XDjs8ZGecb67qb2HavWMALvVGuAAuYgjGPUm1ZMXQ2) · [2gh4uPpC…](https://solscan.io/tx/2gh4uPpC91ou8FHovqKwoNkDK7wxp19S1ZJ39RQce2fyUSML4HUb4ebKnF3TVjqYtxuxCdE2s9YbUguzBQffKouN) · [8g18g7V3…](https://solscan.io/tx/8g18g7V3qVB1ydD7Z2W8oW5LKGD4NcDhHgUvApdBPZVVxzyaAhpseYzkDBJxKfU9XoM5bZyquszXRrgJamQHcDt) | Three independent signatures |
| **Autonomy** | `vault.js` keeper: 60s loop, deterministic rules, no-churn, kill-switch — the buy fired itself after arm (armed 07:44:56 → bought 07:44:59, logged) | Acts on its own, not human-invoked |

## Bounty tracks ($26K + Pyth Pro)

| Bounty | Fit | Honest status |
|---|---|---|
| **PreStocks** ($10K) | PreStocks feed integrated (real prices, E2E) — but the product also integrates other pre-IPO issuers (Tessera), which the bounty's *PreStocks-only* rule excludes | ❌ **Ineligible as written** — main track is the play; a PreStocks-only skin could unlock it |
| **Tessera** ($6K) | Tessera T-tokens feed integrated (real mark prices; flaky upstream handled) | ⚠️ Partial — no T-token trading surface |
| **Meteora DBC** ($5K) | DBC SDK installed, evaluated, honestly documented as unwired; "working code on mainnet beats slides" | ❌ Not shipped against — flagged in ROADMAP as the post-capital move |
| **Clawpump** ($5K) | Not integrated (needs a stock-paired LP launch w/ clawpump+Meteora) | ❌ Not shipped against |
| **Pyth** (3 mo Pro) | Feed **registry** (5 AAPL feeds incl. Equity.US + Crypto.AAPLX) verified; live prices honest-gated on the Pro key (which is the prize — chicken-and-egg by design) | ⚠️ Party — the gate is the honest failure mode; a grant unlocks the exact "compare both feeds" bounty idea |

## Honest "we did NOT do that" rows

| Thing | Status |
|---|---|
| Dividend *reinvest* automation | ❌ not built — accrual is detected + labeled honestly, but no auto-loop (roadmap #2) |
| Multi-user vault / pools | ❌ single project wallet, single position (roadmap) |
| Mobile app | ❌ responsive web only |
| Pyth live prices | ❌ key-gated (bounty prize) — never fabricated, `/api/pyth` reports the gate |
| Demo video | ❌ recording pending (submission link: live URL + GitHub carry it meanwhile) |
| Weekday intraday trading | ❌ by design — the edge is the closed-market gap, not scalping |