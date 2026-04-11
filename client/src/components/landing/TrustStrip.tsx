import { MaterialIcon } from "./MaterialIcon"
import { MotionSection } from "./MotionSection"

export function TrustStrip() {
  return (
    <MotionSection className="bg-surface-container-low py-12 px-8 overflow-hidden">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8 opacity-80">
        <div className="flex flex-col items-center gap-4 md:items-start">
          <span className="font-headline font-bold text-primary tracking-widest text-xs uppercase text-center md:text-left">
            Built for modern transit systems
          </span>
          <div className="flex items-center gap-3 opacity-90">
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-on-surface-variant">Built on</span>
            <img
              src="/monad/full-logo-white.svg"
              alt="Monad"
              className="h-6 w-auto sm:h-7"
              width={140}
              height={27}
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-x-12 gap-y-4 text-sm font-medium text-on-surface-variant">
          <span className="flex items-center gap-2">
            <MaterialIcon name="verified_user" className="text-tertiary text-lg" filled />
            Secure. Fast.
          </span>
          <span className="flex items-center gap-2">
            <MaterialIcon name="speed" className="text-tertiary text-lg" filled />
            Simple to use.
          </span>
          <span className="flex items-center gap-2">
            <MaterialIcon name="download_done" className="text-tertiary text-lg" filled />
            No apps to download.
          </span>
          <span className="flex items-center gap-2">
            <MaterialIcon name="account_circle" className="text-tertiary text-lg" filled />
            Just your wallet.
          </span>
        </div>
      </div>
    </MotionSection>
  )
}
