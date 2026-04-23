import type { ConnectedWallet } from "@privy-io/react-auth"
import { monadTestnet } from "@hoppr/shared"
import type { UseSwitchChainReturnType } from "wagmi"
import { numberToHex } from "viem"

/** Matches `useSwitchChain().switchChainAsync` from this app’s wagmi `Register` config. */
type SwitchChainAsyncFn = UseSwitchChainReturnType["switchChainAsync"]

function providerErrorCode(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined
  if (!("code" in err)) return undefined
  const c = (err as { code?: number | string }).code
  if (typeof c === "number") return c
  if (typeof c === "string") {
    const n = Number.parseInt(c, 10)
    return Number.isNaN(n) ? undefined : n
  }
  return undefined
}

type Eip1193 = { request: (args: { method: string; params?: unknown }) => Promise<unknown> }

/**
 * Switch the injected wallet to Monad testnet. Adds the chain first when the wallet does not
 * know it yet (MetaMask returns 4902).
 */
async function switchOrAddMonad(provider: Eip1193): Promise<void> {
  const chainIdHex = numberToHex(monadTestnet.id)
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    })
    return
  } catch (err: unknown) {
    const code = providerErrorCode(err)
    if (code !== 4902) throw err
  }

  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: chainIdHex,
        chainName: monadTestnet.name,
        nativeCurrency: monadTestnet.nativeCurrency,
        rpcUrls: [...monadTestnet.rpcUrls.default.http],
        blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
      },
    ],
  })
}

export async function switchToMonadTestnet(options: {
  privyEthWallet: ConnectedWallet | undefined
  wagmiSwitchChain: SwitchChainAsyncFn | undefined
}): Promise<void> {
  const { privyEthWallet, wagmiSwitchChain } = options

  if (privyEthWallet?.type === "ethereum") {
    const provider = (await privyEthWallet.getEthereumProvider()) as Eip1193
    await switchOrAddMonad(provider)
    return
  }

  if (wagmiSwitchChain) {
    try {
      await wagmiSwitchChain({ chainId: monadTestnet.id })
      return
    } catch {
      /* same chain may need wallet_addEthereumChain — try injected provider */
    }
  }

  const injected =
    typeof window !== "undefined"
      ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? undefined)
      : undefined
  if (injected?.request) {
    await switchOrAddMonad(injected)
    return
  }

  throw new Error("No wallet available to switch network")
}
