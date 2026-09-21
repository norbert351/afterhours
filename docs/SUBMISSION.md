# AfterHours — Stocklana Submission (paste-ready)

> Live rubric pulled 2026-09-21: deadline **Sep 25, 4:00pm ET**, $126K total
> ($100K main track), judging through Oct 2, one submission per team, original
> work, open-source OK with attribution. No US-exclusion stated on the main track.

## Theme pick

**Main Track** — *Investing / Credit & yield wedge: "an autonomous capital-utilization agent for tokenized equities."* The spine (a vault that puts capital to work across the frozen-reference gap) serves the exact "could this be a real app people use?" question with real money on mainnet.

## Description (paste text, ~3 paragraphs)

AfterHours is an autonomous weekend-gap capture agent for tokenized equities on Solana. The reference price of every xStock (AAPLx, NVDAx, MSFTx…) freezes when the NYSE closes, but the on-chain market trades 24/7 — so from Friday's bell to Monday's open the on-chain price drifts away from the frozen reference. AfterHours continuously measures that dislocation (live on-chain price vs frozen reference, per token), then the **Weekend Gap Vault** puts real capital to work: armed once, a keeper agent buys the deepest verified gap (hard-capped ≈$0.25/fill, mint-allowlisted, ≥50bps real dislocation required) while the market is closed, and unwinds to SOL at the open. Every fill is a real, signed Solana transaction with its Solscan link on the dashboard; the wallet is reconciled every tick so dividend/rebase accrual is detected honestly rather than claimed. It belongs on Solana because the edge IS the difference between a 24/7 on-chain market and a frozen one: no other venue has tokenized equities trading against a frozen reference.

The app is live: connect, watch the gaps, arm the vault — real execution, transparent ledger, no fabricated numbers anywhere.

## Links

- **Live demo:** https://afterhourequity.xyz (landing) · https://afterhourequity.xyz/app (product) · https://afterhourequity.xyz/docs (docs)
- **GitHub:** https://github.com/norbert351/afterhours
- **Video:** *(recording pending — replace with the demo-video link before submit; the live URL + tx receipts carry the demo meanwhile)*
- **Mainnet proof:** wallet `7JL8s63F5WPXMWmbPFKN7Wn2VrsyitA4GHCWxqb4RLYg` · fills [62HV8t3F…](https://solscan.io/tx/62HV8t3FNVYfXFku5SHQN9PUEuttTciitEkNChiTdETRK6XDjs8ZGecb67qb2HavWMALvVGuAAuYgjGPUm1ZMXQ2) [2gh4uPpC…](https://solscan.io/tx/2gh4uPpC91ou8FHovqKwoNkDK7wxp19S1ZJ39RQce2fyUSML4HUb4ebKnF3TVjqYtxuxCdE2s9YbUguzBQffKouN) [8g18g7V3…](https://solscan.io/tx/8g18g7V3qVB1ydD7Z2W8oW5LKGD4NcDhHgUvApdBPZVVxzyaAhpseYzkDBJxKfU9XoM5bZyquszXRrgJamQHcDt)

## Replication guide (judge cold-start, 5 min)

```bash
git clone https://github.com/norbert351/afterhours.git && cd afterhours
npm install
cp .env.example .env          # optional keys; app works keyless on verified no-key sources
npm test                      # 16/16
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
| Real mainnet fills | ✅ | 3 txs (above), wallet holds 0.00197113 AAPLx on-chain |
| Vault buys the deepest gap, holds, unwinds | ✅ buy+hold proven (awaiting Monday-open sell) | tx 8g18g7V3…; watchdog armed to capture the unwind |
| Honest ledger (phantom-NAV impossible) | ✅ | 16/16 tests incl. cost-basis guard |
| No blind trades when data degrades | ✅ | ≥50bps + live-reference guard, tested |
| Pyth live prices | ⚠️ key-gated (Pro grant is the bounty prize) | `/api/pyth` reports the gate honestly |
| Demo video | ❌ pending — live URL + receipts carry the demo | — |
| Bounties: PreStocks ($10K) ineligible (multi-issuer), Meteora DBC / Clawpump not shipped | ❌ honest | `docs/rubric.md` |