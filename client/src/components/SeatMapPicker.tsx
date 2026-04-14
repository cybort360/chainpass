import { useEffect, useRef, useState } from "react"
import { fetchOccupiedSeats } from "../lib/api"
import type { CoachClassConfig, VehicleType } from "../lib/api"

/** Poll interval — keeps the map fresh as other passengers pick seats */
const POLL_MS = 15_000

type Props = {
  routeId: string
  selectedSeat: string | null
  onSelect: (seat: string | null) => void
  vehicleType?: VehicleType | null
  /** New-style: per-class coach layout */
  coachClasses?: CoachClassConfig[] | null
  /** Optional: filter seat map to only this class's coaches */
  selectedClass?: "first" | "business" | "economy" | null
  /** Legacy: number of coaches */
  coaches?: number | null
  /** Legacy: seats per coach */
  seatsPerCoach?: number | null
  /** Bus: total seat count */
  totalSeats?: number | null
}

function SeatBtn({
  id,
  label,
  occupied,
  selected,
  onClick,
}: {
  id: string
  label: string
  occupied: boolean
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={occupied && !selected}
      onClick={onClick}
      title={selected ? `${id} – your selection` : occupied ? `${id} – taken` : id}
      className={`flex h-8 w-8 items-center justify-center rounded-md font-headline text-[9px] font-bold transition-all
        ${
          selected
            ? "bg-primary text-white shadow-[0_0_12px_rgba(110,84,255,0.6)] ring-2 ring-primary/60"
            : occupied
            ? "cursor-not-allowed bg-surface-container-high/40 text-on-surface-variant/25 line-through"
            : "border border-outline-variant/30 bg-surface-container-high text-on-surface-variant hover:border-primary/40 hover:bg-primary/10 hover:text-white"
        }`}
    >
      {occupied && !selected ? "✕" : label}
    </button>
  )
}

/** Flexible seat row: left and right arrays can be any size. */
function SeatRow({
  leftSeats,
  rightSeats,
  occupied,
  selectedSeat,
  toggle,
}: {
  leftSeats: { id: string; label: string }[]
  rightSeats: { id: string; label: string }[]
  occupied: Set<string>
  selectedSeat: string | null
  toggle: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-1">
        {leftSeats.map((s) => (
          <SeatBtn key={s.id} id={s.id} label={s.label}
            occupied={occupied.has(s.id)} selected={selectedSeat === s.id}
            onClick={() => toggle(s.id)} />
        ))}
      </div>
      <div className="w-4 text-center font-headline text-[8px] text-on-surface-variant/20">│</div>
      <div className="flex gap-1">
        {rightSeats.map((s) => (
          <SeatBtn key={s.id} id={s.id} label={s.label}
            occupied={occupied.has(s.id)} selected={selectedSeat === s.id}
            onClick={() => toggle(s.id)} />
        ))}
      </div>
    </div>
  )
}

/** Column header row matching left + right column counts. */
function ColHeaders({ leftCols, rightCols }: { leftCols: number; rightCols: number }) {
  const letters = Array.from({ length: leftCols + rightCols }, (_, i) => String.fromCharCode(65 + i))
  return (
    <div className="mb-1.5 flex items-center gap-1">
      <div className="flex gap-1">
        {letters.slice(0, leftCols).map((l) => (
          <div key={l} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/40">{l}</div>
        ))}
      </div>
      <div className="w-4" />
      <div className="flex gap-1">
        {letters.slice(leftCols).map((l) => (
          <div key={l} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/40">{l}</div>
        ))}
      </div>
    </div>
  )
}

/** Build all seat IDs for a coach-class-style train layout. */
function buildCoachClassSeats(coachClasses: CoachClassConfig[]) {
  const classPrefixes: Record<string, string> = { first: "F", business: "B", economy: "E" }
  const result: {
    classLabel: string
    classKey: "first" | "business" | "economy"
    coachNum: number   // global coach index within this class (1-based)
    leftCols: number
    rightCols: number
    rows: { leftSeats: { id: string; label: string }[]; rightSeats: { id: string; label: string }[] }[]
  }[] = []

  for (const cc of coachClasses) {
    const prefix = classPrefixes[cc.class] ?? cc.class.charAt(0).toUpperCase()
    const totalCols = cc.leftCols + cc.rightCols
    const letters = Array.from({ length: totalCols }, (_, i) => String.fromCharCode(65 + i))
    const leftLetters = letters.slice(0, cc.leftCols)
    const rightLetters = letters.slice(cc.leftCols)

    for (let coachIdx = 1; coachIdx <= cc.count; coachIdx++) {
      const coachId = `${prefix}${coachIdx}`
      const rows: typeof result[0]["rows"] = []
      for (let row = 1; row <= cc.rows; row++) {
        const leftSeats = leftLetters.map((l) => ({
          id: `${coachId}-${row}${l}`,
          label: `${row}${l}`,
        }))
        const rightSeats = rightLetters.map((l) => ({
          id: `${coachId}-${row}${l}`,
          label: `${row}${l}`,
        }))
        rows.push({ leftSeats, rightSeats })
      }
      result.push({
        classLabel: cc.class === "first" ? "First Class" : cc.class === "business" ? "Business" : "Economy",
        classKey: cc.class,
        coachNum: coachIdx,
        leftCols: cc.leftCols,
        rightCols: cc.rightCols,
        rows,
      })
    }
  }
  return result
}

