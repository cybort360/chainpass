import { useEffect, useMemo, useState } from "react"
import { fetchRouteSessions, type RouteSession } from "../lib/api"

/**
 * Passenger-side weekly timetable (Phase 1).
 *
 * Shows the operator's recurring schedule as a compact day strip + per-day
 * session list. Past days automatically grey out using per-session granularity:
 *
 *   day.isPast = true  ⇔  every session scheduled for that day has already
 *                         departed (in today's local clock) AND day is today.
 *
 * A non-today past weekday (e.g. yesterday when today is Tuesday) is always
 * greyed because its sessions belong to *last* week's iteration.
 *
 * Interactive Phase 1 behaviour
 * -----------------------------
 * Selecting a session highlights it and calls `onSessionSelected`. The parent
 * stores that selection for display, but the mint flow still goes through the
 * existing trip selector so we don't destabilise the payment path in the same
 * changeset that introduces the new UI. Phase 2 will generate trips from the
 * session + date and wire the ticket directly.
 */

type Props = {
  routeId: string
  onSessionSelected?: (session: RouteSession | null, date: Date | null) => void
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

/** Convert JS Date.getDay() (0 = Sun) → our 0 = Mon index. */
function jsDayToMon0(jsDay: number): number {
  return (jsDay + 6) % 7
}

/** "HH:MM" local time string from a Date. */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/**
 * Resolve a concrete date for `dayOfWeek` relative to `today`:
 * the next occurrence on/after today. Used when the passenger picks a session
 * so downstream code gets a real Date to work with.
 */
function nextDateForDay(today: Date, dayOfWeek: number): Date {
  const todayIdx = jsDayToMon0(today.getDay())
  const delta = (dayOfWeek - todayIdx + 7) % 7
  const d = new Date(today)
  d.setDate(today.getDate() + delta)
  d.setHours(0, 0, 0, 0)
  return d
}

export function SessionPicker({ routeId, onSessionSelected }: Props) {
  const [sessions, setSessions] = useState<RouteSession[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<number>(() => jsDayToMon0(new Date().getDay()))
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)

  // A single "now" timestamp fixed per render cycle — avoids flicker when a
  // session's departure passes mid-interaction. We refresh every 60 s so the
  // greying updates without forcing a reload.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchRouteSessions(routeId).then((rows) => {
      if (cancelled) return
      setSessions(rows)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [routeId])

  // Group by day + sort within each day
  const byDay = useMemo(() => {
    const m = new Map<number, RouteSession[]>()
    for (let i = 0; i < 7; i++) m.set(i, [])
    for (const s of sessions) m.get(s.dayOfWeek)?.push(s)
    for (const list of m.values()) {
      list.sort((a, b) => (a.departure < b.departure ? -1 : a.departure > b.departure ? 1 : 0))
    }
    return m
  }, [sessions])

  // Per-day past/active state using per-session greying (option a)
  const todayIdx = jsDayToMon0(now.getDay())
  const nowHHMM = hhmm(now)
  const dayIsPast = (idx: number): boolean => {
    if (idx === todayIdx) {
      // "Today" is past only if *every* session has already departed
      const list = byDay.get(idx) ?? []
      if (list.length === 0) return false
      return list.every((s) => s.departure <= nowHHMM)
    }
    // Any non-today weekday: is its next occurrence in the past? By our mapping
    // nextDateForDay always returns "today or later", so a day never looks past
    // unless it is today and every session has departed.
    return false
  }

  const daySessions = byDay.get(selectedDay) ?? []

  const selectSession = (s: RouteSession) => {
    // Prevent picking a session that's already departed if it's on today
    if (selectedDay === todayIdx && s.departure <= nowHHMM) return
    setSelectedSessionId(s.id)
    onSessionSelected?.(s, nextDateForDay(now, s.dayOfWeek))
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container p-4">
        <p className="text-xs text-on-surface-variant">Loading schedule…</p>
      </div>
    )
  }
  if (sessions.length === 0) return null  // Nothing to show — fall back to trip selector

  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container">
      <div className="flex items-center justify-between border-b border-outline-variant/15 px-4 py-3">
        <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
          Weekly schedule
        </p>
        <p className="text-[10px] text-on-surface-variant/60">
          Past sessions are greyed
        </p>
      </div>

      {/* Day strip */}
      <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-outline-variant/10">
        {DAY_LABELS.map((label, idx) => {
          const active = selectedDay === idx
          const isToday = idx === todayIdx
          const past = dayIsPast(idx)
          const count = byDay.get(idx)?.length ?? 0
          return (
            <button
              key={label}
              type="button"
              onClick={() => { setSelectedDay(idx); setSelectedSessionId(null); onSessionSelected?.(null, null) }}
              className={`shrink-0 flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 font-headline text-[10px] font-bold uppercase tracking-wider transition-colors ${
                active
                  ? "bg-primary text-white"
                  : past
                    ? "text-on-surface-variant/40"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-white"
              } ${isToday && !active ? "ring-1 ring-primary/30" : ""}`}
              title={DAY_FULL[idx]}
            >
              <span>{label}</span>
              <span className={`text-[9px] ${active ? "text-white/80" : "text-on-surface-variant/60"}`}>
                {count > 0 ? `${count} session${count === 1 ? "" : "s"}` : "—"}
              </span>
            </button>
          )
        })}
      </div>

      {/* Sessions for selected day */}
      <div className="px-3 py-3 space-y-1.5">
        {daySessions.length === 0 ? (
          <p className="text-xs text-on-surface-variant/60">No sessions on {DAY_FULL[selectedDay]}.</p>
        ) : (
          daySessions.map((s) => {
            const isTodaySel = selectedDay === todayIdx
            const departed = isTodaySel && s.departure <= nowHHMM
            const selected = selectedSessionId === s.id
            return (
              <button
                key={s.id}
                type="button"
                disabled={departed}
                onClick={() => selectSession(s)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "border-primary/50 bg-primary/8"
                    : departed
                      ? "border-outline-variant/10 bg-surface-container-high/30 opacity-50 cursor-not-allowed"
                      : "border-outline-variant/15 bg-surface-container-high/40 hover:bg-surface-container-high/70"
                }`}
              >
                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? "border-primary bg-primary" : "border-outline-variant/40"
                }`}>
                  {selected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`font-headline text-sm font-semibold ${departed ? "text-on-surface-variant" : "text-white"}`}>
                    {s.name}
                  </p>
                  <p className="text-[11px] text-on-surface-variant/70">
                    {s.departure} → {s.arrival}
                    {departed ? " · departed" : ""}
                  </p>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
