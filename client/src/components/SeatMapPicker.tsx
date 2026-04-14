import { useEffect, useRef, useState } from "react"
import { fetchOccupiedSeats } from "../lib/api"

const ROWS = [1, 2, 3, 4, 5]
const LEFT_SEATS = ["A", "B"]
const RIGHT_SEATS = ["C", "D"]

/** Poll interval — keeps the map fresh as other passengers pick seats */
const POLL_MS = 15_000

type Props = {
  routeId: string
  selectedSeat: string | null
  onSelect: (seat: string | null) => void
}

function SeatBtn({
  id,
  occupied,
  selected,
  onClick,
}: {
  id: string
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
      className={`flex h-8 w-8 items-center justify-center rounded-md font-headline text-[10px] font-bold transition-all
        ${
          occupied
            ? "cursor-not-allowed bg-surface-container-high/40 text-on-surface-variant/25 line-through"
            : selected
            ? "bg-primary text-white shadow-[0_0_12px_rgba(110,84,255,0.6)] ring-2 ring-primary/60"
            : "border border-outline-variant/30 bg-surface-container-high text-on-surface-variant hover:border-primary/40 hover:bg-primary/10 hover:text-white"
        }`}
    >
      {occupied && !selected ? "✕" : id}
    </button>
  )
}

export function SeatMapPicker({ routeId, selectedSeat, onSelect }: Props) {
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

  // If the seat we had selected is now taken by someone else, deselect it
  useEffect(() => {
    if (selectedSeat && occupied.has(selectedSeat)) {
      onSelect(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupied])

  const toggle = (id: string) => {
    onSelect(selectedSeat === id ? null : id)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  const totalSeats = ROWS.length * (LEFT_SEATS.length + RIGHT_SEATS.length)
  const takenCount = occupied.size
  const availableCount = totalSeats - takenCount

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

      {/* Legend */}
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

      {/* Seat grid */}
      <div className="overflow-x-auto rounded-xl border border-outline-variant/15 bg-surface-container-low/40 p-4">
        {/* Column headers */}
        <div className="mb-2 flex items-center gap-1">
          <div className="w-6" />
          <div className="flex gap-1">
            {LEFT_SEATS.map((s) => (
              <div key={s} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/50">
                {s}
              </div>
            ))}
          </div>
          <div className="w-5" />
          <div className="flex gap-1">
            {RIGHT_SEATS.map((s) => (
              <div key={s} className="flex w-8 justify-center font-headline text-[9px] font-bold uppercase text-on-surface-variant/50">
                {s}
              </div>
            ))}
          </div>
        </div>

        {ROWS.map((row) => (
          <div key={row} className="mb-1.5 flex items-center gap-1">
            <div className="w-6 text-center font-headline text-[10px] font-bold text-on-surface-variant/60">
              {row}
            </div>
            <div className="flex gap-1">
              {LEFT_SEATS.map((col) => {
                const id = `${row}${col}`
                return (
                  <SeatBtn
                    key={id}
                    id={id}
                    occupied={occupied.has(id)}
                    selected={selectedSeat === id}
                    onClick={() => toggle(id)}
                  />
                )
              })}
            </div>
            <div className="w-5 text-center font-headline text-[8px] text-on-surface-variant/20">✈</div>
            <div className="flex gap-1">
              {RIGHT_SEATS.map((col) => {
                const id = `${row}${col}`
                return (
                  <SeatBtn
                    key={id}
                    id={id}
                    occupied={occupied.has(id)}
                    selected={selectedSeat === id}
                    onClick={() => toggle(id)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedSeat ? (
        <p className="mt-2 text-center font-headline text-xs font-semibold text-primary">
          Seat {selectedSeat} selected — held for 10 min
        </p>
      ) : (
        <p className="mt-2 text-center font-headline text-[9px] text-on-surface-variant/50">
          Seat is reserved once you tap it
        </p>
      )}
    </div>
  )
}
