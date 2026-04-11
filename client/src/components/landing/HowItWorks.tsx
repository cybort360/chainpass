import { MaterialIcon } from "./MaterialIcon"
import { MotionSection } from "./MotionSection"
import { SectionHeader } from "../ui/SectionHeader"

const steps = [
  {
    icon: "shopping_cart",
    iconWrap: "bg-primary/10 group-hover:bg-primary/20",
    iconColor: "text-primary text-3xl",
    title: "Buy your ticket",
    body: "Choose your route and pay in seconds using your digital wallet.",
  },
  {
    icon: "confirmation_number",
    iconWrap: "bg-tertiary/10 group-hover:bg-tertiary/20",
    iconColor: "text-tertiary text-3xl",
    title: "Get your pass",
    body: "Your ticket is stored securely and ready to use, instantly available on your device.",
  },
  {
    icon: "qr_code_scanner",
    iconWrap: "bg-primary/10 group-hover:bg-primary/20",
    iconColor: "text-primary text-3xl",
    title: "Scan to board",
    body: "Show your QR code at the gate and you're in. Seamless validation in milliseconds.",
  },
] as const

export function HowItWorks() {
  return (
    <MotionSection id="how-it-works" className="px-8 py-24 max-w-7xl mx-auto">
      <SectionHeader
        title="How it works"
        subtitle="Transit simplified into three kinetic beats."
        aside="No paper. No waiting. No confusion."
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {steps.map((s) => (
          <div
            key={s.title}
            className="bg-surface-container p-10 rounded-3xl flex flex-col gap-8 group hover:bg-surface-container-high transition-colors"
          >
            <div className={["w-16 h-16 rounded-2xl flex items-center justify-center transition-colors", s.iconWrap].join(" ")}>
              <MaterialIcon name={s.icon} className={s.iconColor} />
            </div>
            <div>
              <h3 className="font-headline text-2xl font-bold mb-2">{s.title}</h3>
              <p className="text-on-surface-variant">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </MotionSection>
  )
}
