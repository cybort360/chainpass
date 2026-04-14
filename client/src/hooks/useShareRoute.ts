import { useCallback, useState } from "react"

export type ShareState = "idle" | "copied" | "error"

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function useShareRoute() {
  const [shareState, setShareState] = useState<ShareState>("idle")
  // Expose the URL so the UI can show it in an input as last resort
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const shareRoute = useCallback(async (routeId: string, routeName: string) => {
    const url = `${window.location.origin}/routes/${routeId}`
    setShareUrl(url)
    setShareState("idle")

    // 1. Native share sheet (mobile / desktop where supported)
    const shareData = { title: `ChainPass — ${routeName}`, text: `Buy a ticket for ${routeName}`, url }
    if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData)
        return
      } catch {
        // user cancelled — don't fall through to copy
        return
      }
    }

    // 2. Clipboard API (HTTPS / localhost)
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        setShareState("copied")
        setTimeout(() => setShareState("idle"), 2500)
        return
      } catch {
        // permission denied or insecure context — fall through
      }
    }

    // 3. execCommand fallback (HTTP or old browsers)
    if (fallbackCopy(url)) {
      setShareState("copied")
      setTimeout(() => setShareState("idle"), 2500)
      return
    }

    // 4. Nothing worked — show the URL so the user can copy manually
    setShareState("error")
  }, [])

  const clearShareUrl = useCallback(() => {
    setShareUrl(null)
    setShareState("idle")
  }, [])

  return { shareRoute, shareState, shareUrl, clearShareUrl }
}
