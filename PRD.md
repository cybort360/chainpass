# ChainPass — Product Requirements Document (PRD)

**Version:** 0.5 (hackathon draft)  
**Last updated:** 2026-03-27  
**Source context:** `ChainPass_Hackathon_Proposal.docx`  
**Chain:** Monad (EVM)

---

## 1. Executive summary

**ChainPass** is an on-chain public transit ticketing product: passengers buy route-specific tickets in a mobile-first web app, receive an NFT-backed ticket, and present a **short-lived QR code** at entry. Validators scan the QR, confirm state on Monad, and **burn** the ticket to enforce **single use** (no separate “used” flag — **burn** is the only consumption). On Monad testnet, **native MON** can flow to a configured **treasury** on purchase. **Loyalty / points** are **out of scope** for this MVP.

This PRD refines the hackathon proposal into testable requirements, a realistic **MVP** versus **stretch** split, and a repo layout with **three top-level pillars**: **`contracts/`** (on-chain), **`server/`** (**Node.js + TypeScript** — API and indexer), and **`client/`** (Vite + React + TypeScript), plus optional **`shared/`** for generated ABIs and types. **Primary UI focus:** **`client/`** (transit-first layout, passenger vs conductor access) — see **§7.4**.

---

## 2. Problem statement

Public transit in many markets (including large African cities) still relies heavily on cash, physical cards, and paper tickets. That drives:

- Cash friction, disputes, and leakage  
- Poor interoperability across operators and modes  
- Fraud (counterfeits, informal “touting”)  
- Weak analytics for operators  
- No meaningful loyalty for frequent riders  

---

## 3. Product vision

Deliver a **passenger-facing** ticketing experience that feels like a normal transport app (wallet abstraction, fiat on-ramp where feasible), while **enforcing ticket validity** and **single use** on Monad via NFT mint → verify → burn.

**Tagline (from proposal):** Scan. Board. Done. Built on Monad.

---

## 4. Goals and non-goals

### 4.1 Goals (hackathon)

| Goal | Description |
|------|-------------|
| **G1** | Mint a unique, route-bound NFT ticket after payment (testnet). |
| **G2** | Show a QR that encodes enough data for validation and **expires quickly** (e.g. ~30s refresh) to limit screenshot reuse. |
| **G3** | Validator flow: scan → read chain state → **burn** on success; reject invalid/expired/wrong-route/wrong-holder tickets. |
| **G4** | Operator or demo dashboard: minimal view of mints/burns and basic volume. **Lifetime** mint/burn counts are **`view`**-readable on-chain (**`totalMinted`**, **`totalBurned`** on `ChainPassTicket`). A **small Node event listener** + **PostgreSQL** (see §8.4) adds a **recent-event feed** and **time-windowed** stats (e.g. last 24h) without scanning logs in the browser. |
| **G5** | Clear story on **why Monad**: throughput, low fees, fast finality for gate-like validation. |

### 4.2 Non-goals (initial / hackathon)

- Full production fiat rails, USSD, or bank integrations (mock or testnet faucet acceptable).  
- Full hardware integration with legacy gate systems (browser or mobile scanner demo is enough).  
- Complete social recovery or full account-abstraction production deployment (design + stub OK).  
- Multi-tenant enterprise SLAs for operators.  

---

## 5. Personas

1. **Passenger** — buys a ticket, shows QR.  
2. **Validator / conductor** — scans QR, needs fast yes/no and burn.  
3. **Transit operator (demo)** — receives funds to a configured wallet; views usage.  
4. **Judge / demo viewer** — needs a crisp narrative, live testnet tx, and clear architecture.  

**Identity in MVP:** These are **not** separate SaaS “accounts.” **Wallet address is identity** (see §7.4). Passenger and conductor are **different UI surfaces** and typically **different connected wallets**; **authorization to burn** is enforced **on-chain** via **`BURNER_ROLE`**, not via a password on the API.

---

## 6. User journeys

### 6.1 Purchase

1. Select route / fare class / time window (MVP: fixed routes from config).  
2. Pay (MVP: **native MON** on Monad testnet via `purchaseTicket`, and/or **role-gated mint** for demos).  
3. Wallet receives NFT; app stores ticket id and shows QR.  

### 6.2 Ride (validation)

1. Validator opens scanner (web or native).  
2. QR resolves to ticket identifier + rolling payload (see §8.2).  
3. Client or backend calls chain: `isValid` / not burned / correct route.  
4. Submit **burn** with **route + holder** that match chain state (typically the **validator EOA** signs the burn transaction).  
5. After **burn**, the NFT no longer exists — **single use** enforced.  

