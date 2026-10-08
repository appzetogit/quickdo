import { useState, useEffect, useRef, useMemo, Fragment } from "react"
import { createPortal } from "react-dom"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Minus, ArrowLeft, ChevronRight, Clock, MapPin, Phone, FileText, Utensils, Tag, Percent, Share2, ChevronUp, ChevronDown, X, Check, Settings, CreditCard, Wallet, Building2, Sparkles, Banknote, Zap, CheckCircle2, MessageCircle, Send, Mail, Copy } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import confetti from "canvas-confetti"

import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import { useOrders } from "@food/context/OrdersContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useLocationSelector } from "@food/components/user/UserLayout"
import { orderAPI, restaurantAPI, userAPI, API_ENDPOINTS } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import apiClient from "@/services/api/axios"
import { initRazorpayPayment } from "@food/utils/razorpay"
import { toast } from "sonner"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import zoopSound from "@food/assets/audio/zomato_sms.mp3"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }



// Removed hardcoded suggested items - now fetching approved addons from backend
// Coupons will be fetched from backend based on items in cart

/**
 * Format full address string from address object
 * @param {Object} address - Address object with street, additionalDetails, city, state, zipCode, or formattedAddress
 * @returns {String} Formatted address string
 */
const formatFullAddress = (address) => {
  if (!address) return ""

  const looksLikeLatLng = (s) => {
    if (!s) return false
    const v = String(s).trim()
    // Matches "12.34, 56.78" (lat,lng) with optional decimals/spaces
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)
  }

  // Priority 1: Use formattedAddress if available (for live location addresses)
  if (address.formattedAddress && address.formattedAddress !== "Select location") {
    // If formattedAddress is still raw coordinates, don't show it as-is.
    // Fall back to composing from city/state/area instead.
    if (!looksLikeLatLng(address.formattedAddress)) {
      return address.formattedAddress
    }
  }

  // Priority 2: Build address from parts
  const addressParts = []
  if (address.street) addressParts.push(address.street)
  if (address.additionalDetails) addressParts.push(address.additionalDetails)
  if (address.city) addressParts.push(address.city)
  if (address.state) addressParts.push(address.state)
  if (address.zipCode) addressParts.push(address.zipCode)

  if (addressParts.length > 0) {
    return addressParts.join(', ')
  }

  // Priority 3: Use address field if available
  if (address.address && address.address !== "Select location") {
    return address.address
  }

  return ""
}

const RUPEE_SYMBOL = "\u20B9"
const CART_RECIPIENT_DETAILS_STORAGE_KEY = "food-cart-recipient-details-v1"
const CART_ORDER_NOTE_STORAGE_KEY = "food-cart-order-note-v1"

