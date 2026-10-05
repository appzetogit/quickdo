const toArray = (value) => (Array.isArray(value) ? value : [])

export const normalizeFoodVariants = (value) =>
  toArray(value)
    .map((entry = {}, index) => {
      const id = String(entry?.id || entry?._id || `variant-${index}`)
      const name = String(entry?.name || "").trim()
      const price = Number(entry?.price)
      if (!name || !Number.isFinite(price) || price <= 0) return null

      const basePrice = Number(entry?.basePrice)
      const strikePrice = Number(entry?.strikePrice)

      return {
        id,
        _id: id,
        name,
        price,
        /*
         * The size's own base, and the figure struck beside it.
         *
         * These were dropped here, and this is the one place BOTH editors load
         * through -- so the admin panel and the restaurant portal each showed
         * `price`, the figure AFTER the global adjustment, in a box labelled
         * "Base Price". Margherita Pizza's Small sat at a base of 120 and the box
         * read 72 once 40% was standing. Every fix upstream was thrown away at
         * this line.
         *
         * null rather than a fallback to `price`: the caller has to be able to
         * tell "no base recorded" from "a base that happens to equal the price",
         * and quietly substituting the charged figure is how it got written back
         * as the base in the first place.
         */
        basePrice: Number.isFinite(basePrice) && basePrice > 0 ? basePrice : null,
        strikePrice: Number.isFinite(strikePrice) && strikePrice > 0 ? strikePrice : null,
        // Per-variant add-on pairings must survive normalisation, or the picker
        // can neither offer a variant-only add-on nor show its per-size price --
        // the customer would see the published price and be charged the pairing's.
        addonIds: toArray(entry?.addonIds).map((v) => String(v?._id ?? v?.id ?? v)).filter(Boolean),
        addons: toArray(entry?.addons)
          .map((pair) => ({
            addonId: String(pair?.addonId ?? ""),
            price: pair?.price ?? null,
          }))
          .filter((pair) => pair.addonId),
        // Stock per size (stores). Kept through here for the same reason as the
        // base price: the editor loads through this, and a dropped field is
        // written back blank -- which would switch the size's counting off.
        stockQty: entry?.stockQty ?? null,
        lowStockThreshold: entry?.lowStockThreshold ?? null,
        sku: entry?.sku || "",
        // GST % per size (stores); null = the product's rate.
        gstRate: entry?.gstRate ?? null,
      }
    })
    .filter(Boolean)

/**
 * The variants a CUSTOMER can buy. The toggle beats the array: a dish with
 * variants switched off keeps them stored, but the app must neither show a
 * size picker nor price from them. Absent flag = legacy row = sell by
 * variants if any exist, which is what those rows always did.
 */
export const getFoodVariants = (item = {}) =>
  item?.variantsEnabled === false
    ? []
    : normalizeFoodVariants(item?.variants || item?.variations || [])

/**
 * The variants as STORED, toggle ignored -- for the seller and admin editors,
 * which must show the retained configuration behind an off switch. Using the
 * customer accessor there would hydrate an empty editor and the next save
 * would wipe what the toggle was protecting.
 */
export const getStoredFoodVariants = (item = {}) =>
  normalizeFoodVariants(item?.variants || item?.variations || [])

export const hasFoodVariants = (item = {}) => getFoodVariants(item).length > 0

export const getDefaultFoodVariant = (item = {}) => getFoodVariants(item)[0] || null

export const getFoodDisplayPrice = (item = {}) => {
  const variants = getFoodVariants(item)
  if (variants.length > 0) {
    return Math.min(...variants.map((variant) => Number(variant.price) || 0))
  }

  const price = Number(item?.price)
  return Number.isFinite(price) ? price : 0
}

export const getFoodPriceLabel = (item = {}) => {
  const price = getFoodDisplayPrice(item)
  return hasFoodVariants(item) ? `Starting from ₹${Math.round(price)}` : `₹${Math.round(price)}`
}

/**
 * Identity of one cart line.
 *
 * Add-ons are part of it: a burger with extra cheese and a plain burger are two
 * different things to make and two different prices, so they cannot share a line
 * or incrementing one would silently change the other. Ids are sorted so the same
 * selection made in a different order is still the same line.
 *
 * The third argument is optional, so callers that predate add-ons keep producing
 * exactly the ids they always did.
 */
export const buildCartLineId = (itemId, variantId = "", addonIds = []) => {
  const base = `${String(itemId || "")}::${String(variantId || "base")}`
  const ids = (Array.isArray(addonIds) ? addonIds : [addonIds])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .sort()
  return ids.length ? `${base}::${ids.join("+")}` : base
}
