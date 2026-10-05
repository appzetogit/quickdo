import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { Lock } from "lucide-react"
import { adminSidebarMenu } from "@food/utils/adminSidebarMenu"
import { rebaseAdminMenu } from "./AdminSidebar"
import {
  useAdminAccess,
  isRestricted,
  canOpenPath,
  panelOfPath,
  hasPanel,
  firstOpenPath,
} from "@food/utils/adminAccess"

const PANELS = [
  { service: "food", base: "/admin/food", label: "Food" },
  { service: "quickCommerce", base: "/admin/quick-commerce", label: "Quick Commerce" },
  { service: "medical", base: "/admin/medical", label: "Medical" },
  { service: "taxi", base: "/taxi/admin/dashboard", label: "Taxi" },
]

/** First screen this admin can open in a panel, or null. */
function landingFor(access, panel) {
  if (panel.service === "taxi") return panel.base
  return firstOpenPath(rebaseAdminMenu(adminSidebarMenu, panel.base), access)
}

/**
 * Stands in front of every admin screen. A sub-admin who follows an old link,
 * a bookmark, or lands on a dashboard they were not given is taken to the first
 * screen they can use -- or told plainly that this one is not theirs -- instead
 * of meeting a page whose every request fails.
 */
export default function AdminPageGate({ children }) {
  const access = useAdminAccess()
  const location = useLocation()
  const navigate = useNavigate()

  if (!isRestricted(access) || canOpenPath(access, location.pathname)) return children
  if (!access) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-neutral-500">
        Loading your access…
      </div>
    )
  }

  const here = panelOfPath(location.pathname)
  const panels = PANELS.filter((p) => hasPanel(access, p.service))
    .map((p) => ({ ...p, to: landingFor(access, p) }))
    .filter((p) => p.to)

  // Arriving at a panel's home (the login redirect does this): go straight to
  // the first screen they have, in this panel if they have it, else another.
  const atPanelHome = here && location.pathname.replace(/\/$/, "") === here.base
  const samePanel = here && panels.find((p) => p.service === here.service)
  if (atPanelHome || !here) {
    const target = samePanel?.to || panels[0]?.to
    if (target && target !== location.pathname) return <Navigate to={target} replace />
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
          <Lock className="h-5 w-5 text-neutral-500" />
        </div>
        <h1 className="text-lg font-semibold text-neutral-900">This page isn&apos;t part of your access</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your sidebar lists the sections you can open. If you need this one, ask the admin who manages your account.
        </p>
        {panels.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {panels.map((p) => (
              <button
                key={p.service}
                type="button"
                onClick={() => navigate(p.to)}
                className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-900"
              >
                Open {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
