import { useState, useMemo, useEffect, useCallback } from "react"
import { useLocation, useSearchParams } from "react-router-dom"
import { Search, Trash2, Loader2, Eye, Pencil, Plus, Save, ChevronDown, ThumbsUp } from "lucide-react"
import TablePagination, { usePagination, SCROLL_TABLE_CLASS, STICKY_THEAD_CLASS } from "@food/components/admin/TablePagination"
import { adminAPI, uploadAPI } from "@food/api"
import apiClient from "@food/api/axios"
import { adminPanelOf } from "@food/utils/adminPanel"
import { toast } from "sonner"
import { Switch } from "@food/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@food/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@food/components/ui/popover"
import { getFoodDisplayPrice, getFoodVariants, getStoredFoodVariants } from "@food/utils/foodVariants"
import ItemAvailabilityScheduleEditor, { buildScheduleState, isScheduleEmpty } from "@food/components/ItemAvailabilityScheduleEditor"
import { PLACEHOLDER_40, PLACEHOLDER_64 } from "@food/utils/imagePlaceholder"
import { useValueShelfCap } from "@food/utils/valueShelf"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const createFoodForm = () => ({
  restaurantId: "",
  categoryId: "",
  categoryName: "",
  name: "",
  price: "",
  basePrice: "",
  discountPercent: 0,
  formulationPercent: 0,
  otherPrice: "",
  variantsEnabled: false,
  variants: [],
  description: "",
  image: "",
  foodType: "Non-Veg",
  isAvailable: true,
  showIn99Store: false,
  freeDelivery: false,
  // Packaging charge: amount for every `packagingUnits` units (1 = per unit).
  packagingEnabled: false,
  packagingAmount: "",
  packagingUnits: "1",
  preparationTime: "",
  // Dish-level order limits, as on the restaurant's own item form. 0 = none.
  minOrderQuantity: "0",
  maxOrderQuantity: "0",
  stockQty: "",
  lowStockThreshold: "",
  gstRate: "",
  availabilitySchedule: buildScheduleState(null),
  suggestedItemIds: [],
})

/**
 * The price the value shelf judges this dish on: what a customer pays, and for
 * a dish sold by sizes, its cheapest size -- the same figure the server compares
 * with the shelf price. NaN when nothing is priced yet.
 */
const shelfPriceOf = (form) => {
  const percent = Number(form?.formulationPercent) || 0
  const pays = (base) => {
    const n = Number(base)
    if (!Number.isFinite(n) || n <= 0) return NaN
    return Math.min(n, Math.round(n * (1 + percent / 100) * 100) / 100)
  }
  if (form?.variantsEnabled === true) {
    const prices = (Array.isArray(form.variants) ? form.variants : [])
      .map((v) => pays(v?.price))
      .filter((n) => Number.isFinite(n))
    return prices.length ? Math.min(...prices) : NaN
  }
  return pays(form?.basePrice)
}

/** India's GST slabs for goods. */
const GST_SLABS = [0, 5, 12, 18, 28]

