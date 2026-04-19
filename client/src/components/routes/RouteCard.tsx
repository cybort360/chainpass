import { Link } from "react-router-dom"
import { formatEther } from "viem"
import type { ApiRouteLabel } from "../../lib/api"
import { shortenNumericId } from "../../lib/passDisplay"
import { formatNgn } from "../../lib/prices"
import { TransportIcon } from "./TransportIcon"

/** Format mint price in MON + NGN equivalent */
export function FareBadge({
  priceWei,
  ngnForMon,
}: {
  priceWei: bigint | undefined
  ngnForMon: (mon: number) => number
}) {
  if (priceWei === undefined) return null
  const mon = Number(formatEther(priceWei))
  if (mon <= 0) return null
  const ngn = ngnForMon(mon)
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
        {mon.toLocaleString(undefined, { maximumFractionDigits: 4 })} MON
      </span>
      <span className="text-[10px] text-on-surface-variant/50">
        ≈ {formatNgn(ngn, { compact: true })}
      </span>
    </div>
  )
}

/** Heart / favourite toggle button */
export function FavouriteButton({
  isFav,
  onToggle,
}: {
  isFav: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-label={isFav ? "Remove from favourites" : "Add to favourites"}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
        isFav
          ? "bg-rose-500/15 text-rose-400"
          : "bg-transparent text-on-surface-variant/30 hover:bg-rose-500/10 hover:text-rose-400/60"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24"
        fill={isFav ? "currentColor" : "none"}
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden>
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}

export type RouteCardProps = {
  route: Pick<ApiRouteLabel, "routeId" | "name" | "detail" | "category" | "shortCode" | "operatorName" | "operatorSlug"> & {
    schedule?: string | null
  }
  /** default true; suppress "via {operatorName}" when page is already operator-scoped */
  showOperator?: boolean
  /** react-router location.state for the primary Link */
  navigateState?: unknown
  favourite?: { isFavourite: boolean; onToggle: () => void }
  /**
   * Optional fare widget — parent passes the already-resolved price in wei and a
   * NGN conversion fn. When omitted, no FareBadge is rendered.
   */
  fare?: { priceWei?: bigint; ngnForMon?: (mon: number) => number; rateLoading?: boolean }
  /** Optional operator actions — rendered only when provided (isOperator path). */
  operatorActions?: { onEdit: () => void; onDelete: () => void }
  /**
   * Optional share button + error tooltip. Matches the per-row share UI used on /routes.
   * When omitted, no share control renders.
   */
  share?: {
    onShare: () => void
    state: "idle" | "copied" | "error"
    shareUrl: string | null
    /** Clears the tooltip when the manual copy fallback is shown. */
    onClearUrl: () => void
  }
}

export function RouteCard({
  route,
  showOperator = true,
  navigateState,
  favourite,
  fare,
  operatorActions,
  share,
}: RouteCardProps) {
  const r = route
  const to = `/routes/${r.routeId}`
  return (
    <div className="group flex items-stretch overflow-hidden rounded-2xl border border-outline-variant/15 bg-surface-container transition-all hover:border-primary/25 hover:bg-surface-container-high hover:shadow-[0_4px_24px_rgba(110,84,255,0.1)]">

      {/* Left accent bar */}
      <div className="w-0.5 shrink-0 rounded-r-full bg-primary/0 transition-all group-hover:bg-primary/60" aria-hidden />

      {/* Main clickable area */}
      <Link
        to={to}
        state={navigateState}
        className="flex flex-1 items-center gap-4 min-w-0 px-4 py-4"
      >
        {/* Transport icon — bus or train based on category/name */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
          <TransportIcon category={r.category} name={r.name} className="text-primary" />
        </div>

        {/* Route info */}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-headline text-sm font-semibold leading-snug text-white">
            <span className="truncate">{r.name}</span>
            {r.shortCode && (
              <span
                className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-primary"
                title="Route short code"
              >
                {r.shortCode}
              </span>
            )}
          </p>
          {r.detail && (
            <p className="mt-0.5 text-xs text-on-surface-variant">{r.detail}</p>
          )}
          {showOperator && r.operatorName && (
            <p className="mt-0.5 text-[10px] text-on-surface-variant/60">
              via {r.operatorName}
            </p>
          )}
          {r.schedule && (
            <p className="mt-0.5 flex items-center gap-1 text-[10px] text-on-surface-variant/60">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {r.schedule}
            </p>
          )}
          {/* Fare badge — per-route price if set, else global */}
          {fare && !fare.rateLoading && fare.ngnForMon && (
            <FareBadge priceWei={fare.priceWei} ngnForMon={fare.ngnForMon} />
          )}
          <p className="mt-1 font-mono text-[10px] text-on-surface-variant/60"
            title={`Route ID ${r.routeId}`}>
            ID {shortenNumericId(r.routeId, 6, 6)}
          </p>
        </div>
      </Link>

      {/* Right action panel — heart + operator actions + buy */}
      <div className="flex shrink-0 items-center gap-1 border-l border-outline-variant/10 pl-2 pr-3">
        {favourite && (
          <FavouriteButton
            isFav={favourite.isFavourite}
            onToggle={favourite.onToggle}
          />
        )}

        {/* Operator-only edit/delete buttons */}
        {operatorActions && (
          <>
            <div className="w-px h-5 bg-outline-variant/20 mx-0.5" aria-hidden />
            <button
              type="button"
              aria-label="Edit route"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); operatorActions.onEdit() }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant/40 hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              type="button"
              aria-label="Delete route"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); operatorActions.onDelete() }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant/40 hover:bg-error/10 hover:text-error transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
              </svg>
            </button>
          </>
        )}

        <div className="w-px h-5 bg-outline-variant/20 mx-1" aria-hidden />
        <Link
          to={to}
          state={navigateState}
          tabIndex={-1}
          aria-hidden
          className="flex items-center gap-1 text-on-surface-variant transition-colors group-hover:text-primary"
        >
          <span className="font-headline text-xs font-semibold">Buy</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform group-hover:translate-x-0.5" aria-hidden>
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
        {share && (
          <div className="relative flex flex-col items-end gap-1">
            <button
              type="button"
              aria-label={`Share ${r.name}`}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); share.onShare() }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant/40 transition-colors hover:text-primary"
            >
              {share.state === "copied" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              )}
            </button>
            {/* Manual copy fallback when clipboard is blocked */}
            {share.state === "error" && share.shareUrl && (
              <div className="absolute right-0 top-9 z-20 flex w-64 items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-highest px-3 py-2 shadow-lg">
                <input
                  readOnly
                  value={share.shareUrl}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-on-surface-variant outline-none"
                />
                <button type="button" onClick={(e) => { e.stopPropagation(); share.onClearUrl() }}
                  className="shrink-0 text-on-surface-variant/50 hover:text-on-surface-variant">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
