import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { monadTestnet, chainPassTicketAbi } from "@chainpass/shared"

import { fetchMyPasses, fetchRouteLabels, type MyPassesResponse } from "../lib/api"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { fetchActivePassesFromChain } from "../lib/onchainPasses"
import { routeMetaForRouteId, shortenNumericId } from "../lib/passDisplay"
import { isExpiringSoon } from "../lib/passDisplay"
import { extractMintedTokenIdFromReceipt } from "../lib/tx"
import { formatWriteContractError } from "../lib/walletError"
import { ExpiryWarningBanner } from "../components/ui/ExpiryWarningBanner"
import { TierCard } from "../components/ui/TierCard"
import { useLoyalty } from "../hooks/useLoyalty"
import { useNotifications } from "../hooks/useNotifications"
import { DEMO_ROUTES } from "../constants/demoRoutes"

const REFETCH_MS = 8000
const explorerTxBase = `${monadTestnet.blockExplorers.default.url}/tx`

type TabId = "active" | "used" | "history"

function formatEpoch(epoch: string | number | null | undefined): string {
  if (!epoch) return "—"
  const d = new Date(Number(epoch) * 1000)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-outline-variant/15 bg-surface-container p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="skeleton h-4 w-1/2 rounded" />
          <div className="skeleton h-3 w-1/3 rounded" />
        </div>
        <div className="skeleton h-6 w-14 rounded-full" />
      </div>
      <div className="mt-4 border-t border-outline-variant/10 pt-4 grid grid-cols-3 gap-3">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-full rounded" />
      </div>
    </div>
  )
}

