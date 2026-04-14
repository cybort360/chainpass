import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useShareRoute } from "../hooks/useShareRoute"
import { formatEther, formatUnits } from "viem"
import { useAccount, useReadContract, useReadContracts } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { createPublicClient, http } from "viem"
import { chainPassTicketAbi, erc20Abi, monadTestnet } from "@chainpass/shared"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { fetchRouteLabels, updateRouteLabel, deleteRouteLabel, fetchRouteStats } from "../lib/api"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { shortenNumericId } from "../lib/passDisplay"
import { formatNgn, MON_USD_PRICE, useExchangeRates } from "../lib/prices"
import { useFavouriteRoutes } from "../hooks/useFavouriteRoutes"

const _publicClient = createPublicClient({ chain: monadTestnet, transport: http() })

type RouteRow = {
  routeId: string
  name: string
  detail: string
  category: string
  schedule?: string | null
}

function RouteCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-container p-4">
      <div className="skeleton h-10 w-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
      </div>
      <div className="skeleton h-4 w-12 rounded" />
    </div>
  )
}

function WalletBalanceWidget() {
  const { address, isConnected } = useAccount()
  const usdcAddress = env.usdcAddress
  const { rateLoading, ngnForMon, ngnForUsdc } = useExchangeRates()

  const { data: balanceWei, isPending: monPending } = useQuery({
    queryKey: ["routes-mon-balance", address],
    queryFn: () => _publicClient.getBalance({ address: address! }),
    enabled: Boolean(isConnected && address),
    refetchInterval: 12_000,
  })

  const { data: usdcBalanceRaw } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: Boolean(isConnected && address && usdcAddress), refetchInterval: 12_000 },
  })
  const usdcBalance = typeof usdcBalanceRaw === "bigint" ? usdcBalanceRaw : undefined

  if (!isConnected || !address) return null

  const monNum  = balanceWei !== undefined ? Number(formatEther(balanceWei)) : 0
  const usdcNum = usdcBalance !== undefined ? Number(formatUnits(usdcBalance, 6)) : 0
  const totalNgn = ngnForMon(monNum) + ngnForUsdc(usdcNum)
  const isLowBalance = monNum < 0.1

  const fmt4 = (n: number) =>
    n === 0 ? "0" :
    n < 0.0001 ? "<0.0001" :
    n.toLocaleString(undefined, { maximumFractionDigits: 4 })

  return (
    <div className="mb-8 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between border-b border-outline-variant/15 px-4 py-3">
        <p className="font-headline text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">
          Wallet balances
        </p>
        <div className="flex items-center gap-2">
          {isLowBalance && (
            <a
              href="https://faucet.monad.xyz/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-headline text-[9px] font-bold uppercase tracking-wide text-amber-400 transition-colors hover:bg-amber-500/20"
              title="Get free testnet MON from the Monad faucet"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
              </svg>
              Get MON
            </a>
          )}
          <p className="font-headline text-[10px] text-on-surface-variant/50">
            {address.slice(0, 6)}…{address.slice(-4)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-outline-variant/15">
        {/* MON */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">MON</p>
          </div>
          <p className="font-headline text-lg font-bold tabular-nums text-white">
            {monPending ? "…" : fmt4(monNum)}
          </p>
          <p className="mt-0.5 text-[10px] text-on-surface-variant/50">
            {rateLoading ? "—" : formatNgn(ngnForMon(monNum), { compact: true })}
          </p>
        </div>

        {/* USDC */}
        <div className="px-4 py-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-tertiary/20">
              <span className="font-mono text-[8px] font-bold text-tertiary">$</span>
            </span>
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">USDC</p>
          </div>
          {usdcAddress ? (
            <>
              <p className="font-headline text-lg font-bold tabular-nums text-white">
                {usdcBalance !== undefined
                  ? usdcNum.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : "…"}
              </p>
              <p className="mt-0.5 text-[10px] text-on-surface-variant/50">
                {rateLoading ? "—" : formatNgn(ngnForUsdc(usdcNum), { compact: true })}
              </p>
            </>
          ) : (
            <p className="font-headline text-sm font-semibold text-on-surface-variant/30">—</p>
          )}
        </div>

        {/* Total NGN */}
        <div className="bg-gradient-to-br from-primary/8 to-transparent px-4 py-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="font-bold text-[9px] text-on-surface-variant/60">₦</span>
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">Total</p>
          </div>
          <p className="font-headline text-lg font-bold tabular-nums text-white">
            {rateLoading ? "…" : formatNgn(totalNgn, { compact: true })}
          </p>
          <p className="mt-0.5 text-[10px] text-on-surface-variant/50">
            1 MON ≈ ${MON_USD_PRICE}
          </p>
        </div>
      </div>
    </div>
  )
}

/** Heart / favourite toggle button */
function FavouriteButton({
  routeId,
  isFav,
  onToggle,
}: {
  routeId: string
  isFav: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      aria-label={isFav ? "Remove from favourites" : "Add to favourites"}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle(routeId)
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
        isFav
          ? "bg-rose-500/15 text-rose-400"
          : "bg-transparent text-on-surface-variant/30 hover:bg-rose-500/10 hover:text-rose-400/60"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24"
        fill={isFav ? "currentColor" : "none"}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden>
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}

/** Returns "train" for rail/metro routes, "bus" for everything else */
function transportType(category: string, name: string): "train" | "bus" {
  const haystack = `${category} ${name}`.toLowerCase()
  if (/train|rail|metro|lrt|brt rail|blue line|red line|green line/.test(haystack)) return "train"
  return "bus"
}

function TransportIcon({ category, name, className }: { category: string; name: string; className?: string }) {
  const type = transportType(category, name)
  if (type === "train") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        className={className} aria-hidden>
        <rect x="4" y="3" width="16" height="13" rx="3" />
        <path d="M8 16l-2 4M16 16l2 4M8 20h8" />
        <circle cx="9" cy="13" r="1" />
        <circle cx="15" cy="13" r="1" />
        <line x1="4" y1="8" x2="20" y2="8" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden>
      <rect x="1" y="6" width="22" height="13" rx="2" />
      <path d="M6 6V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
      <circle cx="7" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
      <line x1="12" y1="6" x2="12" y2="19" />
    </svg>
  )
}

/** Format mint price in MON + NGN equivalent */
function FareBadge({
  priceWei,
  ngnForMon,
}: {
  priceWei: bigint | undefined
  ngnForMon: (mon: number) => number
}) {
  if (priceWei === undefined) return null
  const mon = Number(formatEther(priceWei))
  if (mon <= 0) return null
  const ngn = ngnForMon(mon)
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
        {mon.toLocaleString(undefined, { maximumFractionDigits: 4 })} MON
      </span>
      <span className="text-[10px] text-on-surface-variant/50">
        ≈ {formatNgn(ngn, { compact: true })}
      </span>
    </div>
  )
}

