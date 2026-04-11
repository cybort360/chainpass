# Route & fare config (demo)

[`nigeria-routes.json`](./nigeria-routes.json) lists **example** `routeId`s, **Nigeria-inspired** corridor names, and **fares between 1 and 5 MON** (`priceWei` = MON × 10¹⁸).

## Using with the contract

These files are **not** loaded by the chain. To enforce the same fares on-chain:

1. Deploy `ChainPassTicket` (set global `MINT_PRICE_WEI` if you want a default for unlisted routes). Each **new deployment** gets a new address and resets **`totalMinted` / `totalBurned`** — update app env and indexer cursor (see root **`README.md`**).
2. As **`DEFAULT_ADMIN_ROLE`**, call **`setRouteMintPrice(routeId, priceWei)`** for each row (use the **`priceWei`** string as a uint256).

Example with `cast` (replace `CONTRACT` and private key handling with your setup):

```bash
cast send CONTRACT "setRouteMintPrice(uint256,uint256)" 1 3000000000000000000 --rpc-url https://testnet-rpc.monad.xyz
```

Repeat for each `routeId` in the JSON.

### Sync all routes from JSON (script)

From the **repository root**, with **`@chainpass/shared` built** (`pnpm --filter @chainpass/shared build` if needed):

```bash
export PRIVATE_KEY=0x...   # admin — DEFAULT_ADMIN_ROLE on the contract
export TICKET_CONTRACT_ADDRESS=0x...   # ChainPassTicket
# Optional: RPC_URL=https://testnet-rpc.monad.xyz
# Dry run (no txs):
DRY_RUN=1 pnpm sync-route-prices
# Apply on-chain (one tx per route):
pnpm sync-route-prices
```

The script reads [`nigeria-routes.json`](./nigeria-routes.json) and calls **`setRouteMintPrice(routeId, priceWei)`** for each row. Override the file path with **`CHAINPASS_ROUTES_JSON`** if needed.

## Using in the client

Import or fetch this JSON for the **buy / routes** screen; for the exact live minimum, prefer reading **`routeMintPriceWei(routeId)`** and **`mintPriceWei()`** from the deployed contract so UI and chain stay aligned.
