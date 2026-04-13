import { useEffect, useMemo, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { Link, useNavigate, useParams } from "react-router-dom"
import { formatEther, formatUnits } from "viem"
import { useAccount, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { chainPassTicketAbi, erc20Abi } from "@chainpass/shared"
import type { DemoRoute } from "../constants/demoRoutes"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { fetchRouteLabels, fetchRouteRating, type RouteRating } from "../lib/api"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { trackEvent } from "../lib/analytics"
import { formatNgn, useExchangeRates } from "../lib/prices"
import { extractMintedTokenIdFromReceipt } from "../lib/tx"
import { formatWriteContractError } from "../lib/walletError"

type PayMethod = "mon" | "usdc"

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

  const metaLoading =
    routeIdParam !== undefined &&
    routeMeta === undefined &&
    apiLabels === undefined &&
    !DEMO_ROUTES.some((r) => r.routeId === routeIdParam)

  const contractAddress = getContractAddress()
  const usdcAddress = env.usdcAddress
  const usdcEnabled = Boolean(usdcAddress)

  const [payMethod, setPayMethod] = useState<PayMethod>("mon")
  const [seatClass, setSeatClass] = useState<0 | 1>(0) // 0=Economy, 1=Business
  const [quantity, setQuantity] = useState(1)
  const [mintProgress, setMintProgress] = useState<{ done: number; total: number } | null>(null)
  const [mintedTokenIds, setMintedTokenIds] = useState<bigint[]>([])
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
  const effectivePriceWei = seatClass === 1 ? businessPriceWei : priceWei

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
  const effectivePriceUsdc = seatClass === 1 ? businessPriceUsdc : priceUsdc

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
      navigate(`/pass/${tokenId.toString()}`)
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
      setMintedTokenIds(ids.length > 0 ? ids : [])
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
      </div>

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

        {/* Seat class selector */}
        <div className="border-b border-outline-variant/15 px-4 py-3">
          <p className="mb-2 font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
            Seat class
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setSeatClass(0)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 font-headline text-sm font-semibold transition-all ${
                seatClass === 0
                  ? "border-primary/40 bg-primary/10 text-white"
                  : "border-outline-variant/20 text-on-surface-variant hover:text-white"
              }`}>
              Economy
            </button>
            <button type="button" onClick={() => setSeatClass(1)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 font-headline text-sm font-semibold transition-all ${
                seatClass === 1
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  : "border-outline-variant/20 text-on-surface-variant hover:text-white"
              }`}>
              <span className={seatClass === 1 ? "text-amber-300" : "text-on-surface-variant/50"} aria-hidden>✦</span>
              Business
            </button>
          </div>
        </div>

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
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
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
              onClick={() => setQuantity((q) => Math.min(5, q + 1))}
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

        {/* CTA section */}
        <div className="border-t border-outline-variant/15 px-5 py-5 space-y-3">
          {!authenticated ? (
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
