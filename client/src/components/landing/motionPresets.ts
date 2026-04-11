/** Shared landing motion — calm ease-out, modest travel, symmetric in/out. */

export const landingEase = [0.25, 0.1, 0.25, 1] as const

/** Slightly quicker opacity than transform so entrances feel settled, not floaty. */
export const landingSectionTransition = (delay = 0) =>
  ({
    delay,
    opacity: { duration: 0.55, ease: landingEase },
    y: { duration: 0.72, ease: landingEase },
  }) as const

export const landingHeroItemTransition = (prefersReduced: boolean) =>
  prefersReduced
    ? { duration: 0 }
    : ({
        opacity: { duration: 0.58, ease: landingEase },
        y: { duration: 0.68, ease: landingEase },
      } as const)

export const landingHeroStagger = (prefersReduced: boolean) =>
  prefersReduced ? 0 : 0.065

export const landingHeroDelayChildren = (prefersReduced: boolean) =>
  prefersReduced ? 0 : 0.05

/** Scroll regions: start slightly before fully in view, reverse when leaving. */
export const landingViewport = {
  once: false as const,
  amount: 0.22 as const,
  margin: "0px 0px -14% 0px" as const,
}

export const landingHeroViewport = {
  once: false as const,
  amount: 0.38 as const,
  margin: "-5% 0px -20% 0px" as const,
}
