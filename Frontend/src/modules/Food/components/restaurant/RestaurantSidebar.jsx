import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { BarChart3, Boxes, Building2, ChevronLeft, ChevronRight, Clock, Compass, Copy, Download, FileText, Gift, Landmark, LifeBuoy, Map, Package, Star, Store, Tag, Utensils, Wallet } from "lucide-react"

/**
 * Desktop sidebar for the restaurant dashboard.
 * Mirrors the Food admin shell (fixed dark rail, collapsible) so both
 * dashboards read as one product. Hidden below `lg` — mobile keeps the
 * existing bottom nav.
 */

const isQcStore = () => {
  try { return localStorage.getItem("restaurant_vertical") === "qc" } catch { return false }
}

const getNavSections = (base) => [
  {
    label: "OPERATIONS",
    items: [
      { label: "Orders", path: `${base}`, icon: FileText, exact: true },
      { label: "All orders", path: `${base}/orders/all`, icon: Clock },
      { label: "Inventory", path: `${base}/inventory`, icon: Package },
      // Stores and medical stores count stock per size; restaurants do not.
      ...(isQcStore() ? [{ label: "Stock", path: `${base}/stock`, icon: Boxes }] : []),
      { label: "Menu categories", path: `${base}/menu-categories`, icon: Utensils },
      { label: "Reservations", path: `${base}/reservations`, icon: Store },
    ],
  },
  {
    label: "GROWTH",
    items: [
      { label: "Coupons", path: `${base}/coupon`, icon: Tag },
      { label: "Free item offers", path: `${base}/free-item-offers`, icon: Gift },
      { label: "Buy one get one", path: `${base}/bogo-offers`, icon: Copy },
      { label: "Combos", path: `${base}/combos`, icon: Boxes },
      { label: "Analytics", path: `${base}/analytics`, icon: BarChart3 },
      { label: "Ratings & reviews", path: `${base}/ratings-reviews`, icon: Star },
      { label: "Explore", path: `${base}/explore`, icon: Compass },
    ],
  },
  {
    label: "FINANCE",
    items: [
      { label: "Payouts", path: `${base}/hub-finance`, icon: Wallet },
      { label: "Withdrawals", path: `${base}/withdrawal-history`, icon: Landmark },
      { label: "Reports", path: `${base}/download-report`, icon: Download },
    ],
  },
  {
    label: "OUTLET",
    items: [
      { label: "Outlet info", path: `${base}/outlet-info`, icon: Building2 },
      { label: "Timings", path: `${base}/outlet-timings`, icon: Clock },
      { label: "Zones", path: `${base}/zone-setup`, icon: Map },
      { label: "Manage outlets", path: `${base}/manage-outlets`, icon: Store },
      { label: "Help centre", path: `${base}/help-centre/support`, icon: LifeBuoy },
    ],
  },
]

/** Fired after the outlet's name or photo is saved, so the sidebar re-reads them. */
export const RESTAURANT_PROFILE_UPDATED = "restaurantProfileUpdated"

/** The photo arrives as a bare URL on some responses and as `{ url }` on others. */
const photoOf = (restaurant) => {
  const candidate = restaurant?.profileImage
  if (!candidate) return ""
  return String(typeof candidate === "string" ? candidate : candidate.url || "").trim()
}

export default function RestaurantSidebar({ collapsed, onToggleCollapse, restaurant = null }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const base = pathname.startsWith("/food/restaurant") ? "/food/restaurant" : "/restaurant"
  const sections = useMemo(() => getNavSections(base), [base])

  const name = String(restaurant?.restaurantName || restaurant?.name || "").trim()
  const photo = photoOf(restaurant)
  // A photo that fails to load falls back to the icon rather than a broken image.
  const [photoFailed, setPhotoFailed] = useState(false)
  useEffect(() => setPhotoFailed(false), [photo])

  const isActive = (item) =>
    item.exact
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(`${item.path}/`)

  return (
    <aside
      className={`hidden lg:flex fixed left-0 top-0 bottom-0 z-40 flex-col overflow-hidden border-r border-neutral-800/60 bg-neutral-950 transition-[width] duration-300 ${
        collapsed ? "w-20" : "w-72"
      }`}
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-neutral-800/60 px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
          {photo && !photoFailed ? (
            <img
              src={photo}
              alt={name ? `${name} logo` : "Restaurant logo"}
              className="h-full w-full object-cover"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <Store className="h-5 w-5 text-black" />
          )}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="h-5 truncate text-sm font-semibold text-white" title={name || undefined}>
              {name}
            </p>
            <p className="truncate text-[11px] text-neutral-500">Partner dashboard</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.label} className="mb-5">
            {!collapsed && (
              <p className="mb-2 px-3 text-[10px] font-semibold tracking-wider text-neutral-600">
                {section.label}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon
                const active = isActive(item)
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-white text-black shadow-[0_4px_12px_rgba(255,255,255,0.15)]"
                        : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
                    } ${collapsed ? "justify-center" : ""}`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex h-12 shrink-0 items-center justify-center gap-2 border-t border-neutral-800/60 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-white"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <>
            <ChevronLeft className="h-4 w-4" />
            <span>Collapse</span>
          </>
        )}
      </button>
    </aside>
  )
}
