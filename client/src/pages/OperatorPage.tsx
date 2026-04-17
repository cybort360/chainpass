import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatEther, formatUnits, isAddress, keccak256, parseEther, parseUnits, toBytes } from "viem"
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { chainPassTicketAbi, monadTestnet, newRouteIdDecimalFromUuid } from "@chainpass/shared"
import { createTrip, deleteTrip, deleteRouteLabel, fetchOperatorBurners, fetchOperatorStats, fetchOperatorTimeseries, fetchRouteCapacity, fetchRouteLabels, fetchTrips, registerRouteLabel, updateRouteLabel, updateTripStatus, type ApiRouteLabel, type ApiTrip, type CoachClassConfig, type OperatorStats, type RouteCapacity, type TimeseriesBucket, type TripStatus } from "../lib/api"
import { ScheduleRouteEditor } from "../components/ScheduleRouteEditor"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { formatWriteContractError } from "../lib/walletError"

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

type TooltipState = { x: number; y: number; bucket: FilledBucket } | null

function ChartTooltip({ tooltip, type }: { tooltip: TooltipState; type: "activity" | "revenue" }) {
  if (!tooltip) return null
  const { x, y, bucket } = tooltip
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[120px] rounded-xl border border-outline-variant/30 bg-surface-container-highest px-3 py-2 shadow-lg"
      style={{ left: x, top: y, transform: "translate(-50%, -110%)" }}
    >
      <p className="mb-1.5 font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
        {bucket.label}
      </p>
      {type === "activity" ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-[11px] text-on-surface-variant">
              <span className="h-2 w-2 rounded-sm bg-primary/80" />Mints
            </span>
            <span className="font-headline text-xs font-bold text-white">{bucket.mints}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1 text-[11px] text-on-surface-variant">
              <span className="h-2 w-2 rounded-sm bg-error/80" />Burns
            </span>
            <span className="font-headline text-xs font-bold text-white">{bucket.burns}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-[11px] text-on-surface-variant">
            <span className="h-2 w-2 rounded-sm bg-emerald-400/80" />MON
          </span>
          <span className="font-headline text-xs font-bold text-emerald-400">
            {bucket.inflowWei === 0n ? "0" : Number(formatEther(bucket.inflowWei)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </span>
        </div>
      )}
    </div>
  )
}

