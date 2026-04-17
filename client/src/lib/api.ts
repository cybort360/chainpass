import { env } from "./env"

export type VehicleType = "train" | "bus" | "light_rail"

/**
 * Phase 1 schedule mode.
 *
 *  'sessions'  — recurring weekly timetable (operator sets per-day sessions).
 *                Passenger picks day → session → class → pay.
 *  'flexible'  — continuous operating window, one-trip ticket (Phase 2).
 */
export type ScheduleMode = "sessions" | "flexible"

/** Per-class coach layout for interstate trains. */
export type CoachClassConfig = {
  class: "first" | "business" | "economy"
  /** Number of coaches of this class. */
  count: number
  /** Seat rows per coach. */
  rows: number
  /** Seats to the left of the aisle per row. */
  leftCols: number
  /** Seats to the right of the aisle per row. */
  rightCols: number
}

export type ApiRouteLabel = {
  routeId: string
  name: string
  detail: string | null
  category: string
  schedule?: string | null
  /**
   * 1-8 uppercase alphanumeric chars chosen by the operator at registration.
   * Rendered as a glanceable badge on pass cards + route listings so passengers
   * can tell routes apart without parsing the full decimal on-chain route ID.
   * Optional — legacy rows created before the column existed report `null`.
   */
  shortCode?: string | null
  /** Phase 1 — 'sessions' (default) or 'flexible'. Older rows may omit this. */
  scheduleMode?: ScheduleMode
  /** Phase 1 (flexible mode) — HH:MM start of the daily operating window. */
  operatingStart?: string | null
  /** Phase 1 (flexible mode) — HH:MM end of the daily operating window. */
  operatingEnd?: string | null
  vehicleType?: VehicleType | null
  isInterstate?: boolean | null
  /** Train (new-style): per-class coach layout — replaces coaches+seatsPerCoach. */
  coachClasses?: CoachClassConfig[] | null
  /** Train (legacy): flat coach count. */
  coaches?: number | null
  /** Train (legacy): seats per coach. */
  seatsPerCoach?: number | null
  /** Bus only: total seat count */
  totalSeats?: number | null
}

/** True only for interstate trains — the only route type with seat classes */
export function routeHasClasses(r: ApiRouteLabel | null | undefined): boolean {
  return r?.vehicleType === "train" && r?.isInterstate === true
}

/** True if passengers pick a specific seat (train or bus with configured seats) */
export function routeHasSeats(r: ApiRouteLabel | null | undefined): boolean {
  if (!r?.vehicleType) return false
  if (r.vehicleType === "light_rail") return false
  if (r.vehicleType === "train")
    return !!(r.coachClasses?.length) || !!(r.coaches && r.seatsPerCoach)
  if (r.vehicleType === "bus") return !!(r.totalSeats)
  return false
}

const ROUTES_CACHE_KEY = "chainpass_routes_cache"

