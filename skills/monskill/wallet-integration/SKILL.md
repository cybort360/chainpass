---
name: wallet-integration
description: Wallet connection for Hoppr — Privy + @privy-io/wagmi + wagmi + viem on Vite (Monad testnet).
---

This repo’s **`client/`** uses **[Privy](https://docs.privy.io)** for authentication and wallet connection, **[`@privy-io/wagmi`](https://www.npmjs.com/package/@privy-io/wagmi)** for wagmi integration, and **`monadTestnet`** from **`@hoppr/shared`**.

Do **not** add a **WalletConnect / Reown project ID** to app env — Privy handles external wallets and any WC stack internally.

## Env (`client/.env`)

- **`VITE_PRIVY_APP_ID`** (required) — [Privy Dashboard](https://dashboard.privy.io); set **allowed origins** (localhost, LAN IP, production).
- Optional **`VITE_PRIVY_CLIENT_ID`** if you use app clients.
- **`VITE_HOPPR_CONTRACT_ADDRESS`**, **`VITE_HOPPR_API_URL`** — see [`client/.env.example`(../../../../client/.env.example).

## Provider order

```txt
PrivyProvider → QueryClientProvider → WagmiProvider (@privy-io/wagmi)
```

Implementation: [`client/src/providers/AppProviders.tsx`(../../../../client/src/providers/AppProviders.tsx).

## Config files

- [`client/src/config/privy.ts`(../../../../client/src/config/privy.ts) — `loginMethods`, `defaultChain`, `supportedChains`, embedded wallets, appearance.
- [`client/src/config/wagmi.ts`(../../../../client/src/config/wagmi.ts) — `createConfig` from **`@privy-io/wagmi`** (not from `wagmi` directly).

## Usage

- **`usePrivy()`** — `login`, `logout`, `ready`, `authenticated`.
- **`useAccount`**, **`useReadContract`**, **`useWriteContract`**, etc. from **`wagmi`** — unchanged for contract calls.

## Reference

- [Privy React setup](https://docs.privy.io/basics/react/setup)
- [Integrating with wagmi](https://docs.privy.io/guide/react/wallets/usage/wagmi)
