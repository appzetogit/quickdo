/**
 * Quick-commerce store types.
 *
 * Mirrors Backend/src/modules/quickCommerce/modules/food/shared/storeType.js. The
 * server is the authority and revalidates every write.
 *
 * The food admin and the quick-commerce admin are the same screens on two routes,
 * so anything store-type related has to render only under /admin/quick-commerce.
 */

export const STORE_TYPES = [
  { value: 'grocery', label: 'Grocery' },
  { value: 'kirana', label: 'Kirana' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'pet', label: 'Pet Supplies' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'stationery', label: 'Stationery' },
  { value: 'general', label: 'General Store' },
]

export const DEFAULT_STORE_TYPE = 'grocery'

/*
 * No longer offered: a store cannot be created as or switched to it, but one
 * that already has it may keep it, so it is still labelled and shown when it
 * is the current value.
 */
const LEGACY_STORE_TYPES = [{ value: 'pharmacy', label: 'Pharmacy (legacy)' }]

/** The selectable types, plus `current` when it is a legacy one. */
export const storeTypeOptions = (current) => {
  const legacy = LEGACY_STORE_TYPES.find((t) => t.value === current)
  return legacy ? [...STORE_TYPES, legacy] : STORE_TYPES
}

export const storeTypeLabel = (value) =>
  [...STORE_TYPES, ...LEGACY_STORE_TYPES].find((t) => t.value === value)?.label || value || ''

/**
 * True while the admin is in the quick-commerce vertical.
 *
 * Keyed on the browser path, the same signal the axios interceptor uses to swap
 * /v1/food/admin for /v1/qc/admin, so the UI and the API it talks to can never
 * disagree about which vertical is on screen.
 */
export const isQuickCommerceAdminPath = (pathname) =>
  String(pathname || (typeof window !== 'undefined' ? window.location.pathname : ''))
    .startsWith('/admin/quick-commerce')
