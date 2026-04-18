import { Link } from "react-router-dom"

export type BreadcrumbItem = {
  label: string
  /** If provided, the item renders as a Link. Otherwise it renders as plain text
   *  (the "current page" terminal item). */
  to?: string
}

export type BreadcrumbProps = {
  items: BreadcrumbItem[]
}

/**
 * Simple textual breadcrumb. The first item shows with an arrow prefix ("← Label");
 * subsequent items are separated by " · ". The last item is the "current page"
 * and never renders as a link even if `to` is set.
 */
export function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-xs text-primary">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        const prefix = idx === 0 ? "← " : " · "
        if (isLast || !item.to) {
          return (
            <span key={idx} className={idx === 0 ? "" : "text-on-surface-variant"}>
              {prefix}
              {item.label}
            </span>
          )
        }
        return (
          <span key={idx}>
            {prefix}
            <Link to={item.to} className="hover:underline">
              {item.label}
            </Link>
          </span>
        )
      })}
    </nav>
  )
}
