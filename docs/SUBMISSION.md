# AfterHours — Stocklana Submission (paste-ready)

> Live rubric pulled 2026-09-21: deadline **Sep 25, 4:00pm ET**, $126K total
> ($100K main track), judging through Oct 2, one submission per team, original
> work, open-source OK with attribution. No US-exclusion stated on the main track.

## Theme pick

**Main Track** — *Investing / Credit & yield wedge: "an autonomous capital-utilization agent for tokenized equities."* The spine (a vault that puts capital to work across the frozen-reference gap) serves the exact "could this be a real app people use?" question with real money on mainnet.

## Description (paste text, ~3 paragraphs)

AfterHours is an autonomous weekend-gap capture agent for tokenized equities on Solana. The reference price of every xStock (AAPLx, NVDAx, MSFTx…) freezes when the NYSE closes, but the on-chain market trades 24/7 — so from Friday's bell to Monday's open the on-chain price drifts away from the frozen reference. AfterHours continuously measures that dislocation (live on-chain price vs frozen reference, per token), then the **Weekend Gap Vault** puts real capital to work: armed once, a keeper agent buys the deepest verified gap (hard-capped ≈$0.25/fill, mint-allowlisted, ≥50bps real dislocation required) while the market is closed, and unwinds to SOL at the open. Every fill is a real, signed Solana transaction with its Solscan link on the dashboard; the wallet is reconciled every tick so dividend/rebase accrual is detected honestly rather than claimed. It belongs on Solana because the edge IS the difference between a 24/7 on-chain market and a frozen one: no other venue has tokenized equities trading against a frozen reference.

The app is live: connect, watch the gaps, arm the vault — real execution, transparent ledger, no fabricated numbers anywhere.

**Life after the hackathon (written into `docs/ROADMAP.md`):** the vault stays a
self-funded proof on the builder's own capital; the PreStocks Desk is the first
revenue surface (subscription analytics — no custody); user deposits are gated
on a licensed operator + verified net-of-fee edge, never crossed by vibes.

## Links

