import { createConfig } from "@privy-io/wagmi"
import { http } from "wagmi"
import { monadTestnet } from "@chainpass/shared"
import { env } from "../lib/env"

// If VITE_MONAD_RPC_URL is set, route all reads through the dedicated endpoint.
// Otherwise fall back to the chain default (public testnet-rpc.monad.xyz), which
// rate-limits under normal app load — see env.ts comment.
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(env.monadRpcUrl),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}
