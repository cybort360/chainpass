# ChainPass contracts (Foundry)


From the **repo root** or `contracts/`:

```bash
cd contracts
forge install --no-git foundry-rs/forge-std
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.2.0
forge build
```

`--no-git` avoids submodule issues when `contracts/` is not its own git repo.

## Core contract: `ChainPassTicket`

[`src/ChainPassTicket.sol`](src/ChainPassTicket.sol) (OpenZeppelin **ERC721** + **AccessControl**):

| Role | Purpose |
|------|---------|
| `DEFAULT_ADMIN_ROLE` | Deployer; grant/revoke roles; `setMintPriceWei`, `setRouteMintPrice`, `setBaseURI`. |
| `MINTER_ROLE` | Free / backend / promo mints (`mint` — no on-chain payment). |
| `BURNER_ROLE` | Burn after validation (`burnTicket`). |

| Function | Purpose |
|----------|---------|
| `mint(to, routeId, validUntilEpoch, operatorAddr)` | Role-gated mint (no MON required). |
| `purchaseTicket(routeId, validUntilEpoch, operatorAddr)` **payable** | Public buy: mints to `msg.sender`, forwards **native MON** (`msg.value`) to **`treasury`**. Required payment is **`routeMintPriceWei[routeId]`** if non-zero; otherwise **`mintPriceWei`** (global default). |
| `setRouteMintPrice(routeId, weiAmount)` | Admin: per-route minimum wei for `purchaseTicket`. Set **`0`** to clear override so that route uses **`mintPriceWei`**. Emits **`RoutePriceSet`**. |
| `burnTicket(tokenId, expectedRouteId, expectedHolder)` | On-chain: **not expired**, **route match**, **`ownerOf(tokenId) == expectedHolder`**. QR/HMAC stays off-chain. |
| `totalMinted()` / `totalBurned()` | **`view`** — lifetime counts of successful mints and **`burnTicket`** calls **for this contract deployment** (cheap reads for operator dashboards without an indexer). |

**Payment (MVP):** **Native MON only** on Monad testnet (no USDC path in this repo). **`treasury`** is **immutable**. **`mintPriceWei`** is the **default** fare when no per-route price is set; **`setRouteMintPrice`** sets a **higher or lower** minimum for a given **`routeId`**. Deploy sets initial **`mintPriceWei`** via **`MINT_PRICE_WEI`**; add per-route prices in follow-up transactions as **`DEFAULT_ADMIN_ROLE`**, or batch from [`config/nigeria-routes.json`](../config/nigeria-routes.json) via root **`pnpm sync-route-prices`** (see [`config/README.md`](../config/README.md)).

**Metadata:** Same as most NFTs: **`tokenURI`** = `baseURI + tokenId`; **JSON at that URL** is for wallets/marketplaces — **trust off-chain for display**; **route / validity / owner** for rules come from **chain** + **signed QR**.

Tickets are **soulbound** (no transfer toggle in MVP). **Single-use** = **burn** only; no separate “used” flag.

**Events (for indexers):** `TicketMinted`, `TicketBurned`, `RoutePriceSet`.

## Toolchain

Foundry binaries live under **`~/.foundry/bin`**. Add that to PATH.

```bash
forge build
forge test
```

Solidity **0.8.24** with optimizer (see [`foundry.toml`](foundry.toml)).

## Deploy to Monad testnet

**RPC:** `https://testnet-rpc.monad.xyz` (see [Monad docs](https://docs.monad.xyz)).

**Environment variables (shell or `.env` in `contracts/` — never commit secrets):**

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Deployer account private key. |
| `MINTER_ADDRESS` | No | Receives `MINTER_ROLE`; defaults to **deployer**. |
| `BURNER_ADDRESS` | No | Receives `BURNER_ROLE`; defaults to **deployer**. |
| `METADATA_BASE_URI` | No | ERC-721 metadata base URI; empty string allowed. |
| `TREASURY_ADDRESS` | No | Receives MON from `purchaseTicket`; defaults to **deployer**. |
| `MINT_PRICE_WEI` | No | Default minimum wei for `purchaseTicket` when **`routeMintPriceWei[routeId]`** is unset; default **0** (free unless you set per-route prices). |

**Example (bash):**

```bash
cd contracts
export PRIVATE_KEY=your_key_here
export METADATA_BASE_URI=https://example.com/metadata/
export TREASURY_ADDRESS=0x...
export MINT_PRICE_WEI=100000000000000000
export MINTER_ADDRESS=0x...
export BURNER_ADDRESS=0x...
forge script script/DeployChainPass.s.sol:DeployChainPass \
  --rpc-url https://testnet-rpc.monad.xyz \
  --broadcast
```

On success, copy the logged `ChainPassTicket:` address into the root `.env` as `TICKET_CONTRACT_ADDRESS` for the indexer and mirror **`VITE_CHAINPASS_CONTRACT_ADDRESS`** in **`client/.env`**.

**New deployment:** This repo does **not** use an upgradeable proxy — each deploy is a **new** contract with **fresh** `totalMinted` / `totalBurned` and a **new** address. Update **`INDEXER_FROM_BLOCK`** to the new deployment block and avoid mixing **`ticket_events`** rows from a previous address (see root **`walkthrough.md`** and **`pnpm --filter @chainpass/indexer run db:clear-ticket-events`**).

**Funding:** Deployer needs testnet MON for gas (use the Monad testnet faucet).
