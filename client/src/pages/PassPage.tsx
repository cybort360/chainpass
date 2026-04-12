import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useAccount, useReadContract } from "wagmi"
import { QRCodeSVG } from "qrcode.react"
import { chainPassTicketAbi, monadTestnet } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"
import { routeMetaForRouteId, shortenNumericId } from "../lib/passDisplay"
import { requestQrPayload, type QrPayload } from "../lib/api"
import { useOfflineQr } from "../hooks/useOfflineQr"
import { ExpiryWarningBanner } from "../components/ui/ExpiryWarningBanner"
import { SoulboundBadge } from "../components/ui/SoulboundBadge"
import { isExpiringSoon } from "../lib/passDisplay"

/** Derive a 3-letter route code from the route name (like airport code). */
function toRouteCode(name: string | undefined): string {
  if (!name) return "???"
  const clean = name.replace(/[^a-zA-Z\s]/g, " ").trim()
  const words = clean.split(/\s+/)
  if (words.length >= 2) {
    return (words[0].slice(0, 2) + words[1].slice(0, 1)).toUpperCase()
  }
  return clean.slice(0, 3).toUpperCase().padEnd(3, "X")
}

/** Extract origin/destination from route name like "Lagos – Abuja" */
function splitRouteName(name: string): { from: string; to: string } {
  const sep = name.match(/[-–—→]/)
  if (sep) {
    const i = name.indexOf(sep[0])
    return { from: name.slice(0, i).trim(), to: name.slice(i + 1).trim() }
  }
  const words = name.trim().split(/\s+/)
  const half = Math.floor(words.length / 2)
  return {
    from: words.slice(0, Math.max(1, half)).join(" "),
    to: words.slice(Math.max(1, half)).join(" ") || name,
  }
}

function formatEpoch(vu: bigint | undefined): string {
  if (vu === undefined) return "—"
  return new Date(Number(vu) * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  })
}


function QrCountdownRing({ totalSec, elapsedSec }: { totalSec: number; elapsedSec: number }) {
  const r = 10
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, 1 - elapsedSec / totalSec))
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="-rotate-90" aria-hidden>
      <circle cx="14" cy="14" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
      <circle cx="14" cy="14" r={r} fill="none" stroke="#a1faff" strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
        strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s linear" }} />
    </svg>
  )
}

