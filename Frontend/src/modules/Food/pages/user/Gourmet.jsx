import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Star, Clock, Bookmark, BadgePercent, Sparkles, UtensilsCrossed } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Card, CardContent } from "@food/components/ui/card"
import api from "@food/api"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { toast } from "sonner"
import { API_BASE_URL } from "@food/api/config"
import OptimizedImage from "@food/components/OptimizedImage"
import { RestaurantGridSkeleton } from "@food/components/ui/loading-skeletons"
import { useDelayedLoading } from "@food/hooks/useDelayedLoading"
import { useLocation } from "@food/hooks/useLocation"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Animation Variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 }
  }
}

export default function Gourmet() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [favorites, setFavorites] = useState(new Set())
  const [gourmetRestaurants, setGourmetRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { location } = useLocation()
  const showGourmetSkeleton = useDelayedLoading(loading)

  const backendOrigin = (API_BASE_URL || "").replace(/\/api\/v1\/?$/, "")

  const resolveImageUrl = (url) => {
    if (typeof url !== "string") return ""
    const trimmed = url.trim()
    if (!trimmed) return ""
    if (/^(https?:|\/\/|data:|blob:)/i.test(trimmed)) return trimmed
    if (!backendOrigin) return trimmed
    return `${backendOrigin.replace(/\/$/, "")}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`
  }

  // Fetch Gourmet restaurants from public API
  useEffect(() => {
    const fetchGourmetRestaurants = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await api.get('/food/showcase-items/gourmet/public')
        const data = response?.data?.data
        const list = data?.restaurants ?? (Array.isArray(data) ? data : [])
        setGourmetRestaurants(list)
      } catch (err) {
        debugError('Error fetching Gourmet restaurants:', err)
        const errorMessage = err?.response?.data?.message || err?.message || 'Failed to load Gourmet restaurants'
        setError(errorMessage)
        toast.error(errorMessage)
        setGourmetRestaurants([])
      } finally {
        setLoading(false)
      }
    }

    fetchGourmetRestaurants()
  }, [])

  const toggleFavorite = (id) => {
    setFavorites(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  return (
    <div className="relative min-h-screen bg-[#f8f9fa] dark:bg-[#0a0a0a] overflow-x-clip">
      {/* Animated Background Blobs matching Home Theme */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-0 right-0 w-[400px] sm:w-[600px] h-[400px] sm:h-[600px] rounded-full bg-gradient-to-br from-[#d82c23]/30 to-[#ff6d00]/10 blur-[80px] sm:blur-[100px] animate-[blob_8s_ease-in-out_infinite]" />
        <div className="absolute top-[40%] left-[-10%] w-[300px] sm:w-[500px] h-[300px] sm:h-[500px] rounded-full bg-gradient-to-tr from-[#ff6d00]/20 to-[#d82c23]/10 blur-[80px] sm:blur-[80px] animate-[blob-reverse_10s_ease-in-out_infinite]" />
      </div>
      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, -30px) scale(1.2); }
        }
        @keyframes blob-reverse {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-40px, 40px) scale(1.3); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
      `}</style>

      {/* Main Content Wrapper */}
      <div className="relative z-10 pb-20">
        
        {/* Dynamic Theme Banner Background Elements */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative w-full overflow-hidden h-[30vh] md:h-[35vh] lg:h-[40vh] rounded-b-[32px] md:rounded-b-[48px] shadow-[0_10px_30px_rgba(216,44,35,0.2)] bg-gradient-to-r from-[#d82c23] to-[#ff6d00]"
        >
          {/* Back Button */}
          <button 
            onClick={goBack}
            className="absolute top-5 left-4 md:top-8 md:left-8 z-30 w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.1)] active:scale-95 border border-white/40"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          
          <div className="absolute inset-0 z-0 overflow-hidden">
            {/* Animated Circles */}
            <div className="absolute top-[-20%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-white/10 blur-[40px] animate-[pulse_6s_ease-in-out_infinite]"></div>
            <div className="absolute bottom-[-20%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-[#ff9d4a]/20 blur-[60px] animate-[pulse_8s_ease-in-out_infinite]"></div>
            
            {/* Decorative Grid Pattern */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xNSkiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent)]"></div>
          </div>
          
          {/* Dynamic Banner Content */}
          <div className="absolute inset-0 z-10 flex flex-col justify-center px-6 md:px-12 items-center text-center">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="flex items-center gap-2 mb-3"
            >
              <div className="p-1.5 bg-white/20 backdrop-blur-md rounded-lg shadow-sm border border-white/20">
                <UtensilsCrossed className="w-5 h-5 text-white animate-[pulse_3s_linear_infinite]" />
              </div>
              <span className="text-white/90 font-bold text-xs sm:text-sm tracking-[0.2em] uppercase bg-white/10 backdrop-blur-sm px-4 py-1.5 rounded-full border border-white/10">Savor the Exquisite</span>
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.6, type: "spring" }}
              className="text-5xl sm:text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/70 drop-shadow-lg tracking-tight leading-tight"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              GOURMET
            </motion.h1>
          </div>
          
          {/* Giant Floating Icon */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.8, rotate: 10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ delay: 0.5, duration: 0.8, type: "spring" }}
            className="absolute -left-10 top-1/2 -translate-y-1/2 opacity-10 pointer-events-none hidden sm:block"
          >
            <Sparkles className="w-80 h-80 text-white" />
          </motion.div>
        </motion.div>

        {/* Content */}
        <div className="px-4 sm:px-6 md:px-8 lg:px-10 py-8 md:py-12 space-y-8 md:space-y-12">
          <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
            {/* Header */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="mb-2 flex items-center gap-3"
            >
              <div className="h-10 w-2 bg-gradient-to-b from-[#d82c23] to-[#ff6d00] rounded-full shadow-[0_0_10px_rgba(255,109,0,0.5)]"></div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-gray-100 tracking-tight">Premium Gourmet Restaurants</h1>
                <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 mt-1 font-medium">Exquisite dining experiences delivered to your doorstep</p>
              </div>
            </motion.div>

            {/* Restaurant Count */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="flex items-center gap-2"
            >
              <span className="px-3 py-1 bg-[#ff6d00]/10 text-[#d82c23] dark:text-[#ff9d4a] rounded-full text-xs font-bold tracking-wider uppercase">
                {showGourmetSkeleton ? '...' : gourmetRestaurants.length} GOURMET RESTAURANTS
              </span>
            </motion.div>

            {/* Loading State */}
            {showGourmetSkeleton && <RestaurantGridSkeleton count={4} />}

            {/* Error State */}
            {error && !loading && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-20 bg-white dark:bg-[#111111] rounded-[32px] shadow-sm border border-red-100 dark:border-red-900/30"
              >
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                  <ArrowLeft className="w-8 h-8 text-red-500" />
                </div>
                <p className="text-red-500 dark:text-red-400 font-bold text-lg text-center mb-4">{error}</p>
                <Button onClick={() => window.location.reload()} className="bg-gradient-to-r from-[#d82c23] to-[#ff6d00] hover:shadow-lg hover:-translate-y-1 transition-all rounded-full px-8">Retry</Button>
              </motion.div>
            )}

            {/* Restaurant Cards */}
            {!showGourmetSkeleton && !error && (
              <AnimatePresence>
                {gourmetRestaurants.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="col-span-full text-center py-24 bg-white/50 dark:bg-[#111111]/50 backdrop-blur-md rounded-[32px] border border-gray-100 dark:border-gray-800"
                  >
                    <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                      <UtensilsCrossed className="w-10 h-10 text-gray-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Gourmet restaurants available</h3>
                    <p className="text-gray-500 dark:text-gray-400">Please check back later for new premium dining options.</p>
                  </motion.div>
                ) : (
                  <motion.div 
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8"
                  >
                    {gourmetRestaurants.map((item) => {
                      const restaurant = item.restaurant || item
                      const restaurantSlug = restaurant.slug || restaurant.restaurantName?.toLowerCase().replace(/\s+/g, "-") || restaurant.name?.toLowerCase().replace(/\s+/g, "-") || ""
                      const restaurantId = restaurant._id || restaurant.restaurantId || restaurant.id
                      const isFavorite = favorites.has(restaurantId)

                      // Calculate distance if coordinates are available
                      const calculateDistance = (lat1, lng1, lat2, lng2) => {
                        const R = 6371; // Earth's radius in kilometers
                        const dLat = ((lat2 - lat1) * Math.PI) / 180;
                        const dLng = ((lng2 - lng1) * Math.PI) / 180;
                        const a =
                          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                          Math.cos((lat1 * Math.PI) / 180) *
                            Math.cos((lat2 * Math.PI) / 180) *
                            Math.sin(dLng / 2) *
                            Math.sin(dLng / 2);
                        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                        return R * c; // Distance in kilometers
                      };

                      let distanceStr = '1.2 km'
                      const restaurantLat = restaurant.location?.latitude || restaurant.location?.coordinates?.[1]
                      const restaurantLng = restaurant.location?.longitude || restaurant.location?.coordinates?.[0]
                      
                      if (location?.latitude && location?.longitude && restaurantLat && restaurantLng) {
                        const d = calculateDistance(location.latitude, location.longitude, restaurantLat, restaurantLng)
                        distanceStr = `${d.toFixed(1)} km`
                      } else if (restaurant.distance) {
                        distanceStr = restaurant.distance
                      }

                      // Get restaurant cover image with priority: coverImages > menuImages > profileImage
                      const coverImages = restaurant.coverImages && restaurant.coverImages.length > 0
                        ? restaurant.coverImages.map(img => img.url || img).filter(Boolean)
                        : []

                      const menuImages = restaurant.menuImages && restaurant.menuImages.length > 0
                        ? restaurant.menuImages.map(img => img.url || img).filter(Boolean)
                        : []

                      const rawRestaurantImage =
                        coverImages.length > 0
                          ? coverImages[0]
                          : (menuImages.length > 0
                            ? menuImages[0]
                            : (restaurant.profileImage?.url || restaurant.profileImage || restaurant.image || ""))

                      const restaurantImage = resolveImageUrl(rawRestaurantImage)

                      return (
                        <motion.div key={restaurantId} variants={itemVariants}>
                          <Link to={`/user/restaurants/${restaurantSlug}`} className="block w-full h-full">
                            <motion.div 
                              whileHover={{ y: -6, scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              className="group h-full bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-xl rounded-[28px] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:shadow-[0_16px_40px_rgba(216,44,35,0.12)] border border-gray-100/50 dark:border-gray-800/50 transition-all duration-300 flex flex-col"
                            >
                              {/* Image Section */}
                              <div className="relative h-48 sm:h-56 w-full overflow-hidden">
                                {restaurantImage ? (
                                  <OptimizedImage
                                    src={restaurantImage}
                                    alt={restaurant.restaurantName || restaurant.name}
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out"
                                  />
                                ) : (
                                  <div className="w-full h-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                    <UtensilsCrossed className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                                  </div>
                                )}
                                
                                {/* Overlay Gradient */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-300"></div>

                                {/* Bookmark Icon */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute top-4 right-4 h-10 w-10 bg-white/20 hover:bg-white/90 backdrop-blur-md rounded-full transition-all shadow-sm z-10"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    toggleFavorite(restaurantId)
                                  }}
                                >
                                  <Bookmark className={`h-5 w-5 ${isFavorite ? "fill-[#d82c23] text-[#d82c23]" : "text-white"}`} strokeWidth={2} />
                                </Button>
                              </div>

                              {/* Content Section */}
                              <div className="p-5 sm:p-6 flex flex-col flex-grow">
                                {/* Restaurant Name & Rating */}
                                <div className="flex items-start justify-between gap-3 mb-3">
                                  <div className="flex-1 min-w-0">
                                    <h3 className="text-xl font-black text-gray-900 dark:text-white line-clamp-1 group-hover:text-[#d82c23] transition-colors">
                                      {restaurant.restaurantName || restaurant.name}
                                    </h3>
                                  </div>
                                  <div className="flex-shrink-0 bg-gradient-to-r from-green-500 to-green-600 text-white px-2.5 py-1 rounded-[10px] flex items-center gap-1 shadow-sm">
                                    <span className="text-sm font-bold">{restaurant.rating?.toFixed(1) || '0.0'}</span>
                                    <Star className="h-3.5 w-3.5 fill-white text-white" />
                                  </div>
                                </div>

                                {/* Delivery Time & Distance */}
                                <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-4 font-medium">
                                  <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
                                    <Clock className="h-3.5 w-3.5 text-[#ff6d00]" strokeWidth={2} />
                                    <span>{restaurant.estimatedDeliveryTime || '25-30 mins'}</span>
                                  </div>
                                  <span className="text-gray-300 dark:text-gray-700">•</span>
                                  <span>{distanceStr}</span>
                                </div>

                                {/* Offer Badge */}
                                <div className="mt-auto">
                                  {restaurant.offer ? (
                                    <div className="flex items-center gap-2 text-sm bg-gradient-to-r from-[#d82c23]/10 to-[#ff6d00]/10 border border-[#ff6d00]/20 px-3 py-2 rounded-xl">
                                      <BadgePercent className="h-4 w-4 text-[#d82c23]" strokeWidth={2} />
                                      <span className="text-[#d82c23] dark:text-[#ff9d4a] font-bold">{restaurant.offer}</span>
                                    </div>
                                  ) : (
                                    <div className="h-9"></div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          </Link>
                        </motion.div>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
