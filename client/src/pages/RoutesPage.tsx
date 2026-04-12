import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { formatEther, formatUnits } from "viem"
import { useAccount, useReadContract } from "wagmi"
import { useQuery } from "@tanstack/react-query"
import { createPublicClient, http } from "viem"
import { chainPassTicketAbi, erc20Abi, monadTestnet } from "@chainpass/shared"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { fetchRouteLabels } from "../lib/api"
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

export function RoutesPage() {
  const [apiLabels, setApiLabels] = useState<Awaited<ReturnType<typeof fetchRouteLabels>> | undefined>(undefined)
  const [activeCategory, setActiveCategory] = useState<string>("All")
  const [searchQuery, setSearchQuery] = useState("")
  const { isFavourite, toggle, favourites } = useFavouriteRoutes()
  const [showFavsOnly, setShowFavsOnly] = useState(false)
  const contractAddress = getContractAddress()
  const { ngnForMon, rateLoading } = useExchangeRates()

  // Global mint price from contract
  const { data: priceWei } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "mintPriceWei",
    query: { enabled: !!contractAddress },
  })

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

    return base
  }, [rows, activeCategory, searchQuery, showFavsOnly, isFavourite])

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
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, activeCategory, searchQuery, showFavsOnly])

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
                    <div className="relative">
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
                          {/* Fare badge */}
                          {!rateLoading && (
                            <FareBadge
                              priceWei={typeof priceWei === "bigint" ? priceWei : undefined}
                              ngnForMon={ngnForMon}
                            />
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

                      {/* Favourite button — absolutely positioned to avoid nesting buttons inside <a> */}
                      <div className="absolute right-12 top-1/2 -translate-y-1/2">
                        <FavouriteButton
                          routeId={r.routeId}
                          isFav={fav}
                          onToggle={toggle}
                        />
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
    </div>
  )
}
