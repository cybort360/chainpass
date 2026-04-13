/**
 * Minimal GA4 wrapper.
 * Set VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX in client/.env to enable.
 * All calls are no-ops when the measurement ID is missing.
 */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

let _loaded = false

function ensureGtag() {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined
  if (!id || _loaded || typeof window === "undefined") return
  _loaded = true

  window.dataLayer = window.dataLayer ?? []
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args)
  }
  window.gtag("js", new Date())
  window.gtag("config", id, { send_page_view: false })

  const script = document.createElement("script")
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`
  document.head.appendChild(script)
}

export function trackPageView(path: string) {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined
  if (!id) return
  ensureGtag()
  window.gtag?.("event", "page_view", {
    page_path: path,
    send_to: id,
  })
}

export function trackEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>,
) {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined
  if (!id) return
  ensureGtag()
  window.gtag?.("event", eventName, { ...(params ?? {}), send_to: id })
}

/** Call once at app boot so GA script is injected. */
export function initAnalytics() {
  ensureGtag()
}
