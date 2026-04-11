import type { ReactNode } from "react"

const N = 19

function cellOn(i: number, j: number): boolean {
  if (i < 1 || i >= N - 1 || j < 1 || j >= N - 1) return false
  const x = i - 1
  const y = j - 1
  const m = N - 2
  const finder = (fx: number, fy: number) => {
    const outer = fx <= 6 && fy <= 6
    const frame = fx === 0 || fx === 6 || fy === 0 || fy === 6
    const inner = fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4
    return outer && (frame || inner)
  }
  if (x < 7 && y < 7 && finder(x, y)) return true
  if (x >= m - 7 && y < 7 && finder(x - (m - 7), y)) return true
  if (x < 7 && y >= m - 7 && finder(x, y - (m - 7))) return true
  return ((x * 13 + y * 19 + x * y) & 3) !== 0
}

/** Screenshot-style: white modules on black field, blue center square (stitch/screen.png). */
export function TicketQrSvg({ className }: { className?: string }) {
  const size = 100
  const step = size / N
  const rects: ReactNode[] = []
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (!cellOn(i, j)) continue
      rects.push(
        <rect
          key={`${i}-${j}`}
          x={(j * size) / N}
          y={(i * size) / N}
          width={step + 0.35}
          height={step + 0.35}
          fill="#ffffff"
          rx={0.12}
        />,
      )
    }
  }
  const vb = `0 0 ${size} ${size}`
  return (
    <svg
      className={className}
      viewBox={vb}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width={size} height={size} fill="#0a0a0a" rx={4} />
      {rects}
      <rect
        x={size / 2 - 5}
        y={size / 2 - 5}
        width={10}
        height={10}
        fill="var(--color-primary)"
        rx={1.5}
      />
    </svg>
  )
}