/** Legacy: Generate seat IDs and labels for a flat train layout (C{coach}-{seat}). */
function buildTrainSeats(coaches: number, seatsPerCoach: number) {
  const result: { coachNum: number; seats: { id: string; label: string }[] }[] = []
  for (let c = 1; c <= coaches; c++) {
    const seats: { id: string; label: string }[] = []
    for (let s = 1; s <= seatsPerCoach; s++) {
      seats.push({ id: `C${c}-${s}`, label: String(s) })
    }
    result.push({ coachNum: c, seats })
  }
  return result
}

/** Generate seat IDs for a bus: "1", "2", … up to totalSeats */
function buildBusSeats(totalSeats: number) {
  return Array.from({ length: totalSeats }, (_, i) => ({
    id: String(i + 1),
    label: String(i + 1),
  }))
}

/** Render a legacy 2+2 row (used by flat train + bus layouts). */
function LegacySeatRow({
  seats,
  occupied,
  selectedSeat,
  toggle,
}: {
  seats: { id: string; label: string }[]
  occupied: Set<string>
  selectedSeat: string | null
  toggle: (id: string) => void
}) {
  const left = seats.slice(0, 2)
  const right = seats.slice(2, 4)
  return (
    <div className="flex items-center gap-1">
      <div className="flex gap-1">
        {left.map((s) => (
          <SeatBtn key={s.id} id={s.id} label={s.label}
            occupied={occupied.has(s.id)} selected={selectedSeat === s.id}
            onClick={() => toggle(s.id)} />
        ))}
        {left.length < 2 && <div className="h-8 w-8" />}
      </div>
      <div className="w-4 text-center font-headline text-[8px] text-on-surface-variant/20">│</div>
      <div className="flex gap-1">
        {right.map((s) => (
          <SeatBtn key={s.id} id={s.id} label={s.label}
            occupied={occupied.has(s.id)} selected={selectedSeat === s.id}
            onClick={() => toggle(s.id)} />
        ))}
        {right.length < 2 && Array.from({ length: 2 - right.length }).map((_, i) => (
          <div key={i} className="h-8 w-8" />
        ))}
      </div>
    </div>
  )
}

