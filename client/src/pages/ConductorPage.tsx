import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { isAddress, parseEther } from "viem"
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi"
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode"
import { chainPassTicketAbi, newRouteIdDecimalFromUuid } from "@chainpass/shared"
import { Button } from "../components/ui/Button"
import { getContractAddress } from "../lib/contract"
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
        <div className="mx-auto max-w-2xl rounded-2xl border border-error/40 bg-error/10 p-6 text-sm text-error">
          <p className="font-headline font-semibold text-white">Something went wrong after the scan</p>
          <p className="mt-2 break-words font-mono text-xs">{this.state.err.message}</p>
          <button
            type="button"
            className="mt-4 rounded-lg border border-outline-variant px-4 py-2 text-on-surface"
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

  if (!contractAddress) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl bg-surface-container p-8 text-on-surface-variant">
        Set <code className="font-mono text-primary">VITE_CHAINPASS_CONTRACT_ADDRESS</code> in env.
      </div>
    )
  }

  const shellHeader = (
    <>
      <p className="font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">Conductor</p>
      <h1 className="mt-2 font-headline text-3xl font-bold text-white">Gate</h1>
    </>
  )

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-2xl">
        {shellHeader}
        <p className="mt-4 text-on-surface-variant">
          Connect the wallet that has <span className="font-mono text-tertiary">BURNER_ROLE</span> on the ticket
          contract, then return here to scan and burn tickets.
        </p>
        <p className="mt-8 text-sm text-tertiary">Use the connect button in the header.</p>
        <p className="mt-10 text-center text-xs text-on-surface-variant">
          <Link to="/routes" className="text-primary hover:underline">
            ← Routes
          </Link>
        </p>
      </div>
    )
  }

  if (checkingAccess) {
    return (
      <div className="mx-auto max-w-2xl">
        {shellHeader}
        <p className="mt-8 text-sm text-on-surface-variant">Checking wallet roles…</p>
      </div>
    )
  }

  const showGateScanner = isBurner === true

  return (
    <ConductorErrorBoundary>
      <div className="mx-auto max-w-2xl">
        {shellHeader}
        {showGateScanner ? (
          <p className="mt-2 text-on-surface-variant">
            Scan a passenger QR or paste the JSON. Your wallet has{" "}
            <span className="font-mono text-tertiary">BURNER_ROLE</span> — you can burn validated tickets.
          </p>
        ) : (
          <p className="mt-2 text-on-surface-variant">
            This wallet does not have <span className="font-mono text-tertiary">BURNER_ROLE</span>. Use{" "}
            <strong className="text-on-surface">Register new route</strong> below if you are a contract admin; conductors need
            a burner wallet to scan tickets.
          </p>
        )}

        <details className="mt-8 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50 p-4 open:bg-surface-container-low">
          <summary className="cursor-pointer font-headline text-sm font-semibold text-white">
            Register new route (admin only)
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
            Sets an on-chain mint price for a <strong className="text-on-surface">new</strong> route (a uint256 route ID is
            generated automatically from a random UUID). Registers the name in the app (insert-only). Requires{" "}
            <code className="font-mono text-tertiary">DEFAULT_ADMIN_ROLE</code> on the ticket contract. Separate from
            conductor <code className="font-mono">BURNER_ROLE</code>.
          </p>
          {isAdmin !== true ? (
            <p className="mt-4 text-sm text-on-surface-variant">
              Connect an admin wallet in the header to enable this form.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block text-xs text-on-surface-variant">
                Category
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-sm text-white"
                  value={regCategory}
                  onChange={(e) => setRegCategory(e.target.value)}
                  placeholder="e.g. Abuja & FCT"
                />
              </label>
              <label className="block text-xs text-on-surface-variant">
                Name
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-sm text-white"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Route display name"
                />
              </label>
              <label className="block text-xs text-on-surface-variant">
                Detail (optional)
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 text-sm text-white"
                  value={regDetail}
                  onChange={(e) => setRegDetail(e.target.value)}
                />
              </label>
              <label className="block text-xs text-on-surface-variant">
                Mint price (MON)
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container px-3 py-2 font-mono text-sm text-white"
                  value={regPriceMon}
                  onChange={(e) => setRegPriceMon(e.target.value)}
                  placeholder="0.075"
                />
              </label>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={routePricePending || routePriceConfirming}
                onClick={() => void onRegisterRoute()}
              >
                {routePricePending || routePriceConfirming ? "Confirm in wallet…" : "Set price & register new route"}
              </Button>
              {routePriceError ? (
                <p className="text-sm text-error">{formatWriteContractError(routePriceError)}</p>
              ) : null}
              {regFormErr ? <p className="text-sm text-error">{regFormErr}</p> : null}
              {regLabelMsg ? <p className="text-sm text-tertiary">{regLabelMsg}</p> : null}
            </div>
          )}
        </details>

        {!showGateScanner ? (
          <div className="mt-8 rounded-2xl border border-error/40 bg-error/10 p-6 text-sm text-error">
            Gate scanning requires <code className="font-mono">BURNER_ROLE</code>. Ask an admin to grant it to this address,
            or switch to the conductor wallet.
          </div>
        ) : null}

      {/* Mount target for scanFile(); must exist in DOM before decode-from-image runs. */}
      <div
        id={fileRegionId}
        className="pointer-events-none fixed top-0 left-[-9999px] h-px w-px overflow-hidden opacity-0"
        aria-hidden
      />

      {showGateScanner ? (
        <>
      <div className="mt-8 space-y-4">
        <textarea
          className="min-h-[120px] w-full rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-3 font-mono text-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
          placeholder='Paste QR JSON: {"tokenId":"1","holder":"0x...","exp":...,"signature":"..."}'
          value={rawInput}
          onChange={(e) => {
            setRawInput(e.target.value)
            setParsed(null)
            setParseErr(null)
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="primary" size="sm" onClick={() => applyDecoded(rawInput)}>
            Decode
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setCameraErr(null)
              setCameraOn((c) => !c)
            }}
          >
            {cameraOn ? "Stop camera" : "Use camera"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={onQrImageChosen}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Upload QR photo
          </Button>
        </div>
        <p className="text-xs text-on-surface-variant">
          <strong className="text-on-surface">iPhone:</strong> live scan is unreliable in Safari; use{" "}
          <strong className="text-on-surface">Upload QR photo</strong> (screenshot the passenger pass) if the camera does
          not decode.
        </p>
        {cameraOn ? (
          <>
            <p className="text-xs text-on-surface-variant">
              {isIosLike() ? (
                <>
                  Use the <strong className="text-on-surface">full camera view</strong> — keep the whole QR in frame and
                  hold steady (maximum screen brightness on the passenger phone).
                </>
              ) : (
                <>
                  Fit the <strong className="text-on-surface">entire QR</strong> inside the shaded box. Hold steady; raise
                  brightness on the passenger phone if needed.
                </>
              )}
            </p>
            <div
              id={regionId}
              className="min-h-[min(280px,85vw)] w-full overflow-hidden rounded-xl bg-black/40 [&_video]:max-h-[70vh]"
            />
          </>
        ) : null}
        {cameraErr ? (
          <p className="text-sm text-error">
            Camera: {cameraErr}. On iPhone, allow camera when prompted; if it still fails, check Settings → Safari → Camera
            (or the site’s permission in Settings → Safari → Advanced → Website Data).
          </p>
        ) : null}
        {parseErr ? <p className="text-sm text-error">{parseErr}</p> : null}
      </div>

      {parsed && tokenIdBig === undefined ? (
        <p className="mt-6 text-sm text-error">Invalid token id in QR (must be a non-negative integer). Paste JSON from the API pass screen.</p>
      ) : null}

      {parsed && tokenIdBig !== undefined ? (
        <div className="mt-10 space-y-4 rounded-2xl bg-surface-container p-6">
          <h2 className="font-headline font-bold text-white">Checks</h2>
          <ul className="space-y-2 text-sm text-on-surface-variant">
            <li>
              API signature:{" "}
              {apiVerify === null ? "…" : apiVerify ? <span className="text-tertiary">valid</span> : <span className="text-error">invalid / API down</span>}
            </li>
            <li>
              Holder matches <code className="font-mono text-xs">ownerOf</code>:{" "}
              {chainOwner === undefined ? (
                "…"
              ) : holderMatches ? (
                <span className="text-tertiary">yes</span>
              ) : (
                <span className="text-error">no</span>
              )}
            </li>
            <li>
              Not expired (validUntil):{" "}
              {validUntil === undefined ? "…" : notExpired ? <span className="text-tertiary">ok</span> : <span className="text-error">expired</span>}
            </li>
            <li>
              Route on-chain: <span className="font-mono text-white">{chainRoute !== undefined ? String(chainRoute) : "…"}</span>
            </li>
          </ul>
          <Button
            type="button"
            variant="primary"
            className="mt-4 w-full sm:w-auto"
            disabled={
              !holderMatches ||
              !notExpired ||
              burnPending ||
              burnConfirming ||
              chainRoute === undefined
            }
            onClick={() => void onBurn()}
          >
            {burnPending || burnConfirming ? "Confirm burn…" : "Burn ticket"}
          </Button>
          {burnError ? <p className="mt-2 text-sm text-error">{formatWriteContractError(burnError)}</p> : null}
          {burnSuccess ? <p className="mt-2 text-sm text-tertiary">Burn confirmed on-chain.</p> : null}
        </div>
      ) : null}
        </>
      ) : null}

        <p className="mt-10 text-center text-xs text-on-surface-variant">
          <Link to="/operator" className="text-primary hover:underline">
            Operations
          </Link>
        </p>
      </div>
    </ConductorErrorBoundary>
  )
}
