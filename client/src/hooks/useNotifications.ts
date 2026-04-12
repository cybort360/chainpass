/**
 * Browser push notifications for ChainPass.
 * Uses the Notifications API — no service worker required when page is open.
 * Notifications are scheduled via setTimeout so they fire while the tab is live.
 */
import { useCallback, useEffect, useRef, useState } from "react"

export type NotifPermission = "default" | "granted" | "denied" | "unsupported"

const SHOWN_KEY = "chainpass_notif_shown"
const ICON = "/logo.svg"

function readShown(): Set<string> {
  try {
    const raw = localStorage.getItem(SHOWN_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch { /* ignore */ }
  return new Set()
}

function markShown(id: string) {
  try {
    const set = readShown()
    set.add(id)
    // Keep set small — only last 50 entries
    const arr = [...set].slice(-50)
    localStorage.setItem(SHOWN_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotifPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
    return Notification.permission as NotifPermission
  })

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) return "unsupported" as NotifPermission
    const result = await Notification.requestPermission()
    setPermission(result as NotifPermission)
    return result as NotifPermission
  }, [])

  const scheduleExpiryNotification = useCallback((
    tokenId: string,
    routeName: string,
    validUntilEpoch: bigint,
  ) => {
    if (permission !== "granted") return
    const expiresAt = Number(validUntilEpoch) * 1000
    const now = Date.now()
    const msUntilExpiry = expiresAt - now

    // Notify at 24h before expiry and again at 2h before
    const intervals = [
      { label: "24h", ms: msUntilExpiry - 24 * 60 * 60 * 1000 },
      { label: "2h",  ms: msUntilExpiry - 2  * 60 * 60 * 1000 },
    ]

    for (const { label, ms } of intervals) {
      if (ms <= 0) continue // already passed
      const notifId = `expiry-${tokenId}-${label}`
      if (readShown().has(notifId)) continue
      if (timersRef.current.has(notifId)) continue

      const timer = setTimeout(() => {
        if (Notification.permission !== "granted") return
        const hours = label === "24h" ? 24 : 2
        try {
          const n = new Notification("ChainPass — Ticket expiring soon", {
            body: `Your ${routeName} ticket expires in ~${hours} hours. Board before it expires!`,
            icon: ICON,
            tag: notifId,
          })
          n.onclick = () => {
            window.focus()
            window.location.href = `/pass/${tokenId}`
          }
          markShown(notifId)
        } catch { /* Notification constructor may throw on some browsers */ }
        timersRef.current.delete(notifId)
      }, ms)

      timersRef.current.set(notifId, timer)
    }
  }, [permission])

  // Clear all scheduled timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [])

  return { permission, requestPermission, scheduleExpiryNotification }
}
