import { stableRouteIdDecimalForLabel } from "@chainpass/shared"

/** Demo routes aligned with `config/nigeria-routes.json` (labels + ids + categories). */
export type DemoRoute = {
  /** Decimal string uint256 route id (matches on-chain + URLs). */
  routeId: string
  /** UI section / filter (e.g. Lagos, North). */
  category: string
  name: string
  detail: string
}

const ROUTE_DEFS: Omit<DemoRoute, "routeId">[] = [
  {
    category: "Lagos",
    name: "Lagos BRT — CMS ↔ TBS",
    detail: "Island corridor (demo)",
  },
  {
    category: "Lagos",
    name: "Lagos BRT — Oshodi ↔ Mile 2",
    detail: "Mainland express link (demo)",
  },
  {
    category: "Lagos",
    name: "Lagos — Ajah ↔ Epe express",
    detail: "Lekki corridor (demo)",
  },
  {
    category: "Abuja & FCT",
    name: "Abuja BRT — Central ↔ Area 1",
    detail: "FCT shuttle (demo)",
  },
  {
    category: "South West",
    name: "Ibadan — Challenge ↔ Dugbe",
    detail: "City hop (demo)",
  },
  {
    category: "South South",
    name: "Port Harcourt — Town ↔ Mile 3",
    detail: "Urban ring segment (demo)",
  },
  {
    category: "South South",
    name: "Benin City — Ring Road loop",
    detail: "Short loop (demo)",
  },
  {
    category: "South South",
    name: "Calabar — Marina ↔ Airport road",
    detail: "Coastal link (demo)",
  },
  {
    category: "North",
    name: "Kano — Sabon Gari ↔ City centre",
    detail: "Northern hub (demo)",
  },
  {
    category: "North",
    name: "Kaduna — Rigasa ↔ Central market",
    detail: "Express segment (demo)",
  },
  {
    category: "South East",
    name: "Enugu — Okpara Square ↔ Market",
    detail: "Hill city shuttle (demo)",
  },
  {
    category: "Inter-city",
    name: "Lagos ↔ Ibadan (inter-city)",
    detail: "Long-distance shuttle (demo)",
  },
]

export const DEMO_ROUTES: DemoRoute[] = ROUTE_DEFS.map((r) => ({
  ...r,
  routeId: stableRouteIdDecimalForLabel(r.category, r.name),
}))
