import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { fetchOperators, type ApiOperator } from "../lib/api"
import { OperatorRowSkeleton } from "../components/marketplace/OperatorRowSkeleton"

/**
 * Operators directory — the rider-facing marketplace front door.
 * Sibling to /operator (singular): that's the admin route-registration page
 * for operator-owners. This page (plural) is the public directory.
 */
export function OperatorsDirectoryPage() {
  const [operators, setOperators] = useState<ApiOperator[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchOperators()
      .then((result) => {
        if (cancelled) return
        if (result === null) {
          setError("Could not load operators. Please retry.")
          setOperators([])
          return
        }
        setOperators(result)
      })
      .catch((err) => {
        if (cancelled) return
        console.error(err)
        setError("Could not load operators. Please retry.")
        setOperators([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const totalRoutes = (operators ?? []).reduce((sum, o) => sum + o.routeCount, 0)
  const isLoading = operators === null
  const isEmpty = !isLoading && (operators?.length ?? 0) === 0

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <header className="mb-6">
        <h1 className="font-headline text-2xl font-bold text-white">Marketplace</h1>
        {!isLoading && !isEmpty && (
          <p className="mt-1 text-xs text-on-surface-variant">
            {operators!.length} {operators!.length === 1 ? "operator" : "operators"} · {totalRoutes} {totalRoutes === 1 ? "route" : "routes"} available
          </p>
        )}
      </header>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setOperators(null)
              setError(null)
              fetchOperators().then((r) => setOperators(r ?? []))
            }}
            className="underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <OperatorRowSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {isEmpty && !error && (
        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container p-6 text-center">
          <p className="font-headline text-sm font-semibold text-white">No operators yet.</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            The marketplace is empty. Once an operator registers and adds a route, you'll see them here.
          </p>
          <Link
            to="/operator"
            className="mt-4 inline-block font-headline text-sm font-semibold text-primary hover:underline"
          >
            Register as an operator →
          </Link>
        </div>
      )}

      {/* Operator list */}
      {!isLoading && !isEmpty && (
        <ul className="space-y-2.5">
          {operators!.map((op) => (
            <li key={op.slug}>
              <OperatorRow operator={op} />
            </li>
          ))}
        </ul>
      )}

      {/* Escape hatch — only when we have data */}
      {!isLoading && !isEmpty && (
        <div className="mt-8 rounded-2xl border border-outline-variant/15 bg-surface-container p-4 text-center text-xs text-on-surface-variant">
          Looking for something specific?{" "}
          <Link to="/routes" className="font-semibold text-primary hover:underline">
            Browse all {totalRoutes} {totalRoutes === 1 ? "route" : "routes"} →
          </Link>
        </div>
      )}
    </div>
  )
}

/** Deterministic gradient for the logo fallback when logoUrl is null. */
function slugGradient(slug: string): string {
  // Hash the slug into two hues; combine as a CSS linear-gradient.
  let hash = 0
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0
  }
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 60) % 360
  return `linear-gradient(135deg, hsl(${h1} 70% 45%), hsl(${h2} 70% 55%))`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "??"
}

function OperatorRow({ operator }: { operator: ApiOperator }) {
  const subtitleParts = [operator.primaryCategory, operator.region].filter(Boolean)
  const subtitle = subtitleParts.join(" · ")

  return (
    <Link
      to={`/operators/${operator.slug}`}
      className="block rounded-2xl border border-outline-variant/15 bg-surface-container p-4 transition-all hover:border-primary/25 hover:bg-surface-container-high"
    >
      <div className="flex gap-3">
        {/* Logo */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-bold text-white"
          style={operator.logoUrl ? undefined : { background: slugGradient(operator.slug) }}
        >
          {operator.logoUrl ? (
            <img src={operator.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
          ) : (
            initials(operator.name)
          )}
        </div>

        {/* Text + pills */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-headline text-sm font-semibold text-white">{operator.name}</p>
            <p className="shrink-0 text-xs text-on-surface-variant">
              {operator.routeCount} {operator.routeCount === 1 ? "route" : "routes"}
            </p>
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-[11px] text-on-surface-variant">{subtitle}</p>
          )}
          {operator.primaryCategory && (
            <div className="mt-2">
              <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {operator.primaryCategory}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
