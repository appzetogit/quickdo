import apiClient from "./axios.js";

/**
 * SOW §5 platform features shared by every service: FAQs, loyalty points and
 * delivery slots. All mounted under /platform, outside /food, so the admin
 * panel's /food -> /qc rewrite never touches them.
 */

export const faqAdminAPI = {
  list: (params = {}) => apiClient.get("/platform/faqs/admin", { params, contextModule: "admin" }),
  create: (body) => apiClient.post("/platform/faqs/admin", body, { contextModule: "admin" }),
  update: (id, body) => apiClient.patch(`/platform/faqs/admin/${id}`, body, { contextModule: "admin" }),
  remove: (id) => apiClient.delete(`/platform/faqs/admin/${id}`, { contextModule: "admin" }),
  reorder: (items) => apiClient.put("/platform/faqs/admin/reorder", { items }, { contextModule: "admin" }),
};

export const loyaltyAdminAPI = {
  getSettings: (vertical) =>
    apiClient.get("/platform/loyalty/admin/settings", { params: vertical ? { vertical } : {}, contextModule: "admin" }),
  saveSettings: (body) => apiClient.put("/platform/loyalty/admin/settings", body, { contextModule: "admin" }),
  ledger: (params = {}) => apiClient.get("/platform/loyalty/admin/ledger", { params, contextModule: "admin" }),
};

export const deliverySlotsAdminAPI = {
  list: (params = {}) => apiClient.get("/platform/delivery-slots/admin", { params, contextModule: "admin" }),
  create: (body) => apiClient.post("/platform/delivery-slots/admin", body, { contextModule: "admin" }),
  update: (id, body) => apiClient.patch(`/platform/delivery-slots/admin/${id}`, body, { contextModule: "admin" }),
  remove: (id) => apiClient.delete(`/platform/delivery-slots/admin/${id}`, { contextModule: "admin" }),
  available: (params = {}) => apiClient.get("/platform/delivery-slots/available", { params }),
};
