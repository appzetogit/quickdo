import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Star, Clock, Gift, Ticket, Sparkles } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { toast } from "sonner"
import { RestaurantGridSkeleton } from "@food/components/ui/loading-skeletons"
import { useDelayedLoading } from "@food/hooks/useDelayedLoading"

// Import banner image
import offerBanner from "@food/assets/offerpagebanner.png"
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

export default function Offers() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [offers, setOffers] = useState([])
  const [groupedOffers, setGroupedOffers] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const showOffersSkeleton = useDelayedLoading(loading)

  // Fetch offers from API
  useEffect(() => {
    const fetchOffers = async () => {
      try {
        setLoading(true)
        setError(null)
        const response = await restaurantAPI.getPublicOffers()
        const data = response?.data?.data
        
        if (data) {
          setOffers(data.allOffers || [])
          setGroupedOffers(data.groupedByOffer || {})
        }
      } catch (err) {
        debugError('Error fetching offers:', err)
        debugError('Error details:', err?.response?.data || err?.message)
        const errorMessage = err?.response?.data?.message || err?.message || 'Failed to load offers'
        setError(errorMessage)
        toast.error(errorMessage)
      } finally {
        setLoading(false)
      }
    }

    fetchOffers()
  }, [])

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
        
        {/* Enhanced Banner Header Section */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative w-full overflow-hidden h-[25vh] md:h-[30vh] lg:h-[35vh] rounded-b-[32px] md:rounded-b-[48px] shadow-[0_10px_30px_rgba(216,44,35,0.2)] bg-gradient-to-r from-[#d82c23] to-[#ff6d00]"
        >
          {/* Back Button */}
          <button 
            onClick={goBack}
            className="absolute top-5 left-4 md:top-8 md:left-8 z-30 w-10 h-10 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.1)] active:scale-95 border border-white/40"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          
          {/* Dynamic Theme Banner Background Elements */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            {/* Animated Circles */}
            <div className="absolute top-[-20%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-white/10 blur-[40px] animate-[pulse_6s_ease-in-out_infinite]"></div>
            <div className="absolute bottom-[-20%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-[#ff9d4a]/20 blur-[60px] animate-[pulse_8s_ease-in-out_infinite]"></div>
            
            {/* Decorative Grid Pattern */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4xNSkiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom,white,transparent)]"></div>
          </div>
          
          {/* Dynamic Banner Content */}
          <div className="absolute inset-0 z-10 flex flex-col justify-center px-6 md:px-12">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="flex items-center gap-2 mb-2"
            >
              <div className="p-1.5 bg-white/20 backdrop-blur-md rounded-lg shadow-sm border border-white/20">
                <Sparkles className="w-4 h-4 text-white animate-[spin_4s_linear_infinite]" />
              </div>
              <span className="text-white/90 font-bold text-xs sm:text-sm tracking-[0.2em] uppercase bg-white/10 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10">Special Deals</span>
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="text-4xl sm:text-5xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/70 drop-shadow-sm tracking-tight leading-tight mt-1"
            >
              Flash Offers
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.6 }}
              className="text-white/90 text-sm sm:text-base md:text-lg mt-3 font-medium max-w-md leading-relaxed drop-shadow-sm"
            >
              Grab the best discounts on your favorite meals before they are gone! Unlock exclusive savings today.
            </motion.p>
          </div>
          
          {/* Giant Floating Icon */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ delay: 0.5, duration: 0.8, type: "spring" }}
            className="absolute -right-4 top-1/2 -translate-y-1/2 opacity-20 pointer-events-none hidden sm:block"
          >
            <Gift className="w-64 h-64 text-white" />
          </motion.div>
        </motion.div>

        {/* Content */}
        <div className="px-4 sm:px-6 md:px-8 lg:px-10 py-8 md:py-12 space-y-8 md:space-y-12">
          <div className="max-w-7xl mx-auto">
            {/* Loading State */}
            {showOffersSkeleton && <RestaurantGridSkeleton count={4} compact />}

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

            {/* Offers Sections */}
            {!showOffersSkeleton && !error && (
              <AnimatePresence>
                {/* Grouped Offers Sections */}
                {Object.keys(groupedOffers).length > 0 && Object.entries(groupedOffers).map(([offerText, dishes], groupIdx) => (
                  <motion.section 
                    key={offerText}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: groupIdx * 0.1, duration: 0.5 }}
                    className="mb-12"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="h-8 w-2 bg-gradient-to-b from-[#d82c23] to-[#ff6d00] rounded-full shadow-[0_0_10px_rgba(255,109,0,0.5)]"></div>
                      <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                        {offerText}
                      </h2>
                    </div>
                    
                    {/* Restaurant Cards - Grid Layout */}
                    <motion.div 
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5 lg:gap-6"
                    >
                      {dishes.slice(0, 8).map((dish) => (
                        <motion.div key={dish.id} variants={itemVariants}>
                          <Link 
                            to={`/user/restaurants/${dish.restaurantSlug}`}
                            className="w-full block h-full"
                          >
                            <motion.div 
                                className="group h-full bg-white/80 dark:bg-[#111111]/80 backdrop-blur-xl rounded-[24px] p-2 pb-3 shadow-[0_8px_24px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_32px_rgba(216,44,35,0.15)] border border-gray-100/50 dark:border-gray-800/50 transition-all duration-300"
                                whileHover={{ y: -6, scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                              >
                              {/* Image Container */}
                              <div className="relative h-36 sm:h-44 rounded-[18px] overflow-hidden mb-3">
                                <img 
                                  src={dish.dishImage || dish.restaurantImage || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop"} 
                                  alt={dish.dishName}
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out"
                                />
                                {/* Overlay Gradient */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                
                                {/* Offer Badge */}
                                <div className="absolute top-2 left-2 bg-gradient-to-r from-[#d82c23] to-[#ff6d00] text-white text-[10px] sm:text-xs font-bold px-3 py-1 rounded-full shadow-lg backdrop-blur-md flex items-center gap-1">
                                  <Gift className="w-3 h-3" />
                                  {dish.offer}
                                </div>
                              </div>
                              
                              {/* Rating Badge */}
                              <div className="flex items-center justify-between gap-1 mb-1 px-2">
                                <div className="bg-gradient-to-r from-green-500 to-green-600 text-white text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-[8px] flex items-center gap-1 shadow-sm">
                                  {dish.restaurantRating?.toFixed(1) || '0.0'}
                                  <Star className="h-2.5 w-2.5 fill-white" />
                                </div>
                              </div>
                              
                              {/* Restaurant Info */}
                              <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm sm:text-base line-clamp-1 px-2 mt-1">
                                {dish.restaurantName}
                              </h3>
                              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mb-2 px-2 font-medium">
                                {dish.dishName} - ₹{dish.discountedPrice}
                              </p>
                              <div className="flex items-center gap-1 text-[#ff6d00] bg-[#ff6d00]/10 px-2 py-1 rounded-full text-[10px] sm:text-xs font-bold max-w-fit mx-2">
                                <Clock className="h-3 w-3" />
                                <span>{dish.deliveryTime}</span>
                              </div>
                            </motion.div>
                          </Link>
                        </motion.div>
                      ))}
                    </motion.div>
                  </motion.section>
                ))}

                {/* Coupon-style offers (admin created) */}
                {Object.keys(groupedOffers).length === 0 && offers.length > 0 && (
                  <motion.section 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-6 pt-4"
                  >
                    <div className="flex items-center gap-3 mb-6">
                      <div className="h-8 w-2 bg-gradient-to-b from-[#d82c23] to-[#ff6d00] rounded-full shadow-[0_0_10px_rgba(255,109,0,0.5)]"></div>
                      <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                        Available Coupons
                      </h2>
                    </div>
                    <motion.div 
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
                    >
                      {offers.map((o) => (
                        <motion.div key={o.id || o.offerId} variants={itemVariants}>
                          <motion.div 
                            whileHover={{ y: -6, scale: 1.02 }} 
                            className="bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl rounded-[28px] border border-[#ff6d00]/20 shadow-[0_8px_24px_rgba(255,109,0,0.06)] hover:shadow-[0_16px_40px_rgba(255,109,0,0.15)] overflow-hidden relative cursor-pointer group"
                          >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-[#ff6d00]/10 to-transparent rounded-bl-full pointer-events-none group-hover:scale-125 transition-transform duration-500"></div>
                            <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#f8f9fa] dark:bg-[#0a0a0a] rounded-full border-r border-[#ff6d00]/30 shadow-inner"></div>
                            <div className="absolute -right-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#f8f9fa] dark:bg-[#0a0a0a] rounded-full border-l border-[#ff6d00]/30 shadow-inner"></div>
                            <div className="border-t-2 border-dashed border-gray-200 dark:border-gray-800 absolute top-1/2 left-6 right-6 -translate-y-1/2 opacity-50"></div>

                            <div className="p-6 sm:p-8 space-y-5 relative z-10">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Ticket className="w-3.5 h-3.5 text-[#ff6d00]" />
                                    <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Coupon Code</p>
                                  </div>
                                  <p className="text-2xl sm:text-3xl font-black text-[#d82c23] tracking-wider uppercase">
                                    {o.couponCode || "-"}
                                  </p>
                                </div>
                                <span className="px-3 py-1.5 rounded-full text-[10px] sm:text-xs font-bold bg-gradient-to-r from-[#d82c23] to-[#ff6d00] text-white shadow-lg flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  {o.title || "Offer"}
                                </span>
                              </div>
                              <div className="pt-4 space-y-2">
                                <p className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2 font-medium">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#ff6d00]"></span>
                                  <span className="font-bold">Valid At:</span>{" "}
                                  {o.restaurantName || "All Restaurants"}
                                </p>
                                {o.endDate && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700"></span>
                                    Valid till: <span className="font-semibold text-slate-700 dark:text-slate-300">{new Date(o.endDate).toLocaleDateString()}</span>
                                  </p>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        </motion.div>
                      ))}
                    </motion.div>
                  </motion.section>
                )}

                {offers.length === 0 && !loading && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-24 bg-white/50 dark:bg-[#111111]/50 backdrop-blur-md rounded-[32px] border border-gray-100 dark:border-gray-800"
                  >
                    <div className="w-20 h-20 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Gift className="w-10 h-10 text-gray-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No active offers</h3>
                    <p className="text-gray-500 dark:text-gray-400">Check back later for exciting deals and discounts!</p>
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
