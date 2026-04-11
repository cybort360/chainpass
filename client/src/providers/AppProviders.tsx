import type { ReactNode } from "react"
import { PrivyProvider } from "@privy-io/react-auth"
import { WagmiProvider } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { privyClientConfig } from "../config/privy"
import { wagmiConfig } from "../config/wagmi"
import { env } from "../lib/env"
import { PrivyWagmiSync } from "./PrivyWagmiSync"

const queryClient = new QueryClient()

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
