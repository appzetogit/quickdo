import { useEffect, useSyncExternalStore } from "react"
import { adminAccountsAPI } from "@food/api"

/**
 * What the signed-in admin may open, shared by every admin panel.
 *
 * The server is the gate (core/admin/adminAccessPolicy.js refuses anything not
 * granted). This decides what the panel SHOWS, so a sub-admin is not offered
 * sections that would only answer "no access". It is fetched fresh from
 * /platform/admins/me rather than read off the login response, so a change made
 * by a superadmin shows on the sub-admin's next page load, not their next login.
 */

const STORAGE_KEY = "admin_access"
const listeners = new Set()
let state = readStored()
let inflight = null

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function setState(next) {
  state = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage unavailable: the in-memory copy still works for this tab */
  }
  listeners.forEach((fn) => fn())
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetches the access record, retrying a few times: until it arrives the panels
 * show nothing (see hasAdminSession), so a busy server (429) or a blip must not
 * leave a sub-admin on an empty or, worse, unfiltered panel.
 */
export function refreshAdminAccess() {
  if (inflight) return inflight
  inflight = (async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const res = await adminAccountsAPI.me()
        const data = res?.data?.data || null
        if (data) setState(data)
        return data
      } catch (err) {
        const status = err?.response?.status
        if (status === 401 || status === 403) return state
        await wait(800 * 2 ** attempt)
      }
    }
    return state
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export const clearAdminAccess = () => setState(null)

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The signed-in admin's id, read from the admin token. */
function tokenAdminId() {
  try {
    const token = localStorage.getItem("admin_accessToken")
    if (!token) return null
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    return String(payload.userId || payload.sub || payload.id || "") || null
  } catch {
    return null
  }
}

/** Is an admin signed in at all? (Then access unknown means "still loading", not "everything".) */
export const hasAdminSession = () => {
  try {
    return Boolean(localStorage.getItem("admin_accessToken"))
  } catch {
    return false
  }
}

// Signing out (or in as someone else) removes the stored copy; drop the
// in-memory one with it so the next admin never sees the last one's menu. A
// copy that belongs to a different account than the token is dropped too.
const snapshot = () => {
  try {
    if (state && !localStorage.getItem(STORAGE_KEY)) state = null
    const who = tokenAdminId()
    if (state && who && state.id && String(state.id) !== who) {
      state = null
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* keep the in-memory copy */
  }
  return state
}

/** The access record, refreshed once per mount of the panel. Null until known. */
export function useAdminAccess() {
  const access = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    refreshAdminAccess()
  }, [])
  return access
}

/* ------------------------------------------------------------ permissions */

export const isRestricted = (access) =>
  access ? access.isSuperAdmin === false : hasAdminSession()

export function can(access, resource, action = "read") {
  if (!isRestricted(access)) return true
  if (!access) return false
  const perms = access.permissions || []
  if (perms.includes("*")) return true
  if (!resource) return true
  return perms.includes(`${resource}.write`) || (action === "read" && perms.includes(`${resource}.read`))
}

export function hasPanel(access, service) {
  if (!isRestricted(access)) return true
  if (!access) return false
  return (access.servicesAccess || []).includes(service)
}

/* ---------------------------------------------------------------- pages */

const PANEL_BASES = [
  { base: "/admin/quick-commerce", service: "quickCommerce" },
  { base: "/admin/food", service: "food" },
]

export const panelOfPath = (pathname = "") =>
  PANEL_BASES.find((p) => pathname === p.base || pathname.startsWith(`${p.base}/`)) || null

/*
 * Screen paths (after the panel base) to the permission they need. Ordered:
 * the first matching prefix wins, so specific entries sit above general ones.
 * Mirrors the server's API table closely enough that a screen shown here does
 * not immediately 403 on its own data.
 */
const PAGE_RULES = [
  ["/management/admins", "subadmins"],
  ["/stock", "foods"],
  ["/point-of-sale", "pos"],
  ["/status-monitor", "dashboard"],
  ["/food-approval", "foods"],
  ["/foods", "foods"],
  ["/addons", "foods"],
  ["/global-pricing", "foods"],
  ["/categories", "categories"],
  ["/zone-setup", "zones"],
  ["/restaurants/complaints", "support"],
  ["/restaurants", "restaurants"],
  // Quick shows the same seller pages under /stores.
  ["/stores/complaints", "support"],
  ["/stores", "restaurants"],
  ["/free-delivery", "restaurants"],
  ["/delivery-radius", "restaurants"],
  ["/orders", "orders"],
  ["/order-detect-delivery", "orders"],
  ["/order-refunds", "orders"],
  ["/coupons", "promotions"],
  ["/99-store", "promotions"],
  ["/cashback", "promotions"],
  ["/referral-settings", "referrals"],
  ["/customers", "customers"],
  ["/support-tickets", "support"],
  ["/delivery-support-tickets", "support"],
  ["/contact-messages", "support"],
  ["/safety-emergency-reports", "support"],
  ["/fee-settings", "fee_settings"],
  ["/packaging-charges", "fee_settings"],
  ["/delivery-withdrawal", "wallet"],
  ["/delivery-boy-wallet", "wallet"],
  ["/restaurant-withdraws", "wallet"],
  ["/delivery-cash-limit", "delivery"],
  ["/cash-limit-settlement", "delivery"],
  ["/delivery-emergency-help", "delivery"],
  ["/delivery-partners", "delivery"],
  ["/transaction-report", "reports"],
  ["/order-report", "reports"],
  ["/tax-report", "reports"],
  ["/restaurant-report", "reports"],
  ["/customer-report", "reports"],
  ["/hero-banner-management", "cms"],
  ["/promotional-banner", "cms"],
  ["/banners", "cms"],
  ["/broadcast-notification", "cms"],
  ["/pages-social-media", "cms"],
  ["/business-setup", "settings"],
  ["/map-settings", "settings"],
  ["/petpooja-settings", "settings"],
  ["/order-cancellation", "settings"],
]

