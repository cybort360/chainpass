import { env } from "./env"

export type ApiRouteLabel = {
  routeId: string
  name: string
  detail: string | null
  category: string
}

export async function fetchRouteLabels(): Promise<ApiRouteLabel[] | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/routes`)
    if (!res.ok) return null
    const data = (await res.json()) as { routes?: ApiRouteLabel[] }
    return data.routes ?? []
  } catch {
    return null
  }
}

export type RegisterRouteLabelResult =
  | {
      ok: true
      route: ApiRouteLabel
      nigeriaRoutesFile?: { ok: true } | { ok: false; reason: string }
    }
  | { ok: false; status: number; error: string }

/** Register a new route label (insert-only). Requires API + DATABASE_URL. */
export async function registerRouteLabel(payload: {
  routeId: string
  name: string
  category: string
  detail?: string | null
  /** When set, API appends to config/nigeria-routes.json (server filesystem). */
  priceMon?: number
}): Promise<RegisterRouteLabelResult> {
  try {
    const body: Record<string, unknown> = {
      routeId: payload.routeId.trim(),
      name: payload.name.trim(),
      category: payload.category.trim(),
    }
    if (payload.detail !== undefined && payload.detail !== null && String(payload.detail).trim() !== "") {
      body.detail = String(payload.detail).trim()
    }
    if (payload.priceMon !== undefined && Number.isFinite(payload.priceMon)) {
      body.priceMon = payload.priceMon
    }
    const res = await fetch(`${env.apiUrl}/api/v1/routes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      route?: ApiRouteLabel
      nigeriaRoutesFile?: { ok: true } | { ok: false; reason: string }
    }
    if (res.ok && data.route) {
      return {
        ok: true,
        route: data.route,
        ...(data.nigeriaRoutesFile !== undefined ? { nigeriaRoutesFile: data.nigeriaRoutesFile } : {}),
      }
    }
    return {
      ok: false,
      status: res.status,
      error: typeof data.error === "string" ? data.error : `request failed (${res.status})`,
    }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : "network error",
    }
  }
}

export type OperatorStats = {
  totals: { mint: number; burn: number }
  last24h: { mint: number; burn: number }
  totalInflowWei?: string
}

export async function fetchOperatorStats(): Promise<OperatorStats | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/operator/stats`)
    if (!res.ok) return null
    return (await res.json()) as OperatorStats
  } catch {
    return null
  }
}

export type TimeseriesBucket = {
  bucket: string
  mints: number
  burns: number
  inflow_wei: string
}

export async function fetchOperatorTimeseries(period: "24h" | "7d" | "30d"): Promise<TimeseriesBucket[] | null> {
  try {
    const q = new URLSearchParams({ period })
    const res = await fetch(`${env.apiUrl}/api/v1/operator/timeseries?${q.toString()}`)
    if (!res.ok) return null
    const data = (await res.json()) as { buckets?: TimeseriesBucket[] }
    return data.buckets ?? []
  } catch {
    return null
  }
}

export type OperatorEventRow = {
  id: string
  event_type: string
  tx_hash: string
  token_id: string
  route_id: string
  block_number: string
  from_address: string | null
  to_address: string | null
  created_at: string
}

export async function fetchOperatorEvents(): Promise<OperatorEventRow[] | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/operator/events`)
    if (!res.ok) return null
    const data = (await res.json()) as { events?: OperatorEventRow[] }
    return data.events ?? []
  } catch {
    return null
  }
}

export type QrPayload = {
  tokenId: string
  holder: `0x${string}`
  exp: number
  signature: string
}

export async function requestQrPayload(tokenId: string, holder: `0x${string}`): Promise<QrPayload | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/qr/payload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId, holder }),
    })
    if (!res.ok) return null
    return (await res.json()) as QrPayload
  } catch {
    return null
  }
}

export async function verifyQrPayload(body: QrPayload): Promise<boolean | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/qr/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { valid?: boolean }
    return data.valid ?? null
  } catch {
    return null
  }
}

/** Row shape from `ticket_events` (API returns snake_case columns). */
export type RiderPassEventRow = {
  id: number
  event_type: string
  tx_hash: string
  token_id: string
  route_id: string | null
  block_number: string
  valid_until_epoch: string | null
  created_at: string
}

export type MyPassesResponse = {
  holder: `0x${string}`
  active: RiderPassEventRow[]
  used: RiderPassEventRow[]
}

export async function fetchMyPasses(holder: `0x${string}`): Promise<MyPassesResponse | null> {
  try {
    const q = new URLSearchParams({ holder })
    const res = await fetch(`${env.apiUrl}/api/v1/rider/passes?${q.toString()}`)
    if (!res.ok) return null
    return (await res.json()) as MyPassesResponse
  } catch {
    return null
  }
}
