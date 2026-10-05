import { useState, useRef, useEffect, useMemo } from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  Trash2,
  Check,
  ChevronDown,
  Edit as EditIcon,
  Plus,
  X,
  Camera,
  ThumbsUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Clock,
  Package,
  Layers,
  Sparkles,
  Utensils,
  AlertCircle,
  IndianRupee,
  Sliders,
  Calendar
} from "lucide-react"
import { Switch } from "@food/components/ui/switch"
import ItemAvailabilityScheduleEditor, { buildScheduleState, isScheduleEmpty } from "@food/components/ItemAvailabilityScheduleEditor"
import api from "@food/api"
import { restaurantAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable } from "@food/utils/imageUploadUtils"
import { getStoredFoodVariants } from "@food/utils/foodVariants"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const INVENTORY_RECOMMENDED_KEY = "restaurant_inventory_recommended_map"

/**
 * The reason the server gave, in the server's own words.
 *
 * Both keys are checked because the API sends `message` on success-shaped
 * responses and the error handler sends both. Falling straight through to
 * error.message is what produced "Request failed with status code 400" on
 * screen -- that is axios describing the HTTP status, not the validation
 * reason the backend actually wrote for the user.
 */
const getServerMessage = (error, fallback = "Something went wrong. Please try again.") =>
  error?.response?.data?.message ||
  error?.response?.data?.error ||
  (error?.code === "ERR_NETWORK"
    ? "Cannot reach the server. Check your connection and try again."
    : "") ||
  fallback

const getUploadErrorMessage = (error, fileName = "image") =>
  `Could not upload ${fileName}: ${getServerMessage(error, "Please try again.")}`

