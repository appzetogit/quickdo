import { useEffect, useState } from "react"
import { Outlet } from "react-router-dom"
import RestaurantSidebar, { RESTAURANT_PROFILE_UPDATED } from "./RestaurantSidebar"
import { restaurantAPI } from "@food/api"
import { getModuleToken } from "@food/utils/auth"

const SIDEBAR_STATE_KEY = "restaurant_sidebar_state"

/**
 * Desktop shell for the restaurant dashboard.
 *
 * The sidebar only appears for an APPROVED restaurant at `lg` and up — an
 * outlet still being onboarded or verified gets the plain page. Below `lg`
 * every page renders exactly as before, with its own navbar and bottom nav.
 */
export default function RestaurantLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [isApproved, setIsApproved] = useState(false)
  const [restaurant, setRestaurant] = useState(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_STATE_KEY)
      if (saved !== null) {
        const state = JSON.parse(saved)
        if (state && typeof state.isCollapsed !== "undefined") {
          setCollapsed(Boolean(state.isCollapsed))
        }
      }
    } catch {
      // Corrupt value; the default (expanded) is fine.
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const checkApproval = async () => {
      if (!getModuleToken("restaurant")) return
      try {
        const response = await restaurantAPI.getCurrentRestaurant()
        const restaurant =
          response?.data?.data?.restaurant ||
          response?.data?.restaurant ||
          response?.data?.data?.user ||
          response?.data?.user
        if (cancelled) return
        setIsApproved(String(restaurant?.status || "").toLowerCase() === "approved")
        // The sidebar shows this outlet's own name and photo, from the same
        // response rather than a second request.
        setRestaurant(restaurant || null)
      } catch {
        // Status unknown — stay on the plain layout rather than showing nav
        // an unapproved outlet shouldn't have.
      }
    }

    checkApproval()
    // Outlet info fires this after the name or photo changes, so the sidebar
    // does not keep showing the old ones until a reload.
    window.addEventListener(RESTAURANT_PROFILE_UPDATED, checkApproval)
    return () => {
      cancelled = true
      window.removeEventListener(RESTAURANT_PROFILE_UPDATED, checkApproval)
    }
  }, [])

  function handleToggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify({ isCollapsed: next }))
      } catch {
        // Storage unavailable (private mode); collapsing still works this session.
      }
      return next
    })
  }

  if (!isApproved) {
    return <Outlet />
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <RestaurantSidebar collapsed={collapsed} onToggleCollapse={handleToggleCollapse} restaurant={restaurant} />

      <div
        className={`min-h-screen transition-[margin] duration-300 ${
          collapsed ? "lg:ml-20" : "lg:ml-72"
        }`}
      >
        {/* Desktop pages sit in an elegant spacious container */}
        <div className="mx-auto w-full lg:max-w-7xl lg:px-6 lg:py-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
