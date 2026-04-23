import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { PwaInstallBanner } from "../components/PwaInstallBanner"
import { usePrivy, useWallets } from "@privy-io/react-auth"
import { useQuery } from "@tanstack/react-query"
import { Link, NavLink, Outlet, useLocation } from "react-router-dom"
import { createPublicClient, formatEther, formatUnits, http } from "viem"
import type { Address } from "viem"
import { useAccount, useReadContract, useSwitchChain } from "wagmi"
import { erc20Abi, monadTestnet } from "@hoppr/shared"
import { env } from "../lib/env"
import { initAnalytics, trackPageView } from "../lib/analytics"
import { formatNgn, MON_USD_PRICE, useExchangeRates } from "../lib/prices"
import { pickEthereumAddressFromUser } from "../lib/privyWallet"
import { switchToMonadTestnet } from "../lib/switchToMonadTestnet"
import { useOnlineStatus } from "../hooks/useOnlineStatus"
import { useTheme } from "../hooks/useTheme"

function caip2ToChainId(caip: string | undefined): number | undefined {
  if (!caip) return undefined
  const m = /^eip155:(\d+)$/.exec(caip)
  return m ? Number(m[1]) : undefined
}

const monadPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
})

function formatMonDisplay(value: bigint | undefined, isPending: boolean): string {
  if (isPending) return "…"
  if (value === undefined) return "—"
  const n = Number(formatEther(value))
  if (!Number.isFinite(n)) return "—"
  if (n === 0) return "0"
  if (n > 0 && n < 1e-4) return "<0.0001"
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className ?? ""} size-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ─────────── Bottom nav icons ─────────── */
function RoutesIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="8" width="22" height="9" rx="2" />
      <path d="M5 8V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
      <circle cx="7" cy="17" r="1.5" fill={active ? "currentColor" : "none"} />
      <circle cx="17" cy="17" r="1.5" fill={active ? "currentColor" : "none"} />
    </svg>
  )
}
function PassesIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9z" />
      <line x1="9" y1="7" x2="9" y2="17" strokeDasharray="2 2" />
    </svg>
  )
}
function GateIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h2v2h-2zM18 14h3M14 18h3M20 18v3M17 21h3" />
    </svg>
  )
}
function OpsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
}

function AdminIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

const walletPurpleBtn =
  "btn-primary-gradient border border-white/20 font-headline text-sm font-medium text-white transition-[filter] hover:brightness-[1.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low disabled:cursor-not-allowed disabled:opacity-55"

