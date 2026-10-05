import { useState } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Info } from "lucide-react"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function ManageOutlets() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [showToast, setShowToast] = useState(false)

  const options = [
    "Timings",
    "Contacts",
    "FSSAI Food License",
    "Bank account details",
    "Profile picture",
    "Name, address, location",
    "Ratings, reviews",
    "Delivery area changes",
  ]

  const handleOptionClick = (option) => {
    // Navigate based on option selected
    switch (option) {
      case "Timings":
        navigate("/restaurant/outlet-timings")
        break
      case "FSSAI Food License":
        navigate("/restaurant/fssai")
        break
      case "Bank account details":
        navigate("/restaurant/update-bank-details")
        break
      case "Profile picture":
        navigate("/restaurant/outlet-info")
        break
      case "Name, address, location":
        navigate("/restaurant/outlet-info")
        break
      case "Ratings, reviews":
        navigate("/restaurant/ratings-reviews")
        break
      case "Delivery area changes":
        setShowToast(true)
        setTimeout(() => setShowToast(false), 5000)
        break
      default:
        debugLog(`${option} clicked`)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Manage Outlet Settings</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Update profile credentials, timings, address and compliance documents</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto w-full flex-1 px-4 sm:px-6 py-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/70">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">Configuration Shortcuts</p>
          </div>
          
          {/* Options List */}
          <div className="divide-y divide-gray-100">
            {options.map((option) => (
              <button
                key={option}
                onClick={() => handleOptionClick(option)}
                className="w-full flex items-center justify-between p-4 sm:p-5 text-left hover:bg-gray-50 transition-colors group"
              >
                <span className="text-sm font-semibold text-gray-900 group-hover:text-black">{option}</span>
                <span className="text-gray-400 group-hover:text-gray-900 transition-colors">
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    className="w-4 h-4"
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor" 
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-4 w-full max-w-md"
          >
            <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-2xl">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-bold text-gray-900">
                    Delivery Area Control
                  </p>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Delivery areas are algorithmically managed based on rider availability and distance thresholds to maintain hot delivery times.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


