/** Loading skeleton for one row in the operator directory list. */
export function OperatorRowSkeleton() {
  return (
    <div className="flex items-stretch gap-3 rounded-2xl border border-outline-variant/15 bg-surface-container p-4 animate-pulse">
      {/* Logo placeholder */}
      <div className="h-14 w-14 shrink-0 rounded-xl bg-on-surface-variant/10" />
      <div className="flex flex-1 flex-col gap-2 justify-center">
        {/* Title + count row */}
        <div className="flex items-center justify-between">
          <div className="h-3 w-1/3 rounded bg-on-surface-variant/20" />
          <div className="h-3 w-16 rounded bg-on-surface-variant/10" />
        </div>
        {/* Subtitle */}
        <div className="h-2.5 w-1/2 rounded bg-on-surface-variant/10" />
        {/* Pill */}
        <div className="h-4 w-14 rounded-full bg-on-surface-variant/10" />
      </div>
    </div>
  )
}
