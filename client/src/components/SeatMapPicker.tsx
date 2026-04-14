import { useEffect, useRef, useState } from "react"
import { fetchOccupiedSeats } from "../lib/api"
import type { VehicleType } from "../lib/api"

/** Poll interval — keeps the map fresh as other passengers pick seats */
const POLL_MS = 15_000

type Props = {
  routeId: string
  selectedSeat: string | null
  onSelect: (seat: string | null) => void
  vehicleType?: VehicleType | null
  /** Train: number of coaches */
  coaches?: number | null
  /** Train: seats per coach */
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
      disabled={occupied}
      onClick={onClick}
      title={occupied ? `${id} – taken` : selected ? `${id} – your selection` : id}
      className={`flex h-8 w-8 items-center justify-center rounded-md font-headline text-[9px] font-bold transition-all
        ${
          occupied
            ? "cursor-not-allowed bg-surface-container-high/40 text-on-surface-variant/25 line-through"
            : selected
            ? "bg-primary text-white shadow-[0_0_12px_rgba(110,84,255,0.6)] ring-2 ring-primary/60"
            : "border border-outline-variant/30 bg-surface-container-high text-on-surface-variant hover:border-primary/40 hover:bg-primary/10 hover:text-white"
        }`}
    >
      {occupied && !selected ? "✕" : label}
    </button>
  )
}

/** Generate seat IDs and labels for a train layout.
 *  Seat IDs: "C{coach}-{seatNum}"  e.g. "C1-1", "C1-2", "C2-1"
 */
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

/** Render a row of seats split 2 | aisle | 2 */
function SeatRow({
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
        {/* pad if fewer than 2 on left */}
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

export function SeatMapPicker({ routeId, selectedSeat, onSelect, vehicleType, coaches, seatsPerCoach, totalSeats }: Props) {
  const [occupied, setOccupied] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  // If the selected seat is now taken by someone else, deselect it
  useEffect(() => {
    if (selectedSeat && occupied.has(selectedSeat)) onSelect(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupied])

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

  // ── Train layout (coaches) ──────────────────────────────────────────────────
  if (vehicleType === "train" && coaches && seatsPerCoach) {
    const coachData = buildTrainSeats(coaches, seatsPerCoach)
    const totalCapacity = coaches * seatsPerCoach
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
        <div className="space-y-4">
          {coachData.map(({ coachNum, seats }) => {
            const rows: { id: string; label: string }[][] = []
            for (let i = 0; i < seats.length; i += 4) rows.push(seats.slice(i, i + 4))
            return (
              <div key={coachNum} className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 font-headline text-[9px] font-bold uppercase tracking-widest text-primary">
                    Coach {coachNum}
                  </span>
                  <span className="text-[9px] text-on-surface-variant/50">
                    {seats.filter(s => !occupied.has(s.id)).length} free
                  </span>
                </div>
                {/* Column headers */}
                <div className="mb-1.5 flex items-center gap-1 pl-0">
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
                  {rows.map((rowSeats, ri) => (
                    <SeatRow key={ri} seats={rowSeats} occupied={occupied} selectedSeat={selectedSeat} toggle={toggle} />
                  ))}
                </div>
              </div>
            )
          })}
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
