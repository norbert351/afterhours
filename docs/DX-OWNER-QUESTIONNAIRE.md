# AfterHours — Owner Questionnaire (for the Developer Experience Report)

The DX Report is **25% of the hackathon score**. Its *technical* sections are done in
`docs/DEVELOPER-EXPERIENCE-REPORT.md` (Part A). This file is **only** the firsthand
information that must come from **you** — the developer who actually did the work. The brief
warns that perfunctory/AI-generated reports are rejected, so these answers must be **your real
observations**, not invented ones.

**How to answer:** reply with the question number and a short factual answer. Rough numbers are
fine ("about 40 min", "most calls returned in ~300–600 ms"). Say "don't know / didn't measure"
where you didn't — that's more useful than a guess, and I'll mark it honestly as not measured.
Where a measurement is asked for, a quick method is given in brackets.

Once you answer, I'll drop them into Part B and mark the report complete.

---

## B1. Context
1. **Your name / handle** (as you want it in the report):
2. **Date range** you worked on the BNB integration (e.g. "Oct 5–10 2026"):
3. **Total hours** end-to-end on the BNB build (rough is fine):
4. **AI tooling used** (if any) and your honest take on where it helped vs. hurt:

## B2. Time to first successful call
5. **How long** from opening the Binance Web3 docs to your first `code:0` response?
   *[Roughly how many minutes; if you can't recall, say so.]*
6. **The single biggest time sink** in reaching that first call:

## B3. Latency & rate limits
7. **Typical response time** you saw for `rwa/tokens`, `aggregator/quote`, and
   `pre-transaction/simulate`. *[If you want, I can run a quick 10-sample timing harness for you
   and we'll use those numbers — just say "measure it".]*
8. **Did you hit a rate limit?** If yes, which code / roughly what requests-per-second:

## B4. Authentication friction
9. What specifically tripped you up about the HMAC signing (the `/build` path prefix,
   timestamp precision, the pre-hash order)? What was the fix?
10. Did you ever see **"Duplicate request detected"**? When / why:

## B5. Real market observations (you, watching live data)
11. Differences you noticed between **bStocks** and **Ondo** tokens in the real feed:
12. How common were **`+0.00%`** gaps, and what you concluded from them:
13. A case where the token price and reference were **close but still surprising**, and what it taught you:

## B6. Execution & simulation
14. Did the **Transaction API dry-run** ever stop you from broadcasting something bad? Describe:
15. Which tokens/sizes actually **routed**, and which didn't (e.g. the `40374` case)?

## B7. Documentation friction & asks
16. Doc inconsistencies or gaps you hit, and the fix you'd suggest:
17. API capabilities you **wish existed** (batch prices, a per-token SWAP-vs-RFQ eligibility flag,
    a testnet faucet, clearer simulation schema…):

## B8. Honest craft note
18. What **worked well**, what was **hard**, and what you'd do **differently** next time:

---

### Notes
- I will **not** invent answers. Blank = "awaiting owner".
- If you'd rather I run the latency measurement (B3) so you don't have to, say so and I'll
  produce a sanitized 10-sample table you can approve.
- No secret values belong in these answers — describe behaviour, never paste keys.
