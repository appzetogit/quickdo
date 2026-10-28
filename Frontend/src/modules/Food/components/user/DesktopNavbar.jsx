import { Link, useLocation, useNavigate } from "react-router-dom"
import { useEffect, useState, useRef } from "react"
import { ChevronDown, ShoppingCart, Wallet, Mic } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Switch } from "@food/components/ui/switch"
import { useLocation as useLocationHook } from "@food/hooks/useLocation"
import { useCart } from "@food/context/CartContext"
import { useLocationSelector } from "./UserLayout"
import { useProfile } from "@food/context/ProfileContext"
import { FaLocationDot } from "react-icons/fa6"
import { AnimatePresence, motion } from "framer-motion"
import quickSpicyLogo from "@food/assets/k9-logo.jpg"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import { useSettings } from "../../../Taxi/shared/context/SettingsContext"
import { useValueShelfCap, valueShelfName } from "@food/utils/valueShelf"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function DesktopNavbar({ showLogo = true }) {
    const { activeLogo } = useSettings()
    const location = useLocation()
    const navigate = useNavigate()
    const { location: userLocation, loading: locationLoading } = useLocationHook()
    const { getCartCount } = useCart()
    const { openLocationSelector } = useLocationSelector()
    const { vegMode, setVegMode } = useProfile()
    const [logoUrl, setLogoUrl] = useState(null)
    const [companyName, setCompanyName] = useState(null)
    const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false)
    const navRef = useRef(null)
    const cartCount = getCartCount()


    // Show area if available, otherwise show city
    // Priority: area > city > "Select"
    const areaName = userLocation?.area && userLocation?.area.trim() ? userLocation.area.trim() : null
    const cityName = userLocation?.city || null
    const stateName = userLocation?.state || null
    // Main location name: Show area if available, otherwise show city, otherwise "Select"
    const mainLocationName = areaName || cityName || "Select"
    // Secondary location: Show only city when area is available (as per design image)
    const secondaryLocation = areaName
        ? (cityName || "")  // Show only city when area is available
        : (cityName && stateName ? `${cityName}, ${stateName}` : cityName || stateName || "")

    const handleLocationClick = () => {
        // Open location selector overlay
        openLocationSelector()
    }

    // Check active routes - support both /user/* and /* paths
    const isDining = location.pathname === "/food/user/dining" || location.pathname === "/food/dining"
    const isUnder250 = location.pathname === "/food/user/under-250" || location.pathname === "/food/under-250"
    // Named after the price the shelf actually runs at, not a literal 99.
    const valueShelfCap = useValueShelfCap()
    const isProfile = location.pathname.startsWith("/food/user/profile") || location.pathname.startsWith("/food/profile")
    const isDelivery = !isDining && !isUnder250 && !isProfile && (location.pathname === "/food/user" || location.pathname === "/food" || (location.pathname.startsWith("/food/user") && !location.pathname.includes("/dining") && !location.pathname.includes("/under-250") && !location.pathname.includes("/profile")))
    const isBannerRoute =
        location.pathname === "/food/user" ||
        location.pathname === "/food" ||
        location.pathname === "/food/user/under-250" ||
        location.pathname === "/food/under-250"

    // Load business settings logo
    useEffect(() => {
        const loadLogo = async () => {
            try {
                const cached = getCachedSettings()
                if (cached) {
                    if (cached.logo?.url) {
                        setLogoUrl(cached.logo.url)
                    }
                    if (cached.companyName) {
                        setCompanyName(cached.companyName)
                    }
                } else {
                    const settings = await loadBusinessSettings()
                    if (settings) {
                        if (settings.logo?.url) {
                            setLogoUrl(settings.logo.url)
                        }
                        if (settings.companyName) {
                            setCompanyName(settings.companyName)
                        }
                    }
                }
            } catch (error) {
                debugError('Error loading logo:', error)
            }
        }
        loadLogo()

        // Listen for business settings updates
        const handleSettingsUpdate = () => {
            const cached = getCachedSettings()
            if (cached) {
                if (cached.logo?.url) {
                    setLogoUrl(cached.logo.url)
                }
                if (cached.companyName) {
                    setCompanyName(cached.companyName)
                }
            }
        }
        window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)

        return () => {
            window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
        }
    }, [])

    useEffect(() => {
        if (!isBannerRoute) {
            setHasScrolledPastBanner(true)
            return
        }

        const handleScroll = () => {
            const heroShell =
                document.querySelector('[data-home-hero-shell="true"]') ||
                document.querySelector('[data-banner-shell="true"]')
            const navElement = navRef.current

            if (!heroShell || !navElement) {
                setHasScrolledPastBanner(false)
                return
            }

            const heroRect = heroShell.getBoundingClientRect()
            const navHeight = navElement.getBoundingClientRect().height || 0
            setHasScrolledPastBanner(heroRect.bottom <= navHeight)
        }

        handleScroll()
        window.addEventListener("scroll", handleScroll, { passive: true })
        window.addEventListener("resize", handleScroll)

        return () => {
            window.removeEventListener("scroll", handleScroll)
            window.removeEventListener("resize", handleScroll)
        }
    }, [isBannerRoute])

    return (
        <nav
            ref={navRef}
            className={`hidden md:flex flex-col fixed top-0 left-0 right-0 z-50 py-2 transition-all duration-300 ${(isBannerRoute && !hasScrolledPastBanner)
                ? "bg-transparent !bg-transparent border-0 shadow-none"
                : "bg-white dark:bg-[#1a1a1a] border-b border-gray-200 dark:border-gray-800 shadow-sm"
                }`}
        >
            {/* Top Row: Location - Search - Icons */}
            <div className={`w-full ${(isBannerRoute && !hasScrolledPastBanner) ? "border-b border-transparent" : "border-b border-gray-100 dark:border-gray-800"}`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16 gap-4">
                        {/* Left: Logo & Location */}
                        <div className="flex items-center gap-4 lg:gap-6 flex-shrink-0">
                            {/* Logo */}
                            {showLogo && (
                                <Link to="/food/user" className="flex items-center justify-center flex-shrink-0">
                                    {activeLogo || logoUrl || companyName ? (
                                        <img
                                            src={activeLogo || logoUrl || quickSpicyLogo}
                                            alt={companyName || "Company Logo"}
                                            className="h-10 w-auto md:h-14 lg:h-16 object-contain"
                                            onError={(e) => {
                                                if (e.target.src !== quickSpicyLogo) {
                                                    e.target.src = quickSpicyLogo
                                                }
                                            }}
                                        />
                                    ) : (
                                        <img src={activeLogo || quickSpicyLogo} alt={companyName || "Logo"} className="h-10 w-auto md:h-14 lg:h-16 object-contain" />
                                    )}
                                </Link>
                            )}

                            {/* Location Selector */}
                            <Button
                                variant="ghost"
                                onClick={handleLocationClick}
                                disabled={locationLoading}
                                className="h-auto px-0 py-0 hover:bg-transparent transition-colors flex-shrink-0"
                            >
                                {locationLoading ? (
                                    <span className="text-sm font-bold text-black dark:text-white">
                                        Loading...
                                    </span>
                                ) : (
                                    <div className="flex flex-col items-start min-w-0">
                                        <div className="flex items-center gap-1.5 lg:gap-2">
                                            <FaLocationDot
                                                className="h-5 w-5 lg:h-6 lg:w-6 text-black dark:text-white flex-shrink-0"
                                                fill="currentColor"
                                                strokeWidth={2}
                                            />
                                            <span className="text-sm lg:text-base font-bold text-black dark:text-white whitespace-nowrap">
                                                {mainLocationName}
                                            </span>
                                            <ChevronDown className="h-4 w-4 lg:h-5 lg:w-5 text-black dark:text-white flex-shrink-0" strokeWidth={2.5} />
                                        </div>
                                        {secondaryLocation && (
                                            <span className="text-xs lg:text-sm font-bold text-gray-600 dark:text-gray-400 mt-0.5 whitespace-nowrap">
                                                {secondaryLocation}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </Button>
                        </div>

                        {/* Center: Veg Mode */}
                        <div className="flex-1 max-w-3xl mx-4 flex items-center justify-center">
                            {/* VEG MODE Toggle */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 leading-none">VEG</span>
                                    <span className="text-[8px] font-bold text-gray-500 dark:text-gray-400 leading-none">MODE</span>
                                </div>
                                <Switch
                                    checked={vegMode}
                                    onCheckedChange={setVegMode}
                                    className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-gray-300 dark:data-[state=unchecked]:bg-gray-600 h-5 w-9"
                                />
                            </div>
                        </div>

                        {/* Right: Wallet and Cart Icons */}
                        <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
                            {/* Wallet Icon */}
                            <Link to="/food/user/wallet">
                                <Button
                                    variant="ghost"
                                    className="h-12 w-12 lg:h-14 lg:w-14 rounded-full p-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    title="Wallet"
                                >
                                    <Wallet className="!h-5 !w-5 lg:!h-6 lg:!w-6 text-gray-700 dark:text-gray-300" strokeWidth={2} />
                                </Button>
                            </Link>

                            {/* Cart Icon */}
                            <Link to="/food/user/cart">
                                <Button
                                    variant="ghost"
                                    className="relative h-12 w-12 lg:h-14 lg:w-14 rounded-full p-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                    title="Cart"
                                >
                                    <ShoppingCart className="!h-5 !w-5 lg:!h-6 lg:!w-6 text-gray-700 dark:text-gray-300" strokeWidth={2} />
                                    {cartCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
                                            <span className="text-xs font-bold text-white">{cartCount > 99 ? "99+" : cartCount}</span>
                                        </span>
                                    )}
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Row: Navigation Tabs & Veg Mode */}
            <div className={`w-full pb-3 ${(isBannerRoute && !hasScrolledPastBanner) ? "bg-transparent !bg-transparent" : "bg-white dark:bg-[#1a1a1a]"}`}>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-center h-12">
                        {/* Navigation Tabs - Centered with spacing */}
                        <div className="flex items-center space-x-24">
                            {/* Delivery Tab */}
                            <Link
                                to="/food/user"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isDelivery
                                    ? "text-accent-orange dark:text-primary-orange/50"
                                    : "text-gray-600 dark:text-gray-400 hover:text-accent-orange dark:hover:text-primary-orange/50"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Delivery</span>
                                {isDelivery && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-accent-orange dark:bg-primary-orange/50"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>

                            {/* Value shelf tab */}
                            <Link
                                to="/food/user/under-250"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isUnder250
                                    ? "text-accent-orange dark:text-primary-orange/50"
                                    : "text-gray-600 dark:text-gray-400 hover:text-accent-orange dark:hover:text-primary-orange/50"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">{valueShelfName(valueShelfCap)}</span>
                                {isUnder250 && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-accent-orange dark:bg-primary-orange/50"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>

                            {/* Dining Tab */}
                            <Link
                                to="/food/user/dining"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isDining
                                    ? "text-accent-orange dark:text-primary-orange/50"
                                    : "text-gray-600 dark:text-gray-400 hover:text-accent-orange dark:hover:text-primary-orange/50"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Dining</span>
                                {isDining && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-accent-orange dark:bg-primary-orange/50"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>

                            {/* Profile Tab */}
                            <Link
                                to="/food/user/profile"
                                className={`flex flex-col items-center gap-1 px-2 py-1 transition-colors relative group ${isProfile
                                    ? "text-accent-orange dark:text-primary-orange/50"
                                    : "text-gray-600 dark:text-gray-400 hover:text-accent-orange dark:hover:text-primary-orange/50"
                                    }`}
                            >
                                <span className="text-sm font-bold tracking-wide uppercase">Profile</span>
                                {isProfile && (
                                    <motion.div
                                        layoutId="navIndicator"
                                        className="absolute -bottom-3 left-0 right-0 h-0.5 bg-accent-orange dark:bg-primary-orange/50"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    />
                                )}
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    )
}



