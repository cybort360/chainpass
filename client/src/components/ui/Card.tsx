import type { HTMLAttributes } from "react"

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["rounded-3xl", className].filter(Boolean).join(" ")} {...props} />
}
