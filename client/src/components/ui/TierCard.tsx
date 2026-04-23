import type { LoyaltyData } from "../../hooks/useLoyalty"

interface TierCardProps {
  data: LoyaltyData
  onClaim: () => void
  claiming?: boolean
}

export function TierCard({ data, onClaim, claiming = false }: TierCardProps) {
  const { rides, available, tier, progressPct, ridesUntilNext } = data
  const atMax = tier.name === "Platinum"

  return (
    <div className={`overflow-hidden rounded-2xl border ${tier.border} ${tier.bg} mb-6`}>
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl leading-none" role="img" aria-label={tier.name}>
            {tier.icon}
          </span>
          <div>
            <p className={`font-headline text-[10px] font-bold uppercase tracking-widest ${tier.color}`}>
              Loyalty tier
            </p>
            <p className={`font-headline text-xl font-bold leading-tight text-white`}>
              {tier.name === "None" ? "No tier yet" : tier.name}
            </p>
          </div>
        </div>

        {/* Ride count badge */}
        <div className="text-right">
          <p className="font-headline text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">
            Total rides
          </p>
          <p className={`font-mono text-2xl font-bold leading-tight ${tier.color}`}>
            {rides}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      {!atMax && (
        <div className="px-5 pb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-on-surface-variant">
              {tier.name === "None" ? "Start riding to earn Bronze" : `Progress to next tier`}
            </span>
            <span className={`font-headline text-xs font-semibold ${tier.color}`}>
              {ridesUntilNext} ride{ridesUntilNext !== 1 ? "s" : ""} to go
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-container">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                tier.name === "None"     ? "bg-on-surface-variant/40" :
                tier.name === "Bronze"   ? "bg-amber-400" :
                tier.name === "Silver"   ? "bg-slate-300" :
                tier.name === "Gold"     ? "bg-yellow-400" : "bg-violet-400"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* Tier milestone labels */}
          <div className="mt-1 flex justify-between text-[9px] text-on-surface-variant/60 font-mono">
            <span>{tier.min}</span>
            <span>{tier.next}</span>
          </div>
        </div>
      )}

      {atMax && (
        <div className="px-5 pb-4">
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-center">
            <p className="text-xs font-semibold text-violet-300">
              💎 Maximum tier reached — you're a Hoppr legend!
            </p>
          </div>
        </div>
      )}

      {/* Free ride credits */}
      <div className={`border-t ${tier.border} px-5 py-4 flex items-center justify-between`}>
        <div>
          <p className="font-headline text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Free ride credits
          </p>
          <p className="mt-0.5 text-sm text-on-surface-variant">
            {available > 0 ? (
              <span className={`font-semibold ${tier.color}`}>
                {available} available
              </span>
            ) : (
              <span>
                Every 10 rides earns 1 free ride
              </span>
            )}
          </p>
        </div>

        {available > 0 && (
          <button
            type="button"
            onClick={onClaim}
            disabled={claiming}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 font-headline text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tier.border} ${tier.bg} ${tier.color} hover:brightness-110`}
          >
            {claiming ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                Claiming…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Claim free ride
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
