import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { usePrivy, useWallets } from "@privy-io/react-auth"
import { useQuery } from "@tanstack/react-query"
import { Link, NavLink, Outlet } from "react-router-dom"
import { createPublicClient, formatEther, http } from "viem"
import type { Address } from "viem"
import { useAccount, useSwitchChain } from "wagmi"
import { monadTestnet } from "@chainpass/shared"
import { pickEthereumAddressFromUser } from "../lib/privyWallet"
import { switchToMonadTestnet } from "../lib/switchToMonadTestnet"

/** Privy reports chain as CAIP-2 (e.g. `eip155:10143`). */
function caip2ToChainId(caip: string | undefined): number | undefined {
  if (!caip) return undefined
  const m = /^eip155:(\d+)$/.exec(caip)
  return m ? Number(m[1]) : undefined
}

const monadPublicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
})

const navLink =
  "font-headline text-sm font-medium text-on-surface-variant transition-colors hover:text-white aria-[current=page]:text-primary"

const navLinkDrawer =
  "rounded-xl px-4 py-3.5 font-headline text-base font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high/80 hover:text-white aria-[current=page]:bg-primary/15 aria-[current=page]:text-primary"

/** Primary CTA — matches wallet chip / Connect (no drop shadow). */
const walletPurpleBtn =
  "btn-primary-gradient border border-white/20 font-headline text-sm font-medium text-white transition-[filter] hover:brightness-[1.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-low disabled:cursor-not-allowed disabled:opacity-55"

function formatMonDisplay(value: bigint | undefined, isPending: boolean): string {
  if (isPending) return "…"
  if (value === undefined) return "—"
  const n = Number(formatEther(value))
  if (!Number.isFinite(n)) return "—"
  if (n === 0) return "0"
  if (n > 0 && n < 1e-4) return "<0.0001"
  return n.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 0 })
}

