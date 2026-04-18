/** Returns "train" for rail/metro routes, "bus" for everything else */
function transportType(category: string, name: string): "train" | "bus" {
  const haystack = `${category} ${name}`.toLowerCase()
  if (/train|rail|metro|lrt|brt rail|blue line|red line|green line/.test(haystack)) return "train"
  return "bus"
}

export function TransportIcon({ category, name, className }: { category: string; name: string; className?: string }) {
  const type = transportType(category, name)
  if (type === "train") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        className={className} aria-hidden>
        <rect x="4" y="3" width="16" height="13" rx="3" />
        <path d="M8 16l-2 4M16 16l2 4M8 20h8" />
        <circle cx="9" cy="13" r="1" />
        <circle cx="15" cy="13" r="1" />
        <line x1="4" y1="8" x2="20" y2="8" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden>
      <rect x="1" y="6" width="22" height="13" rx="2" />
      <path d="M6 6V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
      <circle cx="7" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
      <line x1="12" y1="6" x2="12" y2="19" />
    </svg>
  )
}
