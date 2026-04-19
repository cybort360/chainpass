# Hoppr Rebrand — Design

**Status:** Draft
**Date:** 2026-04-19
**Branch:** `feat/hoppr-rebrand`

## Goal

Rename every user-visible and developer-visible occurrence of "ChainPass" to
"Hoppr" across the codebase — except the deployed Solidity contract
(`ChainPassTicket.sol`) and its ABI export identifier (`chainPassTicketAbi`),
which remain under the old name as an internal implementation detail.

## Non-goals

- Smart contract rename or redeployment on Monad testnet.
- Palette, typography, or visual identity refresh beyond swapping the wordmark
  and favicon.
- Multi-tenant operator onboarding (separate upcoming project).
- Repo directory rename on local machines (owner's choice, out of scope).

## Decisions

### D1. Scope: everything except the smart contract

The deployed `ChainPassTicket.sol` stays. Its class name is an internal
identifier — users only see the address and the ticket behavior. Redeploying
would cost a fresh contract on a testnet that already has rider wallets,
minted passes, and role grants; the cosmetic value of a matched name isn't
worth that cost.

Consequence: `shared/src/abis/chainPassTicketAbi.ts` (file name + exported
identifier) and `shared/src/abis/chainPassTicket.json` (file name) also stay,
since they directly mirror the Solidity artifact name. Every other TypeScript
identifier, package name, env var, seed row, doc reference, and UI string is
in scope.

### D2. Migration posture: greenfield

No backward compatibility. Env var names change (no fallback-read shims),
seed SQL literals change (existing dev databases get torn down and reseeded),
localStorage keys change (existing users lose favorites/theme preferences).

Pre-launch, testnet-only, single-team context makes this safe. Shims are debt
we don't need. The affected developers are directed to run
`docker compose down -v` once after pulling, which reseeds to the new slug.

### D3. Visual identity: name + wordmark + favicon only

No palette, no typography changes. The owner provided two wordmark SVG
variants (light-on-black and dark-on-white) which drop into `client/public/`
and replace the text wordmark currently rendered in `Header.tsx` and
`Footer.tsx`. Favicon is regenerated from the wordmark.

A full visual refresh — new palette, typography, component treatments — is a
separate future project.

### D4. Preserve deterministic hash inputs

The string literal `"chainpass:route:v1:"` in `shared/src/routeId.ts` is the
keccak256 hash input used to derive on-chain routeIds. Changing it would
change every route's derived routeId, breaking:

- On-chain `setRoutePrice(routeId, priceWei)` mappings (prices are stored
  under the old routeId).
- Any minted passes whose metadata references the old routeId.

Rule: **the string literal stays**. The surrounding TypeScript constant name
(`CHAINPASS_ROUTE_LABEL_NAMESPACE`) renames freely — its value is a UUID that
doesn't change, and renaming a TS identifier doesn't affect runtime behavior.

Same rule applies generally: anything that contributes to deterministic
on-chain state — including hash input strings — stays, even if it reads
"chainpass".

### D5. GitHub repo rename: owner's call, async

The owner may rename `cybort360/chainpass` → `cybort360/hoppr` on GitHub at
any time. GitHub auto-redirects old URLs, so nothing breaks either way. The
plan assumes the rename happens; the `Footer.tsx` GitHub link updates to the
new URL for cleanliness. If the owner skips the GitHub rename, the existing
URL continues working via redirect — no code change needed.

## File-by-file plan

### Group A — Package identifiers & workspace scope

- `package.json` (root): `name` field; `@chainpass/*` filter refs
- `shared/package.json`: package name
- `server/api/package.json`: package name, workspace deps
- `server/indexer/package.json`: package name, workspace deps
- `client/package.json`: workspace dep
- `pnpm-lock.yaml`: regenerate via `pnpm install`

Rename: `chainpass` → `hoppr`, `@chainpass/*` → `@hoppr/*`.

### Group B — Import paths

Every TS file importing from `@chainpass/*`. Mechanical find-and-replace of
import specifiers; no logic changes.

Client files (confirmed by grep):
- `src/pages/{RoutePurchasePage,AppLayout,ConductorPage,ProfilePage,RoutesPage,AdminPage,PassPage,OperatorPage}.tsx`
- `src/config/{wagmi,privy}.ts`
- `src/hooks/useLoyalty.ts`
- `src/lib/{chainTicketCounters,tx,onchainPasses,switchToMonadTestnet}.ts`
- `src/layouts/AppLayout.tsx`

Server files:
- `api/src/app.ts`
- `indexer/src/index.ts`

Note: the imported identifier `chainPassTicketAbi` itself is NOT renamed (per
D1). Only the module specifier changes: `from "@chainpass/shared"` → `from
"@hoppr/shared"`.

### Group C — Environment variable names

- `.env.example` (root): rename keys
- `client/.env.example`: rename keys
- `server/indexer/.env.example`: rename keys
- Client code that reads `import.meta.env.VITE_CHAINPASS_*`: locate via grep
  during implementation, rename reads

Renames:
- `VITE_CHAINPASS_CONTRACT_ADDRESS` → `VITE_HOPPR_CONTRACT_ADDRESS`
- `VITE_CHAINPASS_API_URL` → `VITE_HOPPR_API_URL`

### Group D — Shared TS constants

- `shared/src/index.ts`: `CHAINPASS_SHARED_VERSION` → `HOPPR_SHARED_VERSION`
- `shared/src/routeId.ts`: `CHAINPASS_ROUTE_LABEL_NAMESPACE` →
  `HOPPR_ROUTE_LABEL_NAMESPACE`; the `"chainpass:route:v1:"` string literal
  stays (per D4)

### Group E — Database name, service strings, log prefixes

- Database name `chainpass` → `hoppr`: update in
  - `.env.example` (root)
  - `server/indexer/.env.example`
  - All `DATABASE_URL` references in `server/api/tests/http.test.ts`
    (roughly 30 lines)
- Service id `"chainpass-api"` → `"hoppr-api"`: `api/src/app.ts` plus the one
  test assertion in `http.test.ts`
- Log prefixes `[chainpass-api]` / `[chainpass-indexer]` → `[hoppr-api]` /
  `[hoppr-indexer]`: `api/src/index.ts`, `indexer/src/index.ts`
- IDB database name `"chainpass-conductor"` → `"hoppr-conductor"`:
  `client/src/pages/ConductorPage.tsx`

### Group F — Seed data & test fixtures

- `server/api/src/schema.ts`:
  - Line 445: seed slug `'chainpass-transit'` → `'hoppr-transit'`
  - Line 445: seed name `'ChainPass Transit'` → `'Hoppr Transit'`
  - Line 513: referenced slug in backfill SQL `'chainpass-transit'` → `'hoppr-transit'`
  - Comments at lines 374, 381, 452 mentioning the seed operator
- `server/api/tests/http.test.ts`:
  - All `'chainpass-transit'` fixture literals → `'hoppr-transit'`
  - All `'ChainPass Transit'` fixture literals → `'Hoppr Transit'`
  - All `DATABASE_URL` strings updated with new DB name

### Group G — localStorage / IDB keys

Greenfield rename — existing users lose state.

- `client/src/hooks/useTheme.ts`: `chainpass_theme` → `hoppr_theme`
- `client/src/hooks/useFavouriteRoutes.ts`: `chainpass_favourites` → `hoppr_favourites`
- `client/src/hooks/useNotifications.ts`: `chainpass_notif_shown`, `chainpass_notif_schedule` → `hoppr_notif_shown`, `hoppr_notif_schedule`
- `client/src/pages/AdminPage.tsx`: `chainpass_operator_names` → `hoppr_operator_names`
- `client/src/lib/api.ts`: `chainpass_routes_cache` → `hoppr_routes_cache`
- `client/src/hooks/useOfflineQr.ts`: key prefix `chainpass.qr.` → `hoppr.qr.`
- `client/index.html`: inline theme-boot script reading `chainpass_theme` → `hoppr_theme` (must match `useTheme.ts` key)

### Group H — UI copy

- `client/index.html`: `<title>ChainPass | ...` → `Hoppr | ...`; meta
  `apple-mobile-web-app-title` `ChainPass` → `Hoppr`
- `client/public/manifest.json`: `name`, `short_name`
- Landing components (text only; wordmark handled in Group I):
  - `BetterWaySection.tsx:51`
  - `WhyMonadSection.tsx:21,65`
  - `OperatorsSection.tsx:37`
- In-app references:
  - `AppLayout.tsx:419`: `ChainPass` → `Hoppr`
  - `PassPage.tsx:440`: `ChainPass Transit` → `Hoppr Transit` (display of seed operator)
  - `PwaInstallBanner.tsx:11,18`
  - `TierCard.tsx:76`
  - `PhoneTicketMockup.tsx:13` (aria-label)
  - `RoutePurchasePage.tsx:1171`: `Allow ChainPass to spend …` → `Allow Hoppr …`
  - `RoutesPage.tsx:608`: subtitle
  - `useShareRoute.ts:32`: share-sheet title
  - `useNotifications.ts:56`: notification title; file-header comment line 2
  - `ProfilePage.tsx:276`: CSV filename prefix `chainpass-history-` → `hoppr-history-`
- `OperatorPage.tsx:1817,1823`: These are inside a deploy-instructions snippet
  that references `ChainPassTicket.sol` (the contract) and
  `DeployChainPass.s.sol` (the deploy script). **Both stay unchanged** — they
  refer to the unchanged contract artifacts.

### Group I — Logo & favicon

- Drop owner-provided `hoppr-wordmark-light.svg` (white text on black) and
  `hoppr-wordmark-dark.svg` (black text on white) into `client/public/`.
  These assets must be saved to disk before plan execution begins.
- Generate `client/public/favicon.svg` from the wordmark (or use a standalone
  mark if the wordmark doesn't downscale cleanly). Update
  `<link rel="icon">` in `client/index.html`.
- `client/src/components/landing/Header.tsx:59`: replace text `ChainPass`
  with `<img src="/hoppr-wordmark-light.svg" alt="Hoppr" className="h-6 w-auto" />`.
  (Header sits on dark surface → use the light-on-black variant.)
- `client/src/components/landing/Footer.tsx:14`: same treatment, same asset
  (footer is also dark).
- In-app header wordmark in `AppLayout.tsx:419` stays as text for this
  project — it's a smaller in-app chip, and introducing an image there is
  out of scope for the name-only rebrand. It still changes text `ChainPass` →
  `Hoppr` per Group H.

### Group J — Documentation

- `README.md` (root)
- `client/README.md`
- `server/README.md`
- `contracts/README.md`
- `PRD.md`
- `walkthrough.md`

Rule of thumb: rename "ChainPass" → "Hoppr" wherever it refers to the product
or organization. Preserve references that specifically describe the contract
or its deploy script (e.g. `ChainPassTicket`, `DeployChainPass.s.sol`) —
those are artifact names.

GitHub URL in `Footer.tsx:4` updates to `https://github.com/cybort360/hoppr`
assuming the owner renames the repo. If the owner defers the rename, GitHub's
auto-redirect keeps the old URL working (see D5).

### Group K — Build & CI

- `scripts/vercel-build.mjs` (line 28): `['--filter', '@chainpass/shared', ...]` → `['--filter', '@hoppr/shared', ...]`
- `docker-compose.yml` (root):
  - `POSTGRES_USER: chainpass` → `hoppr`
  - `POSTGRES_PASSWORD: chainpass` → `hoppr`
  - `POSTGRES_DB: chainpass` → `hoppr`
  - Named volume `chainpass_pg` → `hoppr_pg` (two references: mount + top-level declaration)
  - `DATABASE_URL: postgresql://chainpass:chainpass@db:5432/chainpass` → `postgresql://hoppr:hoppr@db:5432/hoppr`
  - Healthcheck `pg_isready -U chainpass -d chainpass` → `pg_isready -U hoppr -d hoppr`
- `tooling/docker-compose.yml`:
  - `container_name: chainpass-postgres` → `hoppr-postgres`
  - `POSTGRES_DB: chainpass` → `hoppr`
  - Named volume `chainpass_pg_data` → `hoppr_pg_data` (two references)
- `Dockerfile`:
  - Header comments mentioning `chainpass-api` image name and `@chainpass/*` packages
  - `RUN pnpm --filter @chainpass/shared build && pnpm --filter @chainpass/api build` → `@hoppr/shared`, `@hoppr/api`

### Out of scope (stays as-is)

- `contracts/src/ChainPassTicket.sol`
- `contracts/script/DeployChainPass.s.sol`
- `contracts/test/ChainPassTicket.t.sol`
- `shared/src/abis/chainPassTicketAbi.ts` (file name and exported identifier)
- `shared/src/abis/chainPassTicket.json` (file name)
- The string literal `"chainpass:route:v1:"` in `shared/src/routeId.ts`

## Rollout

### Branch strategy

Single branch `feat/hoppr-rebrand` off current `main`. Structured as ordered,
semantically-coherent commits — one per group where practical — to make
review, bisection, and single-group reverts cheap.

Target commit order:

1. `chore: rename workspace scope @chainpass/* → @hoppr/*` (Groups A + B + lockfile regen)
2. `chore: rename env vars VITE_CHAINPASS_* → VITE_HOPPR_*` (Group C)
3. `chore: rename shared TS constants to HOPPR_*` (Group D)
4. `chore: rename database, service id, log prefixes` (Group E)
5. `chore: rename seed operator chainpass-transit → hoppr-transit` (Group F)
6. `chore: rename localStorage/IDB keys to hoppr_*` (Group G)
7. `feat: swap UI copy ChainPass → Hoppr` (Group H)
8. `feat: replace wordmark and favicon with Hoppr logo` (Group I)
9. `docs: rebrand all README/PRD/walkthrough references` (Group J)
10. `chore: rename build/CI references` (Group K)

One PR containing all ten commits.

### Per-commit verification

Every commit must leave the tree in a buildable state.

- After commit 1: `pnpm install && pnpm --filter client build && pnpm --filter @hoppr/api test && pnpm --filter @hoppr/indexer test`
- After commits 2-4: `pnpm --filter client build`; server tests
- After commit 5: API tests pass with renamed fixtures
- After commit 6: client builds; manual fresh-load smoke (no localStorage errors)
- After commit 7: client builds
- After commit 8: client builds; manual check of landing header + footer
- After commits 9-10: no test expected

### Final verification gate (pre-merge)

1. `pnpm install` from clean — lockfile resolves.
2. `pnpm --filter client build` — passes (tsc -b + vite build).
3. `pnpm --filter @hoppr/api test` — 70/70 pass.
4. `pnpm --filter @hoppr/indexer test` — 7/7 pass.
5. Greenfield DB reset:
   ```
   docker compose down -v
   docker compose up -d postgres
   pnpm --filter @hoppr/api run seed:route-labels
   pnpm dev
   ```
6. Manual smoke:
   - Landing loads with Hoppr wordmark in header + footer.
   - `/operators` shows `Hoppr Transit`.
   - Click into it → routes render.
   - Purchase flow reaches contract call (contract is still `ChainPassTicket`
     — the UI should say "Hoppr" but the on-chain call still targets the same
     deployed address).
7. Residual-reference check:
   ```
   grep -r -i chainpass --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
   ```
   Every remaining hit must be one of:
   - A file under `contracts/` (untouched).
   - The literal `"chainpass:route:v1:"` in `shared/src/routeId.ts`.
   - The `chainPassTicketAbi` identifier or `chainPassTicket.json` filename
     in `shared/src/abis/`.

### PR body notice

```
⚠️ Breaking for local dev environments — run:
  docker compose down -v   # drops chainpass db + volumes
  pnpm install             # regenerates lockfile with @hoppr/* scope
  docker compose up -d postgres
  pnpm --filter @hoppr/api run seed:route-labels
```

### Owner follow-ups (outside the PR)

- Rename `cybort360/chainpass` → `cybort360/hoppr` on GitHub (optional; see D5).
- Update local remote: `git remote set-url origin git@github.com:cybort360/hoppr.git`.
- Optionally rename the local repo directory (`~/Desktop/chainpass` →
  `~/Desktop/hoppr`); breaks existing worktrees and IDE workspaces, so
  deferred to owner's choice.

## Assets required before execution

The owner-provided wordmark SVGs must be saved to:
- `client/public/hoppr-wordmark-light.svg` (white text on black — used in Header and Footer on dark surfaces)
- `client/public/hoppr-wordmark-dark.svg` (black text on white — reserved for future light-mode surfaces)

A favicon derived from the wordmark is also required at `client/public/favicon.svg` (or equivalent). If the wordmark doesn't downscale cleanly to 16px, a standalone monogram (e.g. `H`) may be substituted.

These must be in place before commit 8 (Group I) executes.
