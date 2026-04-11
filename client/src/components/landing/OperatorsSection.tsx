import { MaterialIcon } from "./MaterialIcon"
import { MotionSection } from "./MotionSection"

const rows = [
  {
    icon: "payments",
    title: "Track sales",
    body: "See ticket movement and revenue as it happens—no batch exports or next-day spreadsheets.",
  },
  {
    icon: "shield_lock",
    title: "Cut fraud",
    body: "Passes are single-use and tied to the chain; riders can’t photocopy or share the same barcode twice.",
  },
  {
    icon: "route",
    title: "Plan with real usage",
    body: "Spot peaks, quiet runs, and odd patterns so you can tune routes and headways with something better than a hunch.",
  },
  {
    icon: "smartphone",
    title: "Lightweight rollout",
    body: "Conductors scan with phones or tablets you already issue—no bespoke gates or years-long capital projects.",
  },
] as const

export function OperatorsSection() {
  return (
    <MotionSection id="operators" className="mx-auto max-w-7xl px-8 py-24">
      <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-16">
        <header className="lg:col-span-5">
          <p className="mb-3 font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">For agencies</p>
          <h2 className="font-headline text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Built for <span className="text-primary">operators</span> too
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-on-surface-variant">
            ChainPass isn’t only a rider app—it’s something your team can run without ripping out the tools you already
            trust.
          </p>
        </header>

        <div className="lg:col-span-7">
          <div className="rounded-[1.75rem] bg-surface-container/80 p-2 outline outline-1 outline-outline-variant/20 sm:p-3">
            <div className="divide-y divide-outline-variant/15 rounded-2xl bg-surface-container-low/90 px-4 py-1 sm:px-6">
              {rows.map((row) => (
                <div key={row.title} className="flex gap-4 py-6 sm:gap-5 sm:py-7">
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.12] text-primary sm:size-12"
                    aria-hidden
                  >
                    <MaterialIcon name={row.icon} className="text-[1.35rem] sm:text-2xl" />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="font-headline text-base font-bold text-white sm:text-lg">{row.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-on-surface-variant sm:text-[0.9375rem]">{row.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MotionSection>
  )
}