function readRoutesCache(): ApiRouteLabel[] | null {
  try {
    const raw = localStorage.getItem(ROUTES_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ApiRouteLabel[]
  } catch { return null }
}

export async function fetchRouteLabels(): Promise<ApiRouteLabel[] | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/routes`)
    if (!res.ok) return readRoutesCache()
    const data = (await res.json()) as { routes?: ApiRouteLabel[] }
    const routes = data.routes ?? []
    // Persist for offline use
    try { localStorage.setItem(ROUTES_CACHE_KEY, JSON.stringify(routes)) } catch {}
    return routes
  } catch {
    return readRoutesCache()
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
  schedule?: string | null
  /** 1-8 uppercase alphanumeric chars — normalised + validated server-side. */
  shortCode?: string | null
  /** When set, API appends to config/nigeria-routes.json (server filesystem). */
  priceMon?: number
  vehicleType?: VehicleType | null
  isInterstate?: boolean | null
  /** New-style train seat config (per class). */
  coachClasses?: CoachClassConfig[] | null
  /** Legacy flat train config. */
  coaches?: number | null
  seatsPerCoach?: number | null
  totalSeats?: number | null
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
    if (payload.schedule !== undefined && payload.schedule !== null && String(payload.schedule).trim() !== "") {
      body.schedule = String(payload.schedule).trim()
    }
    if (payload.shortCode !== undefined && payload.shortCode !== null && String(payload.shortCode).trim() !== "") {
      body.shortCode = String(payload.shortCode).trim().toUpperCase()
    }
    if (payload.priceMon !== undefined && Number.isFinite(payload.priceMon)) {
      body.priceMon = payload.priceMon
    }
    if (payload.vehicleType) body.vehicleType = payload.vehicleType
    if (payload.isInterstate !== undefined && payload.isInterstate !== null) body.isInterstate = payload.isInterstate
    if (payload.coachClasses && payload.coachClasses.length > 0) body.coachClasses = payload.coachClasses
    if (payload.coaches) body.coaches = payload.coaches
    if (payload.seatsPerCoach) body.seatsPerCoach = payload.seatsPerCoach
    if (payload.totalSeats) body.totalSeats = payload.totalSeats
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

export type UpdateRouteLabelResult =
  | { ok: true; route: ApiRouteLabel }
  | { ok: false; status: number; error: string }

export async function updateRouteLabel(
  routeId: string,
  payload: {
    name?: string
    category?: string
    detail?: string | null
    schedule?: string | null
    /** 1-8 uppercase alphanumeric. `null` or `""` clears the code. */
    shortCode?: string | null
    /** Phase 1 — switch between 'sessions' and 'flexible' mode. */
    scheduleMode?: ScheduleMode
    /** HH:MM start of daily window (flexible mode). `null` clears. */
    operatingStart?: string | null
    /** HH:MM end of daily window (flexible mode). `null` clears. */
    operatingEnd?: string | null
  },
): Promise<UpdateRouteLabelResult> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string; route?: ApiRouteLabel }
    if (res.ok && data.route) return { ok: true, route: data.route }
    return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" }
  }
}

export type DeleteRouteLabelResult = { ok: true } | { ok: false; status: number; error: string }

export async function deleteRouteLabel(routeId: string): Promise<DeleteRouteLabelResult> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}`, {
      method: "DELETE",
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) return { ok: true }
    return { ok: false, status: res.status, error: typeof data.error === "string" ? data.error : `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" }
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

export type RouteStatItem = { routeId: string; mintCount: number }

export async function fetchRouteStats(): Promise<RouteStatItem[] | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/operator/route-stats`)
    if (!res.ok) return null
    const data = (await res.json()) as { routeStats?: RouteStatItem[] }
    return data.routeStats ?? []
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
  seat_class?: "Economy" | "Business" | null
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

// ── Admin / Operator role state ──────────────────────────────────────────────
// These endpoints replaced the old client-side chain scans that used to call
// `publicClient.getLogs()` from AdminPage.loadRoles and OperatorPage.loadBurners.
// Scanning from the browser triggered HTTP 413 on Monad's public RPC and ate
// the free-tier getLogs budget on Alchemy/QuickNode. The indexer writes the
// same events to role_events server-side and these endpoints return the latest
// state per address. Null return = endpoint unavailable (API down / indexer
// not yet populated); callers fall back to an empty list.

export type AdminRolesResponse = {
  operators: { address: string; approved: boolean }[]
  minters: { address: string; active: boolean }[]
}

export async function fetchAdminRoles(): Promise<AdminRolesResponse | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/admin/roles`)
    if (!res.ok) return null
    return (await res.json()) as AdminRolesResponse
  } catch {
    return null
  }
}

export type OperatorBurnersResponse = {
  burners: { address: string; active: boolean }[]
}

export async function fetchOperatorBurners(): Promise<OperatorBurnersResponse | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/operator/burners`)
    if (!res.ok) return null
    return (await res.json()) as OperatorBurnersResponse
  } catch {
    return null
  }
}

export async function submitRating(tokenId: string, routeId: string, rating: number): Promise<boolean> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId, routeId, rating }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { ok?: boolean }
    return data.ok === true
  } catch {
    return false
  }
}

export type RouteRating = { average: number | null; count: number }

