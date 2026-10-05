import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, lazy, useEffect, useLayoutEffect, useState, useRef } from 'react'
import { AppShellSkeleton } from '@food/components/ui/loading-skeletons'
import { applyFoodUserTheme, applySavedTheme, applyTheme } from '../shared/utils/theme.js'

const NATIVE_LAST_ROUTE_KEY = 'native_last_route'

// Eagerly import the Food and Taxi service modules for fast, smooth transitions without reloads
import FoodApp from '../modules/Food/routes'
import TaxiApp from '../modules/Taxi/TaxiApp'
const AuthApp = lazy(() => import('../modules/auth/routes'))
const HelpSupportPage = lazy(() => import('../modules/auth/pages/HelpSupportPage'))
const TermsPage = lazy(() => import('../modules/auth/pages/TermsPage'))
const PrivacyPage = lazy(() => import('../modules/auth/pages/PrivacyPage'))
const LandingPage = lazy(() => import('../modules/LandingPage/LandingPage'))
const PartnerApp = lazy(() => import('../modules/partner/PartnerApp'))
import ProtectedRoute from '@food/components/ProtectedRoute'

const PageLoader = () => <AppShellSkeleton />

/**
 * FoodAppWrapper — Quick-spicy App. को /food prefix के साथ render करता है.
 * 
 * Quick-spicy की App.jsx में routes /restaurant, /usermain, /admin, /delivery
 * जैसे hain (bina /food prefix ke). Yahan hum useLocation se /food ke baad wala
 * path nikalne ke baad FoodApp render karte hain. FoodApp internally BrowserRouter
 * nahi use karta (sirf Routes use karta hai), isliye ye directly kaam karta hai.
 */
const FoodAppWrapper = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <FoodApp />
    </Suspense>
  )
}

const TaxiAppWrapper = () => {
  return (
    <Suspense fallback={<PageLoader />}>
      <TaxiApp />
    </Suspense>
  )
}

const RedirectToFood = () => {
  const location = useLocation();
  // We safely replace the exact current pathname with a /food prefixed pathname
  // This effectively catches programmatic navigation to absolute paths like '/restaurant/login'
  // and turns them into '/food/restaurant/login'
  return <Navigate to={`/food${location.pathname}${location.search}`} replace />;
};


const AdminRouter = lazy(() => import('../modules/Food/components/admin/AdminRouter'))

const AppRoutes = () => {
  const location = useLocation()

  useLayoutEffect(() => {
    const syncThemeForCurrentRoute = () => {
      if (location.pathname.startsWith('/taxi/user')) {
        applyTheme('light')
        return
      }

      if (location.pathname.startsWith('/food/user')) {
        applyFoodUserTheme()
        return
      }

      applySavedTheme()
    }

    // Taxi user screens are currently designed as light-only. Keep the shared
    // user preference light so returning to Food does not create a mismatch.
    syncThemeForCurrentRoute()
    window.addEventListener('pageshow', syncThemeForCurrentRoute)

    return () => {
      window.removeEventListener('pageshow', syncThemeForCurrentRoute)
    }
  }, [location.pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const protocol = String(window.location?.protocol || '').toLowerCase()
    const userAgent = String(window.navigator?.userAgent || '').toLowerCase()
    const isNativeLikeShell =
      Boolean(window.flutter_inappwebview) ||
      Boolean(window.ReactNativeWebView) ||
      protocol === 'file:' ||
      userAgent.includes(' wv') ||
      userAgent.includes('; wv')

    if (!isNativeLikeShell) return

    const route = `${location.pathname || ''}${location.search || ''}`
    if (route.startsWith('/taxi/') || route.startsWith('/food/') || route.startsWith('/admin')) {
      localStorage.setItem(NATIVE_LAST_ROUTE_KEY, route)
    }
  }, [location.pathname, location.search])

  const [isTransitioning, setIsTransitioning] = useState(false)
  const prevPathRef = useRef(location.pathname)

  useEffect(() => {
    const prevPath = prevPathRef.current
    const currentPath = location.pathname

    const getModule = (path) => {
      if (path.startsWith('/taxi')) return 'taxi'
      if (path.startsWith('/food') || path.startsWith('/admin')) return 'food'
      return 'other'
    }

    const prevModule = getModule(prevPath)
    const currentModule = getModule(currentPath)

    if (prevModule !== currentModule) {
      setIsTransitioning(true)
      const timer = setTimeout(() => {
        setIsTransitioning(false)
      }, 600)
      prevPathRef.current = currentPath
      return () => clearTimeout(timer)
    }

    prevPathRef.current = currentPath
  }, [location.pathname])

  return (
    <>
      <Routes>
        {/* Root → Master Landing Page */}
        <Route path="/" element={<Suspense fallback={<PageLoader />}><LandingPage /></Suspense>} />

        {/* Auth Module */}
        <Route path="/login/*" element={<Suspense fallback={<PageLoader />}><AuthApp /></Suspense>} />

        {/* Partner sign-in and registration: restaurant, store, medical store */}
        <Route path="/partner/*" element={<Suspense fallback={<PageLoader />}><PartnerApp /></Suspense>} />

        {/* Support Module */}
        <Route path="/support" element={<Suspense fallback={<PageLoader />}><HelpSupportPage /></Suspense>} />

        {/* Legal & Policy Modules */}
        <Route path="/terms" element={<Suspense fallback={<PageLoader />}><TermsPage /></Suspense>} />
        <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><PrivacyPage /></Suspense>} />


        {/* Food Module */}
        <Route path="/food/*" element={<FoodAppWrapper />} />

        {/* Taxi Module */}
        <Route path="/taxi/*" element={<TaxiAppWrapper />} />

        {/* Global Admin Portal - AdminRouter handles its own protection for sub-routes */}
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<PageLoader />}>
              <AdminRouter />
            </Suspense>
          }
        />

        {/* Dynamic intercept redirects for bare paths (accessed programmatically) */}
        <Route path="/user/*" element={<RedirectToFood />} />
        <Route path="/restaurant/*" element={<RedirectToFood />} />
        <Route path="/delivery/*" element={<RedirectToFood />} />
        <Route path="/usermain/*" element={<RedirectToFood />} />
        <Route path="/profile/*" element={<RedirectToFood />} />
        <Route path="/cart/*" element={<Navigate to="/food/user/cart" replace />} />
        <Route path="/orders/*" element={<RedirectToFood />} />

        {/* Fallback 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

      export default AppRoutes
