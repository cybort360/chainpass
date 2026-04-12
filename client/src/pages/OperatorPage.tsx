import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { usePublicClient } from "wagmi"
import { monadTestnet } from "@chainpass/shared"
import { fetchOperatorEvents, fetchOperatorStats, type OperatorEventRow, type OperatorStats } from "../lib/api"
import { fetchTicketLifecycleTotals } from "../lib/chainTicketCounters"
import { env } from "../lib/env"

const REFETCH_MS = 6000
const INDEXER_EVENT_FEED_ENABLED = false
const explorerTxBase = `${monadTestnet.blockExplorers.default.url}/tx`

function fmtBigint(n: bigint): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
function countEventsByType(rows: OperatorEventRow[] | null, type: string): bigint {
  if (!rows) return 0n
  return BigInt(rows.filter((e) => e.event_type === type).length)
}
function txExplorerUrl(txHash: string): string {
  return `${explorerTxBase}/${txHash}`
}

type StatCardProps = {
  label: string
  value: string
  sub?: string
  accent: "primary" | "burn" | "outstanding" | "neutral"
}

function StatCard({ label, value, sub, accent }: StatCardProps) {
  const accentClass = {
    primary:     "from-primary/20 to-transparent border-primary/20",
    burn:        "from-error/15 to-transparent border-error/20",
    outstanding: "from-tertiary/15 to-transparent border-tertiary/20",
    neutral:     "from-surface-container-high/80 to-transparent border-outline-variant/15",
  }[accent]

  const valueClass = {
    primary:     "text-white",
    burn:        "text-error",
    outstanding: "text-tertiary",
    neutral:     "text-on-surface-variant",
  }[accent]

  return (
    <div className={`overflow-hidden rounded-2xl border bg-gradient-to-br ${accentClass} bg-surface-container`}>
      <div className="p-5">
        <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
          {label}
        </p>
        <p className={`mt-2 font-headline text-3xl font-bold tabular-nums tracking-tight ${valueClass}`}>
          {value}
        </p>
        {sub && (
          <p className="mt-1.5 text-[10px] text-on-surface-variant/70">{sub}</p>
        )}
      </div>
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-outline-variant/15 bg-surface-container p-5">
      <div className="skeleton h-3 w-1/2 rounded mb-3" />
      <div className="skeleton h-8 w-1/3 rounded mb-2" />
      <div className="skeleton h-2.5 w-2/3 rounded" />
    </div>
  )
}

