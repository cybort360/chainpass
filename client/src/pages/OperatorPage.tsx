import { useCallback, useEffect, useMemo, useState } from "react"
import { formatEther } from "viem"
import { useReadContract } from "wagmi"
import { chainPassTicketAbi, monadTestnet } from "@chainpass/shared"
import { fetchOperatorStats, fetchOperatorTimeseries, type OperatorStats, type TimeseriesBucket } from "../lib/api"
import { env } from "../lib/env"

type Period = "24h" | "7d" | "30d"
type ChartTab = "activity" | "revenue"

const explorerTxBase = `${monadTestnet.blockExplorers.default.url}/tx`

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtBigint(n: bigint): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function fmtMon(weiStr: string | undefined): string {
  if (!weiStr || weiStr === "0") return "0 MON"
  try {
    const eth = Number(formatEther(BigInt(weiStr)))
    return `${eth.toLocaleString(undefined, { maximumFractionDigits: 4 })} MON`
  } catch {
    return "— MON"
  }
}

function formatBucketLabel(bucket: string, period: Period): string {
  const d = new Date(bucket)
  if (period === "24h") {
    return d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true })
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

type FilledBucket = {
  key: string
  label: string
  mints: number
  burns: number
  inflowWei: bigint
}

function fillBuckets(serverBuckets: TimeseriesBucket[], period: Period): FilledBucket[] {
  const n = period === "24h" ? 24 : period === "7d" ? 7 : 30
  const now = new Date()
  const serverMap = new Map<string, TimeseriesBucket>()

  for (const b of serverBuckets) {
    const key = new Date(b.bucket).toISOString().slice(0, period === "24h" ? 13 : 10)
    serverMap.set(key, b)
  }

  const result: FilledBucket[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now)
    if (period === "24h") {
      d.setHours(d.getHours() - i, 0, 0, 0)
    } else {
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
    }
    const key = d.toISOString().slice(0, period === "24h" ? 13 : 10)
    const s = serverMap.get(key)
    result.push({
      key,
      label: formatBucketLabel(d.toISOString(), period),
      mints: s?.mints ?? 0,
      burns: s?.burns ?? 0,
      inflowWei: s?.inflow_wei && s.inflow_wei !== "0" ? BigInt(s.inflow_wei) : 0n,
    })
  }
  return result
}

// ─── SVG Bar Chart ───────────────────────────────────────────────────────────

