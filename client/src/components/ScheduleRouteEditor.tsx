import { useCallback, useEffect, useMemo, useState } from "react"
import {
  createRouteSession,
  deleteRouteSession,
  fetchRouteSessions,
  updateRouteLabel,
  updateRouteSession,
  type ApiRouteLabel,
  type RouteSession,
  type ScheduleMode,
} from "../lib/api"

/**
 * Operator-side schedule editor — compact, day-tab UI that keeps everything
 * in a single card so it stays readable even with seven days of sessions.
 *
 * Phase 1 behaviour
 * -----------------
 * - Mode toggle shows both 'sessions' and 'flexible'. Flexible is wired end-to-end
 *   on the server (columns persist) but the passenger UI doesn't consume it yet —
 *   the toggle is present now so operators can see the roadmap and we don't have
 *   to reshape the UI later.
 * - Days use 0 = Monday … 6 = Sunday to match how operators read a timetable.
 * - We optimistically refetch after each mutation instead of splicing state; the
 *   payload is small (~7 × few sessions) so it's simpler than reconciling diffs.
 */

type Props = {
  routes: ApiRouteLabel[]
  /** Called when scheduleMode on a route changes, so the parent can refetch. */
  onRouteUpdated?: () => void
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const HHMM = /^[0-2][0-9]:[0-5][0-9]$/

const inputClass =
  "mt-1 w-full rounded-lg border border-outline-variant/20 bg-surface px-3 py-2 font-body text-sm text-white placeholder-on-surface-variant/40 focus:border-primary/60 focus:outline-none"

const labelCaption =
  "font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/70"

export function ScheduleRouteEditor({ routes, onRouteUpdated }: Props) {
  const [selectedRouteId, setSelectedRouteId] = useState<string>("")
  const [mode, setMode] = useState<ScheduleMode>("sessions")
  const [operatingStart, setOperatingStart] = useState<string>("")
  const [operatingEnd, setOperatingEnd] = useState<string>("")
  const [selectedDay, setSelectedDay] = useState<number>(0)
  const [sessions, setSessions] = useState<RouteSession[]>([])
  const [loading, setLoading] = useState(false)
  const [savingMode, setSavingMode] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Add-session form state
  const [newName, setNewName] = useState("")
  const [newDep, setNewDep] = useState("")
  const [newArr, setNewArr] = useState("")
  const [adding, setAdding] = useState(false)

  // Auto-pick first route on mount / when routes load
  useEffect(() => {
    if (!selectedRouteId && routes.length > 0) {
      setSelectedRouteId(routes[0].routeId)
    }
  }, [routes, selectedRouteId])

  // Sync local mode state from the current route's stored mode
  const selectedRoute = useMemo(
    () => routes.find((r) => r.routeId === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  )
  useEffect(() => {
    if (!selectedRoute) return
    setMode((selectedRoute.scheduleMode as ScheduleMode | undefined) ?? "sessions")
    setOperatingStart(selectedRoute.operatingStart ?? "")
    setOperatingEnd(selectedRoute.operatingEnd ?? "")
  }, [selectedRoute])

  const refetch = useCallback(async (rid: string) => {
    if (!rid) { setSessions([]); return }
    setLoading(true)
    try {
      const rows = await fetchRouteSessions(rid)
      setSessions(rows)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refetch(selectedRouteId) }, [selectedRouteId, refetch])

  // Group sessions by day, sorted by departure
  const byDay = useMemo(() => {
    const m = new Map<number, RouteSession[]>()
    for (let i = 0; i < 7; i++) m.set(i, [])
    for (const s of sessions) {
      const list = m.get(s.dayOfWeek)
      if (list) list.push(s)
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.departure < b.departure ? -1 : a.departure > b.departure ? 1 : 0))
    }
    return m
  }, [sessions])

  const daySessions = byDay.get(selectedDay) ?? []

  const persistMode = useCallback(async (
    nextMode: ScheduleMode,
    opts?: { start?: string; end?: string },
  ): Promise<void> => {
    if (!selectedRouteId) return
    setSavingMode(true)
    setMsg(null)
    try {
      const payload: Parameters<typeof updateRouteLabel>[1] = { scheduleMode: nextMode }
      if (opts?.start !== undefined) payload.operatingStart = opts.start === "" ? null : opts.start
      if (opts?.end !== undefined) payload.operatingEnd = opts.end === "" ? null : opts.end
      const res = await updateRouteLabel(selectedRouteId, payload)
      if (!res.ok) {
        setMsg(res.error)
        return
      }
      onRouteUpdated?.()
    } finally {
      setSavingMode(false)
    }
  }, [selectedRouteId, onRouteUpdated])

  const onSelectMode = (next: ScheduleMode) => {
    if (next === mode) return
    setMode(next)
    void persistMode(next)
  }

  const saveOperatingWindow = () => {
    // Basic validation — server will also reject, but fail fast for UX.
    if (operatingStart && !HHMM.test(operatingStart)) { setMsg("Start must be HH:MM"); return }
    if (operatingEnd && !HHMM.test(operatingEnd)) { setMsg("End must be HH:MM"); return }
    if (operatingStart && operatingEnd && operatingStart >= operatingEnd) {
      setMsg("Start must be earlier than end"); return
    }
    void persistMode(mode, { start: operatingStart, end: operatingEnd })
  }

  const addSession = async () => {
    const name = newName.trim()
    if (!name || !HHMM.test(newDep) || !HHMM.test(newArr)) {
      setMsg("Fill name + both times (HH:MM)")
      return
    }
    setAdding(true)
    setMsg(null)
    try {
      const res = await createRouteSession(selectedRouteId, {
        dayOfWeek: selectedDay,
        name,
        departure: newDep,
        arrival: newArr,
      })
      if (!res.ok) { setMsg(res.error); return }
      setNewName(""); setNewDep(""); setNewArr("")
      await refetch(selectedRouteId)
    } finally {
      setAdding(false)
    }
  }

  const removeSession = async (id: number) => {
    setMsg(null)
    const res = await deleteRouteSession(selectedRouteId, id)
    if (!res.ok) { setMsg(res.error); return }
    await refetch(selectedRouteId)
  }

  // Inline edit — bind updates to a small state rather than individual refs
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editDep, setEditDep] = useState("")
  const [editArr, setEditArr] = useState("")
  const startEdit = (s: RouteSession) => {
    setEditingId(s.id); setEditName(s.name); setEditDep(s.departure); setEditArr(s.arrival); setMsg(null)
  }
  const cancelEdit = () => { setEditingId(null) }
  const saveEdit = async () => {
    if (editingId === null) return
    if (!editName.trim() || !HHMM.test(editDep) || !HHMM.test(editArr)) {
      setMsg("Fill name + both times (HH:MM)"); return
    }
    const res = await updateRouteSession(selectedRouteId, editingId, {
      name: editName.trim(), departure: editDep, arrival: editArr,
    })
    if (!res.ok) { setMsg(res.error); return }
    setEditingId(null)
    await refetch(selectedRouteId)
  }

  if (routes.length === 0) {
    return <p className="text-xs text-on-surface-variant">Register a route first to schedule sessions.</p>
  }

  return (
    <div className="space-y-5">
      {/* Route picker */}
      <label className="block">
        <span className={labelCaption}>Route</span>
        <select
          className={inputClass}
          value={selectedRouteId}
          onChange={(e) => setSelectedRouteId(e.target.value)}
        >
          {routes.map((r) => (
            <option key={r.routeId} value={r.routeId}>{r.name} · {r.category}</option>
          ))}
        </select>
      </label>

      {/* Mode toggle */}
      <div>
        <span className={labelCaption}>Schedule mode</span>
        <div className="mt-2 inline-flex rounded-lg border border-outline-variant/20 bg-surface p-0.5">
          {(["sessions", "flexible"] as ScheduleMode[]).map((m) => {
            const active = mode === m
            return (
              <button
                key={m}
                type="button"
                disabled={savingMode}
                onClick={() => onSelectMode(m)}
                className={`rounded-md px-3 py-1.5 font-headline text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? "bg-primary text-white"
                    : "text-on-surface-variant hover:text-white"
                }`}
              >
                {m === "sessions" ? "Sessions" : "Flexible"}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-on-surface-variant/70">
          {mode === "sessions"
            ? "Recurring weekly timetable — passengers pick a day and session."
            : "Continuous operating window — one-trip ticket valid any time that day."}
        </p>
      </div>

      {/* Flexible-mode window editor */}
      {mode === "flexible" && (
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high/50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCaption}>Operating start</span>
              <input
                type="time"
                className={inputClass}
                value={operatingStart}
                onChange={(e) => setOperatingStart(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={labelCaption}>Operating end</span>
              <input
                type="time"
                className={inputClass}
                value={operatingEnd}
                onChange={(e) => setOperatingEnd(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={savingMode}
            onClick={saveOperatingWindow}
            className="mt-3 rounded-lg bg-primary px-4 py-1.5 font-headline text-[11px] font-bold uppercase tracking-wider text-white hover:brightness-110 disabled:opacity-50"
          >
            {savingMode ? "Saving…" : "Save window"}
          </button>
        </div>
      )}

      {/* Sessions editor — only meaningful in sessions mode */}
      {mode === "sessions" && (
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high/30">
          {/* Day tabs */}
          <div className="flex flex-wrap gap-1 border-b border-outline-variant/15 p-2">
            {DAYS.map((label, idx) => {
              const count = byDay.get(idx)?.length ?? 0
              const active = selectedDay === idx
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => { setSelectedDay(idx); setEditingId(null); setMsg(null) }}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-headline text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    active
                      ? "bg-primary text-white"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-white"
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                      active ? "bg-white/20" : "bg-outline-variant/20"
                    }`}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Session list */}
          <div className="p-3 space-y-2">
            {loading ? (
              <p className="text-xs text-on-surface-variant">Loading…</p>
            ) : daySessions.length === 0 ? (
              <p className="text-xs text-on-surface-variant/70">No sessions on {DAYS[selectedDay]}. Add one below.</p>
            ) : (
              daySessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-outline-variant/15 bg-surface/60 px-3 py-2"
                >
                  {editingId === s.id ? (
                    <>
                      <input
                        className={`${inputClass} !mt-0 flex-1`}
                        value={editName} maxLength={40}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Name"
                      />
                      <input
                        type="time"
                        className={`${inputClass} !mt-0 w-28`}
                        value={editDep}
                        onChange={(e) => setEditDep(e.target.value)}
                      />
                      <input
                        type="time"
                        className={`${inputClass} !mt-0 w-28`}
                        value={editArr}
                        onChange={(e) => setEditArr(e.target.value)}
                      />
                      <button type="button" onClick={() => void saveEdit()}
                        className="rounded-md bg-primary px-2.5 py-1 font-headline text-[10px] font-bold uppercase text-white hover:brightness-110">
                        Save
                      </button>
                      <button type="button" onClick={cancelEdit}
                        className="rounded-md border border-outline-variant/20 px-2.5 py-1 font-headline text-[10px] font-bold uppercase text-on-surface-variant hover:text-white">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-headline text-sm font-semibold text-white">{s.name}</p>
                        <p className="text-[11px] text-on-surface-variant/70">{s.departure} → {s.arrival}</p>
                      </div>
                      <button type="button" onClick={() => startEdit(s)}
                        className="rounded-md border border-outline-variant/20 px-2.5 py-1 font-headline text-[10px] font-bold uppercase text-on-surface-variant hover:text-white">
                        Edit
                      </button>
                      <button type="button" onClick={() => void removeSession(s.id)}
                        className="rounded-md border border-error/25 px-2.5 py-1 font-headline text-[10px] font-bold uppercase text-error/80 hover:text-error">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              ))
            )}

            {/* Add-session row */}
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-outline-variant/20 bg-surface/40 p-2.5">
              <label className="min-w-[8rem] flex-1 block">
                <span className={labelCaption}>Name</span>
                <input
                  className={inputClass}
                  value={newName} maxLength={40}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Morning"
                />
              </label>
              <label className="block">
                <span className={labelCaption}>Departure</span>
                <input
                  type="time"
                  className={`${inputClass} w-28`}
                  value={newDep}
                  onChange={(e) => setNewDep(e.target.value)}
                />
              </label>
              <label className="block">
                <span className={labelCaption}>Arrival</span>
                <input
                  type="time"
                  className={`${inputClass} w-28`}
                  value={newArr}
                  onChange={(e) => setNewArr(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={adding || !newName.trim() || !HHMM.test(newDep) || !HHMM.test(newArr)}
                onClick={() => void addSession()}
                className="rounded-lg bg-primary px-4 py-2 font-headline text-[11px] font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 disabled:opacity-50"
              >
                {adding ? "Adding…" : `Add to ${DAYS[selectedDay]}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <p className="text-xs text-error">{msg}</p>}
    </div>
  )
}
