import { MaterialIcon } from "./MaterialIcon"
import { MotionSection } from "./MotionSection"

const mini = [
  { icon: "bolt", title: "Buy in seconds", bar: "primary" as const },
  { icon: "qr_code_2", title: "Scan and go", bar: "tertiary" as const },
  { icon: "instant_mix", title: "Access instantly", bar: "tertiary" as const },
  { icon: "insights", title: "Simple insights", bar: "primary" as const },
]

const bullets = [
  "Buy tickets in seconds",
  "Access your pass instantly",
  "Scan and go at the gate",
  "Track usage with simple insights",
]

export function BetterWaySection() {
  return (
    <MotionSection id="features" className="bg-surface-container-lowest py-24 relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-20 items-center">
        <div className="order-2 lg:order-1 relative">
          <div className="absolute -inset-10 bg-tertiary/5 blur-3xl rounded-full" aria-hidden />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-4 pt-12">
              {mini.slice(0, 2).map((m) => (
                <div key={m.title} className="bg-surface-container p-6 rounded-2xl outline outline-1 outline-outline-variant/10">
                  <MaterialIcon name={m.icon} className={m.bar === "primary" ? "text-primary mb-4" : "text-tertiary mb-4"} />
                  <h4 className="font-headline font-bold mb-2 text-sm">{m.title}</h4>
                  <div className={m.bar === "primary" ? "h-1 w-12 bg-primary rounded-full" : "h-1 w-12 bg-tertiary rounded-full"} />
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {mini.slice(2, 4).map((m) => (
                <div key={m.title} className="bg-surface-container p-6 rounded-2xl outline outline-1 outline-outline-variant/10">
                  <MaterialIcon name={m.icon} className={m.bar === "primary" ? "text-primary mb-4" : "text-tertiary mb-4"} />
                  <h4 className="font-headline font-bold mb-2 text-sm">{m.title}</h4>
                  <div className={m.bar === "primary" ? "h-1 w-12 bg-primary rounded-full" : "h-1 w-12 bg-tertiary rounded-full"} />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2 space-y-8">
          <h2 className="font-headline text-5xl font-bold tracking-tight">
            A better way <br />
            <span className="text-primary">to move</span>
          </h2>
          <p className="text-xl text-on-surface-variant leading-relaxed">
            Everything you need, right when you need it. ChainPass strips away the friction of legacy systems.
          </p>
          <ul className="space-y-6">
            {bullets.map((b) => (
              <li key={b} className="flex items-start gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <MaterialIcon name="check" className="text-primary text-[1.125rem] leading-none" />
                </div>
                <span className="text-on-surface font-medium">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MotionSection>
  )
}
