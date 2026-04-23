import { useState } from "react"
import { usePwaInstall } from "../hooks/usePwaInstall"

export function PwaInstallBanner() {
  const { canInstall, install } = usePwaInstall()
  const [dismissed, setDismissed] = useState(false)
  if (!canInstall || dismissed) return null
  return (
    <div className="fixed bottom-[60px] inset-x-0 z-30 md:hidden px-4 pb-2">
      <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-surface-container-low/95 backdrop-blur-md px-4 py-3 shadow-lg">
        {/* Hoppr icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10h18M3 14h18M10 3v18M14 3v18" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-headline text-xs font-bold text-white">Add Hoppr to home screen</p>
          <p className="text-[10px] text-on-surface-variant">For faster access to your passes</p>
        </div>
        <button onClick={() => void install()} className="shrink-0 rounded-xl bg-primary px-3 py-1.5 font-headline text-xs font-bold text-white">
          Install
        </button>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-on-surface-variant/50 hover:text-white">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