function ActivityChart({ buckets }: { buckets: FilledBucket[] }) {
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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
    <div className="relative">
      <ChartTooltip tooltip={tooltip} type="activity" />
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" aria-label="Activity chart"
        onMouseLeave={() => setTooltip(null)}>
        {[0, 0.5, 1].map((t) => {
          const y = PAD_T + chartH * (1 - t)
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                stroke="var(--chart-grid-stroke)" strokeWidth="1" />
              <text x={PAD_L - 4} y={y + 4} fontSize="8" textAnchor="end"
                fill="var(--chart-label-fill)">{Math.round(maxVal * t)}</text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH}
          stroke="var(--chart-baseline-stroke)" strokeWidth="1" />
        {buckets.map((b, i) => {
          const cx = PAD_L + (i + 0.5) * groupW
          const mintH = Math.max(b.mints > 0 ? 2 : 0, (b.mints / maxVal) * chartH)
          const burnH = Math.max(b.burns > 0 ? 2 : 0, (b.burns / maxVal) * chartH)
          const hoverH = Math.max(mintH, burnH, 8)
          return (
            <g key={b.key}
              onMouseEnter={(e) => {
                const rect = svgRef.current?.getBoundingClientRect()
                if (!rect) return
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, bucket: b })
              }}
              style={{ cursor: "default" }}
            >
              {/* invisible hover zone */}
              <rect x={cx - barW - 4} y={PAD_T + chartH - hoverH} width={barW * 2 + 8} height={hoverH}
                fill="transparent" />
              <rect x={cx - barW - 1} y={PAD_T + chartH - mintH}
                width={barW} height={mintH} fill="rgba(110,84,255,0.8)" rx="2" />
              <rect x={cx + 1} y={PAD_T + chartH - burnH}
                width={barW} height={burnH} fill="rgba(220,60,60,0.8)" rx="2" />
              {i % showEveryNth === 0 && (
                <text x={cx} y={H - 6} fontSize="7" textAnchor="middle"
                  fill="var(--chart-label-fill)">{b.label}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RevenueChart({ buckets }: { buckets: FilledBucket[] }) {
  const [tooltip, setTooltip] = useState<TooltipState>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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
    <div className="relative">
      <ChartTooltip tooltip={tooltip} type="revenue" />
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" aria-label="Revenue chart"
        onMouseLeave={() => setTooltip(null)}>
        {[0, 0.5, 1].map((t) => {
          const y = PAD_T + chartH * (1 - t)
          const weiVal = BigInt(Math.round(maxNum * t))
          return (
            <g key={t}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y}
                stroke="var(--chart-grid-stroke)" strokeWidth="1" />
              <text x={PAD_L - 4} y={y + 4} fontSize="7.5" textAnchor="end"
                fill="var(--chart-label-fill)">{fmtWeiShort(weiVal)}</text>
            </g>
          )
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + chartH} y2={PAD_T + chartH}
          stroke="var(--chart-baseline-stroke)" strokeWidth="1" />
        {buckets.map((b, i) => {
          const cx = PAD_L + (i + 0.5) * (chartW / n)
          const h = maxNum > 0 ? Math.max(b.inflowWei > 0n ? 2 : 0, (Number(b.inflowWei) / maxNum) * chartH) : 0
          return (
            <g key={b.key}
              onMouseEnter={(e) => {
                const rect = svgRef.current?.getBoundingClientRect()
                if (!rect) return
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, bucket: b })
              }}
              style={{ cursor: "default" }}
            >
              {/* invisible hover zone */}
              <rect x={cx - barW / 2 - 4} y={PAD_T} width={barW + 8} height={chartH}
                fill="transparent" />
              <rect x={cx - barW / 2} y={PAD_T + chartH - h}
                width={barW} height={h} fill="rgba(0,200,170,0.75)" rx="2" />
              {i % showEveryNth === 0 && (
                <text x={cx} y={H - 6} fontSize="7" textAnchor="middle"
                  fill="var(--chart-label-fill)">{b.label}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
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

// ─── Group Booking Panel ─────────────────────────────────────────────────────

type MintResult = { address: string; status: "pending" | "success" | "error"; message?: string }

function GroupBookingPanel() {
  const { address } = useAccount()
  const contractAddress = getContractAddress()

  const isOperator =
    env.operatorWallets.size === 0 ||
    (!!address && env.operatorWallets.has(address.toLowerCase()))

  const [routes, setRoutes] = useState<ApiRouteLabel[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState("")
  const [seatClass, setSeatClass] = useState<0 | 1>(0)
  const [recipientsRaw, setRecipientsRaw] = useState("")
  const [results, setResults] = useState<MintResult[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void fetchRouteLabels().then((labels) => {
      if (labels && labels.length > 0) {
        setRoutes(labels)
        setSelectedRouteId(labels[0].routeId)
      }
    })
  }, [])

  const { writeContractAsync } = useWriteContract()

  const parseAddresses = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => /^0x[a-fA-F0-9]{40}$/i.test(s))

  const onMint = async () => {
    if (!contractAddress || !address || !selectedRouteId) return
    const addrs = parseAddresses(recipientsRaw)
    if (addrs.length === 0) return

    setRunning(true)
    setResults(addrs.map((a) => ({ address: a, status: "pending" })))

    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7)
    const routeIdBig = BigInt(selectedRouteId)

    for (let i = 0; i < addrs.length; i++) {
      const to = addrs[i] as `0x${string}`
      try {
        await writeContractAsync({
          address: contractAddress,
          abi: chainPassTicketAbi,
          functionName: "mint",
          args: [to, routeIdBig, validUntil, address],
        })
        setResults((prev) =>
          prev.map((r, idx) => idx === i ? { ...r, status: "success" } : r)
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 80) : "Failed"
        setResults((prev) =>
          prev.map((r, idx) => idx === i ? { ...r, status: "error", message: msg } : r)
        )
      }
    }
    setRunning(false)
  }

  if (!isOperator) return null

  const parsedCount = parseAddresses(recipientsRaw).length

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container">
      <div className="border-b border-outline-variant/15 px-5 py-4">
        <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-primary">Group Booking</p>
        <p className="mt-0.5 text-xs text-on-surface-variant">
          Mint tickets to multiple recipients. Requires MINTER_ROLE on the contract.
        </p>
      </div>

      <div className="space-y-4 p-5">
        {/* Route selector */}
        <label className="block">
          <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Route</span>
          <select
            className="mt-1.5 w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 text-sm text-white focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(e.target.value)}
            disabled={running}
          >
            {routes.map((r) => (
              <option key={r.routeId} value={r.routeId}>
                {r.name}{r.category ? ` — ${r.category}` : ""}
              </option>
            ))}
            {routes.length === 0 && (
              <option value="">No routes loaded</option>
            )}
          </select>
        </label>

        {/* Seat class */}
        <div>
          <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Seat class</span>
          <div className="mt-1.5 flex gap-2">
            <button type="button"
              onClick={() => setSeatClass(0)}
              disabled={running}
              className={`flex flex-1 items-center justify-center rounded-xl border py-2 font-headline text-sm font-semibold transition-all disabled:opacity-50 ${
                seatClass === 0
                  ? "border-primary/40 bg-primary/10 text-white"
                  : "border-outline-variant/20 text-on-surface-variant hover:text-white"
              }`}
            >
              Economy
            </button>
            <button type="button"
              onClick={() => setSeatClass(1)}
              disabled={running}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2 font-headline text-sm font-semibold transition-all disabled:opacity-50 ${
                seatClass === 1
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  : "border-outline-variant/20 text-on-surface-variant hover:text-white"
              }`}
            >
              <span className={seatClass === 1 ? "text-amber-300" : "text-on-surface-variant/50"} aria-hidden>✦</span>
              Business
            </button>
          </div>
        </div>

        {/* Recipients */}
        <label className="block">
          <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Recipient addresses
            {parsedCount > 0 && (
              <span className="ml-2 normal-case font-normal text-primary">{parsedCount} valid</span>
            )}
          </span>
          <textarea
            rows={5}
            className="mt-1.5 w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 font-mono text-xs text-white placeholder-on-surface-variant/40 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors resize-none"
            placeholder={"0xAbc…\n0xDef…"}
            value={recipientsRaw}
            onChange={(e) => setRecipientsRaw(e.target.value)}
            disabled={running}
          />
          <p className="mt-1 text-[10px] text-on-surface-variant/50">One address per line. 0x… format.</p>
        </label>

        {/* Mint button */}
        <button
          type="button"
          disabled={running || parsedCount === 0 || !selectedRouteId || !contractAddress}
          onClick={() => void onMint()}
          className="w-full rounded-2xl bg-primary px-6 py-3.5 font-headline text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Minting…
            </span>
          ) : (
            `Mint ${parsedCount > 0 ? parsedCount : ""} ticket${parsedCount !== 1 ? "s" : ""}`
          )}
        </button>

        {/* Progress */}
        {results.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-3">
            {results.map((r) => (
              <div key={r.address} className="flex items-center gap-2">
                <span className="shrink-0">
                  {r.status === "pending" && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary inline-block" />
                  )}
                  {r.status === "success" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="text-tertiary" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {r.status === "error" && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="text-error" aria-hidden>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </span>
                <span className={`font-mono text-[11px] truncate ${
                  r.status === "success" ? "text-white" :
                  r.status === "error" ? "text-error" :
                  "text-on-surface-variant"
                }`}>
                  {r.address.slice(0, 10)}…{r.address.slice(-6)}
                </span>
                {r.status === "error" && r.message && (
                  <span className="ml-auto shrink-0 font-headline text-[10px] text-error/70 truncate max-w-[120px]">{r.message}</span>
                )}
                {r.status === "success" && (
                  <span className="ml-auto shrink-0 font-headline text-[10px] text-tertiary">Minted</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const REFETCH_MS = 8000

// Still needed for grantRole / revokeRole write calls below. The matching
// `RoleGranted` / `RoleRevoked` event scan was removed in favour of the
// /api/v1/operator/burners endpoint.
const BURNER_ROLE_HASH = keccak256(toBytes("BURNER_ROLE"))

export function OperatorPage() {
  const contract = env.contractAddress
  const contractAddress = getContractAddress()
  const { address } = useAccount()

  /* ── Input field style ── */
  const inputClass =
    "mt-1.5 w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/50 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"

  // ── Admin role check ──────────────────────────────────────────────────────
  const { data: adminRole } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "DEFAULT_ADMIN_ROLE",
    query: { enabled: !!contractAddress },
  })
  const { data: isAdmin } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "hasRole",
    args: adminRole && address ? [adminRole, address] : undefined,
    query: { enabled: !!contractAddress && !!adminRole && !!address },
  })

  // ── Register route ────────────────────────────────────────────────────────
  const [regCategory, setRegCategory] = useState("")
  const [regName, setRegName] = useState("")
  const [regDetail, setRegDetail] = useState("")
  const [regShortCode, setRegShortCode] = useState("")
  const [regPriceMon, setRegPriceMon] = useState("")
  const [regFormErr, setRegFormErr] = useState<string | null>(null)
  const [regLabelMsg, setRegLabelMsg] = useState<string | null>(null)
  // Vehicle type config
  const [regVehicleType, setRegVehicleType] = useState<"train" | "bus" | "light_rail">("bus")
  const [regIsInterstate, setRegIsInterstate] = useState(true)
  const [regTotalSeats, setRegTotalSeats] = useState("")
  // Train per-class coach config
  type ClassCfg = { enabled: boolean; count: string; rows: string; leftCols: string; rightCols: string }
  const defaultClassCfg = (): ClassCfg => ({ enabled: false, count: "1", rows: "10", leftCols: "2", rightCols: "2" })
  const [regClasses, setRegClasses] = useState<Record<"first" | "business" | "economy", ClassCfg>>({
    first: defaultClassCfg(),
    business: defaultClassCfg(),
    economy: { ...defaultClassCfg(), enabled: true },
  })
  const updateClass = (cls: "first" | "business" | "economy", field: keyof ClassCfg, value: string | boolean) =>
    setRegClasses(prev => ({ ...prev, [cls]: { ...prev[cls], [field]: value } }))

  const {
    data: routePriceHash,
    writeContract: writeSetRoutePrice,
    isPending: routePricePending,
    error: routePriceError,
    reset: resetRoutePrice,
  } = useWriteContract()
  const { isLoading: routePriceConfirming, isSuccess: routePriceSuccess } = useWaitForTransactionReceipt({
    hash: routePriceHash,
  })

  const pendingRegRouteIdRef = useRef<string | null>(null)

  const onRegisterRoute = useCallback(() => {
    if (!contractAddress || !isAdmin) return
    setRegFormErr(null)
    setRegLabelMsg(null)
    resetRoutePrice()
    if (!regName.trim() || !regCategory.trim()) {
      setRegFormErr("Name and category are required.")
      return
    }
    // Short code is optional — but if the operator typed one, it must match
    // the DB CHECK (1-8 uppercase alphanumeric) before we burn gas setting
    // the on-chain price. Catching it here saves a round-trip + a failed
    // registerRouteLabel call after the successful tx.
    const trimmedShortCode = regShortCode.trim().toUpperCase()
    if (trimmedShortCode && !/^[A-Z0-9]{1,8}$/.test(trimmedShortCode)) {
      setRegFormErr("Short code must be 1-8 letters or digits (e.g. LAGIB, MTR3).")
      return
    }
    let wei: bigint
    try {
      wei = parseEther(regPriceMon.trim() || "0")
    } catch {
      setRegFormErr("Invalid price (MON). Use a decimal number, e.g. 0.075")
      return
    }
    const rid = newRouteIdDecimalFromUuid()
    pendingRegRouteIdRef.current = rid
    const routeIdBig = BigInt(rid)
    writeSetRoutePrice({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setRouteMintPrice",
      args: [routeIdBig, wei],
    })
  }, [contractAddress, isAdmin, regName, regCategory, regShortCode, regPriceMon, resetRoutePrice, writeSetRoutePrice])

  const lastRouteRegHash = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!routePriceSuccess || !routePriceHash) return
    if (lastRouteRegHash.current === routePriceHash) return
    lastRouteRegHash.current = routePriceHash
    const rid = pendingRegRouteIdRef.current?.trim() ?? ""
    if (!rid) return
    const name = regName.trim()
    const category = regCategory.trim()
    const detail = regDetail.trim()
    const shortCode = regShortCode.trim().toUpperCase() || null
    const monNum = Number(regPriceMon.trim())
    const priceMon = Number.isFinite(monNum) && monNum >= 0 ? monNum : undefined
    // Derived: trains are always interstate; light rail is always intrastate
    const effectiveVehicleType = regVehicleType
    const effectiveIsInterstate = regVehicleType === "train" ? true : regVehicleType === "light_rail" ? false : regIsInterstate
    const totalSeatsNum = regVehicleType === "bus" ? parseInt(regTotalSeats) || null : null
    const coachClasses: CoachClassConfig[] = regVehicleType === "train"
      ? (["first", "business", "economy"] as const)
          .filter(cls => regClasses[cls].enabled)
          .map(cls => ({
            class: cls,
            count: Math.max(1, parseInt(regClasses[cls].count) || 1),
            rows: Math.max(1, parseInt(regClasses[cls].rows) || 10),
            leftCols: Math.max(1, parseInt(regClasses[cls].leftCols) || 2),
            rightCols: Math.max(1, parseInt(regClasses[cls].rightCols) || 2),
          }))
      : []

    void registerRouteLabel({
      routeId: rid,
      name,
      category,
      detail: detail || null,
      shortCode,
      priceMon,
      vehicleType: effectiveVehicleType,
      isInterstate: effectiveIsInterstate,
      coachClasses: coachClasses.length > 0 ? coachClasses : null,
      totalSeats: totalSeatsNum,
    }).then((result) => {
      if (result.ok) {
        const fileOk = result.nigeriaRoutesFile?.ok === true
        const fileFail = result.nigeriaRoutesFile && result.nigeriaRoutesFile.ok === false
        if (fileOk) {
          setRegLabelMsg("New route registered on-chain, in the routes list")
        } else if (fileFail && result.nigeriaRoutesFile && result.nigeriaRoutesFile.ok === false) {
          setRegLabelMsg(
            `New route registered on-chain and in the routes list. nigeria-routes.json: ${result.nigeriaRoutesFile.reason}`,
          )
        } else {
          setRegLabelMsg("New route registered on-chain and in the routes list.")
        }
        setRegFormErr(null)
      } else if (result.status === 409) {
        setRegFormErr(result.error)
        setRegLabelMsg(null)
      } else if (result.status === 503) {
        setRegLabelMsg(
          "Price set on-chain. The routes list needs the API with DATABASE_URL configured (or run seed) to register this route by name.",
        )
        setRegFormErr(null)
      } else {
        setRegFormErr(result.error)
        setRegLabelMsg(null)
      }
    })
  }, [routePriceSuccess, routePriceHash, regName, regCategory, regDetail, regShortCode, regPriceMon,
      regVehicleType, regIsInterstate, regTotalSeats, regClasses])

  // ── MON price config ──────────────────────────────────────────────────────
  const { data: currentMonPrice, refetch: refetchMonPrice } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "mintPriceWei",
    query: { enabled: !!contractAddress },
  })

  const [monDefaultInput, setMonDefaultInput] = useState("")
  const [monRouteIdInput, setMonRouteIdInput] = useState("")
  const [monRoutePriceInput, setMonRoutePriceInput] = useState("")
  const [monFormErr, setMonFormErr] = useState<string | null>(null)

  const {
    data: setMonDefaultHash, writeContract: writeSetMonDefault,
    isPending: setMonDefaultPending, error: setMonDefaultError, reset: resetMonDefault,
  } = useWriteContract()
  const { isLoading: setMonDefaultConfirming, isSuccess: setMonDefaultSuccess } =
    useWaitForTransactionReceipt({ hash: setMonDefaultHash })

  const {
    data: setMonRouteHash, writeContract: writeSetMonRoute,
    isPending: setMonRoutePending, error: setMonRouteError, reset: resetMonRoute,
  } = useWriteContract()
  const { isLoading: setMonRouteConfirming, isSuccess: setMonRouteSuccess } =
    useWaitForTransactionReceipt({ hash: setMonRouteHash })

  useEffect(() => { if (setMonDefaultSuccess || setMonRouteSuccess) void refetchMonPrice() },
    [setMonDefaultSuccess, setMonRouteSuccess, refetchMonPrice])

  const onSetMonDefault = () => {
    if (!contractAddress) return
    setMonFormErr(null)
    resetMonDefault()
    const raw = monDefaultInput.trim()
    if (!raw || isNaN(Number(raw)) || Number(raw) < 0) {
      setMonFormErr("Enter a valid MON amount (e.g. 0.05).")
      return
    }
    let amount: bigint
    try { amount = parseEther(raw) } catch {
      setMonFormErr("Invalid MON amount.")
      return
    }
    writeSetMonDefault({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setMintPriceWei",
      args: [amount],
    })
  }

  const onSetMonRoute = () => {
    if (!contractAddress) return
    setMonFormErr(null)
    resetMonRoute()
    const idRaw = monRouteIdInput.trim()
    const priceRaw = monRoutePriceInput.trim()
    if (!idRaw || !/^\d+$/.test(idRaw)) {
      setMonFormErr("Enter a valid numeric route ID.")
      return
    }
    if (!priceRaw || isNaN(Number(priceRaw)) || Number(priceRaw) < 0) {
      setMonFormErr("Enter a valid MON price (e.g. 0.075).")
      return
    }
    let routeId: bigint
    let amount: bigint
    try { routeId = BigInt(idRaw) } catch {
      setMonFormErr("Route ID must be a number.")
      return
    }
    try { amount = parseEther(priceRaw) } catch {
      setMonFormErr("Invalid MON amount.")
      return
    }
    writeSetMonRoute({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setRouteMintPrice",
      args: [routeId, amount],
    })
  }

  // ── USDC config ───────────────────────────────────────────────────────────
  const { data: currentUsdcToken, error: usdcTokenReadErr } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "usdcToken",
    query: { enabled: !!contractAddress, retry: 1 },
  })
  const { data: currentUsdcPrice } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "mintPriceUsdc",
    query: { enabled: !!contractAddress, retry: 1 },
  })
  const contractHasUsdc: boolean | null =
    usdcTokenReadErr != null ? false :
    currentUsdcToken !== undefined ? true : null

  const [usdcTokenInput, setUsdcTokenInput] = useState("")
  const [usdcPriceInput, setUsdcPriceInput] = useState("")
  const [usdcFormErr, setUsdcFormErr] = useState<string | null>(null)

  useEffect(() => {
    if (env.usdcAddress && !usdcTokenInput) setUsdcTokenInput(env.usdcAddress)
  }, [usdcTokenInput])

  const {
    data: setTokenHash, writeContract: writeSetUsdcToken,
    isPending: setTokenPending, error: setTokenError, reset: resetSetToken,
  } = useWriteContract()
  const { isLoading: setTokenConfirming, isSuccess: setTokenSuccess } =
    useWaitForTransactionReceipt({ hash: setTokenHash })

  const {
    data: setPriceHash, writeContract: writeSetUsdcPrice,
    isPending: setPricePending, error: setPriceError, reset: resetSetPrice,
  } = useWriteContract()
  const { isLoading: setPriceConfirming, isSuccess: setPriceSuccess } =
    useWaitForTransactionReceipt({ hash: setPriceHash })

  const onSetUsdcToken = () => {
    if (!contractAddress) return
    setUsdcFormErr(null)
    resetSetToken()
    if (!isAddress(usdcTokenInput.trim())) {
      setUsdcFormErr("Enter a valid 0x address for the USDC token.")
      return
    }
    writeSetUsdcToken({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setUsdcToken",
      args: [usdcTokenInput.trim() as `0x${string}`],
    })
  }

  const onSetUsdcPrice = () => {
    if (!contractAddress) return
    setUsdcFormErr(null)
    resetSetPrice()
    const raw = usdcPriceInput.trim()
    if (!raw || isNaN(Number(raw)) || Number(raw) < 0) {
      setUsdcFormErr("Enter a valid USDC amount (e.g. 0.10).")
      return
    }
    let amount: bigint
    try { amount = parseUnits(raw, 6) } catch {
      setUsdcFormErr("Invalid USDC amount.")
      return
    }
    writeSetUsdcPrice({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setMintPriceUsdc",
      args: [amount],
    })
  }

  // ── Conductors / Burners ──────────────────────────────────────────────────
  const [burners, setBurners] = useState<{ address: string; active: boolean }[]>([])
  const [newBurner, setNewBurner] = useState("")
  const [burnersLoading, setBurnersLoading] = useState(false)

  const {
    data: burnerWriteHash, writeContract: writeBurnerRole,
    isPending: burnerWritePending, error: burnerWriteError, reset: resetBurnerWrite,
  } = useWriteContract()
  const { isLoading: burnerWriteConfirming, isSuccess: burnerWriteSuccess } =
    useWaitForTransactionReceipt({ hash: burnerWriteHash })

  const loadBurners = useCallback(async () => {
    if (!contractAddress) return
    setBurnersLoading(true)
    try {
      // Conductor (burner) state comes from the API now — it reads role_events
      // (populated by the indexer) and returns the latest state per address.
      // The old path scanned chain logs from the browser which tripped HTTP 413
      // on Monad's public RPC. Null response = API down or indexer hasn't run
      // yet; keep the list empty rather than erroring.
      const res = await fetchOperatorBurners()
      setBurners(res ? res.burners : [])
    } catch {
      // silent
    }
    setBurnersLoading(false)
  }, [contractAddress])

  useEffect(() => { void loadBurners() }, [loadBurners])

  useEffect(() => {
    if (burnerWriteSuccess) {
      setNewBurner("")
      resetBurnerWrite()
      setTimeout(() => { void loadBurners() }, 3000)
    }
  }, [burnerWriteSuccess, loadBurners, resetBurnerWrite])

  const grantBurner = (addr: string) => {
    if (!contractAddress) return
    resetBurnerWrite()
    writeBurnerRole({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "grantRole",
      args: [BURNER_ROLE_HASH, addr as `0x${string}`],
    })
  }

  const revokeBurner = (addr: string) => {
    if (!contractAddress) return
    resetBurnerWrite()
    writeBurnerRole({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "revokeRole",
      args: [BURNER_ROLE_HASH, addr as `0x${string}`],
    })
  }

  // ── Trip scheduling state ────────────────────────────────────────────────────
  const [tripRouteId, setTripRouteId] = useState("")
  const [trips, setTrips] = useState<ApiTrip[]>([])
  const [tripsLoading, setTripsLoading] = useState(false)
  const [tripDeparture, setTripDeparture] = useState("")
  const [tripArrival, setTripArrival] = useState("")
  const [tripFormErr, setTripFormErr] = useState<string | null>(null)
  const [tripSaving, setTripSaving] = useState(false)
  const [tripMsg, setTripMsg] = useState<string | null>(null)
  const [deletingTripId, setDeletingTripId] = useState<number | null>(null)
  const [tripDeleteInProgress, setTripDeleteInProgress] = useState(false)

  const loadTrips = async (routeId: string) => {
    if (!routeId) { setTrips([]); return }
    setTripsLoading(true)
    const result = await fetchTrips(routeId)
    setTrips(result)
    setTripsLoading(false)
  }

  const onTripRouteChange = (routeId: string) => {
    setTripRouteId(routeId)
    setTripFormErr(null)
    setTripMsg(null)
    void loadTrips(routeId)
  }

  const onCreateTrip = async () => {
    setTripFormErr(null)
    setTripMsg(null)
    if (!tripRouteId) { setTripFormErr("Select a route first."); return }
    if (!tripDeparture) { setTripFormErr("Departure date/time is required."); return }
    if (!tripArrival)   { setTripFormErr("Arrival date/time is required."); return }
    if (new Date(tripArrival) <= new Date(tripDeparture)) {
      setTripFormErr("Arrival must be after departure."); return
    }
    setTripSaving(true)
    const result = await createTrip({
      routeId: tripRouteId,
      departureAt: new Date(tripDeparture).toISOString(),
      arrivalAt: new Date(tripArrival).toISOString(),
    })
    setTripSaving(false)
    if (result.ok) {
      setTrips((prev) => [...prev, result.trip].sort(
        (a, b) => new Date(a.departureAt).getTime() - new Date(b.departureAt).getTime()
      ))
      setTripDeparture("")
      setTripArrival("")
      setTripMsg("Trip scheduled.")
      setTimeout(() => setTripMsg(null), 3000)
    } else {
      setTripFormErr(result.error)
    }
  }

  const onTripStatusChange = async (tripId: number, status: TripStatus) => {
    const result = await updateTripStatus(tripId, status)
    if (result.ok) {
      setTrips((prev) => prev.map((t) => t.id === tripId ? result.trip : t))
    }
  }

  const onDeleteTrip = async (tripId: number) => {
    setTripDeleteInProgress(true)
    const result = await deleteTrip(tripId)
    setTripDeleteInProgress(false)
    if (result.ok) {
      setTrips((prev) => prev.filter((t) => t.id !== tripId))
      setDeletingTripId(null)
    } else {
      setDeletingTripId(null)
      setTripFormErr(result.error)
    }
  }

  // ── Edit / delete route state ──────────────────────────────────────────────
  const [editRoutes, setEditRoutes] = useState<ApiRouteLabel[]>([])
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [editDetail, setEditDetail] = useState("")
  const [editSchedule, setEditSchedule] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [editMsg, setEditMsg] = useState<string | null>(null)
  const [deletingRouteId, setDeletingRouteId] = useState<string | null>(null)
  const [deleteInProgress, setDeleteInProgress] = useState(false)
  const [routeCapacities, setRouteCapacities] = useState<Record<string, RouteCapacity>>({})

  /**
   * Single source of truth for refreshing the editable route list.
   * Called on mount and whenever a child mutation (e.g. schedule mode change)
   * might have altered a row we care about.
   */
  const reloadRoutes = useCallback(async () => {
    const labels = await fetchRouteLabels()
    if (!labels) return
    setEditRoutes(labels)
    const entries = await Promise.all(
      labels.map(async (r) => {
        const cap = await fetchRouteCapacity(r.routeId)
        return cap ? ([r.routeId, cap] as [string, RouteCapacity]) : null
      }),
    )
    const map: Record<string, RouteCapacity> = {}
    for (const e of entries) { if (e) map[e[0]] = e[1] }
    setRouteCapacities(map)
  }, [])
  useEffect(() => { void reloadRoutes() }, [reloadRoutes])

  const startEdit = (r: ApiRouteLabel) => {
    setEditingRouteId(r.routeId)
    setEditName(r.name)
    setEditCategory(r.category)
    setEditDetail(r.detail ?? "")
    setEditSchedule(r.schedule ?? "")
    setEditMsg(null)
  }

  const cancelEdit = () => { setEditingRouteId(null); setEditMsg(null) }

  const saveEdit = async () => {
    if (!editingRouteId) return
    setEditSaving(true)
    setEditMsg(null)
    const result = await updateRouteLabel(editingRouteId, {
      name: editName.trim(),
      category: editCategory.trim(),
      detail: editDetail.trim() || null,
      schedule: editSchedule.trim() || null,
    })
    setEditSaving(false)
    if (result.ok) {
      setEditRoutes((prev) => prev.map((r) => r.routeId === editingRouteId ? result.route : r))
      setEditingRouteId(null)
    } else {
      setEditMsg(`Error: ${result.error}`)
    }
  }

  const confirmDelete = async (routeId: string) => {
    setDeleteInProgress(true)
    const result = await deleteRouteLabel(routeId)
    setDeleteInProgress(false)
    if (result.ok) {
      setEditRoutes((prev) => prev.filter((r) => r.routeId !== routeId))
      setDeletingRouteId(null)
      if (editingRouteId === routeId) setEditingRouteId(null)
    } else {
      setDeletingRouteId(null)
      setEditMsg(`Delete failed: ${result.error}`)
    }
  }

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

      {/* ── Admin accordions ── */}

      {/* Register new route */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
          Register new route
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>
        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4">
          <p className="mb-4 text-xs leading-relaxed text-on-surface-variant">
            Generates a random route ID, sets its on-chain price, and registers the label.
            Requires <code className="font-mono text-tertiary">DEFAULT_ADMIN_ROLE</code>.
          </p>
          {isAdmin !== true ? (
            <p className="text-sm text-on-surface-variant">Connect an admin wallet to enable this form.</p>
          ) : (
            <div className="space-y-4">

              {/* ── Vehicle type selector ── */}
              <div>
                <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Vehicle type
                </span>
                <div className="mt-1.5 flex gap-2">
                  {(["train", "bus", "light_rail"] as const).map((vt) => (
                    <button key={vt} type="button"
                      onClick={() => {
                        setRegVehicleType(vt)
                        // Trains are always interstate; light rail always intrastate
                        if (vt === "train") setRegIsInterstate(true)
                        if (vt === "light_rail") setRegIsInterstate(false)
                      }}
                      className={`flex-1 rounded-xl border py-2.5 font-headline text-xs font-semibold transition-all ${
                        regVehicleType === vt
                          ? "border-primary/40 bg-primary/10 text-white"
                          : "border-outline-variant/20 text-on-surface-variant hover:border-primary/20 hover:text-white"
                      }`}>
                      {vt === "train" ? "🚂 Train" : vt === "bus" ? "🚌 Bus" : "🚈 Light Rail"}
                    </button>
                  ))}
                </div>
                {/* Context tag */}
                <p className="mt-1.5 text-[10px] text-on-surface-variant/60">
                  {regVehicleType === "train" && "Interstate · configure First Class / Business / Economy coaches with custom row & column layout"}
                  {regVehicleType === "bus" && "Interstate or intrastate · no seat classes · numbered seats"}
                  {regVehicleType === "light_rail" && "Intrastate only · no classes · no seat configuration"}
                </p>
              </div>

              {/* ── Bus: Interstate / Intrastate toggle ── */}
              {regVehicleType === "bus" && (
                <div>
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Travel scope
                  </span>
                  <div className="mt-1.5 flex gap-2">
                    {([true, false] as const).map((interstate) => (
                      <button key={String(interstate)} type="button"
                        onClick={() => setRegIsInterstate(interstate)}
                        className={`flex-1 rounded-xl border py-2 font-headline text-xs font-semibold transition-all ${
                          regIsInterstate === interstate
                            ? "border-primary/40 bg-primary/10 text-white"
                            : "border-outline-variant/20 text-on-surface-variant hover:border-primary/20 hover:text-white"
                        }`}>
                        {interstate ? "Interstate" : "Intrastate"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Train: per-class coach configuration ── */}
              {regVehicleType === "train" && (
                <div>
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Coach classes
                  </span>
                  <div className="mt-2 space-y-2">
                    {(["first", "business", "economy"] as const).map((cls) => {
                      const cfg = regClasses[cls]
                      const label = cls === "first" ? "💎 First Class" : cls === "business" ? "✦ Business" : "🪑 Economy"
                      const seatsPerCoach = (parseInt(cfg.rows) || 0) * ((parseInt(cfg.leftCols) || 0) + (parseInt(cfg.rightCols) || 0))
                      const totalSeatsForClass = seatsPerCoach * (parseInt(cfg.count) || 1)
                      return (
                        <div key={cls} className={`rounded-xl border p-3 transition-all ${cfg.enabled ? "border-primary/30 bg-primary/5" : "border-outline-variant/15"}`}>
                          {/* toggle header */}
                          <button type="button" onClick={() => updateClass(cls, "enabled", !cfg.enabled)}
                            className="flex w-full items-center gap-2">
                            <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all ${cfg.enabled ? "border-primary bg-primary" : "border-outline-variant/40"}`}>
                              {cfg.enabled && (
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="2,6 5,9 10,3"/>
                                </svg>
                              )}
                            </div>
                            <span className={`font-headline text-xs font-semibold ${cfg.enabled ? "text-white" : "text-on-surface-variant"}`}>
                              {label}
                            </span>
                          </button>
                          {/* expanded inputs */}
                          {cfg.enabled && (
                            <div className="mt-3 space-y-2">
                              <div className="grid grid-cols-4 gap-2">
                                {([ ["count","Coaches","1","20"], ["rows","Rows","1","30"], ["leftCols","Left cols","1","4"], ["rightCols","Right cols","1","4"] ] as const).map(([field, title, min, max]) => (
                                  <label key={field} className="block">
                                    <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">{title}</span>
                                    <input type="number" min={min} max={max}
                                      className={`${inputClass} font-mono text-center`}
                                      value={cfg[field as keyof typeof cfg] as string}
                                      onChange={(e) => updateClass(cls, field as keyof typeof cfg, e.target.value)} />
                                  </label>
                                ))}
                              </div>
                              {seatsPerCoach > 0 && (
                                <p className="text-[10px] text-on-surface-variant/60">
                                  {seatsPerCoach} seats/coach × {parseInt(cfg.count) || 1} coach{(parseInt(cfg.count)||1) !== 1 ? "es" : ""} = <span className="font-semibold text-on-surface-variant">{totalSeatsForClass} seats</span>
                                  {" · "}layout: {parseInt(cfg.leftCols)||2} + {parseInt(cfg.rightCols)||2} per row
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {/* Total summary */}
                    {(["first","business","economy"] as const).some(c => regClasses[c].enabled) && (() => {
                      const total = (["first","business","economy"] as const)
                        .filter(c => regClasses[c].enabled)
                        .reduce((sum, c) => {
                          const cfg = regClasses[c]
                          return sum + (parseInt(cfg.rows)||0) * ((parseInt(cfg.leftCols)||0) + (parseInt(cfg.rightCols)||0)) * (parseInt(cfg.count)||1)
                        }, 0)
                      const coaches = (["first","business","economy"] as const)
                        .filter(c => regClasses[c].enabled)
                        .reduce((sum, c) => sum + (parseInt(regClasses[c].count)||1), 0)
                      return (
                        <p className="pl-1 text-[10px] text-on-surface-variant/60">
                          Total: {coaches} coaches · {total} seats
                        </p>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* ── Bus: total seats ── */}
              {regVehicleType === "bus" && (
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Total seats
                  </span>
                  <input type="number" min="1" max="100" className={`${inputClass} font-mono w-40`}
                    value={regTotalSeats} onChange={(e) => setRegTotalSeats(e.target.value)}
                    placeholder="e.g. 54" />
                </label>
              )}

              {/* ── Light rail: info ── */}
              {regVehicleType === "light_rail" && (
                <div className="flex items-start gap-2 rounded-xl border border-outline-variant/15 bg-surface-container-high px-4 py-3">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="mt-0.5 shrink-0 text-on-surface-variant/50" aria-hidden>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <p className="text-xs text-on-surface-variant/70">
                    Light rail operates within a single state. No seat configuration or class system — passengers board any available space.
                  </p>
                </div>
              )}

              <div className="border-t border-outline-variant/10 pt-1" />

              {/* ── Route details ── */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Category</span>
                  <input type="text" className={inputClass} value={regCategory} maxLength={60}
                    onChange={(e) => setRegCategory(e.target.value)} placeholder="e.g. Lagos Metro" />
                </label>
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Mint price (MON)</span>
                  <input type="text" className={`${inputClass} font-mono`} value={regPriceMon}
                    onChange={(e) => setRegPriceMon(e.target.value)} placeholder="0.075" />
                </label>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Route name</span>
                  <input type="text" className={inputClass} value={regName} maxLength={100}
                    onChange={(e) => setRegName(e.target.value)} placeholder="Route display name" />
                </label>
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Short code</span>
                  <input type="text"
                    className={`${inputClass} font-mono uppercase tracking-widest w-28 text-center`}
                    value={regShortCode} maxLength={8}
                    onChange={(e) => setRegShortCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    placeholder="LAGIB" />
                </label>
              </div>
              <p className="-mt-2 pl-1 text-[10px] text-on-surface-variant/60">
                1-8 uppercase letters or digits — shown as a badge on tickets so passengers can ID the route at a glance.
              </p>
              <label className="block">
                <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Detail (optional)</span>
                <input type="text" className={inputClass} value={regDetail} maxLength={200}
                  onChange={(e) => setRegDetail(e.target.value)} placeholder="Short description" />
              </label>
              <button type="button"
                disabled={routePricePending || routePriceConfirming}
                onClick={() => void onRegisterRoute()}
                className="btn-primary-gradient rounded-xl px-5 py-2.5 font-headline text-sm font-bold text-white transition-[filter] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
                {routePricePending || routePriceConfirming ? "Confirm in wallet…" : "Set price & register"}
              </button>
              {routePriceError && <p className="text-xs text-error">{formatWriteContractError(routePriceError)}</p>}
              {regFormErr && <p className="text-xs text-error">{regFormErr}</p>}
              {regLabelMsg && <p className="text-xs text-tertiary">{regLabelMsg}</p>}
            </div>
          )}
        </div>
      </details>

      {/* Edit / delete routes */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
          Edit routes
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>
        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4">
          {editRoutes.length === 0 ? (
            <p className="text-xs text-on-surface-variant">No routes registered yet.</p>
          ) : (
            <ul className="space-y-2">
              {editRoutes.map((r) => (
                <li key={r.routeId}>
                  {editingRouteId === r.routeId ? (
                    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Route name</span>
                          <input type="text" className={inputClass} value={editName} maxLength={100}
                            onChange={(e) => setEditName(e.target.value)} />
                        </label>
                        <label className="block">
                          <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Category</span>
                          <input type="text" className={inputClass} value={editCategory} maxLength={60}
                            onChange={(e) => setEditCategory(e.target.value)} />
                        </label>
                      </div>
                      <label className="block">
                        <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Detail (optional)</span>
                        <input type="text" className={inputClass} value={editDetail} maxLength={200}
                          onChange={(e) => setEditDetail(e.target.value)} placeholder="Short description" />
                      </label>
                      <label className="block">
                        <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Schedule (optional)</span>
                        <input type="text" className={inputClass} value={editSchedule} maxLength={200}
                          onChange={(e) => setEditSchedule(e.target.value)} placeholder="e.g. Mon–Fri 06:00–22:00" />
                      </label>
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={editSaving || !editName.trim()}
                          onClick={() => void saveEdit()}
                          className="rounded-lg bg-primary px-4 py-2 font-headline text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-50">
                          {editSaving ? "Saving…" : "Save"}
                        </button>
                        <button type="button" disabled={editSaving}
                          onClick={cancelEdit}
                          className="rounded-lg border border-outline-variant/25 px-4 py-2 font-headline text-xs font-semibold text-on-surface-variant transition-colors hover:text-white">
                          Cancel
                        </button>
                        {editMsg && <p className="text-xs text-error">{editMsg}</p>}
                      </div>
                    </div>
                  ) : deletingRouteId === r.routeId ? (
                    <div className="flex items-center gap-3 rounded-xl border border-error/30 bg-error/8 px-4 py-3">
                      <p className="flex-1 text-xs text-error">Delete <span className="font-semibold">{r.name}</span>? This cannot be undone.</p>
                      <button type="button" disabled={deleteInProgress}
                        onClick={() => void confirmDelete(r.routeId)}
                        className="shrink-0 rounded-lg bg-error/80 px-3 py-1.5 font-headline text-xs font-bold text-white hover:bg-error disabled:opacity-50">
                        {deleteInProgress ? "Deleting…" : "Confirm"}
                      </button>
                      <button type="button" disabled={deleteInProgress}
                        onClick={() => setDeletingRouteId(null)}
                        className="shrink-0 rounded-lg border border-outline-variant/25 px-3 py-1.5 font-headline text-xs font-semibold text-on-surface-variant hover:text-white">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 rounded-xl border border-outline-variant/15 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-headline text-sm font-semibold text-white">{r.name}</p>
                        <p className="truncate text-xs text-on-surface-variant">{r.category}{r.detail ? ` · ${r.detail}` : ""}</p>
                        {(() => {
                          const cap = routeCapacities[r.routeId]
                          if (!cap || cap.capacity === null) return null
                          const pct = Math.min(100, ((cap.sold + cap.reserved) / cap.capacity) * 100)
                          return (
                            <div className="mt-1.5">
                              <div className="mb-1 flex items-center justify-between">
                                <span className="font-headline text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/60">
                                  {cap.sold} / {cap.capacity} sold
                                  {cap.reserved > 0 ? ` · ${cap.reserved} held` : ""}
                                </span>
                                {cap.soldOut && (
                                  <span className="font-headline text-[9px] font-bold uppercase tracking-wider text-error">SOLD OUT</span>
                                )}
                              </div>
                              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                                <div
                                  className={`h-full rounded-full transition-all ${cap.soldOut ? "bg-error" : pct > 80 ? "bg-amber-400" : "bg-primary"}`}
                                  style={{ width: `${pct.toFixed(1)}%` }}
                                />
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                      <button type="button" onClick={() => startEdit(r)}
                        className="shrink-0 rounded-lg border border-outline-variant/20 px-3 py-1.5 font-headline text-xs font-semibold text-on-surface-variant transition-colors hover:border-primary/30 hover:text-white">
                        Edit
                      </button>
                      <button type="button" onClick={() => setDeletingRouteId(r.routeId)}
                        className="shrink-0 rounded-lg border border-error/20 px-3 py-1.5 font-headline text-xs font-semibold text-error/70 transition-colors hover:border-error/40 hover:text-error">
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      {/* Weekly schedule — mode toggle + per-day session editor (Phase 1) */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
          Weekly schedule
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>
        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4">
          <ScheduleRouteEditor routes={editRoutes} onRouteUpdated={() => void reloadRoutes()} />
        </div>
      </details>

      {/* Schedule trips */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors"
          onClick={() => { if (!tripRouteId && editRoutes.length > 0) onTripRouteChange(editRoutes[0].routeId) }}>
          Schedule trips
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>
        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4 space-y-5">

          {/* Route picker */}
          <label className="block">
            <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Route</span>
            <select
              className="mt-1.5 w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 text-sm text-white focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
              value={tripRouteId}
              onChange={(e) => onTripRouteChange(e.target.value)}
            >
              <option value="">Select a route…</option>
              {editRoutes.map((r) => (
                <option key={r.routeId} value={r.routeId}>{r.name}</option>
              ))}
            </select>
          </label>

          {/* New trip form */}
          {tripRouteId && (
            <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-4 space-y-3">
              <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">New trip</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Departure</span>
                  <input type="datetime-local" className={inputClass}
                    value={tripDeparture} onChange={(e) => setTripDeparture(e.target.value)} />
                </label>
                <label className="block">
                  <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70">Arrival</span>
                  <input type="datetime-local" className={inputClass}
                    value={tripArrival} onChange={(e) => setTripArrival(e.target.value)} />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" disabled={tripSaving}
                  onClick={() => void onCreateTrip()}
                  className="rounded-lg bg-primary px-4 py-2 font-headline text-xs font-bold text-white hover:brightness-110 disabled:opacity-50">
                  {tripSaving ? "Scheduling…" : "Schedule trip"}
                </button>
                {tripMsg && <p className="text-xs text-tertiary">{tripMsg}</p>}
                {tripFormErr && <p className="text-xs text-error">{tripFormErr}</p>}
              </div>
            </div>
          )}

          {/* Trip list */}
          {tripRouteId && (
            tripsLoading ? (
              <p className="text-xs text-on-surface-variant/60">Loading trips…</p>
            ) : trips.length === 0 ? (
              <p className="text-xs text-on-surface-variant/60">No trips scheduled yet.</p>
            ) : (
              <ul className="space-y-2">
                {trips.map((trip) => {
                  const dep = new Date(trip.departureAt)
                  const arr = new Date(trip.arrivalAt)
                  const fmtOpts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                  const statusColors: Record<TripStatus, string> = {
                    scheduled: "text-on-surface-variant border-outline-variant/20",
                    boarding:  "text-tertiary border-tertiary/30",
                    departed:  "text-primary border-primary/30",
                    arrived:   "text-on-surface-variant/50 border-outline-variant/15",
                    cancelled: "text-error/70 border-error/20",
                  }
                  return (
                    <li key={trip.id}>
                      {deletingTripId === trip.id ? (
                        <div className="flex items-center gap-3 rounded-xl border border-error/30 bg-error/8 px-4 py-3">
                          <p className="flex-1 text-xs text-error">Delete this trip? Tickets already linked cannot be recovered.</p>
                          <button type="button" disabled={tripDeleteInProgress}
                            onClick={() => void onDeleteTrip(trip.id)}
                            className="shrink-0 rounded-lg bg-error/80 px-3 py-1.5 font-headline text-xs font-bold text-white hover:bg-error disabled:opacity-50">
                            {tripDeleteInProgress ? "Deleting…" : "Confirm"}
                          </button>
                          <button type="button" onClick={() => setDeletingTripId(null)}
                            className="shrink-0 rounded-lg border border-outline-variant/25 px-3 py-1.5 font-headline text-xs font-semibold text-on-surface-variant hover:text-white">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-outline-variant/15 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-headline text-sm font-semibold text-white">
                                {dep.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                              </p>
                              <p className="text-xs text-on-surface-variant">
                                {dep.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                {" → "}
                                {arr.toLocaleTimeString(undefined, fmtOpts)}
                              </p>
                            </div>
                            {/* Status selector */}
                            <select
                              value={trip.status}
                              onChange={(e) => void onTripStatusChange(trip.id, e.target.value as TripStatus)}
                              className={`shrink-0 appearance-none rounded-lg border px-2.5 py-1 font-headline text-[10px] font-bold uppercase tracking-widest bg-transparent cursor-pointer focus:outline-none ${statusColors[trip.status]}`}
                            >
                              {(["scheduled","boarding","departed","arrived","cancelled"] as TripStatus[]).map((s) => (
                                <option key={s} value={s} className="bg-surface-container text-white normal-case">{s}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => setDeletingTripId(trip.id)}
                              className="shrink-0 rounded-lg border border-error/20 px-2.5 py-1 font-headline text-xs font-semibold text-error/70 hover:border-error/40 hover:text-error">
                              ✕
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )
          )}
        </div>
      </details>

      {/* Configure MON prices */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
          Configure MON prices
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>
        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4 space-y-5">

          {/* Current on-chain state */}
          <div className="rounded-xl bg-surface-container-high px-4 py-3">
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">Current default price</p>
            <p className="mt-1 font-mono text-sm text-white">
              {typeof currentMonPrice === "bigint"
                ? currentMonPrice === 0n
                  ? <span className="text-on-surface-variant/50">0 MON (free)</span>
                  : `${formatUnits(currentMonPrice, 18)} MON`
                : <span className="h-3 w-12 animate-pulse rounded bg-surface-container-high inline-block" />}
            </p>
          </div>

          {isAdmin !== true ? (
            <p className="text-sm text-on-surface-variant">Connect an admin wallet to configure prices.</p>
          ) : (
            <div className="space-y-5">

              {/* Default price */}
              <div className="space-y-2">
                <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Default price (all routes)
                </p>
                <p className="text-xs text-on-surface-variant/60">
                  Used when a route has no per-route override. Enter in MON (e.g. <code className="font-mono">0.05</code>).
                </p>
                <div className="flex gap-2">
                  <input
                    type="number" step="0.001" min="0"
                    className={`${inputClass} flex-1 font-mono text-xs`}
                    placeholder="0.05"
                    value={monDefaultInput}
                    onChange={(e) => { setMonDefaultInput(e.target.value); resetMonDefault() }}
                  />
                  <button
                    type="button"
                    disabled={setMonDefaultPending || setMonDefaultConfirming}
                    onClick={onSetMonDefault}
                    className="shrink-0 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 font-headline text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {setMonDefaultPending ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                        Confirm…
                      </span>
                    ) : setMonDefaultConfirming ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                        Saving…
                      </span>
                    ) : setMonDefaultSuccess ? "✓ Saved" : "Set"}
                  </button>
                </div>
                {setMonDefaultError && (
                  <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                    <p className="text-xs text-error break-words">{formatWriteContractError(setMonDefaultError)}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-outline-variant/10" />

              {/* Per-route override */}
              <div className="space-y-2">
                <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Per-route override
                </p>
                <p className="text-xs text-on-surface-variant/60">
                  Overrides the default for a specific route. Use the numeric route ID shown in the URL.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    className={`${inputClass} font-mono text-xs`}
                    placeholder="Route ID (number)"
                    value={monRouteIdInput}
                    onChange={(e) => { setMonRouteIdInput(e.target.value); resetMonRoute() }}
                  />
                  <input
                    type="number" step="0.001" min="0"
                    className={`${inputClass} font-mono text-xs`}
                    placeholder="Price in MON"
                    value={monRoutePriceInput}
                    onChange={(e) => { setMonRoutePriceInput(e.target.value); resetMonRoute() }}
                  />
                </div>
                <button
                  type="button"
                  disabled={setMonRoutePending || setMonRouteConfirming}
                  onClick={onSetMonRoute}
                  className="rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 font-headline text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {setMonRoutePending ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                      Confirm…
                    </span>
                  ) : setMonRouteConfirming ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                      Saving…
                    </span>
                  ) : setMonRouteSuccess ? "✓ Saved" : "Set route price"}
                </button>
                {setMonRouteError && (
                  <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                    <p className="text-xs text-error break-words">{formatWriteContractError(setMonRouteError)}</p>
                  </div>
                )}
              </div>

              {monFormErr && (
                <p className="rounded-xl bg-error/10 px-3 py-2 text-xs text-error">{monFormErr}</p>
              )}

            </div>
          )}
        </div>
      </details>

      {/* Configure USDC payments */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
          Configure USDC payments
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>

        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4 space-y-4">

          {/* ── Contract doesn't have USDC functions yet ── */}
          {contractHasUsdc === false && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-4 space-y-3">
              <div className="flex items-start gap-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="mt-0.5 shrink-0 text-amber-400" aria-hidden>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <p className="font-headline text-sm font-bold text-amber-300">Contract needs redeployment</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                    The deployed contract doesn't have USDC functions yet. You need to redeploy
                    with the updated <code className="font-mono">ChainPassTicket.sol</code> first.
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-black/30 px-3 py-2.5 font-mono text-xs text-amber-200/70 space-y-1">
                <p className="text-amber-200/40 select-none"># in the contracts/ folder:</p>
                <p>forge script script/DeployChainPass.s.sol \</p>
                <p className="pl-4">--rpc-url $RPC_URL --broadcast</p>
              </div>
              <p className="text-xs text-amber-200/60">
                Then update <code className="font-mono">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in{" "}
                <code className="font-mono">client/.env</code> with the new address and restart.
              </p>
            </div>
          )}

          {/* ── Still checking if contract has USDC ── */}
          {contractHasUsdc === null && (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
              Checking contract…
            </div>
          )}

          {/* ── Contract supports USDC ── */}
          {contractHasUsdc === true && (
            <>
              {/* Current on-chain state */}
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-container-high px-4 py-3">
                <div>
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">Token on-chain</p>
                  <p className="mt-1 font-mono text-xs text-white truncate"
                    title={typeof currentUsdcToken === "string" ? currentUsdcToken : "—"}>
                    {typeof currentUsdcToken === "string" && currentUsdcToken !== "0x0000000000000000000000000000000000000000"
                      ? `${currentUsdcToken.slice(0, 10)}…${currentUsdcToken.slice(-6)}`
                      : <span className="text-on-surface-variant/50">not set</span>}
                  </p>
                </div>
                <div>
                  <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/60">Default price</p>
                  <p className="mt-1 font-mono text-xs text-white">
                    {typeof currentUsdcPrice === "bigint" && currentUsdcPrice > 0n
                      ? `$${formatUnits(currentUsdcPrice, 6)} USDC`
                      : <span className="text-on-surface-variant/50">not set</span>}
                  </p>
                </div>
              </div>

              {isAdmin !== true ? (
                <div className="flex items-center gap-2 rounded-xl bg-surface-container-high px-4 py-3">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-outline-variant border-t-primary" aria-hidden />
                  <p className="text-sm text-on-surface-variant">
                    Connect the admin wallet to configure USDC.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">

                  {/* ── Step 1: token address ── */}
                  <div className="space-y-2">
                    <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Step 1 — Set USDC token address
                    </p>
                    <p className="text-xs text-on-surface-variant/60">
                      Monad testnet USDC:{" "}
                      <button type="button"
                        className="font-mono text-primary/80 hover:text-primary underline underline-offset-2"
                        onClick={() => setUsdcTokenInput("0x534b2f3A21130d7a60830c2Df862319e593943A3")}>
                        0x534b2f…943A3
                      </button>
                      {" "}(click to fill)
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className={`${inputClass} flex-1 font-mono text-xs`}
                        placeholder="0x… USDC contract address"
                        value={usdcTokenInput}
                        onChange={(e) => { setUsdcTokenInput(e.target.value); resetSetToken() }}
                      />
                      <button
                        type="button"
                        disabled={setTokenPending || setTokenConfirming}
                        onClick={onSetUsdcToken}
                        className="shrink-0 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 font-headline text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {setTokenPending ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            Confirm…
                          </span>
                        ) : setTokenConfirming ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            Saving…
                          </span>
                        ) : setTokenSuccess ? "✓ Saved" : "Set"}
                      </button>
                    </div>
                    {setTokenError && (
                      <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className="mt-0.5 shrink-0 text-error" aria-hidden>
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p className="text-xs text-error break-words">{formatWriteContractError(setTokenError)}</p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-outline-variant/10" />

                  {/* ── Step 2: default price ── */}
                  <div className="space-y-2">
                    <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                      Step 2 — Set default USDC price
                    </p>
                    <p className="text-xs text-on-surface-variant/60">
                      Enter the amount in plain USDC (e.g. <code className="font-mono">0.10</code> for $0.10).
                      All routes without a per-route override will use this.
                    </p>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-on-surface-variant/60">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className={`${inputClass} pl-7`}
                          placeholder="0.10"
                          value={usdcPriceInput}
                          onChange={(e) => { setUsdcPriceInput(e.target.value); resetSetPrice() }}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={setPricePending || setPriceConfirming}
                        onClick={onSetUsdcPrice}
                        className="shrink-0 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2.5 font-headline text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {setPricePending ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            Confirm…
                          </span>
                        ) : setPriceConfirming ? (
                          <span className="flex items-center gap-1.5">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            Saving…
                          </span>
                        ) : setPriceSuccess ? "✓ Saved" : "Set"}
                      </button>
                    </div>
                    {setPriceError && (
                      <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          className="mt-0.5 shrink-0 text-error" aria-hidden>
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p className="text-xs text-error break-words">{formatWriteContractError(setPriceError)}</p>
                      </div>
                    )}
                  </div>

                  {usdcFormErr && (
                    <p className="rounded-xl bg-error/10 px-3 py-2 text-xs text-error">{usdcFormErr}</p>
                  )}

                  {(setTokenSuccess || setPriceSuccess) && (
                    <div className="flex items-center gap-2 rounded-xl bg-tertiary/8 px-4 py-2.5">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        className="shrink-0 text-tertiary" aria-hidden>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <p className="text-xs font-semibold text-tertiary">
                        Saved. Add <code className="font-mono">VITE_USDC_CONTRACT_ADDRESS</code> to{" "}
                        <code className="font-mono">client/.env</code> and restart <code className="font-mono">pnpm dev</code>.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </details>

      {/* Manage conductors / Burners */}
      <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
        <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
          Manage conductors / Burners
          <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
            Admin only
          </span>
        </summary>
        <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4 space-y-4">
          <p className="text-xs leading-relaxed text-on-surface-variant">
            Burners can validate and burn tickets at the gate. Grant this role to conductor wallets.
          </p>

          {isAdmin !== true ? (
            <p className="text-sm text-on-surface-variant">Connect an admin wallet to manage conductors.</p>
          ) : (
            <div className="space-y-3">
              {burnersLoading ? (
                <div className="space-y-2">
                  <div className="skeleton h-10 w-full rounded-xl" />
                </div>
              ) : burners.length === 0 ? (
                <p className="text-xs text-on-surface-variant/60">No conductors registered yet.</p>
              ) : (
                <ul className="space-y-2">
                  {burners.map((b) => (
                    <li key={b.address} className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-high px-3.5 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${b.active ? "bg-amber-400" : "bg-outline-variant/40"}`} />
                        <span className={`font-mono text-xs truncate ${b.active ? "text-on-surface-variant" : "text-on-surface-variant/40"}`}>
                          {b.address}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`font-headline text-[10px] font-bold uppercase ${b.active ? "text-amber-400" : "text-on-surface-variant/40"}`}>
                          {b.active ? "Active" : "Revoked"}
                        </span>
                        <button type="button"
                          disabled={burnerWritePending || burnerWriteConfirming}
                          onClick={() => b.active ? revokeBurner(b.address) : grantBurner(b.address)}
                          className={`rounded-lg px-2.5 py-1 font-headline text-[10px] font-bold transition-colors disabled:opacity-50 ${
                            b.active
                              ? "border border-error/30 text-error hover:bg-error/10"
                              : "border border-amber-400/30 text-amber-400 hover:bg-amber-400/10"
                          }`}>
                          {b.active ? "Revoke" : "Grant"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  className={`${inputClass} flex-1 font-mono text-xs`}
                  placeholder="0x… conductor wallet"
                  value={newBurner}
                  onChange={(e) => setNewBurner(e.target.value)}
                />
                <button type="button"
                  disabled={burnerWritePending || burnerWriteConfirming || !isAddress(newBurner.trim())}
                  onClick={() => grantBurner(newBurner.trim())}
                  className="shrink-0 rounded-xl bg-amber-500/80 px-4 py-2.5 font-headline text-xs font-bold text-white shadow-sm transition-all hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed">
                  {burnerWritePending ? "Confirm…" : burnerWriteConfirming ? "Saving…" : "Grant"}
                </button>
              </div>

              {burnerWriteError && (
                <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                  <p className="text-xs text-error break-words">{formatWriteContractError(burnerWriteError)}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </details>

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

      <GroupBookingPanel />
    </div>
  )
}
