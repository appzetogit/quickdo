/**
 * Placeholder images, generated inline rather than fetched.
 *
 * Every screen used to fall back to `https://via.placeholder.com/<size>`, a
 * third-party service. It stopped responding, so a dish with no image left the
 * admin panel making a request that hung until it timed out -- nine of them on
 * one Edit Food dialog, a broken-image icon where the preview should be, and a
 * console full of ERR_CONNECTION_TIMED_OUT that buried real errors.
 *
 * A data URI cannot fail. It needs no network, no DNS, no third party staying
 * in business, and it renders before the first paint instead of after a
 * round-trip. The size only sets the intrinsic dimensions; CSS scales it.
 *
 * `?` rather than a filename or a label: this stands in for an image that does
 * not exist, and writing "No image" into the pixels means it cannot be
 * translated and looks wrong at 24px.
 */
const svg = (size, fontSize) =>
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='"
    + size + "' height='" + size + "'%3E%3Crect fill='%23e2e8f0' width='"
    + size + "' height='" + size + "'/%3E%3Ctext x='50%25' y='50%25'"
    + " dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8'"
    + " font-size='" + fontSize + "' font-family='sans-serif'%3E?%3C/text%3E%3C/svg%3E"

export const PLACEHOLDER_32 = svg(32, 10)
export const PLACEHOLDER_40 = svg(40, 12)
export const PLACEHOLDER_64 = svg(64, 18)
export const PLACEHOLDER_96 = svg(96, 26)
export const PLACEHOLDER_128 = svg(128, 32)
export const PLACEHOLDER_200 = svg(200, 48)
export const PLACEHOLDER_400 = svg(400, 84)

/**
 * A square placeholder at any size, for the odd call site that needs one the
 * constants above do not cover.
 */
export const placeholderImage = (size = 40) =>
    svg(Number(size) > 0 ? Number(size) : 40, Math.max(8, Math.round(Number(size) * 0.3)))

/**
 * A placeholder carrying up to two initials, for a named thing -- a restaurant
 * in a joining request, say -- where a bare `?` says less than "SK" would.
 */
export const placeholderInitials = (text = "", size = 40) => {
    const initials = String(text || "?").trim().slice(0, 2).toUpperCase() || "?"
    const escaped = initials.replace(/&/g, "%26").replace(/</g, "%3C").replace(/>/g, "%3E")
    const fontSize = Math.max(8, Math.round(size * 0.36))
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='"
        + size + "' height='" + size + "'%3E%3Crect fill='%23e2e8f0' width='"
        + size + "' height='" + size + "'/%3E%3Ctext x='50%25' y='50%25'"
        + " dominant-baseline='middle' text-anchor='middle' fill='%2364748b'"
        + " font-size='" + fontSize + "' font-family='sans-serif'%3E" + escaped + "%3C/text%3E%3C/svg%3E"
}
