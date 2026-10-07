import apiClient from "./axios.js"

/**
 * The Master panel's cross-vertical screens (Backend core/admin/masterAnalytics.routes.js):
 * dashboard, reports, GST, subscriptions, broadcasts and insights.
 *
 * Insights are called on /insights: the server rewrites it to /analytics, a word
 * ad blockers drop requests for.
 */
const admin = { contextModule: "admin" }

export const masterDashboardAPI = {
  get: (params = {}) => apiClient.get("/platform/master/dashboard", { params, ...admin }),
}

export const masterReportsAPI = {
  get: (kind, params = {}) => apiClient.get(`/platform/master/reports/${encodeURIComponent(kind)}`, { params, ...admin }),
  export: (kind, params = {}) =>
    apiClient.get(`/platform/master/reports/${encodeURIComponent(kind)}/export`, { params, responseType: "blob", ...admin }),
  gst: (params = {}) => apiClient.get("/platform/master/tax/gst", { params, ...admin }),
  exportGst: (params = {}) => apiClient.get("/platform/master/tax/gst/export", { params, responseType: "blob", ...admin }),
}

export const masterSubscriptionsAPI = {
  list: (params = {}) => apiClient.get("/platform/master/subscriptions", { params, ...admin }),
}

export const masterBroadcastAPI = {
  roles: () => apiClient.get("/platform/master/broadcasts/roles", admin),
  preview: (body) => apiClient.post("/platform/master/broadcasts/preview", body, admin),
  send: (body) => apiClient.post("/platform/master/broadcasts", body, admin),
  list: (params = {}) => apiClient.get("/platform/master/broadcasts", { params, ...admin }),
}

export const masterInsightsAPI = {
  summary: () => apiClient.get("/platform/master/insights/summary", admin),
  forecast: (params = {}) => apiClient.get("/platform/master/insights/forecast", { params, ...admin }),
  demand: (params = {}) => apiClient.get("/platform/master/insights/demand", { params, ...admin }),
  pairs: (params = {}) => apiClient.get("/platform/master/insights/pairs", { params, ...admin }),
  recompute: () => apiClient.post("/platform/master/insights/recompute", {}, admin),
}

/** Zones a module draws (Master zone pickers). module: food | quickCommerce | taxi */
export const masterZonesAPI = {
  list: (module) => apiClient.get(`/platform/settings/zones/${encodeURIComponent(module)}`, admin),
}

/** Save a blob response as a file, using the server's filename when it sent one. */
export function saveBlobResponse(res, fallbackName) {
  const cd = res?.headers?.["content-disposition"] || ""
  const m = /filename="?([^";]+)"?/i.exec(cd)
  const name = m ? m[1] : fallbackName
  const url = URL.createObjectURL(res.data)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
