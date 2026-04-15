import { DEMO_ROUTES } from "../constants/demoRoutes"
import type { ApiRouteLabel } from "./api"

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

/**
 * Resolve display name + short code for an on-chain route id against both the
 * operator-registered API catalog AND the built-in demo routes.
 *
 * Why it exists: pass cards only had access to DEMO_ROUTES, so any ticket for
 * an operator-registered route fell through to "Route 11770…6329" even though
 * the name was sitting right there in the GET /routes response. Pass whatever
 * API labels you already have loaded; missing/empty arrays fold gracefully.
 *
 * Falls back to a shortened numeric id when nothing matches — preserves the
 * previous behaviour instead of showing a blank line for tickets whose route
 * was deleted server-side or predates the API catalog entirely.
 */
export function resolveRouteDisplay(
  routeId: string | null | undefined,
  apiLabels?: Pick<ApiRouteLabel, "routeId" | "name" | "shortCode">[] | null,
): { name: string; shortCode: string | null } {
  if (routeId == null || routeId === "") {
    return { name: "Transit pass", shortCode: null }
  }
  const fromApi = apiLabels?.find((r) => r.routeId === routeId)
  if (fromApi) {
    return { name: fromApi.name, shortCode: fromApi.shortCode ?? null }
  }
  const demo = DEMO_ROUTES.find((r) => r.routeId === routeId)
  if (demo) {
    return { name: demo.name, shortCode: null }
  }
  return { name: `Route ${shortenNumericId(routeId)}`, shortCode: null }
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
