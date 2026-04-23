import { TicketQrSvg } from "./TicketQrSvg"

type Props = {
  className?: string
}

/** ~iPhone class aspect (~9:19.5) + ticket UI */
export function PhoneTicketMockup({ className = "" }: Props) {
  return (
    <div
      className={["relative mx-auto w-full max-w-[260px] sm:max-w-[280px]", className].filter(Boolean).join(" ")}
      role="img"
      aria-label="Hoppr digital ticket for LAGOS BRT with QR code, valid status, and journey from Ikorodu Terminal to TBS Marina"
    >
      <div className="relative aspect-[9/19.5] w-full">
        <div className="absolute inset-0 flex flex-col rounded-[2.75rem] bg-[#1c1c1e] p-[10px] shadow-[0_40px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.07]">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.25rem] bg-[#0b0e11]">
            <div className="relative z-10 flex shrink-0 items-start justify-between px-4 pt-2.5 pb-0.5 text-[10px] font-medium leading-none text-white sm:px-5 sm:text-[11px]">
              <span className="pl-0.5 tabular-nums tracking-tight">9:41</span>
              <div className="flex items-center gap-1 pr-0.5" aria-hidden>
                <svg className="h-2.5 w-3.5 text-white" viewBox="0 0 18 12" fill="currentColor" aria-hidden>
                  <rect x="0" y="8" width="3" height="4" rx="0.5" />
                  <rect x="4" y="6" width="3" height="6" rx="0.5" />
                  <rect x="8" y="4" width="3" height="8" rx="0.5" />
                  <rect x="12" y="2" width="3" height="10" rx="0.5" />
                </svg>
                <svg className="h-2.5 w-3.5 text-white" viewBox="0 0 16 12" fill="currentColor" aria-hidden>
                  <path d="M8 1.5c2.8 0 5 2 5 4.5S10.8 10.5 8 10.5 3 8.5 3 6 5.2 1.5 8 1.5z" />
                </svg>
                <svg className="h-2.5 w-6 text-white" viewBox="0 0 27 12" fill="currentColor" aria-hidden>
                  <rect x="1" y="2" width="22" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="24" y="4.5" width="2.5" height="5" rx="0.8" />
                  <rect x="3" y="4" width="18" height="5" rx="0.8" fill="currentColor" opacity="0.9" />
                </svg>
              </div>
            </div>

            <div
              className="pointer-events-none absolute left-1/2 top-1.5 z-20 h-[26px] w-[min(42%,100px)] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/[0.08] sm:w-[110px]"
              aria-hidden
            />

            <div className="relative z-10 mx-2.5 mt-1 flex min-h-0 flex-1 flex-col sm:mx-3">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-2xl bg-[#161b22] px-3 pb-4 pt-3 shadow-inner sm:px-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-500 sm:text-[10px]">
                    Single journey
                  </p>
                  <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[8px] font-bold leading-none tracking-wide text-white sm:px-2 sm:text-[9px]">
                    VALID
                  </span>
                </div>
                <h3 className="mt-1.5 font-headline text-lg font-bold uppercase leading-tight tracking-tight text-white sm:mt-2 sm:text-[1.35rem]">
                  LAGOS BRT
                </h3>

                <div className="mx-auto mt-3 w-full max-w-[min(100%,200px)] shrink-0">
                  <TicketQrSvg className="h-auto w-full rounded-md" />
                </div>

                <div className="mt-4 space-y-3 sm:mt-5 sm:space-y-4">
                  <div>
                    <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-500 sm:text-[10px]">From</p>
                    <p className="mt-0.5 font-headline text-xs font-semibold text-white sm:text-sm">Ikorodu Terminal</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-500 sm:text-[10px]">To</p>
                    <p className="mt-0.5 font-headline text-xs font-semibold text-white sm:text-sm">TBS Marina</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-600/90 pt-3 sm:mt-5 sm:pt-4">
                  <p className="min-w-0 truncate font-mono text-[10px] text-zinc-500 sm:text-[11px]">#0x7a3f…c291</p>
                  <p className="shrink-0 font-headline text-xs font-semibold tabular-nums text-sky-400 sm:text-sm">
                    2:45:00
                  </p>
                </div>
              </div>
            </div>

            <div className="mx-auto mb-2 mt-auto h-1 w-[min(40%,108px)] shrink-0 rounded-full bg-white/35" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}
