/** Fixed decorative layers: mesh gradients, grain, hairline grid. Pointer-events none. */
export function LandingBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="landing-mesh absolute inset-0" />
      <div className="landing-grain absolute inset-0" />
      <div className="landing-grid absolute inset-0" />
    </div>
  )
}
