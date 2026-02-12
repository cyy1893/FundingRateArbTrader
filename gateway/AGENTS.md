# Repository Guidelines

## Project Structure & Module Organization
Next.js 16 App Router routes live in `src/app`, with server components by default and client components explicitly flagged. Shared UI (including `components/ui` primitives) belongs in `src/components`, reusable domain logic in `src/lib`, and type contracts in `src/types`. Static files live in `public/` and helper automation sits inside `scripts/`.

## Build, Test, and Development Commands
- `npm run dev` – starts the development server.
- `npm run lint` – runs ESLint with the shared config, catching client/server boundary violations and Tailwind mistakes before review.
- `npm run build` / `npm run start` – compile and serve the production bundle ahead of any deployment changes.

## Coding Style & Naming Conventions
Stick to TypeScript, two-space indentation, and the existing no-semicolon style. React components, hooks, and context providers use PascalCase filenames; utilities in `src/lib` export camelCase functions grouped by exchange or concern. Fetching should happen in server components or dedicated API routes, with `{ cache: "no-store" }` for market-sensitive endpoints. Tailwind utilities are ordered from layout to typography, and class merging goes through `tailwind-merge`.

## UI/UX Patterns & Animation Guidelines

### Sidebar Animation Consistency
All sidebars across the application must follow a consistent slide-in animation pattern from the right side:

- **Fixed Width**: Sidebars should use a fixed width (e.g., `w-[460px]`, `w-[520px]`) instead of responsive full-width (`w-full`), ensuring a consistent slide-in animation effect.
- **Animation Classes**: Use `transition-all duration-300` with conditional width classes:
  ```tsx
  className={cn(
    "pointer-events-none flex h-full flex-shrink-0 transition-all duration-300",
    isOpen ? "w-[520px] opacity-100" : "w-0 opacity-0"
  )}
  ```
- **Layout Structure**: Parent containers should use `flex` layout with `gap-6` between main content and sidebar, avoiding conditional grid layouts that cause inconsistent rendering patterns.
- **Examples**: See `arbitrage-sidebar.tsx` for reference implementation.

This pattern ensures that all monitoring cards, detail panels, and auxiliary information slides in uniformly from the right, creating a cohesive visual experience throughout the app.

## Testing Guidelines
There is no formal test runner yet, so every PR needs manual QA notes (e.g., “Run `npm run dev`, toggle each exchange, confirm settlement timer matches the active exchange interval”). When adding deterministic helpers, colocate `*.spec.ts` files next to the source and exercise them via `node --test` or a lightweight Vitest harness; aim for ~80% coverage in `src/lib` modules that handle math or symbol mapping.

## Commit & Pull Request Guidelines
Follow the conventional style found in history (`feat(coingecko): …`, `chore: …`, `refactor: …`), keeping scopes meaningful (`lighter`, `ui`, `infra`). Commits should remain small and cohesive. Pull requests must describe the motivation, include screenshots or console output when UI/data change, list manual QA steps, and mention which external APIs were touched.

## External Exchange Data Sources
Hyperliquid remains the canonical venue, but the UI also pulls a single “external” data source as a comparison baseline. The selected source is encoded in the `externalSource` search param, normalized via `src/lib/external.ts`, and passed all the way through the market snapshot builder. Binance connectivity was removed, so the current options are:

- `lighter`: pull funding, leverage, and volume snapshots from `https://explorer.elliot.ai/api/markets` (see https://docs.lighter.xyz/perpetual-futures/api and https://apidocs.lighter.xyz/docs). Funding data is exposed alongside market stats so the UI can treat Lighter as a straight peer to Hyperliquid and the other baselines.
- `grvt`: use the market-data endpoints in `src/lib/grvt.ts` to read instrument lists, funding rates, and 24h stats from GRVT’s public APIs. Keep requests bounded and prefer the `/full/v1` endpoints already wired in the codebase.

Respect exchange terms of use before hitting public endpoints from restricted territories.
