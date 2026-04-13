import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"

// Haptic feedback helper (no-op on unsupported browsers/iOS)
function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern) } catch { /* ignore */ }
}

// Keep screen awake while scanning
function useWakeLock(active: boolean) {
  const lock = useRef<WakeLockSentinel | null>(null)
  useEffect(() => {
    if (!active) {
      lock.current?.release().catch(() => {})
      lock.current = null
      return
    }
    if (!("wakeLock" in navigator)) return
    navigator.wakeLock.request("screen").then((l) => { lock.current = l }).catch(() => {})
    return () => {
      lock.current?.release().catch(() => {})
      lock.current = null
    }
  }, [active])
}
import { Link } from "react-router-dom"
import { formatUnits, isAddress, parseEther, parseUnits } from "viem"
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { chainPassTicketAbi, monadTestnet, newRouteIdDecimalFromUuid } from "@chainpass/shared"
import { getContractAddress } from "../lib/contract"
import { env } from "../lib/env"
import { registerRouteLabel, verifyQrPayload, type QrPayload } from "../lib/api"
import { formatWriteContractError } from "../lib/walletError"

/** Safari on iPhone/iPad: different camera + decoder behavior than Chrome/Android. */
function isIosLike(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  if (/iPhone|iPod|iPad/i.test(ua)) return true
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1
}

/** Normalize scanned text: trim, strip BOM, take outer `{...}` (iOS / scanners sometimes add noise). */
function extractJsonObject(raw: string): string {
  let s = raw.trim().replace(/^\uFEFF/, "")
  const i0 = s.indexOf("{")
  const i1 = s.lastIndexOf("}")
  if (i0 >= 0 && i1 > i0) s = s.slice(i0, i1 + 1)
  return s
}

function parsePayload(raw: string): QrPayload | null {
  try {
    const j = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>
    const tokenId = j.tokenId
    const holder = j.holder
    const exp = j.exp
    const signature = j.signature
    /** Decimal string only — BigInt() throws on scientific notation (e.g. 1e20), which whitescreens the app. */
    let tokenIdStr: string
    if (typeof tokenId === "string") {
      tokenIdStr = tokenId.trim()
    } else if (typeof tokenId === "number") {
      if (!Number.isInteger(tokenId) || tokenId < 0) return null
      tokenIdStr = String(tokenId)
    } else {
      return null
    }
    if (!/^\d+$/.test(tokenIdStr)) return null
    if (typeof holder !== "string" || !isAddress(holder)) return null
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null
    if (typeof signature !== "string") return null
    return {
      tokenId: tokenIdStr,
      holder: holder as `0x${string}`,
      exp,
      signature,
    }
  } catch {
    return null
  }
}

function tokenIdToBigInt(tokenId: string): bigint | undefined {
  const t = tokenId.trim()
  if (!/^\d+$/.test(t)) return undefined
  try {
    return BigInt(t)
  } catch {
    return undefined
  }
}

type ConductorErrorBoundaryState = { err: Error | null }

class ConductorErrorBoundary extends Component<{ children: ReactNode }, ConductorErrorBoundaryState> {
  state: ConductorErrorBoundaryState = { err: null }

  static getDerivedStateFromError(err: Error): ConductorErrorBoundaryState {
    return { err }
  }

  render() {
    if (this.state.err) {
      return (
        <div className="mx-auto max-w-2xl rounded-2xl border border-error/30 bg-error/8 p-6">
          <p className="font-headline font-semibold text-white">Something went wrong after the scan</p>
          <p className="mt-2 break-words font-mono text-xs text-error">{this.state.err.message}</p>
          <button
            type="button"
            className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2 font-headline text-sm font-semibold text-on-surface hover:bg-surface-container-high transition-colors"
            onClick={() => this.setState({ err: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function ConductorPage() {
  const contractAddress = getContractAddress()
  const { address, isConnected } = useAccount()
  const [rawInput, setRawInput] = useState("")
  const [parsed, setParsed] = useState<QrPayload | null>(null)
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraErr, setCameraErr] = useState<string | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const regionId = "conductor-qr-reader"
  const fileRegionId = "conductor-qr-file-reader"
  /** After a successful scan we `stop()` the library before unmounting the video DOM (WebView-safe). */
  const scanStoppedRef = useRef(false)

  const tokenIdBig = useMemo(() => (parsed ? tokenIdToBigInt(parsed.tokenId) : undefined), [parsed])

  const { data: burnerRole, isFetching: burnerRoleHashLoading } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "BURNER_ROLE",
    query: { enabled: !!contractAddress },
  })

  const {
    data: isBurner,
    isFetching: hasBurnerRoleFetching,
  } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "hasRole",
    args: burnerRole && address ? [burnerRole, address] : undefined,
    query: { enabled: !!contractAddress && !!burnerRole && !!address },
  })

  const checkingBurnerAccess =
    !!contractAddress &&
    !!address &&
    (burnerRoleHashLoading || burnerRole === undefined || hasBurnerRoleFetching)

  const { data: adminRole, isFetching: adminRoleLoading } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "DEFAULT_ADMIN_ROLE",
    query: { enabled: !!contractAddress },
  })

