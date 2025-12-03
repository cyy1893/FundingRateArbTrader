# Repository Guidelines

## Project Structure & Module Organization
Next.js 16 App Router routes live in `src/app`, with server components by default and client components explicitly flagged. Shared UI (including `components/ui` primitives) belongs in `src/components`, reusable domain logic in `src/lib`, and type contracts in `src/types`. `data/coingecko-map.json` is generated—never hand-edit it—while static files live in `public/` and helper automation sits inside `scripts/`.

## Build, Test, and Development Commands
- `npm run dev` – starts the development server; the `predev` hook refreshes the CoinGecko map automatically.
- `npm run coingecko:map` – manually rebuilds `data/coingecko-map.json`; run whenever asset coverage or symbol overrides change.
- `npm run lint` – runs ESLint with the shared config, catching client/server boundary violations and Tailwind mistakes before review.
- `npm run build` / `npm run start` – compile and serve the production bundle ahead of any deployment changes.

## Coding Style & Naming Conventions
Stick to TypeScript, two-space indentation, and the existing no-semicolon style. React components, hooks, and context providers use PascalCase filenames; utilities in `src/lib` export camelCase functions grouped by exchange or concern. Fetching should happen in server components or dedicated API routes, with `{ cache: "no-store" }` for market-sensitive endpoints. Tailwind utilities are ordered from layout to typography, and class merging goes through `tailwind-merge`.

## Testing Guidelines
There is no formal test runner yet, so every PR needs manual QA notes (e.g., “Run `npm run dev`, toggle each exchange, confirm settlement timer matches Drift interval”). When adding deterministic helpers, colocate `*.spec.ts` files next to the source and exercise them via `node --test` or a lightweight Vitest harness; aim for ~80% coverage in `src/lib` modules that handle math or symbol mapping.

## Commit & Pull Request Guidelines
Follow the conventional style found in history (`feat(coingecko): …`, `chore: …`, `refactor: …`), keeping scopes meaningful (`lighter`, `ui`, `infra`). Commits should remain small and cohesive—if you regenerate `data/coingecko-map.json`, keep the script change and the artifact together. Pull requests must describe the motivation, include screenshots or console output when UI/data change, list manual QA steps, and mention which external APIs were touched.

## External Exchange Data Sources
Hyperliquid remains the canonical venue, but the UI also pulls a single “external” data source as a comparison baseline. The selected source is encoded in the `externalSource` search param, normalized via `src/lib/external.ts`, and passed all the way through the market snapshot builder. Binance connectivity was removed, so the current options are:

- `drift`: use `https://data.api.drift.trade/contracts` for market metadata and `https://data.api.drift.trade/fundingRates` for the historical overlay. These APIs mirror the figures exposed in the Drift UI at `https://app.drift.trade`.
- `lighter`: pull funding, leverage, and volume snapshots from `https://explorer.elliot.ai/api/markets` (see https://docs.lighter.xyz/perpetual-futures/api and https://apidocs.lighter.xyz/docs). Funding data is exposed alongside market stats so the UI can treat Lighter as a straight peer to Hyperliquid and the other baselines.

When wiring Drift into new surfaces, lean on the official docs at [https://drift-labs.github.io/v2-teacher/#program-addresses](https://drift-labs.github.io/v2-teacher/#program-addresses) for canonical identifiers. The currently relevant program IDs are:

| Environment   | Program ID                                         | UI                          |
| ------------- | -------------------------------------------------- | --------------------------- |
| mainnet-beta  | `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`      | https://app.drift.trade     |
| devnet        | `dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH`      | https://beta.drift.trade    |

Respect the [Terms of Use](https://docs.drift.trade/legal-and-regulations/terms-of-use) before hitting their interfaces from restricted territories.
