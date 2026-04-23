import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "hoppr_favourites"

function readStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed as string[])
  } catch { /* ignore corrupt storage */ }
  return new Set()
}

function writeStorage(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch { /* ignore quota errors */ }
}

export function useFavouriteRoutes() {
  const [favourites, setFavourites] = useState<Set<string>>(readStorage)

  // Keep multiple tabs in sync
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setFavourites(readStorage())
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [])

  const toggle = useCallback((routeId: string) => {
    setFavourites((prev) => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      writeStorage(next)
      return next
    })
  }, [])

  const isFavourite = useCallback((routeId: string) => favourites.has(routeId), [favourites])

  return { favourites, toggle, isFavourite }
}
