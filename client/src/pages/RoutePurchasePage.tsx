import { useEffect, useMemo, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { Link, useNavigate, useParams } from "react-router-dom"
import { formatEther } from "viem"
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { chainPassTicketAbi } from "@chainpass/shared"
import { Button } from "../components/ui/Button"
import type { DemoRoute } from "../constants/demoRoutes"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { fetchRouteLabels } from "../lib/api"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { extractMintedTokenIdFromReceipt } from "../lib/tx"
import { formatWriteContractError } from "../lib/walletError"

function parseRouteIdParam(raw: string | undefined): bigint | undefined {
  if (!raw || !/^[0-9]+$/.test(raw)) return undefined
  try {
    return BigInt(raw)
  } catch {
    return undefined
  }
}

export function RoutePurchasePage() {
  const { routeId: routeIdParam } = useParams()
  const navigate = useNavigate()
  const { authenticated } = usePrivy()
  const { isConnected, address } = useAccount()

  const routeIdBig = useMemo(() => parseRouteIdParam(routeIdParam), [routeIdParam])

  const [apiLabels, setApiLabels] = useState<Awaited<ReturnType<typeof fetchRouteLabels>> | undefined>(undefined)
  useEffect(() => {
    void fetchRouteLabels().then(setApiLabels)
  }, [])

  const routeMeta = useMemo((): DemoRoute | undefined => {
    if (!routeIdParam) return undefined
    const demo = DEMO_ROUTES.find((r) => r.routeId === routeIdParam)
    if (demo) return demo
    if (apiLabels === undefined) return undefined
    if (!apiLabels) return undefined
    const row = apiLabels.find((r) => r.routeId === routeIdParam)
    if (!row) return undefined
    return {
      routeId: row.routeId,
      category: row.category || "General",
      name: row.name,
      detail: row.detail ?? "",
    }
  }, [routeIdParam, apiLabels])

  const metaLoading =
    routeIdParam !== undefined &&
    routeMeta === undefined &&
    apiLabels === undefined &&
    !DEMO_ROUTES.some((r) => r.routeId === routeIdParam)

  const contractAddress = getContractAddress()

  const { data: routePriceWei } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeMintPriceWei",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined },
  })

  const { data: mintPriceWei } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "mintPriceWei",
    query: { enabled: !!contractAddress },
  })

  const priceWei = useMemo(() => {
    const r = typeof routePriceWei === "bigint" ? routePriceWei : undefined
    const m = typeof mintPriceWei === "bigint" ? mintPriceWei : undefined
    if (r === undefined || m === undefined) return undefined
    return r > 0n ? r : m
  }, [routePriceWei, mintPriceWei])

  const { data: hash, writeContract, isPending, error: writeError, reset } = useWriteContract()

  const { data: receipt, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (!receipt || !contractAddress || !isSuccess) return
    const tokenId = extractMintedTokenIdFromReceipt(receipt.logs, contractAddress)
    if (tokenId !== null) {
      navigate(`/pass/${tokenId.toString()}`)
    }
  }, [receipt, contractAddress, isSuccess, navigate])

  if (!contractAddress) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-surface-container p-8">
        <h1 className="font-headline text-xl font-bold text-white">Contract not configured</h1>
        <p className="mt-3 text-sm text-on-surface-variant">
          Set <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in{" "}
          <code className="font-mono">client/.env</code> to your deployed ChainPass ticket contract on Monad testnet.
        </p>
        <Link to="/routes" className="mt-6 inline-block font-headline text-sm font-semibold text-primary hover:underline">
          ← Back to routes
        </Link>
      </div>
    )
  }

  if (routeIdBig === undefined) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="text-on-surface-variant">Unknown route.</p>
        <Link to="/routes" className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline">
          ← All routes
        </Link>
      </div>
    )
  }

  if (metaLoading) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="text-on-surface-variant">Loading route…</p>
        <Link to="/routes" className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline">
          ← All routes
        </Link>
      </div>
    )
  }

  if (!routeMeta) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="text-on-surface-variant">Unknown route.</p>
        <Link to="/routes" className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline">
          ← All routes
        </Link>
      </div>
    )
  }

  const validUntilEpoch = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365)

  const onPurchase = () => {
    if (!address || priceWei === undefined) return
    reset()
    writeContract({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "purchaseTicket",
      args: [routeIdBig, validUntilEpoch, env.defaultOperator],
      value: priceWei,
    })
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link to="/routes" className="font-headline text-sm font-medium text-primary hover:underline">
        ← Routes
      </Link>
      <p className="mt-1 font-headline text-xs font-semibold uppercase tracking-wide text-primary">{routeMeta.category}</p>
      <h1 className="mt-2 font-headline text-3xl font-bold text-white">{routeMeta.name}</h1>
      <p className="mt-2 text-on-surface-variant">{routeMeta.detail}</p>
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <p className="text-sm text-on-surface-variant">Price (on-chain minimum)</p>
        <p className="mt-1 font-headline text-2xl font-bold text-white">
          {priceWei !== undefined ? `${formatEther(priceWei)} MON` : "…"}
        </p>
        <p className="mt-4 text-xs text-on-surface-variant">
          Ticket is soulbound (non-transferable). Valid until epoch {validUntilEpoch.toString()} (≈1 year from
          purchase).
        </p>
        {!authenticated ? (
          <p className="mt-6 text-sm text-tertiary">Connect your wallet in the header to purchase.</p>
        ) : !isConnected ? (
          <p className="mt-6 text-sm text-tertiary">Finishing wallet connection… try again in a few seconds, or refresh.</p>
        ) : (
          <Button
            type="button"
            variant="primary"
            className="mt-6 w-full"
            disabled={priceWei === undefined || isPending || isConfirming}
            onClick={onPurchase}
          >
            {isPending || isConfirming ? "Confirm in wallet…" : "Pay with MON"}
          </Button>
        )}
        {writeError ? (
          <p className="mt-4 text-sm text-error">{formatWriteContractError(writeError)}</p>
        ) : null}
      </div>
    </div>
  )
}