export function PassPage() {
  const { tokenId: tokenIdStr } = useParams()
  const { address, isConnected } = useAccount()
  const contractAddress = getContractAddress()

  let tokenId: bigint
  try { tokenId = BigInt(tokenIdStr ?? "0") }
  catch { tokenId = 0n }

  // Poll every 3s so we detect the burn immediately when conductor scans
  const { data: owner, error: ownerError } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "ownerOf",
    args: [tokenId],
    query: { enabled: !!contractAddress && !!tokenIdStr, refetchInterval: 3_000 },
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

  // Persist route/time info so we can show it on the "Trip complete" screen after burn
  const burnedInfoRef = useRef<{ routeName: string; usedAt: Date } | null>(null)

  const [payload, setPayload] = useState<QrPayload | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrRefreshedAt, setQrRefreshedAt] = useState<number>(Date.now())
  const [, setTick] = useState(0)

  const { persist, recall } = useOfflineQr(tokenIdStr)

  const refreshPayload = useCallback(async () => {
    if (!address || !tokenIdStr) return
    setQrError(null)
    const p = await requestQrPayload(tokenIdStr, address as `0x${string}`)
    if (!p) {
      const cached = recall()
      if (cached) {
        setPayload(cached)
        setQrRefreshedAt(Date.now())
        setQrError("Offline — showing cached QR. Reconnect to refresh.")
      } else {
        setQrError("Could not load QR. Is the API running with QR_SIGNING_SECRET set?")
      }
    } else {
      setPayload(p)
      setQrRefreshedAt(Date.now())
      persist(p)
      setQrError(null)
    }
  }, [address, tokenIdStr, persist, recall])

  useEffect(() => { void refreshPayload() }, [refreshPayload])

  // Snapshot route info while the ticket is live so it's available after burn
  useEffect(() => {
    if (routeName && owner) {
      burnedInfoRef.current = { routeName, usedAt: new Date() }
    }
  }, [routeName, owner])

  // Pre-populate from cache for instant display on re-visit
  useEffect(() => {
    const cached = recall()
    if (cached && !payload) setPayload(cached)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-refresh every 22s
  useEffect(() => {
    if (!isConnected || !address) return
    const t = window.setInterval(() => void refreshPayload(), 22_000)
    return () => window.clearInterval(t)
  }, [isConnected, address, refreshPayload])

  // Tick every second for countdown ring
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  const explorerBase = monadTestnet.blockExplorers?.default.url ?? "https://testnet.monadvision.com"

  if (!contractAddress) {
    return (
      <div className="mx-auto max-w-sm rounded-2xl bg-surface-container p-8 text-center text-sm text-on-surface-variant">
        Configure <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code>.
      </div>
    )
  }

  const ownerAddr = owner && typeof owner === "string" ? owner : undefined
  const isOwner = address && ownerAddr && address.toLowerCase() === ownerAddr.toLowerCase()
  const vu = validUntil !== undefined && typeof validUntil === "bigint" ? validUntil : undefined
  const expired = vu !== undefined && BigInt(Math.floor(Date.now() / 1000)) >= vu

  const routeIdStr = routeId !== undefined ? String(routeId) : undefined
  const routeMeta = routeIdStr ? routeMetaForRouteId(routeIdStr) : undefined
  const routeName = routeMeta?.name ?? (routeIdStr ? `Route ${shortenNumericId(routeIdStr)}` : undefined)
  const { from: fromCity, to: toCity } = routeName ? splitRouteName(routeName) : { from: "—", to: "—" }
  const fromCode = toRouteCode(fromCity)
  const toCode = toRouteCode(toCity)


  const qrElapsed = Math.floor((Date.now() - qrRefreshedAt) / 1000)

  return (
    <div className="mx-auto min-w-0 max-w-md px-1 sm:px-0">
      {/* Back */}
      <Link to="/profile"
        className="inline-flex items-center gap-1.5 font-headline text-sm font-medium text-on-surface-variant hover:text-white transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        My passes
      </Link>

      {ownerError ? (
        burnedInfoRef.current ? (
          /* ── Trip complete screen (ticket was burned by conductor) ── */
          <div className="mt-8 space-y-4">
            <div className="overflow-hidden rounded-3xl border border-tertiary/30 bg-surface-container shadow-xl shadow-black/30">
              {/* Success strip */}
              <div className="bg-gradient-to-r from-tertiary/25 via-tertiary/10 to-transparent px-5 py-4 flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tertiary/20">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-tertiary" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <p className="font-headline text-xs font-bold uppercase tracking-widest text-tertiary">Trip complete</p>
                  <p className="font-headline text-lg font-bold text-white leading-snug">
                    {burnedInfoRef.current.routeName}
                  </p>
                </div>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 divide-x divide-outline-variant/15 border-t border-outline-variant/15">
                <div className="px-5 py-4">
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Boarded at</p>
                  <p className="mt-1 font-headline text-sm font-semibold text-white">
                    {burnedInfoRef.current.usedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">
                    {burnedInfoRef.current.usedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                </div>
                <div className="px-5 py-4">
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Token</p>
                  <p className="mt-1 font-mono text-sm text-white">#{tokenIdStr ? shortenNumericId(tokenIdStr) : "—"}</p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">Single-use · burned</p>
                </div>
              </div>

              {/* Bottom message */}
              <div className="border-t border-outline-variant/15 bg-tertiary/5 px-5 py-4 text-center">
                <p className="text-sm text-on-surface-variant">Your ticket has been scanned. <span className="font-semibold text-white">Have a safe trip!</span></p>
              </div>
            </div>

            <div className="flex items-center justify-center gap-4">
              <Link to="/routes"
                className="font-headline text-sm font-semibold text-primary hover:underline">
                Buy another ticket →
              </Link>
              <span className="text-outline-variant/40">·</span>
              <Link to="/profile"
                className="font-headline text-sm text-on-surface-variant hover:text-white">
                My passes
              </Link>
            </div>
          </div>
        ) : (
          /* ── Token not found (invalid ID) ── */
          <div className="mt-8 rounded-2xl border border-error/30 bg-error/8 p-8 text-center">
            <p className="font-headline font-semibold text-white">Ticket not found</p>
            <p className="mt-1 text-sm text-on-surface-variant">Invalid token ID.</p>
            <Link to="/profile" className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline">
              ← My passes
            </Link>
          </div>
        )
      ) : (
        <div className="mt-5 min-w-0 space-y-4">

          {isExpiringSoon(vu) && (
            <ExpiryWarningBanner validUntilEpoch={vu} variant="banner" />
          )}

          {/* ── Boarding pass card ── */}
          <div className="overflow-hidden rounded-3xl border border-outline-variant/20 bg-surface-container shadow-xl shadow-black/30">

            {/* Top strip: brand + status */}
            <div className="flex items-center justify-between bg-gradient-to-r from-primary/25 via-primary/10 to-transparent px-5 py-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/80">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 10h18M3 14h18M10 3v18M14 3v18" />
                  </svg>
                </div>
                <span className="font-headline text-xs font-bold uppercase tracking-widest text-white/80">
                  ChainPass Transit
                </span>
              </div>
              {vu !== undefined && (
                expired ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-error/30 bg-error/10 px-2.5 py-0.5 font-headline text-[10px] font-bold uppercase tracking-wide text-error">
                    Expired
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-tertiary/30 bg-tertiary/10 px-2.5 py-0.5 font-headline text-[10px] font-bold uppercase tracking-wide text-tertiary">
                    <span className="h-1.5 w-1.5 rounded-full bg-tertiary" aria-hidden />
                    Active
                  </span>
                )
              )}
            </div>

            {/* Route section */}
            <div className="px-5 py-5">
              <div className="flex items-center gap-2">
                {/* FROM */}
                <div className="min-w-0 flex-1">
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                    From
                  </p>
                  <p className="mt-1 font-headline text-2xl font-bold tracking-tight text-white leading-none">
                    {fromCode}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant truncate">{fromCity}</p>
                </div>

                {/* Bus + progress line */}
                <div className="flex shrink-0 flex-col items-center gap-1 px-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                    className="text-primary" aria-hidden>
                    <rect x="1" y="7" width="22" height="11" rx="2" />
                    <path d="M5 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
                    <circle cx="7" cy="18" r="1.5" />
                    <circle cx="17" cy="18" r="1.5" />
                  </svg>
                  <div className="flex items-center gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
                    <div className="h-px w-10 bg-gradient-to-r from-primary via-primary/50 to-outline-variant/40" aria-hidden />
                    <span className="h-1 w-1 rounded-full bg-outline-variant/60" aria-hidden />
                  </div>
                </div>

                {/* TO */}
                <div className="min-w-0 flex-1 text-right">
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                    To
                  </p>
                  <p className="mt-1 font-headline text-2xl font-bold tracking-tight text-white leading-none">
                    {toCode}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant truncate">{toCity}</p>
                </div>
              </div>

              {/* Metadata row */}
              <div className="mt-5 grid grid-cols-3 border-t border-outline-variant/15 pt-4 text-center">
                <div>
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Class
                  </p>
                  <p className="mt-1 font-headline text-xs font-semibold text-white">
                    {routeMeta?.category ?? "Economy"}
                  </p>
                </div>
                <div className="border-x border-outline-variant/15">
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Token
                  </p>
                  <p className="mt-1 font-mono text-xs text-white" title={tokenIdStr}>
                    #{tokenIdStr ? shortenNumericId(tokenIdStr) : "…"}
                  </p>
                </div>
                <div>
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Valid until
                  </p>
                  <p className="mt-1 font-headline text-xs font-semibold text-white">
                    {formatEpoch(vu)}
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t border-outline-variant/10 pt-3">
                <SoulboundBadge />
              </div>
            </div>

            {/* Perforated divider */}
            <div className="relative px-4">
              <div className="ticket-perforated border-t border-dashed border-outline-variant/25" />
            </div>

            {/* QR section */}
            <div className="px-5 py-5">
              {!isConnected ? (
                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-high py-8 text-center">
                  <p className="text-sm text-on-surface-variant">Connect the wallet that holds this ticket.</p>
                </div>
              ) : !isOwner ? (
                <div className="rounded-xl border border-error/20 bg-error/8 py-6 text-center">
                  <p className="text-sm text-error">
                    This wallet is not the ticket holder. Switch to the purchaser wallet.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  {/* QR with ring */}
                  <div className="relative">
                    <div className="relative flex items-center justify-center rounded-2xl bg-white p-4 shadow-[0_0_40px_rgba(110,84,255,0.2)]">
                      {payload ? (
                        <QRCodeSVG value={JSON.stringify(payload)} size={200} level="M" />
                      ) : (
                        <div className="flex h-[200px] w-[200px] items-center justify-center">
                          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-500" />
                        </div>
                      )}
                    </div>
                    {/* Countdown ring overlay */}
                    {payload && (
                      <div className="absolute -right-2 -top-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-container border border-outline-variant/30">
                        <QrCountdownRing totalSec={22} elapsedSec={qrElapsed} />
                      </div>
                    )}
                  </div>

                  {qrError && <p className="text-center text-xs text-error">{qrError}</p>}

                  <div className="text-center space-y-1">
                    <p className="text-[10px] text-on-surface-variant">
                      Show this QR at the gate · auto-refreshes every 22s
                    </p>
                    <button type="button" onClick={() => void refreshPayload()}
                      className="inline-flex items-center gap-1.5 font-headline text-xs font-semibold text-primary hover:underline">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                      Refresh now
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Explorer link */}
          <a className="block text-center font-headline text-xs text-on-surface-variant hover:text-primary transition-colors"
            href={`${explorerBase}/token/${contractAddress}?a=${tokenIdStr}`}
            rel="noopener noreferrer" target="_blank">
            View on MonadVision ↗
          </a>
        </div>
      )}
    </div>
  )
}