function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className ?? ""} size-4 shrink-0 transition-transform duration-200 sm:size-[18px] ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HeaderWalletControls() {
  const { ready, authenticated, login, logout, user, linkWallet } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const firstEthWallet = useMemo(
    () => wallets.find((w) => w.type === "ethereum"),
    [wallets],
  )
  const addressFromUser = useMemo(() => pickEthereumAddressFromUser(user), [user])
  const connectedAddress = (firstEthWallet?.address ?? addressFromUser) as Address | undefined
  const walletChainId = useMemo(
    () => caip2ToChainId(firstEthWallet?.chainId),
    [firstEthWallet?.chainId],
  )
  const { chainId: accountChainId } = useAccount()
  /** Wagmi reflects the injected wallet once synced; Privy CAIP chain can lag or be missing. */
  const effectiveChainId = accountChainId ?? walletChainId
  const onMonad = effectiveChainId === monadTestnet.id

  const { switchChainAsync, isPending: wagmiSwitchPending } = useSwitchChain()
  const [switchPending, setSwitchPending] = useState(false)

  const onSwitchToMonad = useCallback(async () => {
    setSwitchPending(true)
    try {
      await switchToMonadTestnet({
        privyEthWallet: firstEthWallet,
        wagmiSwitchChain: switchChainAsync,
      })
    } catch {
      /* extension may reject; add/switch still surfaces in wallet UI */
    } finally {
      setSwitchPending(false)
    }
  }, [firstEthWallet, switchChainAsync])

  const switchBusy = switchPending || wagmiSwitchPending

  const { data: balanceWei, isPending: balancePending } = useQuery({
    queryKey: ["header-native-balance", monadTestnet.id, connectedAddress],
    queryFn: () => monadPublicClient.getBalance({ address: connectedAddress! }),
    enabled: Boolean(authenticated && connectedAddress),
  })
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menuOpen])

  const copyAddress = useCallback(async (a: string) => {
    try {
      await navigator.clipboard.writeText(a)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [])

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        className={`${walletPurpleBtn} flex h-9 shrink-0 cursor-wait items-center justify-center rounded-xl px-4 opacity-90 sm:h-10 sm:px-5`}
        aria-busy
      >
        Connecting…
      </button>
    )
  }

  if (!authenticated) {
    return (
      <button
        type="button"
        className={`${walletPurpleBtn} flex h-9 shrink-0 items-center justify-center rounded-xl px-4 sm:h-10 sm:px-5`}
        onClick={() => void login()}
      >
        Connect
      </button>
    )
  }

  if (!connectedAddress) {
    if (!walletsReady) {
      return (
        <button
          type="button"
          disabled
          className={`${walletPurpleBtn} flex h-9 shrink-0 cursor-wait items-center justify-center rounded-xl px-4 opacity-90 sm:h-10 sm:px-5`}
          aria-busy
        >
          Connecting…
        </button>
      )
    }
    return (
      <button
        type="button"
        className={`${walletPurpleBtn} flex h-9 shrink-0 items-center justify-center rounded-xl px-4 sm:h-10 sm:px-5`}
        onClick={() => linkWallet()}
      >
        Connect wallet
      </button>
    )
  }

  const monLabel = formatMonDisplay(balanceWei, balancePending)
  const explorerAddressUrl = `${monadTestnet.blockExplorers.default.url}/address/${connectedAddress}`

  const menuItemClass =
    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left font-headline text-sm text-on-surface transition-colors hover:bg-surface-container-high/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"

  return (
    <div
      ref={containerRef}
      className="relative flex max-w-[min(100%,calc(100vw-9.5rem))] min-w-0 items-stretch gap-1.5 md:max-w-[22rem] lg:max-w-none"
    >
      <button
        type="button"
        className={`${walletPurpleBtn} flex h-9 max-w-full min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2 pr-1.5 text-left sm:h-10 sm:gap-2 sm:rounded-2xl sm:px-3 sm:pr-2`}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        aria-controls={walletMenuId}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-row flex-wrap items-center gap-x-1.5 gap-y-0 sm:gap-x-3">
            <span
              className="min-w-0 max-w-[7rem] truncate font-mono text-[11px] font-medium tabular-nums tracking-tight text-white sm:max-w-none sm:text-[13px]"
              title={connectedAddress}
            >
              {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
            </span>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-px font-headline text-[9px] font-semibold uppercase tracking-wider sm:rounded-lg sm:px-2 sm:py-0.5 sm:text-[10px] ${
                  onMonad
                    ? "border-white/35 bg-white/15 text-white"
                    : "border-amber-200/50 bg-amber-400/25 text-amber-50"
                }`}
                title={onMonad ? "Monad testnet" : `Wrong network (chain ${effectiveChainId ?? "?"})`}
              >
                {onMonad ? "Monad" : "Off"}
              </span>
              <span className="hidden h-3.5 w-px shrink-0 bg-white/25 sm:block" aria-hidden />
              <span className="inline-flex items-baseline gap-0.5 font-mono text-[10px] tabular-nums tracking-tight text-white sm:gap-1 sm:text-xs">
                <span className="font-semibold text-tertiary">{monLabel}</span>
                <span className="text-white/75 sm:hidden">M</span>
                <span className="hidden text-white/75 sm:inline">MON</span>
              </span>
            </div>
          </div>
        </div>
        <ChevronIcon className="text-white/90" open={menuOpen} />
      </button>
      {!onMonad ? (
        <button
          type="button"
          disabled={switchBusy}
          onClick={() => void onSwitchToMonad()}
          className="btn-primary-gradient shrink-0 rounded-xl border border-primary/45 px-2.5 font-headline text-[10px] font-semibold uppercase tracking-wide text-white transition-[filter] hover:brightness-[1.06] disabled:opacity-50 sm:px-3 sm:text-xs"
        >
          {switchBusy ? "…" : "Switch"}
        </button>
      ) : null}

      {menuOpen ? (
        <div
          id={walletMenuId}
          role="dialog"
          aria-label="Wallet"
          className="absolute right-0 top-full z-[60] mt-1.5 w-[min(calc(100vw-2.5rem),20rem)] rounded-2xl border border-outline-variant/40 bg-surface-container py-2 shadow-xl shadow-black/40 ring-1 ring-white/[0.06]"
        >
          <div className="border-b border-outline-variant/25 px-3 pb-3 pt-2">
            <p className="font-headline text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Connected wallet
            </p>
            <p className="mt-1 break-all font-mono text-xs leading-snug text-white">{connectedAddress}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-md border px-2 py-0.5 font-headline text-[10px] font-semibold uppercase tracking-wide ${
                  onMonad
                    ? "border-primary/35 bg-primary/10 text-primary"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-100"
                }`}
              >
                {onMonad ? "Monad testnet" : `Chain ${effectiveChainId ?? "—"}`}
              </span>
              <span className="font-mono text-xs text-tertiary">
                {monLabel} MON
              </span>
            </div>
            {!onMonad ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs leading-relaxed text-amber-200/90">
                  Wrong network — switch to Monad testnet to buy passes and use the gate.
                </p>
                <button
                  type="button"
                  disabled={switchBusy}
                  onClick={() => void onSwitchToMonad()}
                  className="w-full rounded-xl border border-primary/40 bg-primary/15 px-3 py-2.5 font-headline text-sm font-semibold text-primary transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {switchBusy ? "Switching…" : "Switch to Monad testnet"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col p-1.5">
            <button
              type="button"
              className={menuItemClass}
              onClick={() => void copyAddress(connectedAddress)}
            >
              <span className="material-symbols-outlined text-lg text-primary" aria-hidden>
                content_copy
              </span>
              {copied ? "Copied address" : "Copy address"}
            </button>
            <a
              href={explorerAddressUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={menuItemClass}
              onClick={() => setMenuOpen(false)}
            >
              <span className="material-symbols-outlined text-lg text-tertiary" aria-hidden>
                open_in_new
              </span>
              View on MonadVision
            </a>
          </div>

          <div className="border-t border-outline-variant/25 p-1.5">
            <button
              type="button"
              className={`${menuItemClass} text-error hover:bg-error/10`}
              onClick={() => {
                setMenuOpen(false)
                void logout()
              }}
            >
              <span className="material-symbols-outlined text-lg" aria-hidden>
                logout
              </span>
              Disconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuPanelId = useId()
  const menuTitleId = useId()

  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menuOpen, closeMenu])

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [menuOpen])

  return (
    <div className="flex min-h-screen flex-col bg-surface text-on-surface">
      <header className="sticky top-0 z-40 border-b border-outline-variant/25 bg-surface-container-low/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-nowrap items-center gap-x-3 gap-y-3 px-5 py-3.5 sm:px-8">
          <Link to="/" className="shrink-0 font-headline text-lg font-bold tracking-tight text-white sm:text-xl">
            ChainPass
          </Link>
          <nav className="hidden min-w-0 flex-1 flex-wrap items-center justify-center gap-x-5 gap-y-1 sm:gap-x-8 md:flex">
            <NavLink to="/routes" className={navLink} end>
              Routes
            </NavLink>
            <NavLink to="/profile" className={navLink}>
              My passes
            </NavLink>
            <NavLink to="/conductor" className={navLink}>
              Gate
            </NavLink>
            <NavLink to="/operator" className={navLink}>
              Operations
            </NavLink>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 [&_button]:!font-headline [&_button]:!text-sm">
            <HeaderWalletControls />
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant/40 bg-surface-container-high/40 text-on-surface-variant transition-colors hover:border-outline-variant hover:bg-surface-container-high/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:h-10 sm:w-10 md:hidden"
              aria-expanded={menuOpen}
              aria-controls={menuPanelId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
            </button>
          </div>
        </div>
        <div
          className="h-px w-full bg-gradient-to-r from-primary/20 via-monad-deep/30 to-tertiary/20"
          aria-hidden
        />
      </header>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby={menuTitleId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={closeMenu}
          />
          <div
            id={menuPanelId}
            className="absolute right-0 top-0 flex h-full w-[min(100%,20rem)] flex-col border-l border-outline-variant/40 bg-surface-container-low shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-outline-variant/30 px-4 py-4">
              <p id={menuTitleId} className="font-headline text-lg font-semibold text-white">
                Menu
              </p>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high/80 hover:text-white"
                aria-label="Close menu"
                onClick={closeMenu}
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              <NavLink to="/routes" className={navLinkDrawer} end onClick={closeMenu}>
                Routes
              </NavLink>
              <NavLink to="/profile" className={navLinkDrawer} onClick={closeMenu}>
                My passes
              </NavLink>
              <NavLink to="/conductor" className={navLinkDrawer} onClick={closeMenu}>
                Gate
              </NavLink>
              <NavLink to="/operator" className={navLinkDrawer} onClick={closeMenu}>
                Operations
              </NavLink>
            </nav>
          </div>
        </div>
      ) : null}

      <main className="flex-1 px-5 py-10 sm:px-8">
        <Outlet />
      </main>
    </div>
  )
}