  const { data: isAdmin, isFetching: hasAdminFetching } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "hasRole",
    args: adminRole && address ? [adminRole, address] : undefined,
    query: { enabled: !!contractAddress && !!adminRole && !!address },
  })

  const checkingAdminAccess =
    !!contractAddress &&
    !!address &&
    (adminRoleLoading || adminRole === undefined || hasAdminFetching)

  const checkingAccess = checkingBurnerAccess || checkingAdminAccess

  const { data: chainOwner } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "ownerOf",
    args: tokenIdBig !== undefined ? [tokenIdBig] : undefined,
    query: { enabled: !!contractAddress && tokenIdBig !== undefined },
  })

  const { data: chainRoute } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "routeOf",
    args: tokenIdBig !== undefined ? [tokenIdBig] : undefined,
    query: { enabled: !!contractAddress && tokenIdBig !== undefined },
  })

  const { data: validUntil } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "validUntil",
    args: tokenIdBig !== undefined ? [tokenIdBig] : undefined,
    query: { enabled: !!contractAddress && tokenIdBig !== undefined },
  })

  const applyDecoded = useCallback((text: string) => {
    setRawInput(text)
    const p = parsePayload(text)
    if (!p) {
      setParsed(null)
      setParseErr("Could not parse QR JSON (need tokenId, holder, exp, signature).")
      return
    }
    setParsed(p)
    setParseErr(null)
  }, [])

  useEffect(() => {
    if (!cameraOn) return
    scanStoppedRef.current = false
    setCameraErr(null)
    const ios = isIosLike()
    const h = new Html5Qrcode(regionId, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      // iOS Safari: native BarcodeDetector often outperforms ZXing for live camera; Android keeps ZXing.
      experimentalFeatures: { useBarCodeDetectorIfSupported: ios },
    })
    scannerRef.current = h
    let cancelled = false

    async function startScanner() {
      /**
       * iOS: omit qrbox so the library uses the full viewfinder (see html5-qrcode.js: qrbox undefined → full size).
       * Cropped qr regions are a common cause of “works on Android, not iPhone”.
       */
      const config = ios
        ? {
            fps: 8,
            aspectRatio: 1.777777778,
            disableFlip: false,
          }
        : {
            fps: 12,
            qrbox: (vw: number, vh: number) => {
              const edge = Math.floor(Math.min(vw, vh) * 0.92)
              return { width: edge, height: edge }
            },
            aspectRatio: 1.0,
            disableFlip: false,
          }

      const tryStart = async (cameraIdOrConfig: string | MediaTrackConstraints) => {
        await h.start(
          cameraIdOrConfig,
          config,
          (decoded) => {
            void (async () => {
              try {
                applyDecoded(decoded)
              } catch {
                setParseErr("Could not apply scan result.")
              }
              try {
                await h.stop()
                h.clear()
              } catch {
                /* ignore double-stop / WebView quirks */
              }
              scanStoppedRef.current = true
              setCameraOn(false)
            })()
          },
          () => {},
        )
      }

      try {
        const devices = await Html5Qrcode.getCameras()
        if (cancelled) return

        const back = devices.find((d) => /back|rear|environment|wide/i.test(d.label))
        const chosen = back ?? devices[0]

        if (chosen) {
          try {
            await tryStart(chosen.id)
            return
          } catch {
            /* fall through to constraint-based starts */
          }
        }

        try {
          await tryStart({ facingMode: { ideal: "environment" } })
          return
        } catch {
          /* continue */
        }
        try {
          await tryStart({ facingMode: { ideal: "user" } })
          return
        } catch {
          /* continue */
        }
        await tryStart({ facingMode: "environment" })
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e)
          setCameraErr(msg)
          setCameraOn(false)
        }
      }
    }

    void startScanner()

    return () => {
      cancelled = true
      if (scanStoppedRef.current) {
        scanStoppedRef.current = false
        scannerRef.current = null
        return
      }
      void h
        .stop()
        .catch(() => {})
        .finally(() => {
          try {
            h.clear()
          } catch {
            /* */
          }
        })
      scannerRef.current = null
    }
  }, [cameraOn, applyDecoded])

  const onQrImageChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ""
      if (!file) return
      setParseErr(null)
      setCameraErr(null)
      const ios = isIosLike()
      const h = new Html5Qrcode(fileRegionId, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: ios },
      })
      try {
        const text = await h.scanFile(file, false)
        applyDecoded(text)
      } catch {
        setParseErr("No QR found in that image. Try a sharp photo of the full code, or paste the JSON.")
      } finally {
        h.clear()
      }
    },
    [applyDecoded],
  )

  const {
    data: burnHash,
    writeContract: writeBurn,
    isPending: burnPending,
    error: burnError,
    reset: resetBurn,
  } = useWriteContract()
  const { isLoading: burnConfirming, isSuccess: burnSuccess } = useWaitForTransactionReceipt({ hash: burnHash })

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

  const [regCategory, setRegCategory] = useState("")
  const [regName, setRegName] = useState("")
  const [regDetail, setRegDetail] = useState("")
  const [regPriceMon, setRegPriceMon] = useState("")
  const [regFormErr, setRegFormErr] = useState<string | null>(null)
  const [regLabelMsg, setRegLabelMsg] = useState<string | null>(null)

  // ── MON price config ───────────────────────────────────────────────────────
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

  // ── USDC config ────────────────────────────────────────────────────────────
  // If this errors, the deployed contract doesn't have USDC functions yet (needs redeploy).
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
  // true = USDC functions confirmed on-chain; false = old contract; null = still loading
  const contractHasUsdc: boolean | null =
    usdcTokenReadErr != null ? false :
    currentUsdcToken !== undefined ? true : null

  const [usdcTokenInput, setUsdcTokenInput] = useState("")
  const [usdcPriceInput, setUsdcPriceInput] = useState("")
  const [usdcFormErr, setUsdcFormErr] = useState<string | null>(null)

  // Seed inputs from env on first render
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

  // ── Operator whitelist ────────────────────────────────────────────────────
  const [operatorInput, setOperatorInput] = useState("")
  const [operatorFormErr, setOperatorFormErr] = useState<string | null>(null)

  const operatorInputTrimmed = operatorInput.trim()
  const operatorInputValid = isAddress(operatorInputTrimmed)

  const { data: isOperatorApproved, refetch: refetchOperatorApproved } = useReadContract({
    address: contractAddress ?? undefined,
    abi: chainPassTicketAbi,
    functionName: "approvedOperators",
    args: operatorInputValid ? [operatorInputTrimmed as `0x${string}`] : undefined,
    query: { enabled: !!contractAddress && operatorInputValid },
  })

  const {
    data: setOperatorHash, writeContract: writeSetOperator,
    isPending: setOperatorPending, error: setOperatorError, reset: resetSetOperator,
  } = useWriteContract()
  const { isLoading: setOperatorConfirming, isSuccess: setOperatorSuccess } =
    useWaitForTransactionReceipt({ hash: setOperatorHash })

  useEffect(() => { if (setOperatorSuccess) void refetchOperatorApproved() },
    [setOperatorSuccess, refetchOperatorApproved])

  const onSetOperator = useCallback((approve: boolean) => {
    if (!contractAddress) return
    setOperatorFormErr(null)
    resetSetOperator()
    if (!operatorInputValid) {
      setOperatorFormErr("Enter a valid 0x address.")
      return
    }
    writeSetOperator({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "setOperatorApproved",
      args: [operatorInputTrimmed as `0x${string}`, approve],
    })
  }, [contractAddress, operatorInputValid, operatorInputTrimmed, resetSetOperator, writeSetOperator])

  const ownerStr = chainOwner && typeof chainOwner === "string" ? chainOwner : undefined
  const holderMatches = ownerStr && parsed && ownerStr.toLowerCase() === parsed.holder.toLowerCase()
  const notExpired =
    validUntil !== undefined && BigInt(Math.floor(Date.now() / 1000)) <= BigInt(validUntil as bigint)

  const onBurn = async () => {
    if (!contractAddress || !parsed || chainRoute === undefined) return
    const tid = tokenIdToBigInt(parsed.tokenId)
    if (tid === undefined) return
    resetBurn()
    writeBurn({
      address: contractAddress,
      abi: chainPassTicketAbi,
      functionName: "burnTicket",
      args: [tid, chainRoute, parsed.holder],
    })
  }

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
  }, [contractAddress, isAdmin, regName, regCategory, regPriceMon, resetRoutePrice, writeSetRoutePrice])

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
    const monNum = Number(regPriceMon.trim())
    const priceMon = Number.isFinite(monNum) && monNum >= 0 ? monNum : undefined
    void registerRouteLabel({
      routeId: rid,
      name,
      category,
      detail: detail || null,
      priceMon,
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
  }, [routePriceSuccess, routePriceHash, regName, regCategory, regDetail, regPriceMon])

  const [apiVerify, setApiVerify] = useState<boolean | null>(null)
  useEffect(() => {
    if (!parsed) {
      setApiVerify(null)
      return
    }
    void verifyQrPayload(parsed)
      .then(setApiVerify)
      .catch(() => setApiVerify(null))
  }, [parsed])

  // Keep screen awake while camera is on
  useWakeLock(cameraOn)

  // Haptic feedback when verification result is determined
  const checksLoaded = apiVerify !== null && chainOwner !== undefined && validUntil !== undefined && chainRoute !== undefined
  const isTicketValid = checksLoaded && holderMatches === true && notExpired === true
  const prevChecksLoaded = useRef(false)
  useEffect(() => {
    if (checksLoaded && !prevChecksLoaded.current) {
      vibrate(isTicketValid ? [80, 40, 80] : [50, 30, 50, 30, 200])
    }
    prevChecksLoaded.current = checksLoaded
  }, [checksLoaded, isTicketValid])

  // Fullscreen valid overlay state
  const [showValidOverlay, setShowValidOverlay] = useState(false)
  useEffect(() => {
    if (isTicketValid && parsed && !burnSuccess) setShowValidOverlay(true)
    else setShowValidOverlay(false)
  }, [isTicketValid, parsed, burnSuccess])

  // Route name for valid overlay (best-effort from chain)
  const validRouteId = chainRoute !== undefined ? String(chainRoute) : undefined

  if (!contractAddress) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container p-8 text-center text-sm text-on-surface-variant">
        Set <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in env.
      </div>
    )
  }

  const pageHeader = (
    <div className="mb-6">
      <p className="font-headline text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Conductor</p>
      <h1 className="mt-1.5 font-headline text-3xl font-bold text-white">Gate</h1>
    </div>
  )

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-lg">
        {pageHeader}
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h2v2h-2zM18 14h3M14 18h3M20 18v3M17 21h3" />
            </svg>
          </div>
          <p className="font-headline font-semibold text-white">Connect your wallet</p>
          <p className="mt-1.5 text-sm text-on-surface-variant">
            Connect the wallet with{" "}
            <code className="font-mono text-xs text-tertiary">BURNER_ROLE</code> to scan and burn tickets.
          </p>
        </div>
      </div>
    )
  }

  if (checkingAccess) {
    return (
      <div className="mx-auto max-w-lg">
        {pageHeader}
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
          Checking wallet roles…
        </div>
      </div>
    )
  }

  const showGateScanner = isBurner === true

  /* ── Input field style shared between form fields ── */
  const inputClass =
    "mt-1.5 w-full rounded-xl border border-outline-variant/25 bg-surface-container-high px-3.5 py-2.5 text-sm text-white placeholder:text-on-surface-variant/50 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"

  return (
    <ConductorErrorBoundary>
      {/* Fullscreen VALID overlay — shown after scan resolves and ticket is valid */}
      {showValidOverlay && parsed && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a1a0f] px-6">
          {/* Giant check mark */}
          <div className="relative mb-8 flex h-40 w-40 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping" style={{ animationDuration: "2s" }} />
            <div className="absolute inset-2 rounded-full bg-emerald-500/15" />
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/40 to-emerald-500/10 shadow-[0_0_64px_rgba(16,185,129,0.35)]">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-emerald-400" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>

          <p className="font-headline text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-500/70">Ticket valid</p>
          <h1 className="mt-2 font-headline text-6xl font-black tracking-tight text-emerald-400">VALID</h1>

          {validRouteId && (
            <p className="mt-3 font-headline text-lg font-semibold text-white/80">
              Route {validRouteId.slice(0, 8)}…
            </p>
          )}
          <p className="mt-1 font-mono text-sm text-white/40">
            #{parsed.tokenId.slice(0, 8)}… · {parsed.holder.slice(0, 6)}…{parsed.holder.slice(-4)}
          </p>

          {/* Burn button */}
          <button
            type="button"
            disabled={burnPending || burnConfirming}
            onClick={() => { setShowValidOverlay(false); void onBurn() }}
            className="mt-12 w-full max-w-xs rounded-2xl bg-emerald-500 px-8 py-5 font-headline text-xl font-black text-white shadow-[0_0_32px_rgba(16,185,129,0.4)] transition-all hover:bg-emerald-400 active:scale-[0.97] disabled:opacity-60"
          >
            {burnPending || burnConfirming ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                {burnPending ? "Confirm…" : "Burning…"}
              </span>
            ) : "Board — Scan ticket"}
          </button>

          <button
            type="button"
            onClick={() => { setShowValidOverlay(false); setParsed(null); setRawInput(""); setParseErr(null) }}
            className="mt-4 font-headline text-sm font-semibold text-white/40 hover:text-white/80 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* scanFile() mount target */}
      <div id={fileRegionId}
        className="pointer-events-none fixed top-0 left-[-9999px] h-px w-px overflow-hidden opacity-0" aria-hidden />

      <div className="mx-auto max-w-2xl">
        {pageHeader}

        {/* Role badge */}
        <div className={`mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-headline text-xs font-semibold ${
          showGateScanner
            ? "border-tertiary/30 bg-tertiary/8 text-tertiary"
            : "border-error/30 bg-error/8 text-error"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${showGateScanner ? "bg-tertiary" : "bg-error"}`} aria-hidden />
          {showGateScanner ? "BURNER_ROLE active — ready to scan" : "No BURNER_ROLE — read-only"}
        </div>

        {/* Register route (admin) */}
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
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Category</span>
                    <input type="text" className={inputClass} value={regCategory} maxLength={60}
                      onChange={(e) => setRegCategory(e.target.value)} placeholder="e.g. Abuja & FCT" />
                  </label>
                  <label className="block">
                    <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Mint price (MON)</span>
                    <input type="text" className={`${inputClass} font-mono`} value={regPriceMon}
                      onChange={(e) => setRegPriceMon(e.target.value)} placeholder="0.075" />
                  </label>
                </div>
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Route name</span>
                  <input type="text" className={inputClass} value={regName} maxLength={100}
                    onChange={(e) => setRegName(e.target.value)} placeholder="Route display name" />
                </label>
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

        {/* Configure MON prices (admin) */}
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

        {/* Configure USDC payments (admin) */}
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
                      {checkingAdminAccess ? "Checking wallet role…" : "Connect the admin wallet to configure USDC."}
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

        {/* Operator whitelist (admin) */}
        <details className="mb-6 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-4 font-headline text-sm font-semibold text-white hover:bg-surface-container-high transition-colors">
            Manage operator whitelist
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
              Admin only
            </span>
          </summary>
          <div className="border-t border-outline-variant/15 px-5 pb-5 pt-4 space-y-4">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              Only whitelisted operator addresses can be recorded on tickets.{" "}
              <code className="font-mono text-tertiary">address(0)</code> is approved by default (zero-operator sentinel).
            </p>

            {isAdmin !== true ? (
              <p className="text-sm text-on-surface-variant">
                {checkingAdminAccess ? "Checking wallet role…" : "Connect the admin wallet to manage operators."}
              </p>
            ) : (
              <div className="space-y-3">
                {/* Address input */}
                <label className="block">
                  <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    Operator address
                  </span>
                  <input
                    type="text"
                    className={`${inputClass} mt-1.5 font-mono text-xs`}
                    placeholder="0x…"
                    value={operatorInput}
                    onChange={(e) => { setOperatorInput(e.target.value); resetSetOperator(); setOperatorFormErr(null) }}
                  />
                </label>

                {/* Live approval status */}
                {operatorInputValid && (
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${
                    isOperatorApproved === undefined
                      ? "bg-surface-container-high text-on-surface-variant"
                      : isOperatorApproved
                        ? "border border-tertiary/30 bg-tertiary/8 text-tertiary"
                        : "border border-error/30 bg-error/8 text-error"
                  }`}>
                    {isOperatorApproved === undefined ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
                    ) : isOperatorApproved ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                    {isOperatorApproved === undefined ? "Checking…" : isOperatorApproved ? "Approved" : "Not approved"}
                  </div>
                )}

                {/* Approve / Revoke buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!operatorInputValid || setOperatorPending || setOperatorConfirming}
                    onClick={() => onSetOperator(true)}
                    className="flex-1 rounded-xl border border-tertiary/40 bg-tertiary/15 px-4 py-2.5 font-headline text-sm font-semibold text-tertiary transition-colors hover:bg-tertiary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {setOperatorPending ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-tertiary/30 border-t-tertiary" />
                        Confirm…
                      </span>
                    ) : setOperatorConfirming ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-tertiary/30 border-t-tertiary" />
                        Saving…
                      </span>
                    ) : setOperatorSuccess ? "✓ Saved" : "Approve"}
                  </button>
                  <button
                    type="button"
                    disabled={!operatorInputValid || setOperatorPending || setOperatorConfirming}
                    onClick={() => onSetOperator(false)}
                    className="flex-1 rounded-xl border border-error/30 bg-error/8 px-4 py-2.5 font-headline text-sm font-semibold text-error transition-colors hover:bg-error/15 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Revoke
                  </button>
                </div>

                {setOperatorError && (
                  <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2.5">
                    <p className="text-xs text-error break-words">{formatWriteContractError(setOperatorError)}</p>
                  </div>
                )}
                {operatorFormErr && (
                  <p className="text-xs text-error">{operatorFormErr}</p>
                )}
              </div>
            )}
          </div>
        </details>

        {/* No burner role warning */}
        {!showGateScanner && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-error/20 bg-error/8 p-4">
            <span className="material-symbols-outlined mt-0.5 shrink-0 text-base text-error" aria-hidden>lock</span>
            <p className="text-sm text-error">
              Gate scanning requires <code className="font-mono text-xs">BURNER_ROLE</code>.
              Ask an admin to grant it to this address, or switch wallets.
            </p>
          </div>
        )}

        {/* ── Burn result screens ── */}
        {showGateScanner && burnSuccess && (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            {/* Illustration */}
            <div className="relative mb-8 flex h-36 w-36 items-center justify-center">
              {/* Outer glow ring */}
              <div className="absolute inset-0 rounded-full bg-tertiary/10" />
              <div className="absolute inset-3 rounded-full bg-tertiary/15" />
              {/* Main circle */}
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-tertiary/30 to-tertiary/10 shadow-[0_0_48px_rgba(var(--color-tertiary-rgb,100,200,100),0.25)]">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="text-tertiary" aria-hidden>
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              {/* Scatter dots */}
              <span className="absolute top-1 right-4 h-2.5 w-2.5 rounded-full bg-tertiary/40" aria-hidden />
              <span className="absolute top-5 right-0 h-1.5 w-1.5 rounded-full bg-tertiary/25" aria-hidden />
              <span className="absolute bottom-3 right-2 h-2 w-2 rounded-full bg-tertiary/30" aria-hidden />
              <span className="absolute bottom-1 left-5 h-1.5 w-1.5 rounded-full bg-primary/35" aria-hidden />
              <span className="absolute top-2 left-2 h-2 w-2 rounded-full bg-primary/25" aria-hidden />
              <span className="absolute top-8 left-0 h-1 w-1 rounded-full bg-tertiary/40" aria-hidden />
            </div>

            {/* Heading */}
            <h2 className="font-headline text-3xl font-bold leading-tight text-white">
              Ticket burned!
            </h2>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-on-surface-variant">
              Confirmed on-chain. The pass is permanently invalidated and cannot be used again.
            </p>

            {/* Tx hash pill */}
            {burnHash && (
              <a
                href={`${monadTestnet.blockExplorers.default.url}/tx/${burnHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded-full border border-tertiary/20 bg-tertiary/8 px-4 py-2 font-mono text-[11px] text-tertiary transition-colors hover:border-tertiary/40"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                {burnHash.slice(0, 12)}…{burnHash.slice(-8)} ↗
              </a>
            )}

            {/* CTA */}
            <button
              type="button"
              onClick={() => { setParsed(null); setRawInput(""); setParseErr(null); resetBurn() }}
              className="mt-8 w-full max-w-xs rounded-full bg-white px-8 py-4 font-headline text-base font-bold text-zinc-900 shadow-lg transition-all hover:bg-white/90 active:scale-[0.97]"
            >
              Scan next ticket
            </button>
            <Link to="/operator"
              className="mt-4 font-headline text-sm font-semibold text-on-surface-variant underline underline-offset-4 hover:text-white">
              Go to operations
            </Link>
          </div>
        )}

        {showGateScanner && !burnSuccess && burnError && (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            {/* Illustration */}
            <div className="relative mb-8 flex h-36 w-36 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-error/10" />
              <div className="absolute inset-3 rounded-full bg-error/15" />
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-error/30 to-error/10 shadow-[0_0_48px_rgba(255,80,100,0.2)]">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="text-error" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              {/* Scatter dots */}
              <span className="absolute top-1 right-4 h-2.5 w-2.5 rounded-full bg-error/35" aria-hidden />
              <span className="absolute top-5 right-0 h-1.5 w-1.5 rounded-full bg-error/20" aria-hidden />
              <span className="absolute bottom-3 right-2 h-2 w-2 rounded-full bg-error/25" aria-hidden />
              <span className="absolute bottom-1 left-5 h-1.5 w-1.5 rounded-full bg-on-surface-variant/20" aria-hidden />
              <span className="absolute top-2 left-2 h-2 w-2 rounded-full bg-error/20" aria-hidden />
              <span className="absolute top-8 left-0 h-1 w-1 rounded-full bg-error/35" aria-hidden />
            </div>

            {/* Heading */}
            <h2 className="font-headline text-3xl font-bold leading-tight text-white">
              Burn failed.
            </h2>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-on-surface-variant">
              {formatWriteContractError(burnError)}
            </p>

            {/* CTA */}
            <button
              type="button"
              onClick={() => resetBurn()}
              className="mt-8 w-full max-w-xs rounded-full bg-white px-8 py-4 font-headline text-base font-bold text-zinc-900 shadow-lg transition-all hover:bg-white/90 active:scale-[0.97]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => { setParsed(null); setRawInput(""); setParseErr(null); resetBurn() }}
              className="mt-4 font-headline text-sm font-semibold text-on-surface-variant underline underline-offset-4 hover:text-white"
            >
              Scan different ticket
            </button>
          </div>
        )}

        {/* ── Scanner section ── */}
        {showGateScanner && !burnSuccess && !burnError && (
          <div className="space-y-4">
            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button type="button"
                onClick={() => { setCameraErr(null); setCameraOn((c) => !c) }}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 font-headline text-sm font-semibold transition-all ${
                  cameraOn
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-outline-variant/30 bg-surface-container text-on-surface-variant hover:border-primary/30 hover:text-white"
                }`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                {cameraOn ? "Stop camera" : "Scan QR"}
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2.5 font-headline text-sm font-semibold text-on-surface-variant transition-colors hover:border-primary/30 hover:text-white">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <path d="M14 14h2v2h-2zM18 14h3M14 18h3M20 18v3M17 21h3" />
                </svg>
                Upload QR
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={onQrImageChosen} />
            </div>

            {/* Camera view */}
            {cameraOn && (
              <div className="overflow-hidden rounded-2xl bg-black">
                <p className="px-4 pt-3 text-xs text-on-surface-variant">
                  Fit the entire QR inside the box. Hold steady.
                </p>
                <div className="relative">
                  <div id={regionId}
                    className="min-h-[min(300px,85vw)] w-full [&_video]:max-h-[70vh]" />
                  {/* Corner-bracket viewfinder overlay — purely visual, doesn't affect scanning */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative"
                      style={{ width: "min(75vw, 260px)", height: "min(75vw, 260px)" }}>
                      {/* Top-left */}
                      <span className="absolute left-0 top-0 h-8 w-8 border-l-[3px] border-t-[3px] border-white rounded-tl-sm" />
                      {/* Top-right */}
                      <span className="absolute right-0 top-0 h-8 w-8 border-r-[3px] border-t-[3px] border-white rounded-tr-sm" />
                      {/* Bottom-left */}
                      <span className="absolute bottom-0 left-0 h-8 w-8 border-b-[3px] border-l-[3px] border-white rounded-bl-sm" />
                      {/* Bottom-right */}
                      <span className="absolute bottom-0 right-0 h-8 w-8 border-b-[3px] border-r-[3px] border-white rounded-br-sm" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            {cameraErr && (
              <p className="rounded-xl border border-error/20 bg-error/8 px-4 py-3 text-xs text-error">
                Camera error: {cameraErr}
              </p>
            )}

            {/* Paste JSON */}
            <div>
              <label>
                <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Or paste QR JSON
                </span>
                <textarea
                  className={`${inputClass} mt-1.5 min-h-[90px] font-mono resize-none`}
                  placeholder={`{"tokenId":"1","holder":"0x...","exp":...,"signature":"..."}`}
                  value={rawInput}
                  onChange={(e) => { setRawInput(e.target.value); setParsed(null); setParseErr(null) }}
                />
              </label>
              <button type="button"
                onClick={() => applyDecoded(rawInput)}
                className="mt-2 rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2 font-headline text-sm font-semibold text-on-surface-variant transition-colors hover:border-primary/40 hover:text-white">
                Decode
              </button>
            </div>

            {parseErr && <p className="text-xs text-error">{parseErr}</p>}
            {parsed && tokenIdBig === undefined && (
              <p className="text-xs text-error">Invalid token ID in QR. Paste JSON from the pass screen.</p>
            )}

            {/* Verification panel */}
            {parsed && tokenIdBig !== undefined && (() => {
              const isValid = holderMatches && notExpired
              const isInvalid = checksLoaded && !isValid

              // Build failure reasons
              const reasons: string[] = []
              if (checksLoaded) {
                if (apiVerify === false) reasons.push("QR signature is invalid or expired")
                if (!holderMatches) reasons.push("Ticket holder does not match wallet on-chain")
                if (!notExpired) reasons.push("Ticket has expired")
              }

              return (
              <>
              {/* ── Invalid ticket card ── */}
              {isInvalid && (
                <div className="overflow-hidden rounded-2xl border border-error/40 bg-surface-container shadow-lg shadow-error/10">
                  {/* Red header strip */}
                  <div className="bg-gradient-to-r from-error/25 via-error/10 to-transparent px-5 py-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-error/20">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-error" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-headline text-xs font-bold uppercase tracking-widest text-error">Invalid ticket</p>
                      <p className="font-headline text-lg font-bold text-white leading-snug">Do not board</p>
                    </div>
                  </div>

                  {/* Failure reasons */}
                  <div className="border-t border-error/15 px-5 py-4 space-y-2">
                    {reasons.map((r) => (
                      <div key={r} className="flex items-start gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          className="mt-0.5 shrink-0 text-error" aria-hidden>
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <p className="text-xs font-semibold text-error">{r}</p>
                      </div>
                    ))}
                  </div>

                  {/* Ticket details */}
                  <div className="grid grid-cols-2 divide-x divide-error/10 border-t border-error/15">
                    <div className="px-5 py-3">
                      <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Token</p>
                      <p className="mt-1 font-mono text-xs text-white">#{String(tokenIdBig).slice(0, 8)}…</p>
                    </div>
                    <div className="px-5 py-3">
                      <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Holder</p>
                      <p className="mt-1 font-mono text-xs text-white">{parsed.holder.slice(0, 8)}…{parsed.holder.slice(-4)}</p>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="border-t border-error/15 px-5 py-4">
                    <button type="button"
                      onClick={() => { setParsed(null); setRawInput(""); setParseErr(null); resetBurn() }}
                      className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-high px-4 py-3 font-headline text-sm font-semibold text-white transition-colors hover:border-primary/40">
                      Scan another ticket
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
                <div className="border-b border-outline-variant/15 px-5 py-4">
                  <h2 className="font-headline text-sm font-bold text-white">Verification</h2>
                  <p className="mt-0.5 font-mono text-xs text-on-surface-variant truncate"
                    title={parsed.holder}>
                    Holder: {parsed.holder.slice(0, 10)}…{parsed.holder.slice(-6)}
                  </p>
                </div>

                <ul className="divide-y divide-outline-variant/10">
                  {[
                    {
                      label: "API signature",
                      status: apiVerify === null ? "pending" : apiVerify ? "ok" : "fail",
                      ok: apiVerify === true,
                      text: apiVerify === null ? "Checking…" : apiVerify ? "Valid" : "Invalid / API down",
                    },
                    {
                      label: "Holder = ownerOf",
                      status: chainOwner === undefined ? "pending" : holderMatches ? "ok" : "fail",
                      ok: holderMatches === true,
                      text: chainOwner === undefined ? "…" : holderMatches ? "Matches" : "Mismatch",
                    },
                    {
                      label: "Not expired",
                      status: validUntil === undefined ? "pending" : notExpired ? "ok" : "fail",
                      ok: notExpired === true,
                      text: validUntil === undefined ? "…" : notExpired ? "Valid" : "Expired",
                    },
                    {
                      label: "Route on-chain",
                      status: chainRoute !== undefined ? "ok" : "pending",
                      ok: chainRoute !== undefined,
                      text: chainRoute !== undefined ? String(chainRoute) : "Loading…",
                    },
                  ].map((item) => (
                    <li key={item.label} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-on-surface-variant">{item.label}</span>
                      <span className={`font-headline text-xs font-semibold ${
                        item.status === "pending" ? "text-on-surface-variant" :
                        item.status === "ok" ? "text-tertiary" : "text-error"
                      }`}>
                        {item.status === "ok" && (
                          <span className="mr-1" aria-hidden>✓</span>
                        )}
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="border-t border-outline-variant/15 p-5">
                  {/* ── Burn button ── */}
                  <button type="button"
                    disabled={!holderMatches || !notExpired || burnPending || burnConfirming || chainRoute === undefined}
                    onClick={() => void onBurn()}
                    className="w-full rounded-2xl bg-error/80 px-6 py-4 font-headline text-base font-bold text-white transition-all hover:bg-error hover:shadow-[0_0_24px_rgba(255,110,132,0.3)] disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]">
                    {burnPending || burnConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        {burnPending ? "Confirm in wallet…" : "Burning on-chain…"}
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                          <path d="M15 9l-6 6M9 9l6 6" />
                        </svg>
                        Burn ticket
                      </span>
                    )}
                  </button>
                </div>
              </div>
              </>
            )
          })()}
          </div>
        )}

        <div className="mt-10 text-center">
          <Link to="/operator" className="font-headline text-xs font-semibold text-primary hover:underline">
            Operations →
          </Link>
        </div>
      </div>
    </ConductorErrorBoundary>
  )
}