function HeaderWalletControls() {
  const { ready, authenticated, login, logout, user, linkWallet } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const firstEthWallet = useMemo(() => wallets.find((w) => w.type === "ethereum"), [wallets])
  const addressFromUser = useMemo(() => pickEthereumAddressFromUser(user), [user])
  const connectedAddress = (firstEthWallet?.address ?? addressFromUser) as Address | undefined
  const walletChainId = useMemo(() => caip2ToChainId(firstEthWallet?.chainId), [firstEthWallet?.chainId])
  const { chainId: accountChainId } = useAccount()
  const effectiveChainId = accountChainId ?? walletChainId
  const onMonad = effectiveChainId === monadTestnet.id

  const { switchChainAsync, isPending: wagmiSwitchPending } = useSwitchChain()
  const [switchPending, setSwitchPending] = useState(false)

  const onSwitchToMonad = useCallback(async () => {
    setSwitchPending(true)
    try {
      await switchToMonadTestnet({ privyEthWallet: firstEthWallet, wagmiSwitchChain: switchChainAsync })
    } catch { /* ignore */ } finally { setSwitchPending(false) }
  }, [firstEthWallet, switchChainAsync])

  const switchBusy = switchPending || wagmiSwitchPending

  const { data: balanceWei, isPending: balancePending } = useQuery({
    queryKey: ["header-native-balance", monadTestnet.id, connectedAddress],
    queryFn: () => monadPublicClient.getBalance({ address: connectedAddress! }),
    enabled: Boolean(authenticated && connectedAddress),
  })

  const usdcAddress = env.usdcAddress
  const { data: usdcBalanceRaw } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [connectedAddress ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: Boolean(authenticated && connectedAddress && usdcAddress), refetchInterval: 12_000 },
  })
  const usdcBalance = typeof usdcBalanceRaw === "bigint" ? usdcBalanceRaw : undefined

  const { usdToNgn, rateLoading: rateLoad } = useExchangeRates()
  const monNum  = balanceWei !== undefined ? Number(formatEther(balanceWei)) : 0
  const usdcNum = usdcBalance !== undefined ? Number(formatUnits(usdcBalance, 6)) : 0
  const totalNgn = monNum * MON_USD_PRICE * usdToNgn + usdcNum * usdToNgn

  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const walletMenuId = useId()

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menuOpen])

  const copyAddress = useCallback(async (a: string) => {
    try {
      await navigator.clipboard.writeText(a)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { setCopied(false) }
  }, [])

  const loadingBtn = (label: string) => (
    <button type="button" disabled aria-busy
      className={`${walletPurpleBtn} flex h-9 shrink-0 cursor-wait items-center justify-center rounded-xl px-4 opacity-90`}>
      {label}
    </button>
  )

  if (!ready) return loadingBtn("Connecting…")

  if (!authenticated) {
    return (
      <button type="button" onClick={() => void login()}
        className={`${walletPurpleBtn} flex h-9 shrink-0 items-center justify-center rounded-xl px-5`}>
        Connect
      </button>
    )
  }

  if (!connectedAddress) {
    if (!walletsReady) return loadingBtn("Connecting…")
    return (
      <button type="button" onClick={() => linkWallet()}
        className={`${walletPurpleBtn} flex h-9 shrink-0 items-center justify-center rounded-xl px-5`}>
        Connect wallet
      </button>
    )
  }

  const monLabel = formatMonDisplay(balanceWei, balancePending)
  const explorerAddressUrl = `${monadTestnet.blockExplorers.default.url}/address/${connectedAddress}`

  const menuItemClass =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-headline text-sm text-on-surface transition-colors hover:bg-surface-container-high/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"

  return (
    <div ref={containerRef}
      className="relative flex max-w-[min(100%,calc(100vw-7rem))] min-w-0 items-stretch gap-1.5 md:max-w-none">
      <button type="button"
        className={`${walletPurpleBtn} flex h-9 max-w-full min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left`}
        aria-expanded={menuOpen} aria-haspopup="dialog" aria-controls={walletMenuId}
        onClick={() => setMenuOpen((v) => !v)}>
        {/* Colored dot */}
        <span className={`h-2 w-2 shrink-0 rounded-full ${onMonad ? "bg-tertiary" : "bg-amber-400"}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="min-w-0 max-w-[6rem] truncate font-mono text-[11px] font-medium tabular-nums text-white sm:max-w-none sm:text-xs"
              title={connectedAddress}>
              {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
            </span>
            <span className="hidden items-baseline gap-0.5 sm:inline-flex">
              <span className="font-semibold text-tertiary text-xs">{monLabel}</span>
              <span className="text-white/60 text-[10px]">MON</span>
            </span>
          </span>
        </span>
        <ChevronIcon className="text-white/70" open={menuOpen} />
      </button>

      {!onMonad ? (
        <button type="button" disabled={switchBusy} onClick={() => void onSwitchToMonad()}
          className="btn-primary-gradient shrink-0 rounded-xl border border-amber-400/40 bg-amber-500/15 px-2.5 font-headline text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition-[filter] hover:brightness-110 disabled:opacity-50">
          {switchBusy ? "…" : "Switch"}
        </button>
      ) : null}

      {menuOpen ? (
        <div id={walletMenuId} role="dialog" aria-label="Wallet"
          className="absolute right-0 top-full z-[60] mt-2 w-[min(calc(100vw-2rem),22rem)] overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container shadow-2xl shadow-black/50 ring-1 ring-white/[0.05]">
          {/* Header */}
          <div className="bg-gradient-to-br from-primary/10 to-transparent p-4 pb-3">
            <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Connected wallet
            </p>
            <p className="mt-1.5 break-all font-mono text-xs leading-relaxed text-white">{connectedAddress}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-headline text-[10px] font-bold uppercase tracking-wide
                ${onMonad ? "border-tertiary/30 bg-tertiary/10 text-tertiary" : "border-amber-500/40 bg-amber-500/10 text-amber-200"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${onMonad ? "bg-tertiary" : "bg-amber-400"}`} aria-hidden />
                {onMonad ? "Monad testnet" : `Chain ${effectiveChainId ?? "—"}`}
              </span>
              <span className="font-mono text-xs font-semibold text-tertiary">{monLabel} MON</span>
            </div>

            {/* ── Balance breakdown ── */}
            <div className="mt-3 overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-low/60">
              {/* MON row */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                  </span>
                  <span className="font-headline text-xs font-semibold text-white">
                    {balancePending ? "…" : monLabel} <span className="text-on-surface-variant font-normal">MON</span>
                  </span>
                </div>
                <span className="font-mono text-[10px] text-on-surface-variant/70">
                  {!rateLoad && balanceWei !== undefined
                    ? formatNgn(monNum * MON_USD_PRICE * usdToNgn, { compact: true })
                    : "—"}
                </span>
              </div>
              {/* USDC row */}
              {usdcAddress && (
                <div className="flex items-center justify-between border-t border-outline-variant/10 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-tertiary/20">
                      <span className="font-mono text-[9px] font-bold text-tertiary">$</span>
                    </span>
                    <span className="font-headline text-xs font-semibold text-white">
                      {usdcBalance !== undefined
                        ? Number(formatUnits(usdcBalance, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : "—"}{" "}
                      <span className="text-on-surface-variant font-normal">USDC</span>
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-on-surface-variant/70">
                    {!rateLoad && usdcBalance !== undefined
                      ? formatNgn(usdcNum * usdToNgn, { compact: true })
                      : "—"}
                  </span>
                </div>
              )}
              {/* Total NGN row */}
              <div className="flex items-center justify-between border-t border-outline-variant/10 bg-surface-container/50 px-3 py-2">
                <span className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">
                  Total
                </span>
                <span className="font-headline text-xs font-bold text-white">
                  {rateLoad ? "…" : formatNgn(totalNgn)}
                </span>
              </div>
            </div>
            {!onMonad ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs leading-relaxed text-amber-200/80">
                  Switch to Monad testnet to buy passes and use the gate.
                </p>
                <button type="button" disabled={switchBusy} onClick={() => void onSwitchToMonad()}
                  className="w-full rounded-xl border border-primary/40 bg-primary/15 px-3 py-2 font-headline text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:opacity-60">
                  {switchBusy ? "Switching…" : "Switch to Monad testnet"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col px-1.5 py-1">
            <button type="button" className={menuItemClass} onClick={() => void copyAddress(connectedAddress)}>
              <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden>content_copy</span>
              {copied ? "Copied!" : "Copy address"}
            </button>
            <a href={explorerAddressUrl} target="_blank" rel="noopener noreferrer"
              className={menuItemClass} onClick={() => setMenuOpen(false)}>
              <span className="material-symbols-outlined text-[18px] text-tertiary" aria-hidden>open_in_new</span>
              View on MonadVision
            </a>
          </div>

          <div className="border-t border-outline-variant/20 px-1.5 py-1">
            <button type="button"
              className={`${menuItemClass} text-error hover:bg-error/10`}
              onClick={() => { setMenuOpen(false); void logout() }}>
              <span className="material-symbols-outlined text-[18px]" aria-hidden>logout</span>
              Disconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ─────────── Bottom navigation bar ─────────── */
const allBottomTabs = [
  { to: "/operators", label: "Marketplace", Icon: RoutesIcon, end: true,  gate: false, ops: false },
  { to: "/profile",  label: "Passes", Icon: PassesIcon, end: false, gate: false, ops: false },
  { to: "/conductor",label: "Gate",   Icon: GateIcon,   end: false, gate: true,  ops: false },
  { to: "/operator", label: "Ops",    Icon: OpsIcon,    end: false, gate: false, ops: true  },
  { to: "/admin",    label: "Admin",  Icon: AdminIcon,  end: false, gate: false, ops: true  },
]

function BottomNav({ showGate, showOps }: { showGate: boolean; showOps: boolean }) {
  const tabs = allBottomTabs.filter((t) => (!t.gate || showGate) && (!t.ops || showOps))
  return (
    <nav aria-label="App navigation"
      className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-surface-container-low/95 backdrop-blur-xl border-t border-outline-variant/25">
      <div className="flex h-[60px] items-stretch">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center gap-[3px] transition-colors ${
                isActive ? "text-primary" : "text-on-surface-variant/70"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`transition-transform duration-200 ${isActive ? "scale-110" : "scale-100"}`}>
                  <tab.Icon active={isActive} />
                </span>
                <span className="font-headline text-[9px] font-semibold tracking-wide uppercase">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/* ─────────── App shell ─────────── */
const desktopNavLink =
  "font-headline text-sm font-medium text-on-surface-variant transition-colors hover:text-white aria-[current=page]:text-primary"

export function AppLayout() {
  const { address } = useAccount()
  const location = useLocation()
  const isOnline = useOnlineStatus()
  const { theme, toggle: toggleTheme } = useTheme()

  // Analytics: init once, track every route change
  useEffect(() => { initAnalytics() }, [])
  useEffect(() => { trackPageView(location.pathname) }, [location.pathname])

  const restricted = env.gateWallets.size > 0
  const showGate = !restricted || Boolean(address && env.gateWallets.has(address.toLowerCase()))
  const restrictedOps = env.operatorWallets.size > 0
  const showOps = !restrictedOps || Boolean(address && env.operatorWallets.has(address.toLowerCase()))

  return (
    <div className="flex min-h-screen flex-col bg-surface text-on-surface">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-outline-variant/20 bg-surface-container-low/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-3 sm:px-8">
          {/* Logo */}
          <Link to="/" className="shrink-0 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 10h18M3 14h18M10 3v18M14 3v18" />
              </svg>
            </div>
            <span className="font-headline text-base font-bold tracking-tight text-white sm:text-lg">
              Hoppr
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
            <NavLink to="/operators" className={desktopNavLink} end>Marketplace</NavLink>
            <NavLink to="/profile" className={desktopNavLink}>My Passes</NavLink>
            {showGate && <NavLink to="/conductor" className={desktopNavLink}>Gate</NavLink>}
            {showOps && <NavLink to="/operator" className={desktopNavLink}>Operations</NavLink>}
            {showOps && <NavLink to="/admin" className={desktopNavLink}>Admin</NavLink>}
          </nav>

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="shrink-0 flex items-center justify-center rounded-xl border border-outline-variant/25 bg-surface-container p-2 text-on-surface-variant transition-colors hover:border-primary/30 hover:text-primary"
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>

          {/* Wallet */}
          <div className="ml-auto shrink-0">
            <HeaderWalletControls />
          </div>
        </div>
        {/* Gradient rule */}
        <div className="h-px w-full bg-gradient-to-r from-primary/15 via-primary/30 to-tertiary/15" aria-hidden />
      </header>

      {/* Offline banner */}
      {!isOnline && (
        <div className="sticky top-[57px] z-30 flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-2 text-center text-xs font-semibold text-black backdrop-blur-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
          </svg>
          You're offline — showing cached data. QR codes may be expired.
        </div>
      )}

      {/* Page content */}
      <main className="flex-1 px-4 py-8 pb-[calc(60px+2rem)] sm:px-8 md:py-10 md:pb-10">
        <Outlet />
      </main>

      {/* PWA install prompt (mobile only, above bottom nav) */}
      <PwaInstallBanner />

      {/* Mobile bottom nav */}
      <BottomNav showGate={showGate} showOps={showOps} />
    </div>
  )
}
