import type { ReactNode } from "react"
import { PrivyProvider } from "@privy-io/react-auth"
import { WagmiProvider } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { privyClientConfig } from "../config/privy"
import { wagmiConfig } from "../config/wagmi"
import { env } from "../lib/env"
import { PrivyWagmiSync } from "./PrivyWagmiSync"

// Defaults tuned to protect Monad's public RPC from rate limits (HTTP 429).
// - refetchOnWindowFocus: off — wagmi/viem reads all flow through a single public RPC
//   endpoint, and every focus change was triggering a burst of getLogs + readContract
//   calls that tripped the rate limiter.
// - staleTime: 30s — the UI's ticket / route data doesn't change every second; this
//   coalesces rapid re-renders into a single fetch window.
// - retry: 1 — public RPC 429s aren't worth retrying aggressively; one backoff attempt
//   handles transient blips without amplifying load.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
})

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={env.privyAppId}
      {...(env.privyClientId ? { clientId: env.privyClientId } : {})}
      config={privyClientConfig}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <PrivyWagmiSync />
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
