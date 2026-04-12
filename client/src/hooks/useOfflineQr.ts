import { useCallback } from "react"
import type { QrPayload } from "../lib/api"

const storageKey = (tokenId: string) => `chainpass.qr.${tokenId}`

export function useOfflineQr(tokenId: string | undefined) {
  const persist = useCallback(
    (payload: QrPayload) => {
      if (!tokenId) return
      try {
        localStorage.setItem(storageKey(tokenId), JSON.stringify(payload))
      } catch {
        // storage full or private mode — skip silently
      }
    },
    [tokenId],
  )

  const recall = useCallback((): QrPayload | null => {
    if (!tokenId) return null
    try {
      const raw = localStorage.getItem(storageKey(tokenId))
      if (!raw) return null
      return JSON.parse(raw) as QrPayload
    } catch {
      return null
    }
  }, [tokenId])

  const clear = useCallback(() => {
    if (!tokenId) return
    try { localStorage.removeItem(storageKey(tokenId)) } catch { /* ignore */ }
  }, [tokenId])

  return { persist, recall, clear }
}
