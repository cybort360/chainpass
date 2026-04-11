# ChainPass — full project walkthrough

Use this doc to **understand the system**, **run everything locally**, **run automated tests**, and **deploy to production**. Deeper product detail lives in [`PRD.md`](./PRD.md); env keys are summarized in [`.env.example`](./.env.example).

---

## 1. What you’re testing (mental model)

ChainPass is **on-chain transit ticketing on Monad**:

| Piece | Role |
|--------|------|
| **Smart contract** (`ChainPassTicket`) | ERC-721 tickets; **`purchaseTicket`** (pay MON); **`burnTicket`** at the gate; fares enforced on-chain. Exposes **`totalMinted`** and **`totalBurned`** (lifetime counts for **this** deployment). |
| **API** (`server/api`) | Signs **short-lived QR payloads** (HMAC) and serves **operator stats / route labels** from Postgres when the DB is configured. |
| **Indexer** (`server/indexer`) | Optional for headline totals: listens for **`TicketMinted` / `TicketBurned`** and writes **`ticket_events`** for **event feeds** and **time-windowed** stats (e.g. last 24h). |
| **Client** (`client`, Vite + React) | Wallet UX: browse routes, buy pass, show QR, conductor/operator screens. |

**Security split:** QR signatures prove freshness off-chain; the **contract** enforces **`ownerOf`**, route, expiry, and **burn** (single-use).

```mermaid
flowchart LR
  subgraph browser [Browser]
    UI[Vite SPA]
  end
  subgraph chain [Monad]
    SC[ChainPassTicket]
  end
  subgraph backend [Your infra]
    API[Express API]
    IDX[Indexer worker]
    PG[(PostgreSQL)]
  end
  UI -->|HTTPS JSON| API
  UI -->|wagmi / viem| SC
  API --> PG
  IDX -->|RPC logs| SC
  IDX --> PG
```

---

## 2. Prerequisites

| Tool | Why |
|------|-----|
| **Node.js ≥ 20** | Monorepo + Vite client + servers |
| **pnpm** (see root `packageManager`) | Workspace installs |
| **Foundry** (`forge`, `cast`) | Build/test/deploy contracts |
| **Docker** (optional) | Local Postgres via [`tooling/docker-compose.yml`](./tooling/docker-compose.yml) |

---

## 3. One-time setup

### 3.1 Clone and install

```bash
git clone <repo-url> chainpass
cd chainpass
pnpm install
```

### 3.2 Environment

```bash
cp .env.example .env
```

Edit **`.env` at the repo root** (API, indexer, and client tooling load from here or mirror values per service). Minimum for a **full local test**:

| Variable | Purpose |
|----------|---------|
| `VITE_PRIVY_APP_ID` (in **`client/.env`**) | From [Privy Dashboard](https://dashboard.privy.io) — add **`http://localhost:5173`** and any LAN/production origins. |
| `VITE_CHAINPASS_API_URL` (in **`client/.env`**) | Local: `http://localhost:3001` |
| `VITE_CHAINPASS_CONTRACT_ADDRESS` (in **`client/.env`**) | Deployed `ChainPassTicket` address (see §5), same as **`TICKET_CONTRACT_ADDRESS`** at root |
| `TICKET_CONTRACT_ADDRESS` | Same as above (indexer) |
| `QR_SIGNING_SECRET` | Long random string (QR HMAC) |
| `DATABASE_URL` | Postgres URL (see §4) |
| `RPC_URL` | Default testnet: `https://testnet-rpc.monad.xyz` |

Never commit real private keys or production secrets.

### 3.3 Contracts toolchain

`contracts/lib/` is gitignored. From repo root:

```bash
cd contracts
forge install --no-git foundry-rs/forge-std
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.2.0
forge build
forge test
cd ..
```

### 3.4 Shared package

The client and servers import **`@chainpass/shared`**. After clone, `pnpm install` builds workspaces; if you change `shared/`, rebuild:

```bash
pnpm --filter @chainpass/shared run build
```

---

## 4. Local infrastructure (Postgres)

**Optional but recommended** if you want operator events, stats, and route labels end-to-end.

```bash
docker compose -f tooling/docker-compose.yml up -d
```

Default URL (matches `.env.example`):

`postgresql://postgres:postgres@localhost:5432/chainpass`

**Seed route labels** (optional, for `GET /api/v1/routes`):

```bash
pnpm --filter @chainpass/api run seed:route-labels
```

---

## 5. Deploy contract (Monad testnet)

You need a funded testnet account and **`PRIVATE_KEY`** (never commit it).

```bash
cd contracts
export PRIVATE_KEY=0x...   # your deployer key
# Optional: METADATA_BASE_URI, TREASURY_ADDRESS, MINT_PRICE_WEI, MINTER_ADDRESS, BURNER_ADDRESS
forge script script/DeployChainPass.s.sol:DeployChainPass \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast
```

Copy the logged **`ChainPassTicket`** address into **root `.env`**:

- `TICKET_CONTRACT_ADDRESS`
- `VITE_CHAINPASS_CONTRACT_ADDRESS` in **`client/.env`**

Set **`INDEXER_FROM_BLOCK`** to the **deployment block** of that address (or the block logged by the deploy script). If you **redeploy** a new contract, counters and indexed events apply only from the new address — update env vars and clear old rows, e.g. **`pnpm --filter @chainpass/indexer run db:clear-ticket-events`**, then set **`INDEXER_FROM_BLOCK`** to the new deployment block.

Get testnet MON from the [Monad testnet faucet](https://docs.monad.xyz) as needed.

### 5.1 Push per-route fares from `config/nigeria-routes.json` (optional)

After deploy, the deployer ( **`DEFAULT_ADMIN_ROLE`** ) can set each route’s minimum wei on-chain to match the JSON. From the **repo root**:

```bash
DRY_RUN=1 pnpm sync-route-prices   # preview only
export PRIVATE_KEY=0x...             # same admin key as deployer
export TICKET_CONTRACT_ADDRESS=0x... # deployed contract
pnpm sync-route-prices
```

Details: [`config/README.md`](./config/README.md). This is separate from **`seed:route-labels`** (Postgres labels only).

---

## 6. Run the full stack locally

**Recommended order** the first time:

1. Postgres running (§4) and `DATABASE_URL` set.
2. Contract deployed (§5) and addresses in `.env`.
3. From **repository root**:

```bash
pnpm dev
```

This runs **client**, **API**, and **indexer** in parallel (see root [`package.json`](./package.json)).

| Service | URL / check |
|---------|-------------|
| **Client** | [http://localhost:5173](http://localhost:5173) |
| **API health** | [http://localhost:3001/health](http://localhost:3001/health) |
| **Indexer** | Watch terminal logs (polls chain → writes DB) |

**Run one service only:**

```bash
pnpm dev:client
pnpm dev:api
pnpm dev:indexer
```

### 6.1 If the client acts broken after bad saves

If the Vite client acts broken after bad saves or cache issues, from **`client/`**:

```bash
rm -rf node_modules/.vite dist
pnpm dev
```

(Hard-refresh the browser. This project uses **Vite**, not Next.js `.next`.)

### 6.2 Quick manual API checks

```bash
curl -s http://localhost:3001/health
curl -s -X POST http://localhost:3001/api/v1/qr/payload \
  -H "Content-Type: application/json" \
  -d '{"tokenId":"1","holder":"0x0000000000000000000000000000000000000001"}'
```

Operator endpoints (**`/api/v1/operator/*`**) need **`DATABASE_URL`** and (for non-empty data) the **indexer** having written **`ticket_events`**. **`totalMinted` / `totalBurned`** are read directly from the contract (e.g. cast or client) if you skip the indexer.

```bash
curl -s http://localhost:3001/api/v1/operator/events
curl -s http://localhost:3001/api/v1/operator/stats
curl -s http://localhost:3001/api/v1/routes
```

---

## 7. Automated tests

From **repo root**:

```bash
pnpm test
```

Runs **API** (Vitest + supertest) and **indexer** (Vitest) tests. **Contracts:** `cd contracts && forge test`.

**Client lint** (not in `pnpm test` yet):

```bash
pnpm --filter client lint
```

**Production-style build** (all workspaces that define `build`):

```bash
pnpm build
```

---

## 8. Deploy to production

There is no single “Deploy” button for the whole monorepo: you deploy **three moving parts** (client, API, indexer) plus **Postgres**, and point them at the **same chain** and **same contract address**.

### 8.1 Environment (all hosts)

Mirror the root [`.env.example`](./.env.example) in each platform’s secret UI:

- **Postgres:** `DATABASE_URL` (often `?sslmode=require` on managed DBs).
- **Chain:** `RPC_URL`, `TICKET_CONTRACT_ADDRESS`; mirror contract address as **`VITE_CHAINPASS_CONTRACT_ADDRESS`** on the client host.
- **Client (`client/.env` → host env):** `VITE_PRIVY_APP_ID`, `VITE_CHAINPASS_API_URL` = **public HTTPS base URL of your API** (no trailing slash).
- **API:** `PORT`, `QR_SIGNING_SECRET`, `QR_TTL_SECONDS`, `DATABASE_URL`.
- **Indexer:** same `DATABASE_URL`, `TICKET_CONTRACT_ADDRESS`, `INDEXER_*` tuning.
- **Privy:** same **`VITE_PRIVY_APP_ID`**; in the dashboard add **every production origin** (e.g. `https://your-app.vercel.app`) under allowed origins.

### 8.2 CORS (required for browser → API)

The API [`server/api/src/app.ts`](./server/api/src/app.ts) allowlists **localhost** origins only. For production, **add your real frontend origin** (e.g. `https://your-domain.com`) to the `cors({ origin: [...] })` list and redeploy the API. Without this, the browser will block requests from your deployed client.

### 8.3 Typical hosting split

| Artifact | Common choice |
|----------|----------------|
| **Vite SPA (`client/`)** | Vercel (see root **`README.md`** → *Client on Vercel*), Netlify, Cloudflare Pages |
| **Express API** | Railway, Fly.io, Render, AWS, etc. |
| **Indexer** | Same VM/process as API or a separate worker (long-running Node) |
| **Postgres** | Supabase, Neon, RDS, Railway Postgres, etc. |

**Build commands** (adjust for your host):

- Client: `pnpm --filter client build` → static output **`client/dist`** (see root **`scripts/vercel-build.mjs`** for Vercel).
- API: `pnpm --filter @chainpass/api build` → run compiled `dist` with `node` (see `server/api/package.json`).
- Indexer: `pnpm --filter @chainpass/indexer build` → run worker `start`.

Set each service’s **environment variables** in the host dashboard; do not commit secrets.

### 8.4 Smoke test after deploy

1. Open production site → connect wallet (check **Privy** allowed origins if the modal fails to load).
2. `GET https://your-api/health`
3. Mint/burn flows against **production** RPC + **deployed** contract address.

---

## 9. Where to read more

| Doc | Content |
|-----|---------|
| [`README.md`](./README.md) | Stack table, quick start, production checklist |
| [`PRD.md`](./PRD.md) | Product requirements |
| [`contracts/README.md`](./contracts/README.md) | Contract API, deploy env vars |
| [`server/README.md`](./server/README.md) | API routes, DB schema, curl examples |
| [`config/README.md`](./config/README.md) | Static route samples; **`pnpm sync-route-prices`** (on-chain fares from JSON) |

---

## 10. Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Stale **Vite** chunks / odd UI | Stop dev, delete `client/node_modules/.vite` and `client/dist`, run `pnpm dev` again, hard-refresh |
| **Privy / wallet** oddities | Confirm **`VITE_PRIVY_APP_ID`** and dashboard **allowed origins**; full browser refresh or try incognito |
| Indexer exits immediately | Set `DATABASE_URL` and valid `TICKET_CONTRACT_ADDRESS` |
| Operator API **503** | `DATABASE_URL` missing or DB down |
| **CORS** errors from deployed site | Add production origin to API CORS (§8.2) |

---

*Last aligned with repo layout: monorepo `pnpm dev`, root `.env`, Foundry deploy script `DeployChainPass.s.sol`, on-chain `totalMinted` / `totalBurned`.*