const createVariantDraft = (variant = {}) => ({
  localId: String(variant?.id || variant?._id || `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  persistedId: String(variant?.id || variant?._id || ""),
  name: String(variant?.name || ""),
  /*
   * The BASE price, which is the number a restaurant sets and the only one it
   * can edit. `price` on the server is what a customer pays after the platform's
   * global adjustment, and showing that here was confusing: a size set to 120
   * with 10% off displayed as 108, so it looked as though the price had been
   * changed behind their back.
   */
  price: variant?.basePrice != null ? String(variant.basePrice) : (variant?.price != null ? String(variant.price) : ""),
  /** What a customer currently pays for this size, for the note under the field. */
  customerPrice: variant?.price != null ? Number(variant.price) : null,
  /** The base as loaded, so the adjustment percent can be derived and held while
   *  a new base is typed. */
  basePriceAtLoad: variant?.basePrice != null ? Number(variant.basePrice) : null,
  /** The size's struck-through comparison, when a markup stands. */
  strikePrice: variant?.strikePrice != null ? Number(variant.strikePrice) : null,
  // Per-size order limits. Blank means "not set for this size", which is not the
  // same as zero -- the dish's own limit then applies.
  minOrderQuantity: variant?.minOrderQuantity != null ? String(variant.minOrderQuantity) : "",
  maxOrderQuantity: variant?.maxOrderQuantity != null ? String(variant.maxOrderQuantity) : "",
  addonIds: Array.isArray(variant?.addonIds) ? variant.addonIds.map(String) : [],
  // Units on hand for this size (stores only). Blank = not counted, no limit.
  stockQty: variant?.stockQty != null ? String(variant.stockQty) : "",
  lowStockThreshold: variant?.lowStockThreshold != null ? String(variant.lowStockThreshold) : "",
  // As loaded. Only a count the owner changed is sent, so a form left open
  // while orders come in does not put back the units those orders took.
  stockQtyAtLoad: variant?.stockQty != null ? String(variant.stockQty) : "",
  lowStockAtLoad: variant?.lowStockThreshold != null ? String(variant.lowStockThreshold) : "",
  // Price each pairing charges on THIS size, keyed by addon id. Empty string
  // means "the add-on's own price" -- the server stores that as null.
  addonPrices: Object.fromEntries(
    (Array.isArray(variant?.addons) ? variant.addons : [])
      .filter((pair) => pair?.addonId && pair?.price !== null && pair?.price !== undefined)
      .map((pair) => [String(pair.addonId), String(pair.price)])
  ),
})

export default function ItemDetailsPage() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const { id } = useParams()
  const location = useLocation()
  const isNewItem = id === "new"
  const defaultCategory = location.state?.category || "Select category"
  const defaultCategoryId = location.state?.categoryId || ""
  const fileInputRef = useRef(null)

  // Initialize state
  const [itemData, setItemData] = useState(null)
  const [itemName, setItemName] = useState("")
  const [category, setCategory] = useState(defaultCategory)
  const [selectedCategoryId, setSelectedCategoryId] = useState(defaultCategoryId)
  const [subCategory, setSubCategory] = useState("")
  const [servesInfo, setServesInfo] = useState("")
  const [itemSizeQuantity, setItemSizeQuantity] = useState("")
  const [itemSizeUnit, setItemSizeUnit] = useState("piece")
  const [itemDescription, setItemDescription] = useState("")
  const [foodType, setFoodType] = useState("Non-Veg")
  const [basePrice, setBasePrice] = useState("")
  // Whether this dish sells by its variants. Off keeps them stored -- the
  // editor stays visible so nothing looks lost -- but the base price is what
  // customers are charged.
  const [variantsEnabled, setVariantsEnabled] = useState(false)
  const [commission, setCommission] = useState(null)
  /*
   * How this restaurant's prices are taxed. Without it the preview below
   * would tell a GST-inclusive restaurant it earns the whole price, when
   * the tax inside that price is never theirs to keep.
   */
  const [taxSettings, setTaxSettings] = useState({ priceIncludesGst: false, gstRate: 0 })
  const [addonIds, setAddonIds] = useState([])
  // "Goes well with": other dishes of this restaurant shown beside this one.
  const [suggestedItemIds, setSuggestedItemIds] = useState([])
  const [pairingOptions, setPairingOptions] = useState([])
  const [availableAddons, setAvailableAddons] = useState([])
  const [variants, setVariants] = useState([])
  const [preparationTime, setPreparationTime] = useState("")
  const [minOrderQuantity, setMinOrderQuantity] = useState("0")
  const [maxOrderQuantity, setMaxOrderQuantity] = useState("0")
  /*
   * Stock, for stores and medical stores (quick commerce) only: restaurants sell
   * dishes, which are not counted. Blank = not counted, sells without a limit.
   * A product with sizes counts each size instead (the size rows below).
   */
  const isQcStore = (() => {
    try { return localStorage.getItem("restaurant_vertical") === "qc" } catch { return false }
  })()
  const [stockQty, setStockQty] = useState("")
  const [lowStockThreshold, setLowStockThreshold] = useState("")
  const stockAtLoad = useRef({ stock: "", low: "" })
  /*
   * "inherit" | "inclusive" | "exclusive".
   *
   * "inherit" is a real answer, not a missing one: the dish follows whatever
   * the restaurant has set, so a restaurant pricing its whole menu one way
   * changes it in one place rather than on every dish.
   */
  const [gstMode, setGstMode] = useState("inherit")
  const [packagingEnabled, setPackagingEnabled] = useState(false)
  const [packagingAmount, setPackagingAmount] = useState("")
  const [availabilitySchedule, setAvailabilitySchedule] = useState(() => buildScheduleState(null))
  const [isRecommended, setIsRecommended] = useState(false)

  /**
   * Field-keyed validation errors, shown inline at the field instead of as a
   * chain of toasts. Keys: name, category, schedule, basePrice, variants,
   * v-<localId>-name / -price, v-<localId>-addon-<addonId>, minQty, maxQty,
   * packaging. Cleared per field as the user edits it.
   */
  const [formErrors, setFormErrors] = useState({})
  const clearError = (key) =>
    setFormErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  const FieldError = ({ field }) =>
    formErrors[field] ? (
      <p className="mt-1 text-xs font-semibold text-red-600">{formErrors[field]}</p>
    ) : null
  const errRing = (field) => (formErrors[field] ? " border-red-400 ring-2 ring-red-300" : "")

  /**
   * Everything checkable without a network call, in one pass, run BEFORE any
   * image uploads -- it used to run after them, so a missing name cost a full
   * upload round-trip to discover. Returns { errors, anchors }: anchors are the
   * data-err hooks to scroll to, in severity order.
   */
  const validateForm = () => {
    const errors = {}
    const anchors = []
    const fail = (key, message, anchor) => {
      errors[key] = message
      anchors.push(anchor || key)
    }

    if (!itemName.trim()) fail("name", "Give the dish a name")
    else if (itemName.trim().length > 200) fail("name", "Name is too long (200 characters max)")

    const matchedCategory = Array.isArray(categories)
      ? categories.find((c) => String(c?.id || "") === String(selectedCategoryId || ""))
      : null
    if (!matchedCategory) fail("category", "Pick an approved category")
    else if (
      matchedCategory.foodTypeScope &&
      matchedCategory.foodTypeScope !== "Both" &&
      matchedCategory.foodTypeScope !== foodType
    ) {
      fail("category", `This ${matchedCategory.foodTypeScope} category cannot accept ${foodType} food`)
    }

    if (isScheduleEmpty(availabilitySchedule)) {
      fail("schedule", "Turn on at least one day, or switch the schedule off")
    }

    if (variantsEnabled) {
      const live = variants.filter(
        (v) => String(v.name || "").trim() || String(v.price || "").trim() || v.persistedId,
      )
      if (live.length === 0) fail("variants", "Add at least one variant, or switch variants off")

      const seenNames = new Set()
      for (const v of live) {
        const name = String(v.name || "").trim()
        if (!name) fail(`v-${v.localId}-name`, "Name this variant", `v-${v.localId}`)
        else if (seenNames.has(name.toLowerCase()))
          fail(`v-${v.localId}-name`, `"${name}" is used twice`, `v-${v.localId}`)
        else seenNames.add(name.toLowerCase())

        const price = Number(v.price)
        if (!Number.isFinite(price) || price <= 0)
          fail(`v-${v.localId}-price`, "Price must be above 0", `v-${v.localId}`)

        for (const addonId of v.addonIds || []) {
          const raw = (v.addonPrices || {})[addonId]
          if (raw === undefined || raw === "") continue
          const pairPrice = Number(raw)
          if (!Number.isFinite(pairPrice) || pairPrice < 0)
            fail(`v-${v.localId}-addon-${addonId}`, "Add-on price must be 0 or more", `v-${v.localId}`)
        }
      }
    } else {
      const price = Number(basePrice)
      if (!Number.isFinite(price) || price <= 0) fail("basePrice", "Enter a price above 0")
    }

    // 0 means "no minimum", the same thing 0 already means for the cap. A
    // customer still cannot order zero of something -- the server turns a stored
    // 0 into an effective minimum of 1.
    const minQty = Number(minOrderQuantity)
    if (!Number.isInteger(minQty) || minQty < 0) fail("minQty", "Use 0 for no minimum, or a whole number")
    const maxQty = Number(maxOrderQuantity)
    if (!Number.isInteger(maxQty) || maxQty < 0) fail("maxQty", "Use 0 for no cap, or a whole number")
    else if (maxQty !== 0 && minQty !== 0 && Number.isInteger(minQty) && maxQty < minQty)
      fail("maxQty", `Cap cannot be below the minimum of ${minQty}`)

    if (packagingEnabled) {
      const amount = Number(packagingAmount)
      if (!Number.isFinite(amount) || amount <= 0)
        fail("packaging", "Enter a packaging charge above 0, or switch it off")
    }

    return { errors, anchors }
  }
  const [isInStock, setIsInStock] = useState(true)
  const [weightPerServing, setWeightPerServing] = useState("")
  const [calorieCount, setCalorieCount] = useState("")
  const [proteinCount, setProteinCount] = useState("")
  const [carbohydrates, setCarbohydrates] = useState("")
  const [fatCount, setFatCount] = useState("")
  const [fibreCount, setFibreCount] = useState("")
  const [allergens, setAllergens] = useState("")
  const [selectedTags, setSelectedTags] = useState([])
  const [images, setImages] = useState([])
  const [imageFiles, setImageFiles] = useState(new Map())
  const [uploadingImages, setUploadingImages] = useState(false)
  const [isPhotoPickerOpen, setIsPhotoPickerOpen] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [touchStart, setTouchStart] = useState(null)
  const [touchEnd, setTouchEnd] = useState(null)
  const [direction, setDirection] = useState(0)
  const carouselRef = useRef(null)
  const [isCategoryPopupOpen, setIsCategoryPopupOpen] = useState(false)
  const [categorySearchQuery, setCategorySearchQuery] = useState("")
  const [categories, setCategories] = useState([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [loadingItem, setLoadingItem] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)

  const maxNameLength = 70
  const maxDescriptionLength = 1000
  const descriptionLength = itemDescription.length
  const minDescriptionLength = 5
  const nameLength = itemName.length
  const currentApprovalStatus = String(itemData?.approvalStatus || "").toLowerCase()
  const currentRejectionReason = String(itemData?.rejectionReason || "").trim()

  const populateFormFromItem = (item = {}) => {
    setItemData(item)

    setItemName(item.name || "")
    setCategory(item.category || item.categoryName || defaultCategory)
    setSelectedCategoryId(item.categoryId || "")
    setSubCategory(item.subCategory || item.category || item.categoryName || "Starters")
    setServesInfo(item.servesInfo || "")
    setItemSizeQuantity(item.itemSizeQuantity || "")
    setItemSizeUnit(item.itemSizeUnit || "piece")
    setItemDescription(item.description || "")
    setFoodType(item.foodType === "Veg" ? "Veg" : "Non-Veg")
    // Stored accessor on purpose: the editor must show variants even while
    // the toggle is off, or the next save would wipe them.
    const itemVariants = getStoredFoodVariants(item)
    setVariants(itemVariants.map(createVariantDraft))
    setBasePrice(
      itemVariants.length === 0
        ? String(item.basePrice ?? item.price ?? "")
        : ""
    )
    // Absent flag on old rows means "sell by variants if any exist".
    setVariantsEnabled(item.variantsEnabled === true || (item.variantsEnabled == null && itemVariants.length > 0))
    setAddonIds(Array.isArray(item.addonIds) ? item.addonIds.map(String) : [])
    setSuggestedItemIds(Array.isArray(item.suggestedItemIds) ? item.suggestedItemIds.map(String) : [])
    setPreparationTime(item.preparationTime || "")
    setMinOrderQuantity(String(item.minOrderQuantity ?? 0))
    setMaxOrderQuantity(String(item.maxOrderQuantity ?? 0))
    setStockQty(item.stockQty != null ? String(item.stockQty) : "")
    setLowStockThreshold(item.lowStockThreshold != null ? String(item.lowStockThreshold) : "")
    stockAtLoad.current = {
      stock: item.stockQty != null ? String(item.stockQty) : "",
      low: item.lowStockThreshold != null ? String(item.lowStockThreshold) : "",
    }
    setAvailabilitySchedule(buildScheduleState(item.availabilitySchedule))
    // null means the dish never answered and follows the restaurant.
    setGstMode(
      item.priceIncludesGst === true
        ? "inclusive"
        : item.priceIncludesGst === false
          ? "exclusive"
          : "inherit"
    )
    setPackagingEnabled(item.packagingCharge?.isEnabled === true)
    setPackagingAmount(
      item.packagingCharge?.amount ? String(item.packagingCharge.amount) : ""
    )
    setIsRecommended(item.isRecommended || false)
    setIsInStock(item.isAvailable !== false)
    setSelectedTags(item.tags || [])

    const existingImages = Array.isArray(item.images) && item.images.length > 0
      ? item.images.filter(Boolean)
      : (item.image ? [item.image] : [])
    setImages(existingImages)

    setWeightPerServing("")
    setCalorieCount("")
    setProteinCount("")
    setCarbohydrates("")
    setFatCount("")
    setFibreCount("")
    setAllergens("")

    if (item.nutrition && Array.isArray(item.nutrition)) {
      item.nutrition.forEach(nut => {
        if (typeof nut === 'string') {
          if (nut.includes('Weight per serving')) {
            const match = nut.match(/(\d+)\s*grams?/i)
            if (match) setWeightPerServing(match[1])
          } else if (nut.includes('Calorie count')) {
            const match = nut.match(/(\d+)\s*Kcal/i)
            if (match) setCalorieCount(match[1])
          } else if (nut.includes('Protein count')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setProteinCount(match[1])
          } else if (nut.includes('Carbohydrates')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setCarbohydrates(match[1])
          } else if (nut.includes('Fat count')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setFatCount(match[1])
          } else if (nut.includes('Fibre count')) {
            const match = nut.match(/(\d+)\s*mg/i)
            if (match) setFibreCount(match[1])
          }
        }
      })
    }

    if (item.allergies && Array.isArray(item.allergies) && item.allergies.length > 0) {
      setAllergens(item.allergies.join(", "))
    }
  }

  // Every other dish on the menu, for the "goes well with" picker. Loaded for
  // new items too, which the edit fetch below skips.
  useEffect(() => {
    let cancelled = false
    restaurantAPI.getMenu()
      .then((res) => {
        if (cancelled) return
        const sections = res?.data?.data?.menu?.sections || []
        const all = sections.flatMap((s) => [
          ...(s.items || []),
          ...(s.subsections || []).flatMap((sub) => sub.items || []),
        ])
        const self = String(id || "")
        const seen = new Set()
        setPairingOptions(
          all
            .map((i) => ({ id: String(i.id || i._id || ""), name: i.name || "Item", price: i.price, foodType: i.foodType }))
            .filter((i) => i.id && i.id !== self && !seen.has(i.id) && seen.add(i.id))
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [id])

  // Fetch item data from menu API when editing
  useEffect(() => {
    const fetchItemData = async () => {
      if (location.state?.item) {
        populateFormFromItem(location.state.item)
      }

      if (!isNewItem && id) {
        try {
          setLoadingItem(true)
          const menuResponse = await restaurantAPI.getMenu()
          const menu = menuResponse.data?.data?.menu
          const sections = menu?.sections || []

          let foundItem = null
          const searchId = String(id).trim()
          for (const section of sections) {
            const item = section.items?.find(i => {
              const itemId = String(i.id || i._id || '').trim()
              return itemId === searchId || itemId === id
            })
            if (item) {
              foundItem = item
              break
            }
            if (section.subsections) {
              for (const subsection of section.subsections) {
                const subItem = subsection.items?.find(i => {
                  const itemId = String(i.id || i._id || '').trim()
                  return itemId === searchId || itemId === id
                })
                if (subItem) {
                  foundItem = subItem
                  break
                }
              }
              if (foundItem) break
            }
          }

          if (foundItem) {
            populateFormFromItem(foundItem)
          } else {
            toast.error("Item not found")
          }
        } catch (error) {
          debugError('Error fetching item data:', error)
          toast.error("Failed to load item data")
        } finally {
          setLoadingItem(false)
        }
      }
    }

    fetchItemData()
  }, [id, isNewItem, location.state, defaultCategory])

  // Fetch categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setLoadingCategories(true)
        const response = await restaurantAPI.getCategories()
        if (response.data.success && response.data.data.categories) {
          const formattedCategories = response.data.data.categories.map(cat => ({
            id: cat._id || cat.id,
            name: cat.name,
            foodTypeScope: cat.foodTypeScope || "Both",
          }))

          debugLog('Formatted restaurant categories:', formattedCategories)
          setCategories(formattedCategories)
          if (!selectedCategoryId && formattedCategories.length > 0) {
            const preferredName = String(category || defaultCategory || "").trim()
            const matchedByName = formattedCategories.find((cat) => cat.name === preferredName)
            const nextCategory = matchedByName || (isNewItem ? formattedCategories[0] : null)
            if (nextCategory) {
              setSelectedCategoryId(nextCategory.id)
              setCategory(nextCategory.name)
            }
          }
        } else {
          setCategories([])
        }
      } catch (error) {
        debugError('Error fetching restaurant categories:', error)
        setCategories([])
      } finally {
        setLoadingCategories(false)
      }
    }

    fetchCategories()
  }, [category, defaultCategory, defaultCategoryId, isNewItem, selectedCategoryId])

  // Fetch add-ons
  useEffect(() => {
    let cancelled = false
    const fetchAddons = async () => {
      try {
        const response = await restaurantAPI.getAddons()
        const list =
          response?.data?.data?.addons ||
          response?.data?.addons ||
          response?.data?.data ||
          []
        if (!cancelled) setAvailableAddons(Array.isArray(list) ? list : [])
      } catch (error) {
        debugError('Error fetching add-ons:', error)
        if (!cancelled) setAvailableAddons([])
      }
    }
    fetchAddons()
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch commission
  useEffect(() => {
    let cancelled = false
    const fetchCommission = async () => {
      try {
        const response = await restaurantAPI.getCommission()
        const data = response?.data?.data || response?.data || null
        if (!cancelled && data && data.commissionValue !== undefined) {
          setCommission({
            type: data.commissionType === 'flat' ? 'flat' : 'percentage',
            value: Number(data.commissionValue) || 0,
            label: data.commissionLabel || '',
          })
        }
      } catch (error) {
        debugError('Error fetching commission rate:', error)
        if (!cancelled) setCommission(null)
      }
    }
    fetchCommission()

    const fetchTaxSettings = async () => {
      try {
        const response = await restaurantAPI.getTaxSettings()
        const data = response?.data?.data || response?.data || null
        if (!cancelled && data) {
          setTaxSettings({
            priceIncludesGst: data.priceIncludesGst === true,
            gstRate: Number(data.gstRate) || 0,
          })
        }
      } catch (error) {
        // The preview falls back to prices-are-net, which is the default and
        // what almost every restaurant is on.
        debugError('Error fetching tax settings:', error)
      }
    }
    fetchTaxSettings()

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * What the customer will see and what the restaurant keeps. The comparison
   * strikethrough is gone from this panel on purpose: the other-platform
   * figure is admin-owned now, so previewing it here would show the restaurant
   * a number it cannot edit.
   */
  const pricePreview = useMemo(() => {
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

    const price = variantsEnabled
      ? variants.reduce((lo, v) => {
          const value = Number(v.price)
          return Number.isFinite(value) && value > 0 ? Math.min(lo, value) : lo
        }, Infinity)
      : Number(basePrice)

    if (!Number.isFinite(price) || price <= 0) return null

    /*
     * What the restaurant actually earns before commission, and what the
     * customer pays for the dish.
     *
     * Inclusive: the typed price is the whole price and the tax comes out of
     * it -- 5% inside 200 is 9.52, not 10 -- so the restaurant earns 190.48 and
     * the customer still pays 200. Exclusive: the typed price is net, the tax
     * is added on top, and the customer pays 210. Commission is charged on the
     * net either way, because tax collected for the government was never the
     * restaurant's money to take a cut of.
     */
    const gstFraction = Math.max(0, Number(taxSettings.gstRate) || 0) / 100
    // The dish's own answer wins; "inherit" falls back to the restaurant's.
    const includesGst = gstMode === "inclusive"
      ? true
      : gstMode === "exclusive"
        ? false
        : taxSettings.priceIncludesGst === true
    const netPrice = includesGst ? price / (1 + gstFraction) : price
    const gstAmount = includesGst ? price - netPrice : price * gstFraction
    const customerPays = round2(netPrice + gstAmount)

    const commissionAmount =
      commission === null
        ? 0
        : commission.type === 'flat'
          ? round2(Math.min(commission.value, netPrice))
          : round2((netPrice * commission.value) / 100)

    return {
      price: round2(price),
      netPrice: round2(netPrice),
      gstAmount: round2(gstAmount),
      gstRate: Number(taxSettings.gstRate) || 0,
      priceIncludesGst: includesGst,
      customerPays,
      commissionAmount,
      takeHome: round2(netPrice - commissionAmount),
      commissionLabel:
        commission === null
          ? ''
          : commission.type === 'flat'
            ? `\u20B9${commission.value}`
            : `${commission.value}%`,
    }
  }, [variants, basePrice, variantsEnabled, commission, taxSettings, gstMode])

  // Track visual viewport for mobile keyboard
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const updateKeyboardInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setKeyboardInset(inset > 60 ? inset : 0)
    }

    viewport.addEventListener("resize", updateKeyboardInset)
    viewport.addEventListener("scroll", updateKeyboardInset)
    updateKeyboardInset()

    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset)
      viewport.removeEventListener("scroll", updateKeyboardInset)
    }
  }, [])

  const handleImageAdd = (file) => {
    if (!file) return
    const previewUrl = URL.createObjectURL(file)

    images.forEach((img) => {
      if (img && img.startsWith('blob:')) {
        URL.revokeObjectURL(img)
      }
    })

    const newImageFilesMap = new Map()
    newImageFilesMap.set(previewUrl, file)

    setImages([previewUrl])
    setImageFiles(newImageFilesMap)
    setCurrentImageIndex(0)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleCameraClick = () => {
    if (isFlutterBridgeAvailable()) {
      setIsPhotoPickerOpen(true)
    } else {
      fileInputRef.current?.click()
    }
  }

  const handleImageDelete = (index) => {
    if (index < 0 || index >= images.length) return
    if (!window.confirm('Are you sure you want to delete this image?')) return

    const imageToDelete = images[index]
    const newImages = images.filter((_, i) => i !== index)
    const newImageFilesMap = new Map(imageFiles)

    if (imageToDelete && imageToDelete.startsWith('blob:')) {
      newImageFilesMap.delete(imageToDelete)
      URL.revokeObjectURL(imageToDelete)
    } else if (imageToDelete && (imageToDelete.startsWith('http://') || imageToDelete.startsWith('https://'))) {
      for (const [previewUrl] of newImageFilesMap.entries()) {
        if (previewUrl === imageToDelete) {
          newImageFilesMap.delete(previewUrl)
          URL.revokeObjectURL(previewUrl)
        }
      }
    }

    setImages(newImages)
    setImageFiles(newImageFilesMap)

    if (newImages.length === 0) {
      setCurrentImageIndex(0)
    } else if (currentImageIndex >= newImages.length) {
      setCurrentImageIndex(newImages.length - 1)
    }

    toast.success('Image deleted successfully')
  }

  const minSwipeDistance = 50

  const onTouchStart = (e) => {
    setTouchEnd(null)
    setTouchStart(e.targetTouches[0].clientX)
  }

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX)
  }

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return
    const distance = touchStart - touchEnd
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance

    if (isLeftSwipe && images.length > 0) {
      setDirection(1)
      setCurrentImageIndex((prev) => (prev + 1) % images.length)
    }
    if (isRightSwipe && images.length > 0) {
      setDirection(-1)
      setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
    }
  }

  const goToNext = () => {
    setDirection(1)
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const goToPrevious = () => {
    setDirection(-1)
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  const handleCategorySelect = (catId, catName) => {
    const selectedCategory = categories.find(c => c.id === catId)
    setSelectedCategoryId(selectedCategory?.id || "")
    setCategory(selectedCategory?.name || catName || "")
    setSubCategory(catName || selectedCategory?.name || "")
    setIsCategoryPopupOpen(false)
  }

  const handleSave = async () => {
    // Validate everything first: an invalid form must cost zero uploads.
    const { errors: validationErrors, anchors } = validateForm()
    setFormErrors(validationErrors)
    if (anchors.length > 0) {
      toast.error("Please fix the highlighted fields")
      if (validationErrors.category) setIsCategoryPopupOpen(true)
      document
        .querySelector(`[data-err="${anchors[0]}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }

    try {
      setUploadingImages(true)
      const uploadedImageUrls = []
      // Keep already-saved images. `/uploads/...` counts: images now live on our
      // own disk and are stored as a site-relative path, so an http-only test
      // would discard the dish's photo on every unrelated edit. blob:/data: are
      // in-browser previews of files not yet uploaded and must not be persisted.
      const existingImageUrls = images.filter(img =>
        typeof img === 'string' &&
        (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/uploads/'))
      )

      const filesToUpload = Array.from(imageFiles.values())
      if (filesToUpload.length > 0) {
        toast.info(`Uploading ${filesToUpload.length} image(s)...`)
        for (let i = 0; i < filesToUpload.length; i++) {
          const file = filesToUpload[i]
          try {
            let uploadResponse
            try {
              uploadResponse = await uploadAPI.uploadMedia(file, {
                folder: 'restaurant/menu-items'
              })
            } catch (folderUploadError) {
              debugWarn(`Retrying upload without folder for ${file.name}:`, folderUploadError)
              uploadResponse = await uploadAPI.uploadMedia(file)
            }
            const imageUrl = uploadResponse?.data?.data?.url || uploadResponse?.data?.url
            if (imageUrl) {
              uploadedImageUrls.push(imageUrl)
            } else {
              throw new Error("Failed to get uploaded image URL")
            }
          } catch (uploadError) {
            debugError(`Error uploading image:`, uploadError)
            toast.error(getUploadErrorMessage(uploadError, file.name))
            setUploadingImages(false)
            return
          }
        }
      }

      const allImageUrls = [
        ...existingImageUrls,
        ...uploadedImageUrls
      ].filter((url, index, self) =>
        url &&
        typeof url === 'string' &&
        url.trim() !== '' &&
        self.indexOf(url) === index
      ).slice(0, 1)

      const matchedCategory = Array.isArray(categories)
        ? categories.find((c) => String(c?.id || "") === String(selectedCategoryId || ""))
        : null
      const categoryId = matchedCategory?.id || matchedCategory?._id || null
      const categoryName = matchedCategory?.name || category || ""

      // Category validity was proven by validateForm before any upload ran.

      const normalizedVariants = variants
        .map((variant) => ({
          persistedId: String(variant.persistedId || "").trim(),
          name: String(variant.name || "").trim(),
          price: Number(variant.price),
          minOrderQuantity: variant.minOrderQuantity ?? "",
          maxOrderQuantity: variant.maxOrderQuantity ?? "",
          addonIds: Array.isArray(variant.addonIds) ? variant.addonIds : [],
          addonPrices: variant.addonPrices || {},
          stockQty: variant.stockQty ?? "",
          lowStockThreshold: variant.lowStockThreshold ?? "",
          stockChanged: (variant.stockQty ?? "") !== (variant.stockQtyAtLoad ?? ""),
          lowChanged: (variant.lowStockThreshold ?? "") !== (variant.lowStockAtLoad ?? ""),
        }))
        .filter((variant) => variant.name || variant.persistedId || variant.price)

      const hasVariants = variantsEnabled
      const parsedBasePrice = Number(basePrice)

      const variantPayload = normalizedVariants.map((variant) => ({
        ...(variant.persistedId ? { _id: variant.persistedId } : {}),
        name: variant.name,
        // Both, deliberately: `price` is what the server validates, `basePrice`
        // is what this field actually holds. The server derives the charged
        // price back from the base and the dish's standing discount.
        price: variant.price,
        basePrice: variant.price,
        // Blank goes as null, meaning "this size sets none" -- the dish's limit
        // then applies. Sending 0 for a minimum would be a different claim.
        minOrderQuantity:
          variant.minOrderQuantity === "" || variant.minOrderQuantity == null
            ? null
            : Number(variant.minOrderQuantity),
        maxOrderQuantity:
          variant.maxOrderQuantity === "" || variant.maxOrderQuantity == null
            ? null
            : Number(variant.maxOrderQuantity),
        // Priced pairings: the source of truth the server stores. A blank price
        // means the add-on's own, sent as null.
        addons: (variant.addonIds || []).map((addonId) => {
          const raw = (variant.addonPrices || {})[addonId]
          const price = raw === undefined || raw === "" ? null : Number(raw)
          return { addonId, price: Number.isFinite(price) ? price : null }
        }),
        // Stores only. Blank = not counted. Restaurants send nothing, so the
        // server keeps whatever a size already had.
        ...(isQcStore && variant.stockChanged
          ? { stockQty: variant.stockQty === "" ? null : Number(variant.stockQty) }
          : {}),
        ...(isQcStore && variant.lowChanged
          ? { lowStockThreshold: variant.lowStockThreshold === "" ? null : Number(variant.lowStockThreshold) }
          : {}),
      }))

      // Product-level stock: stores only, and only for a product without sizes.
      const stockPayload = isQcStore && !hasVariants
        ? {
            ...(stockQty !== stockAtLoad.current.stock ? { stockQty: stockQty === "" ? null : Number(stockQty) } : {}),
            ...(lowStockThreshold !== stockAtLoad.current.low
              ? { lowStockThreshold: lowStockThreshold === "" ? null : Number(lowStockThreshold) }
              : {}),
          }
        : {}

      const orderRulesPayload = {
        /*
         * Not `|| 1`. That turned a typed 0 straight back into 1, so the field
         * could never hold "no minimum" however it was validated or displayed.
         */
        minOrderQuantity: Number.isFinite(Number(minOrderQuantity)) ? Number(minOrderQuantity) : 0,
        maxOrderQuantity: Number(maxOrderQuantity) || 0,
        packagingCharge: {
          isEnabled: packagingEnabled,
          amount: Number(packagingAmount) || 0,
        },
        // Omitted entirely on "inherit", so the dish keeps deferring to the
        // restaurant rather than being pinned to whatever it resolves to today.
        ...(gstMode === "inherit" ? {} : { priceIncludesGst: gstMode === "inclusive" }),
        availabilitySchedule,
        discountPercent: 0,
        variantsEnabled,
        addonIds,
        suggestedItemIds,
      }

      let itemId
      if (isNewItem) {
        const createRes = await restaurantAPI.createFood({
          name: itemName.trim(),
          description: itemDescription.trim(),
          basePrice: hasVariants ? undefined : parsedBasePrice,
          variants: variantPayload,
          image: allImageUrls.length > 0 ? allImageUrls[0] : "",
          foodType: foodType,
          isAvailable: isInStock,
          isRecommended,
          preparationTime: preparationTime || "",
          ...orderRulesPayload,
          ...stockPayload,
          categoryId: categoryId || undefined,
          categoryName,
        })
        const created = createRes?.data?.data?.food || createRes?.data?.food
        itemId = String(created?._id || created?.id || "")
        if (!itemId) {
          throw new Error("Failed to create item in database")
        }
      } else {
        itemId = String(itemData?.id || id || "")
        if (!itemId) {
          throw new Error("Invalid item id")
        }
        await restaurantAPI.updateFood(itemId, {
          name: itemName.trim(),
          description: itemDescription.trim(),
          basePrice: hasVariants ? undefined : parsedBasePrice,
          variants: variantPayload,
          image: allImageUrls.length > 0 ? allImageUrls[0] : "",
          foodType: foodType,
          isAvailable: isInStock,
          isRecommended,
          preparationTime: preparationTime || "",
          ...orderRulesPayload,
          ...stockPayload,
          categoryId: categoryId || undefined,
          categoryName,
        })
      }

      try {
        const nextRecommendedMap = (() => {
          if (typeof window === "undefined") return null
          const raw = window.localStorage.getItem(INVENTORY_RECOMMENDED_KEY)
          const parsed = raw ? JSON.parse(raw) : {}
          const safeMap = parsed && typeof parsed === "object" ? parsed : {}
          return {
            ...safeMap,
            [String(itemId)]: Boolean(isRecommended),
          }
        })()

        if (nextRecommendedMap && typeof window !== "undefined") {
          window.localStorage.setItem(
            INVENTORY_RECOMMENDED_KEY,
            JSON.stringify(nextRecommendedMap),
          )
        }
      } catch (recommendedError) {
        debugWarn("Failed to persist recommended state after save:", recommendedError)
      }

      const imageCount = allImageUrls.length
      toast.success(
        isNewItem
          ? `Item created successfully`
          : `Item updated and sent for approval again`
      )
      window.dispatchEvent(new CustomEvent('foodsChanged'))
      // Stay here. Bouncing to the inventory threw the restaurant out of the
      // dish they were mid-editing on every save. A NEW dish swaps its /new URL
      // for its real id (replace, so Back does not return to a stale form);
      // an existing dish just stays put with its state already current.
      if (isNewItem && itemId) {
        navigate(`/food/restaurant/hub-menu/item/${itemId}`, { replace: true })
      }
    } catch (error) {
      debugError('Error saving menu:', error)
      // Show the server's reason, not the HTTP status. A rejected save is
      // nearly always a rule the restaurant can act on ("Maximum order
      // quantity ... cannot exceed 5"), and a status code tells them nothing.
      toast.error(getServerMessage(error, "Could not save this dish. Please try again."))
    } finally {
      setUploadingImages(false)
    }
  }

  const handleVariantChange = (localId, field, value) => {
    setVariants((prev) =>
      prev.map((variant) =>
        variant.localId === localId ? { ...variant, [field]: value } : variant,
      ),
    )
  }

  const handleAddVariant = () => {
    setVariants((prev) => [...prev, createVariantDraft()])
  }

  const handleRemoveVariant = (localId) => {
    setVariants((prev) => prev.filter((variant) => variant.localId !== localId))
  }

  const handleDelete = () => {
    debugLog("Deleting item:", id)
    goBack()
  }

  const filteredCategories = useMemo(() => {
    if (!categorySearchQuery.trim()) return categories
    const q = categorySearchQuery.toLowerCase()
    return categories.filter(c => c.name.toLowerCase().includes(q))
  }, [categories, categorySearchQuery])

  return (
    <div className="min-h-screen bg-neutral-50/70 text-gray-900 pb-28 lg:pb-12">
      <style>{`
        [data-slot="switch"][data-state="checked"] {
          background-color: #16a34a !important;
        }
        [data-slot="switch-thumb"][data-state="checked"] {
          background-color: #ffffff !important;
        }
      `}</style>

      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={goBack}
              className="p-2 -ml-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold text-gray-900">
                  {isNewItem ? "Add New Dish" : "Item Details"}
                </h1>
                <span
                  className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                    foodType === "Veg"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  {foodType}
                </span>
                {isInStock ? (
                  <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    In Stock
                  </span>
                ) : (
                  <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                    Out of Stock
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 hidden sm:block">
                {isNewItem ? "Configure your menu item settings and pricing" : `Managing: ${itemName || "Untitled Item"}`}
              </p>
            </div>
          </div>

          {/* Desktop Top Action Buttons */}
          <div className="hidden lg:flex items-center gap-3">
            {!isNewItem && (
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={uploadingImages}
              className="px-6 py-2.5 bg-gray-900 hover:bg-black text-white text-sm font-semibold rounded-xl transition-all shadow-sm hover:shadow flex items-center gap-2 disabled:opacity-50"
            >
              {uploadingImages ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving dish...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Page Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6">
        {loadingItem ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-gray-700" />
            <p className="text-sm font-medium text-gray-500">Loading item details...</p>
          </div>
        ) : (
          <>
            {/* Rejection Alert Banner */}
            {!isNewItem && currentApprovalStatus === "rejected" && currentRejectionReason && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50/80 p-4.5 text-red-800 shadow-sm flex items-start gap-3.5">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-red-800">Approval Rejected by Admin</h3>
                  <p className="mt-1 text-sm text-red-700 leading-relaxed">
                    <span className="font-semibold">Reason:</span> {currentRejectionReason}
                  </p>
                  <p className="mt-2 text-xs font-semibold tracking-wide uppercase text-red-600">
                    Make the required changes and click Save to re-submit for approval.
                  </p>
                </div>
              </div>
            )}

            {/* Desktop Two-Column Responsive Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Media & Live Customer Preview */}
              <div className="lg:col-span-5 space-y-6">
                {/* Media Card */}
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Camera className="w-4 h-4 text-gray-600" />
                      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Dish Image</h2>
                    </div>
                    {images.length > 0 && (
                      <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {currentImageIndex + 1} / {images.length}
                      </span>
                    )}
                  </div>

                  <div className="p-4 sm:p-5">
                    {images.length > 0 ? (
                      <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-gray-100 border border-gray-200 group">
                        <div
                          ref={carouselRef}
                          onTouchStart={onTouchStart}
                          onTouchMove={onTouchMove}
                          onTouchEnd={onTouchEnd}
                          className="relative w-full h-full"
                        >
                          <AnimatePresence mode="wait" custom={direction}>
                            <motion.div
                              key={currentImageIndex}
                              custom={direction}
                              initial={{ opacity: 0, x: direction > 0 ? 150 : -150 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: direction > 0 ? -150 : 150 }}
                              transition={{ duration: 0.25, ease: "easeInOut" }}
                              className="absolute inset-0"
                            >
                              {images[currentImageIndex] && (
                                <img
                                  src={images[currentImageIndex]}
                                  alt={`${itemName || "Dish"} photo`}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </motion.div>
                          </AnimatePresence>

                          {images.length > 1 && (
                            <>
                              <button
                                type="button"
                                onClick={goToPrevious}
                                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md hover:bg-white transition-all z-10"
                                aria-label="Previous image"
                              >
                                <ChevronLeft className="w-4 h-4 text-gray-800" />
                              </button>
                              <button
                                type="button"
                                onClick={goToNext}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md hover:bg-white transition-all z-10"
                                aria-label="Next image"
                              >
                                <ChevronRight className="w-4 h-4 text-gray-800" />
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => handleImageDelete(currentImageIndex)}
                            className="absolute top-2.5 right-2.5 w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center shadow-md hover:bg-red-700 transition-all z-10"
                            title="Delete this photo"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
                        <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 mb-3">
                          <Camera className="w-7 h-7" />
                        </div>
                        <p className="text-sm font-semibold text-gray-800">No dish photo yet</p>
                        <p className="text-xs text-gray-500 mt-1 max-w-xs">
                          Appealing photos help increase food orders significantly.
                        </p>
                      </div>
                    )}

                    <div className="mt-4">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageAdd(e.target.files?.[0])}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={handleCameraClick}
                        className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                        <span>{images.length > 0 ? "Change Dish Photo" : "Upload Dish Photo"}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Dietary & Status Toggles Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <Sliders className="w-4 h-4 text-gray-600" />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Food Type & Status</h2>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-2">Dietary Classification</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setFoodType("Veg")}
                        className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                          foodType === "Veg"
                            ? "bg-green-50 border-2 border-green-600 text-green-700 shadow-sm"
                            : "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-green-600"></span>
                        <span>Pure Veg</span>
                        {foodType === "Veg" && <Check className="w-4 h-4 ml-1 text-green-600" />}
                      </button>

                      <button
                        type="button"
                        onClick={() => setFoodType("Non-Veg")}
                        className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                          foodType === "Non-Veg"
                            ? "bg-red-50 border-2 border-red-600 text-red-700 shadow-sm"
                            : "bg-gray-50 border border-gray-200 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
                        <span>Non-Veg</span>
                        {foodType === "Non-Veg" && <Check className="w-4 h-4 ml-1 text-red-600" />}
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">In Stock</p>
                        <p className="text-xs text-gray-500">Enable to allow customers to order this item</p>
                      </div>
                      <Switch
                        checked={isInStock}
                        onCheckedChange={setIsInStock}
                        className="data-[state=unchecked]:bg-gray-300"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Chef Recommendation</p>
                        <p className="text-xs text-gray-500">Highlight this item in the "Recommended" section</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsRecommended(!isRecommended)}
                        className={`p-2 rounded-xl border transition-colors flex items-center justify-center ${
                          isRecommended
                            ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                            : "bg-white border-gray-300 text-gray-500 hover:bg-gray-100"
                        }`}
                        aria-label="Toggle recommendation"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Customer Preview Card */}
                {pricePreview && (
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Live Customer View</h2>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-neutral-50/50 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span
                              className={`w-3 h-3 border flex items-center justify-center ${
                                foodType === "Veg" ? "border-green-600" : "border-red-600"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  foodType === "Veg" ? "bg-green-600" : "bg-red-600"
                                }`}
                              />
                            </span>
                            {isRecommended && (
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-gray-900">
                            {itemName?.trim() || "Delicious Dish Name"}
                          </p>
                        </div>
                      </div>

                      {/* No strikethrough here any more: the comparison figure
                          is admin-owned, so this preview shows only what the
                          restaurant controls. */}
                      <div className="flex flex-wrap items-baseline gap-2 pt-1">
                        <span className="text-base font-bold text-gray-900">
                          {variantsEnabled ? "From " : ""}₹{pricePreview.price}
                        </span>
                      </div>
                    </div>

                    {/* Earnings Breakdown */}
                    <div className="rounded-xl bg-gray-50 p-3.5 border border-gray-100 text-xs text-gray-600 space-y-1.5">
                      <div className="flex items-center justify-between font-medium">
                        <span>Net Take-home Payout:</span>
                        <span className="text-sm font-bold text-emerald-700">₹{pricePreview.takeHome}</span>
                      </div>
                      <div className="flex items-center justify-between text-gray-500">
                        <span>Commission rate:</span>
                        <span>{pricePreview.commissionLabel || "0%"} (₹{pricePreview.commissionAmount})</span>
                      </div>
                      {/*
                        "Customer pays" only ever appeared when GST applied, and it
                        existed to show the GST-inclusive total. With the tax hidden
                        from restaurants it would be a higher number than the price
                        they typed with nothing on screen explaining the gap, so it
                        goes with the rest of the GST display.
                      */}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Dish Details, Pricing, Variants & Operational Rules */}
              <div className="lg:col-span-7 space-y-6">
                {/* Basic Information Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <Utensils className="w-4 h-4 text-gray-600" />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Basic Information</h2>
                  </div>

                  {/* Category Selector */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                      Category <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCategoryPopupOpen(true)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl text-left flex items-center justify-between bg-white hover:bg-gray-50 focus:ring-2 focus:ring-gray-900 transition-colors shadow-sm"
                    >
                      <span className="text-sm font-medium text-gray-900">
                        {category || "Select category"}
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>

                  {/* Item Name */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-gray-700">
                        Dish Name <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[11px] text-gray-400 font-mono">
                        {nameLength}/{maxNameLength}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        maxLength={maxNameLength}
                        placeholder="e.g. Paneer Butter Masala"
                        className="w-full px-4 py-3 pr-10 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all shadow-sm"
                      />
                      <EditIcon className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Item Description */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-gray-700">
                        Description
                      </label>
                      <div className="flex items-center gap-2">
                        {descriptionLength > 0 && descriptionLength < minDescriptionLength && (
                          <span className="text-[11px] text-red-500 font-medium">Min 5 chars</span>
                        )}
                        <span className="text-[11px] text-gray-400 font-mono">
                          {descriptionLength}/{maxDescriptionLength}
                        </span>
                      </div>
                    </div>
                    <div className="relative">
                      <textarea
                        value={itemDescription}
                        onChange={(e) => setItemDescription(e.target.value)}
                        maxLength={maxDescriptionLength}
                        rows={3}
                        placeholder="Describe ingredients, cooking style, taste profile, or serving suggestions..."
                        className="w-full px-4 py-3 pr-10 border border-gray-300 rounded-xl text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all resize-none shadow-sm"
                      />
                      <EditIcon className="absolute right-3.5 top-3.5 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Pricing & Variants Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <IndianRupee className="w-4 h-4 text-gray-600" />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Pricing & Variants</h2>
                  </div>

                  {/*
                    Read-only. Whether these prices include GST is set by the admin
                    for the whole restaurant; shown so the restaurant knows what the
                    number it types means on the customer's bill.
                  */}
                  <div
                    className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                      taxSettings.priceIncludesGst
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                  >
                    <p className="font-semibold">
                      {taxSettings.priceIncludesGst ? "GST inclusive" : "GST exclusive"}
                      {Number(taxSettings.gstRate) > 0 ? ` · ${taxSettings.gstRate}%` : ""}
                    </p>
                    <p className="mt-0.5">
                      {taxSettings.priceIncludesGst
                        ? "The price you enter already includes GST, so the customer pays exactly this price."
                        : `GST${Number(taxSettings.gstRate) > 0 ? ` of ${taxSettings.gstRate}%` : ""} is added on top of the price you enter, at checkout.`}
                      {" "}Set by Quick Drop admin.
                    </p>
                  </div>

                  {/* Single Base Price (if no variants) */}
                  {!variantsEnabled ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                          Base Selling Price <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500">{"\u20B9"}</span>
                          <input
                            type="text"
                            data-err="basePrice"
                            value={basePrice}
                            onChange={(e) => {
                              clearError("basePrice")
                              const value = e.target.value.replace(/[\u20B9\s,]/g, '').replace(/[^0-9.]/g, '')
                              const parts = value.split('.')
                              setBasePrice(parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : value)
                            }}
                            placeholder="0"
                            className="w-full pl-8 pr-4 py-3 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all shadow-sm"
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">Final price charged to customers</p>
                        <FieldError field="basePrice" />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-800 flex items-center gap-2.5">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Selling by variants: customers pay the price of the size they pick, and the menu shows the cheapest as the starting price.</span>
                    </div>
                  )}

                  {/* Variants Section */}
                  <div className="pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 data-err="variants" className="text-sm font-bold text-gray-900">Portions & Variants</h3>
                        <p className="text-xs text-gray-500">
                          {variantsEnabled
                            ? "Customers pick a size; each has its own price and add-ons."
                            : "Switched off: kept for later, customers pay the base price."}
                        </p>
                      </div>
                      {/* The page's own Switch, not a hand-rolled pill: the
                          redesign styles raw buttons, which turned a manual
                          toggle into an unreadable black blob. Off retains the
                          variants in storage; the editor below simply hides. */}
                      <Switch
                        checked={variantsEnabled}
                        onCheckedChange={(next) => setVariantsEnabled(next === true)}
                      />
                      {variantsEnabled && (
                      <button
                        type="button"
                        onClick={handleAddVariant}
                        className="px-3.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-900 text-xs font-semibold rounded-xl border border-gray-200 transition-colors flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Variant</span>
                      </button>
                      )}
                    </div>

<FieldError field="variants" />
                    {/* Rows appear only while selling by variants. The drafts
                        stay in state and storage either way, so toggling back
                        on restores them untouched. */}
                    {variantsEnabled && (variants.length > 0 ? (
                      <div className="space-y-3">
                        {variants.map((variant, index) => (
                          <div
                            key={variant.localId}
                            data-err={`v-${variant.localId}`}
                            className="p-4 rounded-xl border border-gray-200 bg-gray-50/70 hover:border-gray-300 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">Variant Name</label>
                                  <input
                                    type="text"
                                    value={variant.name}
                                    onChange={(e) => { handleVariantChange(variant.localId, "name", e.target.value); clearError(`v-${variant.localId}-name`) }}
                                    placeholder={index === 0 ? "Full" : "Half"}
                                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                  />
                                  <FieldError field={`v-${variant.localId}-name`} />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">Base Selling Price</label>
                                  <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">₹</span>
                                    <input
                                      type="text"
                                      value={variant.price}
                                      onFocus={() => clearError(`v-${variant.localId}-price`)}
                                      onChange={(e) => {
                                        const value = e.target.value.replace(/[\u20B9\s,]/g, '').replace(/[^0-9.]/g, '')
                                        const parts = value.split('.')
                                        const cleanedValue = parts.length > 2
                                          ? parts[0] + '.' + parts.slice(1).join('')
                                          : value
                                        handleVariantChange(variant.localId, "price", cleanedValue)
                                      }}
                                      placeholder="0"
                                      className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                    />
                                  </div>
                                  <FieldError field={`v-${variant.localId}-price`} />
                                  <p className="mt-1 text-[11px] text-gray-500">
                                    This size&rsquo;s own price. Global Price Adjustment never changes it.
                                  </p>

                                </div>

                                {/* Per-size order limits. Sizes do not sell alike:
                                    a family pack may cap at two while a half plate
                                    goes out in tens, and a per-piece size may need a
                                    minimum the boxed size should not inherit. Left
                                    blank, this size keeps the item's own limit. */}
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                                    Min qty <span className="font-normal text-gray-400">(optional)</span>
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={variant.minOrderQuantity ?? ""}
                                    onChange={(e) =>
                                      handleVariantChange(
                                        variant.localId,
                                        "minOrderQuantity",
                                        e.target.value.replace(/[^0-9]/g, "")
                                      )
                                    }
                                    placeholder="Uses the item's"
                                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                                    Max qty <span className="font-normal text-gray-400">(optional)</span>
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={variant.maxOrderQuantity ?? ""}
                                    onChange={(e) =>
                                      handleVariantChange(
                                        variant.localId,
                                        "maxOrderQuantity",
                                        e.target.value.replace(/[^0-9]/g, "")
                                      )
                                    }
                                    placeholder="Uses the item's"
                                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                  />
                                </div>
                                {isQcStore && (
                                  <>
                                    <div>
                                      <label className="block text-xs font-semibold text-gray-700 mb-1">In stock</label>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={variant.stockQty ?? ""}
                                        onChange={(e) => handleVariantChange(variant.localId, "stockQty", e.target.value.replace(/[^0-9]/g, ""))}
                                        placeholder="No limit"
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                                        Warn me at <span className="font-normal text-gray-400">(optional)</span>
                                      </label>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={variant.lowStockThreshold ?? ""}
                                        onChange={(e) => handleVariantChange(variant.localId, "lowStockThreshold", e.target.value.replace(/[^0-9]/g, ""))}
                                        placeholder="No warning"
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                                      />
                                    </div>
                                  </>
                                )}

                                {/* Variant specific addons */}
                                {availableAddons.length > 0 && (
                                  <div className="sm:col-span-2 pt-2 border-t border-gray-200/60">
                                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                      Add-ons specific to this variant
                                      {(variant.addonIds || []).length > 0 && (
                                        <span className="ml-1.5 text-blue-600 font-bold">
                                          ({(variant.addonIds || []).length} selected)
                                        </span>
                                      )}
                                    </label>
                                    {/* Each selected pairing gets its own price for THIS size --
                                        cheese on a large is more cheese than on a small. Blank
                                        keeps the add-on's usual price. */}
                                    <div className="flex flex-wrap gap-1.5">
                                      {availableAddons.map((addon) => {
                                        const addonId = String(addon._id || addon.id || "")
                                        const isChecked = (variant.addonIds || []).includes(addonId)
                                        const addonName = addon.name || addon.draft?.name || addon.published?.name || "Add-on"
                                        const ownPrice = addon.price ?? addon.published?.price ?? addon.draft?.price ?? 0
                                        return (
                                          <div
                                            key={addonId}
                                            className={`inline-flex items-center gap-1 rounded-lg border transition-colors ${
                                              isChecked
                                                ? "bg-gray-900 border-gray-900"
                                                : "bg-white border-gray-300 hover:bg-gray-100"
                                            }`}
                                          >
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleVariantChange(
                                                  variant.localId,
                                                  "addonIds",
                                                  isChecked
                                                    ? (variant.addonIds || []).filter((x) => x !== addonId)
                                                    : [...(variant.addonIds || []), addonId]
                                                )
                                              }
                                              className={`px-2.5 py-1 text-xs font-medium ${
                                                isChecked ? "text-white" : "text-gray-700"
                                              }`}
                                            >
                                              {addonName}
                                            </button>
                                            {isChecked && (
                                              <span className="flex items-center gap-0.5 pr-1.5">
                                                <span className="text-[10px] text-gray-300">{"₹"}</span>
                                                <input
                                                  type="text"
                                                  inputMode="decimal"
                                                  value={(variant.addonPrices || {})[addonId] ?? ""}
                                                  placeholder={String(ownPrice)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  onChange={(e) => {
                                                    const value = e.target.value.replace(/[^0-9.]/g, "")
                                                    const parts = value.split(".")
                                                    const cleaned = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : value
                                                    handleVariantChange(variant.localId, "addonPrices", {
                                                      ...(variant.addonPrices || {}),
                                                      [addonId]: cleaned,
                                                    })
                                                  }}
                                                  className="w-12 rounded bg-gray-800 px-1 py-0.5 text-right text-[11px] font-semibold text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-white/40"
                                                />
                                              </span>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                    {(variant.addonIds || []).length > 0 && (
                                      <p className="mt-1 text-[10px] text-gray-500">
                                        Price is per add-on for this size. Blank uses the add-on's usual price.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveVariant(variant.localId)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Remove variant"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic bg-gray-50 p-3 rounded-xl border border-dashed border-gray-200">
                        No variants added yet. Add one with the button above.
                      </p>
                    ))}
                  </div>
                </div>

                {/* Operations & Order Limits Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <Package className="w-4 h-4 text-gray-600" />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Kitchen & Order Rules</h2>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">Preparation Time</label>
                      <div className="relative">
                        <select
                          value={preparationTime}
                          onChange={(e) => setPreparationTime(e.target.value)}
                          className="w-full pl-3.5 pr-8 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 appearance-none shadow-sm"
                        >
                          <option value="">Select timing</option>
                          <option value="10-20 mins">10-20 mins</option>
                          <option value="20-25 mins">20-25 mins</option>
                          <option value="25-35 mins">25-35 mins</option>
                          <option value="35-45 mins">35-45 mins</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">Min Order Quantity</label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        data-err="minQty"
                        value={minOrderQuantity}
                        onFocus={() => clearError("minQty")}
                        onChange={(e) => setMinOrderQuantity(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 shadow-sm"
                      />
                      <FieldError field="minQty" />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">Max Order Quantity</label>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        data-err="maxQty"
                        value={maxOrderQuantity}
                        onFocus={() => clearError("maxQty")}
                        onChange={(e) => setMaxOrderQuantity(e.target.value)}
                        className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 shadow-sm"
                      />
                      <FieldError field="maxQty" />
                    </div>
                  </div>

                  {isQcStore && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <p className="text-sm font-semibold text-gray-900">Stock</p>
                      {variantsEnabled ? (
                        <p className="mt-1 text-xs text-gray-600">
                          This product sells by size, so each size has its own count above. You can also change counts on the Stock page.
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 text-xs text-gray-600">
                            Customers can buy only what is in stock, and orders reduce it automatically. Leave empty to sell without a limit.
                          </p>
                          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1.5">In stock</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={stockQty}
                                onChange={(e) => setStockQty(e.target.value.replace(/[^0-9]/g, ""))}
                                placeholder="No limit"
                                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 shadow-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                                Warn me at <span className="font-normal text-gray-400">(optional)</span>
                              </label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={lowStockThreshold}
                                onChange={(e) => setLowStockThreshold(e.target.value.replace(/[^0-9]/g, ""))}
                                placeholder="No warning"
                                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 shadow-sm"
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/*
                    The GST inclusive/exclusive chooser is hidden from restaurants.
                    Tax treatment is a platform decision, and a dish left on
                    "inherit" follows the restaurant's own setting -- which is what
                    every dish does while this is not shown. gstMode stays at its
                    default so the save omits priceIncludesGst entirely rather than
                    pinning a dish to a treatment nobody chose here.
                  */}

                  {/* Packaging Charges */}
                  <div className="pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Per-unit Packaging Charge</p>
                        <p className="text-xs text-gray-500">Apply a direct packaging charge per item unit ordered</p>
                      </div>
                      <Switch
                        checked={packagingEnabled}
                        onCheckedChange={setPackagingEnabled}
                      />
                    </div>

                    {packagingEnabled && (
                      <div className="mt-3 max-w-xs">
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-500 font-semibold">₹</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            data-err="packaging"
                            value={packagingAmount}
                            onFocus={() => clearError("packaging")}
                            onChange={(e) => setPackagingAmount(e.target.value)}
                            placeholder="e.g. 5"
                            className="w-full pl-8 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 shadow-sm"
                          />
                          <FieldError field="packaging" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Add-ons Configuration Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-gray-600" />
                      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Dish Add-ons</h2>
                    </div>
                    {addonIds.length > 0 && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-900 text-white">
                        {addonIds.length} active
                      </span>
                    )}
                  </div>

                  {availableAddons.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">
                      No restaurant add-ons available. Create add-ons in the Add-ons manager to attach them here.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {availableAddons.map((addon) => {
                        const addonId = String(addon._id || addon.id || "")
                        const isChecked = addonIds.includes(addonId)
                        const addonName = addon.name || addon.draft?.name || addon.published?.name || "Add-on"
                        const addonPrice = addon.price ?? addon.draft?.price ?? addon.published?.price ?? 0
                        const isPending = String(addon.approvalStatus || "").toLowerCase() === "pending"

                        return (
                          <label
                            key={addonId}
                            className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                              isChecked
                                ? "bg-gray-50 border-gray-900 shadow-sm"
                                : "bg-white border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <span className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) =>
                                  setAddonIds((prev) =>
                                    e.target.checked
                                      ? [...prev, addonId]
                                      : prev.filter((x) => x !== addonId)
                                  )
                                }
                                className="w-4 h-4 rounded text-gray-900 focus:ring-gray-900"
                              />
                              <span className="text-sm font-medium text-gray-900 truncate">{addonName}</span>
                              {isPending && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                                  Pending
                                </span>
                              )}
                            </span>
                            <span className="text-xs font-bold text-gray-700 shrink-0 ml-2">₹{addonPrice}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Goes well with -- the dishes shown beside this one and in the cart */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-gray-600" />
                      <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Goes well with</h2>
                    </div>
                    <span className="text-xs font-semibold text-gray-500">{suggestedItemIds.length}/10</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Customers see these beside this dish and in their cart. Link a pair once and it shows on both dishes. Pick none and nothing is suggested.
                  </p>
                  {pairingOptions.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No other dishes on your menu yet.</p>
                  ) : (
                    <>
                      {/* Pick from the menu one at a time. A grid of checkboxes
                          made the card as tall as the menu is long, and the
                          dishes already picked were lost among the ones that
                          were not. */}
                      <select
                        value=""
                        disabled={suggestedItemIds.length >= 10}
                        onChange={(e) => {
                          const picked = e.target.value
                          if (!picked) return
                          setSuggestedItemIds((prev) => (prev.includes(picked) ? prev : [...prev, picked]))
                        }}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">
                          {suggestedItemIds.length >= 10
                            ? "10 picked - remove one to add another"
                            : "Select a dish to add"}
                        </option>
                        {pairingOptions
                          .filter((option) => !suggestedItemIds.includes(option.id))
                          .map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.price != null ? `${option.name} - Rs ${option.price}` : option.name}
                            </option>
                          ))}
                      </select>

                      {suggestedItemIds.length === 0 ? (
                        <p className="text-xs text-gray-500 italic">Nothing picked yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {suggestedItemIds.map((id) => {
                            const option = pairingOptions.find((o) => o.id === id)
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border border-gray-900 bg-gray-50 text-sm font-medium text-gray-900"
                              >
                                {/* A dish deleted since it was picked still has to be
                                    removable, so the chip renders without its name
                                    rather than disappearing and leaving a slot used. */}
                                <span className="truncate max-w-[12rem]">{option ? option.name : "Removed dish"}</span>
                                <button
                                  type="button"
                                  onClick={() => setSuggestedItemIds((prev) => prev.filter((x) => x !== id))}
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-900 transition-colors"
                                  aria-label={`Remove ${option ? option.name : "this dish"}`}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Availability Schedule Card */}
                <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3 mb-4">
                    <Calendar className="w-4 h-4 text-gray-600" />
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Availability Schedule</h2>
                  </div>
                  <div data-err="schedule"><FieldError field="schedule" /></div>
                  <ItemAvailabilityScheduleEditor
                    value={availabilitySchedule}
                    onChange={setAvailabilitySchedule}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Responsive Category Selection Modal */}
      <AnimatePresence>
        {isCategoryPopupOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCategoryPopupOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl z-50 max-h-[85vh] flex flex-col overflow-hidden mx-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Select Category</h2>
                  <p className="text-xs text-gray-500">Pick which menu section this dish belongs to</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setIsCategoryPopupOpen(false)
                      navigate('/food/restaurant/menu-categories')
                    }}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-semibold hover:bg-black transition-colors flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New</span>
                  </button>
                  <button
                    onClick={() => setIsCategoryPopupOpen(false)}
                    className="p-1.5 rounded-full hover:bg-gray-100 text-gray-500"
                    aria-label="Close modal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Category Search Filter */}
              <div className="px-5 pt-3 pb-2 border-b border-gray-100 bg-gray-50/50">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={categorySearchQuery}
                    onChange={(e) => setCategorySearchQuery(e.target.value)}
                    placeholder="Search category..."
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {loadingCategories ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-2">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-600" />
                    <span className="text-xs text-gray-500">Loading categories...</span>
                  </div>
                ) : filteredCategories.length === 0 ? (
                  <div className="text-center py-12 space-y-3">
                    <p className="text-sm text-gray-500">
                      {categorySearchQuery ? "No matching categories found" : "No categories configured"}
                    </p>
                    <button
                      onClick={() => {
                        setIsCategoryPopupOpen(false)
                        navigate('/food/restaurant/menu-categories')
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-semibold hover:bg-black transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Create New Category</span>
                    </button>
                  </div>
                ) : (
                  filteredCategories.map((cat) => {
                    const isSelected = String(selectedCategoryId || "") === String(cat.id)
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => handleCategorySelect(cat.id, cat.name)}
                        className={`w-full rounded-xl px-4 py-3 text-left transition-all border flex items-center justify-between gap-3 ${
                          isSelected
                            ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                            : "bg-gray-50/70 text-gray-900 border-gray-200/80 hover:bg-gray-100"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-sm font-semibold truncate">{cat.name}</span>
                          {isSelected && <Check className="w-4 h-4 shrink-0 text-white" />}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isSelected
                              ? "bg-white/20 text-white"
                              : cat.foodTypeScope === "Veg"
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : cat.foodTypeScope === "Non-Veg"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {cat.foodTypeScope || "Both"}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating / Sticky Bottom Bar (Responsive) */}
      <div
        className="fixed lg:sticky bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-lg lg:shadow-none"
        style={{ bottom: `${keyboardInset}px` }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-gray-500">
            <span>{isNewItem ? "Draft Item" : `Editing #${id || ""}`}</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            {!isNewItem && (
              <button
                type="button"
                onClick={handleDelete}
                className="py-3 px-5 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Delete Dish</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={uploadingImages}
              className="flex-1 sm:flex-initial py-3 px-8 bg-gray-900 hover:bg-black text-white rounded-xl text-sm font-bold transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {uploadingImages ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Dish...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Dish</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Photo Picker */}
      <ImageSourcePicker
        isOpen={isPhotoPickerOpen}
        onClose={() => setIsPhotoPickerOpen(false)}
        onFileSelect={handleImageAdd}
        title="Dish Photo"
        description="Select or capture a photo for this menu item"
        fileNamePrefix="item-photo"
        galleryInputRef={fileInputRef}
      />
    </div>
  )
}



