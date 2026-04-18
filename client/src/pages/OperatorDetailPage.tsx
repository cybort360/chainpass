import { useCallback, useEffect, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import {
  fetchOperator,
  fetchOperatorRoutes,
  type ApiOperatorDetail,
  type ApiRouteLabel,
} from "../lib/api"
import { Breadcrumb } from "../components/marketplace/Breadcrumb"
import { RouteCard } from "../components/routes/RouteCard"

/** Tab ids, used both in state and in the `?tab=` URL param. */
type Tab = "routes" | "about" | "schedule"
const TABS: Tab[] = ["routes", "about", "schedule"]

/**
 * Operator detail — the rider-facing page for a single operator.
 * Sibling to /operator (singular): that's the operator-admin route page.
 */
export function OperatorDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get("tab") ?? "routes"
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "routes"

  const [operator, setOperator] = useState<ApiOperatorDetail | null | undefined>(undefined)
  const [routes, setRoutes] = useState<ApiRouteLabel[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setOperator(undefined)
    setRoutes(undefined)
    Promise.all([fetchOperator(slug), fetchOperatorRoutes(slug)])
      .then(([op, rs]) => {
        if (cancelled) return
        setOperator(op) // null → 404
        setRoutes(rs ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setOperator(null)
        setRoutes([])
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  const selectTab = useCallback(
    (next: Tab) => {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set("tab", next)
      setSearchParams(nextParams, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // 404
  if (operator === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-center">
        <h1 className="font-headline text-lg font-semibold text-white">Operator not found</h1>
        <p className="mt-2 text-xs text-on-surface-variant">
          This operator doesn't exist or is no longer listed.
        </p>
        <Link
          to="/operators"
          className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline"
        >
          ← Back to all operators
        </Link>
      </div>
    )
  }

  // Loading
  if (operator === undefined) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Breadcrumb items={[{ label: "All operators", to: "/operators" }]} />
        <div className="animate-pulse">
          <div className="h-14 w-40 rounded bg-on-surface-variant/10" />
          <div className="mt-6 h-10 w-full rounded bg-on-surface-variant/10" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Breadcrumb items={[{ label: "All operators", to: "/operators" }]} />

      {/* Header */}
      <header className="mb-4 flex gap-3">
        <OperatorLogo operator={operator} />
        <div>
          <h1 className="font-headline text-xl font-bold text-white">{operator.name}</h1>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            {[operator.primaryCategory, operator.region].filter(Boolean).join(" · ")}
            {operator.primaryCategory || operator.region ? " · " : ""}
            {operator.routeCount} {operator.routeCount === 1 ? "route" : "routes"}
          </p>
        </div>
      </header>

      {/* Tab strip */}
      <div className="border-b border-outline-variant/20">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => selectTab(t)}
            className={
              "inline-block px-3 py-2 text-xs capitalize transition-colors " +
              (t === tab
                ? "border-b-2 border-primary text-white"
                : "text-on-surface-variant hover:text-white")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="pt-4">
        {tab === "routes"   && <RoutesPanel operator={operator} routes={routes} />}
        {tab === "about"    && <AboutPanel operator={operator} />}
        {tab === "schedule" && <SchedulePanel operator={operator} />}
      </div>
    </div>
  )
}

function slugGradient(slug: string): string {
  let hash = 0
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 60) % 360
  return `linear-gradient(135deg, hsl(${h1} 70% 45%), hsl(${h2} 70% 55%))`
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "??"
}

function OperatorLogo({ operator }: { operator: ApiOperatorDetail }) {
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl font-bold text-white"
      style={operator.logoUrl ? undefined : { background: slugGradient(operator.slug) }}
    >
      {operator.logoUrl ? (
        <img src={operator.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
      ) : (
        <span className="text-lg">{initials(operator.name)}</span>
      )}
    </div>
  )
}

// ------------- Tab panels (stubs — filled in later tasks) -------------
// Parameters are underscore-prefixed here to satisfy noUnusedParameters; the
// real implementations in Tasks 12-14 will consume them.

function RoutesPanel({
  operator,
  routes,
}: {
  operator: ApiOperatorDetail
  routes: ApiRouteLabel[] | null | undefined
}) {
  if (routes === undefined) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-16 w-full animate-pulse rounded-2xl border border-outline-variant/15 bg-surface-container"
          />
        ))}
      </div>
    )
  }
  if (routes === null || routes.length === 0) {
    return (
      <p className="rounded-2xl border border-outline-variant/15 bg-surface-container p-6 text-center text-xs text-on-surface-variant">
        This operator hasn't added any routes yet.
      </p>
    )
  }
  return (
    <ul className="space-y-2.5">
      {routes.map((r) => (
        <li key={r.routeId}>
          <RouteCard
            route={r}
            showOperator={false}
            navigateState={{ fromOperator: { slug: operator.slug, name: operator.name } }}
          />
        </li>
      ))}
    </ul>
  )
}

function AboutPanel({ operator: _operator }: { operator: ApiOperatorDetail }) {
  return <div className="text-xs text-on-surface-variant">About tab — filled in Task 13.</div>
}

function SchedulePanel({ operator: _operator }: { operator: ApiOperatorDetail }) {
  return <div className="text-xs text-on-surface-variant">Schedule tab — filled in Task 14.</div>
}
