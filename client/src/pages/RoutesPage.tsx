import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { fetchRouteLabels } from "../lib/api"
import { DEMO_ROUTES } from "../constants/demoRoutes"
import { shortenNumericId } from "../lib/passDisplay"

type RouteRow = {
  routeId: string
  name: string
  detail: string
  category: string
}

export function RoutesPage() {
  /** `undefined` = fetch not finished; `null` = API error / unreachable; array = `GET /api/v1/routes` result */
  const [apiLabels, setApiLabels] = useState<Awaited<ReturnType<typeof fetchRouteLabels>> | undefined>(undefined)

  useEffect(() => {
    void fetchRouteLabels().then(setApiLabels)
  }, [])

  const rows = useMemo((): RouteRow[] => {
    if (apiLabels === undefined) {
      return []
    }
    const byId = new Map<string, RouteRow>()
    if (apiLabels !== null) {
      for (const row of apiLabels) {
        byId.set(row.routeId, {
          routeId: row.routeId,
          name: row.name,
          detail: row.detail ?? "",
          category: row.category || "General",
        })
      }
    }
    for (const r of DEMO_ROUTES) {
      if (!byId.has(r.routeId)) {
        byId.set(r.routeId, {
          routeId: r.routeId,
          name: r.name,
          detail: r.detail,
          category: r.category,
        })
      }
    }
    return [...byId.values()].sort((a, b) => {
      const c = a.category.localeCompare(b.category)
      if (c !== 0) return c
      const cmp = BigInt(a.routeId) - BigInt(b.routeId)
      return cmp < 0n ? -1 : cmp > 0n ? 1 : 0
    })
  }, [apiLabels])

  const byCategory = useMemo(() => {
    const m = new Map<string, RouteRow[]>()
    for (const r of rows) {
      const cat = r.category || "General"
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat)!.push(r)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rows])

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-2 font-headline text-xs font-bold uppercase tracking-[0.2em] text-primary">Passenger</p>
      <h1 className="font-headline text-3xl font-bold tracking-tight text-white sm:text-4xl">Choose a route</h1>
      <p className="mt-3 text-on-surface-variant">
        Route names come from the ChainPass API when it is available; demo routes fill any gaps. Fares are enforced
        on-chain — connect your wallet, pick a route, then pay in MON on Monad testnet.
      </p>
      {apiLabels === undefined ? (
        <p className="mt-10 text-sm text-on-surface-variant">Loading routes…</p>
      ) : null}
      {apiLabels === null ? (
        <p className="mt-4 text-sm text-tertiary">API unavailable — showing bundled demo routes only.</p>
      ) : null}
      <div className="mt-10 space-y-12">
        {byCategory.map(([category, list]) => (
          <section key={category}>
            <h2 className="font-headline text-lg font-semibold tracking-wide text-primary">{category}</h2>
            <ul className="mt-4 space-y-3">
              {list.map((r) => (
                <li key={r.routeId}>
                  <Link
                    to={`/routes/${r.routeId}`}
                    className="group flex items-center justify-between gap-4 rounded-2xl bg-surface-container px-5 py-4 transition-colors hover:bg-surface-container-high"
                  >
                    <div className="min-w-0">
                      <p className="font-headline font-bold text-white">{r.name}</p>
                      {r.detail ? <p className="mt-1 text-sm text-on-surface-variant">{r.detail}</p> : null}
                      <p
                        className="mt-1 font-mono text-xs text-on-surface-variant"
                        title={`Route ID ${r.routeId}`}
                      >
                        Route ID {shortenNumericId(r.routeId, 6, 6)}
                      </p>
                    </div>
                    <span className="shrink-0 font-headline text-sm font-semibold text-primary group-hover:text-primary-container">
                      Buy →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
