import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useAccount, useReadContract } from "wagmi"
import { createPublicClient, webSocket } from "viem"
import { QRCodeSVG } from "qrcode.react"
import { chainPassTicketAbi, monadTestnet } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"
import { routeMetaForRouteId, shortenNumericId } from "../lib/passDisplay"
import { requestQrPayload, submitRating, fetchSeatAssignment, type QrPayload } from "../lib/api"
import { useOfflineQr } from "../hooks/useOfflineQr"
import { useNotifications } from "../hooks/useNotifications"
import { ExpiryWarningBanner } from "../components/ui/ExpiryWarningBanner"
import { SoulboundBadge } from "../components/ui/SoulboundBadge"
import { isExpiringSoon } from "../lib/passDisplay"

const wsClient = createPublicClient({
  chain: monadTestnet,
  transport: webSocket("wss://testnet-rpc.monad.xyz"),
})

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

/**
 * Returns a human countdown string ("3 days 14 hrs", "45 mins", "Expired")
 * and an urgency level for colour coding.
 */
function formatCountdown(vu: bigint | undefined): {
  text: string
  urgency: "ok" | "warning" | "critical" | "expired"
} {
  if (vu === undefined) return { text: "—", urgency: "ok" }
  const now = Math.floor(Date.now() / 1000)
  const secs = Number(vu) - now
  if (secs <= 0) return { text: "Expired", urgency: "expired" }

  const days  = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const mins  = Math.floor((secs % 3600)  / 60)

  let text: string
  if (days >= 1) {
    text = hours > 0 ? `${days}d ${hours}h left` : `${days}d left`
  } else if (hours >= 1) {
    text = mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`
  } else {
    text = `${mins}m left`
  }

  const urgency =
    secs < 2 * 3600   ? "critical" :
    secs < 24 * 3600  ? "warning"  : "ok"

  return { text, urgency }
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

  const tokenId = useMemo(() => {
    try { return BigInt(tokenIdStr ?? "0") }
    catch { return 0n }
  }, [tokenIdStr])

  // HTTP fallback — polls every 5s in case the WS subscription misses something
  const { data: owner, error: ownerError, refetch: refetchOwner } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "ownerOf",
    args: [tokenId],
    query: { enabled: !!contractAddress && !!tokenIdStr, refetchInterval: 5_000 },
  })

  // WebSocket subscription — fires the instant TicketBurned is emitted on-chain
  const [wsBurned, setWsBurned] = useState(false)
  useEffect(() => {
    if (!contractAddress || !tokenIdStr) return
    const unwatch = wsClient.watchContractEvent({
      address: contractAddress,
      abi: chainPassTicketAbi,
      eventName: "TicketBurned",
      args: { tokenId },
      onLogs: () => {
        setWsBurned(true)
        void refetchOwner()
      },
      onError: () => { /* WS error — HTTP polling is the fallback */ },
    })
    return unwatch
  }, [contractAddress, tokenId, refetchOwner])

  const burned = wsBurned || !!ownerError

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

  const { data: seatClassRaw } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "seatClassOf",
    args: [tokenId],
    query: { enabled: !!contractAddress && !!tokenIdStr },
  })
  const seatClass = (seatClassRaw as number | undefined) === 1 ? "Business" : "Economy"

  const [assignedSeat, setAssignedSeat] = useState<string | null>(null)
  useEffect(() => {
    if (!tokenIdStr) return
    void fetchSeatAssignment(tokenIdStr).then(setAssignedSeat)
  }, [tokenIdStr])

  // Persist route/time info so we can show it on the "Trip complete" screen after burn
  const burnedInfoRef = useRef<{ routeName: string; usedAt: Date } | null>(null)

  const [shareCopied, setShareCopied] = useState(false)
  const [ratingValue, setRatingValue] = useState<number | null>(null)
  const [ratingSubmitted, setRatingSubmitted] = useState(false)
  const [ratingPending, setRatingPending] = useState(false)

  const [payload, setPayload] = useState<QrPayload | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrRefreshedAt, setQrRefreshedAt] = useState<number>(Date.now())
  const [, setTick] = useState(0)

  const { persist, recall } = useOfflineQr(tokenIdStr)
  const { permission: notifPermission, requestPermission, scheduleExpiryNotification } = useNotifications()

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

  // Schedule expiry notification — must be before any conditional return (hooks rule)
  const _vuForNotif = validUntil !== undefined && typeof validUntil === "bigint" ? validUntil : undefined
  const _routeIdStrForNotif = routeId !== undefined ? String(routeId) : undefined
  const _routeNameForNotif = _routeIdStrForNotif
    ? (routeMetaForRouteId(_routeIdStrForNotif)?.name ?? `Route #${shortenNumericId(_routeIdStrForNotif)}`)
    : undefined
  useEffect(() => {
    if (!_vuForNotif || !tokenIdStr || !_routeNameForNotif || burned || notifPermission !== "granted") return
    scheduleExpiryNotification(tokenIdStr, _routeNameForNotif, _vuForNotif)
  }, [_vuForNotif, tokenIdStr, _routeNameForNotif, burned, notifPermission, scheduleExpiryNotification])

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

  // Snapshot while ticket is live so it shows on the scan-complete screen after burn
  if (routeName && !burned && !burnedInfoRef.current) {
    burnedInfoRef.current = { routeName, usedAt: new Date() }
  }

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

      {burned ? (
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
                  <p className="font-headline text-xs font-bold uppercase tracking-widest text-tertiary">Scan complete</p>
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
                <p className="text-sm text-on-surface-variant">Ticket scanned successfully. <span className="font-semibold text-white">You're good to board!</span></p>
              </div>
            </div>

            {/* Star rating widget */}
            {tokenIdStr && routeIdStr && !ratingSubmitted && (
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container px-5 py-4 text-center">
                <p className="font-headline text-xs font-semibold uppercase tracking-widest text-on-surface-variant mb-3">
                  Rate this trip
                </p>
                <div className="flex items-center justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      disabled={ratingPending}
                      aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      onClick={() => {
                        setRatingValue(star)
                        setRatingPending(true)
                        void submitRating(tokenIdStr, routeIdStr, star).then(() => {
                          setRatingSubmitted(true)
                          setRatingPending(false)
                        })
                      }}
                      className="text-2xl leading-none transition-transform hover:scale-125 disabled:cursor-wait"
                    >
                      <span className={ratingValue !== null && star <= ratingValue ? "text-amber-400" : "text-on-surface-variant/40"}>
                        {ratingValue !== null && star <= ratingValue ? "★" : "☆"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {ratingSubmitted && (
              <p className="text-center text-sm text-tertiary font-semibold">Thanks for your feedback!</p>
            )}

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

          {/* Shared pass banner — shown to viewers who are not the holder */}
          {!isOwner && ownerAddr && (
            <div className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="shrink-0 text-primary" aria-hidden>
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              <p className="text-xs text-on-surface-variant">
                Shared pass · held by{" "}
                <span className="font-mono font-semibold text-white">
                  {ownerAddr.slice(0, 6)}…{ownerAddr.slice(-4)}
                </span>
              </p>
            </div>
          )}

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
                  <p className={`mt-1 font-headline text-xs font-semibold ${seatClass === "Business" ? "text-amber-300" : "text-white"}`}>
                    {seatClass === "Business" ? "✦ Business" : "Economy"}
                  </p>
                  {assignedSeat && (
                    <p className="mt-0.5 font-headline text-[10px] font-semibold text-amber-300/70">
                      Seat {assignedSeat}
                    </p>
                  )}
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
                  <p className="mt-1 font-headline text-xs font-semibold text-white" title={formatEpoch(vu)}>
                    {(() => {
                      const { text, urgency } = formatCountdown(vu)
                      return (
                        <span className={
                          urgency === "expired"  ? "text-error" :
                          urgency === "critical" ? "text-error" :
                          urgency === "warning"  ? "text-amber-400" : "text-white"
                        }>
                          {text}
                        </span>
                      )
                    })()}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] text-on-surface-variant/50">{formatEpoch(vu)}</p>
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
              {isOwner ? (
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

                  {/* Notification opt-in (only shown once, only while active) */}
                  {notifPermission === "default" && !expired && (
                    <button
                      type="button"
                      onClick={() => void requestPermission()}
                      className="flex w-full items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs text-on-surface-variant transition-colors hover:bg-primary/10"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className="shrink-0 text-primary" aria-hidden>
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      <span className="flex-1">Get notified before this ticket expires</span>
                      <span className="font-semibold text-primary">Enable →</span>
                    </button>
                  )}

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
              ) : (
                /* ── Read-only shared pass view (non-owner) ── */
                <div className="space-y-3">
                  <div className="rounded-xl border border-outline-variant/20 bg-surface-container-high px-4 py-4 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className="text-primary" aria-hidden>
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                      </svg>
                    </div>
                    <p className="font-headline text-sm font-semibold text-white">Shared pass preview</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      QR code is only visible to the ticket holder.
                    </p>
                    {ownerAddr && (
                      <p className="mt-2 font-mono text-[10px] text-on-surface-variant/60">
                        Held by {ownerAddr.slice(0, 8)}…{ownerAddr.slice(-6)}
                      </p>
                    )}
                  </div>
                  {!isConnected && (
                    <p className="text-center text-xs text-on-surface-variant">
                      Connect as the ticket holder to show the boarding QR.
                    </p>
                  )}
                  {isConnected && !isOwner && (
                    <p className="text-center text-xs text-on-surface-variant">
                      Switch to the holder wallet to show the boarding QR.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer: explorer + share */}
          <div className="flex items-center justify-center gap-5">
            <a className="font-headline text-xs text-on-surface-variant hover:text-primary transition-colors"
              href={`${explorerBase}/token/${contractAddress}?a=${tokenIdStr}`}
              rel="noopener noreferrer" target="_blank">
              View on MonadVision ↗
            </a>
            <span className="text-outline-variant/30">·</span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(window.location.href)
                setShareCopied(true)
                window.setTimeout(() => setShareCopied(false), 2000)
              }}
              className="inline-flex items-center gap-1.5 font-headline text-xs text-on-surface-variant hover:text-primary transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              {shareCopied ? "Copied!" : "Share pass"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
