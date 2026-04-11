import type { ButtonHTMLAttributes } from "react"

const variants = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-container hover:shadow-[0_0_20px_rgba(110,84,255,0.45)]",
  outline:
    "border border-outline-variant text-on-surface hover:bg-surface-variant",
  ghost:
    "bg-surface-container border border-outline-variant/30 text-on-surface hover:bg-surface-variant",
}

const sizes = {
  sm: "px-6 py-2 text-base",
  md: "px-8 py-4 text-lg",
  lg: "px-10 py-5 text-xl",
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "rounded-full font-bold font-headline transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
  return (
    <button
      type="button"
      className={[base, variants[variant], sizes[size], className].filter(Boolean).join(" ")}
      {...props}
    />
  )
}
