# Monskills — What Hoppr Uses

This project has the **[monskills](https://github.com/therealharpaljadeja/monskills)** pack installed under `.agents/skills/monskill/`. It is a set of **markdown skills for AI agents** (and humans) building on Monad—not a runtime dependency of the app.

**Install (if needed):** `npx skills add therealharpaljadeja/monskills -y`  
**Security / review:** [skills.sh listing](https://skills.sh/therealharpaljadeja/monskills)

---

## Skills inventory

| Skill (path) | What it covers | Use for Hoppr? |
|--------------|----------------|-------------------|
| **`SKILL.md`** (root) | Router: which skill to open for which task | Yes — start here when delegating to an agent. |
| **`scaffold/`** | End-to-end checklist: architecture, onchain vs offchain, OpenZeppelin, Foundry, wagmi, deploy order | **Yes** — aligns with Foundry + deploy-before-frontend; optional **shadcn** for UI. |
| **`why-monad/`** | Chain value prop: TPS, block time, finality, 128KB contract limit, `eth_sendRawTransactionSync`, low $ cost, ecosystem links | **Yes** — hackathon pitch and README “Why Monad”; link to [Monad docs](https://docs.monad.xyz/tooling-and-infra/) for tooling questions. |
| **`addresses/`** | Canonical mainnet/testnet addresses (WMON, Multicall3, Permit2, Safe, EntryPoint, bridged assets, etc.); **verify with explorer / `cast code`** | **Yes** — when integrating with Multicall3, testnet WMON/faucets, or any **ecosystem** contract; **never** guess addresses. |
| **`wallet-integration/`** | **Privy** + `@privy-io/wagmi` + wagmi + viem on **Vite**; `monadTestnet` from `@hoppr/shared` | **Yes** — matches **`client/`** (`PrivyProvider` → React Query → `WagmiProvider`, see `client/src/providers/AppProviders.tsx`). |
| **`wallet/`** | Agent keystore at `~/.monskills/keystore`, Safe multisig flows, `propose.mjs`, Foundry `cast wallet` | **Optional** — useful if an **automated agent** deploys from a managed wallet; human/CI deploy can use plain Foundry + private key in env instead. |
| **`vercel-deploy/`** | Deploy tarball via claimable endpoint; `deploy.sh`; `vercel.json` framework hints | **Optional** — deploy **`client/`** manually or via any host; Vercel skill applies if you choose that path (`"framework": "nextjs"` for Next). |

**Not in monskills (build yourself):** PostgreSQL schema, event listener/indexer, Express API, QR signing—those come from our PRD, not this pack. **Lifetime mint/burn totals** are **`totalMinted` / `totalBurned`** on **`ChainPassTicket`** (see [`PRD.md`](../PRD.md) §8).

---

## What we adopt directly

1. **Monad RPC endpoints** (from `wallet-integration` and `addresses` patterns):

   - Mainnet: `https://rpc.monad.xyz`  
   - Testnet: `https://testnet-rpc.monad.xyz`  

2. **Wagmi chain:** `import { monadTestnet } from '@hoppr/shared'` (or `wagmi/chains` in other apps) — use **testnet** for hackathon demo.

3. **Contract practices:** OpenZeppelin via `forge install OpenZeppelin/openzeppelin-contracts` (from `scaffold/`).

4. **Address hygiene:** Verify bytecode with `cast code <addr> --rpc-url https://testnet-rpc.monad.xyz` before relying on any address from the table (from `addresses/`).

5. **Ticket pricing:** Enforced in **`ChainPassTicket`** (`mintPriceWei`, **`routeMintPriceWei`**, **`setRouteMintPrice`**) — not in the Express API. The client should read required wei via **`wagmi`/`viem`** before **`purchaseTicket`**. To align **`config/nigeria-routes.json`** with chain, use root **`pnpm sync-route-prices`** ([`config/README.md`](../config/README.md)).

6. **UX on Monad:** Prefer **`eth_sendRawTransactionSync`**-style flows where wagmi supports them so mint/burn feedback is fast (`scaffold/` + `why-monad/`).

7. **Deploy story:** Optional Vercel preview + claim URL (`vercel-deploy/`); otherwise manual deploy of **`client/`** build output.

---

## What we adapt for this repo

| Monskills default | Hoppr choice |
|-------------------|------------------|
| Next.js + RainbowKit (upstream skill) | **Hoppr `client/`** uses **Vite** + **Privy** instead — see `client/src/config/privy.ts`, `client/src/config/wagmi.ts`, `client/src/providers/AppProviders.tsx`. |
| WalletConnect project ID in app `.env` | **Not used** — Privy owns wallet/modal UX; set **`VITE_PRIVY_APP_ID`** only. |
| `next dev` / `.next` output | **`client/`** uses **`vite`** / **`client/dist`** — see root `scripts/vercel-build.mjs`. |
| `bash deploy.sh web/` | UI lives in **`client/`** — deploy manually or use `vercel-deploy/` if you want the claim flow. |
| “Use Shadcn if no preference” | Optional; any UI kit is fine. |

---

## Task → skill quick reference (for agents)

| Task | Open in repo |
|------|----------------|
| Pitch / why Monad | `.agents/skills/monskill/why-monad/SKILL.md` |
| Scaffold order + OZ + wagmi notes | `.agents/skills/monskill/scaffold/SKILL.md` |
| Explorer, RPC, canonical addresses | `.agents/skills/monskill/addresses/SKILL.md` |
| Connect wallet + read/write contracts | `.agents/skills/monskill/wallet-integration/SKILL.md` |
| Preview deploy to Vercel | `.agents/skills/monskill/vercel-deploy/SKILL.md` |
| Agent-only deploy wallet / Safe | `.agents/skills/monskill/wallet/SKILL.md` |

---

## Live mirror

Skills are also served as reference at **https://skills.devnads.com** (per upstream README). Local files stay the source of truth for the version you installed.
