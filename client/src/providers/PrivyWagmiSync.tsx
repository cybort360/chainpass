import { useEffect, useMemo } from "react"
import { usePrivy, useWallets } from "@privy-io/react-auth"
import { useSetActiveWallet } from "@privy-io/wagmi"
import { useAccount } from "wagmi"

/**
 * Keeps wagmi’s connector in sync with Privy’s active Ethereum wallet so pages using
 * useAccount / useWriteContract still work. Header UI uses Privy + viem only.
 */
export function PrivyWagmiSync() {
  const { authenticated } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { address } = useAccount()
  const { setActiveWallet } = useSetActiveWallet()
  const firstEthWallet = useMemo(
    () => wallets.find((w) => w.type === "ethereum"),
    [wallets],
  )

  useEffect(() => {
    if (!authenticated || !walletsReady || address || !firstEthWallet) return
    void setActiveWallet(firstEthWallet).catch(() => {})
  }, [authenticated, walletsReady, address, firstEthWallet, setActiveWallet])

  return null
}
