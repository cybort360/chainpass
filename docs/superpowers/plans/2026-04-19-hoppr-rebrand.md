# Hoppr Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every user-visible and developer-visible occurrence of "ChainPass" to "Hoppr" across the codebase, except the deployed Solidity contract (`ChainPassTicket.sol`), its ABI identifier (`chainPassTicketAbi`), and the `"chainpass:route:v1:"` hash-input string literal that contributes to deterministic on-chain routeIds.

**Architecture:** 10 sequential, semantically-coherent commits on branch `feat/hoppr-rebrand`. Each commit covers one logical group (workspace scope, env vars, DB name, UI copy, etc.) and leaves the tree in a buildable, test-passing state. Greenfield migration posture — existing developer databases and localStorage get torn down, no backward-compat shims.

**Tech Stack:** pnpm monorepo, TypeScript, Vite, React, Express, Postgres, Vitest + Supertest, Solidity (Foundry), Docker.

**Pre-requisites:**
- Start from clean `main` (or the rider-marketplace branch post-merge). Confirm with `git status`.
- Branch `feat/hoppr-rebrand` already exists with the design spec committed (SHA `a60bc9f`). Continue committing on top of that.
- Run a baseline `pnpm install && pnpm --filter client build && pnpm --filter @chainpass/api test && pnpm --filter @chainpass/indexer test` **before** Task 1 to establish that the tree is green pre-rebrand. If anything fails at baseline, stop — fix that first.
- Owner-provided Hoppr wordmark SVGs must be saved to `client/public/hoppr-wordmark-light.svg` and `client/public/hoppr-wordmark-dark.svg` before Task 8 runs. If they're not on disk, Task 8 blocks.

---

## Task 1: Rename workspace packages `@chainpass/*` → `@hoppr/*`

Covers Groups A + B from the spec. Atomic: renames package declarations and every import specifier that references them in a single commit so no intermediate state has dangling imports.

**Files:**
- Modify: `package.json` (root)
- Modify: `shared/package.json`
- Modify: `server/api/package.json`
- Modify: `server/indexer/package.json`
- Modify: `client/package.json`
- Modify: `scripts/vercel-build.mjs`
- Modify: `Dockerfile`
- Modify: `.env.example` (root) — updates `@chainpass/*` comment references (only; DATABASE_URL stays until Task 4, product mentions until Task 9)
- Modify (imports, mechanical): `client/src/layouts/AppLayout.tsx`
- Modify (imports): `client/src/pages/RoutePurchasePage.tsx`
- Modify (imports): `client/src/pages/ConductorPage.tsx`
- Modify (imports): `client/src/pages/ProfilePage.tsx`
- Modify (imports): `client/src/pages/RoutesPage.tsx`
- Modify (imports): `client/src/pages/AdminPage.tsx`
- Modify (imports): `client/src/pages/PassPage.tsx`
- Modify (imports): `client/src/pages/OperatorPage.tsx`
- Modify (imports): `client/src/config/wagmi.ts`
- Modify (imports): `client/src/config/privy.ts`
- Modify (imports): `client/src/hooks/useLoyalty.ts`
- Modify (imports): `client/src/lib/chainTicketCounters.ts`
- Modify (imports): `client/src/lib/tx.ts`
- Modify (imports): `client/src/lib/onchainPasses.ts`
- Modify (imports): `client/src/lib/switchToMonadTestnet.ts`
- Modify (imports): `server/api/src/app.ts`
- Modify (imports): `server/indexer/src/index.ts`
- Modify: `pnpm-lock.yaml` (regenerated)

