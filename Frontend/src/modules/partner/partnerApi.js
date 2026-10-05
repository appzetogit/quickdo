import apiClient, { RESTAURANT_VERTICAL_KEY } from "@food/api/axios"
import { setAuthData } from "@food/utils/auth"

/**
 * Partner sign-up API (/qc/partner). Stores and medical stores only; restaurants
 * keep their own sign-up under /food/restaurant.
 *
 * The onboarding token is sent explicitly and the request carries its own
 * context module, so the shared client never attaches a customer or admin login
 * that happens to be stored in this browser.
 */
const ctx = (token) => ({
  contextModule: "partner",
  ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
})

const unwrap = (res) => res?.data?.data ?? res?.data ?? {}

export const partnerApi = {
  requestOtp: (phone, type) =>
    apiClient.post("/qc/partner/request-otp", { phone, type }, ctx()).then(unwrap),
  verifyOtp: (phone, otp, type) =>
    apiClient.post("/qc/partner/verify-otp", { phone, otp, type }, ctx()).then(unwrap),
  getApplication: (token) => apiClient.get("/qc/partner/application", ctx(token)).then(unwrap),
  submitApplication: (token, body) =>
    apiClient.post("/qc/partner/application", body, ctx(token)).then(unwrap),
  upload: (token, file) => {
    const form = new FormData()
    form.append("file", file)
    return apiClient.post("/qc/partner/upload", form, ctx(token)).then(unwrap)
  },
}

export const errorMessage = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback

/*
 * Kept for the tab, not longer: the onboarding token lasts a few hours, and a
 * phone check is a few seconds, so there is nothing worth keeping past it.
 */
const KEY = "partner_session"

export const partnerSession = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null")
    } catch {
      return null
    }
  },
  set(value) {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(value))
    } catch {
      // Private mode: the flow still works within this page load.
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      // nothing to clear
    }
  },
}

export const PARTNER_TYPES = {
  restaurant: {
    label: "Restaurant",
    blurb: "Cloud kitchens, cafés and restaurants delivering food.",
  },
  store: {
    label: "Store",
    blurb: "Grocery, kirana, supermarket and daily essentials.",
  },
  medical: {
    label: "Medical store",
    blurb: "Pharmacies taking prescription orders.",
  },
}

/**
 * Sign an approved store or medical store into the web dashboard.
 *
 * The restaurant dashboard serves them too, against quick commerce: the mark
 * set here sends its requests to /qc (see RESTAURANT_VERTICAL_KEY in axios.js).
 * Set after setAuthData, which clears it for an ordinary restaurant login.
 */
export const openSellerDashboard = (session, navigate) => {
  setAuthData("restaurant", session.accessToken, session.user || null, session.refreshToken || null)
  try {
    localStorage.setItem(RESTAURANT_VERTICAL_KEY, "qc")
  } catch {
    // Without storage there is no session to keep either.
  }
  navigate("/food/restaurant", { replace: true })
}

export const PARTNER_APP_URL = "https://play.google.com/store/apps/details?id=com.quickdrop.restaurant"
