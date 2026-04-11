# ChainPass

On-chain transit ticketing on **Monad**: NFT tickets, short-lived QR codes, scan-to-verify, burn on use. See [`PRD.md`](./PRD.md) for product scope.

### Security model (MVP)

- **QR:** Backend **HMAC** over `tokenId`, **holder** address, and **exp** (short TTL).  
- **Burn:** The contract requires **`ownerOf(tokenId)`** to match **`expectedHolder`** from the signed QR, plus route and expiry checks on-chain. Off-chain JSON at **`tokenURI`** is for **display** only (same trust model as typical NFT marketplaces); **enforcement** uses chain state + QR.  
- **Single-use** means **burn** — there is no separate on-chain “used” flag.

### Ticket pricing (on-chain)

Fares are **not** configured in the Node API. The **`ChainPassTicket`** contract enforces the minimum **native MON** sent with **`purchaseTicket`**:

- **`mintPriceWei`** — global **default** minimum (set at deploy via **`MINT_PRICE_WEI`**, updatable with **`setMintPriceWei`**).
- **`routeMintPriceWei[routeId]`** — optional **per-route** override; if **non-zero**, it replaces the default for that **`routeId`**. **`setRouteMintPrice(routeId, wei)`** (admin) clears the override when **`wei` is 0** (route falls back to **`mintPriceWei`**). Emits **`RoutePriceSet`**.

Details and deploy env vars: [`contracts/README.md`](./contracts/README.md).

### Operator analytics (chain vs indexer)

**`ChainPassTicket`** exposes **`totalMinted`** and **`totalBurned`** — cheap **`view`** reads for **lifetime** counts **since that contract deployment** (not retroactive to a previous address).

The **indexer** (`server/indexer`) plus **PostgreSQL** are still the right layer for a **scrollable event feed** (`TicketMinted` / `TicketBurned` rows) and **time-bucketed** aggregates (e.g. **last 24 hours** in `/api/v1/operator/stats`). If you skip the indexer, you can still show headline totals via **wagmi/viem** against the deployed contract; you lose the DB-backed feed and rolling windows unless you add another approach (e.g. `eth_getLogs`).

**Redeploying the contract:** Treat it as a **new deployment** — update **`TICKET_CONTRACT_ADDRESS`**, mirror **`VITE_CHAINPASS_CONTRACT_ADDRESS`** in **`client/.env`**, set **`INDEXER_FROM_BLOCK`** to the new deployment block, and reset or re-backfill **`ticket_events`** so Postgres does not mix old and new addresses.

### Why Monad (for this app)

