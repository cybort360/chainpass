import { useEffect, useMemo, useRef, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useShareRoute } from "../hooks/useShareRoute"
import { Link, useNavigate, useParams } from "react-router-dom"
import { formatEther, formatUnits } from "viem"
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { chainPassTicketAbi, erc20Abi } from "@chainpass/shared"
import type { DemoRoute } from "../constants/demoRoutes"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { fetchRouteLabels, fetchRouteRating, fetchTrips, fetchRouteCapacity, claimSeat, linkTokenToTrip, reserveSeat, releaseSeat, routeHasClasses, routeHasSeats, type ApiTrip, type RouteCapacity, type RouteRating } from "../lib/api"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { trackEvent } from "../lib/analytics"
import { formatNgn, useExchangeRates } from "../lib/prices"
import { extractMintedTokenIdFromReceipt } from "../lib/tx"
import { formatWriteContractError } from "../lib/walletError"
import { SeatMapPicker } from "../components/SeatMapPicker"
import { SessionPicker } from "../components/SessionPicker"

type PayMethod = "mon" | "usdc"

const HOLD_DURATION_MS = 10 * 60 * 1000 // 10 minutes

function SeatHoldCountdown({ reservedAt, onExpired }: { reservedAt: number; onExpired: () => void }) {
  const [secsLeft, setSecsLeft] = useState(() => {
    const elapsed = Date.now() - reservedAt
    return Math.max(0, Math.floor((HOLD_DURATION_MS - elapsed) / 1000))
  })

  useEffect(() => {
    const id = window.setInterval(() => {
      const elapsed = Date.now() - reservedAt
      const remaining = Math.max(0, Math.floor((HOLD_DURATION_MS - elapsed) / 1000))
      setSecsLeft(remaining)
      if (remaining === 0) {
        window.clearInterval(id)
        onExpired()
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [reservedAt, onExpired])

  const mins = Math.floor(secsLeft / 60)
  const secs = secsLeft % 60
  const display = `${mins}:${String(secs).padStart(2, "0")}`
  const isUrgent = secsLeft <= 60

  return (
    <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${
      isUrgent ? "border-amber-400/40 bg-amber-400/10" : "border-outline-variant/20 bg-surface-container-high/60"
    }`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className={`shrink-0 ${isUrgent ? "text-amber-400" : "text-on-surface-variant/60"}`} aria-hidden>
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <p className={`font-headline text-xs ${isUrgent ? "text-amber-400" : "text-on-surface-variant"}`}>
        Seat held for{" "}
        <span className={`font-bold tabular-nums ${isUrgent ? "text-amber-400" : "text-white"}`}>{display}</span>
        {isUrgent ? " — complete payment now" : " — complete payment to confirm"}
      </p>
    </div>
  )
}

const USDC_DECIMALS = 6

function parseRouteIdParam(raw: string | undefined): bigint | undefined {
  if (!raw || !/^[0-9]+$/.test(raw)) return undefined
  try { return BigInt(raw) } catch { return undefined }
}

export function RoutePurchasePage() {
  const { routeId: routeIdParam } = useParams()
  const navigate = useNavigate()
  const { authenticated } = usePrivy()
  const { isConnected, address } = useAccount()

  const routeIdBig = useMemo(() => parseRouteIdParam(routeIdParam), [routeIdParam])
  const { shareRoute, shareState, shareUrl, clearShareUrl } = useShareRoute()

  const [apiLabels, setApiLabels] = useState<Awaited<ReturnType<typeof fetchRouteLabels>> | undefined>(undefined)
  useEffect(() => { void fetchRouteLabels().then(setApiLabels) }, [])

  const [routeRating, setRouteRating] = useState<RouteRating | null>(null)
  useEffect(() => {
    if (!routeIdParam) return
    void fetchRouteRating(routeIdParam).then(setRouteRating)
  }, [routeIdParam])

  const routeMeta = useMemo((): DemoRoute | undefined => {
    if (!routeIdParam) return undefined
    const demo = DEMO_ROUTES.find((r) => r.routeId === routeIdParam)
    if (demo) return demo
    if (!apiLabels) return undefined
    const row = apiLabels.find((r) => r.routeId === routeIdParam)
    if (!row) return undefined
    return { routeId: row.routeId, category: row.category || "General", name: row.name, detail: row.detail ?? "" }
  }, [routeIdParam, apiLabels])

  // Full route config (vehicle type + seat layout) from API labels
  const routeConfig = useMemo(() => {
    if (!routeIdParam || !apiLabels) return null
    return apiLabels.find((r) => r.routeId === routeIdParam) ?? null
  }, [routeIdParam, apiLabels])

  // ── Trip selection ────────────────────────────────────────────────────────
  const [availableTrips, setAvailableTrips] = useState<ApiTrip[]>([])
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null)

  useEffect(() => {
    if (!routeIdParam) return
    void fetchTrips(routeIdParam).then((trips) => {
      // Only show upcoming / boarding trips
      const now = Date.now()
      const relevant = trips.filter(
        (t) => t.status !== "cancelled" && t.status !== "arrived" &&
               new Date(t.arrivalAt).getTime() > now
      )
      setAvailableTrips(relevant)
      // Auto-select the soonest boarding or scheduled trip
      if (relevant.length > 0) setSelectedTripId(relevant[0].id)
    })
  }, [routeIdParam])

  // ── Capacity / sold-out ──────────────────────────────────────────────────
  const [routeCapacity, setRouteCapacity] = useState<RouteCapacity | null>(null)
  useEffect(() => {
    if (!routeIdParam) return
    void fetchRouteCapacity(routeIdParam).then(setRouteCapacity)
    // Refresh every 30 s so near-sold-out routes update without full reload
    const id = setInterval(() => {
      void fetchRouteCapacity(routeIdParam).then(setRouteCapacity)
    }, 30_000)
    return () => clearInterval(id)
  }, [routeIdParam])
  const isSoldOut = routeCapacity?.soldOut === true

  const hasClasses = routeHasClasses(routeConfig)   // only interstate trains
  const hasSeats   = routeHasSeats(routeConfig)     // trains (coaches) or buses (totalSeats)

  const metaLoading =
    routeIdParam !== undefined &&
    routeMeta === undefined &&
    apiLabels === undefined &&
    !DEMO_ROUTES.some((r) => r.routeId === routeIdParam)

  const contractAddress = getContractAddress()
  const usdcAddress = env.usdcAddress
  const usdcEnabled = Boolean(usdcAddress)

  const [payMethod, setPayMethod] = useState<PayMethod>("mon")
  const [seatClass, setSeatClass] = useState<0 | 1 | 2>(0) // 0=Economy, 1=Business, 2=First Class (trains only)
  const [quantity, setQuantity] = useState(1)

  // Which classes are available for this route?
  // New-style: from coachClasses array; legacy: all three for interstate trains
  const availableClasses: ("first" | "business" | "economy")[] = useMemo(() => {
    if (!hasClasses) return []
    if (routeConfig?.coachClasses && routeConfig.coachClasses.length > 0)
      return routeConfig.coachClasses.map((cc) => cc.class)
    return ["first", "business", "economy"]
  }, [hasClasses, routeConfig])

  // Map seatClass integer → class name for SeatMapPicker
  const selectedClassName = useMemo((): "first" | "business" | "economy" | null => {
    if (!hasClasses) return null
    return seatClass === 2 ? "first" : seatClass === 1 ? "business" : "economy"
  }, [hasClasses, seatClass])

  // When route loads, auto-select the first available class so the seat map is visible immediately
  useEffect(() => {
    if (availableClasses.length === 0) return
    const first = availableClasses[0]
    setSeatClass(first === "first" ? 2 : first === "business" ? 1 : 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConfig?.routeId])
  const [mintProgress, setMintProgress] = useState<{ done: number; total: number } | null>(null)
  const [mintedTokenIds, setMintedTokenIds] = useState<bigint[]>([])
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null)
  const [seatConflict, setSeatConflict] = useState(false)
  const [seatClaimFailed, setSeatClaimFailed] = useState(false)
  const [reservedAt, setReservedAt] = useState<number | null>(null) // ms timestamp when hold started
  // Mirrors selectedSeat for stale-closure reads
  const selectedSeatRef = useRef<string | null>(null)
  useEffect(() => { selectedSeatRef.current = selectedSeat }, [selectedSeat])
  // Persists the reserved seat for claiming after mint.
  // Deliberately NOT cleared when the SeatMapPicker auto-deselects due to polling
  // (the user's own reservation makes the seat appear in "occupied", which would
  // otherwise clear selectedSeat before the mint completes and lose the claim).
  const seatToClaimRef = useRef<string | null>(null)

  // Release the seat reservation when the user navigates away without completing payment.
  // Uses refs so the cleanup always sees the latest values regardless of when it runs.
  const releaseOnUnmountRef = useRef<{ routeId: string; seat: string } | null>(null)
  useEffect(() => {
    releaseOnUnmountRef.current = seatToClaimRef.current && routeIdParam
      ? { routeId: routeIdParam, seat: seatToClaimRef.current }
      : null
  })
  useEffect(() => {
    return () => {
      const target = releaseOnUnmountRef.current
      if (target) void releaseSeat(target.routeId, target.seat)
    }
  }, [])
  const publicClient = usePublicClient()

  // ── Exchange rates ──────────────────────────────────────────────────────────
  const { usdToNgn, ngnForMon, ngnForUsdc } = useExchangeRates()

  // ── MON pricing ────────────────────────────────────────────────────────────
  const { data: routePriceWei } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeMintPriceWei",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined },
  })
  const { data: mintPriceWei } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "mintPriceWei",
    query: { enabled: !!contractAddress },
  })
  const priceWei = useMemo(() => {
    const r = typeof routePriceWei === "bigint" ? routePriceWei : undefined
    const m = typeof mintPriceWei === "bigint" ? mintPriceWei : undefined
    if (r === undefined || m === undefined) return undefined
    return r > 0n ? r : m
  }, [routePriceWei, mintPriceWei])

  // ── Business MON price ────────────────────────────────────────────────────
  const { data: routeBusinessWei } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeBusinessPriceWei",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined },
  })
  const businessPriceWei = useMemo(() => {
    if (priceWei === undefined) return undefined
    const b = typeof routeBusinessWei === "bigint" ? routeBusinessWei : undefined
    return b !== undefined && b > 0n ? b : priceWei * 2n
  }, [priceWei, routeBusinessWei])

  // ── First Class MON price ─────────────────────────────────────────────────
  const { data: routeFirstClassWei } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeFirstClassPriceWei",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined },
  })
  const firstClassPriceWei = useMemo(() => {
    if (priceWei === undefined) return undefined
    const f = typeof routeFirstClassWei === "bigint" ? routeFirstClassWei : undefined
    return f !== undefined && f > 0n ? f : priceWei * 3n
  }, [priceWei, routeFirstClassWei])

  const effectivePriceWei = seatClass === 2 ? firstClassPriceWei : seatClass === 1 ? businessPriceWei : priceWei

  // ── USDC pricing ───────────────────────────────────────────────────────────
  const { data: onChainUsdcToken } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "usdcToken",
    query: { enabled: !!contractAddress && usdcEnabled },
  })
  const { data: routeUsdcRaw } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeMintPriceUsdc",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined && usdcEnabled },
  })
  const { data: mintUsdcRaw } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "mintPriceUsdc",
    query: { enabled: !!contractAddress && usdcEnabled },
  })
  const priceUsdc = useMemo(() => {
    const r = typeof routeUsdcRaw === "bigint" ? routeUsdcRaw : undefined
    const m = typeof mintUsdcRaw === "bigint" ? mintUsdcRaw : undefined
    if (r === undefined && m === undefined) return undefined
    const route = r ?? 0n
    const def   = m ?? 0n
    return route > 0n ? route : def
  }, [routeUsdcRaw, mintUsdcRaw])
  /** True only when both the USDC token address AND a non-zero price are set on-chain. */
  const usdcConfigured =
    priceUsdc !== undefined &&
    priceUsdc > 0n &&
    typeof onChainUsdcToken === "string" &&
    onChainUsdcToken !== "0x0000000000000000000000000000000000000000"

  // ── Business USDC price ───────────────────────────────────────────────────
  const { data: routeBusinessUsdc } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeBusinessPriceUsdc",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined && usdcEnabled },
  })
  const businessPriceUsdc = useMemo(() => {
    if (priceUsdc === undefined) return undefined
    const b = typeof routeBusinessUsdc === "bigint" ? routeBusinessUsdc : undefined
    return b !== undefined && b > 0n ? b : priceUsdc * 2n
  }, [priceUsdc, routeBusinessUsdc])

  // ── First Class USDC price ────────────────────────────────────────────────
  const { data: routeFirstClassUsdc } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeFirstClassPriceUsdc",
    args: [routeIdBig ?? 0n],
    query: { enabled: !!contractAddress && routeIdBig !== undefined && usdcEnabled },
  })
  const firstClassPriceUsdc = useMemo(() => {
    if (priceUsdc === undefined) return undefined
    const f = typeof routeFirstClassUsdc === "bigint" ? routeFirstClassUsdc : undefined
    return f !== undefined && f > 0n ? f : priceUsdc * 3n
  }, [priceUsdc, routeFirstClassUsdc])

  const effectivePriceUsdc = seatClass === 2 ? firstClassPriceUsdc : seatClass === 1 ? businessPriceUsdc : priceUsdc

  // ── USDC allowance ─────────────────────────────────────────────────────────
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [address ?? "0x0000000000000000000000000000000000000000", contractAddress ?? "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: Boolean(usdcEnabled && address && contractAddress && payMethod === "usdc"),
      refetchInterval: 6_000,
    },
  })
  const allowance = typeof allowanceRaw === "bigint" ? allowanceRaw : 0n
  const needsApproval = usdcConfigured && effectivePriceUsdc !== undefined && allowance < effectivePriceUsdc * BigInt(quantity)

  // ── MON purchase ───────────────────────────────────────────────────────────
  const {
    writeContractAsync: writeMonAsync,
    isPending: monPending, error: monError, reset: resetMon,
  } = useWriteContract()

  // ── USDC approve ───────────────────────────────────────────────────────────
  const {
    data: approvalHash, writeContract: writeApprove,
    isPending: approvePending, error: approveError, reset: resetApprove,
  } = useWriteContract()
  const { isLoading: approveConfirming, isSuccess: approveSuccess } =
    useWaitForTransactionReceipt({ hash: approvalHash })

  useEffect(() => {
    if (approveSuccess) void refetchAllowance()
  }, [approveSuccess, refetchAllowance])

  // ── USDC purchase ──────────────────────────────────────────────────────────
  const {
    data: usdcHash, writeContract: writeUsdcPurchase,
    isPending: usdcPending, error: usdcError, reset: resetUsdc,
  } = useWriteContract()
  const { data: usdcReceipt, isLoading: usdcConfirming, isSuccess: usdcSuccess } =
    useWaitForTransactionReceipt({ hash: usdcHash })

  // Navigate after multi-mint completes (MON path)
  useEffect(() => {
    if (mintedTokenIds.length === 0) return
    trackEvent("ticket_purchase", { method: "mon", route_id: routeIdParam ?? "", quantity: mintedTokenIds.length })
    if (mintedTokenIds.length === 1) {
      navigate(`/pass/${mintedTokenIds[0].toString()}`)
    } else {
      navigate("/profile")
    }
  }, [mintedTokenIds, navigate, routeIdParam])

  // Navigate on USDC mint success
  useEffect(() => {
    if (!usdcReceipt || !contractAddress || !usdcSuccess) return
    const tokenId = extractMintedTokenIdFromReceipt(usdcReceipt.logs, contractAddress)
    if (tokenId !== null) {
      trackEvent("ticket_purchase", { method: "usdc", route_id: routeIdParam ?? "" })
      // Use seatToClaimRef — never cleared by polling, unlike selectedSeatRef
      const seatToClaim = seatToClaimRef.current
      const doNavigate = async () => {
        if (seatToClaim && routeIdParam) {
          const claimed = await claimSeat(tokenId.toString(), routeIdParam, seatToClaim)
          if (!claimed) setSeatClaimFailed(true)
          seatToClaimRef.current = null
        }
        if (selectedTripId !== null && routeIdParam) {
          await linkTokenToTrip(tokenId.toString(), selectedTripId, routeIdParam)
        }
        navigate(`/pass/${tokenId.toString()}`)
      }
      void doNavigate()
    }
  }, [usdcReceipt, usdcSuccess, contractAddress, navigate, routeIdParam])

  // ── Computed display values ─────────────────────────────────────────────────
  const monDisplay = effectivePriceWei !== undefined ? formatEther(effectivePriceWei) : "—"
  const monNgn = effectivePriceWei !== undefined
    ? formatNgn(ngnForMon(Number(formatEther(effectivePriceWei))))
    : null

  const usdcDisplay = effectivePriceUsdc !== undefined && effectivePriceUsdc > 0n
    ? formatUnits(effectivePriceUsdc, USDC_DECIMALS)
    : null
  const usdcNgn = effectivePriceUsdc !== undefined && effectivePriceUsdc > 0n
    ? formatNgn(ngnForUsdc(Number(formatUnits(effectivePriceUsdc, USDC_DECIMALS))))
    : null

  // ── Seat selection handler — reserves/releases immediately on tap ──────────
  const onSeatSelect = async (seat: string | null) => {
    setSeatConflict(false)

    // Don't allow seat changes while a mint is in progress
    if (monPending || mintProgress !== null) return

    // Release the previously held seat when switching to a different one
    if (selectedSeat && selectedSeat !== seat && routeIdParam) {
      void releaseSeat(routeIdParam, selectedSeat)
    }

    setSelectedSeat(seat)

    if (seat && routeIdParam) {
      // Set claim ref BEFORE the async call so payment can always claim the seat,
      // even if the reservation request fails (server error / network blip).
      // claimSeat after mint is authoritative — the reservation is just a courtesy
      // hold that greys the seat out for others during checkout.
      seatToClaimRef.current = seat
      // Passing `address` lets the server indexer auto-promote this reservation
      // to a permanent assignment the moment the TicketMinted event lands on
      // chain — even if the client's explicit claimSeat() call never arrives.
      const result = await reserveSeat(routeIdParam, seat, address ?? undefined)
      if (!result.ok && result.conflict) {
        // Another passenger just grabbed it — deselect and warn
        setSelectedSeat(null)
        seatToClaimRef.current = null
        setReservedAt(null)
        setSeatConflict(true)
        setTimeout(() => setSeatConflict(false), 4000)
      } else if (result.ok) {
        setReservedAt(Date.now())
      }
      // Generic error (500 / network): seat stays selected, countdown doesn't
      // show, but claimSeat will still run after payment completes.
    } else {
      // User explicitly deselected (seat=null) — clear claim target
      seatToClaimRef.current = null
      setReservedAt(null)
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  const onPayMon = async () => {
    if (!address || effectivePriceWei === undefined || !contractAddress || !publicClient) return
    resetMon()
    setMintProgress({ done: 0, total: quantity })
    setMintedTokenIds([])
    try {
      const validUntil = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7)
      const hash = await writeMonAsync({
        address: contractAddress,
        abi: chainPassTicketAbi,
        functionName: quantity === 1 ? "purchaseTicket" : "batchPurchaseTicket",
        args: quantity === 1
          ? [routeIdBig!, validUntil, env.defaultOperator, seatClass]
          : [routeIdBig!, validUntil, env.defaultOperator, BigInt(quantity), seatClass],
        value: effectivePriceWei * BigInt(quantity),
      })
      setMintProgress({ done: 1, total: quantity })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      setMintProgress({ done: quantity, total: quantity })
      // Extract all minted token IDs from the batch receipt logs
      const ids: bigint[] = []
      for (const log of receipt.logs) {
        const id = extractMintedTokenIdFromReceipt([log], contractAddress)
        if (id !== null) ids.push(id)
      }
      if (ids.length > 0) {
        // Claim seat BEFORE navigating so it's permanently locked.
        // Use seatToClaimRef (not selectedSeatRef) because the SeatMapPicker
        // polling may have cleared selectedSeat after the user's own reservation
        // appeared in the occupied set.
        const seatToClaim = seatToClaimRef.current
        if (seatToClaim && ids.length === 1 && routeIdParam) {
          const claimed = await claimSeat(ids[0].toString(), routeIdParam, seatToClaim)
          if (!claimed) {
            console.warn("[seat-claim] claimSeat failed", { tokenId: ids[0].toString(), routeId: routeIdParam, seat: seatToClaim })
            setSeatClaimFailed(true)
          }
          seatToClaimRef.current = null
        } else if (seatToClaim && ids.length !== 1) {
          // Shouldn't happen for single purchase — surface it loudly if it does.
          console.warn("[seat-claim] skipped: unexpected mint id count", { ids: ids.map((i) => i.toString()), seat: seatToClaim })
        }
        if (selectedTripId !== null && ids.length === 1 && routeIdParam) {
          await linkTokenToTrip(ids[0].toString(), selectedTripId, routeIdParam)
        }
        setMintedTokenIds(ids)
      } else {
        // Mint succeeded (writeMonAsync didn't throw) but we couldn't parse the
        // token id from the receipt — rarely seen but leaves the seat unclaimed.
        // Surface it in the UI so the user knows their seat may not have been locked.
        console.warn("[seat-claim] no tokenId extracted from receipt", {
          logCount: receipt.logs.length,
          hasSeatToClaim: !!seatToClaimRef.current,
        })
        if (seatToClaimRef.current) setSeatClaimFailed(true)
        setMintedTokenIds([])
      }
    } finally {
      setMintProgress(null)
    }
  }

  const onApproveUsdc = () => {
    if (!usdcAddress || !contractAddress || effectivePriceUsdc === undefined) return
    resetApprove()
    writeApprove({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [contractAddress, effectivePriceUsdc * BigInt(quantity)],
    })
  }

  const onPayUsdc = () => {
    if (!contractAddress) return
    resetUsdc()
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 86400 * 7)
    writeUsdcPurchase({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: quantity === 1 ? "purchaseTicketWithUSDC" : "batchPurchaseTicketWithUSDC",
      args: quantity === 1
        ? [routeIdBig!, validUntil, env.defaultOperator, seatClass]
        : [routeIdBig!, validUntil, env.defaultOperator, BigInt(quantity), seatClass],
    })
  }

  // ── Early returns ──────────────────────────────────────────────────────────
  if (!contractAddress) {
    return (
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container p-8 text-center">
          <p className="font-headline text-sm font-semibold text-white">Contract not configured</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            Set <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in{" "}
            <code className="font-mono">client/.env</code>.
          </p>
          <Link to="/routes" className="mt-5 inline-block font-headline text-sm font-semibold text-primary hover:underline">
            ← Routes
          </Link>
        </div>
      </div>
    )
  }

  if (routeIdBig === undefined || (!metaLoading && !routeMeta)) {
    return (
      <div className="mx-auto max-w-md">
        <p className="text-on-surface-variant">Unknown route.</p>
        <Link to="/routes" className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline">
          ← All routes
        </Link>
      </div>
    )
  }

  if (metaLoading) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="skeleton h-6 w-1/3 rounded-lg" />
        <div className="skeleton h-10 w-2/3 rounded-lg" />
        <div className="skeleton h-48 w-full rounded-2xl" />
      </div>
    )
  }

  const monBusy = monPending || mintProgress !== null

  return (
    <div className="mx-auto max-w-md">
      {/* Back */}
      <Link to="/routes"
        className="inline-flex items-center gap-1.5 font-headline text-sm font-medium text-on-surface-variant hover:text-white transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Routes
      </Link>

      {/* Route heading */}
      <div className="mt-5">
        <span className="inline-block rounded-full bg-primary/15 px-3 py-1 font-headline text-[10px] font-bold uppercase tracking-widest text-primary">
          {routeMeta?.category}
        </span>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-headline text-3xl font-bold tracking-tight text-white leading-tight">
            {routeMeta?.name}
          </h1>
          {routeRating && routeRating.count > 0 && routeRating.average !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2.5 py-0.5 font-headline text-xs font-semibold text-amber-400">
              <span aria-hidden>★</span>
              {routeRating.average.toFixed(1)}
              <span className="font-normal text-amber-400/70">({routeRating.count})</span>
            </span>
          )}
        </div>
        {routeMeta?.detail && (
          <p className="mt-1.5 text-sm text-on-surface-variant">{routeMeta.detail}</p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void shareRoute(routeIdParam ?? "", routeMeta?.name ?? "")}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-outline-variant/25 bg-surface-container px-2.5 py-1 font-headline text-xs text-on-surface-variant transition-colors hover:border-primary/30 hover:text-primary"
          >
            {shareState === "copied" ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="20 6 9 17 4 12"/></svg>
                Link copied!
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
                Share route
              </>
            )}
          </button>
          {/* Fallback: manual copy input when clipboard is unavailable */}
          {shareState === "error" && shareUrl && (
            <div className="flex items-center gap-2 rounded-xl border border-outline-variant/25 bg-surface-container-high px-3 py-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-on-surface-variant outline-none"
              />
              <button type="button" onClick={clearShareUrl}
                className="shrink-0 text-on-surface-variant/50 hover:text-on-surface-variant">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Weekly schedule (Phase 1 — preview; trip selector below drives payment) */}
      {routeIdParam && routeConfig?.scheduleMode === "sessions" && (
        <div className="mt-5">
          <SessionPicker routeId={routeIdParam} />
        </div>
      )}

      {/* Trip selector */}
      {availableTrips.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
          <div className="border-b border-outline-variant/15 px-4 py-3">
            <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Select departure
            </p>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {availableTrips.map((trip) => {
              const dep = new Date(trip.departureAt)
              const arr = new Date(trip.arrivalAt)
              const isSelected = selectedTripId === trip.id
              const statusBadge: Record<string, string> = {
                boarding:  "border-tertiary/30 bg-tertiary/10 text-tertiary",
                scheduled: "border-outline-variant/20 bg-surface-container text-on-surface-variant",
                departed:  "border-primary/20 bg-primary/8 text-primary/70",
              }
              const badge = statusBadge[trip.status] ?? statusBadge.scheduled
              return (
                <button key={trip.id} type="button"
                  onClick={() => setSelectedTripId(trip.id)}
                  className={`flex w-full items-center gap-4 px-4 py-3 text-left transition-colors ${
                    isSelected ? "bg-primary/8" : "hover:bg-surface-container-high/50"
                  }`}>
                  {/* Radio dot */}
                  <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                    isSelected ? "border-primary bg-primary" : "border-outline-variant/40"
                  }`}>
                    {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-headline text-sm font-semibold text-white">
                      {dep.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      {" · "}
                      {dep.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      {" → "}
                      {arr.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="mt-0.5 text-xs text-on-surface-variant">
                      {Math.round((arr.getTime() - dep.getTime()) / 60000)} min journey
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest ${badge}`}>
                    {trip.status}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Purchase card */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-outline-variant/20 bg-surface-container shadow-lg">

        {/* Payment method toggle */}
        {usdcEnabled && (
          <div className="border-b border-outline-variant/15 p-3">
            <div className="flex gap-1 rounded-xl bg-surface-container-high p-1">
              {(["mon", "usdc"] as PayMethod[]).map((m) => (
                <button key={m} type="button"
                  onClick={() => setPayMethod(m)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 font-headline text-sm font-semibold transition-all ${
                    payMethod === m
                      ? "bg-surface-container text-white shadow-sm"
                      : "text-on-surface-variant hover:text-white"
                  }`}>
                  {m === "mon" ? (
                    <>
                      <span className="h-3 w-3 rounded-full bg-primary/70" aria-hidden />
                      MON
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs font-bold text-tertiary">$</span>
                      USDC
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Seat class selector — interstate trains only */}
        {hasClasses && availableClasses.length > 0 && (
          <div className="border-b border-outline-variant/15 px-4 py-3">
            <p className="mb-2 font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
              Seat class
            </p>
            <div className="flex gap-2">
              {availableClasses.includes("first") && (
                <button type="button"
                  onClick={() => { if (selectedSeat && routeIdParam) void releaseSeat(routeIdParam, selectedSeat); setSeatClass(2); setSelectedSeat(null) }}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl border py-2.5 font-headline text-xs font-semibold transition-all ${
                    seatClass === 2
                      ? "border-violet-400/40 bg-violet-400/10 text-violet-300"
                      : "border-outline-variant/20 text-on-surface-variant hover:text-white"
                  }`}>
                  <span aria-hidden>💎</span>
                  <span>First</span>
                </button>
              )}
              {availableClasses.includes("business") && (
                <button type="button"
                  onClick={() => { if (selectedSeat && routeIdParam) void releaseSeat(routeIdParam, selectedSeat); setSeatClass(1); setSelectedSeat(null) }}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl border py-2.5 font-headline text-xs font-semibold transition-all ${
                    seatClass === 1
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                      : "border-outline-variant/20 text-on-surface-variant hover:text-white"
                  }`}>
                  <span aria-hidden>✦</span>
                  <span>Business</span>
                </button>
              )}
              {availableClasses.includes("economy") && (
                <button type="button"
                  onClick={() => { if (selectedSeat && routeIdParam) void releaseSeat(routeIdParam, selectedSeat); setSeatClass(0); setSelectedSeat(null) }}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl border py-2.5 font-headline text-xs font-semibold transition-all ${
                    seatClass === 0
                      ? "border-primary/40 bg-primary/10 text-white"
                      : "border-outline-variant/20 text-on-surface-variant hover:text-white"
                  }`}>
                  <span aria-hidden>🪑</span>
                  <span>Economy</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Seat picker — trains and buses with seat config, single ticket */}
        {hasSeats && quantity === 1 && routeIdParam && (
          <div className="border-b border-outline-variant/15 px-4 py-4">
            {seatConflict && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="shrink-0 text-error" aria-hidden>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="font-headline text-xs font-semibold text-error">
                  That seat was just taken — please pick another.
                </p>
              </div>
            )}
            {seatClaimFailed && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="mt-0.5 shrink-0 text-amber-400" aria-hidden>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <p className="font-headline text-xs font-semibold text-amber-400">
                  Ticket purchased — but seat assignment failed to save. Please contact support with your token ID so your seat can be recorded manually.
                </p>
              </div>
            )}
            <SeatMapPicker
              routeId={routeIdParam}
              selectedSeat={selectedSeat}
              onSelect={(seat) => { void onSeatSelect(seat) }}
              vehicleType={routeConfig?.vehicleType}
              coachClasses={routeConfig?.coachClasses}
              selectedClass={selectedClassName}
              coaches={routeConfig?.coaches}
              seatsPerCoach={routeConfig?.seatsPerCoach}
              totalSeats={routeConfig?.totalSeats}
            />
            {selectedSeat && reservedAt !== null && (
              <SeatHoldCountdown reservedAt={reservedAt} onExpired={() => {
                setSelectedSeat(null)
                seatToClaimRef.current = null
                setReservedAt(null)
                setSeatConflict(true)
                setTimeout(() => setSeatConflict(false), 5000)
              }} />
            )}
          </div>
        )}

        {/* Price section */}
        <div className="bg-gradient-to-br from-primary/15 to-transparent p-6 pb-5">
          <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Ticket price
          </p>

          {payMethod === "mon" ? (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-headline text-4xl font-bold tracking-tight text-white">
                  {monDisplay}
                </span>
                <span className="font-headline text-lg font-semibold text-primary">MON</span>
              </div>
              {effectivePriceWei === 0n && (
                <p className="mt-1 font-headline text-xs font-semibold text-tertiary">Free (testnet)</p>
              )}
              {monNgn && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-on-surface-variant">
                  <span className="text-on-surface-variant/60">≈</span>
                  <span className="font-semibold text-on-surface-variant">{monNgn}</span>
                  <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/50">
                    testnet rate
                  </span>
                </p>
              )}
            </>
          ) : (
            <>
              {usdcConfigured && usdcDisplay ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-headline text-4xl font-bold tracking-tight text-white">
                      {usdcDisplay}
                    </span>
                    <span className="font-headline text-lg font-semibold text-tertiary">USDC</span>
                  </div>
                  {usdcNgn && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-on-surface-variant">
                      <span className="text-on-surface-variant/60">≈</span>
                      <span className="font-semibold text-on-surface-variant">{usdcNgn}</span>
                      <span className="text-on-surface-variant/50">NGN</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-sm text-on-surface-variant">
                  USDC price not configured for this route.
                </p>
              )}
            </>
          )}
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-px bg-outline-variant/10 border-t border-outline-variant/15">
          <div className="bg-surface-container px-5 py-3.5">
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
              Ticket type
            </p>
            <p className="mt-1 font-headline text-sm font-semibold text-white">Soulbound NFT</p>
          </div>
          <div className="bg-surface-container px-5 py-3.5">
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
              Valid for
            </p>
            <p className="mt-1 font-headline text-sm font-semibold text-white">7 days</p>
          </div>
        </div>

        {/* Quantity picker */}
        <div className="flex items-center justify-between border-t border-outline-variant/15 px-5 py-4">
          <div>
            <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
              Quantity
            </p>
            <p className="mt-0.5 text-xs text-on-surface-variant/60">Max 5 per purchase</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={quantity <= 1}
              onClick={() => { if (selectedSeat && routeIdParam) void releaseSeat(routeIdParam, selectedSeat); setQuantity((q) => Math.max(1, q - 1)); setSelectedSeat(null); seatToClaimRef.current = null; setReservedAt(null) }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high font-bold text-white disabled:opacity-30 hover:border-primary/40 transition-colors"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-6 text-center font-headline text-lg font-bold text-white tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              disabled={quantity >= 5}
              onClick={() => { if (selectedSeat && routeIdParam) void releaseSeat(routeIdParam, selectedSeat); setQuantity((q) => Math.min(5, q + 1)); setSelectedSeat(null); seatToClaimRef.current = null; setReservedAt(null) }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-outline-variant/30 bg-surface-container-high font-bold text-white disabled:opacity-30 hover:border-primary/40 transition-colors"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>

        {/* Soulbound notice */}
        <div className="flex items-start gap-3 border-t border-outline-variant/10 bg-surface-container-low/40 px-5 py-3.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="mt-0.5 shrink-0 text-on-surface-variant" aria-hidden>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-xs leading-relaxed text-on-surface-variant">
            Non-transferable. Single-use — burned at the gate after scanning.
          </p>
        </div>

        {/* Capacity bar */}
        {routeCapacity && routeCapacity.capacity !== null && (
          <div className="border-t border-outline-variant/10 px-5 py-3.5">
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
                Availability
              </p>
              <p className={`font-headline text-[10px] font-bold ${isSoldOut ? "text-error" : "text-on-surface-variant"}`}>
                {isSoldOut
                  ? "SOLD OUT"
                  : `${routeCapacity.available} of ${routeCapacity.capacity} seats left`}
              </p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div
                className={`h-full rounded-full transition-all ${isSoldOut ? "bg-error" : "bg-primary"}`}
                style={{ width: `${Math.min(100, ((routeCapacity.sold + routeCapacity.reserved) / routeCapacity.capacity) * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}

        {/* CTA section */}
        <div className="border-t border-outline-variant/15 px-5 py-5 space-y-3">
          {isSoldOut ? (
            <div className="overflow-hidden rounded-2xl border border-error/30 bg-error/8">
              <div className="flex items-center gap-3 px-5 py-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error/15">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error" aria-hidden>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                  </svg>
                </div>
                <div>
                  <p className="font-headline text-sm font-bold text-error">Sold out</p>
                  <p className="mt-0.5 text-xs text-on-surface-variant">All seats are taken for this route. Check other routes or try again later.</p>
                </div>
              </div>
            </div>
          ) : !authenticated ? (
            <div className="rounded-xl bg-surface-container-high px-4 py-3 text-center">
              <p className="font-headline text-sm font-semibold text-on-surface-variant">
                Connect your wallet to purchase
              </p>
            </div>
          ) : !isConnected ? (
            <div className="rounded-xl bg-surface-container-high px-4 py-3 text-center">
              <p className="text-sm text-on-surface-variant">Finishing wallet connection…</p>
            </div>
          ) : payMethod === "mon" ? (
            /* ── MON payment button ── */
            <button
              type="button"
              disabled={effectivePriceWei === undefined || monBusy}
              onClick={() => void onPayMon()}
              className={`relative w-full overflow-hidden rounded-2xl px-6 py-4 font-headline text-base font-bold text-white transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                monBusy ? "bg-primary/60" : "btn-primary-gradient hover:brightness-110 hover:shadow-[0_0_28px_rgba(110,84,255,0.4)]"
              }`}
            >
              {mintProgress ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Minting {mintProgress.done + 1} of {mintProgress.total}…
                  <div
                    className="absolute bottom-0 left-0 h-1 bg-white/30 transition-all"
                    style={{ width: `${(mintProgress.done / mintProgress.total) * 100}%` }}
                  />
                </span>
              ) : monPending ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Confirm in wallet…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9z" />
                    <line x1="9" y1="7" x2="9" y2="17" strokeDasharray="2 2" />
                  </svg>
                  Pay {quantity > 1 ? `${quantity} tickets` : ""} with MON
                </span>
              )}
            </button>
          ) : (
            /* ── USDC payment flow ── */
            <>
              {!usdcConfigured ? (
                <div className="rounded-xl bg-surface-container-high px-4 py-3 text-center">
                  <p className="text-sm text-on-surface-variant">
                    USDC not configured for this route. Switch to MON.
                  </p>
                </div>
              ) : needsApproval ? (
                /* Step 1: approve */
                <>
                  {/* Step indicator */}
                  <div className="flex items-center gap-2 rounded-xl bg-primary/8 px-4 py-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 font-headline text-[10px] font-bold text-primary">1</span>
                    <p className="text-xs text-on-surface-variant">
                      Allow ChainPass to spend{" "}
                      <span className="font-semibold text-white">{usdcDisplay} USDC</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={approvePending || approveConfirming}
                    onClick={onApproveUsdc}
                    className="w-full rounded-2xl bg-tertiary/80 px-6 py-4 font-headline text-base font-bold text-white transition-all hover:bg-tertiary hover:shadow-[0_0_28px_rgba(0,220,180,0.3)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {approvePending || approveConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        {approvePending ? "Confirm in wallet…" : "Confirming approval…"}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        Approve USDC
                      </span>
                    )}
                  </button>
                  {approveError && (
                    <p className="rounded-xl bg-error/10 px-4 py-2.5 text-xs text-error">
                      {formatWriteContractError(approveError)}
                    </p>
                  )}
                </>
              ) : (
                /* Step 2: pay */
                <>
                  {/* Approved badge */}
                  <div className="flex items-center gap-2 rounded-xl bg-tertiary/8 px-4 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="shrink-0 text-tertiary" aria-hidden>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <p className="text-xs text-tertiary font-semibold">USDC approved — ready to pay</p>
                  </div>
                  <button
                    type="button"
                    disabled={usdcPending || usdcConfirming}
                    onClick={onPayUsdc}
                    className={`w-full rounded-2xl px-6 py-4 font-headline text-base font-bold text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                      usdcPending || usdcConfirming
                        ? "bg-tertiary/60"
                        : "bg-tertiary hover:brightness-110 hover:shadow-[0_0_28px_rgba(0,220,180,0.35)]"
                    }`}
                  >
                    {usdcPending || usdcConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Confirm in wallet…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <span className="font-mono font-bold">$</span>
                        Pay {usdcDisplay} USDC
                      </span>
                    )}
                  </button>
                  {usdcError && (
                    <p className="rounded-xl bg-error/10 px-4 py-2.5 text-xs text-error">
                      {formatWriteContractError(usdcError)}
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {/* MON write error */}
          {payMethod === "mon" && monError && (
            <p className="rounded-xl bg-error/10 px-4 py-2.5 text-xs text-error">
              {formatWriteContractError(monError)}
            </p>
          )}

          {/* NGN rate note */}
          {usdToNgn && (
            <p className="text-center text-[10px] text-on-surface-variant/40">
              1 USD ≈ {usdToNgn.toLocaleString(undefined, { maximumFractionDigits: 0 })} NGN · live rate
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