**Rules:**
- The identifier `chainPassTicketAbi` itself stays (it's an ABI binding — D1 of the spec). Only the module specifier changes: `from "@chainpass/shared"` → `from "@hoppr/shared"`.
- The file `shared/src/abis/chainPassTicketAbi.ts` and its JSON sibling also stay.

- [ ] **Step 1: Rename root `package.json`**

Open `package.json`. Change:
```json
{
  "name": "chainpass",
  ...
  "scripts": {
    "dev": "pnpm --parallel --filter client --filter @chainpass/api --filter @chainpass/shared run dev",
    "dev:api": "pnpm --filter @chainpass/api dev",
    "dev:indexer": "pnpm --filter @chainpass/indexer dev",
    "test": "pnpm --filter @chainpass/api test && pnpm --filter @chainpass/indexer test",
    ...
  },
  "dependencies": {
    "@chainpass/shared": "workspace:*"
  }
}
```
To:
```json
{
  "name": "hoppr",
  ...
  "scripts": {
    "dev": "pnpm --parallel --filter client --filter @hoppr/api --filter @hoppr/shared run dev",
    "dev:api": "pnpm --filter @hoppr/api dev",
    "dev:indexer": "pnpm --filter @hoppr/indexer dev",
    "test": "pnpm --filter @hoppr/api test && pnpm --filter @hoppr/indexer test",
    ...
  },
  "dependencies": {
    "@hoppr/shared": "workspace:*"
  }
}
```
(Any other `@chainpass/*` filter refs in scripts also rename to `@hoppr/*`.)

- [ ] **Step 2: Rename workspace package manifests**

In `shared/package.json`: `"name": "@chainpass/shared"` → `"name": "@hoppr/shared"`.
In `server/api/package.json`:
- `"name": "@chainpass/api"` → `"name": "@hoppr/api"`
- `"@chainpass/shared": "workspace:*"` → `"@hoppr/shared": "workspace:*"`
In `server/indexer/package.json`:
- `"name": "@chainpass/indexer"` → `"name": "@hoppr/indexer"`
- `"@chainpass/shared": "workspace:*"` → `"@hoppr/shared": "workspace:*"`
In `client/package.json`:
- `"@chainpass/shared": "workspace:^"` → `"@hoppr/shared": "workspace:^"`

- [ ] **Step 3: Rename TypeScript imports**

In every client/server source file, replace all module specifiers:
```
from "@chainpass/shared"  →  from "@hoppr/shared"
```

The exact files are listed under the **Files** heading of this task. The replacement is mechanical — the named imports themselves (`chainPassTicketAbi`, `monadTestnet`, `erc20Abi`, `CHAINPASS_SHARED_VERSION`, `newRouteIdDecimalFromUuid`) stay as-is. Only the path after `from` changes.

- [ ] **Step 4: Rename build-script references**

In `scripts/vercel-build.mjs` line 28:
```javascript
npxPnpm(['--filter', '@chainpass/shared', 'run', 'build']);
```
To:
```javascript
npxPnpm(['--filter', '@hoppr/shared', 'run', 'build']);
```

In `Dockerfile`, rename any `@chainpass/*` filter refs. The current file has:
```dockerfile
# ChainPass API — monorepo build (@chainpass/shared + @chainpass/api).
# Build: docker build -t chainpass-api .
# Run:  docker run --rm -p 3001:3001 -e PORT=3001 -e DATABASE_URL=... -e QR_SIGNING_SECRET=... chainpass-api
...
RUN pnpm --filter @chainpass/shared build && pnpm --filter @chainpass/api build
```
Change to:
```dockerfile
# Hoppr API — monorepo build (@hoppr/shared + @hoppr/api).
# Build: docker build -t hoppr-api .
# Run:  docker run --rm -p 3001:3001 -e PORT=3001 -e DATABASE_URL=... -e QR_SIGNING_SECRET=... hoppr-api
...
RUN pnpm --filter @hoppr/shared build && pnpm --filter @hoppr/api build
```
(All three `chainpass-api` image-name hints in the comment header also become `hoppr-api`.)

In `.env.example` (root), update only the `@chainpass/*` comment refs:

Line 31:
```
#   pnpm --filter @chainpass/api run seed:route-labels
```
becomes:
```
#   pnpm --filter @hoppr/api run seed:route-labels
```

Line 42:
```
# ticket_events (pnpm --filter @chainpass/indexer run db:clear-ticket-events), set this to
```
becomes:
```
# ticket_events (pnpm --filter @hoppr/indexer run db:clear-ticket-events), set this to
```

**Leave these alone in this task:**
- Line 2: `# ChainPass — copy to .env ...` (product name → Task 9)
- Line 32: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chainpass` → Task 4
- Line 38: `# Deployed ChainPassTicket address ...` (artifact name — stays forever)
- Line 54: `# --- Contracts: forge script (script/DeployChainPass.s.sol) ---` (artifact name — stays forever)

- [ ] **Step 5: Regenerate lockfile**

Run: `pnpm install`
Expected: pnpm updates `pnpm-lock.yaml` in-place to reflect the new `@hoppr/*` package names. No install errors.

- [ ] **Step 6: Verify client build passes**

Run: `pnpm --filter client build`
Expected: exits 0. If any import path was missed, tsc reports "Cannot find module '@chainpass/shared'" — go back to Step 3 and fix.

- [ ] **Step 7: Verify server tests pass**

Run (from repo root):
```
pnpm --filter @hoppr/api test
pnpm --filter @hoppr/indexer test
```
Expected: `@hoppr/api` reports 70/70 passing; `@hoppr/indexer` reports 7/7 passing.

- [ ] **Step 8: Commit**

```bash
git add package.json shared/package.json server/api/package.json server/indexer/package.json client/package.json pnpm-lock.yaml scripts/vercel-build.mjs Dockerfile .env.example client/src server/api/src server/indexer/src
git commit -m "chore: rename workspace scope @chainpass/* → @hoppr/*"
```

---

## Task 2: Rename env variables `VITE_CHAINPASS_*` → `VITE_HOPPR_*`

Covers Group C from the spec.

**Files:**
- Modify: `.env.example` (root)
- Modify: `client/.env.example`
- Modify: `client/src/vite-env.d.ts`
- Modify: `client/src/lib/env.ts`
- Modify: `client/src/pages/RoutePurchasePage.tsx`
- Modify: `client/src/pages/OperatorPage.tsx`
- Modify: `client/src/pages/ConductorPage.tsx`
- Modify: `client/src/pages/PassPage.tsx`
- Modify: `client/src/pages/ProfilePage.tsx`

**Renames:**
- `VITE_CHAINPASS_CONTRACT_ADDRESS` → `VITE_HOPPR_CONTRACT_ADDRESS`
- `VITE_CHAINPASS_API_URL` → `VITE_HOPPR_API_URL`

- [ ] **Step 1: Rename keys in env-example files**

In `client/.env.example`:
```
VITE_CHAINPASS_CONTRACT_ADDRESS=0x33250106008ac99Fd169596D04b359ACf4cDc1C5
...
VITE_CHAINPASS_API_URL=http://localhost:3001
```
Becomes:
```
VITE_HOPPR_CONTRACT_ADDRESS=0x33250106008ac99Fd169596D04b359ACf4cDc1C5
...
VITE_HOPPR_API_URL=http://localhost:3001
```
Comments referencing "ChainPass API" also update to "Hoppr API" (UI copy rule).

Root `.env.example` has no `VITE_CHAINPASS_*` keys, but its comments mention "ChainPass" — update them in Task 9 (Docs), not here. Keep this task focused on the two var names.

- [ ] **Step 2: Rename the Vite env type declaration**

In `client/src/vite-env.d.ts`:
```typescript
interface ImportMetaEnv {
  readonly VITE_CHAINPASS_API_URL?: string
  readonly VITE_CHAINPASS_CONTRACT_ADDRESS?: string
  ...
}
```
Becomes:
```typescript
interface ImportMetaEnv {
  readonly VITE_HOPPR_API_URL?: string
  readonly VITE_HOPPR_CONTRACT_ADDRESS?: string
  ...
}
```

- [ ] **Step 3: Rename the env reader**

In `client/src/lib/env.ts` lines 44–45:
```typescript
apiUrl: (raw.VITE_CHAINPASS_API_URL as string | undefined) ?? "http://localhost:3001",
contractAddress: optionalAddress(raw.VITE_CHAINPASS_CONTRACT_ADDRESS as string | undefined),
```
Becomes:
```typescript
apiUrl: (raw.VITE_HOPPR_API_URL as string | undefined) ?? "http://localhost:3001",
contractAddress: optionalAddress(raw.VITE_HOPPR_CONTRACT_ADDRESS as string | undefined),
```

- [ ] **Step 4: Rename the variable names that appear in user-facing strings**

Each of these is a string literal displayed in the UI that spells out the env-var name. Since devs copy them into `.env` files, they must match the new names.

- `client/src/pages/RoutePurchasePage.tsx:611` — the code block shown to users
  ```tsx
  Set <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in{" "}
  ```
  becomes
  ```tsx
  Set <code className="font-mono text-primary">VITE_HOPPR_CONTRACT_ADDRESS</code> in{" "}
  ```

- `client/src/pages/OperatorPage.tsx:1102`:
  ```tsx
  setErr("Set VITE_CHAINPASS_CONTRACT_ADDRESS for on-chain totals, or run the API with DATABASE_URL + indexer.")
  ```
  becomes:
  ```tsx
  setErr("Set VITE_HOPPR_CONTRACT_ADDRESS for on-chain totals, or run the API with DATABASE_URL + indexer.")
  ```

- `client/src/pages/OperatorPage.tsx:1827`:
  ```tsx
  Then update <code className="font-mono">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in{" "}
  ```
  becomes:
  ```tsx
  Then update <code className="font-mono">VITE_HOPPR_CONTRACT_ADDRESS</code> in{" "}
  ```

- `client/src/pages/ConductorPage.tsx:530`:
  ```tsx
  Set <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in env.
  ```
  becomes:
  ```tsx
  Set <code className="font-mono text-primary">VITE_HOPPR_CONTRACT_ADDRESS</code> in env.
  ```

- `client/src/pages/PassPage.tsx:257`:
  ```tsx
  Configure <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code>.
  ```
  becomes:
  ```tsx
  Configure <code className="font-mono text-primary">VITE_HOPPR_CONTRACT_ADDRESS</code>.
  ```

- `client/src/pages/ProfilePage.tsx:220`:
  ```tsx
  setErr("Could not load passes. Set VITE_CHAINPASS_CONTRACT_ADDRESS or run the API.")
  ```
  becomes:
  ```tsx
  setErr("Could not load passes. Set VITE_HOPPR_CONTRACT_ADDRESS or run the API.")
  ```

- [ ] **Step 5: Verify client build passes**

Run: `pnpm --filter client build`
Expected: exits 0. If tsc errors with "Property 'VITE_CHAINPASS_…' does not exist", the `vite-env.d.ts` or a `.tsx` string was missed.

- [ ] **Step 6: Commit**

```bash
git add .env.example client/.env.example client/src
git commit -m "chore: rename env vars VITE_CHAINPASS_* → VITE_HOPPR_*"
```

---

## Task 3: Rename shared TS constants `CHAINPASS_*` → `HOPPR_*`

Covers Group D from the spec. **Only TS identifiers** — the string literal `"chainpass:route:v1:"` in `routeId.ts` stays because it feeds keccak256 hashes consumed by the deployed contract (D4).

**Files:**
- Modify: `shared/src/index.ts`
- Modify: `shared/src/routeId.ts`
- Modify (imports): `server/api/src/app.ts`
- Modify (imports): `server/indexer/src/index.ts`

**Renames:**
- `CHAINPASS_SHARED_VERSION` → `HOPPR_SHARED_VERSION`
- `CHAINPASS_ROUTE_LABEL_NAMESPACE` → `HOPPR_ROUTE_LABEL_NAMESPACE` (value unchanged — same UUID)

- [ ] **Step 1: Rename `CHAINPASS_SHARED_VERSION` at its definition**

In `shared/src/index.ts` line 1:
```typescript
export const CHAINPASS_SHARED_VERSION = "0.0.0" as const;
```
becomes:
```typescript
export const HOPPR_SHARED_VERSION = "0.0.0" as const;
```

- [ ] **Step 2: Rename `CHAINPASS_ROUTE_LABEL_NAMESPACE` at its definition**

In `shared/src/routeId.ts` line 8:
```typescript
export const CHAINPASS_ROUTE_LABEL_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as const;
```
becomes:
```typescript
export const HOPPR_ROUTE_LABEL_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as const;
```

And line 30:
```typescript
const u = uuidv5(key, CHAINPASS_ROUTE_LABEL_NAMESPACE);
```
becomes:
```typescript
const u = uuidv5(key, HOPPR_ROUTE_LABEL_NAMESPACE);
```

**Do NOT modify** lines 20 and 31:
```typescript
const h = keccak256(stringToBytes(`chainpass:route:v1:${id}`));
```
These string literals are part of the hash domain — changing them changes every derived routeId. Leave exactly as-is.

- [ ] **Step 3: Update the re-export in `shared/src/index.ts`**

Line 6 currently reads:
```typescript
  CHAINPASS_ROUTE_LABEL_NAMESPACE,
```
Change to:
```typescript
  HOPPR_ROUTE_LABEL_NAMESPACE,
```
(The surrounding `export { ... } from "./routeId.js"` block — keep its shape, just rename the member.)

- [ ] **Step 4: Rename consumers**

In `server/api/src/app.ts`, two lines reference the identifier:

Line 1:
```typescript
import { CHAINPASS_SHARED_VERSION } from "@hoppr/shared";
```
becomes:
```typescript
import { HOPPR_SHARED_VERSION } from "@hoppr/shared";
```

Line 48 (inside the `/health` response object):
```typescript
      shared: CHAINPASS_SHARED_VERSION,
```
becomes:
```typescript
      shared: HOPPR_SHARED_VERSION,
```

In `server/indexer/src/index.ts` line 1:
```typescript
import { CHAINPASS_SHARED_VERSION, chainPassTicketAbi, monadTestnet } from "@hoppr/shared";
```
becomes:
```typescript
import { HOPPR_SHARED_VERSION, chainPassTicketAbi, monadTestnet } from "@hoppr/shared";
```
And update the one referenced use on line 14:
```typescript
`[chainpass-indexer] Node.js + TypeScript (viem + pg). shared=${CHAINPASS_SHARED_VERSION}`,
```
becomes (note: log prefix stays `[chainpass-indexer]` until Task 4 — only the constant name changes here):
```typescript
`[chainpass-indexer] Node.js + TypeScript (viem + pg). shared=${HOPPR_SHARED_VERSION}`,
```

- [ ] **Step 5: Verify builds and tests**

Run:
```
pnpm --filter @hoppr/shared build
pnpm --filter client build
pnpm --filter @hoppr/api test
pnpm --filter @hoppr/indexer test
```
Expected: all exit 0; 70/70 + 7/7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add shared/src server/api/src server/indexer/src
git commit -m "chore: rename shared TS constants to HOPPR_* (value-preserving)"
```

---

## Task 4: Rename database, service id, log prefixes, IDB name

Covers Group E from the spec.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `tooling/docker-compose.yml`
- Modify: `.env.example` (root)
- Modify: `server/indexer/.env.example`
- Modify: `server/api/src/index.ts`
- Modify: `server/api/src/app.ts`
- Modify: `server/indexer/src/index.ts`
- Modify: `server/api/tests/http.test.ts`
- Modify: `client/src/pages/ConductorPage.tsx`

**Renames:**
- Database name `chainpass` → `hoppr` (and user/password in docker-compose root: `chainpass` → `hoppr`)
- Service id `"chainpass-api"` → `"hoppr-api"`
- Log prefixes `[chainpass-api]` → `[hoppr-api]`, `[chainpass-indexer]` → `[hoppr-indexer]`
- IndexedDB database `"chainpass-conductor"` → `"hoppr-conductor"`
- Docker volumes `chainpass_pg` → `hoppr_pg`, `chainpass_pg_data` → `hoppr_pg_data`
- Docker container name `chainpass-postgres` → `hoppr-postgres`

- [ ] **Step 1: Rename root docker-compose**

In `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: chainpass
      POSTGRES_PASSWORD: chainpass
      POSTGRES_DB: chainpass
    ...
    volumes:
      - chainpass_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chainpass -d chainpass"]
    ...
  api:
    ...
    environment:
      PORT: "3001"
      DATABASE_URL: postgresql://chainpass:chainpass@db:5432/chainpass
    ...
volumes:
  chainpass_pg:
```
Becomes:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: hoppr
      POSTGRES_PASSWORD: hoppr
      POSTGRES_DB: hoppr
    ...
    volumes:
      - hoppr_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hoppr -d hoppr"]
    ...
  api:
    ...
    environment:
      PORT: "3001"
      DATABASE_URL: postgresql://hoppr:hoppr@db:5432/hoppr
    ...
volumes:
  hoppr_pg:
```

- [ ] **Step 2: Rename tooling docker-compose**

In `tooling/docker-compose.yml`:
```yaml
services:
  postgres:
    ...
    container_name: chainpass-postgres
    ...
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: chainpass
    ...
    volumes:
      - chainpass_pg_data:/var/lib/postgresql/data

volumes:
  chainpass_pg_data:
```
Becomes:
```yaml
services:
  postgres:
    ...
    container_name: hoppr-postgres
    ...
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: hoppr
    ...
    volumes:
      - hoppr_pg_data:/var/lib/postgresql/data

volumes:
  hoppr_pg_data:
```
(POSTGRES_USER/PASSWORD stay `postgres` in this file — it's a local dev Postgres for the indexer that doesn't use the `chainpass` superuser pattern.)

- [ ] **Step 3: Rename DATABASE_URL in env-example files**

In `.env.example` (root) line 32:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/chainpass
```
becomes:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hoppr
```

In `server/indexer/.env.example` line 5: same rename.

- [ ] **Step 4: Rename service id and log prefixes**

In `server/api/src/app.ts` line 45:
```typescript
service: "chainpass-api",
```
becomes:
```typescript
service: "hoppr-api",
```

In `server/api/src/index.ts` line 14:
```typescript
`[chainpass-api] Express on Node.js → http://localhost:${port} (health: /health)`,
```
becomes:
```typescript
`[hoppr-api] Express on Node.js → http://localhost:${port} (health: /health)`,
```

In `server/indexer/src/index.ts`, every occurrence of `[chainpass-indexer]` (13+ in total — lines 14, 17, 21, 26, 458, 496, 507, 527, 532, 549, 553, 568, and any others) becomes `[hoppr-indexer]`. Use your editor's replace-in-file with `[chainpass-indexer]` → `[hoppr-indexer]` scoped to this file.

- [ ] **Step 5: Rename test DATABASE_URLs and service-id assertion**

In `server/api/tests/http.test.ts`:
- Every `"postgresql://postgres:postgres@localhost:5432/chainpass"` → `"postgresql://postgres:postgres@localhost:5432/hoppr"` (~30 occurrences). Use editor's replace-in-file.
- Line 40: `expect(res.body.service).toBe("chainpass-api");` → `expect(res.body.service).toBe("hoppr-api");`

- [ ] **Step 6: Rename IndexedDB name**

In `client/src/pages/ConductorPage.tsx` line 35:
```typescript
const IDB_NAME  = "chainpass-conductor"
```
becomes:
```typescript
const IDB_NAME  = "hoppr-conductor"
```

- [ ] **Step 7: Verify builds and tests**

Run:
```
pnpm --filter client build
pnpm --filter @hoppr/api test
pnpm --filter @hoppr/indexer test
```
Expected: 70/70 API tests pass (including the service-id assertion), 7/7 indexer tests pass, client builds clean.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml tooling/docker-compose.yml .env.example server/indexer/.env.example server/api/src server/indexer/src server/api/tests client/src/pages/ConductorPage.tsx
git commit -m "chore: rename database, service id, log prefixes to hoppr"
```

---

## Task 5: Rename seed operator `chainpass-transit` → `hoppr-transit`

Covers Group F from the spec.

**Files:**
- Modify: `server/api/src/schema.ts`
- Modify: `server/api/tests/http.test.ts`

- [ ] **Step 1: Rename seed in schema.ts**

In `server/api/src/schema.ts`:

Line 374 (comment):
```typescript
 * The first row is a default "ChainPass Transit" operator that every pre-existing
```
becomes:
```typescript
 * The first row is a default "Hoppr Transit" operator that every pre-existing
```

Line 381 (comment):
```typescript
 * admin_wallet / treasury_wallet: nullable for the seed row (ChainPass Transit
```
becomes:
```typescript
 * admin_wallet / treasury_wallet: nullable for the seed row (Hoppr Transit
```

Line 445 (the seed INSERT):
```sql
VALUES ('chainpass-transit', 'ChainPass Transit', 'active')
```
becomes:
```sql
VALUES ('hoppr-transit', 'Hoppr Transit', 'active')
```

Line 452 (comment):
```typescript
 * operator rows (including the seeded chainpass-transit row) start with
```
becomes:
```typescript
 * operator rows (including the seeded hoppr-transit row) start with
```

Line 513 (the backfill UPDATE):
```sql
SET operator_id = (SELECT id FROM operators WHERE slug = 'chainpass-transit')
```
becomes:
```sql
SET operator_id = (SELECT id FROM operators WHERE slug = 'hoppr-transit')
```

- [ ] **Step 2: Rename test fixtures in http.test.ts**

In `server/api/tests/http.test.ts`, every `'chainpass-transit'` → `'hoppr-transit'` and every `'ChainPass Transit'` → `'Hoppr Transit'`. Roughly 20 occurrences total; use editor's replace-in-file scoped to this one test file.

Key lines to verify after the replace:
- Lines 267–269, 301, 309–310 (mint-event fixtures embedding operator_slug/operator_name)
- Lines 728–729, 758, 775–776, 793, 795, 845, 866–867, 887, 891 (operator directory + detail fixtures)

- [ ] **Step 3: Verify API tests still pass**

Run: `pnpm --filter @hoppr/api test`
Expected: 70/70 pass. If any assertion mismatches, it means a literal was missed — grep `chainpass-transit` or `ChainPass Transit` inside `server/api/tests/` and fix.

- [ ] **Step 4: Commit**

```bash
git add server/api/src/schema.ts server/api/tests/http.test.ts
git commit -m "chore: rename seed operator chainpass-transit → hoppr-transit"
```

---

## Task 6: Rename localStorage / IndexedDB keys

Covers Group G from the spec. Greenfield: no migration, existing users lose stored state.

**Files:**
- Modify: `client/src/hooks/useTheme.ts`
- Modify: `client/src/hooks/useFavouriteRoutes.ts`
- Modify: `client/src/hooks/useNotifications.ts`
- Modify: `client/src/pages/AdminPage.tsx`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/hooks/useOfflineQr.ts`
- Modify: `client/index.html`

**Renames:**
- `chainpass_theme` → `hoppr_theme`
- `chainpass_favourites` → `hoppr_favourites`
- `chainpass_notif_shown` → `hoppr_notif_shown`
- `chainpass_notif_schedule` → `hoppr_notif_schedule`
- `chainpass_operator_names` → `hoppr_operator_names`
- `chainpass_routes_cache` → `hoppr_routes_cache`
- `chainpass.qr.${tokenId}` → `hoppr.qr.${tokenId}`

- [ ] **Step 1: Rename theme key — in sync across hook and inline script**

In `client/src/hooks/useTheme.ts` line 4:
```typescript
const STORAGE_KEY = "chainpass_theme"
```
becomes:
```typescript
const STORAGE_KEY = "hoppr_theme"
```

In `client/index.html` line 7 (the inline theme-boot script that runs before React mounts):
```html
var t = localStorage.getItem('chainpass_theme');
```
becomes:
```html
var t = localStorage.getItem('hoppr_theme');
```

These two **must match** — if they diverge, the page boots in the wrong theme until React rehydrates.

- [ ] **Step 2: Rename the remaining localStorage keys**

- `client/src/hooks/useFavouriteRoutes.ts` line 3: `"chainpass_favourites"` → `"hoppr_favourites"`
- `client/src/hooks/useNotifications.ts` lines 10–11:
  - `"chainpass_notif_shown"` → `"hoppr_notif_shown"`
  - `"chainpass_notif_schedule"` → `"hoppr_notif_schedule"`
- `client/src/pages/AdminPage.tsx` line 51: `'chainpass_operator_names'` → `'hoppr_operator_names'`
- `client/src/lib/api.ts` line 77: `"chainpass_routes_cache"` → `"hoppr_routes_cache"`
- `client/src/hooks/useOfflineQr.ts` line 4:
  ```typescript
  const storageKey = (tokenId: string) => `chainpass.qr.${tokenId}`
  ```
  becomes:
  ```typescript
  const storageKey = (tokenId: string) => `hoppr.qr.${tokenId}`
  ```

- [ ] **Step 3: Verify client builds**

Run: `pnpm --filter client build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks client/src/pages/AdminPage.tsx client/src/lib/api.ts client/index.html
git commit -m "chore: rename localStorage/IDB keys chainpass_* → hoppr_*"
```

---

## Task 7: UI copy — text swap (no wordmark yet)

Covers Group H from the spec. Touches user-visible strings only. Logo/wordmark swap comes in Task 8.

**Files:**
- Modify: `client/index.html`
- Modify: `client/public/manifest.json`
- Modify: `client/src/components/landing/BetterWaySection.tsx`
- Modify: `client/src/components/landing/WhyMonadSection.tsx`
- Modify: `client/src/components/landing/OperatorsSection.tsx`
- Modify: `client/src/layouts/AppLayout.tsx`
- Modify: `client/src/pages/PassPage.tsx`
- Modify: `client/src/components/PwaInstallBanner.tsx`
- Modify: `client/src/components/ui/TierCard.tsx`
- Modify: `client/src/components/landing/PhoneTicketMockup.tsx`
- Modify: `client/src/pages/RoutePurchasePage.tsx`
- Modify: `client/src/pages/RoutesPage.tsx`
- Modify: `client/src/hooks/useShareRoute.ts`
- Modify: `client/src/hooks/useNotifications.ts`
- Modify: `client/src/pages/ProfilePage.tsx`
- Modify: `client/src/components/landing/Header.tsx` (text node only — wordmark swap is Task 8)
- Modify: `client/src/components/landing/Footer.tsx` (text node only — wordmark swap is Task 8)

**Rule:** every user-visible `ChainPass` (the product/org) → `Hoppr`. Leave artifact names (`ChainPassTicket.sol`, `DeployChainPass.s.sol`) as-is — they refer to unchanged Solidity files.

- [ ] **Step 1: `<title>` and meta tags**

In `client/index.html`:
- `<title>ChainPass | Scan. Board. Done.</title>` → `<title>Hoppr | Scan. Board. Done.</title>`
- `<meta name="apple-mobile-web-app-title" content="ChainPass" />` → `content="Hoppr"`

In `client/public/manifest.json`:
```json
"name": "ChainPass",
"short_name": "ChainPass",
```
becomes:
```json
"name": "Hoppr",
"short_name": "Hoppr",
```

- [ ] **Step 2: Landing section copy**

- `client/src/components/landing/BetterWaySection.tsx:51` — replace `ChainPass` with `Hoppr` in the sentence "Everything you need, right when you need it. ChainPass strips away the friction of legacy systems."
- `client/src/components/landing/WhyMonadSection.tsx:21` — replace `ChainPass` with `Hoppr` in "ChainPass uses familiar ERC-721 patterns…"
- `client/src/components/landing/WhyMonadSection.tsx:65` — replace `ChainPass` with `Hoppr` in "ChainPass is built for gate-like validation…"
- `client/src/components/landing/OperatorsSection.tsx:37` — replace `ChainPass` with `Hoppr` in "ChainPass isn't only a rider app…"

- [ ] **Step 3: In-app UI text**

- `client/src/layouts/AppLayout.tsx:419` — the text node reading `ChainPass` → `Hoppr`
- `client/src/pages/PassPage.tsx:440` — the `ChainPass Transit` string → `Hoppr Transit` (this is the rendered operator-name display for the seed operator)
- `client/src/components/PwaInstallBanner.tsx:11` — comment `{/* ChainPass icon */}` → `{/* Hoppr icon */}`
- `client/src/components/PwaInstallBanner.tsx:18` — user text "Add ChainPass to home screen" → "Add Hoppr to home screen"
- `client/src/components/ui/TierCard.tsx:76` — "you're a ChainPass legend!" → "you're a Hoppr legend!"
- `client/src/components/landing/PhoneTicketMockup.tsx:13` — the `aria-label` starting "ChainPass digital ticket for LAGOS BRT…" — replace `ChainPass` with `Hoppr`
- `client/src/pages/RoutePurchasePage.tsx:1171` — "Allow ChainPass to spend{" "}..." → "Allow Hoppr to spend{" "}..."
- `client/src/pages/RoutesPage.tsx:608` — subtitle "All routes across every operator on ChainPass." → "…on Hoppr."

- [ ] **Step 4: Shared strings in hooks**

- `client/src/hooks/useShareRoute.ts:32`:
  ```typescript
  const shareData = { title: `ChainPass — ${routeName}`, text: `Buy a ticket for ${routeName}`, url }
  ```
  becomes:
  ```typescript
  const shareData = { title: `Hoppr — ${routeName}`, text: `Buy a ticket for ${routeName}`, url }
  ```

- `client/src/hooks/useNotifications.ts:2` — file-header comment:
  ```typescript
   * Browser push notifications for ChainPass.
  ```
  becomes:
  ```typescript
   * Browser push notifications for Hoppr.
  ```

- `client/src/hooks/useNotifications.ts:56`:
  ```typescript
  const n = new Notification("ChainPass — Ticket expiring soon", {
  ```
  becomes:
  ```typescript
  const n = new Notification("Hoppr — Ticket expiring soon", {
  ```

- `client/src/pages/ProfilePage.tsx:276`:
  ```typescript
  a.download = `chainpass-history-${new Date().toISOString().slice(0, 10)}.csv`
  ```
  becomes:
  ```typescript
  a.download = `hoppr-history-${new Date().toISOString().slice(0, 10)}.csv`
  ```

- [ ] **Step 5: Header + Footer text nodes (wordmark SVG swap happens in Task 8)**

In `client/src/components/landing/Header.tsx:59`, the text inside the wordmark element currently reads `ChainPass`. Change to `Hoppr`. The element stays text-only in this task — Task 8 swaps it to an `<img>`.

In `client/src/components/landing/Footer.tsx:14`, the text `ChainPass` → `Hoppr`. Line 15 also contains a copyright string `© 2026 ChainPass. All rights reserved.` — change that to `© 2026 Hoppr. All rights reserved.`.

Do NOT change line 4 of `Footer.tsx` in this task — the GitHub URL update happens in Task 9 (Docs) alongside other external-URL updates.

- [ ] **Step 6: Special case — leave OperatorPage deploy-instructions intact**

`client/src/pages/OperatorPage.tsx` lines 1817 and 1823 reference `ChainPassTicket.sol` and `forge script script/DeployChainPass.s.sol` inside a deploy-instructions block shown to operators. These are **artifact file names** (the unchanged Solidity files in `contracts/`), not references to the product. **Leave both lines unchanged.**

- [ ] **Step 7: Verify client builds**

Run: `pnpm --filter client build`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add client/index.html client/public/manifest.json client/src
git commit -m "feat: swap ChainPass → Hoppr in UI copy"
```

---

## Task 8: Wordmark + favicon swap

Covers Group I from the spec.

**Pre-requisite:** The Hoppr wordmark SVGs the owner provided must be on disk at:
- `client/public/hoppr-wordmark-light.svg` (white wordmark — used on dark surfaces)
- `client/public/hoppr-wordmark-dark.svg` (black wordmark — reserved for light surfaces)

If these files do not exist, stop and obtain them before proceeding.

**Files:**
- Create: `client/public/hoppr-wordmark-light.svg`
- Create: `client/public/hoppr-wordmark-dark.svg`
- Create or replace: `client/public/favicon.svg`
- Modify: `client/index.html`
- Modify: `client/src/components/landing/Header.tsx`
- Modify: `client/src/components/landing/Footer.tsx`

- [ ] **Step 1: Save the wordmark assets to disk**

Copy the owner-provided SVG files into `client/public/`. Confirm with:
```
ls -la client/public/hoppr-wordmark-*.svg
```
Expected: both files exist and are non-empty.

- [ ] **Step 2: Replace the favicon**

Create `client/public/favicon.svg`. Preferred source: a square crop of the Hoppr mark (e.g., just the "H" letterform extracted from the wordmark) that stays legible at 16×16. If the owner supplied a dedicated favicon/mark SVG, use that. Otherwise, use the light wordmark SVG cropped square as an interim.

Update `client/index.html`'s favicon `<link>` to:
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```
(The exact existing favicon markup — verify before replacing.)

- [ ] **Step 3: Swap the Header wordmark from text to `<img>`**

In `client/src/components/landing/Header.tsx:59`, the current text node (now reading `Hoppr` after Task 7) becomes an `<img>`:
```tsx
<img src="/hoppr-wordmark-light.svg" alt="Hoppr" className="h-6 w-auto" />
```
Keep any wrapping `<Link>` or `<div>` elements and their classes — only replace the inner text node with the `<img>`. The `h-6` tailwind class sets height to match typical header wordmark sizing; adjust up/down (e.g. `h-7`, `h-5`) after a manual visual check.

- [ ] **Step 4: Swap the Footer wordmark from text to `<img>`**

In `client/src/components/landing/Footer.tsx:14`, the text node currently reading `Hoppr` becomes:
```tsx
<img src="/hoppr-wordmark-light.svg" alt="Hoppr" className="h-6 w-auto" />
```
Keep the enclosing `<div className="text-xl font-bold text-primary font-headline">` — or remove the redundant typography classes if the `<img>` replacement renders correctly without them.

**Do not** change the copyright text on line 15 (it stays `© 2026 Hoppr. All rights reserved.` from Task 7).

- [ ] **Step 5: Verify client builds and wordmark renders**

Run: `pnpm --filter client build`
Expected: exits 0.

Then manual smoke check:
```
pnpm --filter client dev
```
Open `http://localhost:5173` — confirm the Hoppr wordmark displays in the header and footer on the landing page. Also confirm the browser tab icon is the new favicon. Adjust `h-*` classes if the wordmark looks wrong.

- [ ] **Step 6: Commit**

```bash
git add client/public/hoppr-wordmark-light.svg client/public/hoppr-wordmark-dark.svg client/public/favicon.svg client/index.html client/src/components/landing/Header.tsx client/src/components/landing/Footer.tsx
git commit -m "feat: replace wordmark and favicon with Hoppr logo"
```

---

## Task 9: Documentation rebrand

Covers Group J from the spec.

**Files:**
- Modify: `README.md` (root)
- Modify: `client/README.md`
- Modify: `server/README.md`
- Modify: `contracts/README.md`
- Modify: `PRD.md`
- Modify: `walkthrough.md`
- Modify: `.env.example` (root) — product-name comment only (line 2)
- Modify: `client/src/components/landing/Footer.tsx` (GitHub URL)

**Rule:** rename `ChainPass` → `Hoppr` wherever it refers to the product/org. **Keep** references to specific Solidity artifacts: `ChainPassTicket`, `DeployChainPass.s.sol`, `contracts/src/ChainPassTicket.sol`, `contracts/test/ChainPassTicket.t.sol`.

- [ ] **Step 1: Root README**

Open `README.md`. Rename `ChainPass` → `Hoppr` where it refers to the product — e.g. the `# ChainPass` heading becomes `# Hoppr`, `git clone <your-repo-url> chainpass` becomes `git clone <your-repo-url> hoppr`, `cd chainpass` becomes `cd hoppr`.

Preserve references to:
- `ChainPassTicket` — the Solidity contract name (lines 13, 22, 26, 166).
- `VITE_CHAINPASS_CONTRACT_ADDRESS` / `VITE_CHAINPASS_API_URL` — **these have already been renamed in Task 2 to `VITE_HOPPR_*`**; update the README lines to match (lines 26, 167).
- `@chainpass/shared` — **already renamed in Task 1 to `@hoppr/shared`**; update the README line (line 182).

- [ ] **Step 2: client/README.md**

Same rules. The `VITE_CHAINPASS_API_URL` reference on line 47 must become `VITE_HOPPR_API_URL`. The `ChainPassTicket` deployment reference on line 13 stays.

- [ ] **Step 3: server/README.md**

Apply the same rules. The several `@chainpass/*` package filter refs (`@chainpass/api`, `@chainpass/indexer`, `@chainpass/shared`) become `@hoppr/*`. The `ChainPassTicket` contract references stay. The `chainPassTicketAbi` export reference stays.

- [ ] **Step 4: contracts/README.md**

This README describes the Solidity artifacts themselves. The contract class name `ChainPassTicket` and file names `ChainPassTicket.sol` / `DeployChainPass.s.sol` stay. Only rename generic product mentions like "the ChainPass app" → "the Hoppr app".

- [ ] **Step 5: PRD.md and walkthrough.md**

Open both. Rename `ChainPass` → `Hoppr` throughout, except in references to the Solidity artifacts listed above.

- [ ] **Step 6: Update `.env.example` product-name comment**

In `.env.example` (root) line 2:
```
# ChainPass — copy to `.env` at this repo root for local dev / reference for deploy
```
becomes:
```
# Hoppr — copy to `.env` at this repo root for local dev / reference for deploy
```

(Lines 38 and 54, which describe the `ChainPassTicket` contract and `DeployChainPass.s.sol` script, stay — artifact names.)

- [ ] **Step 7: Update GitHub URL in Footer**

In `client/src/components/landing/Footer.tsx:4`:
```typescript
{ href: "https://github.com/cybort360/chainpass", label: "GitHub" },
```
becomes:
```typescript
{ href: "https://github.com/cybort360/hoppr", label: "GitHub" },
```
(If the repo has not yet been renamed on GitHub at execution time, GitHub will auto-redirect from `/chainpass` to `/hoppr` once the rename happens. Either way, the new URL is the correct one to ship.)

- [ ] **Step 8: Verify client builds**

Run: `pnpm --filter client build`
Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add README.md client/README.md server/README.md contracts/README.md PRD.md walkthrough.md .env.example client/src/components/landing/Footer.tsx
git commit -m "docs: rebrand ChainPass → Hoppr across READMEs, PRD, walkthrough"
```

---

## Task 10: Final verification gate

Not a commit-producing task — this is the pre-merge gate. Runs the full verification suite defined in the spec and the residual-reference scan.

- [ ] **Step 1: Clean install**

Run:
```
pnpm install
```
Expected: no errors; lockfile resolves cleanly with `@hoppr/*` scope.

- [ ] **Step 2: Full build pass**

Run:
```
pnpm --filter @hoppr/shared build
pnpm --filter client build
```
Expected: both exit 0.

- [ ] **Step 3: Full test suite**

Run:
```
pnpm --filter @hoppr/api test
pnpm --filter @hoppr/indexer test
```
Expected: 70/70 API + 7/7 indexer.

- [ ] **Step 4: Greenfield DB reset + dev smoke**

Run:
```
docker compose down -v
docker compose up -d postgres
pnpm --filter @hoppr/api run seed:route-labels
pnpm dev
```
Expected: API boots on port 3001, indexer runs, client dev server on 5173.

In the browser:
- Landing page loads with Hoppr wordmark in header and footer.
- `/operators` shows one operator card: `Hoppr Transit`.
- Clicking into it routes to `/operators/hoppr-transit` and renders any seeded routes (or the empty state).
- Purchase flow reaches the smart-contract call on Monad testnet (the on-chain target is still `ChainPassTicket` — the UI should consistently say "Hoppr" but the deployed contract address is unchanged).
- Browser tab icon is the new Hoppr favicon.

- [ ] **Step 5: Residual-reference scan**

Run (from repo root):
```
grep -r -i chainpass --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.pnpm --exclude-dir=.turbo .
```

Every remaining hit must be one of these **allowed exceptions**:
- Any file under `contracts/` (untouched).
- The literal `"chainpass:route:v1:"` in `shared/src/routeId.ts` (two occurrences, lines 20 and 31).
- The identifier `chainPassTicketAbi` and the filenames `chainPassTicketAbi.ts` / `chainPassTicket.json` under `shared/src/abis/`.
- References to the above inside `server/README.md`, `contracts/README.md`, or `.env.example` (if they describe the contract artifact).
- Historical occurrences inside `docs/superpowers/specs/2026-04-18-rider-marketplace-front-door-design.md` (prior spec — not a rebrand target).
- Historical occurrences inside `docs/superpowers/plans/2026-04-18-rider-marketplace-front-door.md` (prior plan — not a rebrand target).
- Historical commit messages (grep may show nothing under `.git`, but if any staged hunks appear, they're fine).

If any hit exists outside that list, return to the task that should have covered it and fix.

- [ ] **Step 6: Push the branch and open a PR**

Run:
```
git push -u origin feat/hoppr-rebrand
gh pr create --title "Rebrand ChainPass → Hoppr" --body "$(cat <<'EOF'
## Summary
- Rename every user-visible and developer-visible occurrence of ChainPass to Hoppr.
- Smart contract (\`ChainPassTicket.sol\`) and its ABI identifier are intentionally left unchanged — the deployed address and the hash-input string literal used to derive on-chain routeIds stay as-is.
- Greenfield migration — no backward-compat shims for env vars, DB names, or localStorage keys.

## Breaking for local dev environments — run before pulling and working

\`\`\`
docker compose down -v   # drops old chainpass db + volumes
pnpm install             # regenerates lockfile with @hoppr/* scope
docker compose up -d postgres
pnpm --filter @hoppr/api run seed:route-labels
\`\`\`

Also update your local \`.env\` files — rename \`VITE_CHAINPASS_*\` keys to \`VITE_HOPPR_*\`, update any \`DATABASE_URL\` that points to the old \`chainpass\` DB name.

## Design + plan
- Spec: \`docs/superpowers/specs/2026-04-19-hoppr-rebrand-design.md\`
- Plan: \`docs/superpowers/plans/2026-04-19-hoppr-rebrand.md\`

## Test plan
- [x] \`pnpm install\` resolves cleanly
- [x] \`pnpm --filter client build\` passes
- [x] \`pnpm --filter @hoppr/api test\` — 70/70
- [x] \`pnpm --filter @hoppr/indexer test\` — 7/7
- [x] Greenfield DB reset + dev smoke: landing wordmark, /operators shows Hoppr Transit, purchase flow reaches contract call
- [x] Residual-reference scan: only allowed exceptions remain (contracts/, hash-input literal, ABI identifier)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR created. Paste the URL for the owner.

---

## Owner follow-ups (outside the PR)

Not steps in the plan — reminders for the owner:

- Optionally rename `cybort360/chainpass` → `cybort360/hoppr` on GitHub. GitHub auto-redirects old URLs, so this is low-urgency and does not block the PR.
- After the rename: `git remote set-url origin git@github.com:cybort360/hoppr.git`.
- Optionally rename the local repo directory (`~/Desktop/chainpass` → `~/Desktop/hoppr`). Breaks existing worktrees and IDE workspaces — deferred to owner's preference.
