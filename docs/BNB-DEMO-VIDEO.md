# AfterHours — BNB Demo Video (recording checklist + script)

## ⚠️ Status: **TO BE RECORDED**

The demo video currently linked in `README.md` and `docs/SUBMISSION.md`
(`public/demo/afterhours-demo-v2.mp4`, 65 s) is the **Solana SOL→AAPLx** buy. It is an
honest historical artifact but it **does NOT demonstrate the BNB Tokenized Stocks product**.
Per the brief the demo is **mandatory** (≤4 minutes) and judges who can't run the app are
scored on the video alone.

**Do not present the Solana video as the BNB demo.** Record the BNB take below, upload it,
and update the links in `README.md` + `docs/SUBMISSION.md` to point at it. If a recording
cannot be made before the deadline, state plainly in the submission that the BNB demo video
is **not yet recorded** — do **not** link the Solana clip as if it were the BNB demo.

**Hard rules for the recording:** BSC mainnet only · spot only · **dry-run with the
Transaction API first, then (optionally) a small live amount** · no fabrication · no keys on
screen.

---

## Shot list (target ≈ 3:40, hard cap 4:00)

| Time | Scene | What to show (real UI only) |
|---|---|---|
| 0:00–0:20 | **The problem** | Weekend gap: NYSE closed, tokenized equity still trades vs a frozen reference. State the product question: *is the gap real and actionable after costs?* |
| 0:20–1:05 | **BNB universe** | `/bnb` — the closed-market gap table: token, on-chain $, ref $, RAW, **NET EDGE**, action; the LIVE/STALE freshness chip; "WEB3 API KEY: ON". |
| 1:05–1:50 | **One asset in detail** | Open "View decision" on an asset (e.g. IBMB): raw gap → market-adjusted → costs → **net edge** → liquidity → action. Explain BUY/ROTATE/WAIT/BLOCKED. |
| 1:50–2:25 | **Paper action** | Click **Paper trade $100** / **Paper-act · top NET EDGE**. Show it is **simulated** — distinct from live balances. No wallet, no broadcast. |
| 2:25–3:10 | **Transaction API dry-run + live proof** | (a) `POST /api/bnb/exec/dry-run` for a symbol — show the **real simulate verdict**. (b) `/proof` — the broadcast fill `USDT → IBMB`, tx `0x2c683c47…0b411b74`, live BscScan link. State clearly which is a dry-run and which is a confirmed on-chain fill. |
| 3:10–3:40 | **Agent + integrations** | Invoke a real MCP tool (`bnb_gap`/`bnb_quote`/`bnb_status`) if the environment allows; show the **truthful** sponsor panel (MCP AVAILABLE; Agent Studio PARTIAL; Agentic Wallet NOT VERIFIED). |
| 3:40–3:55 | **Close** | Honest limitations + the live URL `afterhourequity.xyz/bnb` + repo. |

*(Timings are a guide — adapt to what actually works. Never demonstrate an unavailable feature.)*

## Pre-record checklist
- [ ] Server running with `AH_BNB_WEB3_KEY`/`SECRET` set (`.env`), on the deployed host or local `:8090`.
- [ ] `GET /api/bnb/universe` returns real rows (not "key not set").
- [ ] `/bnb` loads **as a guest** with no console errors (verified: 0 console errors, 20 gap rows).
- [ ] `/proof` shows the real fill + a working BscScan link (verified).
- [ ] `POST /api/bnb/exec/dry-run {"symbol":"IBMB","amountUsd":0.2}` returns a simulate verdict.
- [ ] **No private keys, `.env` contents, or signed headers on screen.**
- [ ] If you fire a live fill: it's ≤ $0.50, spot, BSC mainnet, and the dry-run gate passed first.
- [ ] Record 1280×720 or 1920×1080; export ≤ 4:00 with `+faststart`.

## Post-record
- [ ] Upload to `public/demo/afterhours-bnb-demo.mp4` (served at `/demo/...`).
- [ ] Verify `curl -sI https://afterhourequity.xyz/demo/afterhours-bnb-demo.mp4` → 200 + `video/mp4`.
- [ ] Update the video link in `README.md` and `docs/SUBMISSION.md` to the new file.
- [ ] Keep the Solana clip in the repo (accurate history) but stop linking it as the BNB demo.