export async function fetchRouteRating(routeId: string): Promise<RouteRating | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/ratings/${encodeURIComponent(routeId)}`)
    if (!res.ok) return null
    return (await res.json()) as RouteRating
  } catch {
    return null
  }
}

/**
 * Per-departure seat bucket — the tuple `(route_id, service_date, session_id)`
 * is what actually owns the inventory on the server. Two different buckets on
 * the same route have independent seat availability, so seat 1A on the morning
 * run and seat 1A on the evening run don't collide.
 *
 * `sessionId` is the `route_sessions.id` on the server.
 * `serviceDate` is `YYYY-MM-DD` — the concrete travel day the passenger picked.
 *
 * Both are optional — routes in `flexible` schedule mode (continuous window,
 * no timetable) still use the sentinel bucket (session=0, date=1970-01-01).
 * Passing neither is equivalent to targeting that sentinel bucket.
 */
export type SeatBucket = {
  sessionId?: number
  serviceDate?: string
}

/** Release a seat hold when the passenger deselects it. */
export async function releaseSeat(
  routeId: string,
  seatNumber: string,
  bucket?: SeatBucket,
): Promise<void> {
  try {
    await fetch(`${env.apiUrl}/api/v1/seats/reserve`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId,
        seatNumber,
        sessionId: bucket?.sessionId,
        serviceDate: bucket?.serviceDate,
      }),
    })
  } catch { /* best-effort — reservation will expire on its own */ }
}

/**
 * Temporarily hold a seat for ~10 minutes while the passenger completes payment.
 *
 * `holderAddress` is optional but strongly recommended — the server stores it
 * so the indexer can auto-promote this reservation into a permanent assignment
 * the instant the TicketMinted event is observed, even if the client's explicit
 * POST /seats call fails (tab closed, RPC glitched, etc.).
 */
export async function reserveSeat(
  routeId: string,
  seatNumber: string,
  holderAddress?: string,
  bucket?: SeatBucket,
): Promise<{ ok: boolean; conflict: boolean }> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/seats/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId,
        seatNumber,
        holderAddress,
        sessionId: bucket?.sessionId,
        serviceDate: bucket?.serviceDate,
      }),
    })
    if (res.status === 409) return { ok: false, conflict: true }
    return { ok: res.ok, conflict: false }
  } catch { return { ok: false, conflict: false } }
}

export async function fetchOccupiedSeats(
  routeId: string,
  bucket?: SeatBucket,
): Promise<string[]> {
  try {
    const params = new URLSearchParams()
    if (bucket?.sessionId !== undefined && bucket.sessionId > 0)
      params.set("sessionId", String(bucket.sessionId))
    if (bucket?.serviceDate) params.set("serviceDate", bucket.serviceDate)
    const qs = params.toString()
    const url = `${env.apiUrl}/api/v1/seats/${encodeURIComponent(routeId)}${qs ? `?${qs}` : ""}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = (await res.json()) as { occupied?: string[] }
    return data.occupied ?? []
  } catch { return [] }
}

/** Claim a seat post-mint. Retries up to `maxAttempts` times with exponential backoff. */
export async function claimSeat(
  tokenId: string,
  routeId: string,
  seatNumber: string,
  bucket?: SeatBucket,
  maxAttempts = 4,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${env.apiUrl}/api/v1/seats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId,
          routeId,
          seatNumber,
          sessionId: bucket?.sessionId,
          serviceDate: bucket?.serviceDate,
        }),
      })
      if (res.ok) return true
      // 409 = already claimed — treat as success (idempotent)
      if (res.status === 409) return true
      // 4xx (other) — don't retry
      if (res.status >= 400 && res.status < 500) return false
    } catch { /* network error — retry */ }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)) // 500ms, 1s, 2s
    }
  }
  return false
}

export async function fetchSeatAssignment(tokenId: string): Promise<string | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/seats/assignment/${encodeURIComponent(tokenId)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { seatNumber?: string | null }
    return data.seatNumber ?? null
  } catch { return null }
}

// ─── Trips ───────────────────────────────────────────────────────────────────

export type TripStatus = "scheduled" | "boarding" | "departed" | "arrived" | "cancelled"

export type ApiTrip = {
  id: number
  routeId: string
  departureAt: string   // ISO 8601
  arrivalAt: string     // ISO 8601
  status: TripStatus
  createdAt: string
}

/** Raw snake_case row from the API — normalised by tripFromRow. */
type TripRow = {
  id: number
  route_id: string
  departure_at: string
  arrival_at: string
  status: TripStatus
  created_at: string
}

function tripFromRow(row: TripRow): ApiTrip {
  return {
    id: row.id,
    routeId: row.route_id,
    departureAt: row.departure_at,
    arrivalAt: row.arrival_at,
    status: row.status,
    createdAt: row.created_at,
  }
}

export async function fetchTrips(routeId: string): Promise<ApiTrip[]> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips?routeId=${encodeURIComponent(routeId)}`)
    if (!res.ok) return []
    const data = (await res.json()) as { trips?: TripRow[] }
    return (data.trips ?? []).map(tripFromRow)
  } catch { return [] }
}

// ── Capacity ───────────────────────────────────────────────────────────────

export type RouteCapacity = {
  capacity: number | null
  sold: number
  reserved: number
  available: number | null
  soldOut: boolean
}

export async function fetchRouteCapacity(
  routeId: string,
  bucket?: SeatBucket,
): Promise<RouteCapacity | null> {
  try {
    const params = new URLSearchParams()
    if (bucket?.sessionId !== undefined && bucket.sessionId > 0)
      params.set("sessionId", String(bucket.sessionId))
    if (bucket?.serviceDate) params.set("serviceDate", bucket.serviceDate)
    const qs = params.toString()
    const url = `${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}/capacity${qs ? `?${qs}` : ""}`
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as RouteCapacity
  } catch { return null }
}

/** Fetch all trips matching a status (e.g. "boarding") — used for offline manifest pre-load. */
export async function fetchTripsByStatus(status: string): Promise<ApiTrip[]> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips?status=${encodeURIComponent(status)}`)
    if (!res.ok) return []
    const data = (await res.json()) as { trips?: TripRow[] }
    return (data.trips ?? []).map(tripFromRow)
  } catch { return [] }
}