function ActivityChart({ buckets }: { buckets: FilledBucket[] }) {
  const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.mints, b.burns)))
  const W = 600
  const H = 160
  const PAD_L = 28
  const PAD_R = 8
  const PAD_T = 10
  const PAD_B = 28
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const n = buckets.length
  const groupW = chartW / n
  const barW = Math.max(3, Math.min(18, groupW * 0.38))
  const showEveryNth = Math.ceil(n / 8)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" aria-label="Activity chart">
      {[0, 0.5, 1].map((t) => {
        const y = PAD_T + chartH * (1 - t)
        return (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD_L - 4} y={y + 4} fontSize="8" textAnchor="end"
              fill="rgba(255,255,255,0.25)">{Math.round(maxVal * t)}</text>
          </g>
        )
      })}
      <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH}
        stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {buckets.map((b, i) => {
        const cx = PAD_L + (i + 0.5) * groupW
        const mintH = Math.max(b.mints > 0 ? 2 : 0, (b.mints / maxVal) * chartH)
        const burnH = Math.max(b.burns > 0 ? 2 : 0, (b.burns / maxVal) * chartH)
        return (
          <g key={b.key}>
            <rect x={cx - barW - 1} y={PAD_T + chartH - mintH}
              width={barW} height={mintH} fill="rgba(110,84,255,0.8)" rx="2" />
            <rect x={cx + 1} y={PAD_T + chartH - burnH}
              width={barW} height={burnH} fill="rgba(220,60,60,0.8)" rx="2" />
            {i % showEveryNth === 0 && (
              <text x={cx} y={H - 6} fontSize="7" textAnchor="middle"
                fill="rgba(255,255,255,0.3)">{b.label}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function RevenueChart({ buckets }: { buckets: FilledBucket[] }) {
  const maxWei = buckets.reduce((m, b) => b.inflowWei > m ? b.inflowWei : m, 1n)
  const maxNum = Number(maxWei)
  const W = 600
  const H = 160
  const PAD_L = 64
  const PAD_R = 8
  const PAD_T = 10
  const PAD_B = 28
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const n = buckets.length
  const barW = Math.max(3, Math.min(24, (chartW / n) * 0.7))
  const showEveryNth = Math.ceil(n / 8)

  function fmtWeiShort(wei: bigint): string {
    const eth = Number(formatEther(wei))
    if (eth === 0) return "0"
    if (eth < 0.001) return "<0.001"
    return eth.toFixed(3)
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" aria-label="Revenue chart">
      {[0, 0.5, 1].map((t) => {
        const y = PAD_T + chartH * (1 - t)
        const weiVal = BigInt(Math.round(maxNum * t))
        return (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD_L - 4} y={y + 4} fontSize="7.5" textAnchor="end"
              fill="rgba(255,255,255,0.25)">{fmtWeiShort(weiVal)}</text>
          </g>
        )
      })}
      <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH}
        stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {buckets.map((b, i) => {
        const cx = PAD_L + (i + 0.5) * (chartW / n)
        const h = maxNum > 0 ? Math.max(b.inflowWei > 0n ? 2 : 0, (Number(b.inflowWei) / maxNum) * chartH) : 0
        return (
          <g key={b.key}>
            <rect x={cx - barW / 2} y={PAD_T + chartH - h}
              width={barW} height={h} fill="rgba(0,200,170,0.75)" rx="2" />
            {i % showEveryNth === 0 && (
              <text x={cx} y={H - 6} fontSize="7" textAnchor="middle"
                fill="rgba(255,255,255,0.3)">{b.label}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string
  accent: "primary" | "burn" | "outstanding" | "inflow" | "neutral"
}) {
  const accentClass = {
    primary:     "from-primary/20 to-transparent border-primary/20",
    burn:        "from-error/15 to-transparent border-error/20",
    outstanding: "from-tertiary/15 to-transparent border-tertiary/20",
    inflow:      "from-emerald-500/10 to-transparent border-emerald-500/20",
    neutral:     "from-surface-container-high/80 to-transparent border-outline-variant/15",
  }[accent]

  const valueClass = {
    primary:     "text-white",
    burn:        "text-error",
    outstanding: "text-tertiary",
    inflow:      "text-emerald-400",
    neutral:     "text-on-surface-variant",
  }[accent]

  return (
    <div className={`overflow-hidden rounded-2xl border bg-gradient-to-br ${accentClass} bg-surface-container`}>
      <div className="p-5">
        <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
          {label}
        </p>
        <p className={`mt-2 font-headline text-2xl font-bold tabular-nums tracking-tight ${valueClass}`}>
          {value}
        </p>
        {sub && <p className="mt-1.5 text-[10px] text-on-surface-variant/70">{sub}</p>}
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

// ─── Main Page ───────────────────────────────────────────────────────────────

const REFETCH_MS = 8000

export function OperatorPage() {
  const contract = env.contractAddress
  const [stats, setStats] = useState<OperatorStats | null>(null)
  const [timeseries, setTimeseries] = useState<TimeseriesBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>("7d")
  const [chartTab, setChartTab] = useState<ChartTab>("activity")

  // Chain counters via wagmi — auto-refresh every 6s
  const { data: totalMintedRaw } = useReadContract({
    address: contract ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "totalMinted",
    query: { enabled: !!contract, refetchInterval: 6_000 },
  })
  const { data: totalBurnedRaw } = useReadContract({
    address: contract ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "totalBurned",
    query: { enabled: !!contract, refetchInterval: 6_000 },
  })
  const totalMinted = typeof totalMintedRaw === "bigint" ? totalMintedRaw : null
  const totalBurned = typeof totalBurnedRaw === "bigint" ? totalBurnedRaw : null

  const load = useCallback(async (mode: "initial" | "poll" | "manual", p?: Period) => {
    const activePeriod = p ?? period
    if (mode === "manual") setRefreshing(true)
    if (mode === "initial") setLoading(true)

    const [s, ts] = await Promise.all([
      fetchOperatorStats(),
      fetchOperatorTimeseries(activePeriod),
    ])

    if (!s && !contract) {
      setErr("Set VITE_CHAINPASS_CONTRACT_ADDRESS for on-chain totals, or run the API with DATABASE_URL + indexer.")
    } else {
      setErr(null)
    }

    setStats(s)
    setTimeseries(ts)
    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
  }, [period, contract])

  useEffect(() => {
    const id = window.setTimeout(() => { void load("initial") }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => { void load("poll") }, REFETCH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const onPeriodChange = (p: Period) => {
    setPeriod(p)
    void load("manual", p)
  }

  const outstanding = totalMinted !== null && totalBurned !== null ? totalMinted - totalBurned : null
  const totalMintLabel = totalMinted !== null ? fmtBigint(totalMinted) : stats ? stats.totals.mint.toLocaleString() : "—"
  const totalBurnLabel = totalBurned !== null ? fmtBigint(totalBurned) : stats ? stats.totals.burn.toLocaleString() : "—"
  const activeLabel = outstanding !== null ? fmtBigint(outstanding) : "—"
  const inflowLabel = fmtMon(stats?.totalInflowWei)

  const filledBuckets = useMemo(
    () => timeseries ? fillBuckets(timeseries, period) : [],
    [timeseries, period],
  )

  const totalInPeriod = useMemo(() => {
    if (!filledBuckets.length) return { mints: 0, burns: 0 }
    return filledBuckets.reduce((acc, b) => ({
      mints: acc.mints + b.mints,
      burns: acc.burns + b.burns,
    }), { mints: 0, burns: 0 })
  }, [filledBuckets])

  const periodLabel = { "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" }[period]

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Operator</p>
          <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">Operations</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Live stats from chain and indexer.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {lastUpdated && (
            <span className="text-[10px] text-on-surface-variant/60">{lastUpdated.toLocaleTimeString()}</span>
          )}
          <button type="button" disabled={refreshing || loading}
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

      {err && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-error/20 bg-error/8 p-4">
          <p className="text-xs leading-relaxed text-error">{err}</p>
        </div>
      )}

      {/* Stat cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total minted" value={totalMintLabel} sub="All time" accent="primary" />
          <StatCard label="Total burnt" value={totalBurnLabel} sub="All time" accent="burn" />
          <StatCard label="Active tickets" value={activeLabel} sub="Currently unburnt" accent="outstanding" />
          <StatCard label="MON inflow" value={inflowLabel} sub="Indexed purchases" accent="inflow" />
        </div>
      )}

      {/* Timeframe + chart */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/15 px-5 py-3.5">
          <div className="flex items-center gap-1 rounded-xl bg-surface-container-high p-1">
            {(["24h", "7d", "30d"] as Period[]).map((p) => (
              <button key={p} type="button"
                onClick={() => onPeriodChange(p)}
                className={`rounded-lg px-3 py-1.5 font-headline text-xs font-semibold transition-all ${
                  period === p
                    ? "bg-surface-container text-white shadow-sm"
                    : "text-on-surface-variant hover:text-white"
                }`}>
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-surface-container-high p-1">
            {(["activity", "revenue"] as ChartTab[]).map((t) => (
              <button key={t} type="button"
                onClick={() => setChartTab(t)}
                className={`rounded-lg px-3 py-1.5 font-headline text-xs font-semibold capitalize transition-all ${
                  chartTab === t
                    ? "bg-surface-container text-white shadow-sm"
                    : "text-on-surface-variant hover:text-white"
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Chart body */}
        <div className="px-5 py-4">
          {/* Period summary */}
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/60 font-headline font-bold">
                {periodLabel}
              </p>
            </div>
            {chartTab === "activity" && (
              <div className="flex items-center gap-4 ml-auto">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-primary/80" aria-hidden />
                  <span className="font-headline text-xs font-semibold text-white">{totalInPeriod.mints}</span>
                  <span className="text-[10px] text-on-surface-variant">mints</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-error/80" aria-hidden />
                  <span className="font-headline text-xs font-semibold text-white">{totalInPeriod.burns}</span>
                  <span className="text-[10px] text-on-surface-variant">burns</span>
                </div>
              </div>
            )}
            {chartTab === "revenue" && (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400/80" aria-hidden />
                <span className="text-xs text-on-surface-variant">MON inflow (native payments only)</span>
              </div>
            )}
          </div>

          {loading ? (
            <div className="skeleton h-40 w-full rounded-xl" />
          ) : filledBuckets.length === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <p className="text-sm text-on-surface-variant">No data for this period.</p>
            </div>
          ) : chartTab === "activity" ? (
            <ActivityChart buckets={filledBuckets} />
          ) : (
            <RevenueChart buckets={filledBuckets} />
          )}
        </div>
      </div>

      {/* Explorer link */}
      <div className="mt-8 text-center">
        <a
          href={`${explorerTxBase.replace("/tx", "")}/address/${env.contractAddress ?? ""}`}
          target="_blank" rel="noopener noreferrer"
          className="font-headline text-xs font-semibold text-primary hover:underline">
          View contract on MonadVision ↗
        </a>
      </div>
    </div>
  )
}