### 6.3 Loyalty (out of scope)

**Points / loyalty** are **not** in the MVP codebase (no points contract).

---

## 7. Functional requirements

### 7.1 Must-have (MVP)

| ID | Requirement |
|----|-------------|
| **FR-01** | Smart contract(s) for **ERC-721-style** tickets: **route id**, **operator**, **validity window**, **`tokenURI`** (base URI + id); **single-use** = **burn** (no separate on-chain “used” state). |
| **FR-02** | **Mint** via **`MINTER_ROLE`** (backend/promo) **and/or** **`purchaseTicket`** with native MON to treasury (testnet). **Minimum payment** per purchase: **`routeMintPriceWei[routeId]`** if set, else **`mintPriceWei`** (admin **`setRouteMintPrice`** / **`setMintPriceWei`**). Repo helper: root **`pnpm sync-route-prices`** batches **`setRouteMintPrice`** from [`config/nigeria-routes.json`](./config/nigeria-routes.json) (see [`config/README.md`](./config/README.md)). |
| **FR-03** | **Burn** after validation: **on-chain** checks (not expired, route match, **owner matches signed holder**); **QR/HMAC** remains **off-chain**. |
| **FR-04** | Tickets **soulbound** (non-transferable); **no transfer toggle** in MVP (hackathon simplicity). |
| **FR-05** | Passenger app: connect wallet **or** embedded wallet (Privy / Dynamic / Turnkey — pick one for hackathon). |
| **FR-06** | QR displays **rolling** signed payload: e.g. ticket id + holder + timestamp + HMAC from backend so stale screenshots fail quickly. |
| **FR-07** | Validator UI: camera scan → display result → submit burn tx (with clear error states). |
| **FR-08** | Basic **operator** page: list recent events (mint/burn) and totals. **Totals** may come from **`totalMinted` / `totalBurned`** (chain) and/or API aggregates over **`ticket_events`** (indexer); **event lists** and **rolling windows** need indexed rows or an alternative (e.g. `getLogs`). |

### 7.2 Should-have (strong demo differentiator)

| ID | Requirement |
|----|-------------|
| **FR-09** | **Offline-tolerant** path: queue last-known validity in scanner; sync when online (clearly document trust limits for hackathon). |
| **FR-10** | **Future:** Gas abstraction (e.g. operator-sponsored gas or a relay) — **not** in MVP; users/validators use normal testnet MON for gas. |
| **FR-11** | ~~Points contract~~ — **scrapped** for MVP. |

### 7.3 Could-have (time permitting)

| ID | Requirement |
|----|-------------|
| **FR-12** | Peer-to-peer transfer with operator fee cap (contract flag). |
| **FR-13** | Multi-operator registry and revenue split. |

### 7.4 Client UI — next implementation milestone (transit-first)

This section turns personas into **concrete UI scope** for **`client/`**. It does **not** require new **contracts** or **server** features (see **§7.4.5**).

#### 7.4.1 Identity and “auth”

- **No email/password or user database** for MVP. **Connect wallet** (or embedded wallet per FR-05) is sufficient.  
- **Passenger** identity = wallet that **owns** the soulbound ticket after `purchaseTicket` or promo `mint`.  
- **Conductor** identity = wallet that must hold **`BURNER_ROLE`** to call `burnTicket` on-chain. The UI should **surface** wrong-role / wrong-wallet clearly (e.g. “Connect conductor wallet”).

#### 7.4.2 Passenger experience (public)

- **Routes / buy** — Primary screen lists **available routes**: human-readable **names** may come from **`GET /api/v1/routes`** (Postgres **`route_labels`**, seeded from repo **`config/`**) or static config; **fares** must come **on-chain** (read **`routeMintPriceWei(routeId)`** and **`mintPriceWei()`** via wagmi/viem, or mirror admin updates). PRD §6.1: fixed routes; show **fare in MON** consistent with wei, validity window copy, and the **`routeId`** (and any **`operatorAddr`** / epoch fields the tx needs). Users must see **what** they are buying **before** paying.  
- **Checkout** — `purchaseTicket` with correct **`msg.value`**; success links to explorer.  
- **My pass** — After purchase, present as a **transit pass / boarding pass** (route, valid until, token id), **not** a generic NFT gallery. Short copy that the pass is **non-transferable** (soulbound) in plain language.  
- **Show QR** — Rolling payload via **`POST /api/v1/qr/payload`** (FR-06); optional **`/verify`** before gate.  
- **No burn, no conductor scanner** on this path — the general public does not need to scan others’ QRs.

