import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams, useLocation } from "react-router-dom"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { Label } from "@food/components/ui/label"
import { Image as ImageIcon, Upload, Clock, Calendar as CalendarIcon, Sparkles, X, LogOut, AlertCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@food/components/ui/popover"
import { Calendar } from "@food/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { restaurantAPI, zoneAPI, uploadAPI, api } from "@food/api"
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns"
import { determineStepToShow } from "@food/utils/onboardingUtils"
import { toast } from "sonner"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { clearModuleAuth, clearAuthData } from "@food/utils/auth"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { handlePhoneInput, formatDisplayPhone, extractRawPhone } from "../../../../utils/phone.util"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const FSSAI_NUMBER_REGEX = /^\d{14}$/
const GST_NUMBER_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
const GST_LEGAL_NAME_REGEX = /^[a-zA-Z\s]*$/
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/
const IFSC_CODE_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_HOLDER_NAME_REGEX = /^[a-zA-Z\s]*$/
const PAN_NUMBER_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
const OWNER_NAME_REGEX = /^[a-zA-Z\s]*$/


const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ONBOARDING_STORAGE_KEY = "restaurant_onboarding_data"
const LOCAL_IMAGE_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif"
const GALLERY_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
let onboardingFileCache = {
  step2: {
    menuImages: [],
    profileImage: null,
  },
  step3: {
    panImage: null,
    gstImage: null,
    fssaiImage: null,
  },
}

// IndexedDB helpers for persistent file storage
const ONBOARDING_FILES_DB = "RestaurantOnboardingFiles"
const FILES_STORE = "files"

const openOnboardingFilesDB = () => {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(ONBOARDING_FILES_DB, 1)
      request.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE)
        }
      }
      request.onsuccess = (e) => resolve(e.target.result)
      request.onerror = (e) => reject(e.target.error)
    } catch (err) {
      reject(err)
    }
  })
}

const saveFileToDB = async (key, file) => {
  if (!file || !isUploadableFile(file)) return
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).put(file, key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB save failed:", err)
  }
}

const getFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readonly")
    const request = tx.objectStore(FILES_STORE).get(key)
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  } catch (err) {
    debugError("IndexedDB load failed:", err)
    return null
  }
}

const deleteFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).delete(key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB delete transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB delete failed:", err)
  }
}

const clearAllFilesFromDB = async () => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).clear()
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB clear transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB clear transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB clear failed:", err)
  }
}

const getUploadableMenuFiles = (menuImages = []) =>
  (Array.isArray(menuImages) ? menuImages : [])
    .filter((img) => isUploadableFile(img))
    .slice(0, 10)

const persistMenuImagesToDB = async (menuImages = []) => {
  const uploadableMenuFiles = getUploadableMenuFiles(menuImages)
  for (let i = 0; i < 10; i++) {
    const file = uploadableMenuFiles[i]
    if (file) {
      await saveFileToDB(`menuImage_${i}`, file)
    } else {
      await deleteFileFromDB(`menuImage_${i}`)
    }
  }
}

const isUploadableFile = (value) => {
  if (!value || typeof value !== "object") return false

  if (typeof File !== "undefined" && value instanceof File) return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true

  return (
    typeof value.size === "number" &&
    (typeof value.slice === "function" || typeof value.arrayBuffer === "function")
  )
}

const normalizePhoneDigits = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.slice(-10);
}

const handleRawPhoneInput = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 11 && digits.startsWith("91")) {
    return digits.slice(-10);
  }
  return digits.slice(0, 10);
}

const getVerifiedPhoneFromStoredRestaurant = () => {
  try {
    const pending = localStorage.getItem("restaurant_pendingPhone")
    if (pending && pending.trim()) {
      return normalizePhoneDigits(pending.trim())
    }

    const storedUser = localStorage.getItem("restaurant_user")
    if (!storedUser) return ""
    const user = JSON.parse(storedUser)
    const candidates = [
      user?.ownerPhone,
      user?.primaryContactNumber,
      user?.phone,
      user?.phoneNumber,
      user?.mobile,
      user?.contactNumber,
      user?.contact?.phone,
      user?.owner?.phone,
      user?.restaurant?.phone,
    ]
    const phone = candidates.find((value) => typeof value === "string" && value.trim())
    return phone ? normalizePhoneDigits(phone.trim()) : ""
  } catch {
    return ""
  }
}

const normalizeAccountTypeValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "saving" || normalized === "savings") return "Saving"
  if (normalized === "current") return "Current"
  return ""
}

const getTodayLocalYMD = () => formatDateToLocalYMD(new Date())

// Helper functions for localStorage
const saveOnboardingToLocalStorage = (step1, step2, step3, currentStep) => {
  try {
    // Persist only stable URL-based values. File/Blob objects are not serializable and
    // restoring metadata-only placeholders breaks preview/upload flows.
    const serializableStep2 = {
      ...step2,
      menuImages: (step2.menuImages || []).filter(
        (img) => !isUploadableFile(img) && (img?.url || (typeof img === "string" && img.trim()))
      ),
      profileImage:
        !isUploadableFile(step2.profileImage) &&
        (step2.profileImage?.url || (typeof step2.profileImage === "string" && step2.profileImage.trim()))
          ? step2.profileImage
          : null,
    }

    const serializableStep3 = {
      ...step3,
      panImage:
        !isUploadableFile(step3.panImage) &&
        (step3.panImage?.url || (typeof step3.panImage === "string" && step3.panImage.trim()))
          ? step3.panImage
          : null,
      gstImage:
        !isUploadableFile(step3.gstImage) &&
        (step3.gstImage?.url || (typeof step3.gstImage === "string" && step3.gstImage.trim()))
          ? step3.gstImage
          : null,
      fssaiImage:
        !isUploadableFile(step3.fssaiImage) &&
        (step3.fssaiImage?.url || (typeof step3.fssaiImage === "string" && step3.fssaiImage.trim()))
          ? step3.fssaiImage
          : null,
    }

    const dataToSave = {
      step1: {
        ...step1,
        ownerPhone: extractRawPhone(step1.ownerPhone),
        primaryContactNumber: extractRawPhone(step1.primaryContactNumber)
      },
      step2: serializableStep2,
      step3: serializableStep3,
      currentStep,
      timestamp: Date.now(),
    }
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(dataToSave))
  } catch (error) {
    debugError("Failed to save onboarding data to localStorage:", error)
  }
}

const loadOnboardingFromLocalStorage = () => {
  try {
    const stored = localStorage.getItem(ONBOARDING_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    debugError("Failed to load onboarding data from localStorage:", error)
  }
  return null
}

const clearOnboardingFromLocalStorage = () => {
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  } catch (error) {
    debugError("Failed to clear onboarding data from localStorage:", error)
  }
}

const syncOnboardingFileCache = (step2, step3) => {
  onboardingFileCache = {
    step2: {
      menuImages: (step2?.menuImages || []).filter((img) => isUploadableFile(img)),
      profileImage: isUploadableFile(step2?.profileImage) ? step2.profileImage : null,
    },
    step3: {
      panImage: isUploadableFile(step3?.panImage) ? step3.panImage : null,
      gstImage: isUploadableFile(step3?.gstImage) ? step3.gstImage : null,
      fssaiImage: isUploadableFile(step3?.fssaiImage) ? step3.fssaiImage : null,
    },
  }
}

const clearOnboardingFileCache = () => {
  onboardingFileCache = {
    step2: {
      menuImages: [],
      profileImage: null,
    },
    step3: {
      panImage: null,
      gstImage: null,
      fssaiImage: null,
    },
  }
}

// Helper function to convert "HH:mm" string to Date object
const stringToTime = (timeString) => {
  const normalized = normalizeTimeValue(timeString)
  if (!normalized || !normalized.includes(":")) {
    return null
  }
  const [hours, minutes] = normalized.split(":").map(Number)
  return new Date(2000, 0, 1, hours || 0, minutes || 0)
}

// Helper function to convert Date object to "HH:mm" string
const timeToString = (date) => {
  if (!date) return ""
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

const normalizeTimeValue = (value) => {
  if (!value) return ""

  const raw = String(value).trim()
  if (!raw) return ""

  const to24Hour = (h, m, period) => {
    let hours = Number(h)
    const minutes = Number(m)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ""
    if (minutes < 0 || minutes > 59) return ""
    const p = String(period || "").toUpperCase()
    if (p === "AM") {
      if (hours === 12) hours = 0
    } else if (p === "PM") {
      if (hours !== 12) hours += 12
    }
    if (hours < 0 || hours > 23) return ""
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }

  // Already in HH:mm format
  if (/^\d{2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":").map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return ""
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  // Handle H:mm by zero-padding hour
  if (/^\d{1}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":")
    return to24Hour(h, m, "")
  }

  // Handle 12-hour format (e.g. "10:00 AM", "9:30pm")
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    return to24Hour(ampm[1], ampm[2], ampm[3])
  }

  // Fallback for ISO / Date-like strings
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return timeToString(parsed)
  }

  return ""
}

