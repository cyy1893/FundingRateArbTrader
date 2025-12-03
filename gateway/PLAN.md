# Refactor Plan for Arbitrary Exchange Pair Comparison

1. Introduce unified source modeling:
   - Extend `src/lib/external.ts` to describe every exchange (Hyperliquid, Binance, Drift, Lighter) via a common `SourceConfig`.
   - Update UI selectors (`src/components/source-controls.tsx`) and market row types (`src/types/market.ts`) so the app consistently talks about “left/right” exchanges rather than “Hyperliquid vs external”.

2. Normalize snapshot gathering:
   - Implement per-exchange fetchers that return a shared `ExchangeMarketMetrics` shape (price, volume, funding, leverage, settlement interval, provider symbol).
   - Rebuild `getPerpetualSnapshot` (and related server-side logic) to accept `(sourceA, sourceB)`, fetch both sets of markets, align them via canonical symbols, and produce `MarketRow` structures that include both sides of the pair.

3. Migrate client/server consumers:
   - Update `/api/funding/live` and `/api/funding/history` to operate on arbitrary exchange pairs, adjusting payloads, caching, and error reporting accordingly.
   - Refactor front-end components (perp table, live funding polling, history dialog, Coingecko integration) to use the new pair-aware data model while preserving UX (sorting, filtering, tooltips, etc.).
