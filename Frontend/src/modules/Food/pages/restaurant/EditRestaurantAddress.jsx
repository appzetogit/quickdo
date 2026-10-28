import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import Lenis from "lenis"
import { ArrowLeft, ChevronDown } from "lucide-react"
import BottomPopup from "@delivery/components/BottomPopup"
import { restaurantAPI } from "@food/api"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const ADDRESS_STORAGE_KEY = "restaurant_address"

// Default coordinates for Indore (can be updated based on actual location)
const DEFAULT_LAT = 22.7196
const DEFAULT_LNG = 75.8577

export default function EditRestaurantAddress() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [address, setAddress] = useState("")
  const [restaurantName, setRestaurantName] = useState("")
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showSelectOptionDialog, setShowSelectOptionDialog] = useState(false)
  const [selectedOption, setSelectedOption] = useState("minor_correction") // "update_address" or "minor_correction"
  const [lat, setLat] = useState(DEFAULT_LAT)
  const [lng, setLng] = useState(DEFAULT_LNG)

  // Format address from location object
  const formatAddress = (loc) => {
    if (!loc) return ""
    const parts = []
    if (loc.addressLine1) parts.push(loc.addressLine1.trim())
    if (loc.addressLine2) parts.push(loc.addressLine2.trim())
    if (loc.area) parts.push(loc.area.trim())
    if (loc.city) {
      const city = loc.city.trim()
      if (!loc.area || !loc.area.includes(city)) {
        parts.push(city)
      }
    }
    if (loc.landmark) parts.push(loc.landmark.trim())
    return parts.join(", ") || ""
  }

  // Fetch restaurant data from backend
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantName(data.name || "")
          if (data.location) {
            setLocation(data.location)
            const formatted = formatAddress(data.location)
            setAddress(formatted)
            // Set coordinates if available
            if (data.location.latitude && data.location.longitude) {
              setLat(data.location.latitude)
              setLng(data.location.longitude)
            }
          } else {
            // Fallback to localStorage
            try {
              const savedAddress = localStorage.getItem(ADDRESS_STORAGE_KEY)
              if (savedAddress) {
                setAddress(savedAddress)
              }
            } catch (error) {
              debugError("Error loading address from storage:", error)
            }
          }
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
        // Fallback to localStorage
        try {
          const savedAddress = localStorage.getItem(ADDRESS_STORAGE_KEY)
          if (savedAddress) {
            setAddress(savedAddress)
          }
          // Try to get restaurant name from localStorage, but prefer empty string over hardcoded value
          const savedName = localStorage.getItem("restaurant_name") || 
                           localStorage.getItem("restaurantName") ||
                           ""
          setRestaurantName(savedName)
        } catch (e) {
          debugError("Error loading from localStorage:", e)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()

    // Listen for address updates
    const handleAddressUpdate = () => {
      fetchRestaurantData()
    }

    window.addEventListener("addressUpdated", handleAddressUpdate)
    return () => window.removeEventListener("addressUpdated", handleAddressUpdate)
  }, [])

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  // Handle opening Google Maps app
  const handleViewOnMap = () => {
    // Create Google Maps URL for the restaurant location
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    
    // Try to open in Google Maps app (mobile) or web
    window.open(googleMapsUrl, "_blank")
  }

  // Handle Update button click
  const handleUpdateClick = () => {
    setShowSelectOptionDialog(true)
  }

  // Handle Proceed to update
  const handleProceedUpdate = async () => {
    try {
      // For now, we'll update the location in the database
      // In a real scenario, you might want to handle FSSAI update flow separately
      if (selectedOption === "update_address") {
        // For major address update, you might want to navigate to a form
        // For now, we'll just show a message
        alert("For major address updates, FSSAI verification may be required. Please contact support.")
        setShowSelectOptionDialog(false)
        return
      } else {
        // Minor correction - update location coordinates
        // Fetch live address from coordinates using Google Maps API
        try {
          let formattedAddress = location?.formattedAddress || ""
          // Google Geocoding disabled - new backend in progress. Use existing or coords.
          if (lat && lng && !formattedAddress) {
            formattedAddress = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          }

          // Update location with coordinates array and formattedAddress
          const updatedLocation = {
            ...location,
            latitude: lat,
            longitude: lng,
            coordinates: [lng, lat], // GeoJSON format: [longitude, latitude]
            formattedAddress: formattedAddress || location?.formattedAddress || ""
          }
          
          const response = await restaurantAPI.updateProfile({ location: updatedLocation })
          
          if (response?.data?.data?.restaurant) {
            // Update local state
            setLocation(updatedLocation)
            // Dispatch event to notify other components
            window.dispatchEvent(new Event("addressUpdated"))
            setShowSelectOptionDialog(false)
            goBack()
          } else {
            throw new Error("Invalid response from server")
          }
        } catch (updateError) {
          debugError("Error updating address:", updateError)
          alert(`Failed to update address: ${updateError.response?.data?.message || updateError.message || "Please try again."}`)
        }
      }
    } catch (error) {
      debugError("Error updating address:", error)
      alert(`Failed to update address: ${error.response?.data?.message || error.message || "Please try again."}`)
    }
  }

  // Get simplified address for navbar (last two parts: area, city)
  const getSimplifiedAddress = (fullAddress) => {
    const parts = fullAddress.split(",").map(p => p.trim())
    if (parts.length >= 2) {
      // Return last two parts (e.g., "By Pass Road (South), Indore")
      return parts.slice(-2).join(", ")
    }
    return fullAddress
  }
  
  const simplifiedAddress = getSimplifiedAddress(address)

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-20 text-gray-900">
      {/* Sticky Header */}
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={goBack}
              className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{restaurantName || "Restaurant Address"}</h1>
              <p className="text-xs text-gray-500 truncate">{simplifiedAddress}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleUpdateClick}
            className="hidden sm:inline-flex items-center justify-center px-6 py-2 rounded-xl text-sm font-semibold bg-gray-900 hover:bg-black text-white transition-all shadow-sm"
          >
            Update Address
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Map Preview Card */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Map Location</h2>
              <button
                onClick={handleViewOnMap}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Open in Google Maps
              </button>
            </div>

            <div className="relative h-80 sm:h-96 w-full bg-gray-100">
              <iframe
                src={`https://www.google.com/maps?q=${lat},${lng}&hl=en&z=15&output=embed`}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-full"
              />
              
              {/* Custom Marker Tooltip Overlay */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg mb-2 whitespace-nowrap shadow-xl text-center">
                  <p className="text-xs font-bold">Outlet Location</p>
                  <p className="text-[10px] text-gray-300">Pickups dispatched here</p>
                </div>
                <div className="w-5 h-5 bg-gray-900 rounded-full border-2 border-white shadow-lg mx-auto"></div>
              </div>
            </div>
          </div>

          {/* Address Details Card */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-sm space-y-5">
            <div>
              <h2 className="text-base font-bold text-gray-900">Current Outlet Address</h2>
              <p className="text-xs text-gray-500 mt-0.5">Physical pickup location displayed to customers and delivery partners.</p>
            </div>

            {/* Informational Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 leading-relaxed">
              Customers and Quick Drop delivery riders will use this exact address and GPS pin to navigate to your outlet.
            </div>

            {/* Current Address Display */}
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Registered Address</p>
              <p className="text-sm font-medium text-gray-900 leading-relaxed">{address || "No address recorded"}</p>
            </div>

            {/* Update Button */}
            <button
              onClick={handleUpdateClick}
              className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3 text-sm rounded-xl transition-all shadow-md hover:shadow-lg"
            >
              Update Address & Pin
            </button>
          </div>
        </div>
      </div>

      {/* Select Option Bottom Popup */}
      <BottomPopup
        isOpen={showSelectOptionDialog}
        onClose={() => setShowSelectOptionDialog(false)}
        title="Select an Option"
        maxHeight="auto"
      >
        <div className="space-y-3 pt-2">
          {/* Option 1: Update outlet address */}
          <button
            onClick={() => setSelectedOption("update_address")}
            className={`w-full flex items-start justify-between p-4 rounded-xl border text-left transition-all ${
              selectedOption === "update_address"
                ? "bg-gray-50 border-gray-900 shadow-sm"
                : "bg-white border-gray-200 hover:bg-gray-50"
            }`}
          >
            <div className="flex-1 pr-3">
              <p className="text-sm font-bold text-gray-900 mb-1">
                Update outlet address (FSSAI required)
              </p>
              <p className="text-xs text-gray-500 line-clamp-2">{address}</p>
            </div>
            <div className="mt-0.5 shrink-0">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedOption === "update_address"
                    ? "border-gray-900 bg-gray-900"
                    : "border-gray-300"
                }`}
              >
                {selectedOption === "update_address" && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
            </div>
          </button>

          {/* Option 2: Minor correction */}
          <button
            onClick={() => setSelectedOption("minor_correction")}
            className={`w-full flex items-start justify-between p-4 rounded-xl border text-left transition-all ${
              selectedOption === "minor_correction"
                ? "bg-gray-50 border-gray-900 shadow-sm"
                : "bg-white border-gray-200 hover:bg-gray-50"
            }`}
          >
            <div className="flex-1 pr-3">
              <p className="text-sm font-bold text-gray-900 mb-1">
                Make a minor correction to the location pin
              </p>
              <p className="text-xs text-gray-500">
                Adjust if the pin on the map is slightly misplaced
              </p>
            </div>
            <div className="mt-0.5 shrink-0">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedOption === "minor_correction"
                    ? "border-gray-900 bg-gray-900"
                    : "border-gray-300"
                }`}
              >
                {selectedOption === "minor_correction" && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
            </div>
          </button>

          {/* Proceed Button */}
          <button
            onClick={handleProceedUpdate}
            className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3.5 rounded-xl text-sm transition-colors mt-4"
          >
            Proceed to update
          </button>
        </div>
      </BottomPopup>
    </div>
  )
}