const createVariantDraft = (variant = {}) => ({
  id: String(variant?.id || variant?._id || `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  name: String(variant?.name || ""),
  /*
   * The BASE price, not what a customer pays.
   *
   * `price` on the server is the base after the platform's global adjustment, so
   * a decrease moved this box: a size set to 120 with 10% off displayed as 108,
   * and after another -10% run as 96. Nothing had changed the base -- it is still
   * 120 -- but the field was showing the charged figure, so it read as though the
   * global run had rewritten the restaurant's own price.
   */
  price: variant?.basePrice != null ? String(variant.basePrice) : (variant?.price != null ? String(variant.price) : ""),
  /** What a customer currently pays for this size, for the note under the field. */
  customerPrice: variant?.price != null ? Number(variant.price) : null,
  /** This size's struck-through comparison, when a markup stands. */
  strikePrice: variant?.strikePrice != null ? Number(variant.strikePrice) : null,
  // Per-size order limits. Blank means "not set for this size", which is not the
  // same as zero -- the dish's own limit then applies.
  minOrderQuantity: variant?.minOrderQuantity != null ? String(variant.minOrderQuantity) : "",
  maxOrderQuantity: variant?.maxOrderQuantity != null ? String(variant.maxOrderQuantity) : "",
  // Stock per size (quick commerce and medical). Blank = not counted. The
  // *AtLoad copies let the save send only a count the admin changed.
  stockQty: variant?.stockQty != null ? String(variant.stockQty) : "",
  lowStockThreshold: variant?.lowStockThreshold != null ? String(variant.lowStockThreshold) : "",
  stockQtyAtLoad: variant?.stockQty != null ? String(variant.stockQty) : "",
  // GST % for this size. Blank = the product's rate.
  gstRate: variant?.gstRate != null ? String(variant.gstRate) : "",
  lowStockAtLoad: variant?.lowStockThreshold != null ? String(variant.lowStockThreshold) : "",
  // Per-variant add-on pairings. Dropped here would mean an admin editing any
  // variant silently wipes what the restaurant paired -- the payload replaces
  // the whole variants array on save.
  addonIds: Array.isArray(variant?.addonIds) ? variant.addonIds.map(String) : [],
  addonPrices: Object.fromEntries(
    (Array.isArray(variant?.addons) ? variant.addons : [])
      .filter((pair) => pair?.addonId && pair?.price !== null && pair?.price !== undefined)
      .map((pair) => [String(pair.addonId), String(pair.price)])
  ),
})

const rupees = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? `₹${n % 1 === 0 ? n : n.toFixed(2)}` : "-"
}

/**
 * The dish's base price -- the restaurant's own figure -- and, where it
 * differs, what the customer pays. A dish sold in sizes lists every size.
 */
function BasePriceCell({ food }) {
  const variants = Array.isArray(food.variants) ? food.variants : []
  const byVariants = food.variantsEnabled !== false && variants.length > 0
  if (byVariants) {
    return (
      <div className="flex flex-col gap-0.5">
        {variants.map((v, i) => {
          const base = v.basePrice ?? v.price
          const sells = Number(v.price)
          return (
            <span key={v.id || v._id || i} className="text-xs text-slate-700">
              <span className="font-medium text-slate-900">{v.name || `Size ${i + 1}`}</span> {rupees(base)}
              {Number.isFinite(sells) && sells > 0 && sells !== Number(base) && (
                <span className="text-slate-400"> · sells {rupees(sells)}</span>
              )}
            </span>
          )
        })}
      </div>
    )
  }
  const base = Number(food.basePrice)
  const sells = Number(food.price)
  return (
    <div className="flex flex-col">
      <span className="text-sm font-semibold text-slate-900">{rupees(base)}</span>
      {Number.isFinite(sells) && sells > 0 && sells !== base && (
        <span className="text-xs text-slate-400">sells at {rupees(sells)}</span>
      )}
    </div>
  )
}

export default function FoodsList() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedRestaurant, setSelectedRestaurant] = useState("all")
  const [foods, setFoods] = useState([])
  const [restaurantsForFilter, setRestaurantsForFilter] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [selectedFood, setSelectedFood] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showFoodFormModal, setShowFoodFormModal] = useState(false)
  const [foodFormMode, setFoodFormMode] = useState("add")
  const [foodForm, setFoodForm] = useState(createFoodForm())
  const [editingFood, setEditingFood] = useState(null)
  // Filters the "Goes well with" list by dish name.
  const [pairingSearch, setPairingSearch] = useState("")
  // Stock is counted in quick commerce and medical, not food (dishes aren't).
  const { pathname } = useLocation()
  const isStockPanel = /^\/admin\/(quick-commerce|medical)(\/|$)/.test(pathname)
  /** Product-level stock for the save: only what changed since the form opened. */
  const productStockPayload = () => {
    const was = (v) => (v === null || v === undefined ? "" : String(v))
    const out = {}
    const isEdit = foodFormMode === "edit"
    if (!isEdit ? foodForm.stockQty !== "" : foodForm.stockQty !== was(editingFood?.stockQty)) {
      out.stockQty = foodForm.stockQty === "" ? null : Number(foodForm.stockQty)
    }
    if (!isEdit ? foodForm.lowStockThreshold !== "" : foodForm.lowStockThreshold !== was(editingFood?.lowStockThreshold)) {
      out.lowStockThreshold = foodForm.lowStockThreshold === "" ? null : Number(foodForm.lowStockThreshold)
    }
    return out
  }
  /*
   * The shelf box follows the price until the admin touches it. The shelf price
   * and the store's name come from 99 Store settings, so neither is written
   * into this form.
   */
  const shelfCap = useValueShelfCap()
  // The 99 store and Trending Now are food-app shelves; the quick-commerce and
  // medical panels reuse this screen without them.
  const isFoodPanel = adminPanelOf().vertical === "food"
  // Dishes the app's 99 store is showing right now, read from the same public
  // feed the app reads, so the tick matches what customers see whatever rule
  // the server applies.
  const [onShelfIds, setOnShelfIds] = useState(() => new Set())
  const [trendingBusyId, setTrendingBusyId] = useState("")
  const [shelfBusyId, setShelfBusyId] = useState("")
  const [shelfTouched, setShelfTouched] = useState(false)
  const [submittingFood, setSubmittingFood] = useState(false)
  const [categoryOptions, setCategoryOptions] = useState([])
  const [categorySearch, setCategorySearch] = useState("")
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false)
  const [selectedImageFile, setSelectedImageFile] = useState(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState("")
  const [imageVersion, setImageVersion] = useState(Date.now())

  const getItemCreatedMs = (item = {}) => {
    const direct = [item.createdAt, item.addedAt, item.requestedAt, item.updatedAt]
      .map((v) => new Date(v).getTime())
      .find((ms) => Number.isFinite(ms) && ms > 0)
    if (direct) return direct

    const rawId = String(item.id || "")
    const match = rawId.match(/\d{10,}/)
    if (match) {
      const fromId = Number(match[0])
      if (Number.isFinite(fromId) && fromId > 0) return fromId
    }
    return 0
  }

  const toArray = (value) => (Array.isArray(value) ? value : [])
  const withImageVersion = (url) => {
    if (!url || typeof url !== "string") return PLACEHOLDER_40
    return `${url}${url.includes("?") ? "&" : "?"}v=${imageVersion}`
  }

  const fetchAllFoods = useCallback(async () => {
    try {
      setLoading(true)

      if (isFoodPanel) {
        apiClient
          .get("/food/restaurant/public/foods", { params: { promo: "switch99", limit: 1000 } })
          .then((res) => {
            const shelf = res?.data?.data?.foods || res?.data?.foods || []
            setOnShelfIds(new Set(shelf.map((f) => String(f?._id || f?.id || ""))))
          })
          .catch(() => setOnShelfIds(new Set()))
      }
      const [activeRestaurantsResponse, inactiveRestaurantsResponse] = await Promise.all([
        adminAPI.getRestaurants({ limit: 1000 }),
        adminAPI.getRestaurants({ limit: 1000, status: "inactive" }),
      ])

      const activeRestaurants = activeRestaurantsResponse?.data?.data?.restaurants ||
        activeRestaurantsResponse?.data?.restaurants ||
        []
      const inactiveRestaurants = inactiveRestaurantsResponse?.data?.data?.restaurants ||
        inactiveRestaurantsResponse?.data?.restaurants ||
        []

      const restaurantsMap = new Map()
      ;[...activeRestaurants, ...inactiveRestaurants].forEach((restaurant) => {
        const restaurantId = String(restaurant?._id || restaurant?.id || "")
        if (!restaurantId) return
        if (!restaurantsMap.has(restaurantId)) {
          restaurantsMap.set(restaurantId, restaurant)
        }
      })
      const restaurants = Array.from(restaurantsMap.values())
      setRestaurantsForFilter(
        restaurants
          .map((restaurant) => ({
            id: String(restaurant?._id || restaurant?.id || ""),
            name: restaurant?.name || restaurant?.restaurantName || "Unknown Restaurant",
          }))
          .filter((restaurant) => restaurant.id)
          .sort((a, b) => a.name.localeCompare(b.name))
      )

      if (restaurants.length === 0) {
        setFoods([])
        return
      }

      // One request per restaurant rather than one for everything. A single
      // call stopped at the server's 1000 cap, and paging past it does not
      // work: the server sorts by createdAt alone, bulk-uploaded dishes have
      // none, so their order shifts between requests and page 2 repeated
      // page 1 -- Saini Vaishno Dhaba's 50 dishes never arrived at all.
      // Filtered by restaurant, each list is complete in one page.
      const perRestaurant = await Promise.all(
        restaurants.map((restaurant) => {
          const restaurantId = String(restaurant?._id || restaurant?.id || "")
          return adminAPI
            .getFoods({ restaurantId, limit: 1000 })
            .then((res) => res?.data?.data?.foods || [])
            .catch(() => [])
        }),
      )
      const seen = new Set()
      const list = perRestaurant.flat().filter((f) => {
        const id = String(f?._id || f?.id || "")
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      const approvedOnly = Array.isArray(list)
        ? list.filter((f) => String(f?.approvalStatus || "").toLowerCase() === "approved")
        : []
      setFoods(
        Array.isArray(approvedOnly)
          ? approvedOnly.map((f) => ({
              id: String(f.id || f._id || ""),
              _id: f._id || f.id,
              name: f.name || "Unnamed Item",
              image: f.image || PLACEHOLDER_40,
              status: f.isAvailable !== false && String(f.approvalStatus || "").toLowerCase() !== "rejected",
              restaurantId: String(f.restaurantId || ""),
              restaurantName: f.restaurantName || "Unknown Restaurant",
              categoryId: String(f.categoryId || ""),
              categoryName: f.categoryName || "",
              price: getFoodDisplayPrice(f),
              basePrice: f.basePrice ?? f.price ?? 0,
              // Carried through so the edit form can say what the dish charges.
              // Dropped here, every marked-down dish opened as though its base
              // price were its selling price.
              discountPercent: Number(f.discountPercent) || 0,
              formulationPercent: Number(f.formulationPercent) || 0,
              formulationPrice: Number(f.formulationPrice) || 0,
              otherPrice: f.otherPrice ?? 0,
              // null when the list did not carry the field, so the edit form
              // leaves the pairings alone instead of saving an empty list.
              suggestedItemIds: Array.isArray(f.suggestedItemIds) ? f.suggestedItemIds.map(String) : null,
              // Carried so the edit form opens with the shelf box as it really is.
              showIn99Store: f.showIn99Store === true,
              ninetyNineStoreExcluded: f.ninetyNineStoreExcluded === true,
              isTrending: f.isTrending === true,
              freeDelivery: f.freeDelivery === true,
              packagingCharge: f.packagingCharge || null,
              stockQty: f.stockQty ?? null,
              lowStockThreshold: f.lowStockThreshold ?? null,
              variants: getStoredFoodVariants(f),
              // Carried so the editor opens with the switch as saved: without it
              // a dish whose variants are switched off opened (and saved) on.
              variantsEnabled: f.variantsEnabled,
              foodType: f.foodType || "Non-Veg",
              approvalStatus: f.approvalStatus || "approved",
              description: f.description || "",
              preparationTime: f.preparationTime || "",
              minOrderQuantity: f.minOrderQuantity,
              maxOrderQuantity: f.maxOrderQuantity,
              availabilitySchedule: f.availabilitySchedule || null,
              isAvailable: f.isAvailable !== false,
              createdAt: f.createdAt,
              updatedAt: f.updatedAt,
            }))
          : []
      )
      setImageVersion(Date.now())
    } catch (error) {
      debugError("Error fetching foods:", error)
      toast.error("Failed to load foods")
      setFoods([])
      setRestaurantsForFilter([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAllFoods()
  }, [fetchAllFoods])

  const [searchParams] = useSearchParams()
  const productIdFromUrl = searchParams.get("productId")

  useEffect(() => {
    if (productIdFromUrl && foods.length > 0) {
      const food = foods.find(f => f.id === productIdFromUrl || f._id === productIdFromUrl)
      if (food) {
        handleViewDetails(food)
      }
    }
  }, [productIdFromUrl, foods])

  // Format ID to FOOD format (e.g., FOOD519399)
  const formatFoodId = (id) => {
    if (!id) return "FOOD000000"
    
    const idString = String(id)
    // Extract last 6 digits from the ID
    // Handle formats like "1768285554154-0.703896654519399" or "item-1768285554154-0.703896654519399"
    const parts = idString.split(/[-.]/)
    let lastDigits = ""
    
    // Get the last part and extract digits
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1]
      // Extract only digits from the last part
      const digits = lastPart.match(/\d+/g)
      if (digits && digits.length > 0) {
        // Get last 6 digits from all digits found
        const allDigits = digits.join("")
        lastDigits = allDigits.slice(-6).padStart(6, "0")
      }
    }
    
    // If no digits found, use a hash of the ID
    if (!lastDigits) {
      const hash = idString.split("").reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0) | 0
      }, 0)
      lastDigits = Math.abs(hash).toString().slice(-6).padStart(6, "0")
    }
    
    return `FOOD${lastDigits}`
  }

  const filteredFoods = useMemo(() => {
    let result = [...foods]
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter(food =>
        food.name.toLowerCase().includes(query) ||
        food.id.toString().includes(query) ||
        food.restaurantName?.toLowerCase().includes(query) ||
        food.categoryName?.toLowerCase().includes(query)
      )
    }

    if (selectedRestaurant !== "all") {
      result = result.filter((food) => String(food.restaurantId) === selectedRestaurant)
    }

    result.sort((a, b) => getItemCreatedMs(b) - getItemCreatedMs(a))
    return result
  }, [foods, searchQuery, selectedRestaurant])

  // Shared admin pagination: 5 per page by default, remembered per list.
  const pagination = usePagination(filteredFoods, {
    storageKey: "foods",
    resetOn: [searchQuery, selectedRestaurant],
  })
  const paginatedFoods = pagination.pageItems

  const restaurantOptions = useMemo(() => {
    return restaurantsForFilter
  }, [restaurantsForFilter])

  /*
   * Tick the shelf box when the dish is priced within the shelf price, the same
   * rule the server applies when it saves:
   *   - a new dish at or under the price starts ticked;
   *   - an existing one that qualifies is ticked, unless an admin took it off
   *     the shelf by hand -- then only a price moved in from above re-ticks it;
   *   - once the admin clicks the box, it is theirs and stops following.
   * Above the price the box is left as it was: the shelf hides the dish anyway,
   * and clearing the marking would lose it if the price later comes back down.
   */
  const shelfPrice = shelfPriceOf(foodForm)
  useEffect(() => {
    if (!showFoodFormModal || shelfTouched) return
    const eligible = Number.isFinite(shelfPrice) && shelfPrice > 0 && shelfPrice <= shelfCap
    if (!eligible) {
      if (foodFormMode === "add" && foodForm.showIn99Store) {
        setFoodForm((prev) => ({ ...prev, showIn99Store: false }))
      }
      return
    }
    if (foodForm.showIn99Store) return
    if (foodFormMode === "add") {
      setFoodForm((prev) => ({ ...prev, showIn99Store: true }))
      return
    }
    // What the dish sold for when the form opened, as the server priced it.
    const storedPrice = Number(editingFood?.price)
    const cameFromAbove = !(Number.isFinite(storedPrice) && storedPrice > 0 && storedPrice <= shelfCap)
    if (editingFood?.ninetyNineStoreExcluded !== true || cameFromAbove) {
      setFoodForm((prev) => ({ ...prev, showIn99Store: true }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelfPrice, shelfCap, shelfTouched, showFoodFormModal, foodFormMode])

  const openAddFoodModal = () => {
    setShelfTouched(false)
    setFoodFormMode("add")
    setEditingFood(null)
    setFoodForm({
      ...createFoodForm(),
      restaurantId: selectedRestaurant !== "all" ? selectedRestaurant : "",
    })
    setSelectedImageFile(null)
    setImagePreviewUrl("")
    setCategorySearch("")
    setCategoryPopoverOpen(false)
    setShowFoodFormModal(true)
  }

  const openEditFoodModal = (food) => {
    setShelfTouched(false)
    setFoodFormMode("edit")
    setEditingFood(food)
    setFoodForm({
      restaurantId: String(food.restaurantId || ""),
      categoryId: String(food.categoryId || ""),
      categoryName: String(food.categoryName || ""),
      name: String(food.name || ""),
      price: String(food.price || ""),
      // Rows written before basePrice existed carry only `price`, which is the
      // same figure for an undiscounted item.
      basePrice: String(food.basePrice ?? food.price ?? ""),
      // Read-only here, and only to say what the dish actually sells for. A
      // global decrease sets it, so a form that ignored it showed the base
      // price as though that were what customers pay.
      discountPercent: Number(food.discountPercent) || 0,
      // Read-only in this form. The adjustment belongs to Global Price
      // Adjustment; this is here so the admin can see what it did to the dish.
      formulationPercent: Number(food.formulationPercent) || 0,
      otherPrice: food.otherPrice ? String(food.otherPrice) : "",
      variants: getStoredFoodVariants(food).map(createVariantDraft),
      // Absent on old rows means "sell by variants if any exist".
      variantsEnabled: food.variantsEnabled === true || (food.variantsEnabled == null && getStoredFoodVariants(food).length > 0),
      showIn99Store: food.showIn99Store === true,
    freeDelivery: food.freeDelivery === true,
    packagingEnabled: food.packagingCharge?.isEnabled === true,
    packagingAmount: Number(food.packagingCharge?.amount) > 0 ? String(food.packagingCharge.amount) : "",
    packagingUnits: String(Math.max(1, Number(food.packagingCharge?.unitsPerCharge) || 1)),
    description: String(food.description || ""),
      image: String(food.image || ""),
      foodType: String(food.foodType || "Non-Veg"),
      isAvailable: food.isAvailable !== false,
      preparationTime: String(food.preparationTime || ""),
      minOrderQuantity: String(food.minOrderQuantity ?? 0),
      maxOrderQuantity: String(food.maxOrderQuantity ?? 0),
      stockQty: food.stockQty != null ? String(food.stockQty) : "",
      lowStockThreshold: food.lowStockThreshold != null ? String(food.lowStockThreshold) : "",
      gstRate: food.gstRate != null ? String(food.gstRate) : "",
      availabilitySchedule: buildScheduleState(food.availabilitySchedule),
      suggestedItemIds: food.suggestedItemIds ?? null,
    })
    setSelectedImageFile(null)
    setImagePreviewUrl(String(food.image || ""))
    setCategorySearch("")
    setCategoryPopoverOpen(false)
    setShowFoodFormModal(true)
  }

  useEffect(() => {
    if (!showFoodFormModal) {
      setCategoryOptions([])
      return
    }

    let cancelled = false

    const loadCategoryOptions = async () => {
      try {
        const res = await adminAPI.getCategories({ limit: 1000 })
        const list = res?.data?.data?.categories || []
        const options = Array.isArray(list)
          ? list
              .map((c) => ({ id: String(c.id || c._id || c.name), name: String(c.name || "").trim() }))
              .filter((c) => c.name)
          : []
        if (!cancelled) setCategoryOptions(options)
      } catch (error) {
        if (!cancelled) {
          setCategoryOptions([])
        }
      }
    }

    loadCategoryOptions()

    return () => {
      cancelled = true
    }
  }, [showFoodFormModal])

  // The restaurant's add-on pool, for pairing add-ons to variants. Keyed on the
  // dish's restaurant: an admin edits dishes across restaurants, and offering
  // restaurant A's add-ons on restaurant B's dish would be refused on save.
  const [restaurantAddons, setRestaurantAddons] = useState([])
  // Filters the add-on pickers by name; add-ons already picked stay visible.
  const [addonSearch, setAddonSearch] = useState("")
  const addonVisible = (addon, picked = []) => {
    const q = addonSearch.trim().toLowerCase()
    if (!q) return true
    if ((picked || []).includes(String(addon._id || addon.id || ""))) return true
    return String(addon.name || addon.draft?.name || addon.published?.name || "").toLowerCase().includes(q)
  }
  useEffect(() => {
    const rid = String(foodForm.restaurantId || "")
    if (!rid) { setRestaurantAddons([]); return }
    let cancelled = false
    adminAPI.getAddons({ restaurantId: rid, limit: 100 })
      .then((res) => {
        const list = res?.data?.data?.addons || res?.data?.addons || res?.data?.data || []
        if (!cancelled) setRestaurantAddons(Array.isArray(list) ? list : [])
      })
      .catch(() => { if (!cancelled) setRestaurantAddons([]) })
    return () => { cancelled = true }
  }, [foodForm.restaurantId])

  const handleVariantChange = (variantId, field, value) => {
    setFoodForm((prev) => ({
      ...prev,
      variants: (Array.isArray(prev.variants) ? prev.variants : []).map((variant) =>
        variant.id === variantId ? { ...variant, [field]: value } : variant,
      ),
    }))
  }

  // The thumbs-up: adds the dish to the 99 store or takes it off. The server
  // refuses a dish priced above the store's cap and says why.
  const toggleShelf = async (food) => {
    const next = !onShelfIds.has(food.id)
    setShelfBusyId(food.id)
    try {
      await apiClient.patch(`/food/admin/foods/${food._id || food.id}/99-store`, { inStore: next }, { contextModule: "admin" })
      setOnShelfIds((prev) => {
        const updated = new Set(prev)
        if (next) updated.add(food.id)
        else updated.delete(food.id)
        return updated
      })
      setFoods((prev) => prev.map((f) => (f.id === food.id ? { ...f, showIn99Store: next, ninetyNineStoreExcluded: !next } : f)))
      toast.success(next ? `${food.name} added to the ₹${shelfCap} store` : `${food.name} removed from the ₹${shelfCap} store`)
    } catch (error) {
      toast.error(error?.response?.data?.message || `Could not update the ₹${shelfCap} store`)
    } finally {
      setShelfBusyId("")
    }
  }

  const toggleTrending = async (food) => {
    const next = food.isTrending !== true
    setTrendingBusyId(food.id)
    try {
      await apiClient.patch(`/food/admin/foods/${food._id || food.id}/trending`, { isTrending: next }, { contextModule: "admin" })
      setFoods((prev) => prev.map((f) => (f.id === food.id ? { ...f, isTrending: next } : f)))
      toast.success(next ? `${food.name} recommended: in Trending Now and its restaurant's Recommended` : `${food.name} no longer recommended`)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not update Recommended")
    } finally {
      setTrendingBusyId("")
    }
  }

  // Turns variants on with a first empty size, and brings the variant editor
  // into view -- from the price field, where an admin looks for it.
  const startVariants = () => {
    setFoodForm((prev) => ({
      ...prev,
      variantsEnabled: true,
      variants: Array.isArray(prev.variants) && prev.variants.length ? prev.variants : [createVariantDraft()],
    }))
    setTimeout(() => document.getElementById("food-variants")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)
  }

  const handleAddVariant = () => {
    setFoodForm((prev) => ({
      ...prev,
      variants: [...(Array.isArray(prev.variants) ? prev.variants : []), createVariantDraft()],
    }))
  }

  const handleRemoveVariant = (variantId) => {
    setFoodForm((prev) => ({
      ...prev,
      variants: (Array.isArray(prev.variants) ? prev.variants : []).filter((variant) => variant.id !== variantId),
    }))
  }

  const handleFoodFormSubmit = async () => {
    if (!foodForm.restaurantId) {
      toast.error("Please select a restaurant")
      return
    }
    if (!String(foodForm.categoryName || "").trim()) {
      toast.error("Please select or enter a category")
      return
    }
    if (!foodForm.name.trim()) {
      toast.error("Food name is required")
      return
    }

    const normalizedVariants = (Array.isArray(foodForm.variants) ? foodForm.variants : [])
      .map((variant) => ({
        id: String(variant?.id || variant?._id || "").trim(),
        name: String(variant?.name || "").trim(),
        price: Number(variant?.price),
        minOrderQuantity: variant?.minOrderQuantity ?? "",
        maxOrderQuantity: variant?.maxOrderQuantity ?? "",
        addonIds: Array.isArray(variant?.addonIds) ? variant.addonIds : [],
        addonPrices: variant?.addonPrices || {},
        stockQty: variant?.stockQty ?? "",
        lowStockThreshold: variant?.lowStockThreshold ?? "",
        stockChanged: (variant?.stockQty ?? "") !== (variant?.stockQtyAtLoad ?? ""),
        lowChanged: (variant?.lowStockThreshold ?? "") !== (variant?.lowStockAtLoad ?? ""),
        gstRate: variant?.gstRate ?? "",
      }))
      .filter((variant) => variant.id || variant.name || variant.price)

    const hasVariants = foodForm.variantsEnabled === true
    const parsedPrice = Number(foodForm.basePrice)

    if (normalizedVariants.some((variant) => !variant.name)) {
      toast.error("Each variant must have a name")
      return
    }

    if (normalizedVariants.some((variant) => !Number.isFinite(variant.price) || variant.price <= 0)) {
      toast.error("Each variant price must be greater than 0")
      return
    }

    if (hasVariants && normalizedVariants.length === 0) {
      toast.error("Add at least one variant, or switch variants off")
      return
    }
    if (!hasVariants && (!Number.isFinite(parsedPrice) || parsedPrice <= 0)) {
      toast.error("Base price must be greater than 0")
      return
    }

    if (isScheduleEmpty(foodForm.availabilitySchedule)) {
      toast.error("Turn on at least one day for the availability schedule, or switch it off")
      return
    }

    try {
      setSubmittingFood(true)
      let imageUrl = foodForm.image.trim()

      if (selectedImageFile) {
        const uploadResponse = await uploadAPI.uploadMedia(selectedImageFile, {
          folder: "foods",
        })
        imageUrl =
          uploadResponse?.data?.data?.url ||
          uploadResponse?.data?.url ||
          imageUrl
      }

      const payload = {
        restaurantId: foodForm.restaurantId,
        categoryId: foodForm.categoryId || undefined,
        categoryName: String(foodForm.categoryName || "").trim(),
        name: foodForm.name.trim(),
        basePrice: hasVariants ? undefined : parsedPrice,
        variantsEnabled: hasVariants,
        /*
         * discountPercent is deliberately NOT sent.
         *
         * It used to be hardcoded to 0, which meant opening any marked-down
         * dish and pressing Save silently undid the markdown: Eggitarion's Veg
         * Biryani sat at Rs 144 off Rs 180 after a -20% run, and one save with
         * nothing else edited put it back to Rs 180. The admin had repriced the
         * dish by 25% without being told.
         *
         * Omitted rather than sent, so the server keeps whatever discount is on
         * the dish. A new dish has none, so it still saves at the base price
         * exactly as before.
         */
      /*
       * Sent only when it says something: a new dish, a box the admin clicked,
       * or a tick the price just earned. Sending the untouched value on every
       * save recorded "the admin excluded this dish" for every dish above the
       * shelf price, so raising the price later never brought them in.
       */
      ...(foodFormMode === "add"
        || shelfTouched
        || (foodForm.showIn99Store === true) !== (editingFood?.showIn99Store === true)
        ? { showIn99Store: foodForm.showIn99Store === true }
        : {}),
      freeDelivery: foodForm.freeDelivery === true,
      // Food items only; the server checks it like the restaurant's own form.
      ...(isStockPanel ? {} : {
        packagingCharge: {
          isEnabled: foodForm.packagingEnabled === true,
          amount: Number(foodForm.packagingAmount) || 0,
          unitsPerCharge: Math.max(1, Math.floor(Number(foodForm.packagingUnits) || 1)),
        },
      }),
        otherPrice: foodForm.otherPrice === "" ? 0 : Number(foodForm.otherPrice),
        variants: normalizedVariants.map((variant) => ({
          ...(variant.id && !variant.id.startsWith("variant-") ? { _id: variant.id } : {}),
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
          // Priced pairings, same shape the restaurant panel sends. Blank price
          // means the add-on's own, stored as null.
          addons: (variant.addonIds || []).map((addonId) => {
            const raw = (variant.addonPrices || {})[addonId]
            const price = raw === undefined || raw === "" ? null : Number(raw)
            return { addonId, price: Number.isFinite(price) ? price : null }
          }),
          // Only a count the admin changed, so an open form does not put back
          // units that orders took meanwhile. Blank = stop counting.
          ...(isStockPanel && variant.stockChanged
            ? { stockQty: variant.stockQty === "" ? null : Number(variant.stockQty) }
            : {}),
          ...(isStockPanel && variant.lowChanged
            ? { lowStockThreshold: variant.lowStockThreshold === "" ? null : Number(variant.lowStockThreshold) }
            : {}),
          // Blank = the product's rate.
          ...(isStockPanel ? { gstRate: variant.gstRate === "" ? null : Number(variant.gstRate) } : {}),
        })),
        ...(isStockPanel && !foodForm.variantsEnabled ? productStockPayload() : {}),
        // Blank = the order-wide rate from fee settings.
        ...(isStockPanel ? { gstRate: foodForm.gstRate === "" ? null : Number(foodForm.gstRate) } : {}),
        description: foodForm.description.trim(),
        image: imageUrl,
        foodType: foodForm.foodType === "Veg" ? "Veg" : "Non-Veg",
        isAvailable: foodForm.isAvailable !== false,
        preparationTime: String(foodForm.preparationTime || "").trim(),
        minOrderQuantity: Number(foodForm.minOrderQuantity) || 0,
        maxOrderQuantity: Number(foodForm.maxOrderQuantity) || 0,
        availabilitySchedule: foodForm.availabilitySchedule,
        ...(Array.isArray(foodForm.suggestedItemIds) ? { suggestedItemIds: foodForm.suggestedItemIds } : {}),
      }

      if (foodFormMode === "edit") {
        await adminAPI.updateFood(editingFood?._id || editingFood?.id, payload)
      } else {
        await adminAPI.createFood(payload)
      }
      toast.success(foodFormMode === "edit" ? "Food updated successfully" : "Food added successfully")
      setShowFoodFormModal(false)
      setEditingFood(null)
      setFoodForm(createFoodForm())
      setSelectedImageFile(null)
      setImagePreviewUrl("")
      await fetchAllFoods()
    } catch (error) {
      debugError("Error saving food:", error)
      toast.error(error?.response?.data?.message || "Failed to save food")
    } finally {
      setSubmittingFood(false)
    }
  }

  const handleDelete = async (id) => {
    const food = foods.find(f => f.id === id)
    if (!food) return

    if (!window.confirm(`Are you sure you want to delete "${food.name}"? This action cannot be undone.`)) {
      return
    }

    try {
      setDeleting(true)
      await adminAPI.deleteFood(food?._id || food?.id)
      setFoods((prev) => prev.filter((f) => String(f.id) !== String(id)))
      toast.success("Food item deleted successfully")
    } catch (error) {
      debugError("Error deleting food:", error)
      toast.error(error?.response?.data?.message || "Failed to delete food item")
    } finally {
      setDeleting(false)
    }
  }

  const handleViewDetails = (food) => {
    setSelectedFood(food)
    setShowDetailModal(true)
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      {/* Header Section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-orange/80 to-accent-orange flex items-center justify-center">
            <div className="grid grid-cols-2 gap-0.5">
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
              <div className="w-2 h-2 bg-white rounded-sm"></div>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Food</h1>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Food List</h2>
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-slate-100 text-slate-700">
              {filteredFoods.length}
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={openAddFoodModal}
              className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Food</span>
            </button>
            <div className="relative flex-1 sm:flex-initial min-w-[200px]">
              <input
                type="text"
                placeholder="Ex : Foods"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2.5 w-full text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <select
              value={selectedRestaurant}
              onChange={(e) => setSelectedRestaurant(e.target.value)}
              className="px-4 py-2.5 min-w-[220px] text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
            >
              <option value="all">All Restaurants</option>
              {restaurantOptions.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className={SCROLL_TABLE_CLASS}>
          <table className="w-full">
            <thead className={`bg-slate-50 border-b border-slate-200 ${STICKY_THEAD_CLASS}`}>
              <tr>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  SL
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Image
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Restaurant
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-4 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider" title="The restaurant's own price; what the customer pays is shown under it when different">
                  Base Price
                </th>
                {isFoodPanel && (
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider" title="Showing in the app's under-price store right now">
                    {"₹"}{shelfCap} Store
                  </th>
                )}
                {isFoodPanel && (
                  <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider" title="One flag: recommended dishes show in the app's Trending Now and in their restaurant's Recommended section. The restaurant's own menu editor switches the same flag.">
                    Recommended
                  </th>
                )}
                <th className="px-6 py-4 text-center text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={isFoodPanel ? 9 : 7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                      <p className="text-sm text-slate-500">Loading foods...</p>
                    </div>
                  </td>
                </tr>
              ) : filteredFoods.length === 0 ? (
                <tr>
                  <td colSpan={isFoodPanel ? 9 : 7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center justify-center">
                      <p className="text-lg font-semibold text-slate-700 mb-1">No Data Found</p>
                      <p className="text-sm text-slate-500">No food items match your search or restaurant filter</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedFoods.map((food, index) => (
                  <tr
                    key={food.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-medium text-slate-700">{pagination.rowNumber(index)}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 flex items-center justify-center">
                        <img
                          src={withImageVersion(food.image)}
                          alt={food.name}
                          className="w-full h-full object-cover"
                          key={`${food.id}-${imageVersion}`}
                          loading="lazy"
                          onError={(e) => {
                            e.target.src = PLACEHOLDER_40
                          }}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{food.categoryName || "-"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-800">{food.restaurantName || "-"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{food.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <BasePriceCell food={food} />
                    </td>
                    {isFoodPanel && (
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {/* Thumbs up, filled green: in the app's store. Faint outline: not. Click to switch. */}
                        <button
                          type="button"
                          onClick={() => toggleShelf(food)}
                          disabled={shelfBusyId === food.id}
                          aria-pressed={onShelfIds.has(food.id)}
                          title={onShelfIds.has(food.id) ? `In the ₹${shelfCap} store — click to remove` : `Not in the ₹${shelfCap} store — click to add`}
                          aria-label={onShelfIds.has(food.id) ? `Remove ${food.name} from the ₹${shelfCap} store` : `Add ${food.name} to the ₹${shelfCap} store`}
                          className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-slate-100 disabled:opacity-50"
                        >
                          {shelfBusyId === food.id ? (
                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                          ) : onShelfIds.has(food.id) ? (
                            <ThumbsUp className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                          ) : (
                            <ThumbsUp className="w-5 h-5 text-slate-300 hover:text-emerald-500" />
                          )}
                        </button>
                      </td>
                    )}
                    {isFoodPanel && (
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {/* Thumbs up, filled orange: recommended (Trending Now + the restaurant's Recommended). Faint outline: not. Click to switch. */}
                        <button
                          type="button"
                          onClick={() => toggleTrending(food)}
                          disabled={trendingBusyId === food.id}
                          aria-pressed={food.isTrending === true}
                          title={food.isTrending ? "Recommended (Trending Now + restaurant's Recommended) — click to remove" : "Not recommended — click to recommend"}
                          aria-label={food.isTrending ? `Stop recommending ${food.name}` : `Recommend ${food.name}`}
                          className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-slate-100 disabled:opacity-50"
                        >
                          {trendingBusyId === food.id ? (
                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                          ) : food.isTrending ? (
                            <ThumbsUp className="w-5 h-5 text-orange-500 fill-orange-100" />
                          ) : (
                            <ThumbsUp className="w-5 h-5 text-slate-300 hover:text-orange-500" />
                          )}
                        </button>
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleViewDetails(food)}
                          className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openEditFoodModal(food)}
                          className="p-1.5 rounded text-amber-600 hover:bg-amber-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(food.id)}
                          disabled={deleting}
                          className="p-1.5 rounded text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete"
                        >
                          {deleting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && <TablePagination pagination={pagination} label="dishes" />}
      </div>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent
          description="Read-only details for the selected dish, including its pricing, category and availability."
          className="max-w-xl p-0 overflow-hidden"
        >
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">Food Details</DialogTitle>
          </DialogHeader>
          {selectedFood && (
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-4">
                <img
                          src={withImageVersion(selectedFood.image)}
                          alt={selectedFood.name}
                          className="w-20 h-20 rounded-xl object-cover border border-slate-200"
                  onError={(e) => {
                    e.target.src = PLACEHOLDER_64
                  }}
                />
                <div>
                  <p className="text-lg font-semibold text-slate-900">{selectedFood.name}</p>
                  <p className="text-sm text-slate-500 mt-0.5">ID #{formatFoodId(selectedFood.id)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p><span className="font-semibold text-slate-700">Restaurant:</span> <span className="text-slate-900">{selectedFood.restaurantName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Price:</span> <span className="text-slate-900">{selectedFood.variants?.length ? `Starting from \u20B9${selectedFood.price}` : `\u20B9${selectedFood.price}`}</span></p>
                <p><span className="font-semibold text-slate-700">Category:</span> <span className="text-slate-900">{selectedFood.categoryName || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Food Type:</span> <span className="text-slate-900">{selectedFood.foodType || "-"}</span></p>
                <p><span className="font-semibold text-slate-700">Approval:</span> <span className="text-slate-900 capitalize">{selectedFood.approvalStatus || "-"}</span></p>
              </div>
              {selectedFood.variants?.length ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-2">Variants</p>
                  <div className="space-y-2">
                    {selectedFood.variants.map((variant) => (
                      <div key={variant.id || variant._id} className="flex items-center justify-between text-sm text-slate-700">
                        <span>{variant.name}</span>
                        <span className="font-semibold text-slate-900">{"\u20B9"}{variant.price}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedFood.description && (
                <p className="text-sm text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-800">Description:</span> {selectedFood.description}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={showFoodFormModal}
        onOpenChange={(open) => {
          setShowFoodFormModal(open)
          if (!open) {
            setEditingFood(null)
            setFoodForm(createFoodForm())
            setCategoryOptions([])
            setCategorySearch("")
            setCategoryPopoverOpen(false)
            setSelectedImageFile(null)
            setImagePreviewUrl("")
          }
        }}
      >
        <DialogContent
          description={
            foodFormMode === "edit"
              ? "Edit this dish's name, category, pricing and availability. The formulation price is set from Global Price Adjustment and is shown here read-only."
              : "Add a dish to a restaurant's menu: name, category, base price and availability."
          }
          className="max-w-2xl p-0 overflow-hidden"
        >
          <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {foodFormMode === "edit" ? "Edit Food" : "Add Food"}
            </DialogTitle>
          </DialogHeader>
          <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Restaurant</label>
                <select
                  value={foodForm.restaurantId}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, restaurantId: e.target.value, categoryId: "", categoryName: "" }))}
                  disabled={foodFormMode === "edit"}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100"
                >
                  <option value="">Select restaurant</option>
                  {restaurantOptions.map((restaurant) => (
                    <option key={restaurant.id} value={restaurant.id}>
                      {restaurant.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-left flex items-center justify-between"
                    >
                      <span className={foodForm.categoryName ? "text-slate-900" : "text-slate-400"}>
                        {foodForm.categoryName || "Select category"}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm bg-white mb-2"
                      placeholder="Search category..."
                      autoFocus
                    />
                    <div className="max-h-56 overflow-y-auto">
                      {categoryOptions
                        .filter((c) => {
                          const q = String(categorySearch || "").trim().toLowerCase()
                          if (!q) return true
                          return String(c.name || "").toLowerCase().includes(q)
                        })
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setFoodForm((prev) => ({ ...prev, categoryId: c.id, categoryName: c.name }))
                              setCategoryPopoverOpen(false)
                            }}
                            className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-slate-100 ${
                              String(foodForm.categoryName || "") === String(c.name) ? "bg-slate-100 font-medium" : ""
                            }`}
                          >
                            {c.name}
                          </button>
                        ))}
                      {categoryOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-slate-500">No categories found</div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Food Name</label>
                <input
                  type="text"
                  value={foodForm.name}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Base Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={foodForm.basePrice}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, basePrice: e.target.value }))}
                  disabled={foodForm.variantsEnabled === true}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                />
                {foodForm.variantsEnabled === true ? (
                  <p className="mt-1 text-xs text-slate-500">Selling by variants: customers see the lowest variant price as the starting price.</p>
                ) : (
                  <button
                    type="button"
                    onClick={startVariants}
                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {Array.isArray(foodForm.variants) && foodForm.variants.length
                      ? `Sell by variants (${foodForm.variants.length} saved)`
                      : "Add variants (Half / Full, sizes)"}
                  </button>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  The restaurant&rsquo;s own price. Global Price Adjustment never changes it.
                </p>
              </div>

              {/*
                The formulation price, read-only.

                It is derived -- basePrice x (1 + formulationPercent / 100) --
                so making it editable here would give the admin two ways to set
                one number and no way to tell which won. Shown rather than
                hidden because it is what the customer sees, and the form used
                to display "Base Price 180" on a dish selling at 144 while
                saying nothing about the gap.
              */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Formulation price</label>
                {(() => {
                  const base = Number(foodForm.basePrice)
                  const percent = Number(foodForm.formulationPercent) || 0
                  if (!Number.isFinite(base) || base <= 0) {
                    return (
                      <div className="w-full px-3 py-2.5 border border-dashed border-slate-300 rounded-lg text-sm text-slate-400 bg-slate-50">
                        Set a base price first
                      </div>
                    )
                  }
                  const formulation = Math.round(base * (1 + percent / 100) * 100) / 100
                  const pays = Math.min(base, formulation)
                  const struck = Math.max(base, formulation)
                  const hasStrike = struck > pays
                  return (
                    <>
                      <div className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-900 font-semibold tabular-nums">
                        {"₹"}{formulation.toFixed(2)}
                        <span className="ml-2 font-normal text-slate-500">
                          {percent === 0
                            ? "no adjustment"
                            : `${percent > 0 ? "+" : ""}${percent}% of base`}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">
                        Customers pay <span className="font-semibold">{"₹"}{pays.toFixed(2)}</span>
                        {hasStrike ? (
                          <>
                            {" "}with <span className="line-through text-slate-400">{"₹"}{struck.toFixed(2)}</span>{" "}
                            struck through ({Math.round((1 - pays / struck) * 100)}% off).
                          </>
                        ) : (
                          <>, with nothing struck through.</>
                        )}
                        {" "}Set from Global Price Adjustment, not here.
                      </p>
                    </>
                  )
                })()}
              </div>
              {/* Comparison figure only. Customers are charged the base price above;
                  this is struck through beside it, and a global price adjustment
                  moves this and nothing else. */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Other platform price (optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={foodForm.otherPrice}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, otherPrice: e.target.value }))}
                  placeholder="What other apps charge"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                />
                {(() => {
                  const base = Number(foodForm.basePrice)
                  const other = Number(foodForm.otherPrice)
                  if (!Number.isFinite(base) || base <= 0) {
                    return <p className="mt-1 text-xs text-slate-500">Shown struck through beside your price.</p>
                  }
                  if (!Number.isFinite(other) || other <= base) {
                    return <p className="mt-1 text-xs text-slate-500">Set it above your price to show a comparison.</p>
                  }
                  const off = Math.round(((other - base) / other) * 100)
                  return (
                    <p className="mt-1 text-xs text-slate-600">
                      Customers see <span className="line-through text-slate-400">{"₹"}{other}</span>{" "}
                      <span className="font-semibold">{"₹"}{base}</span> ({off}% OFF)
                    </p>
                  )
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {"₹"}{shelfCap} Store
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={foodForm.showIn99Store === true}
                    onChange={(e) => {
                      setShelfTouched(true)
                      setFoodForm((prev) => ({ ...prev, showIn99Store: e.target.checked }))
                    }}
                    className="h-4 w-4 accent-slate-900"
                  />
                  <span>Show in the {"₹"}{shelfCap} store</span>
                </label>
                {(() => {
                  // The shelf applies its price when it is read, so a dish above it
                  // is simply not shown. Say so rather than let the admin tick a box
                  // that quietly does nothing.
                  const eligible = Number.isFinite(shelfPrice) && shelfPrice > 0 && shelfPrice <= shelfCap
                  if (foodForm.showIn99Store !== true) {
                    return (
                      <p className="mt-1 text-xs text-slate-500">
                        {eligible
                          ? `Priced within ₹${shelfCap}, but kept off the store.`
                          : `Dishes at ₹${shelfCap} or less are added automatically.`}
                      </p>
                    )
                  }
                  if (Number.isFinite(shelfPrice) && shelfPrice > shelfCap) {
                    return (
                      <p className="mt-1 text-xs text-amber-700">
                        At {"₹"}{shelfPrice} this stays hidden {"—"} the store only shows dishes at {"₹"}{shelfCap} or less.
                      </p>
                    )
                  }
                  return (
                    <p className="mt-1 text-xs text-slate-600">
                      Will appear in the app{"’"}s {"₹"}{shelfCap} store.
                    </p>
                  )
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Free delivery
                </label>
                <label className="flex items-center gap-2 px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={foodForm.freeDelivery === true}
                    onChange={(e) => setFoodForm((prev) => ({ ...prev, freeDelivery: e.target.checked }))}
                    className="h-4 w-4 accent-slate-900"
                  />
                  <span>Ship this dish free</span>
                </label>
                <p className="mt-1 text-xs text-slate-500">
                  The fee is waived only when every dish in the order ships free {"—"} otherwise
                  one cheap free-delivery item would make any basket free. The rider is still paid;
                  the platform absorbs it.
                </p>
              </div>
              {!isStockPanel && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Packaging charge
                  </label>
                  <label className="flex items-center gap-2 px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={foodForm.packagingEnabled === true}
                      onChange={(e) => setFoodForm((prev) => ({ ...prev, packagingEnabled: e.target.checked }))}
                      className="h-4 w-4 accent-slate-900"
                    />
                    <span>Charge for packaging on this dish</span>
                  </label>
                  {foodForm.packagingEnabled && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <span className="mb-1 block text-xs text-slate-600">Charge ({"₹"})</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={foodForm.packagingAmount}
                          onChange={(e) => setFoodForm((prev) => ({ ...prev, packagingAmount: e.target.value }))}
                          placeholder="e.g. 10"
                          className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                        />
                      </div>
                      <div>
                        <span className="mb-1 block text-xs text-slate-600">Per how many units</span>
                        <input
                          type="number"
                          min="1"
                          max="999"
                          step="1"
                          value={foodForm.packagingUnits}
                          onChange={(e) => setFoodForm((prev) => ({ ...prev, packagingUnits: e.target.value.replace(/[^0-9]/g, "") }))}
                          className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                        />
                      </div>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {foodForm.packagingEnabled && Number(foodForm.packagingUnits) > 1
                      ? `1${"–"}${foodForm.packagingUnits} units pay one charge, ${Number(foodForm.packagingUnits) + 1}${"–"}${Number(foodForm.packagingUnits) * 2} pay two, and so on.`
                      : "Applies when packaging is charged by restaurants (Packaging Charges page)."}
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Food Type</label>
                <select
                  value={foodForm.foodType}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, foodType: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="Veg">Veg</option>
                  <option value="Non-Veg">Non-Veg</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Upload Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setSelectedImageFile(file)
                    if (file) {
                      setImagePreviewUrl(URL.createObjectURL(file))
                    } else {
                      setImagePreviewUrl(foodForm.image.trim())
                    }
                  }}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
                />
              </div>
              {Array.isArray(foodForm.suggestedItemIds) && foodForm.restaurantId && (
                <div className="col-span-full">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Goes well with <span className="text-slate-400 font-normal">({foodForm.suggestedItemIds.length}/10, shown both ways)</span>
                  </label>
                  {(() => {
                    const selfId = String(editingFood?.id || editingFood?._id || "")
                    const sameRestaurant = foods.filter((f) => f.restaurantId === foodForm.restaurantId && f.id !== selfId)
                    const byId = new Map(sameRestaurant.map((f) => [f.id, f]))
                    const picked = foodForm.suggestedItemIds
                    const q = pairingSearch.trim().toLowerCase()
                    const options = sameRestaurant
                      .filter((f) => !picked.includes(f.id))
                      .filter((f) => !q || String(f.name || "").toLowerCase().includes(q))
                      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
                    const full = picked.length >= 10
                    const remove = (id) => setFoodForm((prev) => ({ ...prev, suggestedItemIds: prev.suggestedItemIds.filter((x) => x !== id) }))
                    return (
                      <>
                        {/* Picked dishes as chips -- including any no longer on
                            this menu, so they can be seen and removed. */}
                        {picked.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {picked.map((id) => (
                              <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-1 pl-3 pr-1 text-sm text-slate-800">
                                {byId.get(id)?.name || "Dish no longer on this menu"}
                                <button
                                  type="button"
                                  onClick={() => remove(id)}
                                  aria-label={`Remove ${byId.get(id)?.name || "dish"}`}
                                  className="rounded-full px-1.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr]">
                          <input
                            type="search"
                            value={pairingSearch}
                            onChange={(e) => setPairingSearch(e.target.value)}
                            placeholder="Search dishes"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                          <select
                            value=""
                            disabled={full || options.length === 0}
                            onChange={(e) => {
                              const id = e.target.value
                              if (!id) return
                              setFoodForm((prev) =>
                                prev.suggestedItemIds.includes(id) || prev.suggestedItemIds.length >= 10
                                  ? prev
                                  : { ...prev, suggestedItemIds: [...prev.suggestedItemIds, id] },
                              )
                              setPairingSearch("")
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <option value="">
                              {full
                                ? "10 dishes picked (the most allowed)"
                                : options.length === 0
                                  ? q ? `No dish matches "${pairingSearch.trim()}"` : "No other dishes on this menu"
                                  : `Add a dish (${options.length})`}
                            </option>
                            {options.map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}
              <div>
                {isStockPanel && (
                  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-800">Stock</p>
                    {foodForm.variantsEnabled ? (
                      <p className="mt-1 text-xs text-slate-500">Sold by size: each size has its own count in the variants below, or on the Stock page.</p>
                    ) : (
                      <>
                        <p className="mt-1 text-xs text-slate-500">Orders reduce it automatically. Leave empty to sell without a limit.</p>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">In stock</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={foodForm.stockQty}
                              onChange={(e) => setFoodForm((prev) => ({ ...prev, stockQty: e.target.value.replace(/[^0-9]/g, "") }))}
                              placeholder="No limit"
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Warn at <span className="text-slate-400">(optional)</span></label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={foodForm.lowStockThreshold}
                              onChange={(e) => setFoodForm((prev) => ({ ...prev, lowStockThreshold: e.target.value.replace(/[^0-9]/g, "") }))}
                              placeholder="No warning"
                              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                            />
                          </div>
                        </div>
                      </>
                    )}
                    <div className="mt-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1">GST</label>
                      <select
                        value={foodForm.gstRate}
                        onChange={(e) => setFoodForm((prev) => ({ ...prev, gstRate: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                      >
                        <option value="">Standard rate (fee settings)</option>
                        {GST_SLABS.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
                      </select>
                      {foodForm.variantsEnabled && (
                        <p className="mt-1 text-xs text-slate-500">Sizes use this unless they set their own GST below.</p>
                      )}
                    </div>
                  </div>
                )}
                <label className="block text-sm font-medium text-slate-700 mb-1">Timing</label>
                <div className="relative">
                  <select
                  value={foodForm.preparationTime}
                  onChange={(e) => setFoodForm((prev) => ({ ...prev, preparationTime: e.target.value }))}
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm bg-white appearance-none"
                  >
                    <option value="">Select timing</option>
                    <option value="10-20 mins">10-20 mins</option>
                    <option value="20-25 mins">20-25 mins</option>
                    <option value="25-35 mins">25-35 mins</option>
                    <option value="35-45 mins">35-45 mins</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                </div>
                {/* The same pair as the restaurant's item form. Sizes can set
                    their own limits under Variants. */}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Min Order Quantity</label>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={foodForm.minOrderQuantity}
                      onChange={(e) => setFoodForm((prev) => ({ ...prev, minOrderQuantity: e.target.value.replace(/[^0-9]/g, "") }))}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Max Order Quantity</label>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={foodForm.maxOrderQuantity}
                      onChange={(e) => setFoodForm((prev) => ({ ...prev, maxOrderQuantity: e.target.value.replace(/[^0-9]/g, "") }))}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <p className="col-span-2 text-xs text-slate-500">0 means no minimum / no limit. Sizes can set their own under Variants.</p>
                </div>
              </div>
              <div className="md:col-span-2">
                <ItemAvailabilityScheduleEditor
                  value={foodForm.availabilitySchedule}
                  onChange={(next) => setFoodForm((prev) => ({ ...prev, availabilitySchedule: next }))}
                />
              </div>
              {imagePreviewUrl ? (
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Image Preview</label>
                  <div className="w-28 h-28 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    <img
                      src={imagePreviewUrl}
                      alt="Food preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex items-center gap-6 pt-7">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={foodForm.isAvailable}
                    onChange={(e) => setFoodForm((prev) => ({ ...prev, isAvailable: e.target.checked }))}
                  />
                  Available
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                rows={4}
                value={foodForm.description}
                onChange={(e) => setFoodForm((prev) => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white resize-none"
              />
            </div>
            <div id="food-variants" className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Variants</p>
                  <p className="text-xs text-slate-500">
                    {foodForm.variantsEnabled
                      ? "Customers pick a size; each has its own price and add-ons."
                      : "Switched off: kept for later, customers pay the base price."}
                  </p>
                </div>
                {/* Shared Switch, not a hand-rolled pill -- global button
                    styling turned the manual one into an unreadable blob. Off
                    keeps the rows in state; the editor below simply hides. */}
                <Switch
                  checked={foodForm.variantsEnabled === true}
                  onCheckedChange={(next) => setFoodForm((prev) => ({ ...prev, variantsEnabled: next === true }))}
                />
                {foodForm.variantsEnabled === true && (
                <button
                  type="button"
                  onClick={handleAddVariant}
                  className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add variant
                </button>
                )}
              </div>
              {/* Rows only while selling by variants; drafts stay in state
                  either way, so toggling back on restores them untouched. */}
              {foodForm.variantsEnabled === true && ((foodForm.variants || []).length ? (
                <div className="space-y-3">
                  {(foodForm.variants || []).map((variant, index) => (
                    <div key={variant.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Variant name</label>
                          <input
                            type="text"
                            value={variant.name}
                            onChange={(e) => handleVariantChange(variant.id, "name", e.target.value)}
                            placeholder={index === 0 ? "Full" : "Half"}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">Base Price</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={variant.price}
                            onChange={(e) => handleVariantChange(variant.id, "price", e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                          <p className="mt-1 text-[11px] text-slate-500">
                            This size&rsquo;s own price. Global Price Adjustment never changes it.
                          </p>

                          {/*
                            The same base/formulation pair the dish itself gets, per size.

                            Each size is derived from its OWN base, so the saving is a
                            different rupee amount on every one -- which is exactly what
                            was wrong before, when a single flat figure was applied to
                            them all.
                          */}
                          <label className="block text-xs font-medium text-slate-600 mt-3 mb-1">Formulation price</label>
                          {(() => {
                            const base = Number(variant.price)
                            const percent = Number(foodForm.formulationPercent) || 0
                            if (!Number.isFinite(base) || base <= 0) {
                              return (
                                <div className="w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-400 bg-slate-50">
                                  Set a base price first
                                </div>
                              )
                            }
                            const formulation = Math.round(base * (1 + percent / 100) * 100) / 100
                            const pays = Math.min(base, formulation)
                            const struck = Math.max(base, formulation)
                            const hasStrike = struck > pays
                            return (
                              <>
                                <div className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-900 font-semibold tabular-nums">
                                  {"₹"}{formulation.toFixed(2)}
                                  <span className="ml-2 font-normal text-slate-500 text-xs">
                                    {percent === 0 ? "no adjustment" : `${percent > 0 ? "+" : ""}${percent}% of base`}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-600">
                                  Customers pay <span className="font-semibold">{"₹"}{pays.toFixed(2)}</span>
                                  {hasStrike ? (
                                    <>
                                      {" "}with <span className="line-through text-slate-400">{"₹"}{struck.toFixed(2)}</span>{" "}
                                      struck through ({Math.round((1 - pays / struck) * 100)}% off).
                                    </>
                                  ) : (
                                    <>, with nothing struck through.</>
                                  )}
                                  {" "}Set from Global Price Adjustment, not here.
                                </p>
                              </>
                            )
                          })()}
                        </div>

                        {/* Per-size order limits. Sizes do not sell alike: a family
                            pack may cap at two while a half plate goes out in tens,
                            and a per-piece size may need a minimum the boxed size
                            should not inherit. Left blank, this size keeps the
                            dish's own limit. */}
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Min qty <span className="text-slate-400">(optional)</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={variant.minOrderQuantity ?? ""}
                            onChange={(e) => handleVariantChange(variant.id, "minOrderQuantity", e.target.value)}
                            placeholder="Uses the item's"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            Max qty <span className="text-slate-400">(optional)</span>
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={variant.maxOrderQuantity ?? ""}
                            onChange={(e) => handleVariantChange(variant.id, "maxOrderQuantity", e.target.value)}
                            placeholder="Uses the item's"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                          />
                        </div>
                        {isStockPanel && (
                          <>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">In stock</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={variant.stockQty ?? ""}
                                onChange={(e) => handleVariantChange(variant.id, "stockQty", e.target.value.replace(/[^0-9]/g, ""))}
                                placeholder="No limit"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Warn at <span className="text-slate-400">(optional)</span>
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={variant.lowStockThreshold ?? ""}
                                onChange={(e) => handleVariantChange(variant.id, "lowStockThreshold", e.target.value.replace(/[^0-9]/g, ""))}
                                placeholder="No warning"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">GST for this size</label>
                              <select
                                value={variant.gstRate ?? ""}
                                onChange={(e) => handleVariantChange(variant.id, "gstRate", e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                              >
                                <option value="">Same as product</option>
                                {GST_SLABS.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
                              </select>
                            </div>
                          </>
                        )}

                        {/* Add-ons paired to this size, each with its own price --
                            cheese on a large is more cheese than on a small.
                            Blank price uses the add-on's usual one. */}
                        {restaurantAddons.length > 0 && (
                          <div className="md:col-span-2 pt-2 border-t border-slate-200/70">
                            <label className="block text-xs font-medium text-slate-600 mb-1.5">
                              Add-ons for this variant
                              {(variant.addonIds || []).length > 0 && (
                                <span className="ml-1 font-semibold text-slate-800">
                                  ({(variant.addonIds || []).length})
                                </span>
                              )}
                            </label>
                            <input
                                      type="search"
                                      value={addonSearch}
                                      onChange={(e) => setAddonSearch(e.target.value)}
                                      placeholder="Search add-ons"
                                      className="mb-2 w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                                    />
                            <div className="flex flex-wrap gap-1.5">
                              {restaurantAddons.filter((addon) => addonVisible(addon, variant.addonIds)).map((addon) => {
                                const addonId = String(addon._id || addon.id || "")
                                const isChecked = (variant.addonIds || []).includes(addonId)
                                const addonName = addon.name || addon.published?.name || addon.draft?.name || "Add-on"
                                const ownPrice = addon.price ?? addon.published?.price ?? addon.draft?.price ?? 0
                                return (
                                  <div
                                    key={addonId}
                                    className={`inline-flex items-center gap-1 rounded-lg border transition-colors ${
                                      isChecked ? "bg-slate-900 border-slate-900" : "bg-white border-slate-300 hover:bg-slate-50"
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleVariantChange(
                                          variant.id,
                                          "addonIds",
                                          isChecked
                                            ? (variant.addonIds || []).filter((x) => x !== addonId)
                                            : [...(variant.addonIds || []), addonId]
                                        )
                                      }
                                      className={`px-2.5 py-1 text-xs font-medium ${isChecked ? "text-white" : "text-slate-700"}`}
                                    >
                                      {addonName}
                                    </button>
                                    {isChecked && (
                                      <span className="flex items-center gap-0.5 pr-1.5">
                                        <span className="text-[10px] text-slate-300">{"₹"}</span>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={(variant.addonPrices || {})[addonId] ?? ""}
                                          placeholder={String(ownPrice)}
                                          onChange={(e) => {
                                            const value = e.target.value.replace(/[^0-9.]/g, "")
                                            const parts = value.split(".")
                                            const cleaned = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : value
                                            handleVariantChange(variant.id, "addonPrices", {
                                              ...(variant.addonPrices || {}),
                                              [addonId]: cleaned,
                                            })
                                          }}
                                          className="w-12 rounded bg-slate-800 px-1 py-0.5 text-right text-[11px] font-semibold text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-white/40"
                                        />
                                      </span>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveVariant(variant.id)}
                        className="self-start rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-500"
                        aria-label="Remove variant"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No variants added. This food will use the single base price.</p>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleFoodFormSubmit}
                disabled={submittingFood}
                className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
              >
                {submittingFood ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{submittingFood ? "Saving..." : foodFormMode === "edit" ? "Update Food" : "Add Food"}</span>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

