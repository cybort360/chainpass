/**
 * Exchange rate utilities for NGN display.
 *
 * - USD/NGN: fetched from open.er-api.com (free, no key).
 * - MON:     testnet token — no live price. Uses env var or hardcoded demo rate.
 * - USDC:    1 USDC ≡ 1 USD (stablecoin).
 */
import { useEffect, useState } from "react"

const RATE_CACHE_MS = 5 * 60 * 1000 // 5 min
const DEFAULT_USD_NGN = 1_600          // fallback if API is down
export const MON_USD_PRICE = 0.05      // testnet demo rate (not a real market price)

interface RateCache { usdToNgn: number; fetchedAt: number }
let _cache: RateCache | null = null

export async function fetchUsdNgnRate(): Promise<number> {
  if (_cache && Date.now() - _cache.fetchedAt < RATE_CACHE_MS) return _cache.usdToNgn
  try {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), 5_000)
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: ctrl.signal })
    window.clearTimeout(timer)
    const data = (await res.json()) as { rates?: { NGN?: number } }
    const rate = data?.rates?.NGN
    if (typeof rate === "number" && rate > 0) {
      _cache = { usdToNgn: rate, fetchedAt: Date.now() }
      return rate
    }
  } catch { /* use fallback */ }
  return DEFAULT_USD_NGN
}

/** Format a number as Nigerian naira. */
export function formatNgn(amount: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && amount >= 1_000_000) {
    return `₦${(amount / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`
  }
  if (opts?.compact && amount >= 1_000) {
    return `₦${(amount / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`
  }
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Convert MON → NGN using testnet demo rate. */
export function monToNgn(mon: number, usdToNgn: number): number {
  return mon * MON_USD_PRICE * usdToNgn
}

/** Convert USDC (1:1 USD) → NGN. */
export function usdcToNgn(usdc: number, usdToNgn: number): number {
  return usdc * usdToNgn
}

/** React hook — fetches USD/NGN rate on mount, refreshes every 5 min. */
export function useExchangeRates() {
  const [usdToNgn, setUsdToNgn] = useState<number>(DEFAULT_USD_NGN)
  const [rateLoading, setRateLoading] = useState(true)

  useEffect(() => {
    void fetchUsdNgnRate().then((r) => { setUsdToNgn(r); setRateLoading(false) })
    const id = window.setInterval(() => {
      void fetchUsdNgnRate().then(setUsdToNgn)
    }, RATE_CACHE_MS)
    return () => window.clearInterval(id)
  }, [])

  return {
    usdToNgn,
    rateLoading,
    monUsdPrice: MON_USD_PRICE,
    ngnForMon: (mon: number) => monToNgn(mon, usdToNgn),
    ngnForUsdc: (usdc: number) => usdcToNgn(usdc, usdToNgn),
  }
}
