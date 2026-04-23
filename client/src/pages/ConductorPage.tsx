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
import { isAddress } from "viem"
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { chainPassTicketAbi, monadTestnet } from "@hoppr/shared"
import { getContractAddress } from "../lib/contract"
import { verifyQrPayload, fetchTripForToken, fetchTripsByStatus, fetchTripManifest, type QrPayload, type ApiTrip } from "../lib/api"
import { formatWriteContractError } from "../lib/walletError"

// ── IndexedDB offline manifest helpers ────────────────────────────────────
const IDB_NAME  = "chainpass-conductor"
const IDB_STORE = "manifests"

async function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}
async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite")
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror   = () => reject(req.error)
  })
}

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

  const checkingAccess = checkingBurnerAccess

  const { data: chainOwner, error: ownerError } = useReadContract({
    address: contractAddress,
    abi: chainPassTicketAbi,
    functionName: "ownerOf",
    args: tokenIdBig !== undefined ? [tokenIdBig] : undefined,
    query: { enabled: !!contractAddress && tokenIdBig !== undefined },
  })
  // ownerOf reverts when the token no longer exists (burned). Treat any read
  // error as "already boarded" so the conductor sees a clear message.
  const isAlreadyBurned = ownerError !== null && ownerError !== undefined && tokenIdBig !== undefined

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

  // ── Trip validation ────────────────────────────────────────────────────
  const [tripForToken, setTripForToken] = useState<ApiTrip | null>(null)
  const [tripLoading, setTripLoading] = useState(false)
  useEffect(() => {
    if (!parsed) { setTripForToken(null); setTripLoading(false); return }
    setTripLoading(true)
    void fetchTripForToken(parsed.tokenId)
      .then((t) => setTripForToken(t))
      .catch(() => setTripForToken(null))
      .finally(() => setTripLoading(false))
  }, [parsed])

  /** null = no trip linked (backward compat = pass). ApiTrip = check status. */
  const isTripValid: boolean =
    tripForToken === null
      ? true
      : tripForToken.status === "boarding" || tripForToken.status === "departed"

  // ── Online / offline detection ────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up   = () => setIsOnline(true)
    const down = () => setIsOnline(false)
    window.addEventListener("online",  up)
    window.addEventListener("offline", down)
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down) }
  }, [])

  // ── Offline manifest: cache all boarding-trip token IDs into IndexedDB ──
  const [manifestCached, setManifestCached] = useState(false)
  const [manifestLoading, setManifestLoading] = useState(false)
  const cacheManifest = useCallback(async () => {
    setManifestLoading(true)
    try {
      const boardingTrips = await fetchTripsByStatus("boarding")
      for (const trip of boardingTrips) {
        const tokenIds = await fetchTripManifest(trip.id)
        await idbSet(`manifest-${trip.id}`, { tripId: trip.id, tokenIds, cachedAt: Date.now() })
      }
      setManifestCached(true)
    } catch {
      // silently fail — network may already be gone
    } finally {
      setManifestLoading(false)
    }
  }, [])

  // Auto-cache once on mount if online
  useEffect(() => {
    if (isOnline) void cacheManifest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Offline token verification ────────────────────────────────────────
  const [offlineResult, setOfflineResult] = useState<boolean | null>(null)
  useEffect(() => {
    if (!parsed || isOnline) { setOfflineResult(null); return }
    void (async () => {
      try {
        const db = await idbOpen()
        // Search all cached manifests for this token ID
        const keys: IDBValidKey[] = await new Promise((resolve, reject) => {
          const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAllKeys()
          req.onsuccess = () => resolve(req.result as IDBValidKey[])
          req.onerror   = () => reject(req.error)
        })
        for (const key of keys) {
          const entry = await idbGet<{ tripId: number; tokenIds: string[] }>(String(key))
          if (entry?.tokenIds.includes(parsed.tokenId)) {
            setOfflineResult(true)
            return
          }
        }
        setOfflineResult(false)
      } catch {
        setOfflineResult(false)
      }
    })()
  }, [parsed, isOnline])

  // Keep screen awake while camera is on
  useWakeLock(cameraOn)

  // Haptic feedback when verification result is determined
  const checksLoaded =
    apiVerify !== null &&
    chainOwner !== undefined &&
    validUntil !== undefined &&
    chainRoute !== undefined &&
    !tripLoading
  const isTicketValid = checksLoaded && holderMatches === true && notExpired === true && isTripValid
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
        Set <code className="font-mono text-primary">VITE_HOPPR_CONTRACT_ADDRESS</code> in env.
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
      {/* Fullscreen ALREADY-BURNED overlay */}
      {isAlreadyBurned && parsed && !burnSuccess && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#1a0a0a] px-6 force-white">
          <div className="relative mb-8 flex h-40 w-40 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-amber-500/10" />
            <div className="absolute inset-2 rounded-full bg-amber-500/15" />
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/40 to-amber-500/10 shadow-[0_0_64px_rgba(245,158,11,0.35)]">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-amber-400" aria-hidden>
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
          </div>
          <p className="font-headline text-[11px] font-bold uppercase tracking-[0.3em] text-amber-500/70">Already boarded</p>
          <h1 className="mt-2 font-headline text-5xl font-black tracking-tight text-amber-400">USED</h1>
          <p className="mt-3 max-w-xs text-center text-sm leading-relaxed text-white/60">
            This ticket has already been scanned and burned. It cannot be used to board again.
          </p>
          <p className="mt-2 font-mono text-xs text-white/30">#{parsed.tokenId.slice(0, 10)}…</p>
          <button
            type="button"
            onClick={() => { setParsed(null); setRawInput(""); setParseErr(null); resetBurn() }}
            className="btn-dark-cta mt-10 w-full max-w-xs rounded-full bg-white px-8 py-4 font-headline text-base font-bold text-zinc-900 shadow-lg transition-all hover:bg-white/90 active:scale-[0.97]"
          >
            Scan next ticket
          </button>
        </div>
      )}

      {/* Fullscreen VALID overlay — shown after scan resolves and ticket is valid */}
      {showValidOverlay && parsed && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a1a0f] px-6 force-white">
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
          {tripForToken && (
            <p className="mt-1 font-headline text-sm font-semibold text-emerald-400/80">
              {new Date(tripForToken.departureAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {" → "}
              {new Date(tripForToken.arrivalAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {tripForToken.status.toUpperCase()}
            </p>
          )}
          <p className="mt-1 font-mono text-sm text-white/40">
            #{parsed.tokenId.slice(0, 8)}… · {parsed.holder.slice(0, 6)}…{parsed.holder.slice(-4)}
          </p>

          {/* Burn button */}
          <button
            type="button"
            disabled={burnPending || burnConfirming}
            onClick={() => { void onBurn() }}
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
        <div className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-headline text-xs font-semibold ${
          showGateScanner
            ? "border-tertiary/30 bg-tertiary/8 text-tertiary"
            : "border-error/30 bg-error/8 text-error"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${showGateScanner ? "bg-tertiary" : "bg-error"}`} aria-hidden />
          {showGateScanner ? "BURNER_ROLE active — ready to scan" : "No BURNER_ROLE — read-only"}
        </div>

        {/* Offline / online status banner */}
        {!isOnline ? (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" aria-hidden />
              <span className="font-headline text-xs font-bold uppercase tracking-widest text-amber-400">Offline mode</span>
              <span className="text-xs text-amber-400/70">— using cached manifest</span>
            </div>
            {offlineResult !== null && (
              <span className={`font-headline text-xs font-bold ${offlineResult ? "text-emerald-400" : "text-error"}`}>
                {offlineResult ? "✓ In manifest" : "✗ Not found"}
              </span>
            )}
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Online</span>
            </div>
            <button
              type="button"
              onClick={() => void cacheManifest()}
              disabled={manifestLoading}
              className="flex items-center gap-1.5 rounded-lg border border-outline-variant/25 bg-surface-container px-3 py-1.5 font-headline text-[11px] font-semibold text-on-surface-variant transition-colors hover:border-primary/30 hover:text-white disabled:opacity-50"
            >
              {manifestLoading ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-outline-variant border-t-primary" />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
              {manifestCached ? "Re-cache manifest" : "Cache manifest"}
            </button>
          </div>
        )}

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
              onClick={() => { setParsed(null); setRawInput(""); setParseErr(null); resetBurn(); setCameraOn(true); }}
              className="btn-dark-cta mt-8 w-full max-w-xs rounded-full bg-white px-8 py-4 font-headline text-base font-bold text-zinc-900 shadow-lg transition-all hover:bg-white/90 active:scale-[0.97]"
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
              className="btn-dark-cta mt-8 w-full max-w-xs rounded-full bg-white px-8 py-4 font-headline text-base font-bold text-zinc-900 shadow-lg transition-all hover:bg-white/90 active:scale-[0.97]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => { setParsed(null); setRawInput(""); setParseErr(null); resetBurn(); setCameraOn(true); }}
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
              // Offline mode: only use the manifest check
              if (!isOnline) {
                return (
                  <div className={`overflow-hidden rounded-2xl border ${offlineResult === true ? "border-emerald-500/30 bg-surface-container" : offlineResult === false ? "border-error/30 bg-surface-container" : "border-outline-variant/20 bg-surface-container"}`}>
                    <div className="px-5 py-4">
                      <p className="font-headline text-xs font-bold uppercase tracking-widest text-amber-400">Offline verification</p>
                      {offlineResult === null && (
                        <p className="mt-1 text-sm text-on-surface-variant">Checking cached manifest…</p>
                      )}
                      {offlineResult === true && (
                        <p className="mt-1 font-semibold text-emerald-400">✓ Token found in cached manifest</p>
                      )}
                      {offlineResult === false && (
                        <p className="mt-1 font-semibold text-error">✗ Token not in any cached manifest — cannot verify offline</p>
                      )}
                      <p className="mt-2 font-mono text-xs text-on-surface-variant">#{parsed.tokenId.slice(0, 10)}…</p>
                    </div>
                    {offlineResult === true && (
                      <div className="border-t border-emerald-500/15 px-5 py-4">
                        <p className="text-xs text-emerald-400/70 text-center">
                          ✓ Ticket verified — allow boarding.
                          Reconnect to internet to burn on-chain.
                        </p>
                      </div>
                    )}
                  </div>
                )
              }

              const isValid = holderMatches && notExpired
              const isInvalid = checksLoaded && !isValid

              // Build failure reasons
              const reasons: string[] = []
              if (checksLoaded) {
                if (apiVerify === false) reasons.push("QR signature is invalid or expired")
                if (!holderMatches) reasons.push("Ticket holder does not match wallet on-chain")
                if (!notExpired) reasons.push("Ticket has expired")
                if (!isTripValid) reasons.push(
                  tripForToken
                    ? `Trip is ${tripForToken.status} — not currently boarding or in transit`
                    : "No active trip window for this ticket"
                )
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
                    {
                      label: "Trip active",
                      status: tripLoading
                        ? "pending"
                        : tripForToken === null
                          ? "ok"
                          : isTripValid ? "ok" : "fail",
                      ok: !tripLoading && isTripValid,
                      text: tripLoading
                        ? "Checking…"
                        : tripForToken === null
                          ? "No trip (open ticket)"
                          : isTripValid
                            ? `${tripForToken.status} · ${new Date(tripForToken.departureAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} → ${new Date(tripForToken.arrivalAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                            : `Trip ${tripForToken.status} — not active`,
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
                    disabled={!holderMatches || !notExpired || !isTripValid || burnPending || burnConfirming || chainRoute === undefined || tripLoading}
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
