import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { usePublicClient } from "wagmi"
import { monadTestnet } from "@chainpass/shared"
import { fetchOperatorEvents, fetchOperatorStats, type OperatorEventRow, type OperatorStats } from "../lib/api"
import { fetchTicketLifecycleTotals } from "../lib/chainTicketCounters"
import { env } from "../lib/env"
import { Button } from "../components/ui/Button"

const REFETCH_MS = 6000

/** Off while not running the Postgres indexer; skips `/events` fetch and hides the mint/burn table. */
const INDEXER_EVENT_FEED_ENABLED = false

const explorerTxBase = `${monadTestnet.blockExplorers.default.url}/tx`

function txExplorerUrl(txHash: string): string {
  return `${explorerTxBase}/${txHash}`
}

function fmtBigint(n: bigint): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function countEventsByType(rows: OperatorEventRow[] | null, type: string): bigint {
  if (!rows) return 0n
  const n = rows.filter((e) => e.event_type === type).length
  return BigInt(n)
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

    if (ct) {
      setChainTotals({ mint: ct.totalMinted, burn: ct.totalBurned })
    } else {
      setChainTotals(null)
    }

    const anyApi = s !== null || e !== null
    const chainOk = ct !== null
    if (!anyApi && !chainOk) {
      setErr(
        "Could not load data. Set VITE_CHAINPASS_CONTRACT_ADDRESS for on-chain totals, and/or run the API with DATABASE_URL + indexer for the event feed.",
      )
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
    const id = window.setTimeout(() => {
      void load("initial")
    }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => {
      void load("poll")
    }, REFETCH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const indexerRowMints = countEventsByType(events, "mint")
  const indexerRowBurns = countEventsByType(events, "burn")

  /** When the contract is configured, indexed rows must match chain or we hide the table / rolling 24h. */
  const countsAlignWithChain = useMemo(() => {
    if (!INDEXER_EVENT_FEED_ENABLED) return true
    if (!chainTotals) return true
    if (events === null) return false
    return indexerRowMints === chainTotals.mint && indexerRowBurns === chainTotals.burn
  }, [chainTotals, events, indexerRowMints, indexerRowBurns])

  const dbTotalsMatchChain = useMemo(() => {
    if (!chainTotals || !stats) return true
    return (
      BigInt(stats.totals.mint) === chainTotals.mint && BigInt(stats.totals.burn) === chainTotals.burn
    )
  }, [chainTotals, stats])

  /** Rolling 24h is only meaningful when indexer rows + API aggregates match chain (same deployment, synced DB). */
  const showRolling24h =
    Boolean(stats) && countsAlignWithChain && dbTotalsMatchChain && stats !== null

  const outstanding =
    chainTotals !== null ? chainTotals.mint - chainTotals.burn : null

  const showStatsGrid = chainTotals !== null || stats !== null
  const totalMintsLabel = chainTotals ? fmtBigint(chainTotals.mint) : stats ? stats.totals.mint.toLocaleString() : "—"
  const totalBurnsLabel = chainTotals ? fmtBigint(chainTotals.burn) : stats ? stats.totals.burn.toLocaleString() : "—"
  const totalsSource = chainTotals ? "On-chain (this deployment)" : stats ? "Indexer (DB)" : null

  const showEventTable = INDEXER_EVENT_FEED_ENABLED && Boolean(events && events.length > 0)

  return (
    <div className="mx-auto max-w-5xl">
      <p className="font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">Operator</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold text-white">Operations</h1>
          <p className="mt-2 text-on-surface-variant">
            <strong className="text-on-surface">Lifetime mints/burns</strong> come from the contract when{" "}
            <span className="font-mono text-on-surface-variant/90">VITE_CHAINPASS_CONTRACT_ADDRESS</span> is set.{" "}
            <strong className="text-on-surface">Outstanding</strong> is minted minus burned (still valid tickets).{" "}
            <strong className="text-on-surface">Last 24h</strong> needs Postgres + indexer in sync with this deployment; otherwise we show{" "}
            on-chain metrics only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lastUpdated ? (
            <p className="text-xs text-on-surface-variant">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || loading}
            onClick={() => void load("manual")}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {loading ? <p className="mt-10 text-on-surface-variant">Loading…</p> : null}
      {err ? <p className="mt-6 rounded-xl bg-error/10 p-4 text-sm text-error">{err}</p> : null}

      {showStatsGrid ? (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-surface-container p-5">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Total mints</p>
            <p className="mt-2 font-headline text-3xl font-bold text-white">{totalMintsLabel}</p>
            {totalsSource ? (
              <p className="mt-1 text-xs text-on-surface-variant/80">{totalsSource}</p>
            ) : null}
          </div>
          <div className="rounded-2xl bg-surface-container p-5">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Total burns</p>
            <p className="mt-2 font-headline text-3xl font-bold text-white">{totalBurnsLabel}</p>
            {totalsSource ? (
              <p className="mt-1 text-xs text-on-surface-variant/80">{totalsSource}</p>
            ) : null}
          </div>
          <div className="rounded-2xl bg-surface-container p-5">
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Outstanding</p>
            <p className="mt-2 font-headline text-3xl font-bold text-tertiary">
              {outstanding !== null ? fmtBigint(outstanding) : "—"}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant/80">
              {chainTotals ? "On-chain (unburned supply)" : "Needs contract address"}
            </p>
          </div>
          <div className="rounded-2xl bg-surface-container p-5">
            {showRolling24h ? (
              <>
                <p className="text-xs uppercase tracking-widest text-on-surface-variant">Last 24 hours</p>
                <p className="mt-2 font-headline text-xl font-bold text-tertiary">
                  {stats!.last24h.mint} mints · {stats!.last24h.burn} burns
                </p>
                <p className="mt-1 text-xs text-on-surface-variant/80">Indexer (DB), in sync with chain</p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-widest text-on-surface-variant">Rolling 24h</p>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                  Rolling windows need an indexer writing to Postgres. On shared Monad testnet RPCs, a typical indexer
                  polls <span className="font-mono text-xs">eth_getLogs</span> often enough that public endpoints rate-limit
                  or throttle it—so we rely on on-chain lifetime totals here instead.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}

      {showEventTable ? (
        <div className="mt-12 overflow-hidden rounded-2xl bg-surface-container-low">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[34%]" />
              <col className="w-[18%]" />
              <col className="w-[14%]" />
              <col className="w-[24%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-outline-variant/20 text-on-surface-variant">
                <th className="px-2 py-3 font-headline font-semibold sm:px-4">Type</th>
                <th className="px-2 py-3 font-headline font-semibold sm:px-4">Token</th>
                <th className="px-2 py-3 font-headline font-semibold sm:px-4">Route</th>
                <th className="px-2 py-3 font-headline font-semibold sm:px-4">Block</th>
                <th className="px-2 py-3 font-headline font-semibold sm:px-4">Tx</th>
              </tr>
            </thead>
            <tbody>
              {events!.slice(0, 100).map((ev) => (
                <tr key={ev.id} className="border-b border-outline-variant/10">
                  <td colSpan={5} className="p-0">
                    <a
                      href={txExplorerUrl(ev.tx_hash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="grid w-full grid-cols-[minmax(0,10%)_minmax(0,34%)_minmax(0,18%)_minmax(0,14%)_minmax(0,24%)] gap-x-1 px-2 py-3 text-left text-sm text-on-surface-variant no-underline transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:gap-x-2 sm:px-4"
                      aria-label={`View transaction ${ev.tx_hash.slice(0, 10)}… on explorer`}
                    >
                      <span className="min-w-0 truncate font-mono text-sm text-white">{ev.event_type}</span>
                      <span className="min-w-0 truncate font-mono text-xs" title={ev.token_id}>
                        {ev.token_id}
                      </span>
                      <span className="min-w-0 truncate font-mono text-xs" title={String(ev.route_id)}>
                        {ev.route_id}
                      </span>
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
      ) : null}

      {!loading &&
      !err &&
      INDEXER_EVENT_FEED_ENABLED &&
      events !== null &&
      events.length === 0 &&
      (!chainTotals || countsAlignWithChain) ? (
        <p className="mt-10 text-on-surface-variant">No indexed events yet.</p>
      ) : null}

      {!loading &&
      !err &&
      INDEXER_EVENT_FEED_ENABLED &&
      events === null &&
      (chainTotals !== null || stats !== null) ? (
        <p className="mt-10 text-on-surface-variant">
          Event feed unavailable — start the API with DATABASE_URL and the indexer, or check{" "}
          <span className="font-mono text-on-surface-variant/90">VITE_CHAINPASS_API_URL</span>.
        </p>
      ) : null}

      <p className="mt-10 text-center">
        <Link to="/conductor" className="font-headline text-sm text-primary hover:underline">
          Gate tools
        </Link>
      </p>
    </div>
  )
}
