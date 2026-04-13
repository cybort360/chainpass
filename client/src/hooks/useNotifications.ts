/**
 * Browser push notifications for ChainPass.
 * Schedules are persisted to localStorage so overdue notifications fire
 * when the user re-opens the tab (even if the previous session was closed).
 */
import { useCallback, useEffect, useRef, useState } from "react"

export type NotifPermission = "default" | "granted" | "denied" | "unsupported"

const SHOWN_KEY = "chainpass_notif_shown"
const SCHEDULE_KEY = "chainpass_notif_schedule"
const ICON = "/logo.svg"

type ScheduledNotif = {
  tokenId: string
  routeName: string
  fireAt: number   // Unix ms
  hours: number    // 24 or 2
}

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
    const arr = [...set].slice(-50)
    localStorage.setItem(SHOWN_KEY, JSON.stringify(arr))
  } catch { /* ignore */ }
}

function readSchedule(): Record<string, ScheduledNotif> {
  try {
    const raw = localStorage.getItem(SCHEDULE_KEY)
    if (raw) return JSON.parse(raw) as Record<string, ScheduledNotif>
  } catch { /* ignore */ }
  return {}
}

function writeSchedule(schedule: Record<string, ScheduledNotif>) {
  try {
    localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule))
  } catch { /* ignore */ }
}

function fireNotif(notifId: string, routeName: string, hours: number, tokenId: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission !== "granted") return
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
    // Remove from schedule
    const schedule = readSchedule()
    delete schedule[notifId]
    writeSchedule(schedule)
  } catch { /* ignore */ }
}

export function useNotifications() {
  const [permission, setPermission] = useState<NotifPermission>(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
    return Notification.permission as NotifPermission
  })

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // On mount: fire any overdue notifications from localStorage
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return
    if (Notification.permission !== "granted") return
    const schedule = readSchedule()
    const shown = readShown()
    const now = Date.now()
    for (const [notifId, item] of Object.entries(schedule)) {
      if (shown.has(notifId)) continue
      if (item.fireAt <= now) {
        // Overdue — fire immediately
        fireNotif(notifId, item.routeName, item.hours, item.tokenId)
      } else {
        // Schedule for future
        const ms = item.fireAt - now
        if (!timersRef.current.has(notifId)) {
          const timer = setTimeout(() => {
            fireNotif(notifId, item.routeName, item.hours, item.tokenId)
            timersRef.current.delete(notifId)
          }, ms)
          timersRef.current.set(notifId, timer)
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission])

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
    const shown = readShown()
    const schedule = readSchedule()
    let changed = false

    const intervals = [
      { label: "24h", ms: msUntilExpiry - 24 * 60 * 60 * 1000, hours: 24 },
      { label: "2h",  ms: msUntilExpiry - 2  * 60 * 60 * 1000, hours: 2  },
    ]

    for (const { label, ms, hours } of intervals) {
      const notifId = `expiry-${tokenId}-${label}`
      if (shown.has(notifId)) continue
      const fireAt = now + ms

      // Persist to localStorage
      if (!schedule[notifId]) {
        schedule[notifId] = { tokenId, routeName, fireAt, hours }
        changed = true
      }

      if (ms <= 0) {
        // Already overdue — fire immediately
        fireNotif(notifId, routeName, hours, tokenId)
        delete schedule[notifId]
        changed = true
        continue
      }

      if (timersRef.current.has(notifId)) continue
      const timer = setTimeout(() => {
        fireNotif(notifId, routeName, hours, tokenId)
        timersRef.current.delete(notifId)
      }, ms)
      timersRef.current.set(notifId, timer)
    }

    if (changed) writeSchedule(schedule)
  }, [permission])

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
    }
  }, [])

  return { permission, requestPermission, scheduleExpiryNotification }
}
