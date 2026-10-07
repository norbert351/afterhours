# AfterHours — X post draft (Bitget AI Base Camp S2)

**How to post (required mechanics):** make post 1 a **quote-tweet of**
https://x.com/Bitget_AI/status/2100519318824055159 and include **`#BitgetHackathon`** and
**`@Bitget_AI`**. Then reply with the rest of the thread. Nothing else is required — but a post with
real substance and an invite to try the demo is what the rules ask for (bare reposts don't count).

---

## POST 1 — the required post (quote-tweet the Bitget post)

```
Tokenized stocks trade 24/7. The market they reference does not.

AfterHours is an autonomous agent for Bitget rTokens that finds the price gap — then tells you when it is NOT worth trading.

Live demo (no login) + code below 👇

@Bitget_AI #BitgetHackathon
```

*(≈250 chars incl. the quoted card — fits a standard post.)*

---

## THREAD (reply to post 1)

**2/**
```
The trap: while the NYSE sleeps, a Bitget rToken (RTSLAUSDT, RCOINUSDT…) keeps trading — but its US reference is frozen at the last close.

That gap looks like free money.

It usually isn't. Most of it is just the broad tape + fees.
```

**3/**
```
So AfterHours does the work the raw screen skips:

raw gap → − market factor (SPY) → − real costs (0.14% fees+slippage) = NET EDGE

Under 0.2%? The agent says WAIT. Out loud, with the reason.

Refusing a trade is a feature here, not a failure.
```

**4/**
```
We did not cherry-pick the backtest.

291 days of real Bitget rToken candles vs real US closes: the naive "buy the discount" version has NEGATIVE expectancy after costs, and the positive out-of-sample sat on 8–30 trades — noise.

We published that result in the repo.
```

**5/**
```
Why it matters: the rToken price often LEADS the frozen reference. So a "discount vs the last close" is frequently the market pricing an overnight move — not a harvestable mispricing.

Building around that finding IS the product.
```

**6/**
```
The agent loop:

Qwen (qwen3.8-max) proposes orders
→ deterministic limits
→ an independent audit pass that can VETO
→ Hermes fallback if the model is out

The LLM never sets the risk caps. Paper execution, auditable ledger — price, qty, net edge and balance on every decision.
```

**7/**
```
Try it, no login:
afterhourequity.xyz/bitget

Code (public):
github.com/norbert351/afterhours

96-second real-browser demo:
afterhourequity.xyz/demo/afterhours-bitget-demo.mp4

Built for the @Bitget_AI Base Camp S2 #BitgetHackathon 🧵
```

---

## CHECKLIST BEFORE POSTING
- [ ] Post 1 quotes https://x.com/Bitget_AI/status/2100519318824055159
- [ ] Contains `#BitgetHackathon`
- [ ] Contains `@Bitget_AI` (tagged, not just typed)
- [ ] Introduces the product/agent (not a bare repost / not just a retweet)
- [ ] Links work with no login (all verified 200)
- [ ] Copy the URL of post 1 → that goes in the form's **X Project Post URL** field

## OPTIONAL SHORT VARIANT (single post, 242 chars — fits 280)
```
Tokenized stocks trade 24/7. The market they reference doesn't.

AfterHours — an agent for Bitget rTokens. It computes the cost-adjusted edge and refuses the gaps that aren't tradeable.

afterhourequity.xyz/bitget

@Bitget_AI #BitgetHackathon
```
