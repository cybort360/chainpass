import type { CSSProperties } from "react"

type Props = {
  name: string
  className?: string
  filled?: boolean
  style?: CSSProperties
}

export function MaterialIcon({ name, className = "", filled = false, style }: Props) {
  const merged: CSSProperties = filled
    ? { fontVariationSettings: "'FILL' 1", ...style }
    : { ...style }
  return (
    <span className={["material-symbols-outlined", className].filter(Boolean).join(" ")} style={merged} aria-hidden>
      {name}
    </span>
  )
}
