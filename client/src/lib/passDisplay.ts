import { DEMO_ROUTES } from "../constants/demoRoutes"

/** Shorten long numeric strings for UI (e.g. token / route ids). */
export function shortenNumericId(id: string, head = 5, tail = 4): string {
  const s = String(id).replace(/\s/g, "")
  if (!s || s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

/** Match on-chain route id to demo config (name, category, etc.). */
export function routeMetaForRouteId(routeId: string | null | undefined) {
  if (routeId == null || routeId === "") return undefined
  return DEMO_ROUTES.find((r) => r.routeId === routeId)
}

/** Returns true if the ticket expires within the next `windowSec` seconds (default 24h). */
export function isExpiringSoon(
  validUntilEpoch: string | number | bigint | null | undefined,
  windowSec = 86_400,
): boolean {
  if (validUntilEpoch == null) return false
  const exp = Number(validUntilEpoch)
  if (!Number.isFinite(exp) || exp === 0) return false
  const now = Math.floor(Date.now() / 1000)
  return exp > now && exp - now <= windowSec
}
