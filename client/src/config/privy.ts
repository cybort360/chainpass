import type { PrivyClientConfig } from "@privy-io/react-auth"
import { monadTestnet } from "@chainpass/shared"

export const privyClientConfig: PrivyClientConfig = {
  /** Wallet-only auth; hides email/SMS/social in the Privy modal (must also turn off unused methods in the dashboard). */
  loginMethods: ["wallet"],
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