#### 7.4.3 Conductor (gate) experience — separate access

- **Dedicated area** in the app (e.g. tab **“Gate”** or route **`/conductor`**) so it is **not** the default passenger home.  
- **Scan QR** → decode payload → read chain state → **`burnTicket`** with **`expectedHolder`** from QR (FR-03, FR-07).  
- Only a wallet with **`BURNER_ROLE`** can complete a real burn; the UI should block or warn otherwise.  
- **Optional demo / preview:** Decode-only or “simulate” line items for judges **without** sending a burn — clearly labeled so it is not confused with production validation.

#### 7.4.4 Operator dashboard (FR-08)

- **Intent:** show **headline** mint/burn volume and (when available) a **recent event list**. **Lifetime** counts can be read **on-chain** via **`totalMinted`** and **`totalBurned`** on the deployed `ChainPassTicket` (no indexer required for those two numbers). **`server/api`** (`/api/v1/operator/stats`, `/api/v1/operator/events`) serves **DB-backed** aggregates and rows when the **indexer** + Postgres are running; **`/operator/stats`** includes **last 24h** windows that chain counters alone do not provide. May live under a third tab (**“Operations”**) or route.

#### 7.4.5 Impact on contracts and server

| Layer | Change required for §7.4? | Notes |
|-------|---------------------------|--------|
| **`contracts/`** | **No** (feature-complete for §7.4 flows) | `purchaseTicket`, soulbound rules, **`burnTicket(..., expectedHolder)`**, **`BURNER_ROLE`**, and **`totalMinted` / `totalBurned`** counters. Grant **`BURNER_ROLE`** to the conductor demo wallet at deploy or via admin. **Each new contract deployment** has its **own** counter state — not a proxy upgrade. |
| **`server/api`** | **Optional** | QR **`/payload`** and **`/verify`**, operator reads, and env **`QR_SIGNING_SECRET`** support the passenger QR flow. **Route display names** can be served from **`GET /api/v1/routes`** (Postgres **`route_labels`**); **fares** remain **only** on-chain. |
| **`server/indexer`** | **Optional for headline totals** | Needed for **Postgres-backed** operator **event feed** and **24h** (and similar) stats. **Not** required to read **`totalMinted` / `totalBurned`** from RPC. |
| **`client/`** | **Yes** | **New work:** routing, wallet, route config, buy flow, pass + QR, conductor scan + burn, operator views, copy/design. |
| **Config** | **Add in repo** | **Static route list** (e.g. `config/` or `client/src/config/`) — not a new backend service. |

Optional client-only env: **`VITE_CHAINPASS_API_URL`** (and related **`VITE_*`** in `client/.env`) pointing at the ChainPass API — does not change server code.

---

## 8. Technical design notes

### 8.1 On-chain

- **Solidity** (Foundry or Hardhat) targeting Monad testnet.  
- **Single-use** via **`burn`** (NFT removed); no separate “used” flag.  
- Emit events for **indexing** (`TicketMinted`, `TicketBurned`, `RoutePriceSet`).  
- Expose **`totalMinted`** and **`totalBurned`** — monotonic counters for **lifetime** mint and burn counts **for this deployment** (cheap analytics without an indexer).  
- **Fares:** **`purchaseTicket`** enforces a **per-`routeId`** minimum (**`routeMintPriceWei`**) when set; otherwise a **global default** (**`mintPriceWei`**). The client route list should show fares that **match** on-chain values (read from the contract or mirror admin updates).  
- **Metadata:** `tokenURI` follows common NFT practice: **off-chain JSON** at the URI is for **display** (e.g. marketplaces); **route / validity / owner** for enforcement come from **chain state** + **signed QR** (`holder` must match `ownerOf` at burn).  

### 8.2 QR / anti-screenshot

- On-chain: ticket must be unburned, **not expired**, **route** must match, and **`ownerOf(tokenId)`** must match **`expectedHolder`** passed to `burnTicket` (from signed QR).  
- Off-chain: **time-bound HMAC** from backend so stale screenshots fail after ~30s. **Physical impersonation** (wrong person with a valid QR) is **not** fully solved on-chain; document limits for the demo.  

### 8.3 Backend (API)

The server is **Node.js + TypeScript** (not Deno/Bun for this project). A thin **HTTP API** is the default (**Express**). Store minimal user/session data; prefer wallet address as identity.

