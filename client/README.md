# Hoppr client

React + **Vite** SPA for **Hoppr**: routes, purchase, **My passes** (on-chain reads), QR display, conductor gate tools, and **Operations** (operator stats when the API + indexer are configured).

## Docs

- Root [`README.md`](../README.md) — stack, env, **operator analytics** (chain **`totalMinted` / `totalBurned`** vs indexer + Postgres), **Vercel** summary.
- [`PRD.md`](../PRD.md) — product requirements.
- [`walkthrough.md`](../walkthrough.md) — run locally, deploy contract, production checklist.

## Env

Copy [`client/.env.example`](./.env.example) to `client/.env`. Contract address vars must match your **current** `ChainPassTicket` deployment. For production, set the same **`VITE_*`** values in your host (see [`client/.env.example`](./.env.example) and root [`.env.example`](../.env.example)).

## Scripts

See root `package.json` / this package’s `package.json` for `dev`, `build`, and `lint`.

Dev server (from repo root: `pnpm dev:client`): default **http://localhost:5173**.

---

## Deploy on Vercel

The monorepo keeps a root [`vercel.json`](../vercel.json) and a duplicate [`client/vercel.json`](./vercel.json) with the same **install**, **build**, **output**, and **SPA rewrites**.

| Setting | Recommendation |
|---------|----------------|
| **Root Directory** | **Repository root** (empty). The build must run **`pnpm`** against the workspace **`pnpm-lock.yaml`**. If Root Directory is **`client/`** only, use the copy in **`client/vercel.json`** so install/build still `cd` to the git top-level via **`git rev-parse`**. |
| **Output** | Static output is **`dist/`** at the repo root after **`scripts/vercel-build.mjs`** (it builds **`@hoppr/shared`** + **`client`**, then mirrors **`client/dist`** → **`dist/`**). |
| **Client-side routes** | **`rewrites`** map paths to **`index.html`** so routes like **`/conductor`** work on hard refresh. |
| **pnpm version** | Locked via root **`packageManager`**; install command uses **npx** so CI does not use a mismatched global pnpm. |

HTTPS is required for **camera** APIs in the browser (localhost is exempt in dev).

---

## Conductor gate: QR scanning

Passenger passes render a **QR** whose value is **`JSON.stringify`** of the signed payload (`tokenId`, `holder`, `exp`, `signature`). The **Conductor** page decodes that JSON to verify and burn.

| Platform | Notes |
|----------|--------|
| **Android (Chrome)** | Live camera usually works with the default scanner settings. |
| **iPhone (Safari)** | Safari’s camera + decoder stack differs from Chrome. The UI uses **iOS-specific** settings (e.g. native **BarcodeDetector** when available, full-viewfinder scan region). If live preview never decodes, use **Upload QR photo** and pick a **sharp screenshot or photo** of the passenger’s pass — that path decodes the same JSON and is the most reliable on iOS. |

**Tips:** Maximize brightness on the passenger phone; hold the whole QR in frame; ensure the API is reachable (**`VITE_HOPPR_API_URL`**) so passes can refresh.
