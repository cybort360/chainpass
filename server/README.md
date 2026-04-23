# Server (Node.js + TypeScript)

This folder implements the **Hoppr backend**: an **Express API** for signed QR payloads and operator reads, plus an optional **viem + PostgreSQL indexer** that ingests **`ChainPassTicket`** contract events (`TicketMinted`, `TicketBurned`). **Lifetime** mint and burn **counts** are also available **on-chain** as **`totalMinted()`** and **`totalBurned()`** — no DB required for those two values. **Ticket fares** are enforced **only on-chain** (`purchaseTicket`, **`mintPriceWei`** / **`routeMintPriceWei`**); this server does not store or validate prices. Shared ABI and Monad testnet chain config live in **`@hoppr/shared`** (see repo root `shared/`).

| Package | Role | Stack |
|---------|------|--------|
| **`api/`** | HTTP: health, QR signing, operator events + stats from DB | [Express](https://expressjs.com/), `pg`, `viem`, `@hoppr/shared` |
| **`indexer/`** | Worker: RPC → decode logs → upsert `ticket_events` | `viem`, `pg`, `@hoppr/shared` — **no HTTP** |

Both packages load `.env` from the monorepo root when present (`load-env.ts`).

### How the backend works

The backend has two parts: an **API** that signs short-lived QR payloads and serves operator data (from Postgres when configured), and an **indexer** that listens to contract events and stores them in Postgres for **feeds** and **last-24h-style** aggregates. **Validation is hybrid** — the backend verifies QR freshness (HMAC + TTL via `/api/v1/qr/payload` and `/api/v1/qr/verify`), while the **contract** enforces ticket validity and single-use via **burn**.

---

## What is implemented

### API (`server/api`)

- **`GET /health`** — Liveness JSON: `ok`, `service`, `stack`, `runtime`, `shared` (version from `@hoppr/shared`).
- **`POST /api/v1/qr/payload`** — Body JSON: **`tokenId`** (number or string, parsed as integer), **`holder`** (checksummed `0x` address via `viem` `isAddress`). Returns **`{ tokenId, holder, exp, signature }`** where **`exp`** is Unix seconds and **`signature`** is **HMAC-SHA256** (hex) over the canonical string **`tokenId|holderLowercase|exp`**, keyed by **`QR_SIGNING_SECRET`**. TTL from **`QR_TTL_SECONDS`** (default **30**; must be **1–3600** or the server returns **500**). The validator should pass **`holder`** from this payload as **`expectedHolder`** in **`burnTicket`** so it matches **`ownerOf(tokenId)`** on-chain.
- **`POST /api/v1/qr/verify`** — Body JSON: **`tokenId`**, **`holder`**, **`exp`**, **`signature`** (same shape as **`/payload`**). Recomputes the HMAC and checks **`exp`** (Unix seconds). Responds **`200`** with **`{ valid: true }` or `{ valid: false }`**; **400** for malformed input (e.g. missing fields, invalid address, non-integer **`exp`**); **500** if **`QR_SIGNING_SECRET`** is unset. Clients can call **`/verify`** for optional server-side confirmation before submitting the burn on-chain; it is not required if the client already trusts the signed payload.
- **`GET /api/v1/operator/events`** — Reads up to **500** rows from **`ticket_events`**, newest first. Returns **`{ events: [...] }`**. **503** if **`DATABASE_URL`** is unset; **500** on query failure. Empty or partial history if the indexer was offline or **`INDEXER_FROM_BLOCK`** was set wrong after a **new contract deploy**.
- **`GET /api/v1/operator/stats`** — Aggregate endpoint: **`{ totals: { mint, burn }, last24h: { mint, burn } }`** from **`ticket_events`** (`created_at` for last 24h window). **503** if **`DATABASE_URL`** is unset; **500** on query failure. **Note:** DB **totals** match on-chain **`totalMinted` / `totalBurned`** only when the table has indexed **all** events for the current contract from deployment; otherwise prefer **chain reads** for headline lifetime counts.
- **`GET /api/v1/routes`** — Human-readable **route labels** keyed by on-chain **`routeId`**: **`{ routes: [{ routeId, name, detail }] }`** from Postgres table **`route_labels`**, ordered by **`route_id`**. **Fares remain on-chain** (`routeMintPriceWei` / `mintPriceWei`); combine this response with contract reads for wei. **503** if **`DATABASE_URL`** is unset; **500** on query failure; **200** with **`routes: []`** if the table is empty.
- **CORS** for `http://localhost:5173`, `http://127.0.0.1:5173` (Vite client), and `http://localhost:3000` / `127.0.0.1:3000` if you proxy the app there, with credentials; **morgan** request logging; **JSON** body parser.

### Indexer (`server/indexer`)

- On startup, runs idempotent **`INIT_SQL`**: creates **`ticket_events`** and index on **`block_number`**, and **`route_labels`** (same DDL as the API), if missing.
- Requires **`DATABASE_URL`** and a valid **`TICKET_CONTRACT_ADDRESS`** (`0x` + 40 hex); exits if either is missing.
- Uses **`chainPassTicketAbi`** from **`@hoppr/shared`** and **`monadTestnet`** (chain id **10143**, default RPC **`RPC_URL`** or `https://testnet-rpc.monad.xyz`).
- Fetches **`TicketMinted`** and **`TicketBurned`** via viem **`getContractEvents`**, in ranges of at most **`INDEXER_BLOCK_CHUNK`** blocks (default **100**; Monad public RPC limits **`eth_getLogs`** to a **100-block** range, so larger env values are clamped), until caught up to chain head; then sleeps **`INDEXER_POLL_MS`** (default **4000**, minimum **500** enforced) and repeats.
- **Cursor**: if **`ticket_events` is empty**, starts from **`INDEXER_FROM_BLOCK`** (default **0**). Otherwise continues from **`max(block_number) + 1`**. Inserts use **`ON CONFLICT (tx_hash, log_index) DO NOTHING`** for idempotency.

### Database

#### `ticket_events`

| Column | Notes |
|--------|--------|
| `event_type` | `'mint'` or `'burn'` |
| `tx_hash`, `log_index` | Unique together (dedupe) |
| `block_number`, `block_hash`, `contract_address` | From the log |
| `token_id`, `route_id` | Text / optional |
| `valid_until_epoch`, `operator_addr` | Mint; burn may leave nulls as applicable |
| `from_address`, `to_address` | Burn: `from`; mint: `to` |
| `created_at` | Server default |

#### `route_labels`

| Column | Notes |
|--------|--------|
| `route_id` | **Primary key** — same integer as on-chain **`routeId`** |
| `name` | Short UI label |
| `detail` | Optional subtitle |
| `created_at` | Server default |

The API runs **`CREATE TABLE IF NOT EXISTS`** for **`route_labels`** on startup (when **`DATABASE_URL`** is set). Seed human-readable rows from [`config/nigeria-routes.json`](../config/nigeria-routes.json) (idempotent):

```bash
pnpm --filter @hoppr/api run seed:route-labels
```

(Run from repo root with **`DATABASE_URL`** set.)

**On-chain fares** for those same routes are **not** set by that seed. After deploy, push **`priceWei`** from [`config/nigeria-routes.json`](../config/nigeria-routes.json) to **`ChainPassTicket`** with the root script **`pnpm sync-route-prices`** (admin key; see [`config/README.md`](../config/README.md)).

---

## Environment variables

Copy **`.env.example`** at the repo root. Relevant keys:

| Variable | Used by | Purpose |
|----------|---------|---------|
| `RPC_URL` | Indexer | Monad testnet HTTP RPC |
| `DATABASE_URL` | API, Indexer | Postgres connection string |
| `PORT` | API | Listen port (default **3001**) |
| `QR_SIGNING_SECRET` | API | HMAC key for `/api/v1/qr/payload` and `/api/v1/qr/verify` |
| `QR_TTL_SECONDS` | API | Payload lifetime in seconds (default **30**) |
| `TICKET_CONTRACT_ADDRESS` | Indexer | Deployed `ChainPassTicket` address |
| `INDEXER_FROM_BLOCK` | Indexer | First block when table is empty |
| `INDEXER_POLL_MS` | Indexer | Sleep between catch-up passes |
| `INDEXER_BLOCK_CHUNK` | Indexer | Max block span per `getContractEvents` batch |

---

## Local Postgres

From repo root:

```bash
docker compose -f tooling/docker-compose.yml up -d
```

Default URL: `postgresql://postgres:postgres@localhost:5432/hoppr` (see `.env.example`).

---

## Build and run

From repo root (with [pnpm](https://pnpm.io/) and workspace installed):

```bash
pnpm -r run build
```

**Run order**

1. **Postgres** — ensure **`DATABASE_URL`** is set.
2. **Indexer** — `pnpm --filter @hoppr/indexer dev` (or `pnpm --filter @hoppr/indexer start` after build). Set **`TICKET_CONTRACT_ADDRESS`** to your deployed contract.
3. **API** — `pnpm --filter @hoppr/api dev`. Set **`QR_SIGNING_SECRET`** for QR; set **`DATABASE_URL`** for operator events.

---

## Testing

Backend tests use **[Vitest](https://vitest.dev/)**. The API suite uses **[supertest](https://github.com/ladjs/supertest)** against **`createApp()`** and mocks **`pg.Pool`** so operator routes do not need a real database. **`signQrPayload`** is covered with unit tests (HMAC verification). The indexer suite covers **`getIndexerConfig`** (env parsing) and **`INIT_SQL`** shape.

From repo root:

```bash
pnpm test
```

Per package:

```bash
pnpm --filter @hoppr/api test
pnpm --filter @hoppr/indexer test
```

Watch mode: `pnpm --filter @hoppr/api test:watch`.

---

## Example requests

Health:

```bash
curl -s http://localhost:3001/health
```

Signed QR payload (requires **`QR_SIGNING_SECRET`**):

```bash
curl -s -X POST http://localhost:3001/api/v1/qr/payload \
  -H "Content-Type: application/json" \
  -d '{"tokenId":"1","holder":"0x0000000000000000000000000000000000000001"}'
```

Verify a QR payload (same secret as signing; **200** with **`valid`** true or false):

```bash
curl -s -X POST http://localhost:3001/api/v1/qr/verify \
  -H "Content-Type: application/json" \
  -d '{"tokenId":"1","holder":"0x0000000000000000000000000000000000000001","exp":1234567890,"signature":"<64-char hex>"}'
```

Operator events (requires **`DATABASE_URL`** and rows written by the indexer):

```bash
curl -s http://localhost:3001/api/v1/operator/events
```

Operator stats (same DB requirement; separate endpoint):

```bash
curl -s http://localhost:3001/api/v1/operator/stats
```

Route labels (requires **`DATABASE_URL`** and rows in **`route_labels`**, e.g. after **`seed:route-labels`**):

```bash
curl -s http://localhost:3001/api/v1/routes
```
