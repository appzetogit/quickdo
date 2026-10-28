/**
 * Which admin panel is open: food (restaurants), quick-commerce (stores) or
 * medical (pharmacies). The three render the same screens; the API calls of
 * the last two are rewritten from /food to /qc (services/api/axios.js).
 */
export const adminPanelOf = (pathname = typeof window !== "undefined" ? window.location.pathname : "") => {
  if (pathname.startsWith("/admin/medical")) return { base: "/admin/medical", vertical: "qc", pharmacyOnly: true }
  if (pathname.startsWith("/admin/quick-commerce")) return { base: "/admin/quick-commerce", vertical: "qc", pharmacyOnly: false }
  return { base: "/admin/food", vertical: "food", pharmacyOnly: false }
}
