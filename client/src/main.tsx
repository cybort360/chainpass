import { Buffer } from "buffer"
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).Buffer ??= Buffer
}

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import "./index.css"
import App from "./App.tsx"
import { AppProviders } from "./providers/AppProviders.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
)