export function ProfilePage() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const navigate = useNavigate()
  const contractAddress = getContractAddress()
  const [data, setData] = useState<MyPassesResponse | null>(null)
  const [expiredPasses, setExpiredPasses] = useState<NonNullable<MyPassesResponse["active"]>>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>("active")

  // ── Notifications ─────────────────────────────────────────────────────────
  const { permission: notifPermission, requestPermission, scheduleExpiryNotification } = useNotifications()

  // Schedule expiry notifications whenever the active pass list changes
  useEffect(() => {
    if (!data?.active.length || notifPermission !== "granted") return
    for (const pass of data.active) {
      if (!pass.valid_until_epoch || !pass.token_id) continue
      const routeName = routeMetaForRouteId(pass.route_id ?? "")?.name ??
        (pass.route_id ? `Route #${pass.route_id.slice(0, 6)}` : "your pass")
      scheduleExpiryNotification(pass.token_id, routeName, BigInt(pass.valid_until_epoch))
    }
  }, [data?.active, notifPermission, scheduleExpiryNotification])

  // ── Loyalty ───────────────────────────────────────────────────────────────
  const { data: loyaltyData, isLoading: loyaltyLoading, refetch: refetchLoyalty } = useLoyalty(address)

  // ── Claim free ride ───────────────────────────────────────────────────────
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimRouteId, setClaimRouteId] = useState<string>("")
  const [apiRouteLabels, setApiRouteLabels] = useState<{ routeId: string; name: string; category: string }[] | undefined>(undefined)

  // Merge API + demo routes for the picker
  const allRoutes = useMemo(() => {
    const byId = new Map<string, { routeId: string; name: string; category: string }>()
    for (const r of apiRouteLabels ?? []) byId.set(r.routeId, r)
    for (const r of DEMO_ROUTES) if (!byId.has(r.routeId)) byId.set(r.routeId, r)
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [apiRouteLabels])

  // Fetch API route labels once on mount
  useEffect(() => {
    void fetchRouteLabels().then((labels) => {
      if (labels) setApiRouteLabels(labels)
    })
  }, [])

  // Auto-select first route when list loads
  useEffect(() => {
    if (claimRouteId === "" && allRoutes.length > 0) {
      setClaimRouteId(allRoutes[0].routeId)
    }
  }, [allRoutes, claimRouteId])

  const claimValidUntil = useMemo(
    () => BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60) as bigint,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claimOpen], // recompute when modal opens
  )

  const {
    data: claimHash,
    writeContractAsync: writeClaimAsync,
    isPending: claimPending,
    error: claimError,
    reset: resetClaim,
  } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimSuccess, data: claimReceipt } =
    useWaitForTransactionReceipt({ hash: claimHash })

  // Navigate to pass page after successful claim
  const navigatedRef = useRef(false)
  useEffect(() => {
    if (!claimSuccess || !claimReceipt || !contractAddress || navigatedRef.current) return
    navigatedRef.current = true
    const tokenId = extractMintedTokenIdFromReceipt(claimReceipt.logs, contractAddress)
    void refetchLoyalty()
    if (tokenId !== null) navigate(`/pass/${tokenId.toString()}`)
    else { setClaimOpen(false); resetClaim() }
  }, [claimSuccess, claimReceipt, contractAddress, navigate, refetchLoyalty, resetClaim])

  const onClaim = useCallback(async () => {
    if (!contractAddress || !claimRouteId) return
    navigatedRef.current = false
    resetClaim()
    try {
      await writeClaimAsync({
        address: contractAddress,
        abi: chainPassTicketAbi,
        functionName: "claimFreeRide",
        args: [BigInt(claimRouteId), claimValidUntil as bigint, (env.defaultOperator as `0x${string}`) || "0x0000000000000000000000000000000000000000"],
      })
    } catch {
      // error surfaced via claimError
    }
  }, [contractAddress, claimRouteId, claimValidUntil, resetClaim, writeClaimAsync])

  const load = useCallback(
    async (mode: "initial" | "poll" | "manual") => {
      if (!address) return
      if (mode === "manual") setRefreshing(true)
      if (mode === "initial") setLoading(true)

      const ticket = getContractAddress()
      const api = await fetchMyPasses(address)
      const used = api?.used ?? []

      if (ticket && publicClient) {
        const chainActive = await fetchActivePassesFromChain(publicClient, ticket, address)
        if (chainActive === null) {
          setErr("Could not read NFTs from the chain (RPC error). Check your connection.")
          setData({ holder: address, active: [], used })
          setExpiredPasses([])
        } else {
          const now = Math.floor(Date.now() / 1000)
          const activeOnly = chainActive.filter(
            (p) => !p.valid_until_epoch || Number(p.valid_until_epoch) > now
          )
          const expired = chainActive.filter(
            (p) => p.valid_until_epoch !== null && Number(p.valid_until_epoch) <= now
          )
          setErr(null)
          setData({ holder: address, active: activeOnly, used })
          setExpiredPasses(expired)
        }
      } else {
        const active = api?.active ?? []
        if (!api) {
          setErr("Could not load passes. Set VITE_CHAINPASS_CONTRACT_ADDRESS or run the API.")
          setData(null)
        } else {
          setErr(null)
          setData({ holder: address, active, used })
        }
      }
      setLastUpdated(new Date())
      setLoading(false)
      setRefreshing(false)
    },
    [address, publicClient],
  )

  useEffect(() => {
    if (!isConnected || !address) return
    const id = window.setTimeout(() => { void load("initial") }, 0)
    return () => window.clearTimeout(id)
  }, [isConnected, address, load])

  useEffect(() => {
    if (!isConnected || !address) return
    const id = window.setInterval(() => { void load("poll") }, REFETCH_MS)
    return () => window.clearInterval(id)
  }, [isConnected, address, load])

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-lg">
        <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Profile</p>
        <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">My passes</h1>
        <div className="mt-8 rounded-2xl border border-outline-variant/20 bg-surface-container p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden>
              <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9z" />
              <line x1="9" y1="7" x2="9" y2="17" strokeDasharray="2 2" />
            </svg>
          </div>
          <p className="font-headline font-semibold text-white">Connect your wallet</p>
          <p className="mt-1 text-sm text-on-surface-variant">
            See your active tickets and burned history.
          </p>
          <p className="mt-4 text-xs text-on-surface-variant/60">Use the connect button in the header.</p>
        </div>
      </div>
    )
  }

  const activeCount = data?.active.length ?? 0
  const usedCount = data?.used.length ?? 0
  const historyCount = expiredPasses.length + usedCount

  return (
    <div className="mx-auto max-w-lg">
      {/* Header */}
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Profile</p>
          <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">My passes</h1>
        </div>
        <div className="flex items-center gap-2.5 pb-1">
          {lastUpdated && (
            <p className="text-[10px] text-on-surface-variant/60">
              {lastUpdated.toLocaleTimeString()}
            </p>
          )}
          <button type="button"
            disabled={refreshing || loading}
            onClick={() => void load("manual")}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container px-3 font-headline text-xs font-semibold text-on-surface-variant transition-colors hover:border-primary/40 hover:text-white disabled:opacity-50">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={refreshing ? "animate-spin" : ""} aria-hidden>
              <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {refreshing ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Tier card */}
      {isConnected && address && (
        loyaltyLoading && !loyaltyData ? (
          <div className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container p-5">
            <div className="flex items-center gap-3">
              <div className="skeleton h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-5 w-16 rounded" />
              </div>
              <div className="skeleton h-8 w-12 rounded" />
            </div>
            <div className="mt-4 skeleton h-2 w-full rounded-full" />
          </div>
        ) : loyaltyData ? (
          <TierCard
            data={loyaltyData}
            onClaim={() => { resetClaim(); setClaimOpen(true) }}
            claiming={claimPending || claimConfirming}
          />
        ) : null
      )}

      {/* Claim free ride modal */}
      {claimOpen && loyaltyData && loyaltyData.available > 0 && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget && !claimPending && !claimConfirming) { setClaimOpen(false); resetClaim() } }}>
          <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-outline-variant/20 bg-surface-container sm:rounded-3xl">
            {/* Header */}
            <div className={`border-b ${loyaltyData.tier.border} bg-gradient-to-r from-${loyaltyData.tier.bg}/20 to-transparent px-5 py-4 flex items-center gap-3`}>
              <span className="text-xl" role="img" aria-label="free ride">{loyaltyData.tier.icon}</span>
              <div>
                <p className={`font-headline text-[10px] font-bold uppercase tracking-widest ${loyaltyData.tier.color}`}>
                  {loyaltyData.available} credit{loyaltyData.available !== 1 ? "s" : ""} available
                </p>
                <p className="font-headline text-lg font-bold text-white leading-snug">Claim free ride</p>
              </div>
              <button type="button"
                className="ml-auto rounded-lg p-1.5 text-on-surface-variant hover:text-white transition-colors"
                onClick={() => { setClaimOpen(false); resetClaim() }}
                disabled={claimPending || claimConfirming}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <p className="text-sm text-on-surface-variant">
                Choose a route and your free ticket will be minted on-chain instantly — no payment needed.
              </p>

              {/* Route picker */}
              <label className="block">
                <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Select route
                </span>
                <select
                  className="mt-1.5 w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 text-sm text-white focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
                  value={claimRouteId}
                  onChange={(e) => setClaimRouteId(e.target.value)}
                  disabled={claimPending || claimConfirming}
                >
                  {allRoutes.map((r) => (
                    <option key={r.routeId} value={r.routeId}>
                      {r.name}{r.category ? ` — ${r.category}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {/* Valid for note */}
              <p className="text-xs text-on-surface-variant/60">
                Ticket will be valid for 7 days from the moment of claiming.
              </p>

              {claimError && (
                <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                  <p className="text-xs text-error break-words">{formatWriteContractError(claimError)}</p>
                </div>
              )}

              {/* CTA */}
              <button
                type="button"
                disabled={!claimRouteId || claimPending || claimConfirming}
                onClick={() => void onClaim()}
                className="w-full rounded-2xl bg-white px-6 py-4 font-headline text-base font-bold text-zinc-900 shadow-lg transition-all hover:bg-white/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {claimPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
                    Confirm in wallet…
                  </span>
                ) : claimConfirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
                    Minting on-chain…
                  </span>
                ) : (
                  "Claim free ride →"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification permission prompt */}
      {notifPermission === "default" && data?.active && data.active.length > 0 && (
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 text-primary" aria-hidden>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p className="flex-1 text-xs text-on-surface-variant">
            Get notified before your tickets expire.
          </p>
          <button
            type="button"
            onClick={() => void requestPermission()}
            className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 font-headline text-xs font-bold text-primary transition-colors hover:bg-primary/20"
          >
            Enable
          </button>
        </div>
      )}

      {/* Error */}
      {err && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-error/25 bg-error/8 p-4">
          <span className="material-symbols-outlined mt-0.5 text-base text-error shrink-0" aria-hidden>error</span>
          <p className="text-xs leading-relaxed text-error">{err}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-5 flex gap-1 rounded-xl bg-surface-container p-1">
        {([
          { id: "active" as TabId,  label: "Active",  count: activeCount  },
          { id: "history" as TabId, label: "History", count: historyCount },
          { id: "used" as TabId,    label: "Burned",  count: usedCount    },
        ] as const).map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 font-headline text-sm font-semibold transition-all ${
              tab === t.id
                ? "bg-surface-container-highest text-white shadow-sm"
                : "text-on-surface-variant hover:text-white"
            }`}>
            {t.label}
            {!loading && data && (
              <span className={`min-w-[18px] rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                tab === t.id ? "bg-primary/20 text-primary" : "bg-surface-container-highest text-on-surface-variant"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {/* Active passes */}
      {!loading && tab === "active" && data && (
        <>
          {data.active.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/15 bg-surface-container py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container-high">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  className="text-on-surface-variant" aria-hidden>
                  <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9z" />
                </svg>
              </div>
              <p className="font-headline text-sm font-medium text-on-surface-variant">No active passes</p>
              <Link to="/routes" className="mt-3 inline-block font-headline text-xs font-semibold text-primary hover:underline">
                Browse routes →
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {data.active.map((row) => {
                const routeName =
                  routeMetaForRouteId(row.route_id ?? undefined)?.name ??
                  (row.route_id ? `Route ${shortenNumericId(row.route_id)}` : "Transit pass")
                return (
                  <li key={`a-${row.token_id}-${row.tx_hash || "chain"}`}>
                    <div className="overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container transition-all hover:border-primary/20">
                      {/* Ticket top strip */}
                      <div className="bg-gradient-to-r from-primary/20 to-primary/5 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-headline text-sm font-bold leading-snug text-white">{routeName}</p>
                          <div className="flex shrink-0 items-center gap-2">
                            {isExpiringSoon(row.valid_until_epoch) && (
                              <ExpiryWarningBanner validUntilEpoch={row.valid_until_epoch} variant="badge" />
                            )}
                            <span className="inline-flex items-center gap-1 rounded-full border border-tertiary/30 bg-tertiary/10 px-2.5 py-0.5 font-headline text-[10px] font-bold uppercase tracking-wide text-tertiary">
                              <span className="h-1.5 w-1.5 rounded-full bg-tertiary" aria-hidden />
                              Active
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Ticket body */}
                      <div className="grid grid-cols-3 divide-x divide-outline-variant/15 px-1 py-3 text-center">
                        <div className="px-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                            Token
                          </p>
                          <p className="mt-1 font-mono text-xs text-white" title={`Full: ${row.token_id}`}>
                            #{shortenNumericId(row.token_id)}
                          </p>
                        </div>
                        <div className="px-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                            Valid until
                          </p>
                          <p className="mt-1 text-xs text-white">
                            {formatEpoch(row.valid_until_epoch)}
                          </p>
                        </div>
                        <div className="px-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                            Block
                          </p>
                          <p className="mt-1 font-mono text-xs text-white">
                            {row.block_number ?? "Live"}
                          </p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between border-t border-outline-variant/15 px-4 py-2.5">
                        {row.tx_hash ? (
                          <a href={`${explorerTxBase}/${row.tx_hash}`} target="_blank" rel="noreferrer"
                            className="font-headline text-xs text-on-surface-variant hover:text-primary">
                            Tx ↗
                          </a>
                        ) : <span />}
                        <Link to={`/pass/${row.token_id}`}
                          className="flex items-center gap-1 font-headline text-xs font-bold text-primary hover:underline">
                          Show QR
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {/* History tab — expired (still held) + burned */}
      {!loading && tab === "history" && (
        <>
          {historyCount === 0 ? (
            <div className="rounded-2xl border border-outline-variant/15 bg-surface-container py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container-high">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  className="text-on-surface-variant" aria-hidden>
                  <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <p className="font-headline text-sm font-medium text-on-surface-variant">No travel history yet</p>
              <p className="mt-1 text-xs text-on-surface-variant/60">Expired and burned tickets will appear here.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-[19px] top-3 bottom-3 w-px bg-outline-variant/20" aria-hidden />
              <ul className="space-y-3 pl-0">
                {/* Expired-but-still-held passes */}
                {expiredPasses.map((row) => {
                  const meta = routeMetaForRouteId(row.route_id ?? undefined)
                  const routeName = meta?.name ?? (row.route_id ? `Route ${shortenNumericId(row.route_id)}` : "Transit pass")
                  const expiredDate = row.valid_until_epoch
                    ? new Date(Number(row.valid_until_epoch) * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : null
                  return (
                    <li key={`exp-${row.token_id}`} className="relative flex gap-4">
                      <div className="relative z-10 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                          className="text-error/70" aria-hidden>
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </div>
                      <div className="flex-1 overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low/50 pb-3">
                        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
                          <p className="truncate font-headline text-sm font-semibold text-on-surface-variant">{routeName}</p>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-error/25 bg-error/8 px-2.5 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-error/80">
                            Expired
                          </span>
                        </div>
                        <div className="grid grid-cols-3 divide-x divide-outline-variant/10 border-t border-outline-variant/10 px-1 text-center">
                          <div className="px-3 py-2">
                            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">Class</p>
                            <p className={`mt-0.5 font-headline text-xs font-semibold ${row.seat_class === "Business" ? "text-amber-400/80" : "text-on-surface-variant/70"}`}>
                              {row.seat_class ?? "Economy"}
                            </p>
                          </div>
                          <div className="px-3 py-2">
                            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">Expired</p>
                            <p className="mt-0.5 font-headline text-xs font-semibold text-on-surface-variant/70">{expiredDate ?? "—"}</p>
                          </div>
                          <div className="px-3 py-2">
                            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">Token</p>
                            <p className="mt-0.5 font-mono text-xs text-on-surface-variant/70">#{shortenNumericId(row.token_id)}</p>
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}

                {/* Burned passes */}
                {(data?.used ?? []).map((row) => {
                  const meta = routeMetaForRouteId(row.route_id ?? undefined)
                  const routeName = meta?.name ?? (row.route_id ? `Route ${shortenNumericId(row.route_id)}` : "Transit pass")
                  const burnedDate = row.created_at
                    ? new Date(row.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                    : null
                  return (
                    <li key={`bur-${row.id}-${row.tx_hash}`} className="relative flex gap-4">
                      <div className="relative z-10 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-tertiary/20 bg-surface-container">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className="text-tertiary/70" aria-hidden>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <div className="flex-1 overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low/50 pb-3">
                        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
                          <p className="truncate font-headline text-sm font-semibold text-on-surface-variant">{routeName}</p>
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container px-2.5 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
                            </svg>
                            Burned
                          </span>
                        </div>
                        <div className="grid grid-cols-3 divide-x divide-outline-variant/10 border-t border-outline-variant/10 px-1 text-center">
                          <div className="px-3 py-2">
                            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">Class</p>
                            <p className={`mt-0.5 font-headline text-xs font-semibold ${row.seat_class === "Business" ? "text-amber-400/80" : "text-on-surface-variant/70"}`}>
                              {row.seat_class ?? "Economy"}
                            </p>
                          </div>
                          <div className="px-3 py-2">
                            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">Used</p>
                            <p className="mt-0.5 font-headline text-xs font-semibold text-on-surface-variant/70">{burnedDate ?? "—"}</p>
                          </div>
                          <div className="px-3 py-2">
                            {row.tx_hash ? (
                              <a href={`${explorerTxBase}/${row.tx_hash}`} target="_blank" rel="noreferrer"
                                className="font-headline text-xs text-primary/70 hover:text-primary">
                                Tx ↗
                              </a>
                            ) : <span className="font-headline text-xs text-on-surface-variant/50">—</span>}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Used (burned) passes */}
      {!loading && tab === "used" && data && (
        <>
          {data.used.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/15 bg-surface-container py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container-high">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                  className="text-on-surface-variant" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <p className="font-headline text-sm font-medium text-on-surface-variant">No trip history yet</p>
              <p className="mt-1 text-xs text-on-surface-variant/60">Burned tickets will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {data.used.map((row) => {
                const meta = routeMetaForRouteId(row.route_id ?? undefined)
                const routeName =
                  meta?.name ??
                  (row.route_id ? `Route ${shortenNumericId(row.route_id)}` : "Transit pass")
                const burnedDate = row.created_at
                  ? new Date(row.created_at).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                    })
                  : null
                const burnedTime = row.created_at
                  ? new Date(row.created_at).toLocaleTimeString(undefined, {
                      hour: "2-digit", minute: "2-digit",
                    })
                  : null
                const validUntilDate = row.valid_until_epoch
                  ? new Date(Number(row.valid_until_epoch) * 1000).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                    })
                  : null

                return (
                  <li key={`u-${row.id}-${row.tx_hash}`}>
                    <div className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low/70">
                      {/* Top strip — muted with burned badge */}
                      <div className="flex items-center justify-between gap-3 border-b border-outline-variant/10 bg-surface-container-low px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {/* Bus icon — muted */}
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                              className="text-on-surface-variant/50" aria-hidden>
                              <rect x="1" y="7" width="22" height="11" rx="2" />
                              <path d="M5 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
                              <circle cx="7" cy="18" r="1.5" />
                              <circle cx="17" cy="18" r="1.5" />
                            </svg>
                          </div>
                          <p className="min-w-0 truncate font-headline text-sm font-semibold text-on-surface-variant">
                            {routeName}
                          </p>
                        </div>
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container px-2.5 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                          Used
                        </span>
                      </div>

                      {/* Detail grid */}
                      <div className="grid grid-cols-2 gap-px bg-outline-variant/8 sm:grid-cols-4">
                        {/* Date used */}
                        <div className="bg-surface-container-low/70 px-4 py-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                            Date used
                          </p>
                          <p className="mt-1 font-headline text-xs font-semibold text-on-surface-variant">
                            {burnedDate ?? "—"}
                          </p>
                          {burnedTime && (
                            <p className="mt-0.5 font-mono text-[10px] text-on-surface-variant/50">
                              {burnedTime}
                            </p>
                          )}
                        </div>

                        {/* Category */}
                        <div className="bg-surface-container-low/70 px-4 py-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                            Category
                          </p>
                          <p className="mt-1 font-headline text-xs font-semibold text-on-surface-variant">
                            {meta?.category ?? "General"}
                          </p>
                        </div>

                        {/* Valid until */}
                        <div className="bg-surface-container-low/70 px-4 py-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                            Was valid until
                          </p>
                          <p className="mt-1 font-headline text-xs font-semibold text-on-surface-variant">
                            {validUntilDate ?? "—"}
                          </p>
                        </div>

                        {/* Block */}
                        <div className="bg-surface-container-low/70 px-4 py-3">
                          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                            Block
                          </p>
                          <p className="mt-1 font-mono text-xs text-on-surface-variant">
                            {row.block_number}
                          </p>
                        </div>
                      </div>

                      {/* Footer — token id + tx link */}
                      <div className="flex items-center justify-between border-t border-outline-variant/10 px-4 py-2.5">
                        <p className="font-mono text-[10px] text-on-surface-variant/50"
                          title={`Full token: ${row.token_id}`}>
                          Token #{shortenNumericId(row.token_id)}
                        </p>
                        <a href={`${explorerTxBase}/${row.tx_hash}`} target="_blank" rel="noreferrer"
                          className="font-headline text-xs font-semibold text-on-surface-variant/60 transition-colors hover:text-primary">
                          View burn tx ↗
                        </a>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <div className="mt-8 text-center">
        <Link to="/routes" className="font-headline text-xs font-semibold text-primary hover:underline">
          Browse routes →
        </Link>
      </div>
    </div>
  )
}
