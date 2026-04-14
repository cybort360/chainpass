import { useEffect, useState } from "react"

export type Theme = "dark" | "light"
const STORAGE_KEY = "chainpass_theme"

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme)
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === "light" || saved === "dark") return saved as Theme
    } catch {}
    // Respect OS preference as default
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light"
    }
    return "dark"
  })

  useEffect(() => {
    applyTheme(theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  }, [theme])

  // Apply theme immediately on first render (before paint)
  useEffect(() => { applyTheme(theme) }, [])

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"))

  return { theme, toggle }
}
