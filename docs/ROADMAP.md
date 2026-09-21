# AfterHours — Roadmap

Honest, grounded in what's real. Nothing here is claimed as done — it's the
trajectory a judge can read to see this keeping growing after the hackathon.

## Where it is now (verified)

- Live at **https://afterhourequity.xyz** (custom domain, auto-TLS, own VM).
- **Weekend Gap Vault** trading real capital on Solana mainnet (3 finalized
  fills, atom-exact ledger, honest accrual detection).
- Paper strategy engine with a phantom-NAV-proof ledger, wallet auth (native +
  Privy), watchlist, live-rail panel, full docs.

## Next features (in priority order)

1. **Multi-window deployment** — the vault currently buys at the deepest gap
   after arm. Add configurable schedules: NYSE-close deploy (Friday 21:00 UTC),
   open unwind (Monday 13:30 UTC), plus a max-hold kill. Makes the demo
   repeatable instead of depending on the arm moment.
2. **Dividend reinvest toggle** — when accrual is detected, optionally
   auto-loop it into the next gap position (Stretch-style "deposit, stretch,
   collect") — gated on the accrual being confirmed as dividend (Kraken/xStocks
   corporate-action data) rather than an external top-up.
3. **Strategy catalog cards** — xPrime-style vault cards (risk badge, target
   range from measured gap history, duration, deposit CTA) so users pick a
   strategy instead of one fixed vault.
4. **Multi-symbol references** — TwelveData quota-safe ladder (AAPL today; add
   MSFT/NVDA/TSLA with a bigger key or the Pyth Pro grant), and swap the
   reference layer to **Pyth** entirely (Equity.US.AAPL/USD vs Crypto.AAPLX/USD
   — literally the Pyth bounty surface) when the Pro grant lands.
5. **Better execution routing** — price-compare Jupiter / Orca / Raydium
   quotes at swap time (the SDKs are already installed; turn the documented
   experiments into a real router with fallback).
6. **Retention** — per-user vault views, alert webhooks (Telegram/Discord) when
   the vault fills, and a mobile-first polish pass on `/app`.

## Path to a real user base (demo → product)

- **Needs capital**: the vault is capped at cents by design. A "pools" model —
  multiple users fund positions (still honestly labeled, per-cap), vault
  manages them, fees/splits tracked in the ledger — turns the demo into
  something people fund.
- **Needs data trust**: Pyth Pro grant + TwelveData paid tier remove the
  key-gates; the feed-quality story (frozen vs 24/7) is the product's edge.
- **Needs distribution**: the recurring-buy + watchlist rails already exist;
  productize them as a mobile-first "set-and-forget weekend gap capture".

## What would need to change (honest)

- Reference layer must stop depending on a single free key (Pyth Pro / paid
  TwelveData) before real sizes run.
- Execution cap math must move from constant-based to slippage-aware at real
  size (the current caps exist to keep demo risk near zero).
- One-account-per-vault ownership rules (today the vault owns one wallet; the
  pools model needs per-user sub-ledgers).

## Ports (the one-product→N-chains pattern)

- **BNB Tokenized Stocks** (Oct 11): same spine, adapters swapped to
  bStocks/Ondo/xStocks rails + Agentic Wallet. Deadline after Stocklana —
  the port cost is ~an adapter layer, already factored in the architecture.
- **Monad Metropolis** (Oct 13): onchain-finance track, same vault core.

## Post-hackathon events

- Colosseum World's Fair (official Stocklana follow-on): the vault + pools
  model is the submission shape.