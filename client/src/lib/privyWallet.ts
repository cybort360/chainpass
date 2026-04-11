import type { User } from "@privy-io/react-auth"
import type { Address } from "viem"

/** Prefer `useWallets()`; fall back to `user` while wallets hydrate (avoids stuck "Connecting…"). */
export function pickEthereumAddressFromUser(user: User | null | undefined): Address | undefined {
  if (!user) return undefined
  const isEvm = (chainType: string | undefined) => chainType !== "solana"
  if (user.wallet?.address && isEvm(user.wallet.chainType)) {
    return user.wallet.address as Address
  }
  for (const a of user.linkedAccounts) {
    if (a.type !== "wallet" && a.type !== "smart_wallet") continue
    const w = a as { address: string; chainType?: string }
    if (w.address && isEvm(w.chainType)) return w.address as Address
  }
  return undefined
}