export async function fetchTripById(tripId: number): Promise<ApiTrip | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips/${tripId}`)
    if (!res.ok) return null
    const data = (await res.json()) as { trip?: TripRow }
    return data.trip ? tripFromRow(data.trip) : null
  } catch { return null }
}

export async function fetchTripForToken(tokenId: string): Promise<ApiTrip | null> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips/token/${encodeURIComponent(tokenId)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { trip?: TripRow | null }
    return data.trip ? tripFromRow(data.trip) : null
  } catch { return null }
}

/** Fetch the full set of token IDs booked on a trip (for offline manifest caching). */
export async function fetchTripManifest(tripId: number): Promise<string[]> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips/${tripId}/manifest`)
    if (!res.ok) return []
    const data = (await res.json()) as { tokenIds?: string[] }
    return data.tokenIds ?? []
  } catch { return [] }
}

export type CreateTripResult =
  | { ok: true; trip: ApiTrip }
  | { ok: false; error: string }

export async function createTrip(payload: {
  routeId: string
  departureAt: string
  arrivalAt: string
}): Promise<CreateTripResult> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routeId: payload.routeId,
        departureAt: payload.departureAt,
        arrivalAt: payload.arrivalAt,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { trip?: TripRow; error?: string }
    if (res.ok && data.trip) return { ok: true, trip: tripFromRow(data.trip) }
    return { ok: false, error: data.error ?? `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" }
  }
}

export async function updateTripStatus(
  tripId: number,
  status: TripStatus,
): Promise<{ ok: true; trip: ApiTrip } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips/${tripId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    const data = (await res.json().catch(() => ({}))) as { trip?: TripRow; error?: string }
    if (res.ok && data.trip) return { ok: true, trip: tripFromRow(data.trip) }
    return { ok: false, error: data.error ?? `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" }
  }
}

export async function deleteTrip(tripId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips/${tripId}`, { method: "DELETE" })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) return { ok: true }
    return { ok: false, error: data.error ?? `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" }
  }
}

/** Link a minted token to the trip it was purchased for. Called post-mint. */
export async function linkTokenToTrip(
  tokenId: string,
  tripId: number,
  routeId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/trips/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId, tripId, routeId }),
    })
    return res.ok
  } catch { return false }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — weekly session templates (schedule_mode = 'sessions')
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A recurring weekly session on a route.
 *
 * dayOfWeek uses 0 = Monday … 6 = Sunday — chosen to match how the operator UI
 * displays the week (Mon first). We deliberately do not use Postgres `EXTRACT
 * dow` ordering (0 = Sunday) to keep server + client math trivially aligned.
 */
export type RouteSession = {
  id: number
  routeId: string
  dayOfWeek: number
  name: string
  /** HH:MM 24-hour local time. */
  departure: string
  arrival: string
}

export async function fetchRouteSessions(routeId: string): Promise<RouteSession[]> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}/sessions`)
    if (!res.ok) return []
    const data = (await res.json()) as { sessions?: RouteSession[] }
    return Array.isArray(data.sessions) ? data.sessions : []
  } catch {
    return []
  }
}

export type SessionMutationResult =
  | { ok: true; session: RouteSession }
  | { ok: false; status: number; error: string }

export async function createRouteSession(
  routeId: string,
  payload: { dayOfWeek: number; name: string; departure: string; arrival: string },
): Promise<SessionMutationResult> {
  try {
    const res = await fetch(`${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => ({}))) as { session?: RouteSession; error?: string }
    if (res.ok && data.session) return { ok: true, session: data.session }
    return { ok: false, status: res.status, error: data.error ?? `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" }
  }
}

export async function updateRouteSession(
  routeId: string,
  sessionId: number,
  payload: Partial<{ dayOfWeek: number; name: string; departure: string; arrival: string }>,
): Promise<SessionMutationResult> {
  try {
    const res = await fetch(
      `${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}/sessions/${sessionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    )
    const data = (await res.json().catch(() => ({}))) as { session?: RouteSession; error?: string }
    if (res.ok && data.session) return { ok: true, session: data.session }
    return { ok: false, status: res.status, error: data.error ?? `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" }
  }
}

export async function deleteRouteSession(
  routeId: string,
  sessionId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(
      `${env.apiUrl}/api/v1/routes/${encodeURIComponent(routeId)}/sessions/${sessionId}`,
      { method: "DELETE" },
    )
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) return { ok: true }
    return { ok: false, status: res.status, error: data.error ?? `request failed (${res.status})` }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" }
  }
}
