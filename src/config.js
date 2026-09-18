// AfterHours configuration — all data sources are documented + verified in README.
// Every value below was verified live against the real upstream before shipping.
import "process";

export const config = {
  port: Number(process.env.PORT || 8080),

  // Cache lifetime for upstream calls (seconds) — we hit sponsor APIs politely,
  // then serve fast reads from memory. Tune low during live trading.
  cacheTtlMs: Number(process.env.AH_CACHE_TTL_MS || 30_000),

  // ── Verified no-key sources (real, working) ────────────────────────────────
  sources: {
    prestocks: {
      base: process.env.PRESTOOKS_BASE || "https://prestocks.com/api/prestocks",
    },
    tessera: {
      base: process.env.TESSERA_BASE || "https://rest-api.tessera.pe/v1/public/token-details",
    },
    twelvedata: {
      // FREE demo key from Twelve Data. Provides live NYSE reference prices
      // (market-hours aware) by ticker. Replace with your own free key for prod.
      base: process.env.TWELVEDATA_BASE || "https://api.twelvedata.com",
      apiKey: process.env.TWELVEDATA_API_KEY || "demo",
      // NYSE tickers we track as the "frozen reference" anchor.
      symbols: (process.env.AH_REFERENCE_SYMBOLS || "AAPL,MSFT,NVDA")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    pyth: {
      // Feed IDs VERIFIED to exist on Pyth Hermes. NOTE: live latest-price pulls
      // require a Pyth API key (the 401 gate), free via the Pyth Pro bounty.
      // Leave PYTH_API_KEY empty and GET /api/pyth returns feed metadata only.
      base: process.env.PYTH_BASE || "https://hermes.pyth.network",
      apiKey: process.env.PYTH_API_KEY || "",
      // The five live AAPL feeds (the market-hours gap surface):
      aaplFeeds: {
        equity:    "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", // APPLE INC/USD (NYSE, weekend-frozen)
        xstock:    "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675", // APPLE XSTOCK/USD (24/7)
        ondo:      "e6734de88a83d9d2fb33072adab319004700aefd069653aba30ba9e3cac056f2", // APPLE ONDO TOKENIZED/USD (24/7)
        aapl24:    "aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36", // PYTH PRICE USD AAPL 24/7
        redemption:"25babb83691a056fd65f879bfd7197eabd840aae741f69c87ccb31e204a979b2", // APPLE XSTOCK REDEMPTION RATE
      },
    },
  },
};