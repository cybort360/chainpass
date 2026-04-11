import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useAccount, useReadContract } from "wagmi"
import { QRCodeSVG } from "qrcode.react"
import { chainPassTicketAbi, monadTestnet } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"
import { routeMetaForRouteId, shortenNumericId } from "../lib/passDisplay"
import { requestQrPayload, type QrPayload } from "../lib/api"

export function PassPage() {
  const { tokenId: tokenIdStr } = useParams()
  const { address, isConnected } = useAccount()
  const contractAddress = getContractAddress()

  let tokenId: bigint
  try {
    tokenId = BigInt(tokenIdStr ?? "0")
  } catch {
    tokenId = 0n
  }

  const { data: owner, error: ownerError } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "ownerOf",
    args: [tokenId],
    query: { enabled: !!contractAddress && !!tokenIdStr },
  })

  const { data: routeId } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeOf",
    args: [tokenId],
    query: { enabled: !!contractAddress && !!tokenIdStr },
  })

  const { data: validUntil } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "validUntil",
    args: [tokenId],
    query: { enabled: !!contractAddress && !!tokenIdStr },
  })

  const [payload, setPayload] = useState<QrPayload | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  const refreshPayload = useCallback(async () => {
    if (!address || !tokenIdStr) return
    setQrError(null)
    const p = await requestQrPayload(tokenIdStr, address as `0x${string}`)
    if (!p) setQrError("Could not load QR payload. Is the API running with QR_SIGNING_SECRET set?")
    else setPayload(p)
  }, [address, tokenIdStr])

  useEffect(() => {
    void refreshPayload()
  }, [refreshPayload])

  useEffect(() => {
    if (!isConnected || !address) return
    const t = window.setInterval(() => void refreshPayload(), 22_000)
    return () => window.clearInterval(t)
  }, [isConnected, address, refreshPayload])

  const explorerBase = monadTestnet.blockExplorers?.default.url ?? "https://testnet.monadvision.com"

  if (!contractAddress) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-surface-container p-8 text-on-surface-variant">
        Configure <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code>.
      </div>
    )
  }

  const ownerAddr = owner && typeof owner === "string" ? owner : undefined
  const isOwner = address && ownerAddr && address.toLowerCase() === ownerAddr.toLowerCase()
  const vu = validUntil !== undefined && typeof validUntil === "bigint" ? validUntil : undefined
  const expired = vu !== undefined && BigInt(Math.floor(Date.now() / 1000)) > vu

  const routeIdStrResolved = routeId !== undefined ? String(routeId) : undefined
  const routeMeta = routeIdStrResolved ? routeMetaForRouteId(routeIdStrResolved) : undefined

  return (
    <div className="mx-auto min-w-0 max-w-lg px-1 sm:px-0">
      <Link to="/routes" className="font-headline text-sm font-medium text-primary hover:underline">
        ← Routes
      </Link>
      <h1 className="mt-4 font-headline text-3xl font-bold text-white">Your pass</h1>
      <p className="mt-2 text-sm text-on-surface-variant">
        Non-transferable ticket on Monad. Show this QR at the gate; it refreshes so screenshots go stale quickly.
      </p>

      {ownerError ? (
        <div className="mt-8 rounded-2xl bg-error/10 p-6 text-sm text-error">
          No ticket for this ID (burned or invalid).
        </div>
      ) : (
        <div className="mt-8 min-w-0 space-y-6">
          <div className="min-w-0 overflow-hidden rounded-2xl bg-surface-container p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Route</p>
            <p className="mt-1 font-headline text-xl font-bold leading-snug text-white">
              {routeMeta?.name ?? (routeIdStrResolved ? `Route ${shortenNumericId(routeIdStrResolved)}` : "…")}
            </p>
            {routeMeta?.category ? (
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-primary">{routeMeta.category}</p>
            ) : null}
            {routeMeta?.name && routeIdStrResolved ? (
              <p className="mt-2 font-mono text-xs text-on-surface-variant">
                Route ID {shortenNumericId(routeIdStrResolved)}
              </p>
            ) : null}

            <p className="mt-6 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Token</p>
            <p
              className="mt-1 font-mono text-base text-white sm:text-lg"
              title={tokenIdStr ? `Full token id: ${tokenIdStr}` : undefined}
            >
              #{tokenIdStr ? shortenNumericId(tokenIdStr) : "…"}
            </p>

            <p className="mt-6 text-xs font-bold uppercase tracking-widest text-on-surface-variant">Valid until</p>
            <p className="mt-1 font-mono text-sm text-white">
              {vu !== undefined
                ? `${new Date(Number(vu) * 1000).toLocaleString()} (${vu.toString()} epoch)`
                : "…"}
            </p>
            {expired ? <p className="mt-4 text-sm text-error">This ticket window has expired on-chain.</p> : null}
          </div>

          {!isConnected ? (
            <p className="text-sm text-tertiary">Connect the wallet that holds this ticket to show your QR.</p>
          ) : !isOwner ? (
            <p className="text-sm text-error">
              Connected wallet is not the holder of this ticket. Switch to the purchaser wallet.
            </p>
          ) : (
            <div className="rounded-2xl bg-surface-container-high p-6 text-center">
              <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Gate QR</p>
              <div className="mt-4 flex justify-center rounded-xl bg-white p-4">
                {payload ? (
                  <QRCodeSVG value={JSON.stringify(payload)} size={220} level="M" />
                ) : (
                  <div className="flex h-[220px] w-[220px] items-center justify-center text-sm text-zinc-500">
                    Loading…
                  </div>
                )}
              </div>
              {qrError ? <p className="mt-4 text-sm text-error">{qrError}</p> : null}
              <button
                type="button"
                className="mt-4 font-headline text-sm font-semibold text-primary hover:underline"
                onClick={() => void refreshPayload()}
              >
                Refresh QR
              </button>
            </div>
          )}

          <a
            className="block text-center font-headline text-sm text-on-surface-variant hover:text-primary"
            href={`${explorerBase}/token/${contractAddress}?a=${tokenIdStr}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            View on explorer
          </a>
        </div>
      )}
    </div>
  )
}