- **Live demo:** https://afterhourequity.xyz (landing) · https://afterhourequity.xyz/app (product) · https://afterhourequity.xyz/docs (docs)
- **GitHub:** https://github.com/norbert351/afterhours
- **Video:** https://afterhourequity.xyz/demo/afterhours-demo-v2.mp4 (verified real-buy take: on-camera mainnet SOL→AAPLx buy `3AqwHQu…`, finalized `err=null`, wallet balance moved; 65s, 720p, +faststart)
- **Mainnet proof:** wallet `7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg` · fills [62HV8t3F…](https://solscan.io/tx/62HV8t3FNVYfXFku5SHQN9PUEuttTciitEkNChiTdETRK6XDjs8ZGecb67qb2HavWMALvVGuAAuYgjGPUm1ZMXQ2) [2gh4uPpC…](https://solscan.io/tx/2gh4uPpC91ou8FHovqKwoNkDK7wxp19S1ZJ39RQce2fyUSML4HUb4ebKnF3TVjqYtxuxCdE2s9YbUguzBQffKouN) [8g18g7V3…](https://solscan.io/tx/8g18g7V3qVB1ydD7Z2W8oW5LKGD4NcDhHgUvApdBPZVVxzyaAhpseYzkDBJxKfU9XoM5bZyquszXRrgJamQHcDt)

## Replication guide (judge cold-start, 5 min)

```bash
git clone https://github.com/norbert351/afterhours.git && cd afterhours
npm install
cp .env.example .env          # optional keys; app works keyless on verified no-key sources
npm test                      # 25/25
npm start                     # → http://localhost:8080
# API smoke (local or the live origin):
curl -s localhost:8080/api/markethours/gap        # the gap table
curl -s localhost:8080/api/vault                  # vault state (idle until armed)
curl -s localhost:8080/api/v3/live/info           # live rail (configured:false w/o key)
```

Real execution needs a funded wallet (`SOLANA_PRIVATE_KEY`, `AH_VAULT_EXEC=1`,
`AH_VAULT_CAP_USD=0.25`) — see `docs/TECHNICAL.md`.

## Verified / unverified matrix (the honest map)

| Claim | Status | Evidence |
|---|---|---|
| Live site on custom domain | ✅ | https://afterhourequity.xyz (200 on `/`, `/app`, `/docs`) |
| Real mainnet fills | ✅ | 6 verified fills (above links + [7YHRhMtz…](https://solscan.io/tx/7YHRhMtzdW5Eezrzmi4ZZpbhEdF3CKnTJTwjHXkSPm1NT3yxoi7CXBvzzok3eVyCDbc8ay4pznTqmdwMVefAaik) [2t5Lmh1Tg…](https://solscan.io/tx/2t5Lmh1TgCDeKunB7pXCWP4V16pxAdngGygTVjLqiXwS12vMsgQ4nQCkr3c6ndftPzvkLZC6bNHyFby6RP5ARAeG) [3AqwHQu7k…](https://solscan.io/tx/3AqwHQu7kBUiAcSUoF9HMYaSDvQqBHG68zQtUg5BF9awE8HYR7FytdJ9Hy8BTMgor2gcFGfSyxv915grhJEjKGmV)), wallet holds **0.00260421 AAPLx** on-chain |
| Vault buys the deepest gap, holds, unwinds | ✅ **round trip VERIFIED** — bought at gap −0.16% (8g18g7V3…), sold exactly 0.00074359 at the 13:30 UTC open (4UX9k6o7…, slot 449069399), vault idle | tx links on landing + vault DB |
| Honest ledger (phantom-NAV impossible) | ✅ | 25/25 tests incl. cost-basis guard + **swap-verification** (fill only when `err===null`) + startup **phantom reconcile** (pre-fix failed fill annotated `BUY FAILED ON-CHAIN` in `vault_fills`) |
| No blind trades when data degrades | ✅ | ≥50bps + live-reference guard, tested |
| Pyth live prices | ⚠️ key-gated (Pro grant is the bounty prize) | `/api/pyth` reports the gate honestly |
| Demo video | ✅ | https://afterhourequity.xyz/demo/afterhours-demo-v2.mp4 — on-camera verified mainnet buy (65s, 720p) |
| Bounties: PreStocks ($10K) … | ✅ **ELIGIBLE via the PreStocks Desk surface** (`/prestocks` — PreStocks-only data, satisfies the no-other-issuer rule) | live page + `docs/rubric.md` |
| Bounties: Meteora DBC / Clawpump | ❌ not shipped (honest) | `docs/rubric.md` |

## PreStocks bounty ($10K) — separate paste-ready entry

**Bounty description:** PreStocks Desk is a live intelligence desk for tokenized
pre-IPO stocks built **exclusively** on PreStocks data. Pre-IPO tokens carry two
prices at once — the issued token price and the issuer's mark price — and the
spread is the story. The desk screens all 8 PreStocks tokens (ANDURIL,
ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX) for
token-vs-mark dislocations, tracks price history in 15-minute snapshots with
per-token sparklines, evaluates plain-English alert rules ("NEURALINK trades
more than 10% above its mark price"), and projects honest hold scenarios
(mark-convergence / valuation opinion / flat) — with a built-in eligibility
note on the page itself. Why PreStocks: discovery and analysis are exactly what
the bounty asks for, the data is real and keyless, and the dual-price structure
is a verified, visible signal right now (NEURALINK +29%, SPACEX −22%).

**Bounty links:** Live: https://afterhourequity.xyz/prestocks · API:
`/api/prestocks/*` · GitHub: github.com/norbert351/afterhours
**Eligibility note:** this surface references `prestocks.com/api/prestocks`
only — no other pre-IPO issuer is integrated here (the main-track app also
reads Tessera for cross-issuer analysis; the two surfaces are separate and this
one is single-source by design).