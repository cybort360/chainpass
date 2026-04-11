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