export function OperatorPage() {
  const publicClient = usePublicClient()
  const [stats, setStats] = useState<OperatorStats | null>(null)
  const [chainTotals, setChainTotals] = useState<{ mint: bigint; burn: bigint } | null>(null)
  const [events, setEvents] = useState<OperatorEventRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (mode: "initial" | "poll" | "manual") => {
    if (mode === "manual") setRefreshing(true)
    if (mode === "initial") setLoading(true)

    const contract = env.contractAddress
    const chainPromise =
      contract && publicClient
        ? fetchTicketLifecycleTotals(publicClient, contract)
        : Promise.resolve(null)

    const [s, e, ct] = await Promise.all([
      fetchOperatorStats(),
      INDEXER_EVENT_FEED_ENABLED ? fetchOperatorEvents() : Promise.resolve(null),
      chainPromise,
    ])

    setChainTotals(ct ? { mint: ct.totalMinted, burn: ct.totalBurned } : null)

    const anyApi = s !== null || e !== null
    if (!anyApi && !ct) {
      setErr("Set VITE_CHAINPASS_CONTRACT_ADDRESS for on-chain totals, and/or run the API with DATABASE_URL + indexer.")
    } else {
      setErr(null)
    }

    setStats(s)
    setEvents(e)
    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
  }, [publicClient])

  useEffect(() => {
    const id = window.setTimeout(() => { void load("initial") }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => { void load("poll") }, REFETCH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const indexerRowMints = countEventsByType(events, "mint")
  const indexerRowBurns = countEventsByType(events, "burn")

  const countsAlignWithChain = useMemo(() => {
    if (!INDEXER_EVENT_FEED_ENABLED) return true
    if (!chainTotals) return true
    if (events === null) return false
    return indexerRowMints === chainTotals.mint && indexerRowBurns === chainTotals.burn
  }, [chainTotals, events, indexerRowMints, indexerRowBurns])

  const dbTotalsMatchChain = useMemo(() => {
    if (!chainTotals || !stats) return true
    return BigInt(stats.totals.mint) === chainTotals.mint && BigInt(stats.totals.burn) === chainTotals.burn
  }, [chainTotals, stats])

  const showRolling24h = Boolean(stats) && countsAlignWithChain && dbTotalsMatchChain && stats !== null
  const outstanding = chainTotals !== null ? chainTotals.mint - chainTotals.burn : null
  const showStatsGrid = chainTotals !== null || stats !== null

  const totalMintsLabel = chainTotals ? fmtBigint(chainTotals.mint) : stats ? stats.totals.mint.toLocaleString() : "—"
  const totalBurnsLabel = chainTotals ? fmtBigint(chainTotals.burn) : stats ? stats.totals.burn.toLocaleString() : "—"
  const totalsSource = chainTotals ? "On-chain" : stats ? "Indexer DB" : null
  const showEventTable = INDEXER_EVENT_FEED_ENABLED && Boolean(events && events.length > 0)

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Operator</p>
          <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">Operations</h1>
          <p className="mt-1.5 max-w-xl text-sm text-on-surface-variant">
            Lifetime counts from the contract. Rolling 24h requires the Postgres indexer.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {lastUpdated && (
            <span className="text-[10px] text-on-surface-variant/60">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button type="button"
            disabled={refreshing || loading}
            onClick={() => void load("manual")}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/30 bg-surface-container px-3 font-headline text-xs font-semibold text-on-surface-variant transition-colors hover:border-primary/40 hover:text-white disabled:opacity-50">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={refreshing ? "animate-spin" : ""} aria-hidden>
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {refreshing ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Error */}
      {err && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-error/20 bg-error/8 p-4">
          <span className="material-symbols-outlined mt-0.5 text-base text-error shrink-0" aria-hidden>error</span>
          <p className="text-xs leading-relaxed text-error">{err}</p>
        </div>
      )}

      {/* Stats grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      ) : showStatsGrid ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total mints"
            value={totalMintsLabel}
            sub={totalsSource ?? undefined}
            accent="primary"
          />
          <StatCard
            label="Total burns"
            value={totalBurnsLabel}
            sub={totalsSource ?? undefined}
            accent="burn"
          />
          <StatCard
            label="Outstanding"
            value={outstanding !== null ? fmtBigint(outstanding) : "—"}
            sub={chainTotals ? "Unburned supply" : "Needs contract address"}
            accent="outstanding"
          />
          <div className="overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container">
            <div className="p-5">
              <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                Rolling 24h
              </p>
              {showRolling24h ? (
                <>
                  <div className="mt-2 flex flex-col gap-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-headline text-2xl font-bold text-white tabular-nums">
                        {stats!.last24h.mint}
                      </span>
                      <span className="text-xs text-on-surface-variant">mints</span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-headline text-2xl font-bold text-error tabular-nums">
                        {stats!.last24h.burn}
                      </span>
                      <span className="text-xs text-on-surface-variant">burns</span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-on-surface-variant/70">Indexer DB, in sync</p>
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                  Needs Postgres + indexer in sync with this deployment.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Event table */}
      {showEventTable && (
        <div className="mt-10 overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container-low">
          <div className="border-b border-outline-variant/15 px-5 py-4">
            <h2 className="font-headline text-sm font-semibold text-white">Recent events</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="w-[10%]" />
                <col className="w-[34%]" />
                <col className="w-[18%]" />
                <col className="w-[14%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-outline-variant/15">
                  {["Type", "Token", "Route", "Block", "Tx"].map((h) => (
                    <th key={h} className="px-4 py-3 font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events!.slice(0, 100).map((ev) => (
                  <tr key={ev.id} className="border-b border-outline-variant/8 hover:bg-white/[0.03] transition-colors">
                    <td colSpan={5} className="p-0">
                      <a href={txExplorerUrl(ev.tx_hash)} target="_blank" rel="noopener noreferrer"
                        className="grid w-full grid-cols-[minmax(0,10%)_minmax(0,34%)_minmax(0,18%)_minmax(0,14%)_minmax(0,24%)] px-4 py-3 text-sm text-on-surface-variant no-underline">
                        <span className={`min-w-0 truncate font-headline text-xs font-semibold ${ev.event_type === "mint" ? "text-primary" : "text-error"}`}>
                          {ev.event_type}
                        </span>
                        <span className="min-w-0 truncate font-mono text-xs" title={ev.token_id}>{ev.token_id}</span>
                        <span className="min-w-0 truncate font-mono text-xs" title={String(ev.route_id)}>{ev.route_id}</span>
                        <span className="min-w-0 truncate font-mono text-xs">{ev.block_number}</span>
                        <span className="min-w-0 truncate font-mono text-xs text-primary" title={ev.tx_hash}>
                          {ev.tx_hash.slice(0, 10)}…{ev.tx_hash.slice(-6)}
                        </span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-10 text-center">
        <Link to="/conductor" className="font-headline text-sm font-semibold text-primary hover:underline">
          Gate tools →
        </Link>
      </div>
    </div>
  )
}
