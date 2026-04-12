import { isExpiringSoon } from "../../lib/passDisplay"

interface Props {
  validUntilEpoch: string | number | bigint | null | undefined
  variant?: "banner" | "badge"
}

function relativeTime(epoch: string | number | bigint): string {
  const diffSec = Number(epoch) - Math.floor(Date.now() / 1000)
  if (diffSec <= 0) return "very soon"
  const h = Math.floor(diffSec / 3600)
  const m = Math.floor((diffSec % 3600) / 60)
  if (h > 0) return `in ${h}h ${m}m`
  return `in ${m}m`
}

export function ExpiryWarningBanner({ validUntilEpoch, variant = "banner" }: Props) {
  if (!isExpiringSoon(validUntilEpoch)) return null

  if (variant === "badge") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-wide text-amber-400">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Expires soon
      </span>
    )
  }

  return (
    <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-400" aria-hidden>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <p className="text-xs font-semibold text-amber-400">
        This ticket expires {relativeTime(validUntilEpoch!)} — use it soon.
      </p>
    </div>
  )
}
