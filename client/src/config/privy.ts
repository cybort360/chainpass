import type { PrivyClientConfig } from "@privy-io/react-auth"
import { monadTestnet } from "@chainpass/shared"

export const privyClientConfig: PrivyClientConfig = {
  loginMethods: ["wallet", "google", "email", "apple", "twitter", "discord"],
  defaultChain: monadTestnet,
  supportedChains: [monadTestnet],
  embeddedWallets: {
    ethereum: {
      createOnLogin: "users-without-wallets",
    },
  },
  appearance: {
    theme: "dark",
    accentColor: "#6e54ff",
  },
}
