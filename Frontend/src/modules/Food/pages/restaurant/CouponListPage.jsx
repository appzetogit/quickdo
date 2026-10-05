import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { 
  ArrowLeft,
  Plus,
  Tag,
  Trash2,
  Edit,
  MoreVertical,
  Calendar,
  Percent,
  IndianRupee,
  Copy
} from "lucide-react"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

export default function CouponListPage() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [openMenuId, setOpenMenuId] = useState(null)
  const [coupons, setCoupons] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest(`[data-menu-id="${openMenuId}"]`)) {
        setOpenMenuId(null)
      }
    }
    if (openMenuId) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [openMenuId])

  const fetchCoupons = async () => {
    try {
      setIsLoading(true)
      const res = await restaurantAPI.listMyOffers()
      setCoupons(res.data?.data?.offers || [])
    } catch (error) {
      toast.error("Failed to fetch coupons")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchCoupons() }, [])

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this coupon?")) return
    try {
      await restaurantAPI.deleteMyOffer(id)
      toast.success("Coupon deleted")
      fetchCoupons()
    } catch {
      toast.error("Failed to delete coupon")
    }
  }

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code)
    toast.success("Code copied!")
  }

  const isActive = (coupon) => {
    const now = new Date()
    const start = coupon.startDate ? new Date(coupon.startDate) : null
    const end = coupon.endDate ? new Date(coupon.endDate) : null
    if (start && now < start) return false
    if (end && now > end) return false
    return coupon.status === "active"
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors" aria-label="Go back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">Offers & Coupons</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Restaurant-sponsored discounts and promotional coupon codes</p>
            </div>
          </div>
          <button
            onClick={() => navigate("/restaurant/coupon/new")}
            className="flex items-center gap-2 bg-gray-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Coupon</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {isLoading ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-gray-900 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-600 text-sm font-medium">Loading coupons...</p>
            </div>
          </div>
        ) : coupons.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm">
            <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
                <Tag className="w-7 h-7 text-gray-400" />
              </div>
              <div>
                <p className="text-gray-900 font-bold text-base">No active coupons</p>
                <p className="text-gray-500 text-xs mt-1">Create your first custom offer to attract new customers and drive more orders.</p>
              </div>
              <button
                onClick={() => navigate("/restaurant/coupon/new")}
                className="mt-2 flex items-center gap-2 bg-gray-900 hover:bg-black text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Coupon</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {coupons.map((coupon, index) => {
                const active = isActive(coupon)
                return (
                  <motion.div
                    key={coupon.id || coupon._id}
                    layout
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -15 }}
                    transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.2) }}
                    className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Top accent bar */}
                      <div className={`h-1.5 ${active ? "bg-emerald-500" : "bg-gray-300"}`} />

                      <div className="p-5">
                        {/* Header row */}
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${active ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-500"}`}>
                              {active ? "ACTIVE" : "INACTIVE"}
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gray-100 text-gray-700">
                              {coupon.discountType === "percentage" ? "% DISCOUNT" : "FLAT OFF"}
                            </span>
                          </div>
                          <div className="relative" data-menu-id={coupon.id}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === coupon.id ? null : coupon.id) }}
                              className="p-1 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-700"
                              data-menu-id={coupon.id}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            <AnimatePresence>
                              {openMenuId === coupon.id && (
                                <motion.div
                                  initial={{ opacity: 0, scale: 0.95, y: -8 }}
                                  animate={{ opacity: 1, scale: 1, y: 0 }}
                                  exit={{ opacity: 0, scale: 0.95, y: -8 }}
                                  transition={{ duration: 0.15 }}
                                  className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 z-50 min-w-[140px]"
                                  data-menu-id={coupon.id}
                                >
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(coupon.id); setOpenMenuId(null) }}
                                    className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>

                        {/* Coupon Code */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg font-black text-gray-900 tracking-wider uppercase font-mono bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-lg">
                            {coupon.couponCode}
                          </span>
                          <button
                            onClick={() => handleCopyCode(coupon.couponCode)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-700 transition-colors"
                            title="Copy code"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Discount value */}
                        <div className="flex items-baseline gap-1.5 mb-3">
                          {coupon.discountType === "percentage"
                            ? <Percent className="w-5 h-5 text-gray-900 self-center" />
                            : <IndianRupee className="w-5 h-5 text-gray-900 self-center" />}
                          <span className="text-2xl font-black text-gray-900">{coupon.discountValue}</span>
                          <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
                            {coupon.discountType === "percentage" ? "% off order" : "flat discount"}
                          </span>
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-dashed border-gray-200">
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Min Order</p>
                            <p className="text-sm font-bold text-gray-900">₹{coupon.minOrderValue || 0}</p>
                          </div>
                          {coupon.maxDiscount && (
                            <div>
                              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Max Cap</p>
                              <p className="text-sm font-bold text-gray-900">₹{coupon.maxDiscount}</p>
                            </div>
                          )}
                          {(coupon.startDate || coupon.endDate) && (
                            <div className="col-span-2 flex items-center gap-1.5 text-xs text-gray-500 pt-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span className="truncate">
                                {coupon.startDate ? new Date(coupon.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Now"}
                                {" → "}
                                {coupon.endDate ? new Date(coupon.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Ongoing"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* FAB - mobile only */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => navigate("/restaurant/coupon/new")}
        className="sm:hidden fixed bottom-6 right-5 w-14 h-14 bg-gray-900 hover:bg-black text-white rounded-full shadow-2xl flex items-center justify-center z-40 transition-colors"
      >
        <Plus className="w-6 h-6" />
      </motion.button>
    </div>
  )
}