const timeStringToMinutes = (value) => {
  const normalized = normalizeTimeValue(value)
  if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) return null
  const [hours, minutes] = normalized.split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const formatTime12Hour = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":")) return "--:-- --"
  const [h, m] = timeStr.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, "0")} ${period}`
}

const formatDateToLocalYMD = (date) => {
  if (!date || Number.isNaN(date.getTime?.())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const parseLocalYMDDate = (value) => {
  if (!value || typeof value !== "string") return undefined
  const parts = value.split("-").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined
  const [year, month, day] = parts
  return new Date(year, month - 1, day)
}

function TimeSelector({ label, value, onChange }) {
  const timeValue = stringToTime(value)

  const handleTimeChange = (newValue) => {
    if (!newValue) {
      onChange("")
      return
    }
    const timeString = timeToString(newValue)
    onChange(timeString)
  }

  return (
    <div className="border border-gray-200 rounded-md px-3 py-2 bg-gray-50/60">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-gray-800" />
        <span className="text-xs font-medium text-gray-900">{label}</span>
      </div>
      <MobileTimePicker ampm={true}
        value={timeValue}
        onChange={handleTimeChange}
        onAccept={handleTimeChange}
        slotProps={{
          textField: {
            variant: "outlined",
            size: "small",
            placeholder: "Select time",
            sx: {
              "& .MuiOutlinedInput-root": {
                height: "36px",
                fontSize: "12px",
                backgroundColor: "white",
                "& fieldset": {
                  borderColor: "#e5e7eb",
                },
                "&:hover fieldset": {
                  borderColor: "#d1d5db",
                },
                "&.Mui-focused fieldset": {
                  borderColor: "#000",
                },
              },
              "& .MuiInputBase-input": {
                padding: "8px 12px",
                fontSize: "12px",
              },
            },
            onBlur: (event) => {
              const normalized = normalizeTimeValue(event?.target?.value)
              if (normalized) {
                onChange(normalized)
              }
            },
          },
        }}
        format="hh:mm a"
      />
    </div>
  )
}

/**
 * Pull the fields we store out of a Google place or geocoder result.
 *
 * Both shapes are handled by the same function on purpose: an Autocomplete
 * prediction and a reverse-geocode result carry the same address_components and
 * the same LatLng, so pinning on the map and picking a suggestion fill the form
 * identically. Keeping two parsers would have let the two entry points drift.
 */
const parseGooglePlace = (place) => {
  const comps = Array.isArray(place?.address_components) ? place.address_components : []
  const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""

  const lat = typeof place?.geometry?.location?.lat === "function"
    ? place.geometry.location.lat()
    : place?.geometry?.location?.lat
  const lng = typeof place?.geometry?.location?.lng === "function"
    ? place.geometry.location.lng()
    : place?.geometry?.location?.lng

  return {
    formattedAddress: place?.formatted_address || "",
    area: get(["sublocality_level_1", "sublocality", "neighborhood"]) || get(["locality"]),
    city: get(["locality"]) || get(["administrative_area_level_2"]),
    state: get(["administrative_area_level_1"]) || get(["administrative_area_level_2"]),
    pincode: get(["postal_code"]),
    latitude: Number.isFinite(Number(lat)) ? Number(Number(lat).toFixed(6)) : "",
    longitude: Number.isFinite(Number(lng)) ? Number(Number(lng).toFixed(6)) : "",
  }
}

// Where the map opens when the restaurant has not picked anything yet. Roughly
// the centre of India, zoomed out far enough that the pin is obviously a
// placeholder rather than a guess at their address.
const MAP_FALLBACK_CENTER = { lat: 22.5937, lng: 78.9629 }
const MAP_FALLBACK_ZOOM = 4
const MAP_PINNED_ZOOM = 17

export default function RestaurantOnboarding() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [error, setError] = useState("")
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [registrationProcessing, setRegistrationProcessing] = useState(false)
  const [uploadingAttachments, setUploadingAttachments] = useState({})

  const triggerBackgroundUpload = async (file, folder, fieldName, isArray = false, arrayIndex = -1) => {
    if (!file || !isUploadableFile(file)) return;

    const trackingKey = isArray && arrayIndex >= 0 ? `${fieldName}_${arrayIndex}` : fieldName;
    setUploadingAttachments(prev => ({ ...prev, [trackingKey]: true }))
    
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', folder)
      
      const res = await restaurantAPI.uploadAttachment(formData)
      const url = res.data?.data?.url

      if (url) {
        if (fieldName === 'profileImage') {
           setStep2(prev => ({ ...prev, profileImage: url }))
        } else if (fieldName === 'panImage') {
           setStep3(prev => ({ ...prev, panImage: url }))
        } else if (fieldName === 'gstImage') {
           setStep3(prev => ({ ...prev, gstImage: url }))
        } else if (fieldName === 'fssaiImage') {
           setStep3(prev => ({ ...prev, fssaiImage: url }))
        } else if (fieldName === 'menuImages' && isArray && arrayIndex >= 0) {
           setStep2(prev => {
             const next = [...prev.menuImages]
             next[arrayIndex] = url
             return { ...prev, menuImages: next }
           })
        }
      }
    } catch (error) {
      console.error(`Failed to upload ${fieldName}:`, error)
      toast.error(`Image upload failed. Please re-select or retry.`)
    } finally {
      setUploadingAttachments(prev => ({ ...prev, [trackingKey]: false }))
    }
  }

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      await restaurantAPI.logout()
      clearModuleAuth("restaurant")
      clearAuthData()
      // Clear onboarding data and files
      clearOnboardingFromLocalStorage()
      await clearAllFilesFromDB()
      
      window.dispatchEvent(new Event("restaurantAuthChanged"))
      navigate("/food/restaurant/login", { replace: true })
    } catch (error) {
      debugError("Logout failed:", error)
      clearModuleAuth("restaurant")
      navigate("/food/restaurant/login", { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState("")
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isEditing, setIsEditing] = useState(true)
  const [hasExistingRestaurantProfile, setHasExistingRestaurantProfile] = useState(false)
  const [isFssaiCalendarOpen, setIsFssaiCalendarOpen] = useState(false)
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [isOnboardingHydrated, setIsOnboardingHydrated] = useState(false)

  const [step1, setStep1] = useState({
    restaurantName: "",
    pureVegRestaurant: null,
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    primaryContactNumber: "",
    zoneId: "",
    location: {
      formattedAddress: "",
      addressLine1: "",
      addressLine2: "",
      area: "",
      city: "",
      state: "",
      pincode: "",
      landmark: "",
      latitude: "",
      longitude: "",
    },
  })

  const [step2, setStep2] = useState({
    menuImages: [],
    profileImage: null,
    cuisines: [],
    estimatedDeliveryTime: "",
    openingTime: "",
    closingTime: "",
    openDays: [],
  })

  const [step3, setStep3] = useState({
    panNumber: "",
    nameOnPan: "",
    panImage: null,
    gstRegistered: false,
    gstNumber: "",
    gstLegalName: "",
    gstAddress: "",
    gstImage: null,
    // Whether the menu prices this restaurant is about to enter already contain
    // GST. Defaults to exclusive, which is how every menu on the platform
    // behaved before the question was asked.
    priceIncludesGst: false,
    fssaiNumber: "",
    fssaiExpiry: "",
    fssaiImage: null,
    accountNumber: "",
    confirmAccountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    accountType: "",
  })

  const previewUrlCacheRef = useRef(new Map())
  const locationSearchInputRef = useRef(null)
  const placesAutocompleteRef = useRef(null)
  const mapsScriptLoadedRef = useRef(false)
  const mapsLoadPromiseRef = useRef(null)
  const menuImagesInputRef = useRef(null)
  const profileImageInputRef = useRef(null)
  const panImageInputRef = useRef(null)
  const gstImageInputRef = useRef(null)
  const fssaiImageInputRef = useRef(null)
  const [sourcePicker, setSourcePicker] = useState({
    isOpen: false,
    title: "",
    onSelectFile: null,
    fileNamePrefix: "camera-image",
    fallbackInputRef: null,
  })

  // Manual search states for fallback
  const [locationSearchValue, setLocationSearchValue] = useState("")
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const mapMarkerRef = useRef(null)
  const geocoderRef = useRef(null)
  const [isMapReady, setIsMapReady] = useState(false)
  const [isResolvingPin, setIsResolvingPin] = useState(false)
  const [mapError, setMapError] = useState("")
  // null = nothing to say yet. Otherwise { status, zoneName } where status is
  // 'inside' | 'outside' | 'no_zone'.
  const [zoneMatch, setZoneMatch] = useState(null)

  const getPreviewImageUrl = (value) => {
    if (!value) return null
    if (typeof value === "string") return value
    if (value?.url && typeof value.url === "string") return value.url

    if (isUploadableFile(value)) {
      const cache = previewUrlCacheRef.current
      const cached = cache.get(value)
      if (cached) return cached
      try {
        const objectUrl = URL.createObjectURL(value)
        cache.set(value, objectUrl)
        return objectUrl
      } catch {
        return null
      }
    }

    return null
  }

  const openImageSourcePicker = ({ title, onSelectFile, fileNamePrefix, fallbackInputRef }) => {
    setSourcePicker({
      isOpen: true,
      title: title || "Select image source",
      onSelectFile,
      fileNamePrefix: fileNamePrefix || "camera-image",
      fallbackInputRef: fallbackInputRef || null,
    })
  }

  const closeImageSourcePicker = () => {
    setSourcePicker((prev) => ({ ...prev, isOpen: false }))
  }

  const handleMenuImagesSelected = (files = []) => {
    if (!files.length) return
    const currentCount = (step2.menuImages || []).length
    const nextMenuImages = [...(step2.menuImages || []), ...files]
    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    void persistMenuImagesToDB(nextMenuImages)

    // Trigger background uploads for new images
    files.forEach((img, idx) => {
      void triggerBackgroundUpload(img, 'menu', 'menuImages', true, currentCount + idx)
    })
  }

  const handleProfileImageSelected = (file) => {
    if (!file) return
    setStep2((prev) => ({
      ...prev,
      profileImage: file,
    }))
    void saveFileToDB("profileImage", file)
    void triggerBackgroundUpload(file, 'profile', 'profileImage')
  }

  const handlePanImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, panImage: file }))
    void triggerBackgroundUpload(file, 'pan', 'panImage')
  }

  const handleGstImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, gstImage: file }))
    void triggerBackgroundUpload(file, 'gst', 'gstImage')
  }

  const handleFssaiImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, fssaiImage: file }))
    void triggerBackgroundUpload(file, 'fssai', 'fssaiImage')
  }

  const isPersistedImageValue = (value) =>
    !isUploadableFile(value) &&
    ((typeof value === "string" && value.trim()) ||
      (value?.url && typeof value.url === "string"))

  const getPersistedImagePayload = (value) => {
    if (typeof value === "string" && value.trim()) {
      return { url: value.trim(), publicId: null }
    }

    if (value?.url && typeof value.url === "string" && value.url.trim()) {
      return {
        url: value.url.trim(),
        publicId: value.publicId || null,
      }
    }

    return null
  }

  const toPersistedMenuImagesPayload = (menuImages = []) =>
    (Array.isArray(menuImages) ? menuImages : [])
      .filter((img) => isPersistedImageValue(img))
      .map((img) =>
        typeof img === "string"
          ? img
          : {
              url: img.url,
              publicId: img.publicId || null,
            },
      )

  const handleRemoveMenuImage = async (indexToRemove) => {
    const currentMenuImages = step2.menuImages || []
    const imageToRemove = currentMenuImages[indexToRemove]
    const nextMenuImages = currentMenuImages.filter((_, i) => i !== indexToRemove)

    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    await persistMenuImagesToDB(nextMenuImages)

    if (!isPersistedImageValue(imageToRemove)) {
      return
    }

    try {
      await restaurantAPI.updateProfile({
        menuImages: toPersistedMenuImagesPayload(nextMenuImages),
      })
      toast.success("Menu image removed")
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        menuImages: currentMenuImages,
      }))
      await persistMenuImagesToDB(currentMenuImages)
      toast.error(error?.response?.data?.message || "Failed to remove menu image")
    }
  }

  const handleRemoveProfileImage = async () => {
    const currentProfileImage = step2.profileImage
    setStep2((prev) => ({
      ...prev,
      profileImage: null,
    }))

    if (!isPersistedImageValue(currentProfileImage)) {
      return
    }

    try {
      await restaurantAPI.updateProfile({ profileImage: "" })
      toast.success("Profile image removed")
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        profileImage: currentProfileImage,
      }))
      toast.error(error?.response?.data?.message || "Failed to remove profile image")
    }
  }

  const resolveImageForProfileUpdate = async (value, folder) => {
    if (!value) return null

    if (isUploadableFile(value)) {
      const uploaded = await handleUpload(value, folder)
      return uploaded || null
    }

    return getPersistedImagePayload(value)
  }

  const resolveMenuImagesForProfileUpdate = async (menuImages = []) => {
    const items = Array.isArray(menuImages) ? menuImages : []
    const resolved = await Promise.all(
      items.map(async (image) => {
        if (isUploadableFile(image)) {
          return handleUpload(image, "food/restaurants/menu")
        }

        return getPersistedImagePayload(image)
      }),
    )

    return resolved.filter((image) => image?.url)
  }


  // Load from localStorage on mount and check URL parameter
  useEffect(() => {
    setVerifiedPhoneNumber(getVerifiedPhoneFromStoredRestaurant())

    // Check if step is specified in URL (from OTP login redirect)
    const stepParam = searchParams.get("step")
    if (stepParam) {
      const stepNum = parseInt(stepParam, 10)
      if (stepNum >= 1 && stepNum <= 3) {
        setStep(stepNum)
      }
    }

    const loadData = async () => {
      try {
        const currentPhone = getVerifiedPhoneFromStoredRestaurant()
        const localData = loadOnboardingFromLocalStorage()
        
        if (localData) {
          // SECURITY CHECK: If the saved data's phone number doesn't match current login, clear it.
          // This prevents data leakage when logging in with a different account on the same device.
          const savedPhone = normalizePhoneDigits(localData.step1?.ownerPhone || "")
          const normalizedCurrent = normalizePhoneDigits(currentPhone)
          
          if (savedPhone && normalizedCurrent && savedPhone !== normalizedCurrent) {
             debugLog("? Phone mismatch, data belongs to different user. Clearing.")
             clearOnboardingFromLocalStorage()
             await clearAllFilesFromDB()
             return
          }

          if (localData.step1) {
            setStep1((prev) => ({
              ...prev,
              restaurantName: localData.step1.restaurantName || "",
              pureVegRestaurant:
                typeof localData.step1.pureVegRestaurant === "boolean"
                  ? localData.step1.pureVegRestaurant
                  : null,
              ownerName: localData.step1.ownerName || "",
              ownerEmail: localData.step1.ownerEmail || "",
              ownerPhone: normalizePhoneDigits(localData.step1.ownerPhone || ""),
              primaryContactNumber: normalizePhoneDigits(localData.step1.primaryContactNumber || ""),
              zoneId: localData.step1.zoneId || "",
              location: {
                formattedAddress: localData.step1.location?.formattedAddress || "",
                addressLine1: localData.step1.location?.addressLine1 || "",
                addressLine2: localData.step1.location?.addressLine2 || "",
                area: localData.step1.location?.area || "",
                city: localData.step1.location?.city || "",
                state: localData.step1.location?.state || "",
                pincode: localData.step1.location?.pincode || "",
                landmark: localData.step1.location?.landmark || "",
                latitude: localData.step1.location?.latitude ?? "",
                longitude: localData.step1.location?.longitude ?? "",
              },
            }))
          }

          // Restore Images from IndexedDB
          const restoredProfileImage = await getFileFromDB("profileImage")
          const restoredPanImage = await getFileFromDB("panImage")
          const restoredGstImage = await getFileFromDB("gstImage")
          const restoredFssaiImage = await getFileFromDB("fssaiImage")
          
          const restoredMenuImages = []
          for (let i = 0; i < 10; i++) {
            const img = await getFileFromDB(`menuImage_${i}`)
            if (img) restoredMenuImages.push(img)
          }

          if (localData.step2) {
            const urlMenuImages = (localData.step2.menuImages || []).filter(
              (img) => img?.url || typeof img === "string"
            )
            
            setStep2((prev) => ({
              ...prev,
              menuImages: [...urlMenuImages, ...restoredMenuImages],
              profileImage:
                restoredProfileImage ||
                (typeof localData.step2.profileImage === "string" || localData.step2.profileImage?.url
                  ? localData.step2.profileImage
                  : null),
              cuisines: localData.step2.cuisines || [],
              estimatedDeliveryTime: localData.step2.estimatedDeliveryTime || "",
              openingTime: normalizeTimeValue(localData.step2.openingTime),
              closingTime: normalizeTimeValue(localData.step2.closingTime),
              openDays: localData.step2.openDays || [],
            }))
          }

          if (localData.step3) {
            setStep3((prev) => ({
              ...prev,
              panNumber: localData.step3.panNumber || "",
              nameOnPan: localData.step3.nameOnPan || "",
              panImage: restoredPanImage || localData.step3.panImage || null,
              gstRegistered: localData.step3.gstRegistered || false,
              gstNumber: localData.step3.gstNumber || "",
              gstLegalName: localData.step3.gstLegalName || "",
              gstAddress: localData.step3.gstAddress || "",
              priceIncludesGst: localData.step3.priceIncludesGst === true,
              gstImage: restoredGstImage || localData.step3.gstImage || null,
              fssaiNumber: localData.step3.fssaiNumber || "",
              fssaiExpiry: localData.step3.fssaiExpiry || "",
              fssaiImage: restoredFssaiImage || localData.step3.fssaiImage || null,
              accountNumber: localData.step3.accountNumber || "",
              confirmAccountNumber: localData.step3.confirmAccountNumber || "",
              ifscCode: (localData.step3.ifscCode || "").toUpperCase(),
              accountHolderName: localData.step3.accountHolderName || "",
              accountType: normalizeAccountTypeValue(localData.step3.accountType || ""),
            }))
          }

          // Only set step from localStorage if URL doesn't have a step parameter
          if (localData.currentStep && !stepParam) {
            const restoredStep = Number(localData.currentStep) || 1
            setStep(Math.min(3, Math.max(1, restoredStep)))
          }
        }
      } finally {
        setIsOnboardingHydrated(true)
      }
    }

    loadData()
  }, [searchParams])

  useEffect(() => {
    if (!verifiedPhoneNumber) return
    setStep1((prev) => ({
      ...prev,
      ownerPhone: verifiedPhoneNumber,
    }))
  }, [verifiedPhoneNumber])

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const updateInset = () => {
      const vv = window.visualViewport
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height))
      setKeyboardInset(inset > 120 ? inset : 0)
    }

    updateInset()
    window.visualViewport.addEventListener("resize", updateInset)
    window.visualViewport.addEventListener("scroll", updateInset)
    return () => {
      window.visualViewport.removeEventListener("resize", updateInset)
      window.visualViewport.removeEventListener("scroll", updateInset)
    }
  }, [])

  // Save to localStorage whenever step data changes
  useEffect(() => {
    if (!isOnboardingHydrated) return
    saveOnboardingToLocalStorage(step1, step2, step3, step)
    
    // Save images to IndexedDB
    const saveFiles = async () => {
      if (step2.profileImage && isUploadableFile(step2.profileImage)) {
        await saveFileToDB("profileImage", step2.profileImage)
      } else if (!step2.profileImage) {
        await deleteFileFromDB("profileImage")
      }
      if (step3.panImage && isUploadableFile(step3.panImage)) {
        await saveFileToDB("panImage", step3.panImage)
      }
      if (step3.gstImage && isUploadableFile(step3.gstImage)) {
        await saveFileToDB("gstImage", step3.gstImage)
      }
      if (step3.fssaiImage && isUploadableFile(step3.fssaiImage)) {
        await saveFileToDB("fssaiImage", step3.fssaiImage)
      }
      
      await persistMenuImagesToDB(step2.menuImages || [])
    }
    saveFiles()
  }, [isOnboardingHydrated, step1, step2, step3, step])

  useEffect(() => {
    syncOnboardingFileCache(step2, step3)
  }, [step2, step3])

  useEffect(() => {
    return () => {
      previewUrlCacheRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // Ignore revoke errors
        }
      })
      previewUrlCacheRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        // Use restaurantAPI.getCurrentRestaurant() to fetch real data
        const res = await restaurantAPI.getCurrentRestaurant()
        const data = res?.data?.data?.restaurant || res?.data?.restaurant
        const loginPhone = res?.data?.data?.phone || res?.data?.phone
        
          if (data) {
            setHasExistingRestaurantProfile(true)
            const onboardingData = data.onboarding || {}
            const step1Data = onboardingData.step1 || {}
            const step2Data = onboardingData.step2 || {}
            const step3Data = onboardingData.step3 || {}
            const panData = step3Data.pan || {}
            const gstData = step3Data.gst || {}
            const fssaiData = step3Data.fssai || {}
            const bankData = step3Data.bank || {}
            const locationData = step1Data.location || data.location || {}
            const deliveryTimings = step2Data.deliveryTimings || data.deliveryTimings || {}

            setIsEditing(true)
            
            const normalizedData = {
              restaurantName: step1Data.restaurantName || data.name || data.restaurantName || "",
              pureVegRestaurant: typeof step1Data.pureVegRestaurant === 'boolean' ? step1Data.pureVegRestaurant : (typeof data.pureVegRestaurant === 'boolean' ? data.pureVegRestaurant : null),
              ownerName: step1Data.ownerName || data.ownerName || "",
              ownerEmail: step1Data.ownerEmail || data.ownerEmail || data.email || "",
              ownerPhone: normalizePhoneDigits(step1Data.ownerPhone || data.ownerPhone || data.phone || loginPhone || ""),
              primaryContactNumber: normalizePhoneDigits(step1Data.primaryContactNumber || data.primaryContactNumber || data.ownerPhone || data.phone || ""),
              zoneId: step1Data.zoneId || data.zoneId || "",
              location: {
                addressLine1: locationData.addressLine1 || data.addressLine1 || "",
                addressLine2: locationData.addressLine2 || data.addressLine2 || "",
                landmark: locationData.landmark || data.landmark || "",
                area: locationData.area || data.area || "",
                city: locationData.city || data.city || "",
                state: locationData.state || data.state || "",
                pincode: locationData.pincode || data.pincode || "",
                latitude: locationData.latitude || "",
                longitude: locationData.longitude || "",
                formattedAddress: locationData.formattedAddress || locationData.address || data.address || "",
              }
            }
            
            // Set verified phone number based on login phone, format it
            if (loginPhone) {
              setVerifiedPhoneNumber(normalizePhoneDigits(loginPhone))
            }
            
            setStep1(normalizedData)

            // Map Step 2
            setStep2((prev) => ({
              ...prev,
              menuImages:
                (step2Data.menuImageUrls && step2Data.menuImageUrls.length > 0)
                  ? step2Data.menuImageUrls
                  : (data.menuImages && data.menuImages.length > 0)
                  ? data.menuImages
                  : prev.menuImages,
              profileImage: step2Data.profileImageUrl || data.profileImage || prev.profileImage,
              cuisines:
                (step2Data.cuisines && step2Data.cuisines.length > 0)
                  ? step2Data.cuisines
                  : (data.cuisines && data.cuisines.length > 0)
                  ? data.cuisines
                  : prev.cuisines,
              estimatedDeliveryTime:
                step2Data.estimatedDeliveryTime ||
                data.estimatedDeliveryTime ||
                prev.estimatedDeliveryTime ||
                "",
              openingTime: normalizeTimeValue(deliveryTimings.openingTime || data.openingTime) || prev.openingTime,
              closingTime: normalizeTimeValue(deliveryTimings.closingTime || data.closingTime) || prev.closingTime,
              openDays:
                (step2Data.openDays && step2Data.openDays.length > 0)
                  ? step2Data.openDays
                  : (data.openDays && data.openDays.length > 0)
                  ? data.openDays
                  : prev.openDays,
            }))

            // Map Step 3
            setStep3((prev) => ({
              ...prev,
              panNumber: panData.panNumber || data.panNumber || prev.panNumber || "",
              nameOnPan: panData.nameOnPan || data.nameOnPan || prev.nameOnPan || "",
              panImage: panData.image || data.panImage || prev.panImage || null,
              gstRegistered:
                typeof gstData.isRegistered === "boolean"
                  ? gstData.isRegistered
                  : typeof data.gstRegistered === "boolean"
                  ? data.gstRegistered
                  : (prev.gstRegistered || false),
              gstNumber: gstData.gstNumber || data.gstNumber || prev.gstNumber || "",
              gstLegalName: gstData.legalName || data.gstLegalName || prev.gstLegalName || "",
              gstAddress: gstData.address || data.gstAddress || prev.gstAddress || "",
              gstImage: gstData.image || data.gstImage || prev.gstImage || null,
              fssaiNumber: fssaiData.registrationNumber || data.fssaiNumber || prev.fssaiNumber || "",
              fssaiExpiry:
                fssaiData.expiryDate
                  ? String(fssaiData.expiryDate).split("T")[0]
                  : data.fssaiExpiry
                  ? String(data.fssaiExpiry).split("T")[0]
                  : prev.fssaiExpiry,
              fssaiImage: fssaiData.image || data.fssaiImage || prev.fssaiImage || null,
              accountNumber: bankData.accountNumber || data.accountNumber || prev.accountNumber || "",
              confirmAccountNumber:
                bankData.accountNumber || data.accountNumber || prev.confirmAccountNumber || "",
              ifscCode: (bankData.ifscCode || data.ifscCode || prev.ifscCode || "").toUpperCase(),
              accountHolderName:
                bankData.accountHolderName || data.accountHolderName || prev.accountHolderName || "",
              accountType: normalizeAccountTypeValue(bankData.accountType || data.accountType || prev.accountType || ""),
            }))

          // Only determine step automatically if not specified in URL
          const stepParam = searchParams.get("step")
          if (!stepParam) {
            // If already registered/pending, stay on step 1 for editing
            if (data.status === "approved" || data.status === "pending") {
               setStep(1)
            } else {
               const stepToShow = determineStepToShow({ step1: data, step2: data, step3: data })
               // Map null (all steps complete) to Step 4
               const targetStep = stepToShow === null ? 4 : stepToShow
               
               // Only update if backend says we are further along than current local step
               // This prevents "downgrading" the step on reload if backend is out of sync
               setStep(prevStep => {
                 if (targetStep > prevStep) {
                   return targetStep
                 }
                 return prevStep
               })
            }
          }
        } else {
          setIsEditing(true)
          setHasExistingRestaurantProfile(false)
        }
      } catch (err) {
        setIsEditing(true)
        setHasExistingRestaurantProfile(false)
        if (err?.response?.status === 401) {
          debugError("Authentication error fetching onboarding:", err)
        } else {
          debugError("Error fetching onboarding data:", err)
        }
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [searchParams])

  const handleUpload = async (file, folder) => {
    try {
      if (!isUploadableFile(file)) {
        throw new Error("Invalid image file")
      }

      const response = await uploadAPI.uploadMedia(file, { folder })
      const uploadedImage = response?.data?.data

      if (!uploadedImage?.url) {
        throw new Error("Uploaded image URL was not returned")
      }

      return uploadedImage
    } catch (err) {
      // Provide more informative error message for upload failures
      const errorMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Failed to upload image"
      debugError("Upload error:", errorMsg, err)
      throw new Error(`Image upload failed: ${errorMsg}`)
    }
  }

  // Validation functions for each step
  const validateStep1 = () => {
    const errors = []

    if (!step1.restaurantName?.trim()) {
      errors.push("Restaurant name is required")
    }
    if (typeof step1.pureVegRestaurant !== "boolean") {
      errors.push("Please select whether your restaurant is pure veg")
    }
    if (!step1.ownerName?.trim()) {
      errors.push("Owner name is required")
    } else if (!OWNER_NAME_REGEX.test(step1.ownerName.trim())) {
      errors.push("Owner name must contain only letters")
    }
    if (!step1.ownerEmail?.trim()) {
      errors.push("Owner email is required")
    } else if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(step1.ownerEmail.trim())) {
      errors.push("Please enter a valid email address")
    }
    if (!step1.ownerPhone?.trim()) {
      errors.push("Owner phone number is required")
    }
    if (!step1.primaryContactNumber?.trim()) {
      errors.push("Primary contact number is required")
    }
    if (!step1.zoneId?.trim()) {
      errors.push("Service zone is required")
    }
    if (!step1.location?.area?.trim()) {
      errors.push("Area/Sector/Locality is required")
    }
    if (!step1.location?.city?.trim()) {
      errors.push("City is required")
    }

    return errors
  }

  const validateStep2 = () => {
    const errors = []

    // Check menu images - must have at least one File or existing URL
    const hasMenuImages = step2.menuImages && step2.menuImages.length > 0
    if (!hasMenuImages) {
      errors.push("At least one menu image is required")
    } else {
      // Verify that menu images are either File objects or have valid URLs
      const validMenuImages = step2.menuImages.filter(img => {
        if (isUploadableFile(img)) return true
        if (img?.url && typeof img.url === 'string') return true
        if (typeof img === 'string' && img.trim()) return true
        return false
      })
      if (validMenuImages.length === 0) {
        errors.push("Please upload at least one valid menu image")
      }
    }

    // Check profile image - must be a File or existing URL
    if (!step2.profileImage) {
      errors.push("Restaurant profile image is required")
    } else {
      // Verify profile image is either a File or has a valid URL
      const isValidProfileImage =
        isUploadableFile(step2.profileImage) ||
        (step2.profileImage?.url && typeof step2.profileImage.url === 'string') ||
        (typeof step2.profileImage === 'string' && step2.profileImage.trim())
      if (!isValidProfileImage) {
        errors.push("Please upload a valid restaurant profile image")
      }
    }

    if (!step2.openingTime?.trim()) {
      errors.push("Opening time is required")
    }
    if (!step2.closingTime?.trim()) {
      errors.push("Closing time is required")
    }
    const openingMinutes = timeStringToMinutes(step2.openingTime)
    const closingMinutes = timeStringToMinutes(step2.closingTime)
    if (openingMinutes !== null && closingMinutes !== null) {
      if (openingMinutes === closingMinutes) {
        errors.push("Opening time and closing time cannot be same")
      } else if (closingMinutes < openingMinutes) {
        errors.push("Closing time cannot be less than opening time")
      }
    }
    if (!step2.openDays || step2.openDays.length === 0) {
      errors.push("Please select at least one open day")
    }
    if (!step2.estimatedDeliveryTime?.trim()) {
      errors.push("Estimated delivery time is required")
    }

    return errors
  }

  const validateStep3 = () => {
    const errors = []

    if (!step3.panNumber?.trim()) {
      errors.push("PAN number is required")
    } else if (!PAN_NUMBER_REGEX.test(step3.panNumber.trim().toUpperCase())) {
      errors.push("PAN number must be valid (e.g., ABCDE1234F)")
    }
    if (!step3.nameOnPan?.trim()) {
      errors.push("Name on PAN is required")
    }
    // Validate PAN image - must be a File or existing URL
    if (!step3.panImage) {
      errors.push("PAN image is required")
    } else {
      const isValidPanImage =
        isUploadableFile(step3.panImage) ||
        (step3.panImage?.url && typeof step3.panImage.url === 'string') ||
        (typeof step3.panImage === 'string' && step3.panImage.trim())
      if (!isValidPanImage) {
        errors.push("Please upload a valid PAN image")
      }
    }

    if (!step3.fssaiNumber?.trim()) {
      errors.push("FSSAI number is required")
    } else if (!FSSAI_NUMBER_REGEX.test(step3.fssaiNumber.trim())) {
      errors.push("FSSAI number must contain exactly 14 digits")
    }
    if (!step3.fssaiExpiry?.trim()) {
      errors.push("FSSAI expiry date is required")
    } else if (step3.fssaiExpiry < getTodayLocalYMD()) {
      errors.push("FSSAI expiry date cannot be in the past")
    }
    // Validate FSSAI image - must be a File or existing URL
    if (!step3.fssaiImage) {
      errors.push("FSSAI image is required")
    } else {
      const isValidFssaiImage =
        isUploadableFile(step3.fssaiImage) ||
        (step3.fssaiImage?.url && typeof step3.fssaiImage.url === 'string') ||
        (typeof step3.fssaiImage === 'string' && step3.fssaiImage.trim())
      if (!isValidFssaiImage) {
        errors.push("Please upload a valid FSSAI image")
      }
    }

    // Validate GST details if GST registered
    if (step3.gstRegistered) {
      if (!step3.gstNumber?.trim()) {
        errors.push("GST number is required when GST registered")
      } else if (!GST_NUMBER_REGEX.test(step3.gstNumber.trim().toUpperCase())) {
        errors.push("GST number must be a valid 15-character GSTIN")
      }
      if (!step3.gstLegalName?.trim()) {
        errors.push("GST legal name is required when GST registered")
      } else if (!GST_LEGAL_NAME_REGEX.test(step3.gstLegalName.trim())) {
        errors.push("GST legal name must contain only letters")
      }
      if (!step3.gstAddress?.trim()) {
        errors.push("GST registered address is required when GST registered")
      }
      // Validate GST image if GST registered
      if (!step3.gstImage) {
        errors.push("GST image is required when GST registered")
      } else {
        const isValidGstImage =
          isUploadableFile(step3.gstImage) ||
          (step3.gstImage?.url && typeof step3.gstImage.url === 'string') ||
          (typeof step3.gstImage === 'string' && step3.gstImage.trim())
        if (!isValidGstImage) {
          errors.push("Please upload a valid GST image")
        }
      }
    }

    if (!step3.accountNumber?.trim()) {
      errors.push("Account number is required")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.accountNumber.trim())) {
      errors.push("Account number must contain 9 to 18 digits only")
    }
    if (!step3.confirmAccountNumber?.trim()) {
      errors.push("Please confirm your account number")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.confirmAccountNumber.trim())) {
      errors.push("Confirm account number must contain 9 to 18 digits only")
    }
    if (step3.accountNumber && step3.confirmAccountNumber && step3.accountNumber !== step3.confirmAccountNumber) {
      errors.push("Account number and confirmation do not match")
    }
    if (!step3.ifscCode?.trim()) {
      errors.push("IFSC code is required")
    } else if (!IFSC_CODE_REGEX.test(step3.ifscCode.trim().toUpperCase())) {
      errors.push("IFSC code must contain exactly 11 alphanumeric characters")
    }
    if (!step3.accountHolderName?.trim()) {
      errors.push("Account holder name is required")
    } else if (!ACCOUNT_HOLDER_NAME_REGEX.test(step3.accountHolderName.trim())) {
      errors.push("Account holder name must contain only letters")
    }
    if (!step3.accountType?.trim()) {
      errors.push("Account type is required")
    } else if (!["Saving", "Current"].includes(step3.accountType.trim())) {
      errors.push("Account type must be either Saving or Current")
    }

    return errors
  }

  // Fill dummy data for testing (development mode only)




  const handleNext = async () => {
    setError("")

    // Validate current step before proceeding
    let validationErrors = []
    if (step === 1) {
      validationErrors = validateStep1()
    } else if (step === 2) {
      validationErrors = validateStep2()
    } else if (step === 3) {
      validationErrors = validateStep3()
    }

    if (validationErrors.length > 0) {
      // Surface only the first error so validation proceeds top-to-bottom.
      toast.error(validationErrors[0], {
        duration: 4000,
      })
      debugLog('? Validation failed:', validationErrors)
      return
    }

    setSaving(true)
    try {
      if (step === 1) {
        setStep(2)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 2) {
        setStep(3)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 3) {
        await submitRegistration()
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save onboarding data"
      setError(msg)
    } finally {
      setSaving(false)
    }
  }



  const toggleDay = (day) => {
    setStep2((prev) => {
      const exists = prev.openDays.includes(day)
      if (exists) {
        return { ...prev, openDays: prev.openDays.filter((d) => d !== day) }
      }
      return { ...prev, openDays: [...prev.openDays, day] }
    })
  }

  const renderStep1 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Restaurant information</h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-700">Restaurant name*</Label>
            <Input
              value={step1.restaurantName || ""}
              onChange={(e) => setStep1({ ...step1, restaurantName: e.target.value })}
              className="mt-1 bg-white text-sm text-black placeholder-black"
              placeholder="Customers will see this name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Pure veg restaurant?*</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => isEditing && setStep1({ ...step1, pureVegRestaurant: true })}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVegRestaurant === true
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                Yes, Pure Veg
              </button>
              <button
                type="button"
                onClick={() => isEditing && setStep1({ ...step1, pureVegRestaurant: false })}
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVegRestaurant === false
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                No, Mixed Menu
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              This helps users filter restaurants by dietary preference.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Owner details</h2>
        <p className="text-sm text-gray-600 mb-4">
          These details will be used for all business communications and updates.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-700">Full name*</Label>
            <Input
              value={step1.ownerName || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  ownerName: e.target.value.replace(/[^A-Za-z ]/g, ""),
                })
              }
              className="mt-1 bg-white text-sm text-black placeholder-black"
              placeholder="Owner full name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Email address*</Label>
            <Input
              type="email"
              value={step1.ownerEmail || ""}
              onChange={(e) => setStep1({ ...step1, ownerEmail: e.target.value })}
              className="mt-1 bg-white text-sm text-black placeholder-black"
              placeholder="owner@example.com"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Phone number*</Label>
            <div className="relative flex items-center mt-1">
              <span className="absolute left-3 text-sm text-gray-500 font-medium select-none">+91</span>
              <Input
                type="text"
                value={step1.ownerPhone ? normalizePhoneDigits(step1.ownerPhone) : ""}
                onChange={(e) => setStep1({ ...step1, ownerPhone: handleRawPhoneInput(e.target.value) })}
                readOnly={Boolean(verifiedPhoneNumber)}
                className="pl-12 bg-white text-sm text-black placeholder-gray-400 w-full animate-none"
                placeholder="XXXXXXXXXX"
                maxLength={10}
                disabled={!isEditing}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Restaurant contact & location</h2>
        <div>
          <Label className="text-xs text-gray-700">Primary contact number*</Label>
          <div className="relative flex items-center mt-1">
            <span className="absolute left-3 text-sm text-gray-500 font-medium select-none">+91</span>
            <Input
              type="text"
              value={step1.primaryContactNumber ? normalizePhoneDigits(step1.primaryContactNumber) : ""}
              onChange={(e) => {
                setStep1({ ...step1, primaryContactNumber: handleRawPhoneInput(e.target.value) })
              }}
              className="pl-12 bg-white text-sm text-black placeholder-gray-400 w-full animate-none"
              placeholder="XXXXXXXXXX"
              maxLength={10}
              disabled={!isEditing}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Customers, delivery partners and {companyName} may call on this number for order
            support.
          </p>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Add your restaurant's location for order pick-up.
          </p>
          <div>
            <Label className="text-xs text-gray-700">Service zone*</Label>
            <select
              value={step1.zoneId || ""}
              onChange={(e) => setStep1({ ...step1, zoneId: e.target.value })}
              className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              disabled={zonesLoading || !isEditing}
            >
              <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
              {zones.map((z) => {
                const id = String(z?._id || z?.id || "")
                const label = z?.name || z?.zoneName || z?.serviceLocation || id
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                )
              })}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Choose the service zone where your restaurant will be available.
            </p>
          </div>
          <div className="relative">
            <Label className="text-xs text-gray-700">Search location</Label>
            <div className="relative">
              <Input
                ref={locationSearchInputRef}
                value={locationSearchValue}
                onChange={(e) => setLocationSearchValue(e.target.value)}
                className="mt-1 bg-white text-sm text-black! dark:text-white! placeholder:text-gray-500 dark:placeholder:text-gray-400 caret-black dark:caret-white"
                style={{ color: "#000", WebkitTextFillColor: "#000" }}
                placeholder="Start typing your restaurant address..."
              />
              {isSearchingLocation && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-orange/50 border-t-transparent" />
                </div>
              )}
            </div>

            {/* Fallback suggestions dropdown */}
            {locationSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-xl z-[999999] overflow-hidden max-h-60 overflow-y-auto">
                {locationSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      const { lat, lng, display, addr } = s
                      const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.locality || ""
                      const city = addr.city || addr.town || addr.village || ""
                      const state = addr.state || ""
                      const pincode = addr.postcode || ""

                      applyResolvedLocation({
                        formattedAddress: display,
                        area,
                        city,
                        state,
                        pincode,
                        latitude: lat,
                        longitude: lng,
                      })
                      setLocationSuggestions([])
                    }}
                    className="w-full px-4 py-2 text-left text-[13px] hover:bg-primary-orange/5 border-b border-gray-100 last:border-none font-medium text-gray-700"
                  >
                    <span className="truncate">{s.display}</span>
                  </button>
                ))}
              </div>
            )}
            
            <p className="text-[11px] text-gray-500 mt-1">
              Select a suggestion to auto-fill area/city/state/pincode and coordinates.
            </p>
          </div>

          {/* Pin the exact spot. Searching gets the street; the pin gets the door. */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-gray-700">Pin your exact location</Label>
              <button
                type="button"
                onClick={useCurrentLocation}
                disabled={isResolvingPin}
                className="text-[11px] font-semibold text-primary-orange hover:underline disabled:opacity-50"
              >
                {isResolvingPin ? "Locating..." : "Use my current location"}
              </button>
            </div>

            <div className="relative mt-1 overflow-hidden rounded-md border border-gray-200">
              <div ref={mapContainerRef} className="h-56 w-full bg-gray-100" />

              {!isMapReady && !mapError && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 text-[11px] text-gray-500">
                  Loading map...
                </div>
              )}

              {isResolvingPin && isMapReady && (
                <div className="absolute left-2 top-2 rounded bg-white/95 px-2 py-1 text-[11px] font-medium text-gray-600 shadow">
                  Finding address...
                </div>
              )}
            </div>

            {mapError ? (
              <p className="mt-1 text-[11px] text-amber-700">{mapError}</p>
            ) : (
              <p className="mt-1 text-[11px] text-gray-500">
                Tap the map or drag the pin to your doorstep. This is where delivery partners will be sent.
              </p>
            )}

            {step1.location?.latitude !== "" && step1.location?.longitude !== "" && (
              <p className="mt-1 text-[11px] font-medium text-gray-600">
                Pinned at {Number(step1.location.latitude).toFixed(6)}, {Number(step1.location.longitude).toFixed(6)}
              </p>
            )}

            {/* Advisory only -- onboarding is never blocked on this. */}
            {zoneMatch?.status === "outside" && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-800">
                  This pin is inside {zoneMatch.zoneName}, not the zone you selected.
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  You can continue, but orders are matched by zone -- please check the zone above,
                  or move the pin if it is in the wrong place.
                </p>
              </div>
            )}

            {zoneMatch?.status === "no_zone" && (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-800">
                  This pin is outside every service zone.
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  You can still finish onboarding -- our team will confirm coverage before you go live.
                </p>
              </div>
            )}

            {zoneMatch?.status === "inside" && (
              <p className="mt-2 text-[11px] font-medium text-emerald-700">
                This pin is inside the zone you selected.
              </p>
            )}
          </div>
          <Input
            value={step1.location?.addressLine1 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine1: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Shop no. / building no. (optional)"
          />
          <Input
            value={step1.location?.addressLine2 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine2: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Floor / tower (optional)"
          />
          <Input
            value={step1.location?.landmark || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, landmark: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Nearby landmark (optional)"
          />
          <Input
            value={step1.location?.area || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, area: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Area / Sector / Locality*"
          />
          <Input
            value={step1.location?.city || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, city: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="City"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              value={step1.location?.state || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, state: e.target.value },
                })
              }
              className="bg-white text-sm"
              placeholder="State"
            />
            <Input
              value={step1.location?.pincode || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, pincode: e.target.value },
                })
              }
              className="bg-white text-sm"
              placeholder="Pincode"
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Please ensure that this address is the same as mentioned on your FSSAI license.
          </p>
        </div>
      </section>
    </div>
  )


  /*
   * One Google Maps load, shared by the address autocomplete and the map picker.
   *
   * This used to live inside the autocomplete effect. The map picker needs the
   * same SDK, and a second copy of this logic would have raced the first: both
   * would look for an existing tag, both could decide to remove and re-inject it,
   * and whichever lost would resolve against a script that had just been pulled
   * out of the document.
   */
  const loadGoogleMaps = useCallback(async () => {
    if (window.google?.maps?.places?.Autocomplete) {
      mapsScriptLoadedRef.current = true
      return true
    }

    if (mapsLoadPromiseRef.current) return mapsLoadPromiseRef.current

    mapsLoadPromiseRef.current = (async () => {
      const apiKey = await getGoogleMapsApiKey()
      if (!apiKey) {
        debugError("Google Maps API Key missing or invalid")
        return false
      }

      window.gm_authFailure = () => {
        debugError("Google Maps authentication failed.")
      }

      const scripts = Array.from(document.getElementsByTagName("script"))
      const mapsScript = scripts.find((sc) => sc.src?.includes("maps.googleapis.com/maps/api/js"))

      if (mapsScript && !mapsScript.src.includes("libraries=places")) {
        debugLog("Found maps script without places, removing to reload properly.")
        mapsScript.remove()
      } else if (mapsScript) {
        for (let i = 0; i < 60; i++) {
          if (window.google?.maps?.places?.Autocomplete) return true
          await new Promise((r) => setTimeout(r, 100))
        }
      }

      return new Promise((resolve) => {
        const script = document.createElement("script")
        script.id = "google-maps-sdk"
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
        script.async = true
        script.defer = true
        script.onload = () => {
          setTimeout(() => {
            const ok = !!window.google?.maps?.places?.Autocomplete
            mapsScriptLoadedRef.current = ok
            resolve(ok)
          }, 200)
        }
        script.onerror = () => resolve(false)
        document.head.appendChild(script)
      })
    })()

    const result = await mapsLoadPromiseRef.current
    // A failed load must be retryable; a successful one is cached by the guard above.
    if (!result) mapsLoadPromiseRef.current = null
    return result
  }, [])

  /*
   * Write a resolved location into the form.
   *
   * Three entry points land here -- an autocomplete pick, the Nominatim fallback
   * list, and a pin dropped on the map -- and they must agree field for field, or
   * the address a restaurant sees depends on how they chose it.
   */
  const applyResolvedLocation = useCallback((parsed) => {
    setStep1((prev) => ({
      ...prev,
      location: {
        ...prev.location,
        formattedAddress: parsed.formattedAddress || prev.location.formattedAddress,
        addressLine1: parsed.formattedAddress || prev.location.addressLine1 || "",
        area: parsed.area || prev.location.area,
        city: parsed.city || prev.location.city,
        state: parsed.state || prev.location.state,
        pincode: parsed.pincode || prev.location.pincode,
        latitude: parsed.latitude !== "" ? parsed.latitude : prev.location.latitude,
        longitude: parsed.longitude !== "" ? parsed.longitude : prev.location.longitude,
      },
    }))
    if (parsed.formattedAddress) setLocationSearchValue(parsed.formattedAddress)
  }, [])

  /**
   * Turn a dropped pin into an address.
   *
   * Typing an address and dropping a pin are the two halves of the same job, so
   * this ends at the same applyResolvedLocation the autocomplete uses. If the
   * reverse geocode fails we still keep the coordinates -- the exact spot is the
   * thing the pin was for, and losing it because the address lookup was rate
   * limited would be the worst outcome.
   */
  const resolvePinnedPosition = useCallback(async (lat, lng) => {
    const latitude = Number(Number(lat).toFixed(6))
    const longitude = Number(Number(lng).toFixed(6))

    setStep1((prev) => ({ ...prev, location: { ...prev.location, latitude, longitude } }))
    setMapError("")
    setIsResolvingPin(true)

    try {
      if (!geocoderRef.current && window.google?.maps?.Geocoder) {
        geocoderRef.current = new window.google.maps.Geocoder()
      }
      if (!geocoderRef.current) return

      const { results } = await geocoderRef.current.geocode({ location: { lat: latitude, lng: longitude } })
      const best = Array.isArray(results) ? results[0] : null
      if (!best) {
        setMapError("Could not find an address for that point. The coordinates are saved -- please fill the address fields below.")
        return
      }

      const parsed = parseGooglePlace(best)
      // The pin is the authority on where this is, so its own coordinates win
      // over the ones the geocoder snapped to the nearest known address.
      applyResolvedLocation({ ...parsed, latitude, longitude })
    } catch {
      setMapError("Address lookup failed, but your pin is saved. Please check the address fields below.")
    } finally {
      setIsResolvingPin(false)
    }
  }, [applyResolvedLocation])

  /*
   * The map itself.
   *
   * Kept separate from the autocomplete effect so a failure in one does not take
   * the other down -- a restaurant that cannot load the map can still type an
   * address, and vice versa. Both share the single loadGoogleMaps call.
   */
  useEffect(() => {
    if (step !== 1) return
    let cancelled = false

    const init = async () => {
      const ok = await loadGoogleMaps()
      if (!ok || cancelled) {
        if (!cancelled) setMapError("The map could not be loaded. You can still search for your address above.")
        return
      }

      // The container mounts with the step, which may render after this runs.
      let container = null
      for (let i = 0; i < 50; i++) {
        if (mapContainerRef.current) { container = mapContainerRef.current; break }
        if (cancelled) return
        await new Promise((r) => setTimeout(r, 100))
      }
      if (!container || cancelled) return

      const storedLat = Number(step1.location?.latitude)
      const storedLng = Number(step1.location?.longitude)
      const hasStored = Number.isFinite(storedLat) && Number.isFinite(storedLng)
        && !(storedLat === 0 && storedLng === 0)
      const center = hasStored ? { lat: storedLat, lng: storedLng } : MAP_FALLBACK_CENTER

      const map = new window.google.maps.Map(container, {
        center,
        zoom: hasStored ? MAP_PINNED_ZOOM : MAP_FALLBACK_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      })

      const marker = new window.google.maps.Marker({
        map,
        position: center,
        draggable: true,
        // Hidden until there is something to point at, so an unset location does
        // not look like a pin someone deliberately placed in central India.
        visible: hasStored,
      })

      mapInstanceRef.current = map
      mapMarkerRef.current = marker

      const place = (latLng) => {
        marker.setPosition(latLng)
        marker.setVisible(true)
        resolvePinnedPosition(latLng.lat(), latLng.lng())
      }

      map.addListener("click", (e) => { if (e?.latLng) place(e.latLng) })
      marker.addListener("dragend", () => {
        const pos = marker.getPosition()
        if (pos) resolvePinnedPosition(pos.lat(), pos.lng())
      })

      if (!cancelled) setIsMapReady(true)
    }

    init().catch(() => {
      if (!cancelled) setMapError("The map could not be loaded. You can still search for your address above.")
    })

    return () => {
      cancelled = true
      if (mapMarkerRef.current) {
        try { window.google?.maps?.event?.clearInstanceListeners(mapMarkerRef.current) } catch {}
        mapMarkerRef.current.setMap?.(null)
        mapMarkerRef.current = null
      }
      if (mapInstanceRef.current) {
        try { window.google?.maps?.event?.clearInstanceListeners(mapInstanceRef.current) } catch {}
        mapInstanceRef.current = null
      }
      setIsMapReady(false)
    }
    // step only: re-running on every coordinate change would rebuild the map
    // underneath the pin the restaurant just dropped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, loadGoogleMaps, resolvePinnedPosition])

  /*
   * Follow the form: searching an address moves the pin, so the two controls
   * never disagree about where the restaurant is.
   */
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current || !mapMarkerRef.current) return
    const lat = Number(step1.location?.latitude)
    const lng = Number(step1.location?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return

    const position = { lat, lng }
    const current = mapMarkerRef.current.getPosition?.()
    // Skip when the marker is already there, or dragging it would fight this.
    if (current && Math.abs(current.lat() - lat) < 1e-7 && Math.abs(current.lng() - lng) < 1e-7) return

    mapMarkerRef.current.setPosition(position)
    mapMarkerRef.current.setVisible(true)
    mapInstanceRef.current.panTo(position)
    if (mapInstanceRef.current.getZoom() < MAP_PINNED_ZOOM) {
      mapInstanceRef.current.setZoom(MAP_PINNED_ZOOM)
    }
  }, [isMapReady, step1.location?.latitude, step1.location?.longitude])

  /*
   * Does the pin fall inside the zone they picked?
   *
   * Asked of /zones/detect rather than answered in the browser, deliberately: the
   * server owns the polygons and the containment test, and a second copy here
   * could quietly disagree with the one that decides things at approval -- which
   * is the worst version of this, a restaurant told they are fine and rejected
   * later.
   *
   * A warning, never a block. A zone boundary is an operational guess, a
   * restaurant on the edge of one is a normal situation, and refusing to let them
   * finish onboarding over it would cost a real signup. The admin still sees the
   * pin at approval.
   */
  useEffect(() => {
    const lat = Number(step1.location?.latitude)
    const lng = Number(step1.location?.longitude)
    const selectedZoneId = String(step1.zoneId || "").trim()

    if (!selectedZoneId || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      setZoneMatch(null)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      zoneAPI.detectZone(lat, lng)
        .then((res) => {
          if (cancelled) return
          const payload = res?.data?.data || res?.data || {}
          const detectedId = payload.zoneId ? String(payload.zoneId) : ""

          if (!detectedId) {
            setZoneMatch({ status: "no_zone", zoneName: "" })
            return
          }
          if (detectedId === selectedZoneId) {
            setZoneMatch({ status: "inside", zoneName: "" })
            return
          }
          const detected = payload.zone || {}
          setZoneMatch({
            status: "outside",
            zoneName: detected.name || detected.zoneName || detected.serviceLocation || "another zone",
          })
        })
        // Silent on failure: an unreachable check must not produce a warning
        // about the restaurant's address.
        .catch(() => { if (!cancelled) setZoneMatch(null) })
    }, 400) // the pin can move a lot while being dragged

    return () => { cancelled = true; clearTimeout(timer) }
  }, [step1.zoneId, step1.location?.latitude, step1.location?.longitude])

  /** Drop the pin on wherever the device says it is. */
  const useCurrentLocation = useCallback(() => {
    if (!navigator?.geolocation) {
      setMapError("This browser cannot share your location. Please pin your spot on the map instead.")
      return
    }
    setMapError("")
    setIsResolvingPin(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolvePinnedPosition(pos.coords.latitude, pos.coords.longitude),
      () => {
        setIsResolvingPin(false)
        setMapError("We could not read your location. Please allow location access, or pin your spot on the map.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [resolvePinnedPosition])

  // Initialize Google Places Autocomplete for Step 1 location search.
  useEffect(() => {
    if (step !== 1) return

    let cancelled = false
    let autocomplete = null

    const init = async () => {
      // Wait for the input ref to be attached
      let inputElement = null
      for (let i = 0; i < 50; i++) {
        if (locationSearchInputRef.current) {
          inputElement = locationSearchInputRef.current
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      if (!inputElement || cancelled) return


      const ok = await loadGoogleMaps()
      if (!ok || cancelled || !inputElement) return

      if (inputElement.hasAttribute("data-google-places-initialized")) return

      try {
        autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
          fields: ["formatted_address", "address_components", "geometry"],
          componentRestrictions: { country: "in" },
          types: ["geocode", "establishment"]
        })

        inputElement.setAttribute("data-google-places-initialized", "true")
        placesAutocompleteRef.current = autocomplete

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace()
          if (!place?.geometry) return

          applyResolvedLocation(parseGooglePlace(place))
          inputElement.blur()
        })

        const pacContainerFix = () => {
          const applyFix = () => {
            const containers = document.querySelectorAll(".pac-container")
            if (containers.length > 0) {
              containers.forEach((container) => {
                container.style.zIndex = "999999"
                container.style.pointerEvents = "auto"
                container.style.visibility = "visible"
                container.style.display = "block"
              })
            }
          }
          applyFix()
          setTimeout(applyFix, 100)
          setTimeout(applyFix, 300)
        }

        inputElement.addEventListener("focus", pacContainerFix)
        inputElement.addEventListener("input", pacContainerFix)
      } catch (e) {
        debugError("Autocomplete error:", e)
      }
    }

    init().catch(() => {})

    return () => {
      cancelled = true
      if (autocomplete) {
        try { window.google?.maps?.event?.clearInstanceListeners(autocomplete) } catch {}
      }
      if (locationSearchInputRef.current) {
        locationSearchInputRef.current.removeAttribute("data-google-places-initialized")
      }
      placesAutocompleteRef.current = null
    }
  }, [step])

  // Hybrid Search Fallback (Nominatim)
  useEffect(() => {
    if (step !== 1) return
    const q = String(locationSearchValue || "").trim()
    if (q.length < 3) {
      setLocationSuggestions([])
      setIsSearchingLocation(false)
      return
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingLocation(true)
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=4&q=${encodeURIComponent(q)}&countrycodes=in`
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        const json = await res.json()
        const mapped = (Array.isArray(json) ? json : []).map(r => ({
          id: r.place_id,
          display: r.display_name || "",
          lat: Number(r.lat),
          lng: Number(r.lon),
          addr: r.address || {},
        }))
        setLocationSuggestions(mapped)
      } catch (e) {
        debugError("Nominatim search failed:", e)
      } finally {
        setIsSearchingLocation(false)
      }
    }, 400)

    return () => clearTimeout(t)
  }, [locationSearchValue, step])

  // Load zones for onboarding dropdown (public endpoint).
  useEffect(() => {
    if (step !== 1) return
    let cancelled = false
    setZonesLoading(true)
    zoneAPI.getPublicZones()
      .then((res) => {
        const list = res?.data?.data?.zones || res?.data?.zones || []
        if (!cancelled) setZones(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })
    return () => { cancelled = true }
  }, [step])


  const renderStep2 = () => (
    <div className="space-y-6">
      {/* Images section */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        <h2 className="text-lg font-semibold text-black">Menu & photos</h2>
        <p className="text-xs text-gray-500">
          Add clear photos of your printed menu and a primary profile image. This helps customers
          understand what you serve.
        </p>

        {/* Menu images */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Menu images</Label>
          <div className="mt-1 border border-dashed border-gray-300 rounded-md bg-gray-50/70 px-4 py-3 flex items-center justify-between flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-white flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-gray-700" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload menu images</span>
                <span className="text-[11px] text-gray-500">
                  JPG, PNG, WebP ? You can select multiple files
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() =>
                openImageSourcePicker({
                  title: "Add menu image",
                  fileNamePrefix: "menu-image",
                  fallbackInputRef: menuImagesInputRef,
                  onSelectFile: (file) => handleMenuImagesSelected(file ? [file] : []),
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              id="menuImagesInput"
              type="file"
              multiple
              accept={LOCAL_IMAGE_FILE_ACCEPT}
              className="hidden"
              ref={menuImagesInputRef}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                if (!files.length) return
                debugLog('?? Menu images selected:', files.length, 'files')
                handleMenuImagesSelected(files)
                // Reset input to allow selecting same file again
                e.target.value = ''
              }}
            />
          </div>

          {/* Menu image previews */}
          {!!step2.menuImages.length && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {step2.menuImages.map((file, idx) => {
                // Handle both File objects and URL objects
                let imageUrl = null
                let imageName = `Image ${idx + 1}`

                if (isUploadableFile(file)) {
                  imageUrl = getPreviewImageUrl(file)
                  imageName = file.name || imageName
                } else if (file?.url) {
                  // If it's an object with url property (from backend)
                  imageUrl = file.url
                  imageName = file.name || `Image ${idx + 1}`
                } else if (typeof file === 'string') {
                  // If it's a direct URL string
                  imageUrl = file
                }

                return (
                  <div
                    key={idx}
                    className="relative aspect-4/5 rounded-md overflow-hidden bg-gray-100"
                  >
                    <div className="absolute top-1 right-1 z-30">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          await handleRemoveMenuImage(idx)
                        }}
                        className="bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {uploadingAttachments[`menuImages_${idx}`] && (
                      <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                      </div>
                    )}
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`Menu ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-500 px-2 text-center">
                        Preview unavailable
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1">
                      <p className="text-[10px] text-white truncate">
                        {imageName}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Profile image */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Restaurant profile image</Label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-200">
                {step2.profileImage ? (
                  (() => {
                    const imageSrc = getPreviewImageUrl(step2.profileImage)

                    return imageSrc ? (
                      <img
                        src={imageSrc}
                        alt="Restaurant profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-500" />
                    );
                  })()
                ) : (
                  <ImageIcon className="w-6 h-6 text-gray-500" />
                )}
                {uploadingAttachments.profileImage && (
                  <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                  </div>
                )}
              </div>
              {step2.profileImage && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await handleRemoveProfileImage()
                  }}
                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors z-10"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex-1 flex-col flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload profile image</span>
                <span className="text-[11px] text-gray-500">
                  This will be shown on your listing card and restaurant page.
                </span>
              </div>

            </div>

          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full text-xs"
            onClick={() =>
              openImageSourcePicker({
                title: "Upload profile image",
                fileNamePrefix: "profile-image",
                fallbackInputRef: profileImageInputRef,
                onSelectFile: handleProfileImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            id="profileImageInput"
            type="file"
            accept={LOCAL_IMAGE_FILE_ACCEPT}
            className="hidden"
            ref={profileImageInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (file) {
                debugLog('?? Profile image selected:', file.name)
                handleProfileImageSelected(file)
              }
              // Reset input to allow selecting same file again
              e.target.value = ''
            }}
          />
        </div>
      </section>

      {/* Operational details */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        {/* Timings with popover time selectors */}
        <div className="space-y-3">
          <Label className="text-xs text-gray-700">Outlet timings</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TimeSelector
              label="Opening time"
              value={step2.openingTime || ""}
              onChange={(val) => {
                const nextOpening = normalizeTimeValue(val) || ""
                const openingMinutes = timeStringToMinutes(nextOpening)
                const closingMinutes = timeStringToMinutes(step2.closingTime)
                if (openingMinutes !== null && closingMinutes !== null) {
                  if (openingMinutes === closingMinutes) {
                    toast.error("Opening time and closing time cannot be same")
                    return
                  }
                  if (closingMinutes < openingMinutes) {
                    toast.error("Closing time cannot be less than opening time")
                    return
                  }
                }
                setStep2((prev) => ({ ...prev, openingTime: nextOpening }))
              }}
            />
            <TimeSelector
              label="Closing time"
              value={step2.closingTime || ""}
              onChange={(val) => {
                const nextClosing = normalizeTimeValue(val) || ""
                const openingMinutes = timeStringToMinutes(step2.openingTime)
                const closingMinutes = timeStringToMinutes(nextClosing)
                if (openingMinutes !== null && closingMinutes !== null) {
                  if (openingMinutes === closingMinutes) {
                    toast.error("Opening time and closing time cannot be same")
                    return
                  }
                  if (closingMinutes < openingMinutes) {
                    toast.error("Closing time cannot be less than opening time")
                    return
                  }
                }
                setStep2((prev) => ({ ...prev, closingTime: nextClosing }))
              }}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Estimated delivery time*</Label>
            <Input
              value={step2.estimatedDeliveryTime || ""}
              onChange={(e) =>
                setStep2((prev) => ({ ...prev, estimatedDeliveryTime: e.target.value }))
              }
              className="mt-1 bg-white text-sm"
              placeholder="e.g., 25-30 mins"
            />
          </div>
        </div>

        {/* Open days in a calendar-like grid */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-gray-800" />
            <span>Open days</span>
          </Label>
          <p className="text-[11px] text-gray-500">
            Select the days your restaurant accepts delivery orders.
          </p>
          <div className="mt-1 grid grid-cols-7 gap-1.5 sm:gap-2">
            {daysOfWeek.map((day) => {
              const active = step2.openDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`aspect-square flex items-center justify-center rounded-md text-[11px] font-medium ${active ? "bg-black text-white" : "bg-gray-100 text-gray-800"
                    }`}
                >
                  {day.charAt(0)}
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">PAN details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-gray-700">PAN number</Label>
            <Input
              value={step3.panNumber || ""}
              onChange={(e) => {
                const normalized = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 10)
                setStep3({ ...step3, panNumber: normalized })
              }}
              className="mt-1 bg-white text-sm text-black placeholder-black"
              placeholder="ABCDE1234F"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">PAN Card Holder Name</Label>
            <Input
              value={step3.nameOnPan || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  nameOnPan: e.target.value.replace(/[^A-Za-z ]/g, ""),
                })
              }
              className="mt-1 bg-white text-sm text-black placeholder-black"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs text-gray-700">PAN image</Label>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full text-xs"
            onClick={() =>
              openImageSourcePicker({
                title: "Upload PAN image",
                fileNamePrefix: "pan-image",
                fallbackInputRef: panImageInputRef,
                onSelectFile: handlePanImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            type="file"
            accept={GALLERY_IMAGE_ACCEPT}
            className="hidden"
            ref={panImageInputRef}
            onChange={(e) => {
              handlePanImageSelected(e.target.files?.[0] || null)
              e.target.value = ""
            }}
          />
          {step3.panImage && (
            <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
              {getPreviewImageUrl(step3.panImage) ? (
                <img
                  src={getPreviewImageUrl(step3.panImage)}
                  alt="PAN document"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  Preview unavailable
                </div>
              )}
              {uploadingAttachments.panImage && (
                <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-4 border-white border-t-transparent"></div>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setStep3((prev) => ({ ...prev, panImage: null }))
                }}
                className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">GST details</h2>
        <div className="flex gap-4 items-center text-sm">
          <span className="text-gray-700">GST registered?</span>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: true })}
            className={`px-3 py-1.5 text-xs rounded-full ${step3.gstRegistered ? "bg-black text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: false })}
            className={`px-3 py-1.5 text-xs rounded-full ${!step3.gstRegistered ? "bg-black text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            No
          </button>
        </div>

        {/*
          "Do your menu prices include GST?" is no longer asked here: the admin
          sets it per restaurant, and the server ignores it on an application.
        */}
        {step3.gstRegistered && (
          <div className="space-y-3">
            <Input
              value={step3.gstNumber || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  gstNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15),
                })
              }
              className="bg-white text-sm"
              placeholder="GST number (15 characters)"
            />
            <Input
              value={step3.gstLegalName || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  gstLegalName: e.target.value.replace(/[^A-Za-z ]/g, ""),
                })
              }
              className="bg-white text-sm"
              placeholder="Legal name"
            />
            <Input
              value={step3.gstAddress || ""}
              onChange={(e) => setStep3({ ...step3, gstAddress: e.target.value })}
              className="bg-white text-sm"
              placeholder="Registered address"
            />
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() =>
                openImageSourcePicker({
                  title: "Upload GST image",
                  fileNamePrefix: "gst-image",
                  fallbackInputRef: gstImageInputRef,
                  onSelectFile: handleGstImageSelected,
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              type="file"
              accept={GALLERY_IMAGE_ACCEPT}
              className="hidden"
              ref={gstImageInputRef}
              onChange={(e) => {
                handleGstImageSelected(e.target.files?.[0] || null)
                e.target.value = ""
              }}
            />
            {step3.gstImage && (
              <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
                {getPreviewImageUrl(step3.gstImage) ? (
                  <img
                    src={getPreviewImageUrl(step3.gstImage)}
                    alt="GST document"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                    Preview unavailable
                  </div>
                )}
                {uploadingAttachments.gstImage && (
                  <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-4 border-white border-t-transparent"></div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setStep3((prev) => ({ ...prev, gstImage: null }))
                  }}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">FSSAI details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.fssaiNumber || ""}
            onChange={(e) =>
              setStep3({ ...step3, fssaiNumber: e.target.value.replace(/\D/g, "").slice(0, 14) })
            }
            className="bg-white text-sm"
            placeholder="FSSAI number (14 digits)"
          />
          <div>
            <Label className="text-xs text-gray-700 mb-1 block">FSSAI expiry date</Label>
            <Popover open={isFssaiCalendarOpen} onOpenChange={setIsFssaiCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsFssaiCalendarOpen(true)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md bg-white text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  <span className={step3.fssaiExpiry ? "text-gray-900" : "text-gray-500"}>
                    {step3.fssaiExpiry
                      ? parseLocalYMDDate(step3.fssaiExpiry)?.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                      : "Select expiry date"}
                  </span>
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-100" align="start">
                <div className="bg-white rounded-md shadow-lg border border-gray-200">
                  <Calendar
                    mode="single"
                    selected={parseLocalYMDDate(step3.fssaiExpiry)}
                    disabled={(date) => formatDateToLocalYMD(date) < getTodayLocalYMD()}
                    onSelect={(date) => {
                      if (date && formatDateToLocalYMD(date) >= getTodayLocalYMD()) {
                        const formattedDate = formatDateToLocalYMD(date)
                        setStep3({ ...step3, fssaiExpiry: formattedDate })
                        setIsFssaiCalendarOpen(false)
                      }
                    }}
                    initialFocus
                    classNames={{
                      today: "bg-transparent text-foreground border-none", // Remove today highlight
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full text-xs"
          onClick={() =>
            openImageSourcePicker({
              title: "Upload FSSAI image",
              fileNamePrefix: "fssai-image",
              fallbackInputRef: fssaiImageInputRef,
              onSelectFile: handleFssaiImageSelected,
            })
          }
        >
          <Upload className="w-4 h-4 mr-1.5" />
          Upload
        </Button>
        <input
          type="file"
          accept={GALLERY_IMAGE_ACCEPT}
          className="hidden"
          ref={fssaiImageInputRef}
          onChange={(e) => {
            handleFssaiImageSelected(e.target.files?.[0] || null)
            e.target.value = ""
          }}
        />
        {step3.fssaiImage && (
          <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
            {getPreviewImageUrl(step3.fssaiImage) ? (
              <img
                src={getPreviewImageUrl(step3.fssaiImage)}
                alt="FSSAI document"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                Preview unavailable
              </div>
            )}
            {uploadingAttachments.fssaiImage && (
              <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-white border-t-transparent"></div>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setStep3((prev) => ({ ...prev, fssaiImage: null }))
              }}
              className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Bank account details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.accountNumber || ""}
            onChange={(e) =>
              setStep3({ ...step3, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 18) })
            }
            className="bg-white text-sm"
            placeholder="Account number"
          />
          <Input
            value={step3.confirmAccountNumber || ""}
            onChange={(e) =>
              setStep3({
                ...step3,
                confirmAccountNumber: e.target.value.replace(/\D/g, "").slice(0, 18),
              })
            }
            className="bg-white text-sm"
            placeholder="Re-enter account number"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.ifscCode || ""}
            onChange={(e) =>
              setStep3({
                ...step3,
                ifscCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11),
              })
            }
            className="bg-white text-sm"
            placeholder="IFSC code"
          />
          <Select
            value={step3.accountType || ""}
            onValueChange={(value) => setStep3({ ...step3, accountType: value })}
          >
            <SelectTrigger className="bg-white text-sm">
              <SelectValue placeholder="Select account type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Saving">Saving</SelectItem>
              <SelectItem value="Current">Current</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          value={step3.accountHolderName || ""}
          onChange={(e) =>
            setStep3({
              ...step3,
              accountHolderName: e.target.value.replace(/[^A-Za-z ]/g, ""),
            })
          }
          className="bg-white text-sm"
          placeholder="Account holder name"
        />
      </section>
    </div>
  )

  const submitRegistration = async () => {
    setPaymentProcessing(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('restaurantName', step1.restaurantName || '')
      formData.append('pureVegRestaurant', step1.pureVegRestaurant === true ? 'true' : 'false')
      formData.append('ownerName', step1.ownerName || '')
      formData.append('ownerEmail', (step1.ownerEmail || '').trim())
      formData.append('ownerPhone', normalizePhoneDigits(step1.ownerPhone))
      formData.append('primaryContactNumber', normalizePhoneDigits(step1.primaryContactNumber))
      formData.append('zoneId', step1.zoneId || '')
      formData.append('addressLine1', step1.location?.addressLine1 || '')
      formData.append('addressLine2', step1.location?.addressLine2 || '')
      formData.append('area', step1.location?.area || '')
      formData.append('city', step1.location?.city || '')
      formData.append('state', step1.location?.state || '')
      formData.append('pincode', step1.location?.pincode || '')
      formData.append('landmark', step1.location?.landmark || '')
      formData.append('formattedAddress', step1.location?.formattedAddress || '')
      formData.append('latitude', String(step1.location?.latitude || ''))
      formData.append('longitude', String(step1.location?.longitude || ''))

      formData.append('cuisines', (step2.cuisines || []).join(','))
      formData.append('estimatedDeliveryTime', (step2.estimatedDeliveryTime || '').trim())
      formData.append('openingTime', normalizeTimeValue(step2.openingTime) || '')
      formData.append('closingTime', normalizeTimeValue(step2.closingTime) || '')
      formData.append('openDays', (step2.openDays || []).join(','))

      const menuImages = step2.menuImages || []
      const menuFiles = menuImages.filter((file) => isUploadableFile(file))
      const menuUrls = menuImages.map((file) => typeof file === 'string' ? file : (file?.url || null)).filter(Boolean)

      if (menuFiles.length === 0 && menuUrls.length === 0) {
        throw new Error('At least one menu image must be uploaded')
      }

      menuFiles.forEach((file) => formData.append('menuImages', file))
      if (menuUrls.length > 0) {
        formData.append('menuImages', JSON.stringify(menuUrls))
      }

      if (!step2.profileImage) {
        throw new Error('Restaurant profile image is required')
      }
      if (isUploadableFile(step2.profileImage)) {
        formData.append('profileImage', step2.profileImage)
      } else {
        formData.append('profileImage', typeof step2.profileImage === 'string' ? step2.profileImage : step2.profileImage.url)
      }

      formData.append('panNumber', step3.panNumber || '')
      formData.append('nameOnPan', step3.nameOnPan || '')
      if (!step3.panImage) {
        throw new Error('PAN image is required')
      }
      if (isUploadableFile(step3.panImage)) {
        formData.append('panImage', step3.panImage)
      } else {
        formData.append('panImage', typeof step3.panImage === 'string' ? step3.panImage : step3.panImage.url)
      }

      formData.append('gstRegistered', step3.gstRegistered ? 'true' : 'false')
      if (step3.gstRegistered) {
        formData.append('gstNumber', step3.gstNumber || '')
        formData.append('gstLegalName', step3.gstLegalName || '')
        formData.append('gstAddress', step3.gstAddress || '')
        if (!step3.gstImage) {
          throw new Error('GST image is required when GST registered')
        }
        if (isUploadableFile(step3.gstImage)) {
          formData.append('gstImage', step3.gstImage)
        } else {
          formData.append('gstImage', typeof step3.gstImage === 'string' ? step3.gstImage : step3.gstImage.url)
        }
      }

      formData.append('fssaiNumber', step3.fssaiNumber || '')
      formData.append('fssaiExpiry', step3.fssaiExpiry || '')
      if (!step3.fssaiImage) {
        throw new Error('FSSAI image is required')
      }
      if (isUploadableFile(step3.fssaiImage)) {
        formData.append('fssaiImage', step3.fssaiImage)
      } else {
        formData.append('fssaiImage', typeof step3.fssaiImage === 'string' ? step3.fssaiImage : step3.fssaiImage.url)
      }

      formData.append('accountNumber', step3.accountNumber || '')
      formData.append('ifscCode', (step3.ifscCode || '').toUpperCase())
      formData.append('accountHolderName', step3.accountHolderName || '')
      formData.append('accountType', step3.accountType || '')

      setRegistrationProcessing(true)

      const loadingToast = toast.loading('Submitting your restaurant registration...', {
        description: 'This might take a minute for high-resolution images.',
      })

      try {
        const registerPromise = restaurantAPI.register(formData)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Registration request timeout after 60s')), 60000)
        )

        await Promise.race([registerPromise, timeoutPromise])
        toast.dismiss(loadingToast)
        setRegistrationProcessing(false)
      } catch (registrationError) {
        toast.dismiss(loadingToast)
        setRegistrationProcessing(false)
        throw registrationError
      }

      const ownerPhoneForRedirect = normalizePhoneDigits(step1.ownerPhone)

      clearOnboardingFromLocalStorage()
      clearOnboardingFileCache()
      try {
        localStorage.setItem('restaurant_pendingPhone', ownerPhoneForRedirect)
      } catch (e) {
        console.error('Error saving phone to localStorage:', e)
      }

      toast.success('Registration submitted for approval.', { duration: 4000 })
      setPaymentProcessing(false)

      navigate('/food/restaurant/pending-verification', {
        replace: true,
        state: {
          phone: ownerPhoneForRedirect,
        },
      })
    } catch (err) {
      toast.dismiss()
      setRegistrationProcessing(false)
      setPaymentProcessing(false)
      const backendError = err?.response?.data?.message || err?.response?.data?.error || err?.message || 'Failed to submit registration'
      toast.error(backendError)
      setError(backendError)
    }
  }

  const renderStep = () => {
    if (step === 1) return renderStep1()
    if (step === 2) return renderStep2()
    if (step === 3) return renderStep3()
    return null
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <div className="min-h-screen bg-gray-100 flex flex-col">
        {registrationProcessing && (
          <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm px-6 text-center">
            <div className="bg-white p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4 max-w-sm">
              <div className="w-12 h-12 border-4 border-primary-orange/50 border-t-transparent rounded-full animate-spin"></div>
              <h3 className="text-xl font-bold text-gray-900">Processing Registration</h3>
              <p className="text-sm text-gray-600">
                We're uploading your documents & setting up your profile. This can take a minute for high resolution images.
              </p>
              <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                <div className="bg-primary-orange/50 h-full animate-[loading_2s_infinite]"></div>
              </div>
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-widest mt-2">
                Please do not refresh or close
              </p>
            </div>
          </div>
        )}
        <header className="px-4 py-4 sm:px-6 sm:py-5 bg-white flex items-center justify-between border-b">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/food/restaurant/explore")}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="Close onboarding"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
            <div className="text-sm font-semibold text-black">Restaurant onboarding</div>
          </div>
          <div className="flex items-center gap-3">
            {!loading && !isEditing && (
              <Button
                onClick={() => setIsEditing(true)}
                variant="outline"
                size="sm"
                className="text-xs bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 flex items-center gap-1.5"
                title="Edit Details"
              >
                <Sparkles className="w-3 h-3" />
                Edit Details
              </Button>
            )}
            <div className="flex items-center gap-3">
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider text-right">
                Step {step} of 3
              </div>
              <Button
                onClick={handleLogout}
                disabled={isLoggingOut}
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>

        </header>

        <main
          className="flex-1 px-4 sm:px-6 py-4 space-y-4"
          style={{ paddingBottom: keyboardInset ? `${keyboardInset + 20}px` : undefined }}
          onFocusCapture={(e) => {
            const target = e.target
            if (!(target instanceof HTMLElement)) return
            if (!target.matches("input, textarea, select")) return
            window.setTimeout(() => {
              target.scrollIntoView({ behavior: "smooth", block: "center" })
            }, 250)
          }}
        >
          {location.state?.isRejected && location.state?.rejectionReason && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <h3 className="text-red-800 font-bold text-sm mb-1 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Previous Registration Rejected
              </h3>
              <p className="text-red-600 text-sm">{location.state.rejectionReason}</p>
              <p className="text-red-500 text-xs mt-2 font-medium">Please correct these issues and submit again.</p>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-600">Loading...</p>
          ) : (
            <div className={!isEditing ? "pointer-events-none select-none" : ""}>
              {renderStep()}
            </div>
          )}
        </main>

        <ImageSourcePicker
          isOpen={sourcePicker.isOpen}
          onClose={closeImageSourcePicker}
          onFileSelect={sourcePicker.onSelectFile}
          title={sourcePicker.title}
          fileNamePrefix={sourcePicker.fileNamePrefix}
          galleryInputRef={sourcePicker.fallbackInputRef}
        />

        {error && (
          <div className="px-4 sm:px-6 pb-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <footer className={`px-4 sm:px-6 py-3 bg-white ${keyboardInset ? "hidden" : ""}`}>
          <div className="flex justify-between items-center">
            <Button
              variant="ghost"
              disabled={step === 1 || saving}
              onClick={() => { setStep((s) => Math.max(1, s - 1)); window.scrollTo({ top: 0, behavior: "instant" }) }}
              className="text-sm text-gray-700 bg-transparent"
            >
              Back
            </Button>
            <Button
              onClick={handleNext}
              disabled={saving || paymentProcessing || (step === 3 && !isEditing) || Object.values(uploadingAttachments).some(Boolean)}
              className={`text-sm bg-black text-white px-6 ${(saving || paymentProcessing || (step === 3 && !isEditing) || Object.values(uploadingAttachments).some(Boolean)) ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {Object.values(uploadingAttachments).some(Boolean) 
                ? "Uploading..." 
                : (step === 3 ? (paymentProcessing ? "Submitting..." : "Submit") : (saving ? "Saving..." : "Continue"))}
            </Button>
          </div>
        </footer>
      </div>
    </LocalizationProvider>
  )
}
