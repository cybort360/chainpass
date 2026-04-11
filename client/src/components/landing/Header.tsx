import { useCallback, useEffect, useId, useState } from "react"
import { Link } from "react-router-dom"

const nav = [
  { href: "#how-it-works", label: "How it Works" },
  { href: "#why-monad", label: "Why Monad" },
  { href: "#features", label: "Features" },
  { href: "#operators", label: "Operators" },
]

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

export function Header() {
  const [open, setOpen] = useState(false)
  const menuPanelId = useId()
  const menuTitleId = useId()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  return (
    <header className="fixed top-0 z-50 w-full">
      <div className="relative border-b border-white/[0.08] bg-surface-container-low/55 shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.07)] backdrop-blur-2xl backdrop-saturate-150">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12">
          <a
            href="#"
            className="shrink-0 font-headline text-xl font-bold tracking-tighter text-white sm:text-2xl"
          >
            ChainPass
          </a>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-x-5 md:flex md:gap-x-8 lg:gap-x-10">
            {nav.map((l) => (
              <a
                key={l.href}
                className="font-headline text-sm font-medium text-zinc-300 transition-colors hover:text-white sm:text-base"
                href={l.href}
              >
                {l.label}
              </a>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              to="/routes"
              className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 font-headline text-sm font-bold text-on-primary transition-all hover:bg-primary-container hover:shadow-[0_0_20px_rgba(110,84,255,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-95 sm:px-7 sm:py-2 sm:text-base"
            >
              Get Started
            </Link>

            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-600/80 text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/80 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:hidden"
              aria-expanded={open}
              aria-controls={menuPanelId}
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
            </button>
          </div>
        </nav>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[60] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby={menuTitleId}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={close}
          />
          <div
            id={menuPanelId}
            className="absolute right-0 top-0 flex h-full w-[min(100%,20rem)] flex-col border-l border-zinc-700/80 bg-[#14141c] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zinc-700/60 px-4 py-4">
              <p id={menuTitleId} className="font-headline text-lg font-semibold text-white">
                Menu
              </p>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Close menu"
                onClick={close}
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
              {nav.map((l) => (
                <a
                  key={l.href}
                  className="rounded-xl px-4 py-3.5 font-headline text-base font-medium text-zinc-200 transition-colors hover:bg-zinc-800/90 hover:text-white"
                  href={l.href}
                  onClick={close}
                >
                  {l.label}
                </a>
              ))}
              <Link
                to="/routes"
                className="mt-4 rounded-xl bg-primary px-4 py-3.5 text-center font-headline text-base font-bold text-on-primary hover:bg-primary-container"
                onClick={close}
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="h-1 w-full bg-gradient-to-r from-primary/15 via-monad-deep/40 to-tertiary/25 shadow-[0_2px_16px_rgba(110,84,255,0.18)]"
        aria-hidden
      />
    </header>
  )
}