export function resourceForPath(pathname = "") {
  // Admin accounts sit under Master but are open to anyone given "Admin accounts".
  if (pathname.startsWith("/admin/master/admins")) return "subadmins"
  // The support inbox shows each admin only the services they have support for.
  if (pathname.startsWith("/admin/master/support")) return "support"
  // So is the coupon list, per service, under Offers & coupons.
  if (pathname.startsWith("/admin/master/coupons")) return "promotions"
  // And the earnings report, per service, under Reports.
  if (pathname.startsWith("/admin/master/platform-earnings")) return "reports"
  // And home-screen banners, per service, under Banners & pages.
  if (pathname.startsWith("/admin/master/home-screen")) return "cms"
  // And the commission overview, under the permission that sets seller rates.
  if (pathname.startsWith("/admin/master/commission")) return "restaurants"
  // Zone settings: a sub-admin sets these for their own zones only (the server
  // refuses anything wider -- core/admin/zoneAdminSettings.js).
  if (pathname.startsWith("/admin/master/delivery-earnings")) return "zone_earnings"
  if (pathname.startsWith("/admin/master/delivery-incentives")) return "zone_incentives"
  if (pathname.startsWith("/admin/master/cancellation")) return "zone_orders"
  if (pathname.startsWith("/admin/master/fees")) return "zone_fees"
  // Master's rider and driver pages: the same permission as in the Food and Taxi panels.
  if (pathname.startsWith("/admin/master/delivery-partners")) return "delivery"
  if (pathname.startsWith("/admin/master/taxi-drivers")) return "delivery"
  if (pathname.startsWith("/admin/master/partner-documents")) return "delivery"
  if (pathname.startsWith("/admin/master")) return "__owner__"
  const panel = panelOfPath(pathname)
  if (!panel) return null
  const rest = pathname.slice(panel.base.length) || "/"
  if (rest === "/" || rest === "") return "dashboard"
  const hit = PAGE_RULES.find(([prefix]) => rest === prefix || rest.startsWith(`${prefix}/`) || rest.startsWith(prefix))
  return hit ? hit[1] : null
}

/*
 * Taxi and Services screens, reached from the Master menu. Taxi's own panel
 * filters its menu by its own table; these only need to answer "may this
 * sub-admin see the link", so the section is enough.
 */
const TAXI_PAGE_RULES = [
  ["/taxi/admin/drivers", "delivery"],
  ["/taxi/admin/reports", "reports"],
  ["/taxi/admin/promotions/promo-codes", "promotions"],
  ["/taxi/admin/promotions", "cms"],
  ["/taxi/admin/referrals", "referrals"],
  ["/taxi/admin/users", "customers"],
  ["/taxi/admin/support", "support"],
  ["/taxi/admin/safety", "support"],
  ["/taxi/admin/settings", "settings"],
]

/** Can this admin open the screen at `pathname`? */
export function canOpenPath(access, pathname) {
  if (!isRestricted(access)) return true
  // The Services admin is for superadmins only (its own isSuperAdmin guard).
  if (pathname.startsWith("/admin/sp")) return false
  if (pathname.startsWith("/taxi/admin")) {
    if (!hasPanel(access, "taxi")) return false
    const hit = TAXI_PAGE_RULES.find(([prefix]) => pathname.startsWith(prefix))
    return can(access, hit ? hit[1] : "settings", "read")
  }
  const resource = resourceForPath(pathname)
  if (resource === "__owner__") return false
  const panel = panelOfPath(pathname)
  if (panel && !hasPanel(access, panel.service)) return false
  return can(access, resource, "read")
}

/** Drop every menu entry the admin cannot open; sections left empty go too. */
export function filterMenuForAccess(nodes = [], access) {
  if (!isRestricted(access)) return nodes
  return nodes
    .map((node) => {
      const children = node.items || node.subItems
      if (Array.isArray(children)) {
        const kept = filterMenuForAccess(children, access)
        if (!kept.length) return null
        return node.items ? { ...node, items: kept } : { ...node, subItems: kept }
      }
      if (node.path) return canOpenPath(access, node.path) ? node : null
      return node
    })
    .filter(Boolean)
}

/** The first screen a restricted admin can open in this menu, for redirects. */
export function firstOpenPath(nodes = [], access) {
  for (const node of filterMenuForAccess(nodes, access)) {
    if (node.path) return node.path
    const children = node.items || node.subItems || []
    const inner = firstOpenPath(children, access)
    if (inner) return inner
  }
  return null
}
