import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState, createContext, useContext } from "react"
import { ProfileProvider } from "@food/context/ProfileContext"
import LocationPrompt from "./LocationPrompt"
import { CartProvider } from "@food/context/CartContext"
import { OrdersProvider } from "@food/context/OrdersContext"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }

import SearchOverlay from "./SearchOverlay"
import BottomNavigation from "./BottomNavigation"
import DesktopNavbar from "./DesktopNavbar"
import { useUserNotifications } from "../../hooks/useUserNotifications"
import { applyFoodUserTheme } from "@/shared/utils/theme.js"

// Create SearchOverlay context with default value
const SearchOverlayContext = createContext({
  isSearchOpen: false,
  searchValue: "",
  setSearchValue: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  openSearch: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  closeSearch: () => { }
})

export function useSearchOverlay() {
  const context = useContext(SearchOverlayContext)
  // Always return context, even if provider is not available (will use default values)
  return context
}

function SearchOverlayProvider({ children }) {
  const location = useLocation()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")

  // Sync state with URL when the URL changes
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search)
    const urlQuery = searchParams.get("q") || ""
    setSearchValue(urlQuery)
  }, [location.search])

  const openSearch = () => {
    const searchParams = new URLSearchParams(location.search)
    const urlQuery = searchParams.get("q") || ""
    setSearchValue(urlQuery)
    setIsSearchOpen(true)
  }

  const closeSearch = () => {
    setIsSearchOpen(false)
    setSearchValue("")
  }

  return (
    <SearchOverlayContext.Provider value={{ isSearchOpen, searchValue, setSearchValue, openSearch, closeSearch }}>
      {children}
      {isSearchOpen && (
        <SearchOverlay
          isOpen={isSearchOpen}
          onClose={closeSearch}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
        />
      )}
    </SearchOverlayContext.Provider>
  )
}

// Create LocationSelector context with default value
const LocationSelectorContext = createContext({
  isLocationSelectorOpen: false,
  openLocationSelector: () => {
    debugWarn("LocationSelectorProvider not available")
  },
  closeLocationSelector: () => { }
})

export function useLocationSelector() {
  const context = useContext(LocationSelectorContext)
  if (!context) {
    throw new Error("useLocationSelector must be used within LocationSelectorProvider")
  }
  return context
}

function LocationSelectorProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()

  const openLocationSelector = () => {
    // Navigate to the standalone address selector page
    // Provide current pathname to state so back button returns here accurately
    navigate("/food/user/cart/address-selector", { state: { backTo: location.pathname } })
  }

  const closeLocationSelector = () => { }

  const value = {
    isLocationSelectorOpen: false,
    openLocationSelector,
    closeLocationSelector
  }

  return (
    <LocationSelectorContext.Provider value={value}>
      {children}
    </LocationSelectorContext.Provider>
  )
}

export default function UserLayout() {
  const location = useLocation()

  useEffect(() => {
    const syncFoodTheme = () => {
      applyFoodUserTheme()
    }

    syncFoodTheme()
    window.addEventListener("pageshow", syncFoodTheme)

    return () => {
      window.removeEventListener("pageshow", syncFoodTheme)
    }
  }, [location.pathname])

  useEffect(() => {
    // Reset scroll to top whenever location changes (pathname, search, or hash)
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname, location.search, location.hash])

  useUserNotifications()

  // Note: Authentication checks and redirects are handled by ProtectedRoute components
  // UserLayout should not interfere with authentication redirects

  // Show bottom navigation only on home page, dining page, under-250 page, and profile page
  const path = location.pathname.startsWith("/food")
    ? location.pathname.substring(5) || "/"
    : location.pathname
  const normalizedPath =
    path.length > 1 ? path.replace(/\/+$/, "") : path

  const isProfileRoot =
    normalizedPath === "/profile" ||
    normalizedPath === "/user/profile"

  const showBottomNav = normalizedPath === "/" ||
    normalizedPath === "/user" ||
    normalizedPath === "/dining" ||
    normalizedPath === "/user/dining" ||
    normalizedPath === "/under-250" ||
    normalizedPath === "/user/under-250" ||
    normalizedPath === "/user/search" ||
    isProfileRoot ||
    normalizedPath === "" // Handle empty string case for root relative to /food

  const isUnder250 = normalizedPath === "/under-250" || normalizedPath === "/user/under-250"

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] transition-colors duration-200">
      <CartProvider>
        <ProfileProvider>
          <OrdersProvider>
            <SearchOverlayProvider>
              <LocationSelectorProvider>
                {/* <Navbar /> */}
                {/* Desktop Navbar - Hidden on mobile, visible on medium+ screens */}
                <div className="hidden md:block">
                  {showBottomNav && <DesktopNavbar showLogo={!isUnder250} />}
                </div>
                <LocationPrompt />
                <main className={showBottomNav ? "md:pt-40" : ""}>
                  <Outlet />
                </main>
                {showBottomNav && <BottomNavigation />}
              </LocationSelectorProvider>
            </SearchOverlayProvider>
          </OrdersProvider>
        </ProfileProvider>
      </CartProvider>
    </div>
  )
}