**Implemented HTTP routes** (`server/api`), matching the codebase:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness / build metadata |
| `POST` | `/api/v1/qr/payload` | Issue time-bound signed QR payload (HMAC + `exp`) |
| `POST` | `/api/v1/qr/verify` | Optional: re-check HMAC + TTL before burning on-chain |
| `GET` | `/api/v1/operator/events` | Recent mint/burn rows (from Postgres, written by indexer) |
| `GET` | `/api/v1/operator/stats` | Aggregates over **`ticket_events`**: lifetime-style totals **for rows in DB** + **last 24h**; align **`INDEXER_FROM_BLOCK`** with deployment when indexing a **new** contract |

**Future (not MVP):** gas relay or sponsored transactions via the API.

### 8.4 Indexing — minimal event listener + PostgreSQL

**Scope (hackathon / testnet):** A **long-running Node (TypeScript) process** subscribes to the deployed contract address(es) on Monad testnet, watches **`logs` / contract events** (e.g. mint and burn), and **inserts or updates rows** in **PostgreSQL**. This complements **on-chain** **`totalMinted` / `totalBurned`**: counters give **cheap lifetime totals** for the **current** deployment; the listener gives **per-event detail** and **timestamps** for feeds and **time-range** SQL (e.g. last 24h). The client may read counters via **wagmi/viem** and/or call the **API** for DB-backed endpoints.

| Component | Responsibility |
|-----------|----------------|
| **Event listener** | Connect via `viem` (or `ethers`) + WS or HTTP polling from a known deployment block; parse `TicketMinted`, `TicketBurned` (names illustrative). Persist: tx hash, block, ticket id, route, addresses, timestamp. |
| **PostgreSQL** | Source of truth for **dashboard event lists** and **time-windowed** aggregates; reset or migrate freely on testnet. **After redeploying** `ChainPassTicket`, update **`TICKET_CONTRACT_ADDRESS`**, **`INDEXER_FROM_BLOCK`**, and avoid mixing events from the old address. |
| **`ChainPassTicket` (views)** | **`totalMinted`**, **`totalBurned`** — lifetime totals without Postgres. |
| **API** | Serves **`GET /api/v1/operator/events`** and **`GET /api/v1/operator/stats`** (see §8.3) when **`DATABASE_URL`** is set. |

**Explicitly out of scope for v0:** exactly-once at scale, backfill tooling beyond “from deployment block,” hosted indexer products, The Graph.

**Optional:** run listener and API in one Node process for the smallest deployable unit; split `server/indexer` vs `server/api` if you want separation of concerns (recommended for clarity).

### 8.5 Why Monad (product + engineering)

- High throughput for many concurrent validations near peak hours.  
- Low fee micro-transactions suitable for small fares.  
- Fast finality for gate-like UX.  
- EVM compatibility for standard NFT patterns and tooling.  

### 8.6 Monorepo and package manager

- **Monorepo:** `pnpm` **workspaces** at the repo root (see §13) so **`shared/`** (ABIs, types) is consumed by **`client/`**, **`server/api`**, and **`server/indexer`** without copy-paste. **`contracts/`** is Foundry-only and is not a pnpm package.  
- **Why pnpm over npm, Yarn, or Bun?**  
  - **pnpm:** Strict `node_modules` layout (content-addressable store), **fast installs**, **disk-efficient**, excellent workspace support — common default for TS monorepos.  
  - **npm:** Fine for single-package repos; workspaces work but are less ergonomic than pnpm for many packages.  
  - **Yarn (Berry):** Strong monorepo story; more moving parts (PnP vs node-modules).  
  - **Bun:** Very fast; workspace support exists — acceptable if the team standardizes on Bun for run + install; otherwise pnpm is the least surprising for collaborators and CI.  

**Decision:** Default to **pnpm** for this project; switching to npm/Yarn/Bun is possible if lockfiles and workspace config are adjusted.

---

## 9. Security and abuse considerations

| Risk | Mitigation (MVP) |
|------|------------------|
| Screenshot sharing | Rolling QR + short TTL signature |
| Open mint | Minter role / backend-only mint |
| Scalping | Soulbound tickets; optional controlled transfer |
| Validator key compromise | Separate validator keys; rotate; minimal on-chain privileges |
| Poor connectivity | Offline queue with explicit security caveats for demo |

---

## 10. Success metrics (hackathon)

- **Demo:** End-to-end on **Monad testnet**: mint → live QR → scan → burn in under two minutes narrative.  
- **Clarity:** Architecture diagram + README that maps personas to components.  
- **Code quality:** Contracts tested; frontend handles failure modes (wrong route, holder mismatch, already burned, expired QR).  

