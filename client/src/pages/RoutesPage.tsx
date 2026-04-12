import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { formatEther, formatUnits } from "viem"
import { useAccount, useReadContract } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { createPublicClient, http } from "viem"
import { erc20Abi, monadTestnet } from "@chainpass/shared"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { fetchRouteLabels } from "../lib/api"
import { env } from "../lib/env"
import { shortenNumericId } from "../lib/passDisplay"
import { formatNgn, MON_USD_PRICE, useExchangeRates } from "../lib/prices"

const _publicClient = createPublicClient({ chain: monadTestnet, transport: http() })

type RouteRow = {
  routeId: string
  name: string
  detail: string
  category: string
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
        <p className="font-headline text-[10px] text-on-surface-variant/50">
          {address.slice(0, 6)}…{address.slice(-4)}
        </p>
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

export function RoutesPage() {
  const [apiLabels, setApiLabels] = useState<Awaited<ReturnType<typeof fetchRouteLabels>> | undefined>(undefined)
  const [activeCategory, setActiveCategory] = useState<string>("All")

  useEffect(() => {
    void fetchRouteLabels().then(setApiLabels)
  }, [])

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

  const categories = useMemo(() => {
    const cats = Array.from(new Set(rows.map((r) => r.category))).sort()
    return ["All", ...cats]
  }, [rows])

  const filtered = useMemo(() =>
    activeCategory === "All" ? rows : rows.filter((r) => r.category === activeCategory),
    [rows, activeCategory]
  )

  const byCategory = useMemo(() => {
    if (activeCategory !== "All") {
      return [[activeCategory, filtered]] as [string, RouteRow[]][]
    }
    const m = new Map<string, RouteRow[]>()
    for (const r of filtered) {
      if (!m.has(r.category)) m.set(r.category, [])
      m.get(r.category)!.push(r)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, activeCategory])

  return (
    <div className="mx-auto max-w-2xl">
      {/* Wallet balance strip (connected users only) */}
      <WalletBalanceWidget />

      {/* Page header */}
      <div className="mb-8">
        <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Passenger</p>
        <h1 className="mt-1.5 font-headline text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Choose a route
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
          Pick a route and pay with MON or USDC on Monad testnet. Fares are enforced on-chain.
        </p>
      </div>

      {/* Category filter chips */}
      {categories.length > 1 && (
        <div className="mb-6 flex gap-2 overflow-x-auto pb-1 scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none]">
          {categories.map((cat) => (
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
        </div>
      )}

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
              {list.map((r) => (
                <li key={r.routeId}>
                  <Link
                    to={`/routes/${r.routeId}`}
                    className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container px-4 py-4 transition-all hover:border-primary/25 hover:bg-surface-container-high hover:shadow-[0_4px_24px_rgba(110,84,255,0.1)]"
                  >
                    {/* Left accent bar */}
                    <div className="absolute left-0 top-0 h-full w-0.5 rounded-r-full bg-primary/0 transition-all group-hover:bg-primary/60" aria-hidden />

                    {/* Bus icon */}
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                        className="text-primary" aria-hidden>
                        <rect x="1" y="6" width="22" height="13" rx="2" />
                        <path d="M6 6V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
                        <circle cx="7" cy="19" r="1.5" />
                        <circle cx="17" cy="19" r="1.5" />
                        <line x1="12" y1="6" x2="12" y2="19" />
                      </svg>
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="font-headline text-sm font-semibold leading-snug text-white group-hover:text-white">
                        {r.name}
                      </p>
                      {r.detail && (
                        <p className="mt-0.5 text-xs text-on-surface-variant">{r.detail}</p>
                      )}
                      <p className="mt-1 font-mono text-[10px] text-on-surface-variant/60"
                        title={`Route ID ${r.routeId}`}>
                        ID {shortenNumericId(r.routeId, 6, 6)}
                      </p>
                    </div>

                    {/* CTA arrow */}
                    <div className="flex shrink-0 items-center gap-1 text-on-surface-variant transition-colors group-hover:text-primary">
                      <span className="font-headline text-xs font-semibold">Buy</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