export default function Cart() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const orderSuccessAudioRef = useRef(null)
  const hasRestoredRecipientRef = useRef(false)
  const hasRestoredNoteRef = useRef(false)

  // Defensive check: Ensure CartProvider is available
  let cartContext;
  try {
    cartContext = useCart();
  } catch (error) {
    debugError('? CartProvider not found. Make sure Cart component is rendered within UserLayout.');
    // Return early with error message
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] dark:bg-[#0a0a0a]">
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Cart Error</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Cart functionality is not available. Please refresh the page.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  const { cart, updateQuantity, addToCart, getCartCount, clearCart, cleanCartForRestaurant } = cartContext;
  const { getDefaultAddress, getDefaultPaymentMethod, setDefaultAddress, addresses, paymentMethods, userProfile } = useProfile()
  const { createOrder } = useOrders()
  const { openLocationSelector } = useLocationSelector()
  const { location: currentLocation, loading: currentLocationLoading } = useUserLocation() // Get live location address

  const [showCoupons, setShowCoupons] = useState(false)
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [couponCode, setCouponCode] = useState("")
  const [manualCouponCode, setManualCouponCode] = useState("")
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash")
  const [showPaymentSheet, setShowPaymentSheet] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  // Loyalty points (GET /platform/loyalty/me): the balance, and whether the
  // customer chose to redeem them. The server clamps what is used.
  const [loyaltySummary, setLoyaltySummary] = useState(null)
  const [useLoyaltyPoints, setUseLoyaltyPoints] = useState(false)
  const loyaltyPointsRequested =
    useLoyaltyPoints && loyaltySummary?.enabled ? Math.floor(Number(loyaltySummary.balance) || 0) : 0
  const [isLoadingWallet, setIsLoadingWallet] = useState(false)
  const [feeSettings, setFeeSettings] = useState(null)
  const [maxAvailableCashLimit, setMaxAvailableCashLimit] = useState(Infinity)
  const [note, setNote] = useState(() => {
    try {
      if (typeof window === "undefined") return ""
      const raw = window.localStorage.getItem(CART_ORDER_NOTE_STORAGE_KEY)
      if (!raw) return ""
      const stored = JSON.parse(raw)
      return String(stored?.note || "")
    } catch {
      return ""
    }
  })
  const [showNoteInput, setShowNoteInput] = useState(() => {
    try {
      if (typeof window === "undefined") return false
      const raw = window.localStorage.getItem(CART_ORDER_NOTE_STORAGE_KEY)
      if (!raw) return false
      const stored = JSON.parse(raw)
      const storedNote = String(stored?.note || "")
      return Boolean(stored?.showNoteInput) || storedNote.trim().length > 0
    } catch {
      return false
    }
  })
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [isEditingRecipient, setIsEditingRecipient] = useState(false)
  const [recipientDetails, setRecipientDetails] = useState({
    name: "",
    phone: "",
  })

  const [sendCutlery, setSendCutlery] = useState(true)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const [showBillDetails, setShowBillDetails] = useState(true)
  const [showPlacingOrder, setShowPlacingOrder] = useState(false)
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("")
  const [orderProgress, setOrderProgress] = useState(0)
  const [showOrderSuccess, setShowOrderSuccess] = useState(false)
  const [placedOrderId, setPlacedOrderId] = useState(null)
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    try {
      if (typeof window === "undefined") return "saved"
      return localStorage.getItem("deliveryAddressMode") || "saved"
    } catch {
      return "saved"
    }
  })

  useEffect(() => {
    const audio = new Audio(zoopSound)
    audio.preload = "auto"
    audio.volume = 0.8
    orderSuccessAudioRef.current = audio

    return () => {
      if (orderSuccessAudioRef.current) {
        orderSuccessAudioRef.current.pause()
        orderSuccessAudioRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!showOrderSuccess || !orderSuccessAudioRef.current) return

    orderSuccessAudioRef.current.currentTime = 0
    orderSuccessAudioRef.current.play().catch((error) => {
      debugWarn("Order success sound blocked by browser:", error?.message || error)
    })
  }, [showOrderSuccess])

  // Restaurant and pricing state
  const [restaurantData, setRestaurantData] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(false)
  const [pricing, setPricing] = useState(null)
  const [loadingPricing, setLoadingPricing] = useState(false)

  // Addons state
  const [addons, setAddons] = useState([])
  const [loadingAddons, setLoadingAddons] = useState(false)

  // Coupons state - fetched from backend
  const [availableCoupons, setAvailableCoupons] = useState([])
  const [loadingCoupons, setLoadingCoupons] = useState(false)
  const [userOrderCount, setUserOrderCount] = useState(0)

  const availableTimeSlots = useMemo(() => {
    if (!isScheduled || !scheduledDate || !restaurantData) return []

    try {
      const targetDate = new Date(scheduledDate)
      const status = getRestaurantAvailabilityStatus(restaurantData, targetDate)

      let openingHour = 9
      let closingHour = 22

      if (status.openingTime) {
        const [h] = status.openingTime.split(':')
        openingHour = parseInt(h, 10)
      }

      if (status.closingTime) {
        const [h] = status.closingTime.split(':')
        closingHour = parseInt(h, 10)
      }

      if (closingHour < openingHour) {
        closingHour += 24 // Handle overnight slots
      }

      const slots = []
      const now = new Date()
      // Fix timezone date comparison by comparing date strings YYYY-MM-DD
      const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
      const targetStr = scheduledDate
      const isToday = targetStr === nowStr
      const currentHour = now.getHours()

      for (let h = openingHour; h <= closingHour; h++) {
        const actualHour = h % 24
        // Skip past hours if today. Add 1 hour buffer so they can't order right at the boundary
        if (isToday && h <= currentHour) continue

        const period = actualHour >= 12 ? 'PM' : 'AM'
        const display12 = actualHour % 12 || 12
        const timeString = `${String(actualHour).padStart(2, '0')}:00`
        const displayString = `${display12}:00 ${period}`

        slots.push({ value: timeString, label: displayString })
      }

      return slots
    } catch {
      return []
    }
  }, [isScheduled, scheduledDate, restaurantData])

  // Reset scheduledTime if it's no longer valid in the new slots
  useEffect(() => {
    if (isScheduled && availableTimeSlots.length > 0) {
      const isValid = availableTimeSlots.some(slot => slot.value === scheduledTime)
      if (!isValid) {
        setScheduledTime(availableTimeSlots[0].value)
      }
    } else if (!isScheduled) {
      setScheduledDate("")
      setScheduledTime("")
    }
  }, [isScheduled, availableTimeSlots, scheduledTime])

  const cartCount = getCartCount()
  const getAddressId = (address) => address?.id || address?._id || null
  const normalizeAddressLabel = (label) => {
    if (!label) return ""
    const value = String(label).trim().toLowerCase()
    if (value === "work" || value === "office") return "office"
    if (value === "home") return "home"
    if (value === "other") return "other"
    return value
  }
  const getDisplayAddressLabel = (label) => {
    const normalized = normalizeAddressLabel(label)
    if (normalized === "office") return "Work"
    if (normalized === "home") return "Home"
    if (normalized === "other") return "Other"
    return label || "Saved address"
  }
  const sanitizeRecipientPhone = (value) => String(value || "").replace(/[^\d+]/g, "").slice(0, 14)
  const savedAddress = getDefaultAddress()
  const selectedAddress = addresses.find((addr) => getAddressId(addr) && getAddressId(addr) === selectedAddressId)

  const currentLocationAddress = useMemo(() => {
    // `LocationSelectorOverlay` updates backend + localStorage, but Cart's live hook might lag.
    // So we fall back to `localStorage.userLocation` when `currentLocation` doesn't have a usable payload yet.
    let locFromStorage = null
    try {
      const storedRaw = localStorage.getItem("userLocation")
      locFromStorage = storedRaw ? JSON.parse(storedRaw) : null
    } catch {
      locFromStorage = null
    }

    const loc = currentLocation?.latitude && currentLocation?.longitude ? currentLocation : locFromStorage
    if (!loc?.latitude || !loc?.longitude) return null

    const formattedAddress = loc?.formattedAddress || loc?.address || ""
    if (!formattedAddress || formattedAddress === "Select location") return null

    return {
      // Backend deliveryAddressSchema expects label in ['Home','Office','Other'].
      label: "Home",
      formattedAddress,
      address: formattedAddress,
      street: loc?.street || loc?.address || loc?.area || "Current Location",
      additionalDetails: loc?.area || "",
      city: loc?.city || loc?.area || "Current City",
      state: loc?.state || loc?.city || "Current State",
      zipCode: loc?.postalCode || loc?.zipCode || "",
      phone: userProfile?.phone || "",
      location: {
        type: "Point",
        coordinates: [loc.longitude, loc.latitude], // [lng, lat]
      },
    }
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    currentLocation?.formattedAddress,
    currentLocation?.address,
    currentLocation?.street,
    currentLocation?.area,
    currentLocation?.city,
    currentLocation?.state,
    currentLocation?.postalCode,
    currentLocation?.zipCode,
    userProfile?.phone,
    // Re-evaluate derived address when mode changes (overlay closes -> Cart rerenders).
    deliveryAddressMode,
  ])

  const defaultAddress = useMemo(() => {
    return deliveryAddressMode === "current"
      ? currentLocationAddress || selectedAddress || savedAddress || null
      : selectedAddress || savedAddress || currentLocationAddress || null
  }, [deliveryAddressMode, currentLocationAddress, selectedAddress, savedAddress])

  const hasSavedAddress = Boolean(defaultAddress && formatFullAddress(defaultAddress))
  const recipientName = String(recipientDetails.name || "").trim() || userProfile?.name || "Your Name"
  const recipientPhone = sanitizeRecipientPhone(recipientDetails.phone || "") || userProfile?.phone || ""
  const selectedAddressCoordinates = defaultAddress?.location?.coordinates
  const zoneLocation = selectedAddressCoordinates?.length === 2
    ? {
      latitude: selectedAddressCoordinates[1],
      longitude: selectedAddressCoordinates[0]
    }
    : currentLocation
  const { zoneId } = useZone(zoneLocation, {
    persistToStorage: false,
    usePersistedFallback: false,
  }) // Resolve zone for cart pricing only; do not overwrite global browse zone
  const defaultPayment = getDefaultPaymentMethod()

  useEffect(() => {
    // Sync delivery mode from overlay/localStorage changes.
    // No dependency array: overlay open/close re-renders Cart via provider state update,
    // even when GPS coords don't move enough to update `currentLocation`.
    try {
      const mode = localStorage.getItem("deliveryAddressMode") || "saved"
      setDeliveryAddressMode((prev) => (prev === mode ? prev : mode))
    } catch {
      // ignore
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const raw = window.localStorage.getItem(CART_RECIPIENT_DETAILS_STORAGE_KEY)
      if (!raw) {
        hasRestoredRecipientRef.current = true
        return
      }

      const stored = JSON.parse(raw)
      setRecipientDetails({
        name: stored?.name || "",
        phone: sanitizeRecipientPhone(stored?.phone || ""),
      })
      setIsEditingRecipient(Boolean(stored?.isEditingRecipient))
    } catch {
      setRecipientDetails({ name: "", phone: "" })
      setIsEditingRecipient(false)
    } finally {
      hasRestoredRecipientRef.current = true
    }
  }, [])

  useEffect(() => {
    setRecipientDetails((prev) => ({
      name: prev.name || userProfile?.name || "",
      phone: prev.phone || userProfile?.phone || "",
    }))
  }, [userProfile?.name, userProfile?.phone])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredRecipientRef.current) return

    try {
      window.localStorage.setItem(
        CART_RECIPIENT_DETAILS_STORAGE_KEY,
        JSON.stringify({
          name: recipientDetails.name || "",
          phone: sanitizeRecipientPhone(recipientDetails.phone || ""),
          isEditingRecipient,
        })
      )
    } catch {
      // Ignore storage errors and keep cart flow working.
    }
  }, [recipientDetails, isEditingRecipient])

  useEffect(() => {
    hasRestoredNoteRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredNoteRef.current) return

    try {
      window.localStorage.setItem(
        CART_ORDER_NOTE_STORAGE_KEY,
        JSON.stringify({
          note,
          showNoteInput,
        })
      )
    } catch {
      // Ignore storage errors and keep note flow working.
    }
  }, [note, showNoteInput])

  useEffect(() => {
    if (deliveryAddressMode === "current") {
      setSelectedAddressId(null)
    }
  }, [deliveryAddressMode])

  useEffect(() => {
    const defaultId = getAddressId(savedAddress)
    if (deliveryAddressMode !== "current" && !selectedAddressId && defaultId) {
      setSelectedAddressId(defaultId)
    }
  }, [savedAddress, selectedAddressId, deliveryAddressMode])

  // Get restaurant ID from cart or restaurant data
  // Priority: restaurantData > cart[0].restaurantId
  // DO NOT use cart[0].restaurant as slug fallback - it creates wrong slugs
  const restaurantId = cart.length > 0
    ? (restaurantData?._id || restaurantData?.restaurantId || cart[0]?.restaurantId || null)
    : null

  // Stable restaurant ID for addons fetch (memoized to prevent dependency array issues)
  // Prefer restaurantData IDs (more reliable) over slug from cart
  const restaurantIdForAddons = useMemo(() => {
    // Only use restaurantData if it's loaded, otherwise wait
    if (restaurantData) {
      return restaurantData._id || restaurantData.restaurantId || null
    }
    // If restaurantData is not loaded yet, return null to wait
    return null
  }, [restaurantData])



  // Lock body scroll and scroll to top when any full-screen modal opens
  useEffect(() => {
    if (showPlacingOrder || showOrderSuccess) {
      // Lock body scroll
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${window.scrollY}px`

      // Scroll window to top
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else {
      // Restore body scroll
      const scrollY = document.body.style.top
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1)
      }
    }

    return () => {
      // Cleanup on unmount
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
    }
  }, [showPlacingOrder, showOrderSuccess])

  // Fetch restaurant data when cart has items
  useEffect(() => {
    const fetchRestaurantData = async () => {
      if (cart.length === 0) {
        setRestaurantData(null)
        return
      }

      // If we already have restaurantData, don't fetch again
      if (restaurantData) {
        return
      }

      setLoadingRestaurant(true)

      // Strategy 1: Try using restaurantId from cart if available
      if (cart[0]?.restaurantId) {
        try {
          const cartRestaurantId = cart[0].restaurantId;
          const cartRestaurantName = cart[0].restaurant;

          debugLog("?? Fetching restaurant data by restaurantId from cart:", cartRestaurantId)
          const response = await restaurantAPI.getRestaurantById(cartRestaurantId)
          const data = response?.data?.data?.restaurant || response?.data?.restaurant

          if (data) {
            // CRITICAL: Validate that fetched restaurant matches cart items
            const fetchedRestaurantId = data.restaurantId || data._id?.toString();
            const fetchedRestaurantName = data.name;

            // Check if restaurantId matches
            const restaurantIdMatches =
              fetchedRestaurantId === cartRestaurantId ||
              data._id?.toString() === cartRestaurantId ||
              data.restaurantId === cartRestaurantId;

            // Check if restaurant name matches (if available in cart)
            const restaurantNameMatches =
              !cartRestaurantName ||
              fetchedRestaurantName?.toLowerCase().trim() === cartRestaurantName.toLowerCase().trim();

            if (!restaurantIdMatches) {
              debugError('? CRITICAL: Fetched restaurant ID does not match cart restaurantId!', {
                cartRestaurantId: cartRestaurantId,
                fetchedRestaurantId: fetchedRestaurantId,
                fetched_id: data._id?.toString(),
                fetched_restaurantId: data.restaurantId,
                cartRestaurantName: cartRestaurantName,
                fetchedRestaurantName: fetchedRestaurantName
              });
              // Don't set restaurantData if IDs don't match - this prevents wrong restaurant assignment
              setLoadingRestaurant(false);
              return;
            }

            if (!restaurantNameMatches) {
              debugWarn('?? WARNING: Restaurant name mismatch:', {
                cartRestaurantName: cartRestaurantName,
                fetchedRestaurantName: fetchedRestaurantName
              });
              // Still proceed but log warning
            }

            debugLog("? Restaurant data loaded from cart restaurantId:", {
              _id: data._id,
              restaurantId: data.restaurantId,
              name: data.name,
              cartRestaurantId: cartRestaurantId,
              cartRestaurantName: cartRestaurantName
            })
            setRestaurantData(data)
            setLoadingRestaurant(false)
            return
          }
        } catch (error) {
          debugWarn("?? Failed to fetch by cart restaurantId, trying fallback...", error)
        }
      }

      // Strategy 2: If no restaurantId in cart, search by restaurant name
      if (cart[0]?.restaurant && !restaurantData) {
        try {
          debugLog("?? Searching restaurant by name:", cart[0].restaurant)
          const searchResponse = await restaurantAPI.getRestaurants({ limit: 100 })
          const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []
          debugLog("?? Fetched", restaurants.length, "restaurants for name search")

          // Try exact match first
          let matchingRestaurant = restaurants.find(r =>
            r.name?.toLowerCase().trim() === cart[0].restaurant?.toLowerCase().trim()
          )

          // If no exact match, try partial match
          if (!matchingRestaurant) {
            debugLog("?? No exact match, trying partial match...")
            matchingRestaurant = restaurants.find(r =>
              r.name?.toLowerCase().includes(cart[0].restaurant?.toLowerCase().trim()) ||
              cart[0].restaurant?.toLowerCase().trim().includes(r.name?.toLowerCase())
            )
          }

          if (matchingRestaurant) {
            // CRITICAL: Validate that the found restaurant matches cart items
            const cartRestaurantName = cart[0]?.restaurant?.toLowerCase().trim();
            const foundRestaurantName = matchingRestaurant.name?.toLowerCase().trim();

            if (cartRestaurantName && foundRestaurantName && cartRestaurantName !== foundRestaurantName) {
              debugError("? CRITICAL: Restaurant name mismatch!", {
                cartRestaurantName: cart[0]?.restaurant,
                foundRestaurantName: matchingRestaurant.name,
                cartRestaurantId: cart[0]?.restaurantId,
                foundRestaurantId: matchingRestaurant.restaurantId || matchingRestaurant._id
              });
              // Don't set restaurantData if names don't match - this prevents wrong restaurant assignment
              setLoadingRestaurant(false);
              return;
            }

            debugLog("? Found restaurant by name:", {
              name: matchingRestaurant.name,
              _id: matchingRestaurant._id,
              restaurantId: matchingRestaurant.restaurantId,
              slug: matchingRestaurant.slug,
              cartRestaurantName: cart[0]?.restaurant
            })
            setRestaurantData(matchingRestaurant)
            setLoadingRestaurant(false)
            return
          } else {
            debugWarn("?? Restaurant not found even by name search. Searched in", restaurants.length, "restaurants")
            if (restaurants.length > 0) {
              debugLog("?? Available restaurant names:", restaurants.map(r => r.name).slice(0, 10))
            }
          }
        } catch (searchError) {
          debugWarn("?? Error searching restaurants by name:", searchError)
        }
      }

      // If all strategies fail, set to null
      setRestaurantData(null)
      setLoadingRestaurant(false)
    }

    fetchRestaurantData()
  }, [cart.length, cart[0]?.restaurantId, cart[0]?.restaurant])

  // Fetch approved addons for the restaurant
  useEffect(() => {
    const fetchAddonsWithId = async (idToUse) => {

      debugLog("?? Addons fetch - Using ID:", {
        restaurantData: restaurantData ? {
          _id: restaurantData._id,
          restaurantId: restaurantData.restaurantId,
          name: restaurantData.name
        } : 'Not loaded',
        cartRestaurantId: restaurantId,
        idToUse: idToUse
      })

      // Convert to string for validation
      const idString = String(idToUse)
      debugLog("?? Restaurant ID string:", idString, "Type:", typeof idString, "Length:", idString.length)

      // Validate ID format (should be ObjectId or restaurantId format)
      const isValidIdFormat = /^[a-zA-Z0-9\-_]+$/.test(idString) && idString.length >= 3

      if (!isValidIdFormat) {
        debugWarn("?? Restaurant ID format invalid:", idString)
        setAddons([])
        return
      }

      try {
        setLoadingAddons(true)
        debugLog("?? Fetching addons for restaurant ID:", idString)
        const response = await restaurantAPI.getAddonsByRestaurantId(idString)
        debugLog("? Addons API response received:", response?.data)
        debugLog("?? Response structure:", {
          success: response?.data?.success,
          data: response?.data?.data,
          addons: response?.data?.data?.addons,
          directAddons: response?.data?.addons
        })

        const data = response?.data?.data?.addons || response?.data?.addons || []
        debugLog("?? Fetched addons count:", data.length)
        debugLog("?? Fetched addons data:", JSON.stringify(data, null, 2))

        if (data.length === 0) {
          debugWarn("?? No addons returned from API. Response:", response?.data)
        } else {
          debugLog("? Successfully fetched", data.length, "addons:", data.map(a => a.name))
        }

        setAddons(data)
      } catch (error) {
        // Log error for debugging
        debugError("? Addons fetch error:", {
          code: error.code,
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
          data: error.response?.data
        })
        // Silently handle network errors and 404 errors
        // Network errors (ERR_NETWORK) happen when backend is not running - this is OK for development
        // 404 errors mean restaurant might not have addons or restaurant not found - also OK
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error fetching addons:", error)
        }
        // Continue with cart even if addons fetch fails
        setAddons([])
      } finally {
        setLoadingAddons(false)
      }
    }

    const fetchAddons = async () => {
      if (cart.length === 0) {
        setAddons([])
        return
      }

      // Wait for restaurantData to be loaded (including fallback search)
      if (loadingRestaurant) {
        debugLog("? Waiting for restaurantData to load (including fallback search)...")
        return
      }

      // Must have restaurantData to fetch addons
      if (!restaurantData) {
        debugWarn("?? No restaurantData available for addons fetch")
        setAddons([])
        return
      }

      // Use restaurantData ID (most reliable)
      const idToUse = restaurantData._id || restaurantData.restaurantId
      if (!idToUse) {
        debugWarn("?? No valid restaurant ID in restaurantData")
        setAddons([])
        return
      }

      debugLog("? Using restaurantData ID for addons:", idToUse)
      fetchAddonsWithId(idToUse)
    }

    fetchAddons()
  }, [restaurantData, cart.length, loadingRestaurant])

  // Fetch coupons for items in cart
  useEffect(() => {
    const fetchCouponsForCartItems = async () => {
      if (cart.length === 0 || !restaurantId) {
        setAvailableCoupons([])
        return
      }

      debugLog(`[CART-COUPONS] Fetching coupons for ${cart.length} items in cart`)
      setLoadingCoupons(true)

      const allCoupons = []
      const uniqueCouponCodes = new Set()

      // Fetch coupons for each item in cart
      for (const cartItem of cart) {
        const couponItemId = cartItem.itemId || cartItem.id
        if (!couponItemId) {
          debugLog(`[CART-COUPONS] Skipping item without id:`, cartItem)
          continue
        }

        try {
          debugLog(`[CART-COUPONS] Fetching coupons for itemId: ${couponItemId}, name: ${cartItem.name}`)
          const response = await restaurantAPI.getCouponsByItemIdPublic(restaurantId, couponItemId)

          if (response?.data?.success && response?.data?.data?.coupons) {
            const coupons = response.data.data.coupons
            debugLog(`[CART-COUPONS] Found ${coupons.length} coupons for item ${couponItemId}`)

            // Add coupons, avoiding duplicates
            coupons.forEach(coupon => {
              if (!uniqueCouponCodes.has(coupon.couponCode)) {
                uniqueCouponCodes.add(coupon.couponCode)
                // Convert backend coupon format to frontend format
                allCoupons.push({
                  code: coupon.couponCode,
                  discount: coupon.originalPrice - coupon.discountedPrice,
                  discountPercentage: coupon.discountPercentage,
                  discountDisplay: coupon.discountType === "percentage"
                    ? `${coupon.discountPercentage}% OFF`
                    : `${RUPEE_SYMBOL}${Math.max(0, (coupon.originalPrice || 0) - (coupon.discountedPrice || 0))} OFF`,
                  minOrder: coupon.minOrderValue || 0,
                  description: coupon.discountType === "percentage"
                    ? `${coupon.discountPercentage}% OFF with '${coupon.couponCode}'`
                    : `Save ${RUPEE_SYMBOL}${Math.max(0, (coupon.originalPrice || 0) - (coupon.discountedPrice || 0))} with '${coupon.couponCode}'`,
                  originalPrice: coupon.originalPrice,
                  discountedPrice: coupon.discountedPrice,
                  customerGroup: coupon.customerGroup || "all",
                  isGlobalCoupon: Boolean(coupon.isGlobalCoupon),
                  itemId: couponItemId,
                  itemName: cartItem.name,
                })
              }
            })
          }
        } catch (error) {
          debugError(`[CART-COUPONS] Error fetching coupons for item ${cartItem.id}:`, error)
        }
      }

      debugLog(`[CART-COUPONS] Total unique coupons found: ${allCoupons.length}`, allCoupons)
      setAvailableCoupons(allCoupons)
      setLoadingCoupons(false)
    }

    fetchCouponsForCartItems()
  }, [cart, restaurantId])

  // Calculate pricing from backend whenever cart, address, or coupon changes
  useEffect(() => {
    const calculatePricing = async () => {
      if (cart.length === 0 || !hasSavedAddress) {
        setPricing(null)
        return
      }

      try {
        setLoadingPricing(true)
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price, // Price should already be in INR
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: item.isVeg !== false,
          // Same as placement below. Without them the quote leaves out the
          // add-ons the order is then charged for.
          addonIds: Array.isArray(item.addonIds) ? item.addonIds : []
        }))

        const resolvedRestaurantId = restaurantData?._id || restaurantData?.restaurantId || restaurantId || undefined
        const resolvedCouponCode = appliedCoupon?.code || couponCode || undefined

        const response = await orderAPI.calculateOrder({
          items,
          restaurantId: resolvedRestaurantId,
          deliveryAddress: defaultAddress,
          zoneId: zoneId || undefined,
          couponCode: resolvedCouponCode,
          loyaltyPoints: loyaltyPointsRequested || undefined
        })

        if (response?.data?.success && response?.data?.data?.pricing) {
          setPricing(response.data.data.pricing)

          // Update applied coupon if backend returns one
          if (response.data.data.pricing.appliedCoupon && !appliedCoupon) {
            const coupon = availableCoupons.find(c => c.code === response.data.data.pricing.appliedCoupon.code)
            if (coupon) {
              setAppliedCoupon(coupon)
            }
          }
        }
      } catch (error) {
        // Pricing must come from backend fee settings; do not calculate fee defaults in the browser.
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error calculating pricing:", error)
        }
        setPricing(null)
      } finally {
        setLoadingPricing(false)
      }
    }

    calculatePricing()
  }, [cart, defaultAddress, appliedCoupon, couponCode, restaurantId, restaurantData, zoneId, loyaltyPointsRequested])

  // The customer's loyalty balance, for the "use points" toggle. Silent when
  // signed out or when loyalty is off (the toggle is simply not shown).
  useEffect(() => {
    let cancelled = false
    apiClient
      .get("/platform/loyalty/me", { contextModule: "user" })
      .then((res) => {
        if (!cancelled) setLoyaltySummary(res?.data?.data || null)
      })
      .catch(() => {
        if (!cancelled) setLoyaltySummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch wallet balance
  useEffect(() => {
    const fetchWalletBalance = async () => {
      try {
        setIsLoadingWallet(true)
        const response = await userAPI.getWallet()
        if (response?.data?.success && response?.data?.data?.wallet) {
          setWalletBalance(response.data.data.wallet.balance || 0)
        }
      } catch (error) {
        debugError("Error fetching wallet balance:", error)
        setWalletBalance(0)
      } finally {
        setIsLoadingWallet(false)
      }
    }
    fetchWalletBalance()
  }, [])

  // Fetch fee settings
  useEffect(() => {
    userAPI.getPublicFeeSettings()
      .then(res => {
        const data = res?.data?.data || {}
        setFeeSettings(data)
        if (data.maxAvailableCashLimit !== undefined) {
          setMaxAvailableCashLimit(data.maxAvailableCashLimit)
        } else if (data.codOrderLimit !== undefined && data.codOrderLimit !== null) {
          setMaxAvailableCashLimit(data.codOrderLimit)
        }
      })
      .catch(console.error)
  }, [])

  // Fetch user order count (used for first-time coupon eligibility)
  useEffect(() => {
    const fetchOrderCount = async () => {
      try {
        const response = await userAPI.getOrders({ page: 1, limit: 1 })
        if (response?.data?.success) {
          const totalOrders = response?.data?.data?.pagination?.total || 0
          setUserOrderCount(totalOrders)
        }
      } catch (error) {
        debugError("Error fetching user order count:", error)
        setUserOrderCount(0)
      }
    }

    fetchOrderCount()
  }, [])

  // Use backend pricing only for fee-related bill values.
  const isPricingAvailable = Boolean(pricing)
  const subtotal = pricing?.subtotal ?? cart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0)
  const deliveryFee = Number(pricing?.deliveryFee ?? 0)
  const platformFee = Number(pricing?.platformFee ?? 0)

  // The spend-threshold reward, straight from the pricing the server just
  // computed. Deriving it here from the cart instead would let the cart and
  // the order disagree about what was earned.
  const freebieEarned = pricing?.freebie?.earned || null
  const freebieNext = pricing?.freebie?.next || null

  // Buy-one-get-one, likewise straight from the server's own resolution. The
  // saving is already out of the item total below -- the free units were split
  // onto zero-priced lines before it was summed -- so it is shown, never
  // subtracted again here.
  const bogoLines = Array.isArray(pricing?.bogo?.lines) ? pricing.bogo.lines : []
  const bogoSavings = Number(pricing?.bogo?.savings || 0)
  // Lines a unit or two short of another free one. Server-resolved like the rest,
  // so the cart cannot promise a free unit the order would refuse to grant.
  const bogoNext = Array.isArray(pricing?.bogo?.next) ? pricing.bogo.next : []
  const surgeAmount = Number(pricing?.surgeAmount || 0)
  // Shown as part of the delivery fee, one line, not a separate "Surge" row.
  const deliveryFeeShown = Number((deliveryFee + surgeAmount).toFixed(2))
  const gstCharges = Number(pricing?.tax ?? 0)

  /*
   * The bill, line by line, exactly as the server computed it.
   *
   * Read rather than re-derived: `To Pay` is the server's grand total, so any
   * line computed differently here would print a summary that disagrees with
   * the amount actually charged. Absent on an older server, in which case the
   * lines fall back to the flat fields and the two extra rows simply do not
   * render.
   */
  const bill = pricing?.bill || null
  /*
   * The item and packaging lines BEFORE the coupon, because the coupon gets its
   * own row below. Printing the discounted line beside a coupon row would show
   * the same money coming off twice; printing the full line beside the raw
   * `discount` would take off too much, since on an inclusive menu the coupon
   * came off a price that still had tax in it. `discountOnNet` is what it
   * actually removed from these two lines.
   */
  const billItemAmount = Number(bill?.netItemAmountBeforeDiscount ?? bill?.netItemAmount ?? subtotal)
  const billPackagingFee = Number(
    bill?.netPackagingFeeBeforeDiscount ?? bill?.netPackagingFee ?? pricing?.packagingFee ?? 0,
  )
  const billGst = Number(bill?.gstOnItems ?? gstCharges)
  const billGstRate = Number(bill?.gstRate ?? 0)
  const billPlatformFeeGst = Number(bill?.platformFeeGst ?? 0)
  const billPlatformFeeGstRate = Number(bill?.platformFeeGstRate ?? 0)

  /*
   * A menu priced inclusive of GST is shown at the price the menu advertised.
   *
   * Printing the net figure (a Rs 200 dish as "Item Total Rs 190.48") reads as
   * though we changed the price, when the tax was inside it all along. So the
   * listed amount is shown and the GST line is marked as already included --
   * displayed for transparency, not added again.
   *
   * Only when the WHOLE food total is inclusive. A cart mixing inclusive and
   * exclusive dishes has no single honest gross line, which is exactly what
   * bill.pricesIncludeGst reports, so those fall back to the net presentation
   * where every line still adds up.
   */
  /*
   * The gross presentation only reconciles when EVERYTHING taxable is
   * inclusive. Admin-owned packaging stays exclusive even on an inclusive menu,
   * and its tax still sits inside gstOnItems -- suppressing the GST line there
   * loses a real charge and the printed lines come up a rupee short. That case
   * keeps the net presentation, where every line adds up.
   *
   * A cart mixing inclusive and exclusive dishes reports pricesIncludeGst
   * false and lands here too, which is what bill.js intends: there is no single
   * honest gross line to print.
   */
  /*
   * Compared BEFORE the coupon, deliberately.
   *
   * netPackagingFee is computed after the discount, so a coupon large enough to
   * spill past the food onto the packaging makes it smaller for a reason that
   * has nothing to do with tax. Reading that as "packaging is inclusive" picked
   * the gross layout on a platform-owned packaging line and suppressed a GST
   * line that held real packaging tax, leaving the printed bill several rupees
   * short of the amount charged. Both figures here are pre-coupon, so a
   * difference between them can only be the tax.
   *
   * An older order without the pre-coupon figure falls through as exclusive,
   * which is the presentation that always reconciles.
   */
  const netPackagingBeforeDiscount = Number(bill?.netPackagingFeeBeforeDiscount)
  const packagingIsInclusive =
    Number(bill?.packagingFee ?? 0) <= 0
    || (Number.isFinite(netPackagingBeforeDiscount)
      && netPackagingBeforeDiscount < Number(bill?.packagingFee ?? 0) - 0.005)
  const gstIsIncludedInItems = bill?.pricesIncludeGst === true && packagingIsInclusive

  // Gross lines must be paired with the gross coupon; netting one against the
  // other is what made a Rs 50 coupon show as Rs 47.62 and miss the total.
  const billItemAmountShown = gstIsIncludedInItems
    ? Number(bill?.itemAmount ?? billItemAmount)
    : billItemAmount
  const billPackagingFeeShown = gstIsIncludedInItems
    ? Number(bill?.packagingFee ?? billPackagingFee)
    : billPackagingFee

  /*
   * The platform fee and its own GST as one line, the way the client's bill
   * format states it: "Platform fee (10) 11.80". Two lines charged the same
   * money but read as two separate fees.
   */
  const billPlatformFeeShown = Number(platformFee ?? 0) + billPlatformFeeGst
  const billTip = Number(bill?.tip ?? 0)
  // Loyalty points, taken off after tax (the server's figure).
  const billLoyaltyDiscount = Number(pricing?.loyaltyDiscount ?? bill?.loyaltyDiscount ?? 0) || 0
  const billLoyaltyPoints = Number(pricing?.loyaltyPoints ?? bill?.loyaltyPoints ?? 0) || 0
  const billRoundOff = Number(bill?.roundOff ?? 0)
  const discount = pricing?.discount ?? (appliedCoupon ? Math.min(appliedCoupon.discount, subtotal * 0.5) : 0)
  const billDiscount = Number(bill?.discountOnNet ?? discount ?? 0) || 0
  // Paired with whichever item line is being shown: the gross coupon against a
  // gross line, the net-equivalent one against the net lines.
  const billDiscountShown = gstIsIncludedInItems
    ? (Number(bill?.discount ?? billDiscount) || 0)
    : billDiscount
  const total = pricing?.total ?? (subtotal + deliveryFee + platformFee + gstCharges + surgeAmount - (pricing?.discount ?? discount))
  /*
   * What the customer actually saved: the coupon plus any free buy-one-get-one
   * units. Derived from those two directly rather than from
   * (totalBeforeDiscount - total), which stopped meaning anything once the
   * total gained lines -- packaging, the govt fee, the tip -- that
   * totalBeforeDiscount does not carry. That subtraction went negative on a
   * tipped order and quietly hid a real discount.
   */
  const savings = Number(pricing?.savings ?? (Number(discount || 0) + bogoSavings)) || 0
  /*
   * The struck-through "before" figure: the amount charged plus what was saved.
   *
   * It used to be rebuilt from a handful of lines (food, delivery, platform
   * fee, GST, surge) and left out packaging, the GST on the platform fee and
   * the tip. So on most orders it sat below the total it was meant to be
   * above. Built this way it always includes every line the total does, and
   * the gap between the two is exactly the "You saved" figure beside them.
   */
  const totalBeforeDiscount = total + savings

  const showCodOption = useMemo(() => {
    if (feeSettings?.codOrderLimit !== undefined && feeSettings?.codOrderLimit !== null && total >= feeSettings.codOrderLimit) {
      return false
    }
    if (total > maxAvailableCashLimit) {
      return false
    }
    return true
  }, [feeSettings, maxAvailableCashLimit, total])

  // Automatically switch payment method to razorpay if cash/COD is disabled and currently selected
  useEffect(() => {
    if (!showCodOption && selectedPaymentMethod === "cash") {
      setSelectedPaymentMethod("razorpay")
    }
  }, [showCodOption, selectedPaymentMethod])
  const selectedPaymentLabel =
    selectedPaymentMethod === "wallet"
      ? "Wallet"
      : selectedPaymentMethod === "razorpay"
        ? "Online Payment"
        : "Cash on Delivery"

  // Restaurant name from data or cart
  const restaurantName = restaurantData?.name || cart[0]?.restaurant || "Restaurant"

  const handleShare = async () => {
    const restaurantNameStr = restaurantName || companyName || "this restaurant"
    const shareUrl = window.location.href
    const shareText = `Check out what I'm ordering from ${restaurantNameStr}! ${shareUrl}`

    const payload = {
      title: `My Cart at ${restaurantNameStr}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Link shared successfully")
      return
    }

    openShareModal(payload)
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      document.body.removeChild(textArea)
    }
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  const handleBack = () => {
    // Priority: slug > restaurantId (both work for the restaurant details route)
    const idOrSlug = restaurantData?.slug || restaurantId
    if (idOrSlug) {
      navigate(`/food/user/restaurants/${idOrSlug}`)
    } else {
      goBack()
    }
  }

  // Handler to select address by label (Home, Office, Other)
  const handleSelectAddressByLabel = async (label) => {
    try {
      // Find address with matching label
      const targetLabel = normalizeAddressLabel(label)
      const address = addresses.find(addr => normalizeAddressLabel(addr.label) === targetLabel)

      if (!address) {
        toast.error(`No ${label} address found. Please add an address first.`)
        return
      }

      await handleSelectSavedAddress(address)
    } catch (error) {
      debugError(`Error selecting ${label} address:`, error)
      toast.error(`Failed to select ${label} address. Please try again.`)
    }
  }

  const handleSelectSavedAddress = async (address) => {
    try {
      const addressId = getAddressId(address)
      if (addressId) {
        setSelectedAddressId(addressId)
        setDefaultAddress(addressId)
      }

      // Get coordinates from address location
      const coordinates = address.location?.coordinates || []
      const longitude = coordinates[0]
      const latitude = coordinates[1]

      if (!latitude || !longitude) {
        toast.error(`Invalid coordinates for ${address.label || "saved"} address`)
        return
      }

      // Update location in backend
      await userAPI.updateLocation({
        latitude,
        longitude,
        address: `${address.street}, ${address.city}`,
        city: address.city,
        state: address.state,
        area: address.additionalDetails || "",
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      })

      // Update the location in localStorage
      const locationData = {
        city: address.city,
        state: address.state,
        address: `${address.street}, ${address.city}`,
        area: address.additionalDetails || "",
        zipCode: address.zipCode,
        latitude,
        longitude,
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      }
      localStorage.setItem("userLocation", JSON.stringify(locationData))
      // User selected a saved address from Cart; prefer saved mode.
      try {
        localStorage.setItem("deliveryAddressMode", "saved")
        setDeliveryAddressMode("saved")
      } catch { }

      toast.success(`${address.label || "Saved"} address selected!`)
    } catch (error) {
      debugError("Error selecting saved address:", error)
      toast.error("Failed to select address. Please try again.")
    }
  }

  const handleApplyCoupon = async (coupon) => {
    if (subtotal < (Number(coupon.minOrder) || 0)) {
      toast.error(`Min order ${RUPEE_SYMBOL}${Number(coupon.minOrder || 0)}`)
      return
    }

    // Validate with backend first; only set applied if backend accepts
    if (cart.length > 0 && hasSavedAddress) {
      try {
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: item.isVeg !== false
        }))

        const response = await orderAPI.calculateOrder({
          items,
          restaurantId: restaurantData?._id || restaurantData?.restaurantId || restaurantId || null,
          deliveryAddress: defaultAddress,
          zoneId: zoneId || undefined,
          couponCode: coupon.code,
          loyaltyPoints: loyaltyPointsRequested || undefined
        })

        const pricingData = response?.data?.data?.pricing
        if (!pricingData || !pricingData.appliedCoupon) {
          toast.error(pricingData?.couponRejectedReason || "Coupon not applicable")
          return
        }

        setPricing(pricingData)
        setAppliedCoupon(coupon)
        setCouponCode(coupon.code)
        setManualCouponCode(coupon.code)
        setShowCoupons(false)
      } catch (error) {
        debugError("Error recalculating pricing:", error)
        toast.error("Failed to apply coupon")
      }
    }
  }

  const handleApplyCouponCode = async () => {
    const inputCode = manualCouponCode.trim().toUpperCase()
    if (!inputCode) {
      toast.error("Enter coupon code")
      return
    }

    if (cart.length === 0 || !hasSavedAddress) {
      toast.error("Add items and delivery address first")
      return
    }

    const matchedCoupon = availableCoupons.find(
      (coupon) => String(coupon.code || "").toUpperCase() === inputCode,
    )


    try {
      const items = cart.map(item => ({
        itemId: item.itemId || item.id,
        name: item.name,
        price: item.price,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        quantity: item.quantity || 1,
        image: item.image,
        description: item.description,
        isVeg: item.isVeg !== false
      }))

      const response = await orderAPI.calculateOrder({
        items,
        restaurantId: restaurantData?._id || restaurantData?.restaurantId || restaurantId || null,
        deliveryAddress: defaultAddress,
        zoneId: zoneId || undefined,
        couponCode: inputCode,
        loyaltyPoints: loyaltyPointsRequested || undefined
      })

      const pricingData = response?.data?.data?.pricing
      if (!pricingData) {
        toast.error("Unable to validate coupon")
        return
      }

      if (!pricingData.appliedCoupon) {
        toast.error(pricingData.couponRejectedReason || "Invalid or unavailable coupon code")
        setCouponCode("")
        return
      }

      setPricing(pricingData)
      setCouponCode(inputCode)
      setAppliedCoupon(
        matchedCoupon || {
          code: inputCode,
          discount: pricingData.appliedCoupon.discount || 0,
          minOrder: 0,
          customerGroup: "all",
        },
      )
      setShowCoupons(false)
      toast.success("Coupon applied")
    } catch (error) {
      debugError("Error applying coupon code:", error)
      toast.error("Failed to apply coupon")
    }
  }


  const handleRemoveCoupon = async () => {
    setAppliedCoupon(null)
    setCouponCode("")
    setManualCouponCode("")

    // Recalculate pricing without coupon
    if (cart.length > 0 && hasSavedAddress) {
      try {
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: item.isVeg !== false
        }))

        const response = await orderAPI.calculateOrder({
          items,
          restaurantId: restaurantData?._id || restaurantData?.restaurantId || restaurantId || null,
          deliveryAddress: defaultAddress,
          zoneId: zoneId || undefined,
          couponCode: null,
          loyaltyPoints: loyaltyPointsRequested || undefined
        })

        if (response?.data?.success && response?.data?.data?.pricing) {
          setPricing(response.data.data.pricing)
        }
      } catch (error) {
        debugError("Error recalculating pricing:", error)
      }
    }
  }


  const handlePlaceOrder = async () => {
    if (!hasSavedAddress) {
      toast.error("Please choose a delivery location to continue")
      openLocationSelector()
      return
    }

    if (isScheduled) {
      if (!scheduledDate || !scheduledTime) {
        toast.error("Please select both date and time to schedule your order")
        return
      }
      const scheduleString = `${scheduledDate}T${scheduledTime}:00`
      const scheduleDateObj = new Date(scheduleString)
      if (scheduleDateObj < new Date()) {
        toast.error("Scheduled time must be in the future")
        return
      }
    }

    if (cart.length === 0) {
      alert("Your cart is empty")
      return
    }

    if (!pricing) {
      toast.error(loadingPricing ? "Calculating fees. Please wait." : "Unable to calculate fees. Please try again.")
      return
    }

    setIsPlacingOrder(true)

    // Use API_BASE_URL from config (supports both dev and production)

    try {
      debugLog("?? Starting order placement process...")
      debugLog("?? Cart items:", cart.map(item => ({ id: item.id, name: item.name, quantity: item.quantity, price: item.price })))
      debugLog("?? Applied coupon:", appliedCoupon?.code || "None")
      debugLog("?? Delivery address:", defaultAddress?.label || defaultAddress?.city)

      // Ensure couponCode is included in pricing
      const orderPricing = { ...pricing };

      // Add couponCode if not present but coupon is applied
      if (!orderPricing.couponCode && appliedCoupon?.code) {
        orderPricing.couponCode = appliedCoupon.code;
      }

      // Include all cart items (main items + addons)
      // Note: Addons are added as separate cart items when user clicks the + button
      const orderItems = cart.map(item => ({
        itemId: item.itemId || item.id,
        name: item.name,
        price: item.price,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        quantity: item.quantity || 1,
        image: item.image || "",
        description: item.description || "",
        isVeg: item.isVeg !== false,
        preparationTime: item.preparationTime,
        // Ids only. The server prices add-ons from the published record and
        // refuses any this dish does not offer, so anything else sent here is
        // ignored by design.
        addonIds: Array.isArray(item.addonIds) ? item.addonIds : []
      }))

      debugLog("?? Order items to send:", orderItems)
      debugLog("?? Order pricing:", orderPricing)

      // Check API base URL before making request (for debugging)
      const fullUrl = `${API_BASE_URL}${API_ENDPOINTS.ORDER.CREATE}`;
      debugLog("?? Making request to:", fullUrl)
      debugLog("?? Authentication token present:", !!localStorage.getItem('accessToken') || !!localStorage.getItem('user_accessToken'))

      // CRITICAL: Validate restaurant ID before placing order
      // Ensure we're using the correct restaurant from restaurantData (most reliable)
      const finalRestaurantId = restaurantData?._id || restaurantData?.restaurantId || null;
      const finalRestaurantName = restaurantData?.name || null;

      if (!finalRestaurantId) {
        debugError('? CRITICAL: Cannot place order - Restaurant ID is missing!');
        debugError('?? Debug info:', {
          restaurantData: restaurantData ? {
            _id: restaurantData._id,
            restaurantId: restaurantData.restaurantId,
            name: restaurantData.name
          } : 'Not loaded',
          cartRestaurantId: restaurantId,
          cartRestaurantName: cart[0]?.restaurant,
          cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            restaurant: item.restaurant,
            restaurantId: item.restaurantId
          }))
        });
        alert('Error: Restaurant information is missing. Please refresh the page and try again.');
        setIsPlacingOrder(false);
        return;
      }

      // CRITICAL: Validate that ALL cart items belong to the SAME restaurant
      const cartRestaurantIds = cart
        .map(item => item.restaurantId)
        .filter(Boolean)
        .map(id => String(id).trim()); // Normalize to string and trim

      const cartRestaurantNames = cart
        .map(item => item.restaurant)
        .filter(Boolean)
        .map(name => name.trim().toLowerCase()); // Normalize names

      // Get unique values (after normalization)
      const uniqueRestaurantIds = [...new Set(cartRestaurantIds)];
      const uniqueRestaurantNames = [...new Set(cartRestaurantNames)];

      // Check if cart has items from multiple restaurants
      // Note: If restaurant names match, allow even if IDs differ (same restaurant, different ID format)
      if (uniqueRestaurantNames.length > 1) {
        // Different restaurant names = definitely different restaurants
        debugError('? CRITICAL ERROR: Cart contains items from multiple restaurants!', {
          restaurantIds: uniqueRestaurantIds,
          restaurantNames: uniqueRestaurantNames,
          cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            restaurant: item.restaurant,
            restaurantId: item.restaurantId
          }))
        });

        // Automatically clean cart to keep items from the restaurant matching restaurantData
        if (finalRestaurantId && finalRestaurantName) {
          debugLog('?? Auto-cleaning cart to keep items from:', finalRestaurantName);
          cleanCartForRestaurant(finalRestaurantId, finalRestaurantName);
          toast.error('Cart contained items from different restaurants. Items from other restaurants have been removed.');
        } else {
          // If restaurantData is not available, keep items from first restaurant in cart
          const firstRestaurantId = cart[0]?.restaurantId;
          const firstRestaurantName = cart[0]?.restaurant;
          if (firstRestaurantId && firstRestaurantName) {
            debugLog('?? Auto-cleaning cart to keep items from first restaurant:', firstRestaurantName);
            cleanCartForRestaurant(firstRestaurantId, firstRestaurantName);
            toast.error('Cart contained items from different restaurants. Items from other restaurants have been removed.');
          } else {
            toast.error('Cart contains items from different restaurants. Please clear cart and try again.');
          }
        }

        setIsPlacingOrder(false);
        return;
      }

      // If restaurant names match but IDs differ, that's OK (same restaurant, different ID format)
      // But log a warning in development
      if (uniqueRestaurantIds.length > 1 && uniqueRestaurantNames.length === 1) {
        if (process.env.NODE_ENV === 'development') {
          debugWarn('?? Cart items have different restaurant IDs but same name. This is OK if IDs are in different formats.', {
            restaurantIds: uniqueRestaurantIds,
            restaurantName: uniqueRestaurantNames[0]
          });
        }
      }

      // Validate that cart items' restaurantId matches the restaurantData
      if (cartRestaurantIds.length > 0) {
        const cartRestaurantId = cartRestaurantIds[0];

        // Check if cart restaurantId matches restaurantData
        const restaurantIdMatches =
          cartRestaurantId === finalRestaurantId ||
          cartRestaurantId === restaurantData?._id?.toString() ||
          cartRestaurantId === restaurantData?.restaurantId;

        if (!restaurantIdMatches) {
          debugError('? CRITICAL ERROR: Cart restaurantId does not match restaurantData!', {
            cartRestaurantId: cartRestaurantId,
            finalRestaurantId: finalRestaurantId,
            restaurantDataId: restaurantData?._id?.toString(),
            restaurantDataRestaurantId: restaurantData?.restaurantId,
            restaurantDataName: restaurantData?.name,
            cartRestaurantName: cartRestaurantNames[0]
          });
          alert(`Error: Cart items belong to "${cartRestaurantNames[0] || 'Unknown Restaurant'}" but restaurant data doesn't match. Please refresh the page and try again.`);
          setIsPlacingOrder(false);
          return;
        }
      }

      // Validate restaurant name matches
      if (cartRestaurantNames.length > 0 && finalRestaurantName) {
        const cartRestaurantName = cartRestaurantNames[0];
        if (cartRestaurantName.toLowerCase().trim() !== finalRestaurantName.toLowerCase().trim()) {
          debugError('? CRITICAL ERROR: Restaurant name mismatch!', {
            cartRestaurantName: cartRestaurantName,
            finalRestaurantName: finalRestaurantName
          });
          alert(`Error: Cart items belong to "${cartRestaurantName}" but restaurant data shows "${finalRestaurantName}". Please refresh the page and try again.`);
          setIsPlacingOrder(false);
          return;
        }
      }

      // Log order details for debugging
      debugLog('? Order validation passed - Placing order with restaurant:', {
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName,
        restaurantDataId: restaurantData?._id,
        restaurantDataRestaurantId: restaurantData?.restaurantId,
        cartRestaurantId: cartRestaurantIds[0],
        cartRestaurantName: cartRestaurantNames[0],
        cartItemCount: cart.length
      });

      // FINAL VALIDATION: Double-check restaurantId before sending to backend
      const cartRestaurantId = cart[0]?.restaurantId;
      if (cartRestaurantId && cartRestaurantId !== finalRestaurantId &&
        cartRestaurantId !== restaurantData?._id?.toString() &&
        cartRestaurantId !== restaurantData?.restaurantId) {
        debugError('? CRITICAL: Final validation failed - restaurantId mismatch!', {
          cartRestaurantId: cartRestaurantId,
          finalRestaurantId: finalRestaurantId,
          restaurantDataId: restaurantData?._id?.toString(),
          restaurantDataRestaurantId: restaurantData?.restaurantId,
          cartRestaurantName: cart[0]?.restaurant,
          finalRestaurantName: finalRestaurantName
        });
        alert('Error: Restaurant information mismatch detected. Please refresh the page and try again.');
        setIsPlacingOrder(false);
        return;
      }

      const orderPayload = {
        items: orderItems,
        address: {
          ...defaultAddress,
          phone: recipientPhone || defaultAddress?.phone || "",
          name: recipientName,
          fullName: recipientName,
        },
        customerName: recipientName,
        customerPhone: recipientPhone || defaultAddress?.phone || "",
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName || undefined,
        pricing: orderPricing,
        // Top-level as well: this is the field placement re-prices from. The
        // server also reads pricing.couponCode, for builds that only send that.
        couponCode: orderPricing.couponCode || undefined,
        // The points the quote above applied (already clamped by the server).
        loyaltyPoints: Number(orderPricing.loyaltyPoints) > 0 ? Number(orderPricing.loyaltyPoints) : undefined,
        note: note || "",
        sendCutlery: sendCutlery !== false,
        paymentMethod: selectedPaymentMethod,
        // `useZone()` can return `null`. Zod expects string/undefined, not null.
        zoneId: zoneId || undefined,
        scheduledAt: isScheduled ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : undefined,
      };
      // Log final order details (including paymentMethod for COD debugging)
      debugLog('?? FINAL: Sending order to backend with:', {
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName,
        itemCount: orderItems.length,
        totalAmount: orderPricing.total,
        paymentMethod: orderPayload.paymentMethod
      });

      // Check wallet balance if wallet payment selected
      if (selectedPaymentMethod === "wallet" && walletBalance < total) {
        toast.error(`Insufficient wallet balance. Required: ${RUPEE_SYMBOL}${total.toFixed(0)}, Available: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`)
        setIsPlacingOrder(false)
        return
      }

      // Create order in backend
      const orderResponse = await orderAPI.createOrder(orderPayload)

      debugLog("? Order created successfully:", orderResponse.data)

      const { order, razorpay } = orderResponse.data.data

      // Cash flow: order placed without online payment
      if (selectedPaymentMethod === "cash") {
        toast.success("Order placed with Cash on Delivery")
        setPlacedOrderId(order?._id || order?.orderId || order?.id || null)
        setShowOrderSuccess(true)
        window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
        clearCart()
        setNote("")
        setShowNoteInput(false)
        try {
          window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
        } catch {
          // ignore
        }
        setIsPlacingOrder(false)
        return
      }

      // Wallet flow: order placed with wallet payment (already processed in backend)
      if (selectedPaymentMethod === "wallet") {
        toast.success("Order placed with Wallet payment")
        setPlacedOrderId(order?._id || order?.orderId || order?.id || null)
        setShowOrderSuccess(true)
        window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
        clearCart()
        setNote("")
        setShowNoteInput(false)
        try {
          window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
        } catch {
          // ignore
        }
        setIsPlacingOrder(false)
        // Refresh wallet balance
        try {
          const walletResponse = await userAPI.getWallet()
          if (walletResponse?.data?.success && walletResponse?.data?.data?.wallet) {
            setWalletBalance(walletResponse.data.data.wallet.balance || 0)
          }
        } catch (error) {
          debugError("Error refreshing wallet balance:", error)
        }
        return
      }

      if (!razorpay || !razorpay.orderId || !razorpay.key) {
        debugError("? Razorpay initialization failed:", { razorpay, order })
        throw new Error(razorpay ? "Razorpay payment gateway is not configured. Please contact support." : "Failed to initialize payment")
      }

      debugLog("?? Razorpay order created:", {
        orderId: razorpay.orderId,
        amount: razorpay.amount,
        currency: razorpay.currency,
        keyPresent: !!razorpay.key
      })

      // Get user info for Razorpay prefill
      const userInfo = userProfile || {}
      const userPhone = recipientPhone || userInfo.phone || defaultAddress?.phone || ""
      const userEmail = userInfo.email || ""
      const userName = recipientName || userInfo.name || ""

      // Format phone number (remove non-digits, take last 10 digits)
      const formattedPhone = userPhone.replace(/\D/g, "").slice(-10)

      debugLog("?? User info for payment:", {
        name: userName,
        email: userEmail,
        phone: formattedPhone
      })

      // Get company name for Razorpay
      const companyName = await getCompanyNameAsync()

      // Initialize Razorpay payment
      await initRazorpayPayment({
        key: razorpay.key,
        amount: razorpay.amount, // Already in paise from backend
        currency: razorpay.currency || 'INR',
        order_id: razorpay.orderId,
        name: companyName,
        description: `Order ${order._id || order.orderId} - ${RUPEE_SYMBOL}${(razorpay.amount / 100).toFixed(2)}`,
        prefill: {
          name: userName,
          email: userEmail,
          contact: formattedPhone
        },
        notes: {
          orderId: order._id || order.orderId,
          userId: userInfo.id || "",
          restaurantId: restaurantId || "unknown"
        },
        handler: async (response) => {
          try {
            debugLog("? Payment successful, verifying...", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id
            })

            // Verify payment with backend
            const verifyOrderId = order?._id || order?.id || order?.orderMongoId
            if (!verifyOrderId) {
              throw new Error("Unable to verify payment: missing order id from create-order response")
            }
            const verifyResponse = await orderAPI.verifyPayment({
              orderId: verifyOrderId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature
            })

            debugLog("? Payment verification response:", verifyResponse.data)

            if (verifyResponse.data.success) {
              // Payment successful
              debugLog("?? Order placed successfully:", {
                orderId: order._id || order.orderId,
                paymentId: verifyResponse.data.data?.payment?.paymentId
              })
              setPlacedOrderId(order._id || order.orderId)
              setShowOrderSuccess(true)
              window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
              clearCart()
              setIsPlacingOrder(false)
            } else {
              throw new Error(verifyResponse.data.message || "Payment verification failed")
            }
          } catch (error) {
            debugError("? Payment verification error:", error)
            const errorMessage =
              error?.response?.data?.message ||
              error?.response?.data?.error?.message ||
              error?.response?.data?.errors?.[0]?.message ||
              error?.message ||
              "Payment verification failed. Please contact support."
            alert(errorMessage)
            setIsPlacingOrder(false)
          }
        },
        onError: (error) => {
          debugError("? Razorpay payment error:", error)
          // Don't show alert for user cancellation
          if (error?.code !== 'PAYMENT_CANCELLED' && error?.message !== 'PAYMENT_CANCELLED') {
            const errorMessage = error?.description || error?.message || "Payment failed. Please try again."
            alert(errorMessage)
          }
          setIsPlacingOrder(false)
        },
        onClose: () => {
          debugLog("?? Payment modal closed by user")
          setIsPlacingOrder(false)
        }
      })
    } catch (error) {
      debugError("? Order creation error:", error)

      let errorMessage = "Failed to create order. Please try again."

      // Handle network errors
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        const backendUrl = API_BASE_URL.replace('/api', '');
        errorMessage = `Network Error: Cannot connect to backend server.\n\n` +
          `Expected backend URL: ${backendUrl}\n\n` +
          `Please check:\n` +
          `1. Backend server is running\n` +
          `2. Backend is accessible at ${backendUrl}\n` +
          `3. Check browser console (F12) for more details\n\n` +
          `If backend is not running, start it with:\n` +
          `cd K9 Rides/backend && npm start`

        debugError("?? Network Error Details:", {
          code: error.code,
          message: error.message,
          config: {
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            fullUrl: error.config?.baseURL + error.config?.url,
            method: error.config?.method
          },
          backendUrl: backendUrl,
          apiBaseUrl: API_BASE_URL
        })

        // Backend disconnected - no health check (new backend in progress)
      }
      // Handle timeout errors
      else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        errorMessage = "Request timed out. The server is taking too long to respond. Please try again."
      }
      // Handle other axios errors
      else if (error.response) {
        // Server responded with error status
        errorMessage = error.response.data?.message || `Server error: ${error.response.status}`
      }
      // Handle other errors
      else if (error.message) {
        errorMessage = error.message
      }

      alert(errorMessage)
      setIsPlacingOrder(false)
    }
  }

  const handleGoToOrders = () => {
    setShowOrderSuccess(false)
    navigate(`/food/user/orders/${placedOrderId}?confirmed=true`)
  }

  // Empty cart state - but don't show if order success or placing order modal is active
  if (cart.length === 0 && !showOrderSuccess && !showPlacingOrder) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a]">
        <div className="bg-white dark:bg-[#1a1a1a] border-b dark:border-gray-800 sticky top-0 z-10">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-gray-800 dark:text-white">Cart</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Utensils className="h-10 w-10 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Your cart is empty</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center">Add items from a restaurant to start a new order</p>
          <Link to="/user">
            <Button className="bg-primary-orange hover:opacity-90 text-white">Browse Restaurants</Button>
          </Link>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#0a0a0a]">
      {/* Header - Sticky at top */}
      <div className="bg-white dark:bg-[#1a1a1a] border-b dark:border-gray-800 sticky top-0 z-20 flex-shrink-0">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between px-3 md:px-6 py-2 md:py-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={handleBack}
              >
                <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
              </Button>
              <div className="min-w-0">
                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400">{restaurantName}</p>
                <p className="text-sm md:text-base font-medium text-gray-800 dark:text-white truncate">
                  {restaurantData?.estimatedDeliveryTime || "10-15 mins"} to <span className="font-semibold">Location</span>
                  <span className="text-gray-400 dark:text-gray-500 ml-1 text-xs md:text-sm">{defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || defaultAddress?.city || "Select address") : "Select address"}</span>
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 md:h-8 md:w-8 flex-shrink-0"
              onClick={handleShare}
            >
              <Share2 className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-44 md:pb-52">
        {/* Savings Banner */}
        {savings > 0 && (
          <div className="bg-blue-100 dark:bg-blue-900/20 px-4 md:px-6 py-2 md:py-3 flex-shrink-0">
            <div className="max-w-7xl mx-auto">
              <p className="text-sm md:text-base font-medium text-blue-800 dark:text-blue-200">
                Saved {RUPEE_SYMBOL}{savings} on this order
              </p>
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
          <div className="max-w-3xl mx-auto">
            {/* Main Cart Content */}
            <div className="space-y-2 md:space-y-4">
              {/* Cart Items */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 md:py-5 rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 dark:border-gray-800">
                <div className="space-y-3 md:space-y-4">
                  {cart.map((item) => (
                    <div key={item.id} className="flex items-start gap-3 md:gap-4">
                      {/* Veg/Non-veg indicator */}
                      <div className={`w-4 h-4 md:w-5 md:h-5 border-2 ${item.isVeg !== false ? 'border-green-600' : 'border-red-600'} flex items-center justify-center mt-1 flex-shrink-0`}>
                        <div className={`w-2 h-2 md:w-2.5 md:h-2.5 rounded-full ${item.isVeg !== false ? 'bg-green-600' : 'bg-red-600'}`} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm md:text-base font-medium text-gray-800 dark:text-gray-200 leading-tight">{item.name}</p>
                        {item.variantName ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.variantName}</p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-3 md:gap-4">
                        {/* Quantity controls */}
                        <div className="flex items-center border border-[#EB590E] dark:border-[#EB590E]/50 rounded">
                          <button
                            className="px-2 md:px-3 py-1 text-[#EB590E] dark:text-[#EB590E] hover:bg-primary-orange/5 dark:hover:bg-[#EB590E]/10"
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          >
                            <Minus className="h-3 w-3 md:h-4 md:w-4" />
                          </button>
                          <span className="px-2 md:px-3 text-sm md:text-base font-semibold text-[#EB590E] dark:text-[#EB590E] min-w-[20px] md:min-w-[24px] text-center">
                            {item.quantity}
                          </span>
                          <button
                            className="px-2 md:px-3 py-1 text-[#EB590E] dark:text-[#EB590E] hover:bg-primary-orange/5 dark:hover:bg-[#EB590E]/10"
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          >
                            <Plus className="h-3 w-3 md:h-4 md:w-4" />
                          </button>
                        </div>

                        <p className="text-sm md:text-base font-medium text-gray-800 dark:text-gray-200 min-w-[50px] md:min-w-[70px] text-right">
                          {RUPEE_SYMBOL}{((item.price || 0) * (item.quantity || 1)).toFixed(0)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add more items */}
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 mt-4 md:mt-6 text-[#EB590E] dark:text-[#EB590E]"
                >
                  <Plus className="h-4 w-4 md:h-5 md:w-5" />
                  <span className="text-sm md:text-base font-medium">Add more items</span>
                </button>
              </div>


              {/* Note & Cutlery */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowNoteInput(!showNoteInput)}
                  className="flex-1 flex items-center gap-2 px-3 md:px-4 py-2 md:py-3 border border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl text-sm md:text-base text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <FileText className="h-4 w-4 md:h-5 md:w-5" />
                  <span className="truncate">{note || "Add a note for the delivery partner"}</span>
                </button>
                <button
                  onClick={() => setSendCutlery(!sendCutlery)}
                  className={`flex items-center gap-2 px-3 md:px-4 py-2 md:py-3 border rounded-lg md:rounded-xl text-sm md:text-base ${sendCutlery ? 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300' : 'border-[#EB590E] dark:border-[#EB590E]/50 text-[#EB590E] dark:text-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/10'}`}
                >
                  <Utensils className="h-4 w-4 md:h-5 md:w-5" />
                  <span className="whitespace-nowrap">
                    {sendCutlery ? "Send cutlery" : "Don't send cutlery"}
                  </span>
                </button>
              </div>

              {/* Note Input */}
              {showNoteInput && (
                <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-3 md:py-4 rounded-lg md:rounded-xl border border-slate-100 dark:border-gray-800">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Delivery instructions
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Eg. Call when outside, ring bell once, leave at gate"
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl p-3 md:p-4 text-sm md:text-base resize-none h-20 md:h-24 focus:outline-none focus:border-[#EB590E] dark:focus:border-[#EB590E] bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-gray-100"
                    maxLength={240}
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Ye note order ke saath save hoga aur assigned delivery partner ko dikh sakta hai.
                    </p>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {note.length}/240
                    </span>
                  </div>
                </div>
              )}

              {/* Complete your meal section - Approved Addons */}
              {addons.length > 0 && (
                <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                    <div className="w-6 h-6 md:w-8 md:h-8 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                      <Sparkles className="h-4 w-4 md:h-5 md:w-5 text-[#EB590E]" />
                    </div>
                    <span className="text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200">Complete your meal with</span>
                  </div>
                  {loadingAddons ? (
                    <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 md:-mx-6 px-4 md:px-6 scrollbar-hide">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex-shrink-0 w-28 md:w-36 animate-pulse">
                          <div className="w-full h-28 md:h-36 bg-gray-200 dark:bg-gray-700 rounded-lg md:rounded-xl" />
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mt-2" />
                          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded mt-1 w-2/3" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 md:-mx-6 px-4 md:px-6 scrollbar-hide">
                      {addons.map((addon) => (
                        <div key={addon.id} className="flex-shrink-0 w-28 md:w-36">
                          <div className="relative bg-gray-100 dark:bg-gray-800 rounded-lg md:rounded-xl overflow-hidden">
                            <img
                              src={addon.image || (addon.images && addon.images[0]) || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop"}
                              alt={addon.name}
                              className="w-full h-28 md:h-36 object-cover rounded-lg md:rounded-xl"
                              onError={(e) => {
                                e.target.onerror = null
                                e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop"
                              }}
                            />
                            <div className="absolute top-1 md:top-2 left-1 md:left-2">
                              <div className="w-3.5 h-3.5 md:w-4 md:h-4 bg-white border border-green-600 flex items-center justify-center rounded">
                                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-600" />
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                // Use restaurant info from existing cart items to ensure format consistency
                                const cartRestaurantId = cart[0]?.restaurantId || restaurantId;
                                const cartRestaurantName = cart[0]?.restaurant || restaurantName;

                                if (!cartRestaurantId || !cartRestaurantName) {
                                  debugError('? Cannot add addon: Missing restaurant information', {
                                    cartRestaurantId,
                                    cartRestaurantName,
                                    restaurantId,
                                    restaurantName,
                                    cartItem: cart[0]
                                  });
                                  toast.error('Restaurant information is missing. Please refresh the page.');
                                  return;
                                }

                                addToCart({
                                  id: addon.id,
                                  name: addon.name,
                                  price: addon.price,
                                  image: addon.image || (addon.images && addon.images[0]) || "",
                                  description: addon.description || "",
                                  isVeg: true,
                                  restaurant: cartRestaurantName,
                                  restaurantId: cartRestaurantId
                                });
                              }}
                              className="absolute bottom-1 md:bottom-2 right-1 md:right-2 w-6 h-6 md:w-7 md:h-7 bg-white border border-[#EB590E] rounded flex items-center justify-center shadow-sm hover:bg-primary-orange/5 dark:hover:bg-accent-orange/50/20 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5 md:h-4 md:w-4 text-[#EB590E]" />
                            </button>
                          </div>
                          <p className="text-xs md:text-sm font-medium text-gray-800 dark:text-gray-200 mt-1.5 md:mt-2 line-clamp-2 leading-tight">{addon.name}</p>
                          {addon.description && (
                            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{addon.description}</p>
                          )}
                          <p className="text-xs md:text-sm text-gray-800 dark:text-gray-200 font-semibold mt-0.5">{RUPEE_SYMBOL}{addon.price}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Coupon Section */}
              <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl overflow-hidden border border-slate-100 dark:border-gray-800 shadow-sm flex flex-col">
                {isPricingAvailable && deliveryFee === 0 && (
                  <div className="px-4 py-3 md:px-6 md:py-4 border-b border-dashed border-gray-200 dark:border-gray-800 flex items-center gap-3 bg-[#f4fcf7] dark:bg-green-900/10">
                    <CheckCircle2 className="h-5 w-5 text-green-600 fill-green-600/20" />
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Delivery fee waived</span>
                  </div>
                )}

                {/* Applied Coupon View */}
                {appliedCoupon ? (
                  <div className="px-4 py-3 md:px-6 md:py-4 flex items-center justify-between">
                    <div className="flex items-start gap-3">
                      <Percent className="h-5 w-5 text-[#EB590E] mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">'{appliedCoupon.code}' applied</p>
                        <p className="text-xs text-[#EB590E] font-medium mt-0.5">You saved {RUPEE_SYMBOL}{discount}</p>
                      </div>
                    </div>
                    <button onClick={handleRemoveCoupon} className="text-[#EB590E] text-xs font-semibold px-2 hover:underline">REMOVE</button>
                  </div>
                ) : (
                  /* Available / Input View */
                  <div className="px-4 py-3 md:px-6 md:py-4 flex flex-col gap-3">
                    {loadingCoupons ? (
                      <p className="text-sm text-gray-500">Loading offers...</p>
                    ) : availableCoupons.length > 0 ? (
                      <div className="flex items-start justify-between w-full">
                        <div className="flex items-start gap-3 flex-1">
                          <Percent className="h-5 w-5 text-gray-700 dark:text-gray-300 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-tight mb-0.5">
                              {availableCoupons[0].discountDisplay || `Save ${RUPEE_SYMBOL}${availableCoupons[0].discount}`} with '{availableCoupons[0].code}'
                            </p>
                            {availableCoupons[0].customerGroup === "new" ? (
                              <p className="text-[11px] text-[#EB590E] mb-1">First-time users only</p>
                            ) : subtotal < availableCoupons[0].minOrder ? (
                              <p className="text-xs text-blue-600 font-medium mb-1">Add items worth {RUPEE_SYMBOL}{(availableCoupons[0].minOrder - subtotal).toFixed(0)} more to unlock</p>
                            ) : null}

                            {availableCoupons.length > 1 && (
                              <button onClick={() => setShowCoupons(!showCoupons)} className="text-[11px] text-[#EB590E] hover:underline flex items-center mt-1">
                                View all coupons <ChevronRight className="h-3 w-3 ml-0.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <button
                          className="border border-[#EB590E] text-[#EB590E] dark:hover:bg-[#EB590E]/10 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed ml-2 shadow-sm"
                          onClick={() => handleApplyCoupon(availableCoupons[0])}
                          disabled={subtotal < availableCoupons[0].minOrder}
                        >
                          APPLY
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <Percent className="h-5 w-5 text-gray-400" />
                        <p className="text-sm text-gray-500">No offers available</p>
                      </div>
                    )}

                    {/* Show All Coupons List */}
                    {showCoupons && !appliedCoupon && availableCoupons.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-4">
                        {/* Input for manual code */}
                        <div className="flex flex-col sm:flex-row gap-2 mb-4">
                          <input
                            type="text"
                            value={manualCouponCode}
                            onChange={(e) => setManualCouponCode(e.target.value.toUpperCase())}
                            placeholder="Enter coupon code"
                            className="flex-1 h-9 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0a0a0a] px-3 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#EB590E]"
                          />
                          <button
                            className="bg-white dark:bg-[#1a1a1a] border border-[#EB590E] text-[#EB590E] rounded px-4 h-9 text-xs font-semibold uppercase hover:bg-primary-orange/5 dark:hover:bg-accent-orange/50/10"
                            onClick={handleApplyCouponCode}
                          >
                            APPLY
                          </button>
                        </div>
                        {availableCoupons.slice(1).map((coupon) => (
                          <div key={coupon.code} className="flex items-start justify-between">
                            <div className="flex items-start gap-3 flex-1">
                              <Percent className="h-5 w-5 text-gray-700 dark:text-gray-300 mt-0.5 opacity-50" />
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 leading-tight mb-0.5">
                                  {coupon.discountDisplay || `Save ${RUPEE_SYMBOL}${coupon.discount}`} with '{coupon.code}'
                                </p>
                                {coupon.customerGroup === "new" ? (
                                  <p className="text-[11px] text-[#EB590E] mb-1">First-time users only</p>
                                ) : subtotal < coupon.minOrder ? (
                                  <p className="text-xs text-blue-600 font-medium mb-1 line-clamp-1">Add items worth {RUPEE_SYMBOL}{(coupon.minOrder - subtotal).toFixed(0)} more to unlock</p>
                                ) : (
                                  <p className="text-xs text-gray-500 mb-1 line-clamp-1">{coupon.description}</p>
                                )}
                              </div>
                            </div>
                            <button
                              className="border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed ml-2"
                              onClick={() => handleApplyCoupon(coupon)}
                              disabled={subtotal < coupon.minOrder}
                            >
                              APPLY
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Delivery Time */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <div className="flex items-start gap-3 md:gap-4">
                  <div className="mt-0.5">
                    <Zap className="h-5 w-5 text-green-600 fill-green-600/20" />
                  </div>
                  <div className="flex-1">
                    <p className="text-base text-gray-800 dark:text-gray-200">
                      Delivery in <span className="text-green-600 font-bold">{restaurantData?.estimatedDeliveryTime || "15-20 mins"}</span>
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">
                      Want this later?
                      <button onClick={() => setIsScheduled(!isScheduled)} className="border-b border-dashed border-gray-500 font-medium outline-none">
                        Schedule it
                      </button>
                    </p>
                  </div>
                </div>

                {isScheduled && (
                  <div className="mt-5 flex flex-col sm:flex-row gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date (Up to Tomorrow)</label>
                      <input
                        type="date"
                        min={new Date().toLocaleDateString('en-CA')}
                        max={new Date(Date.now() + 86400000).toLocaleDateString('en-CA')}
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full text-sm p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#EB590E]"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Time</label>
                      {availableTimeSlots.length > 0 ? (
                        <div className="relative">
                          <select
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                            className="w-full text-sm p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#EB590E] appearance-none pr-8"
                          >
                            {availableTimeSlots.map(slot => (
                              <option key={slot.value} value={slot.value}>{slot.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                        </div>
                      ) : (
                        <div className="w-full text-sm p-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-md text-center border border-gray-200 dark:border-gray-700">
                          {scheduledDate ? "No slots available" : "Select date first"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery Address */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <div className="flex items-start justify-between w-full text-left">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="bg-primary-orange/5 dark:bg-accent-orange/50/20 p-2 rounded-xl mt-0.5">
                      <MapPin className="h-5 w-5 text-[#EB590E]" />
                    </div>
                    <div className="flex-1">
                        <div className="flex flex-col">
                          <p className="text-sm md:text-base text-gray-800 dark:text-gray-200">
                            Delivery at{" "}
                            <span className="font-semibold">
                              {deliveryAddressMode === "current" ? "Current location" : "Location"}
                            </span>
                          </p>
                          {deliveryAddressMode === "current" ? (
                            <div className="mt-1">
                              {currentLocationLoading || !currentLocationAddress ? (
                                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 animate-pulse">
                                  Finding your current address...
                                </p>
                              ) : (
                                <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                                  {formatFullAddress(currentLocationAddress) ||
                                    currentLocationAddress?.formattedAddress ||
                                    currentLocationAddress?.address ||
                                    "Add delivery address"}
                                </p>
                              )}
                              <div className="mt-1 flex items-center gap-2">
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] md:text-[11px] font-semibold bg-[#FFF2EB] text-[#EB590E] dark:bg-[#EB590E]/10 dark:text-[#EB590E] border border-[#EB590E]/30">
                                  GPS enabled
                                </span>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 pr-4">
                              {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Add delivery address") : "Add delivery address"}
                            </p>
                          )}
                        </div>
                        {!hasSavedAddress && (
                          <p className="text-sm text-[#EB590E] mt-2 font-medium">
                            Select a delivery location to continue
                          </p>
                        )}
                        {/* Address Selection Buttons */}
                        <div className="flex flex-wrap gap-2 mt-3">
                          {["Home", "Work", "Other"].map((label) => {
                            const normalizedLabel = normalizeAddressLabel(label)
                            const addressExists = addresses.some(addr => normalizeAddressLabel(addr.label) === normalizedLabel)
                            return (
                              <button
                                key={label}
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleSelectAddressByLabel(label)
                                }}
                                disabled={!addressExists}
                                className={`text-xs px-4 py-1.5 rounded-full font-semibold transition-all ${addressExists
                                  ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-gray-800 dark:text-gray-300'
                                  : 'bg-gray-50 text-gray-400 border border-gray-100 cursor-not-allowed dark:bg-gray-900'
                                  }`}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                        {addresses.length > 0 && (
                          <div className="mt-4 space-y-3">
                            {addresses.map((address) => {
                              const addressId = getAddressId(address)
                              const isSelected = addressId && addressId === selectedAddressId
                              return (
                                <button
                                  key={addressId || `${address.label}-${address.street}-${address.city}`}
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleSelectSavedAddress(address)
                                  }}
                                  className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${isSelected
                                    ? "border-[#EB590E] bg-primary-orange/5/50 dark:bg-[#EB590E]/5"
                                    : "border-slate-100 dark:border-gray-800 hover:border-slate-200"
                                    }`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                        {getDisplayAddressLabel(address.label)}
                                      </p>
                                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                                        {formatFullAddress(address) || address.address || "Address details"}
                                      </p>
                                    </div>
                                    {isSelected && (
                                      <span className="text-[10px] bg-[#EB590E] text-white px-2 py-0.5 rounded uppercase font-bold tracking-wider whitespace-nowrap">
                                        Selected
                                      </span>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openLocationSelector}
                    className="p-2 text-[#EB590E] bg-primary-orange/5 rounded-full hover:bg-primary-orange/10 transition-colors dark:bg-accent-orange/50/20 dark:hover:bg-accent-orange/50/40"
                    aria-label="Open location selector"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Contact */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 md:gap-4 flex-1 min-w-0">
                    <Phone className="h-4 w-4 md:h-5 md:w-5 text-gray-500 dark:text-gray-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base text-gray-800 dark:text-gray-200 font-medium">
                        {recipientName}, <span className="font-semibold">{recipientPhone || "+91-XXXXXXXXXX"}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Order recipient details
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingRecipient((prev) => !prev)}
                    className="text-[#EB590E] text-xs md:text-sm font-semibold whitespace-nowrap"
                  >
                    {isEditingRecipient ? "Done" : "Change"}
                  </button>
                </div>

                {isEditingRecipient && (
                  <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={recipientDetails.name}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Enter recipient name"
                        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#EB590E]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={recipientDetails.phone}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            phone: sanitizeRecipientPhone(e.target.value),
                          }))
                        }
                        placeholder="Enter recipient phone"
                        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#EB590E]"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Agar aap kisi aur ke liye order kar rahe ho, to yahan uska naam aur phone save kar do.
                    </p>
                  </div>
                )}
              </div>
              {/* "Add 1 more and get it free" -- the whole point of running the
                  offer. Placed above the recap below because what a customer can
                  still get is worth more to them than what they already have. */}
              {bogoNext.length > 0 && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 md:px-6 py-4">
                  <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                    You are one step from a free dish
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {bogoNext.map((step, index) => (
                      <li
                        key={`bogo-next-${step.itemId}-${step.variantName || ''}-${index}`}
                        className="text-xs text-emerald-900/80 dark:text-emerald-200/80"
                      >
                        Add {step.unitsAway} more {step.name}
                        {step.variantName ? ` (${step.variantName})` : ''} and get{' '}
                        {step.freeQuantity} free
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Buy-one-get-one already applied to this cart. Named per line
                  rather than as one total, because "1 free" against a dish is the
                  bit a customer checks; the rupee figure alone reads as a coupon
                  they have to go and find. */}
              {bogoLines.length > 0 && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 md:px-6 py-4">
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    Buy one get one applied &mdash; you saved {RUPEE_SYMBOL}{bogoSavings.toFixed(2)}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {bogoLines.map((line, index) => (
                      <li
                        key={`${line.itemId}-${line.variantName || ''}-${index}`}
                        className="text-xs text-gray-600 dark:text-gray-400"
                      >
                        {line.freeQuantity} x {line.name}
                        {line.variantName ? ` (${line.variantName})` : ''} free
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Spend-threshold reward. Two states, never both: something already
                  earned, or how much more would earn the next one. The amounts come
                  from the server's own resolution, so the number shown here is the
                  number the order will apply. */}
              {(freebieEarned || freebieNext) && (
                <div className="rounded-2xl border border-[#EB590E]/20 bg-[#EB590E]/5 px-4 md:px-6 py-4">
                  {freebieEarned ? (
                    <p className="text-sm font-semibold text-[#EB590E]">
                      {freebieEarned.name
                        ? `${freebieEarned.name} is free on this order`
                        : "You have earned a free item on this order"}
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      Add {RUPEE_SYMBOL}{Number(freebieNext.amountAway || 0).toFixed(2)} more
                      {freebieNext.name ? ` to get ${freebieNext.name} free` : " to earn a free item"}
                    </p>
                  )}
                  {freebieEarned && freebieNext && (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      Add {RUPEE_SYMBOL}{Number(freebieNext.amountAway || 0).toFixed(2)} more
                      {freebieNext.name ? ` for ${freebieNext.name} instead` : " for a better reward"}
                    </p>
                  )}
                </div>
              )}

{/* Loyalty points */}
              {loyaltySummary?.enabled && Number(loyaltySummary?.balance) > 0 && (
                <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div className="flex items-center gap-3">
                      <Sparkles className="h-5 w-5 text-[#EB590E]" />
                      <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                          Use loyalty points
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {useLoyaltyPoints && billLoyaltyPoints > 0
                            ? `${billLoyaltyPoints} of ${loyaltySummary.balance} points used: -${RUPEE_SYMBOL}${billLoyaltyDiscount.toFixed(2)}`
                            : `Balance ${loyaltySummary.balance} points (worth ${RUPEE_SYMBOL}${Number(loyaltySummary.worth || 0).toFixed(2)})`}
                          {useLoyaltyPoints && pricing && billLoyaltyPoints < Number(loyaltySummary.balance) && Number(loyaltySummary?.rules?.maxRedeemPercent) > 0
                            ? ` · up to ${loyaltySummary.rules.maxRedeemPercent}% of the food`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#EB590E]"
                      checked={useLoyaltyPoints}
                      onChange={(e) => setUseLoyaltyPoints(e.target.checked)}
                    />
                  </label>
                </div>
              )}

{/* Bill Details */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <button
                  onClick={() => setShowBillDetails(!showBillDetails)}
                  className="flex items-center justify-between w-full"
                >
                  <div className="flex items-center gap-3 md:gap-4">
                    <FileText className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    <div className="text-left">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-base text-gray-800 dark:text-gray-200 font-semibold tracking-wide">Total Bill</span>
                        {savings > 0 ? (
                          <>
                            <span className="text-base text-gray-400 dark:text-gray-500 line-through font-medium">{RUPEE_SYMBOL}{totalBeforeDiscount.toFixed(2)}</span>
                            <span className="text-base font-bold text-gray-900 dark:text-white">{RUPEE_SYMBOL}{total.toFixed(2)}</span>
                            <span className="text-[11px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-center ml-1 font-semibold border border-blue-200 dark:border-blue-800">
                              You saved {RUPEE_SYMBOL}{savings.toFixed(0)}
                            </span>
                          </>
                        ) : (
                          <span className="text-base font-bold text-gray-900 dark:text-white">{RUPEE_SYMBOL}{total.toFixed(2)}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Incl. taxes and charges</p>
                    </div>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${showBillDetails ? 'rotate-90' : ''}`} />
                </button>

                {showBillDetails && (
                  <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-3">
                    {bogoLines.map((line, index) => (
                      <div
                        key={`bogo-${line.itemId}-${line.variantName || ''}-${index}`}
                        className="flex justify-between text-sm"
                      >
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          Free ({line.freeQuantity} x buy one get one): {line.name}
                          {line.variantName ? ` (${line.variantName})` : ''}
                        </span>
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">
                          {RUPEE_SYMBOL}0.00
                        </span>
                      </div>
                    ))}
                    {freebieEarned && (
                      <div className="flex justify-between text-sm">
                        <span className="text-[#EB590E] font-medium">
                          Free: {freebieEarned.name || "Reward"}
                        </span>
                        <span className="text-[#EB590E] font-medium">{RUPEE_SYMBOL}0.00</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Item Total</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billItemAmountShown.toFixed(2)}</span>
                    </div>
                    {billPackagingFeeShown > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Packaging Charges</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billPackagingFeeShown.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Delivery Fee</span>
                      <span className={isPricingAvailable && deliveryFeeShown === 0 ? "text-[#EB590E] font-medium" : "text-gray-800 dark:text-gray-200 font-medium"}>
                        {isPricingAvailable ? (deliveryFeeShown === 0 ? "FREE" : `${RUPEE_SYMBOL}${deliveryFeeShown.toFixed(2)}`) : ""}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        Platform Fee
                        {billPlatformFeeGst > 0 && billPlatformFeeGstRate > 0
                          ? ` (incl. ${billPlatformFeeGstRate}% GST)`
                          : ""}
                      </span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{isPricingAvailable ? `${RUPEE_SYMBOL}${billPlatformFeeShown.toFixed(2)}` : "-"}</span>
                    </div>
                    {false && surgeAmount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Surge Amount</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{surgeAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">
                        GST{billGstRate > 0 ? ` @ ${billGstRate}%` : ""}
                        {gstIsIncludedInItems ? " (included above)" : ""}
                        {/* Food and packaging are one supply and carry the same
                            rate, so the tax is charged on both. Unsaid, a bill
                            with a packaging charge reads as an overcharge to
                            anyone checking the rate against the item total. */}
                        {!gstIsIncludedInItems && billPackagingFeeShown > 0
                          ? " on food + packaging"
                          : ""}
                      </span>
                      {/*
                        Already inside Item Total for an inclusive menu, so it is
                        shown for transparency and must not read as another
                        charge -- otherwise the visible lines add up to more
                        than the amount being paid.
                      */}
                      <span className={gstIsIncludedInItems
                        ? "text-gray-400 dark:text-gray-500 font-medium"
                        : "text-gray-800 dark:text-gray-200 font-medium"}>
                        {isPricingAvailable ? `${RUPEE_SYMBOL}${billGst.toFixed(2)}` : "-"}
                      </span>
                    </div>
                    {billDiscountShown > 0 && (
                      <div className="flex justify-between text-sm text-[#EB590E] font-medium">
                        <span>Coupon Discount</span>
                        <span>-{RUPEE_SYMBOL}{billDiscountShown.toFixed(2)}</span>
                      </div>
                    )}
                    {billTip > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Tip for delivery partner</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">{RUPEE_SYMBOL}{billTip.toFixed(2)}</span>
                      </div>
                    )}
                    {billLoyaltyDiscount > 0 && (
                      <div className="flex justify-between text-sm text-[#EB590E] font-medium">
                        <span>Loyalty points ({billLoyaltyPoints})</span>
                        <span>-{RUPEE_SYMBOL}{billLoyaltyDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {Math.abs(billRoundOff) >= 0.01 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Round Off</span>
                        <span className="text-gray-800 dark:text-gray-200 font-medium">
                          {billRoundOff < 0 ? "-" : "+"}{RUPEE_SYMBOL}{Math.abs(billRoundOff).toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold pt-3 mt-1 border-t border-gray-100 dark:border-gray-800 text-gray-900 dark:text-white">
                      <span>To Pay</span>
                      <span>{RUPEE_SYMBOL}{total.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky - Place Order */}
      <div
        className="bg-white dark:bg-[#1a1a1a] border-t dark:border-gray-800 shadow-lg z-30 flex-shrink-0 fixed bottom-0 left-0 right-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4">
          <div className="w-full max-w-lg mx-auto space-y-3">
            {/* Pay Using - Slim Pro UI */}
            <div
              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-[#222222] rounded-xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#282828] active:scale-[0.98] transition-all duration-200 shadow-sm"
              onClick={() => setShowPaymentSheet(true)}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary-orange/10/80 dark:bg-accent-orange/50/40 flex items-center justify-center flex-shrink-0">
                  {selectedPaymentMethod === "wallet" ? (
                    <Wallet className="h-5 w-5 text-[#EB590E]" />
                  ) : selectedPaymentMethod === "razorpay" ? (
                    <Zap className="h-5 w-5 text-[#EB590E]" />
                  ) : (
                    <Banknote className="h-5 w-5 text-[#EB590E]" />
                  )}
                </div>
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold opacity-80">
                    PAYING WITH
                  </p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      {selectedPaymentLabel}
                    </p>
                    {selectedPaymentMethod === "wallet" && (
                      <p className="text-[10px] text-green-600 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/20 px-1 rounded">
                        {RUPEE_SYMBOL}{walletBalance.toFixed(0)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-0.5 text-[#EB590E] font-bold text-[11px] uppercase tracking-widest bg-primary-orange/5 dark:bg-accent-orange/50/20 px-2.5 py-1 rounded-lg">
                CHANGE <ChevronRight className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* Place Order Button */}
            <button
              onClick={handlePlaceOrder}
              disabled={isPlacingOrder || loadingPricing || (hasSavedAddress && !isPricingAvailable) || (selectedPaymentMethod === "wallet" && walletBalance < total)}
              className="w-full bg-gradient-to-r from-[#EB590E] to-[#E23744] hover:from-[#D94F0C] hover:to-[#CF2834] text-white px-6 h-12 md:h-14 rounded-2xl font-bold shadow-lg shadow-[#EB590E]/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between transition-transform active:scale-[0.98]"
            >
              {(selectedPaymentMethod === "razorpay" || selectedPaymentMethod === "wallet" || selectedPaymentMethod === "cash") && (
                <div className="text-left flex flex-col justify-center border-r-[1.5px] border-white/20 pr-4">
                  <span className="text-xs md:text-sm font-semibold text-white/90">{RUPEE_SYMBOL}{total.toFixed(2)}</span>
                  <span className="text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-white/80 mt-[-2px]">Total</span>
                </div>
              )}
              <div className="flex items-center gap-1 mx-auto text-sm md:text-lg tracking-wide">
                {isPlacingOrder
                  ? "Processing..."
                  : loadingPricing
                    ? "Calculating Fees..."
                    : !hasSavedAddress
                      ? "Select Address"
                    : !isPricingAvailable
                      ? "Fees Unavailable"
                    : "Place Order"}
                <div className="flex align-center h-full">
                  <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

          {/* Placing Order Modal */}
          {showPlacingOrder && (
            <div className="fixed inset-0 z-[60] h-screen w-screen overflow-hidden">
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

              {/* Modal Sheet */}
              <div
                className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl overflow-hidden"
                style={{ animation: 'slideUpModal 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}
              >
                <div className="px-6 py-8">
                  {/* Title */}
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Placing your order</h2>

                  {/* Payment Info */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-white shadow-sm">
                      <CreditCard className="w-6 h-6 text-gray-600" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedPaymentMethod === "razorpay"
                          ? `Pay ${RUPEE_SYMBOL}${total.toFixed(2)} online (Razorpay)`
                          : selectedPaymentMethod === "wallet"
                            ? `Pay ${RUPEE_SYMBOL}${total.toFixed(2)} from Wallet`
                            : `Pay on delivery (COD)`}
                      </p>
                    </div>
                  </div>

                  {/* Delivery Address */}
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-gray-50">
                      <svg className="w-7 h-7 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path d="M9 22V12h6v10" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">Delivering to Location</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Address") : "Add address"}
                      </p>
                      <p className="text-sm text-gray-500">
                        {defaultAddress ? (formatFullAddress(defaultAddress) || "Address") : "Address"}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative mb-6">
                    <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#EB590E] to-[#D94F0C] rounded-full transition-all duration-100 ease-linear"
                        style={{
                          width: `${orderProgress}%`,
                          boxShadow: '0 0 10px rgba(235, 89, 14, 0.5)'
                        }}
                      />
                    </div>
                    {/* Animated shimmer effect */}
                    <div
                      className="absolute inset-0 h-2.5 rounded-full overflow-hidden pointer-events-none"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                        animation: 'shimmer 1.5s infinite',
                        width: `${orderProgress}%`
                      }}
                    />
                  </div>

                  {/* Cancel Button */}
                  <button
                    onClick={() => {
                      setShowPlacingOrder(false)
                      setIsPlacingOrder(false)
                    }}
                    className="w-full text-right"
                  >
                    <span className="text-[#EB590E] font-semibold text-base hover:text-[#D94F0C] transition-colors">
                      CANCEL
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Order Success Celebration Page */}
          {showOrderSuccess && (
            <div
              className="fixed inset-0 z-[70] bg-white dark:bg-[#0a0a0a] flex flex-col items-center justify-center h-screen w-screen overflow-hidden"
              style={{ animation: 'fadeIn 0.3s ease-out' }}
            >
              {/* Confetti Background */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {/* Animated confetti pieces */}
                {[...Array(50)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-3 h-3 rounded-sm"
                    style={{
                      left: `${Math.random() * 100}%`,
                      top: `-10%`,
                      backgroundColor: ['#EB590E', '#3b82f6', '#f59e0b', '#ef4444', '#D94F0C', '#ec4899'][Math.floor(Math.random() * 6)],
                      animation: `confettiFall ${2 + Math.random() * 2}s linear ${Math.random() * 2}s infinite`,
                      transform: `rotate(${Math.random() * 360}deg)`,
                    }}
                  />
                ))}
              </div>

              {/* Success Content */}
              <div className="relative z-10 flex flex-col items-center px-6">
                {/* Success Tick Circle */}
                <div
                  className="relative mb-8"
                  style={{ animation: 'scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}
                >
                  {/* Outer ring animation */}
                  <div
                    className="absolute inset-0 w-32 h-32 rounded-full border-4 border-green-500 dark:border-green-400"
                    style={{
                      animation: 'ringPulse 1.5s ease-out infinite',
                      opacity: 0.3
                    }}
                  />
                  {/* Main circle */}
                  <div className="w-32 h-32 bg-gradient-to-br from-green-500 to-green-600 dark:from-green-500 dark:to-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-200/60 dark:shadow-green-900/40">
                    <svg
                      className="w-16 h-16 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ animation: 'checkDraw 0.5s ease-out 0.5s both' }}
                    >
                      <path d="M5 12l5 5L19 7" className="check-path" />
                    </svg>
                  </div>
                  {/* Sparkles */}
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-2 h-2 bg-yellow-400 dark:bg-yellow-300 rounded-full"
                      style={{
                        top: '50%',
                        left: '50%',
                        animation: `sparkle 0.6s ease-out ${0.3 + i * 0.1}s both`,
                        transform: `rotate(${i * 60}deg) translateY(-80px)`,
                      }}
                    />
                  ))}
                </div>

                {/* Location Info */}
                <div
                  className="text-center"
                  style={{ animation: 'slideUp 0.5s ease-out 0.6s both' }}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="w-5 h-5 text-red-500 dark:text-red-400">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {defaultAddress
                        ? (
                            defaultAddress?.street ||
                            defaultAddress?.additionalDetails ||
                            String(defaultAddress?.formattedAddress || "").split(",")[0]?.trim() ||
                            String(defaultAddress?.address || "").split(",")[0]?.trim() ||
                            defaultAddress?.city
                          )
                        : "Your Location"}
                    </h2>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-base">
                    {defaultAddress
                      ? (
                          formatFullAddress(defaultAddress) ||
                          defaultAddress?.formattedAddress ||
                          defaultAddress?.address ||
                          [defaultAddress?.city, defaultAddress?.state].filter(Boolean).join(", ") ||
                          "Delivery Address"
                        )
                      : "Delivery Address"}
                  </p>
                </div>

                {/* Order Placed Message */}
                <div
                  className="mt-12 text-center"
                  style={{ animation: 'slideUp 0.5s ease-out 0.8s both' }}
                >
                  <h3 className="text-3xl font-bold text-[#EB590E] dark:text-primary-orange/80 mb-2">Order Placed!</h3>
                  <p className="text-gray-600 dark:text-gray-300">Your delicious food is on its way</p>
                </div>

                {/* Action Button */}
                <button
                  onClick={handleGoToOrders}
                  className="mt-10 bg-[#EB590E] hover:bg-[#D94F0C] text-white font-semibold py-4 px-12 rounded-xl shadow-lg shadow-primary-orange/20/70 dark:shadow-accent-orange/30/40 transition-all hover:shadow-xl hover:scale-105"
                  style={{ animation: 'slideUp 0.5s ease-out 1s both' }}
                >
                  Track Your Order
                </button>
              </div>
            </div>
          )}

          {/* Payment Selection Bottom Sheet */}
          <AnimatePresence>
            {showPaymentSheet && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowPaymentSheet(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 350 }}
                  className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-[2rem] z-[101] shadow-2xl overflow-hidden max-h-[82vh] md:max-h-[60vh] flex flex-col"
                  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                  <div className="p-5 md:p-6 flex flex-col h-full min-h-0">
                    {/* Compact Drag handle */}
                    <div className="w-10 h-1 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto mb-5" />

                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white leading-none">Payment Method</h2>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Select how you want to pay</p>
                      </div>
                      <button
                        onClick={() => setShowPaymentSheet(false)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>

                    <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar pb-4 flex-1 min-h-0">
                      {[
                        {
                          id: 'razorpay',
                          name: 'Online Payment',
                          description: 'UPI, Cards, Netbanking',
                          icon: <Zap className="w-5 h-5" />,
                          color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
                          selectedColor: 'bg-emerald-500 text-white',
                          badge: 'SECURE'
                        },
                        {
                          id: 'wallet',
                          name: 'Quick Wallet',
                          description: 'Pay from your wallet',
                          icon: <Wallet className="w-5 h-5" />,
                          color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
                          selectedColor: 'bg-blue-500 text-white',
                          subInfo: `Bal: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`,
                          disabled: walletBalance < total,
                          disabledText: 'Low Balance'
                        },
                        {
                          id: 'cash',
                          name: 'Cash on Delivery',
                          description: 'Pay when order arrives',
                          icon: <Banknote className="w-5 h-5" />,
                          color: 'bg-primary-orange/5 text-accent-orange dark:bg-accent-orange/50/40 dark:text-primary-orange/80',
                          selectedColor: 'bg-primary-orange/50 text-white',
                          hidden: !showCodOption
                        }
                      ].filter(opt => !opt.hidden).map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            if (!option.disabled) {
                              setSelectedPaymentMethod(option.id)
                              setShowPaymentSheet(false)
                            }
                          }}
                          className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-300 group ${selectedPaymentMethod === option.id
                              ? 'border-[#EB590E] bg-[#EB590E] shadow-lg shadow-primary-orange/50/30'
                              : 'border-gray-100 dark:border-gray-800/80 bg-white dark:bg-[#222222] hover:border-primary-orange/20 dark:hover:border-accent-orange/50/30 shadow-sm'
                            } ${option.disabled ? 'opacity-40 grayscale-[0.8] cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                                ? 'bg-white/20 text-white'
                                : option.color
                              }`}>
                              {option.icon}
                            </div>
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-black tracking-tight leading-none transition-colors ${selectedPaymentMethod === option.id ? 'text-white' : 'text-gray-900 dark:text-gray-100'
                                  }`}>
                                  {option.name}
                                </span>
                                {option.badge && (
                                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shadow-sm tracking-wider ${selectedPaymentMethod === option.id
                                      ? 'bg-white/20 text-white'
                                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    }`}>
                                    {option.badge}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <p className={`text-[11px] font-bold transition-colors ${selectedPaymentMethod === option.id ? 'text-white/80' : 'text-gray-400'
                                  }`}>
                                  {option.description}
                                </p>
                                {option.subInfo && !option.disabled && (
                                  <>
                                    <span className={`w-1 h-1 rounded-full ${selectedPaymentMethod === option.id ? 'bg-white/40' : 'bg-primary-orange/40 dark:bg-accent-orange/90'
                                      }`} />
                                    <p className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${selectedPaymentMethod === option.id ? 'text-white' : 'text-green-600 dark:text-green-500'
                                      }`}>
                                      {option.subInfo}
                                    </p>
                                  </>
                                )}
                              </div>
                              {option.disabled && (
                                <p className="text-[9px] font-black text-red-500 mt-1 uppercase tracking-wide">
                                  {option.disabledText}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                              ? 'bg-white border-white'
                              : 'border-gray-200 dark:border-gray-700'
                            }`}>
                            {selectedPaymentMethod === option.id && <Check className="w-3.5 h-3.5 text-[#EB590E]" strokeWidth={4} />}
                          </div>
                        </button>
                      ))}
                    </div>

                    <div
                      className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 bg-white dark:bg-[#1a1a1a]"
                      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
                    >
                      <div className="flex-shrink-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Pay</p>
                        <p className="text-xl font-black text-[#EB590E] tabular-nums">{RUPEE_SYMBOL}{total.toFixed(0)}</p>
                      </div>
                      <Button
                        onClick={() => setShowPaymentSheet(false)}
                        className="flex-1 bg-[#EB590E] hover:bg-[#D94F0C] text-white h-11 rounded-xl text-sm font-bold shadow-lg shadow-primary-orange/50/20 transition-all active:scale-[0.98]"
                      >
                        Confirm Order
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Animation Styles */}
          <style>{`
        @keyframes fadeInBackdrop {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUpBannerSmooth {
          from { transform: translateY(100%) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes slideUpBanner {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmerBanner {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes scaleInBounce {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes checkMarkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0; }
          50% { opacity: 1; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes slideUpFull {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes slideUpModal {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes checkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; }
        }
        @keyframes ringPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.3); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes sparkle {
          0% { transform: rotate(var(--rotation, 0deg)) translateY(0) scale(0); opacity: 1; }
          100% { transform: rotate(var(--rotation, 0deg)) translateY(-80px) scale(1); opacity: 0; }
        }
        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes confettiFall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        .animate-slideUpFull {
          animation: slideUpFull 0.3s ease-out;
        }
        .check-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 0;
        }
      `}</style>

      {/* Share Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showShareModal && sharePayload && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowShareModal(false)}
                />
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[92vw] max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Share</h3>
                    <button
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setShowShareModal(false)}
                      aria-label="Close share modal"
                    >
                      <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  <div className="px-5 py-4 space-y-2">
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                        onClick={handleSystemShareFromModal}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Share via system apps</span>
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("whatsapp")}
                    >
                      <MessageCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("telegram")}
                    >
                      <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Telegram</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("email")}
                    >
                      <Mail className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Email</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={copyShareLink}
                    >
                      <Copy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Copy link</span>
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  )
}      

