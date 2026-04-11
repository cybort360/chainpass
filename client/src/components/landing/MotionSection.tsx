import type { ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import { landingSectionTransition, landingViewport } from "./motionPresets"

type Props = {
  children: ReactNode
  className?: string
  id?: string
  delay?: number
}

export function MotionSection({ children, className, id, delay = 0 }: Props) {
  const reduce = useReducedMotion()
  const prefersReduced = reduce === true

  return (
    <motion.section
      id={id}
      className={className}
      initial={prefersReduced ? false : { opacity: 0, y: 14 }}
      whileInView={prefersReduced ? undefined : { opacity: 1, y: 0 }}
      viewport={prefersReduced ? { once: true } : landingViewport}
      transition={prefersReduced ? { duration: 0 } : landingSectionTransition(delay)}
    >
      {children}
    </motion.section>
  )
}
