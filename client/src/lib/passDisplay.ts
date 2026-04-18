import type { ApiRouteLabel } from "./api"

/** Shorten long numeric strings for UI (e.g. token / route ids). */
export function shortenNumericId(id: string, head = 5, tail = 4): string {
  const s = String(id).replace(/\s/g, "")
  if (!s || s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

/**
 * Look up the operator-registered label for an on-chain route id.
 *
 * Returns `undefined` when the route isn't (yet) in the API catalog — e.g.
 * the ticket was minted against a route that the operator has since deleted,
 * or the catalog hasn't loaded. Callers are expected to fall back gracefully
 * (see `resolveRouteDisplay` below).
 */
export function routeMetaForRouteId(
  routeId: string | null | undefined,
  apiLabels?: Pick<ApiRouteLabel, "routeId" | "name" | "category">[] | null,
): Pick<ApiRouteLabel, "routeId" | "name" | "category"> | undefined {
  if (routeId == null || routeId === "") return undefined
  return apiLabels?.find((r) => r.routeId === routeId)
}

/**
 * Resolve display name + short code for an on-chain route id against the
 * operator-registered API catalog.
 *
 * Pass whatever API labels you already have loaded; missing/empty arrays
 * fold gracefully to a shortened numeric id so tickets whose route isn't
 * in the catalog (deleted, not yet loaded, predates the catalog) still
 * show something human-readable instead of a blank line.
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
