import { createConfig } from "@privy-io/wagmi"
import { http } from "wagmi"
import { monadTestnet } from "@hoppr/shared"
import { env } from "../lib/env"

// If VITE_MONAD_RPC_URL is set, route all reads through the dedicated endpoint.
// Otherwise fall back to the chain default (public testnet-rpc.monad.xyz), which
// rate-limits under normal app load — see env.ts comment.
//
// retryCount: 0 — viem's default is 3. When the public RPC 413/429s a chunked
// getLogs fan-out, each failed chunk triggers 3 retries, turning a ~50-request
// burst into 200+ and freezing the UI in perpetual retry. We'd rather fail fast
// and let callers (fetchLogsChunked swallows errors, query layer retries once).
export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(env.monadRpcUrl, { retryCount: 0 }),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}
