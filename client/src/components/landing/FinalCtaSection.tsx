import { Link } from "react-router-dom"
import { MotionSection } from "./MotionSection"
import { PhoneTicketMockup } from "./PhoneTicketMockup"

export function FinalCtaSection() {
  return (
    <MotionSection className="px-8 py-24 lg:py-32 max-w-7xl mx-auto relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center -z-10" aria-hidden>
        <div className="w-[800px] h-[800px] bg-primary/10 blur-[150px] rounded-full" />
      </div>
      <div className="grid lg:grid-cols-2 gap-16 items-center text-left">
        <div className="space-y-8">
          <h2 className="font-headline text-5xl lg:text-7xl font-bold tracking-tighter mb-6">Ready to try it?</h2>
          <p className="text-xl text-on-surface-variant max-w-xl mb-12">
            Buy a ticket, scan your pass, and see how simple transit can be. Experience the future of contactless
            ticketing today.
          </p>
          <div className="flex flex-col sm:flex-row gap-6">
            <Link
              to="/routes"
              className="inline-flex items-center justify-center rounded-full bg-primary px-10 py-5 font-headline text-xl font-bold text-on-primary transition-all hover:bg-primary-container hover:shadow-[0_0_30px_rgba(110,84,255,0.55)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-95"
            >
              Get Started
            </Link>
            <Link
              to="/routes"
              className="inline-flex items-center justify-center rounded-full border border-outline-variant/30 bg-surface-container px-10 py-5 font-headline text-xl font-bold text-on-surface transition-colors hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              Browse Routes
            </Link>
          </div>
        </div>
        <div className="relative flex justify-center lg:justify-end">
          <div className="relative w-full max-w-[320px] filter drop-shadow-[0_50px_50px_rgba(0,0,0,0.8)] transform lg:-rotate-3 hover:rotate-0 transition-transform duration-1000">
            <PhoneTicketMockup />
          </div>
        </div>
      </div>
    </MotionSection>
  )
}