export function SeatMapPicker({ routeId, selectedSeat, onSelect, vehicleType, coachClasses, selectedClass, coaches, seatsPerCoach, totalSeats }: Props) {
  const [occupied, setOccupied] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [selectedCoachIdx, setSelectedCoachIdx] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset to first coach when the class filter changes
  useEffect(() => { setSelectedCoachIdx(0) }, [selectedClass])

  const refresh = (initial = false) => {
    if (initial) setLoading(true)
    void fetchOccupiedSeats(routeId).then((seats) => {
      setOccupied(new Set(seats))
      if (initial) setLoading(false)
    })
  }

  useEffect(() => {
    refresh(true)
    intervalRef.current = setInterval(() => refresh(false), POLL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId])

  const toggle = (id: string) => onSelect(selectedSeat === id ? null : id)

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  const legend = (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      {[
        { color: "border border-outline-variant/30 bg-surface-container-high", label: "Available" },
        { color: "bg-primary ring-2 ring-primary/60", label: "Selected" },
        { color: "bg-surface-container-high/40", label: "Taken / Reserved" },
      ].map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1.5">
          <div className={`h-3 w-3 rounded-sm ${color}`} />
          <span className="text-[9px] text-on-surface-variant/70">{label}</span>
        </div>
      ))}
    </div>
  )

  const footer = selectedSeat ? (
    <p className="mt-2 text-center font-headline text-xs font-semibold text-primary">
      Seat {selectedSeat} selected — held for 10 min
    </p>
  ) : (
    <p className="mt-2 text-center font-headline text-[9px] text-on-surface-variant/50">
      Tap a seat to reserve it
    </p>
  )

  // ── New-style train layout: coachClasses ────────────────────────────────────
  if (vehicleType === "train" && coachClasses && coachClasses.length > 0) {
    // Filter to selected class if provided
    const visibleClasses = selectedClass
      ? coachClasses.filter((cc) => cc.class === selectedClass)
      : coachClasses

    if (visibleClasses.length === 0) {
      return (
        <p className="py-4 text-center font-headline text-xs text-on-surface-variant/60">
          No coaches configured for this class.
        </p>
      )
    }

    const allCoaches = buildCoachClassSeats(visibleClasses)
    const totalCapacity = allCoaches.reduce(
      (sum, c) => sum + c.rows.length * (c.leftCols + c.rightCols), 0,
    )
    const availableCount = totalCapacity - occupied.size

    // Clamp selected index to valid range
    const coachIdx = Math.min(selectedCoachIdx, allCoaches.length - 1)
    const coach = allCoaches[coachIdx]
    const freeInCoach = coach.rows.reduce(
      (sum, r) => sum + [...r.leftSeats, ...r.rightSeats].filter((s) => !occupied.has(s.id)).length, 0,
    )
    const totalInCoach = coach.rows.length * (coach.leftCols + coach.rightCols)

    return (
      <div className="select-none">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
            Select your seat
          </p>
          <p className="font-headline text-[9px] text-on-surface-variant/60">
            {availableCount} of {totalCapacity} available
          </p>
        </div>
        {legend}

        {/* Coach selector dropdown */}
        <div className="mb-3">
          <p className="mb-1.5 font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Coach</p>
          <div className="relative">
            <select
              value={coachIdx}
              onChange={(e) => setSelectedCoachIdx(Number(e.target.value))}
              className="w-full appearance-none rounded-xl border border-outline-variant/25 bg-surface-container-high px-4 py-2.5 pr-9 font-headline text-sm font-semibold text-white focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            >
              {allCoaches.map((c, i) => {
                const free = c.rows.reduce(
                  (sum, r) => sum + [...r.leftSeats, ...r.rightSeats].filter((s) => !occupied.has(s.id)).length, 0,
                )
                const total = c.rows.length * (c.leftCols + c.rightCols)
                const prefix = c.classKey === "first" ? "F" : c.classKey === "business" ? "B" : "E"
                return (
                  <option key={i} value={i}>
                    {prefix}{String(c.coachNum).padStart(2, "0")} — (R-{free}/{total})
                  </option>
                )
              })}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-on-surface-variant/60" aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>

        {/* Selected coach seat grid */}
        <div className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
              {coach.classLabel} · Coach {coach.coachNum}
            </span>
            <span className="text-[9px] text-on-surface-variant/50">
              {freeInCoach} / {totalInCoach} free
            </span>
          </div>
          <ColHeaders leftCols={coach.leftCols} rightCols={coach.rightCols} />
          <div className="space-y-1">
            {coach.rows.map((row, ri) => (
              <SeatRow key={ri} leftSeats={row.leftSeats} rightSeats={row.rightSeats}
                occupied={occupied} selectedSeat={selectedSeat} toggle={toggle} />
            ))}
          </div>
        </div>
        {footer}
      </div>
    )
  }

  // ── Legacy train layout (flat coaches × seatsPerCoach) ─────────────────────
  if (vehicleType === "train" && coaches && seatsPerCoach) {
    const coachData = buildTrainSeats(coaches, seatsPerCoach)
    const totalCapacity = coaches * seatsPerCoach
    const availableCount = totalCapacity - occupied.size

    const legacyIdx = Math.min(selectedCoachIdx, coachData.length - 1)
    const { coachNum, seats } = coachData[legacyIdx]
    const legacyRows: { id: string; label: string }[][] = []
    for (let i = 0; i < seats.length; i += 4) legacyRows.push(seats.slice(i, i + 4))

    return (
      <div className="select-none">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
            Select your seat
          </p>
          <p className="font-headline text-[9px] text-on-surface-variant/60">
            {availableCount} of {totalCapacity} available
          </p>
        </div>
        {legend}

        {/* Coach selector dropdown */}
        <div className="mb-3">
          <p className="mb-1.5 font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Coach</p>
          <div className="relative">
            <select
              value={legacyIdx}
              onChange={(e) => setSelectedCoachIdx(Number(e.target.value))}
              className="w-full appearance-none rounded-xl border border-outline-variant/25 bg-surface-container-high px-4 py-2.5 pr-9 font-headline text-sm font-semibold text-white focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            >
              {coachData.map((c, i) => {
                const free = c.seats.filter((s) => !occupied.has(s.id)).length
                return (
                  <option key={i} value={i}>
                    C{String(c.coachNum).padStart(2, "0")} — (R-{free}/{seatsPerCoach})
                  </option>
                )
              })}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="text-on-surface-variant/60" aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>

        {/* Selected coach seat grid */}
        <div className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
              Coach {coachNum}
            </span>
            <span className="text-[9px] text-on-surface-variant/50">
              {seats.filter(s => !occupied.has(s.id)).length} / {seatsPerCoach} free
            </span>
          </div>
          <div className="mb-1.5 flex items-center gap-1">
            <div className="flex gap-1">
              {["A","B"].map(l => (
                <div key={l} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/40">{l}</div>
              ))}
            </div>
            <div className="w-4" />
            <div className="flex gap-1">
              {["C","D"].map(l => (
                <div key={l} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/40">{l}</div>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            {legacyRows.map((rowSeats, ri) => (
              <LegacySeatRow key={ri} seats={rowSeats} occupied={occupied} selectedSeat={selectedSeat} toggle={toggle} />
            ))}
          </div>
        </div>
        {footer}
      </div>
    )
  }

  // ── Bus layout (numbered grid) ────────────────────────────────────────────
  if (vehicleType === "bus" && totalSeats) {
    const seats = buildBusSeats(totalSeats)
    const availableCount = totalSeats - occupied.size
    const rows: { id: string; label: string }[][] = []
    for (let i = 0; i < seats.length; i += 4) rows.push(seats.slice(i, i + 4))

    return (
      <div className="select-none">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
            Select your seat
          </p>
          <p className="font-headline text-[9px] text-on-surface-variant/60">
            {availableCount} of {totalSeats} available
          </p>
        </div>
        {legend}
        <div className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-4">
          <div className="mb-2 flex items-center gap-1 text-on-surface-variant/40">
            {["A","B"].map(l => <div key={l} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase">{l}</div>)}
            <div className="w-4" />
            {["C","D"].map(l => <div key={l} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase">{l}</div>)}
          </div>
          <div className="space-y-1">
            {rows.map((rowSeats, ri) => (
              <div key={ri} className="flex items-center gap-1">
                <div className="flex gap-1">
                  {rowSeats.slice(0,2).map(s => (
                    <SeatBtn key={s.id} id={s.id} label={s.label}
                      occupied={occupied.has(s.id)} selected={selectedSeat === s.id}
                      onClick={() => toggle(s.id)} />
                  ))}
                  {rowSeats.length < 2 && <div className="h-8 w-8" />}
                </div>
                <div className="w-4 text-center font-headline text-[8px] text-on-surface-variant/20">│</div>
                <div className="flex gap-1">
                  {rowSeats.slice(2,4).map(s => (
                    <SeatBtn key={s.id} id={s.id} label={s.label}
                      occupied={occupied.has(s.id)} selected={selectedSeat === s.id}
                      onClick={() => toggle(s.id)} />
                  ))}
                  {rowSeats.length < 4 && Array.from({ length: Math.max(0, 4 - rowSeats.length) }).map((_,i) => (
                    <div key={i} className="h-8 w-8" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {footer}
      </div>
    )
  }

  // ── Fallback: legacy 5-row × 4-col layout (backward compat) ───────────────
  const ROWS = [1, 2, 3, 4, 5]
  const LEFT_SEATS = ["A", "B"]
  const RIGHT_SEATS = ["C", "D"]
  const totalCapacity = ROWS.length * (LEFT_SEATS.length + RIGHT_SEATS.length)
  const availableCount = totalCapacity - occupied.size

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
          Select your seat
        </p>
        <p className="font-headline text-[9px] text-on-surface-variant/60">
          {availableCount} of {totalCapacity} available
        </p>
      </div>
      {legend}
      <div className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-4">
        <div className="mb-2 flex items-center gap-1">
          <div className="w-6" />
          <div className="flex gap-1">
            {LEFT_SEATS.map((s) => (
              <div key={s} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/50">{s}</div>
            ))}
          </div>
          <div className="w-5" />
          <div className="flex gap-1">
            {RIGHT_SEATS.map((s) => (
              <div key={s} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/50">{s}</div>
            ))}
          </div>
        </div>
        {ROWS.map((row) => (
          <div key={row} className="mb-1.5 flex items-center gap-1">
            <div className="w-6 text-center font-headline text-[10px] font-bold text-on-surface-variant/60">{row}</div>
            <div className="flex gap-1">
              {LEFT_SEATS.map((col) => {
                const id = `${row}${col}`
                return <SeatBtn key={id} id={id} label={id} occupied={occupied.has(id)} selected={selectedSeat === id} onClick={() => toggle(id)} />
              })}
            </div>
            <div className="w-5 text-center font-headline text-[8px] text-on-surface-variant/20">│</div>
            <div className="flex gap-1">
              {RIGHT_SEATS.map((col) => {
                const id = `${row}${col}`
                return <SeatBtn key={id} id={id} label={id} occupied={occupied.has(id)} selected={selectedSeat === id} onClick={() => toggle(id)} />
              })}
            </div>
          </div>
        ))}
      </div>
      {footer}
    </div>
  )
}
