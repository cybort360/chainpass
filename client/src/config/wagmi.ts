import { createConfig } from "@privy-io/wagmi"
import { http } from "wagmi"
import { monadTestnet } from "@chainpass/shared"

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: {
    [monadTestnet.id]: http(),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}