ChainPass is built for **gate-like validation**: many passengers can show a fresh QR and conductors can confirm tickets **on-chain** without long waits. **Monad** fits that story because of **high throughput**, **low fees** on small-value txs, **fast finality** (~800ms target) for a snappy “scan → burn” demo, and **full EVM compatibility** so we use standard **ERC-721**, **Foundry**, **Privy**, **wagmi/viem** without a custom VM. The network also supports **`eth_sendRawTransactionSync`**-style flows where the stack exposes them, which helps keep **purchase / burn** feedback tight in the UI. See [Monad documentation](https://docs.monad.xyz/) for the latest network details.

### Canonical addresses & verification

Before relying on **any** third-party or ecosystem contract address (WMON, Multicall3, etc.), **verify on-chain** that bytecode exists at that address on Monad testnet, e.g.:

```bash
cast code <addr> --rpc-url https://testnet-rpc.monad.xyz
```

Official testnet metadata (RPC, explorers, canonical contracts) is listed in [Monad testnets](https://docs.monad.xyz/developer-essentials/testnets). The [`docs/MONSKILLS.md`](./docs/MONSKILLS.md) **`addresses/`** skill lists common addresses—**never** guess addresses.

## Stack

| Layer | Technology |
|-------|------------|
| **Contracts** | Solidity + Foundry |
| **Server** | **Node.js + TypeScript** — [`server/api/`](./server/api/) (Express HTTP) and [`server/indexer/`](./server/indexer/) (event listener + PostgreSQL). See [`server/README.md`](./server/README.md). |
| **Client** | **Vite** + React + TypeScript + **Privy** (`@privy-io/react-auth`, `@privy-io/wagmi`) + wagmi / viem — see [`client/README.md`](./client/README.md) |

## Repo layout

| Path | Role |
|------|------|
| [`contracts/`](./contracts/) | Solidity + Foundry — see [`contracts/README.md`](./contracts/README.md) |
| [`client/`](./client/) | Vite + React SPA (passenger / conductor / operator UI per PRD) |
| [`server/api/`](./server/api/) | Node/TS — HTTP API (Express): QR signing, operator reads |
| [`server/indexer/`](./server/indexer/) | Node/TS — optional chain event listener → PostgreSQL (feed + rolling stats; lifetime totals also on-chain) |
| [`shared/`](./shared/) | Shared TS types / ABIs (wire `client` + `server`) |
| [`config/`](./config/) | Optional static route/fare samples (e.g. [`config/nigeria-routes.json`](./config/nigeria-routes.json)) — not loaded by chain; human-readable labels can be seeded into Postgres and read via **`GET /api/v1/routes`** (see [`server/README.md`](./server/README.md)); see [`config/README.md`](./config/README.md) |

---

## Getting started (new machine / another developer)

### 1. Prerequisites

| Tool | Notes |
|------|--------|
| **Git** | Clone this repository. |
| **Node.js** | **v20 or newer** ([nodejs.org](https://nodejs.org/) or `nvm`). |
| **pnpm** | Match root **`packageManager`** (see root `package.json`, e.g. `pnpm@10.6.5`). Install via [Corepack](https://nodejs.org/api/corepack.html) or [pnpm.io/installation](https://pnpm.io/installation). You can also run `npx pnpm@<version> …` without a global install. |
| **Foundry** | For `contracts/`: install via [foundryup](https://book.getfoundry.sh/getting-started/installation). Add `~/.foundry/bin` (macOS/Linux) or `%USERPROFILE%\.foundry\bin` (Windows) to your **PATH**, then open a new terminal and run `forge --version`. |
| **Docker** | Optional — only if you want local PostgreSQL using [`tooling/docker-compose.yml`](./tooling/docker-compose.yml). |

### 2. Clone and install JavaScript dependencies

```bash
git clone <your-repo-url> chainpass
cd chainpass
pnpm install
```

If `pnpm` is not on your PATH:

```bash
npx pnpm@10 install
```

### 3. Environment file

Copy the root example env and edit values as needed (RPC URL, `DATABASE_URL`, ports, deploy keys):

```bash
cp .env.example .env
```

Smaller templates for specific apps (useful when deploying each service separately): [`client/.env.example`](./client/.env.example) (Vite), [`contracts/.env.example`](./contracts/.env.example) (Foundry), [`server/api/.env.example`](./server/api/.env.example), [`server/indexer/.env.example`](./server/indexer/.env.example).

### 4. PostgreSQL (optional)

For the indexer against a local database:

```bash
docker compose -f tooling/docker-compose.yml up -d
```

### 5. Smart contracts (Foundry)

`contracts/lib/` is **gitignored** (like `node_modules`). Install dependencies, then build:

```bash
cd contracts
forge install --no-git foundry-rs/forge-std
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.2.0
forge build
cd ..
```

See [`contracts/README.md`](./contracts/README.md) for why and for alternatives (e.g. committing `lib/` if you need that).

### 6. Sync per-route fares from `config/nigeria-routes.json` (optional)

After deploy, you can push **`priceWei`** values to the contract with the root script (admin key; one **`setRouteMintPrice`** tx per route). See [`config/README.md`](./config/README.md) (`pnpm sync-route-prices`, **`DRY_RUN=1`** to preview).

### 7. Run the app

From the **repository root**:

```bash
pnpm dev
```

This runs the **client**, **API**, and **indexer** in parallel.

| Service | URL / check |
|---------|----------------|
| Client (Vite) | [http://localhost:5173](http://localhost:5173) |
| API (Express) | [http://localhost:3001/health](http://localhost:3001/health) |
| Indexer | Logs in the terminal (writes `ticket_events` when Postgres + contract address are set) |

**Run one service only:**

```bash
pnpm dev:client
pnpm dev:api
pnpm dev:indexer
```

**Production-style build:**

```bash
pnpm build
```

**Testing:** Root `pnpm test` runs **API** and **indexer** suites. **Client** lint is not included in that command yet; run `pnpm --filter client lint` when working on the client (add `client` to the root test pipeline when the UI stabilizes).

---

## Production deployment checklist

Use this before tagging a release or wiring **Vercel / Railway / Fly** (or similar). Copy [`.env.example`](./.env.example) and set real values in each host’s environment UI (never commit secrets).

| Area | What to verify |
|------|----------------|
| **Postgres** | **`DATABASE_URL`** (e.g. Supabase) with **`?sslmode=require`** if required. API + indexer + `seed:route-labels` use the same DB. |
| **Chain** | **`RPC_URL`**, **`TICKET_CONTRACT_ADDRESS`** (deployed `ChainPassTicket` on Monad testnet/mainnet as applicable). |
| **Client (`VITE_*` in `client/.env`)** | **`VITE_PRIVY_APP_ID`** — from [Privy Dashboard](https://dashboard.privy.io); add **allowed origins** (local, LAN, production). **`VITE_CHAINPASS_CONTRACT_ADDRESS`** — same as **`TICKET_CONTRACT_ADDRESS`**. **`VITE_CHAINPASS_API_URL`** — public HTTPS URL of your API (no trailing slash). |
| **API** | **`PORT`**, **`QR_SIGNING_SECRET`**, **`QR_TTL_SECONDS`**. |
| **Indexer** | **`INDEXER_FROM_BLOCK`**, **`INDEXER_POLL_MS`**, **`INDEXER_BLOCK_CHUNK`** as needed. After a **new contract deploy**, clear **`ticket_events`** and set **`INDEXER_FROM_BLOCK`** to the new deployment block (see **`walkthrough.md`**). |
| **Privy** | Wallet UX and optional WalletConnect-style flows are handled **inside Privy** (no app-level Reown/WalletConnect project ID). Configure **login methods** and **allowed origins** in the dashboard; client config is in [`client/src/config/privy.ts`](./client/src/config/privy.ts). |
| **Build** | From repo root: **`pnpm build`**. Deploy **`server/api`** and **`server/indexer`** on your host; the **static client** is usually built from the monorepo root for Vercel (see below). |
| **Design** | UI tokens and landing reference: [`docs/Design.md`](./docs/Design.md). |

### Client on Vercel (static SPA)

The app is a **pnpm workspace** with a root **`pnpm-lock.yaml`**. Deploy the **Git repository root** (not only `client/`) so install runs against the whole workspace.

| Topic | Detail |
|--------|--------|
| **Root Directory** | Leave **empty** (repository root). If you instead set Root Directory to **`client`**, Vercel only reads **`client/vercel.json`** — this repo duplicates the full **`vercel.json`** into **`client/vercel.json`** so either layout gets the same **install / build / output / SPA rewrites**. |
| **Install / pnpm** | Root config runs **npx** with the **pnpm** version pinned in root **`packageManager`**, plus a small lockfile normalize script — avoids “incompatible lockfile” when the builder’s default pnpm differs. |
| **Build** | **`scripts/vercel-build.mjs`** builds **`@chainpass/shared`** and **`client`**, then copies **`client/dist`** → root **`dist/`** for Vercel’s output directory. |
| **Deep links** | **`rewrites`** send unknown paths to **`index.html`** so React Router routes (e.g. `/conductor`) work on refresh. |

Conductor **QR scanning** (camera vs **Upload QR photo**) is documented in [`client/README.md`](./client/README.md).

**Landing layout (why it looked “squished”):** The marketing page is only as tall as its content unless you give it a minimum height. The shell was full viewport height, so short content left a big empty band under the footer. The client fixes this with `.landing-page` (`min-height` under the header), a flex column, `.hero-section` with `flex: 1` and `justify-content: center`, and `.landing-footer` with `margin-top: auto` so the hero uses the middle of the screen instead of hugging the top.

**Connect styling:** Header **Connect** / wallet chip use the Monad purple gradient (`btn-primary-gradient` + `walletPurpleBtn` in `client/src/layouts/AppLayout.tsx`). Privy modal accent matches **`accentColor`** in [`client/src/config/privy.ts`](./client/src/config/privy.ts).

---

## Docs

- [`PRD.md`](./PRD.md) — requirements (§8.4 indexing vs on-chain counters)  
- [`walkthrough.md`](./walkthrough.md) — local run, contract deploy, env after redeploy  
- [`client/README.md`](./client/README.md) — Vite dev URL, **Vercel** deploy notes, **conductor QR** (iOS vs Android)  
- [`config/README.md`](./config/README.md) — `nigeria-routes.json`; **`pnpm sync-route-prices`** (on-chain per-route fares)  
- [`docs/MONSKILLS.md`](./docs/MONSKILLS.md) — Monad agent skills (optional)  

## License

MIT
