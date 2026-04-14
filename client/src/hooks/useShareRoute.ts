import { useCallback, useState } from "react"

export function useShareRoute() {
  const [copied, setCopied] = useState(false)

  const shareRoute = useCallback(async (routeId: string, routeName: string) => {
    const url = `${window.location.origin}/routes/${routeId}`
    const shareData = {
      title: `ChainPass — ${routeName}`,
      text: `Buy a blockchain ticket for ${routeName}`,
      url,
    }
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData)
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // user cancelled share or clipboard unavailable — do nothing
    }
  }, [])

  return { shareRoute, copied }
}
