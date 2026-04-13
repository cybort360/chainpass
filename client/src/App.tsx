import { Routes, Route } from "react-router-dom"
import { LandingPage } from "./components/landing/LandingPage"
import { AppLayout } from "./layouts/AppLayout"
import { RoutesPage } from "./pages/RoutesPage"
import { RoutePurchasePage } from "./pages/RoutePurchasePage"
import { PassPage } from "./pages/PassPage"
import { AdminPage } from "./pages/AdminPage"
import { ConductorPage } from "./pages/ConductorPage"
import { OperatorPage } from "./pages/OperatorPage"
import { ProfilePage } from "./pages/ProfilePage"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route element={<AppLayout />}>
        <Route path="routes" element={<RoutesPage />} />
        <Route path="routes/:routeId" element={<RoutePurchasePage />} />
        <Route path="pass/:tokenId" element={<PassPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="conductor" element={<ConductorPage />} />
        <Route path="operator" element={<OperatorPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
    </Routes>
  )
}
