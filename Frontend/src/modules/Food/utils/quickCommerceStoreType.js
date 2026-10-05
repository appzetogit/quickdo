/**
 * Quick-commerce store types, and the medical-licence rule that follows from them.
 *
 * Mirrors Backend/src/modules/quickCommerce/modules/food/shared/storeType.js. The
 * server is the authority -- it revalidates every write and refuses a pharmacy
 * without a current drug licence -- this exists so the admin sees the right fields
 * and gets told before submitting rather than after.
 *
 * The food admin and the quick-commerce admin are the same screens on two routes,
 * so anything store-type related has to render only under /admin/quick-commerce.
 */

export const STORE_TYPES = [
  { value: 'grocery', label: 'Grocery' },
  { value: 'kirana', label: 'Kirana' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'pharmacy', label: 'Medical / Pharmacy' },
  { value: 'pet', label: 'Pet Supplies' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'stationery', label: 'Stationery' },
  { value: 'general', label: 'General Store' },
]

export const DEFAULT_STORE_TYPE = 'grocery'
export const MEDICAL_STORE_TYPE = 'pharmacy'

export const isMedicalStore = (storeType) =>
  String(storeType || '').trim().toLowerCase() === MEDICAL_STORE_TYPE

export const storeTypeLabel = (value) =>
  STORE_TYPES.find((t) => t.value === value)?.label || value || ''

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

/**
 * Client-side mirror of the server rule, for pre-submit feedback.
 * @returns {string} an error message, or '' when the seller is acceptable
 */
export const medicalLicenceError = (form = {}) => {
  if (!isMedicalStore(form.storeType)) return ''
  if (!String(form.drugLicenseNumber || '').trim()) return 'Enter the drug licence number for a medical store'
  if (!form.drugLicenseImage) return 'Upload a photo of the drug licence for a medical store'
  if (!String(form.drugLicenseExpiry || '').trim()) return 'Enter the drug licence expiry date for a medical store'
  const expiry = new Date(form.drugLicenseExpiry)
  if (Number.isNaN(expiry.getTime())) return 'Drug licence expiry is not a valid date'
  if (expiry.getTime() <= Date.now()) return 'This drug licence has expired. Upload a current one.'
  return ''
}