type EditForm = { name: string; detail: string; category: string; schedule: string }

function EditRouteModal({
  route,
  onClose,
  onSaved,
}: {
  route: RouteRow
  onClose: () => void
  onSaved: (updated: RouteRow) => void
}) {
  const [form, setForm] = useState<EditForm>({
    name: route.name,
    detail: route.detail ?? "",
    category: route.category,
    schedule: route.schedule ?? "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const result = await updateRouteLabel(route.routeId, {
      name: form.name.trim(),
      detail: form.detail.trim() || null,
      category: form.category.trim(),
      schedule: form.schedule.trim() || null,
    })
    setLoading(false)
    if (result.ok) {
      onSaved({ ...route, name: result.route.name, detail: result.route.detail ?? "", category: result.route.category, schedule: result.route.schedule })
    } else {
      setError(result.error)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-headline text-base font-bold text-white">Edit Route</h2>
          <button type="button" onClick={onClose} className="text-on-surface-variant/50 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <p className="mb-4 font-mono text-[10px] text-on-surface-variant/50">Route ID {route.routeId}</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1.5 block font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
              Name *
            </label>
            <input
              type="text"
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border border-outline-variant/25 bg-surface px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
              Category *
            </label>
            <input
              type="text"
              required
              maxLength={60}
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full rounded-xl border border-outline-variant/25 bg-surface px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
              Detail
            </label>
            <input
              type="text"
              maxLength={200}
              value={form.detail}
              onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
              placeholder="e.g. Abuja–Lagos · Express · Daily"
              className="w-full rounded-xl border border-outline-variant/25 bg-surface px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="mb-1.5 block font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
              Schedule
            </label>
            <input
              type="text"
              maxLength={120}
              value={form.schedule}
              onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
              placeholder="e.g. Mon–Fri 6am–10pm · Every 30 min"
              className="w-full rounded-xl border border-outline-variant/25 bg-surface px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-outline-variant/30 py-2.5 font-headline text-sm font-semibold text-on-surface-variant hover:border-outline-variant/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-primary py-2.5 font-headline text-sm font-semibold text-white shadow-[0_0_16px_rgba(110,84,255,0.3)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeleteRouteModal({
  route,
  onClose,
  onDeleted,
}: {
  route: RouteRow
  onClose: () => void
  onDeleted: (routeId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    const result = await deleteRouteLabel(route.routeId)
    setLoading(false)
    if (result.ok) {
      onDeleted(route.routeId)
    } else {
      setError(result.error)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-error/20 bg-surface-container p-6 shadow-2xl">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error" aria-hidden>
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </div>
        <h2 className="font-headline text-base font-bold text-white">Delete route?</h2>
        <p className="mt-1.5 text-sm text-on-surface-variant">
          <span className="font-semibold text-white">{route.name}</span> will be removed from the listing. This cannot be undone.
        </p>

        {error && (
          <p className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{error}</p>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-outline-variant/30 py-2.5 font-headline text-sm font-semibold text-on-surface-variant hover:border-outline-variant/60 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={loading}
            className="flex-1 rounded-xl bg-error py-2.5 font-headline text-sm font-semibold text-white hover:bg-error/90 disabled:opacity-50 transition-colors"
          >
            {loading ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RoutesPage() {
  const [apiLabels, setApiLabels] = useState<Awaited<ReturnType<typeof fetchRouteLabels>> | undefined>(undefined)
  const [activeCategory, setActiveCategory] = useState<string>("All")
  const [searchQuery, setSearchQuery] = useState("")
  const { isFavourite, toggle, favourites } = useFavouriteRoutes()
  const [showFavsOnly, setShowFavsOnly] = useState(false)
  const [editingRoute, setEditingRoute] = useState<RouteRow | null>(null)
  const [deletingRoute, setDeletingRoute] = useState<RouteRow | null>(null)
  const [sortMode, setSortMode] = useState<"name" | "popular">("name")
  const { shareRoute, shareState, shareUrl, clearShareUrl } = useShareRoute()
  const [shareRouteId, setShareRouteId] = useState<string | null>(null)

  const handleShare = async (routeId: string, name: string) => {
    setShareRouteId(routeId)
    await shareRoute(routeId, name)
  }

  const contractAddress = getContractAddress()
  const { ngnForMon, rateLoading } = useExchangeRates()
  const { address } = useAccount()

  // Operator check: address is in the VITE_OPERATOR_WALLETS allowlist
  const isOperator = !!address && env.operatorWallets.size > 0
    ? env.operatorWallets.has(address.toLowerCase())
    : false

  // Global mint price from contract (fallback when no route override)
  const { data: globalPriceWei } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "mintPriceWei",
    query: { enabled: !!contractAddress },
  })

  const { data: routeStatsData } = useQuery({
    queryKey: ["route-stats"],
    queryFn: fetchRouteStats,
  })

  function refreshRoutes() {
    void fetchRouteLabels().then(setApiLabels)
  }

  useEffect(() => {
    refreshRoutes()
  }, [])

  function handleRouteSaved(updated: RouteRow) {
    setApiLabels((prev) => prev ? prev.map((r) => r.routeId === updated.routeId ? { ...r, name: updated.name, detail: updated.detail, category: updated.category, schedule: updated.schedule } : r) : prev)
    setEditingRoute(null)
  }

  function handleRouteDeleted(routeId: string) {
    setApiLabels((prev) => prev ? prev.filter((r) => r.routeId !== routeId) : prev)
    setDeletingRoute(null)
  }

  const mintCountMap = useMemo(() => {
    const m = new Map<string, number>()
    if (routeStatsData) {
      for (const s of routeStatsData) {
        m.set(s.routeId, s.mintCount)
      }
    }
    return m
  }, [routeStatsData])

  const rows = useMemo((): RouteRow[] => {
    if (apiLabels === undefined) return []
    const byId = new Map<string, RouteRow>()
    if (apiLabels !== null) {
      for (const row of apiLabels) {
        byId.set(row.routeId, {
          routeId: row.routeId,
          name: row.name,
          detail: row.detail ?? "",
          category: row.category || "General",
          schedule: row.schedule ?? null,
        })
      }
    }
    for (const r of DEMO_ROUTES) {
      if (!byId.has(r.routeId)) {
        byId.set(r.routeId, { routeId: r.routeId, name: r.name, detail: r.detail, category: r.category })
      }
    }
    return [...byId.values()].sort((a, b) => {
      const c = a.category.localeCompare(b.category)
      if (c !== 0) return c
      const cmp = BigInt(a.routeId) - BigInt(b.routeId)
      return cmp < 0n ? -1 : cmp > 0n ? 1 : 0
    })
  }, [apiLabels])

  // Per-route effective Economy price via multicall (ticketPrice resolves override → global)
  const routePriceCalls = useMemo(
    () =>
      rows.map((r) => ({
        address: contractAddress as `0x${string}`,
        abi: chainPassTicketAbi,
        functionName: "ticketPrice" as const,
        args: [BigInt(r.routeId), 0] as [bigint, number],
      })),
    [rows, contractAddress],
  )
  const { data: routePriceResults } = useReadContracts({
    contracts: routePriceCalls,
    query: { enabled: !!contractAddress && rows.length > 0 },
  })

  // Map routeId → resolved MON price in wei
  const routePriceMap = useMemo(() => {
    const m = new Map<string, bigint>()
    if (!routePriceResults) return m
    rows.forEach((r, i) => {
      const res = routePriceResults[i]
      if (res?.status === "success" && res.result) {
        const [mon] = res.result as [bigint, bigint]
        m.set(r.routeId, mon)
      }
    })
    return m
  }, [routePriceResults, rows])

  const categories = useMemo(() => {
    const cats = Array.from(new Set(rows.map((r) => r.category))).sort()
    return ["All", ...cats]
  }, [rows])

  const filtered = useMemo(() => {
    let base = activeCategory === "All" ? rows : rows.filter((r) => r.category === activeCategory)

    // Favourites filter
    if (showFavsOnly) base = base.filter((r) => isFavourite(r.routeId))

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      base = base.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.detail.toLowerCase().includes(q),
      )
    }

    // Popular sort
    if (sortMode === "popular") {
      base = [...base].sort((a, b) => {
        const aCount = mintCountMap.get(a.routeId) ?? -1
        const bCount = mintCountMap.get(b.routeId) ?? -1
        return bCount - aCount
      })
    }

    return base
  }, [rows, activeCategory, searchQuery, showFavsOnly, isFavourite, sortMode, mintCountMap])

  const byCategory = useMemo(() => {
    if (activeCategory !== "All" || searchQuery.trim() || showFavsOnly) {
      const label =
        showFavsOnly && !searchQuery.trim()
          ? "Favourites"
          : searchQuery.trim()
          ? `Results for "${searchQuery.trim()}"`
          : activeCategory
      return [[label, filtered]] as [string, RouteRow[]][]
    }
    const m = new Map<string, RouteRow[]>()
    for (const r of filtered) {
      if (!m.has(r.category)) m.set(r.category, [])
      m.get(r.category)!.push(r)
    }
    const entries = [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
    if (sortMode === "popular") {
      return entries.map(([cat, list]) => [
        cat,
        [...list].sort((a, b) => {
          const aCount = mintCountMap.get(a.routeId) ?? -1
          const bCount = mintCountMap.get(b.routeId) ?? -1
          return bCount - aCount
        }),
      ] as [string, RouteRow[]])
    }
    return entries
  }, [filtered, activeCategory, searchQuery, showFavsOnly, sortMode, mintCountMap])

  const hasFavourites = favourites.size > 0

  return (
    <div className="mx-auto max-w-2xl">
      {/* Wallet balance strip (connected users only) */}
      <WalletBalanceWidget />

      {/* Page header */}
      <div className="mb-6">
        <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Passenger</p>
        <h1 className="mt-1.5 font-headline text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Choose a route
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Pick a route and pay with MON or USDC on Monad testnet. Fares are enforced on-chain.
        </p>
      </div>

      {/* Search bar */}
      <div className="mb-4 relative">
        <div className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="text-on-surface-variant/50" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </div>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search routes, cities, categories…"
          className="w-full rounded-xl border border-outline-variant/25 bg-surface-container py-2.5 pl-9 pr-4 text-sm text-white placeholder:text-on-surface-variant/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute inset-y-0 right-3 flex items-center text-on-surface-variant/50 hover:text-white transition-colors"
            aria-label="Clear search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Category filter chips + favourites toggle */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
        {/* Favourites chip (only if any saved) */}
        {hasFavourites && (
          <button
            type="button"
            onClick={() => setShowFavsOnly((v) => !v)}
            className={`shrink-0 flex items-center gap-1.5 rounded-full px-4 py-1.5 font-headline text-xs font-semibold tracking-wide transition-all ${
              showFavsOnly
                ? "bg-rose-500 text-white shadow-[0_0_16px_rgba(244,63,94,0.35)]"
                : "border border-rose-500/30 bg-surface-container text-rose-400 hover:border-rose-500/50"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24"
              fill={showFavsOnly ? "currentColor" : "none"}
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden>
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            Saved ({favourites.size})
          </button>
        )}

        {categories.length > 1 && !showFavsOnly && categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`shrink-0 rounded-full px-4 py-1.5 font-headline text-xs font-semibold tracking-wide transition-all ${
              activeCategory === cat
                ? "bg-primary text-white shadow-[0_0_16px_rgba(110,84,255,0.4)]"
                : "border border-outline-variant/40 bg-surface-container text-on-surface-variant hover:border-primary/40 hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}

        {/* Sort toggle — only shown when route stats are available */}
        {routeStatsData && routeStatsData.length > 0 && (
          <div className="ml-auto shrink-0 flex items-center gap-0.5 rounded-full border border-outline-variant/30 bg-surface-container p-0.5">
            <button
              type="button"
              onClick={() => setSortMode("name")}
              className={`rounded-full px-3 py-1 font-headline text-[10px] font-semibold tracking-wide transition-all ${
                sortMode === "name"
                  ? "bg-primary text-white shadow-[0_0_8px_rgba(110,84,255,0.3)]"
                  : "text-on-surface-variant hover:text-white"
              }`}
            >
              A–Z
            </button>
            <button
              type="button"
              onClick={() => setSortMode("popular")}
              className={`rounded-full px-3 py-1 font-headline text-[10px] font-semibold tracking-wide transition-all ${
                sortMode === "popular"
                  ? "bg-primary text-white shadow-[0_0_8px_rgba(110,84,255,0.3)]"
                  : "text-on-surface-variant hover:text-white"
              }`}
            >
              Popular
            </button>
          </div>
        )}
      </div>

      {/* Status banners */}
      {apiLabels === null && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-tertiary/20 bg-tertiary/5 px-4 py-3">
          <span className="material-symbols-outlined text-base text-tertiary" aria-hidden>info</span>
          <p className="text-xs text-tertiary">API unavailable — showing bundled demo routes.</p>
        </div>
      )}

      {/* Loading skeletons */}
      {apiLabels === undefined && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <RouteCardSkeleton key={i} />)}
        </div>
      )}

      {/* No results */}
      {apiLabels !== undefined && filtered.length === 0 && (
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container px-6 py-10 text-center">
          <p className="font-headline text-sm font-semibold text-white">
            {showFavsOnly ? "No favourites yet" : "No routes found"}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {showFavsOnly
              ? "Tap the ♥ on any route to save it here."
              : `No routes match "${searchQuery}". Try a different search.`}
          </p>
          {(showFavsOnly || searchQuery) && (
            <button
              type="button"
              onClick={() => { setShowFavsOnly(false); setSearchQuery("") }}
              className="mt-4 font-headline text-sm font-semibold text-primary hover:underline"
            >
              Show all routes
            </button>
          )}
        </div>
      )}

      {/* Route list */}
      <div className="space-y-10">
        {byCategory.map(([category, list]) => (
          <section key={category}>
            {/* Category heading */}
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">
                {category}
              </h2>
              <div className="flex-1 border-t border-outline-variant/20" />
              <span className="font-headline text-xs text-on-surface-variant">{list.length}</span>
            </div>

            <ul className="space-y-2.5">
              {list.map((r) => {
                const fav = isFavourite(r.routeId)
                return (
                  <li key={r.routeId}>
                    {/*
                      Card layout: outer group div handles hover/border.
                      Link covers the info area (flex-1).
                      Right panel (heart + buy) sits outside the Link as a proper flex sibling
                      — avoids invalid button-inside-anchor HTML and gives clear spacing.
                    */}
                    <div className="group flex items-stretch overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container transition-all hover:border-primary/25 hover:bg-surface-container-high hover:shadow-[0_4px_24px_rgba(110,84,255,0.1)]">

                      {/* Left accent bar */}
                      <div className="w-0.5 shrink-0 rounded-r-full bg-primary/0 transition-all group-hover:bg-primary/60" aria-hidden />

                      {/* Main clickable area */}
                      <Link
                        to={`/routes/${r.routeId}`}
                        className="flex flex-1 items-center gap-4 min-w-0 px-4 py-4"
                      >
                        {/* Transport icon — bus or train based on category/name */}
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                          <TransportIcon category={r.category} name={r.name} className="text-primary" />
                        </div>

                        {/* Route info */}
                        <div className="min-w-0 flex-1">
                          <p className="font-headline text-sm font-semibold leading-snug text-white">
                            {r.name}
                          </p>
                          {r.detail && (
                            <p className="mt-0.5 text-xs text-on-surface-variant">{r.detail}</p>
                          )}
                          {r.schedule && (
                            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-on-surface-variant/60">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 16 14" />
                              </svg>
                              {r.schedule}
                            </p>
                          )}
                          {/* Fare badge — per-route price if set, else global */}
                          {!rateLoading && (
                            <FareBadge
                              priceWei={routePriceMap.get(r.routeId) ?? (typeof globalPriceWei === "bigint" ? globalPriceWei : undefined)}
                              ngnForMon={ngnForMon}
                            />
                          )}
                          <p className="mt-1 font-mono text-[10px] text-on-surface-variant/60"
                            title={`Route ID ${r.routeId}`}>
                            ID {shortenNumericId(r.routeId, 6, 6)}
                          </p>
                        </div>
                      </Link>

                      {/* Right action panel — heart + operator actions + buy */}
                      <div className="flex shrink-0 items-center gap-1 border-l border-outline-variant/10 pl-2 pr-3">
                        <FavouriteButton
                          routeId={r.routeId}
                          isFav={fav}
                          onToggle={toggle}
                        />

                        {/* Operator-only edit/delete buttons */}
                        {isOperator && (
                          <>
                            <div className="w-px h-5 bg-outline-variant/20 mx-0.5" aria-hidden />
                            <button
                              type="button"
                              aria-label="Edit route"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingRoute(r) }}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant/40 hover:bg-primary/10 hover:text-primary transition-colors"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label="Delete route"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeletingRoute(r) }}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant/40 hover:bg-error/10 hover:text-error transition-colors"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                <path d="M10 11v6"/><path d="M14 11v6"/>
                              </svg>
                            </button>
                          </>
                        )}

                        <div className="w-px h-5 bg-outline-variant/20 mx-1" aria-hidden />
                        <Link
                          to={`/routes/${r.routeId}`}
                          tabIndex={-1}
                          aria-hidden
                          className="flex items-center gap-1 text-on-surface-variant transition-colors group-hover:text-primary"
                        >
                          <span className="font-headline text-xs font-semibold">Buy</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                            className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </Link>
                        <div className="relative flex flex-col items-end gap-1">
                          <button
                            type="button"
                            aria-label={`Share ${r.name}`}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleShare(r.routeId, r.name) }}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant/40 transition-colors hover:text-primary"
                          >
                            {shareRouteId === r.routeId && shareState === "copied" ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden>
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                              </svg>
                            )}
                          </button>
                          {/* Manual copy fallback when clipboard is blocked */}
                          {shareRouteId === r.routeId && shareState === "error" && shareUrl && (
                            <div className="absolute right-0 top-9 z-20 flex w-64 items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-highest px-3 py-2 shadow-lg">
                              <input
                                readOnly
                                value={shareUrl}
                                onFocus={(e) => e.target.select()}
                                className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-on-surface-variant outline-none"
                              />
                              <button type="button" onClick={(e) => { e.stopPropagation(); clearShareUrl(); setShareRouteId(null) }}
                                className="shrink-0 text-on-surface-variant/50 hover:text-on-surface-variant">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* "Get testnet MON" faucet footer (always visible for new users) */}
      <div className="mt-12 rounded-2xl border border-outline-variant/15 bg-surface-container px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-headline text-xs font-bold text-white">New to Monad testnet?</p>
            <p className="mt-0.5 text-xs text-on-surface-variant">
              You need testnet MON to pay for tickets. Get some for free from the faucet.
            </p>
          </div>
          <a
            href="https://faucet.monad.xyz/"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 font-headline text-xs font-bold text-primary transition-colors hover:bg-primary/20"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24" />
            </svg>
            Get testnet MON ↗
          </a>
        </div>
      </div>

      {/* Operator modals */}
      {editingRoute && (
        <EditRouteModal
          route={editingRoute}
          onClose={() => setEditingRoute(null)}
          onSaved={handleRouteSaved}
        />
      )}
      {deletingRoute && (
        <DeleteRouteModal
          route={deletingRoute}
          onClose={() => setDeletingRoute(null)}
          onDeleted={handleRouteDeleted}
        />
      )}
    </div>
  )
}
