export function SoulboundBadge() {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant/50" aria-hidden>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">
        Soulbound · Non-transferable
      </span>
    </div>
  )
}
