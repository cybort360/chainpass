import { Link } from "react-router-dom"
import { motion, useReducedMotion } from "motion/react"
import { PhoneTicketMockup } from "./PhoneTicketMockup"
import {
  landingHeroDelayChildren,
  landingHeroItemTransition,
  landingHeroStagger,
  landingHeroViewport,
} from "./motionPresets"

export function HeroSection() {
  const reduce = useReducedMotion()
  const prefersReduced = reduce === true

  const gridVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: landingHeroStagger(prefersReduced),
        delayChildren: landingHeroDelayChildren(prefersReduced),
      },
    },
  }

  const itemVariants = {
    hidden: {
      opacity: prefersReduced ? 1 : 0,
      y: prefersReduced ? 0 : 14,
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: landingHeroItemTransition(prefersReduced),
    },
  }

  const phoneVariants = {
    hidden: {
      opacity: prefersReduced ? 1 : 0,
      y: prefersReduced ? 0 : 18,
      scale: prefersReduced ? 1 : 0.985,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: landingHeroItemTransition(prefersReduced),
    },
  }

  const springTap = prefersReduced
    ? undefined
    : ({ type: "spring" as const, stiffness: 460, damping: 32, mass: 0.65 })

  return (
    <section className="relative mx-auto max-w-7xl px-8 py-20 lg:py-32">
      <motion.div
        className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center lg:gap-16"
        variants={gridVariants}
        initial={prefersReduced ? "visible" : "hidden"}
        whileInView={prefersReduced ? undefined : "visible"}
        viewport={prefersReduced ? { once: true, amount: 0.2 } : landingHeroViewport}
        animate={prefersReduced ? "visible" : undefined}
      >
        <motion.h1
          variants={itemVariants}
          className="col-start-1 text-center font-headline text-5xl font-bold tracking-tighter text-glow lg:text-left lg:text-7xl"
        >
          Scan. Board.{" "}
          <span className="bg-gradient-to-r from-white via-white to-primary bg-clip-text text-transparent">Done.</span>
        </motion.h1>
        <motion.p
          variants={itemVariants}
          className="col-start-1 mx-auto max-w-2xl text-center text-lg leading-relaxed text-on-surface-variant lg:mx-0 lg:text-left lg:text-xl"
        >
          A faster, smarter way to pay for transit — no cash, no paper tickets. Buy your ticket, show your pass, and
          go. Powered quietly by blockchain, built for real-world transport.
        </motion.p>
        <motion.div
          variants={itemVariants}
          className="col-start-1 flex flex-col justify-center gap-4 sm:flex-row lg:justify-start"
        >
          <motion.div
            className="inline-flex justify-center lg:justify-start"
            whileHover={prefersReduced ? undefined : { scale: 1.012 }}
            whileTap={prefersReduced ? undefined : { scale: 0.985 }}
            transition={springTap}
          >
            <Link
              to="/operators"
              className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-4 font-headline text-lg font-bold text-on-primary transition-[box-shadow,background-color] duration-300 hover:bg-primary-container hover:shadow-[0_0_20px_rgba(110,84,255,0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Get Started
            </Link>
          </motion.div>
          <motion.div
            className="inline-flex justify-center lg:justify-start"
            whileHover={prefersReduced ? undefined : { scale: 1.012 }}
            whileTap={prefersReduced ? undefined : { scale: 0.985 }}
            transition={springTap}
          >
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-full border border-outline-variant px-8 py-4 font-headline text-lg font-bold text-on-surface transition-colors duration-300 hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              View Demo
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          variants={phoneVariants}
          className="col-start-1 flex justify-center lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:justify-end lg:self-center"
        >
          <div className="relative w-full max-w-[280px] sm:max-w-[300px] lg:max-w-[320px]">
            <div className="absolute inset-0 -z-10 rounded-full bg-primary/20 blur-[100px]" aria-hidden />
            <PhoneTicketMockup className="transform transition-transform duration-700 ease-out hover:rotate-0 lg:rotate-2" />
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}