---

## 11. Milestones (suggested)

| Phase | Deliverable |
|-------|-------------|
| **M0** | Repo scaffold, contract compiles, deploy script to testnet |
| **M1** | Routes + buy UI + mint + list ticket in app (see §7.4) |
| **M2** | QR + signature + conductor scan + burn (separate gate UI, §7.4) |
| **M3** | Event listener + Postgres + operator API endpoints + operator UI |
| **M4** | Polish + story deck |

---

## 12. Open questions

1. **Payment:** MVP uses **native MON** to treasury on `purchaseTicket`; USDC/stablecoin path deferred on testnet.  
2. **Validator key:** Dedicated **validator EOA** with `BURNER_ROLE` submits the burn (no gas-relay API in MVP).  
3. **KYC / identity:** **Wallet-only for MVP** (see §7.4.1); no separate account system.  
4. **Route data:** **Static JSON (or TS) in repo** for MVP listing on buy screen; on-chain registry remains a future option.  

---

## 13. Recommended repository structure

The repo uses **three clearly separated roots** — **contracts**, **server**, **client** — so ownership and deploys are obvious. **`shared/`** holds TypeScript-only artifacts (generated ABIs, chain helpers) used by **server** and **client**, not by Foundry.

```text
chainpass/
├── README.md
├── PRD.md
├── package.json                 # pnpm workspaces root (client, server/*, shared)
├── pnpm-workspace.yaml
├── .env.example
│
├── contracts/                   # ON-CHAIN — Foundry only (no package.json)
│   ├── src/
│   ├── script/                  # deploy scripts
│   ├── test/
│   └── foundry.toml
│
├── server/                      # OFF-CHAIN — Node + TypeScript
│   ├── api/                     # HTTP API: QR signing + verify, operator reads from Postgres
│   │   ├── src/
│   │   └── package.json
│   └── indexer/                 # long-running process: chain events → PostgreSQL
│       ├── src/
│       └── package.json
│
├── client/                      # BROWSER — Vite + React + TS (passenger, validator, operator)
│   ├── src/
│   ├── index.html
│   └── package.json
│
├── shared/                      # optional: TS types, ABIs (generated from contracts), chain ids
│   └── src/
│
├── config/                      # optional: route definitions, branding (JSON/TS)
├── tooling/                     # e.g. docker-compose for PostgreSQL locally
└── docs/
    └── architecture.md          # optional: diagrams, sequence flows
```

**`pnpm-workspace.yaml` (illustrative)** — include `client`, `server/*`, `shared`; do **not** list `contracts/` (Foundry is outside npm).

```yaml
packages:
  - 'client'
  - 'server/*'
  - 'shared'
```

**Split of responsibilities**

| Root | Responsibility |
|------|----------------|
| **`contracts/`** | Solidity: NFT ticket lifecycle, access control, treasury + MON purchase, events; tests; deploy scripts. |
| **`server/api/`** | Ephemeral QR signatures (`/api/v1/qr/*`), secrets; HTTP for operator UI; reads **PostgreSQL** written by the indexer (optional for headline totals if UI reads **`totalMinted` / `totalBurned`** on-chain). |
| **`server/indexer/`** | Subscribe to contract logs on Monad; persist mint/burn (and related) rows to Postgres for feeds and rolling stats. |
| **`client/`** | Wallets, purchase UI, QR display, scanner, operator dashboard — talks to chain via wagmi/viem and to **`server/api`** for signed payloads and (when configured) dashboard DB data. |
| **`shared/`** | Generated ABIs and shared types so `client` and `server` stay in sync with `contracts/`. |

---

## 14. Agent skills (Monad)

The **monskills** pack lives under `.agents/skills/monskill/`. It routes agents to topics (scaffold, why Monad, addresses, wallet, wallet-integration, Vercel deploy). **ChainPass-specific mapping** — what to use, what to adapt for this repo — is documented in **`docs/MONSKILLS.md`**.

Install / refresh:

```bash
npx skills add therealharpaljadeja/monskills -y
```

Review the [skills security note](https://skills.sh/therealharpaljadeja/monskills) before automated workflows.

---

## 15. Appendix — proposal alignment

This PRD encodes the proposal’s core flow: **purchase → NFT → dynamic QR → scan → verify → burn**, plus mitigations (rolling QR, offline mode, embedded wallet, soulbound tickets). **Points** are out of MVP; multi-operator features remain **should/could** for scope control.
