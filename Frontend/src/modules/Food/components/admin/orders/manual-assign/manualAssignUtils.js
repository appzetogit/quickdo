/**
 * Shared helpers for the admin "assign a rider by hand" UI.
 *
 * The same admin screens serve Food (/admin/food) and Quick (/admin/quick-commerce);
 * Quick talks to the /qc admin API, so
 * the vertical the server knows them by is 'quickCommerce'.
 */

/** Order states a rider can be handed (mirrors the server's ASSIGNABLE_STATUSES). */
export const ASSIGNABLE_STATUSES = ["confirmed", "preparing", "ready_for_pickup"]

const QC_ADMIN_PATHS = ["/admin/quick-commerce"]

/** 'food' or 'quickCommerce', from the admin path the operator is on. */
export const adminVerticalFromPath = (pathname) => {
  const path = pathname ?? (typeof window === "undefined" ? "" : window.location.pathname || "")
  return QC_ADMIN_PATHS.some((base) => path.startsWith(base)) ? "quickCommerce" : "food"
}

const isWireStatus = (value) => typeof value === "string" && /^[a-z_]+$/.test(value)

/**
 * The server's orderStatus. The list screens overwrite `orderStatus` with a
 * display label ("Processing"), so the raw value is looked for first.
 */
export const rawOrderStatus = (order) => {
  if (!order) return ""
  const candidates = [order.rawOrderStatus, order.status, order.orderStatus]
  return candidates.find(isWireStatus) || ""
}

/** The id the admin order routes are addressed by (mongo id preferred). */
export const orderKey = (order) =>
  String(order?._id || order?.orderMongoId || order?.id || order?.orderId || "")

/** Does a socket payload concern this order? */
export const eventMatchesOrder = (payload, order) => {
  if (!payload || !order) return false
  const ids = new Set(
    [order._id, order.id, order.orderMongoId, order.orderId].filter(Boolean).map(String),
  )
  return (
    (payload.orderMongoId && ids.has(String(payload.orderMongoId))) ||
    (payload.orderId && ids.has(String(payload.orderId)))
  )
}

const riderNameOf = (order) => {
  const dp = order?.dispatch?.deliveryPartnerId
  if (dp && typeof dp === "object") return dp.name || dp.fullName || ""
  return order?.deliveryPartnerName || ""
}

/**
 * Overlay a newer `manual_assignment_update` payload on an order, so a row can
 * show the change before the refetch it triggers lands.
 */
export const withLiveEvent = (order, payload) => {
  if (!order || !payload) return order
  const eventAt = Date.parse(payload.at || "") || 0
  const orderAt = Date.parse(order.updatedAt || "") || 0
  if (eventAt && orderAt && eventAt <= orderAt) return order
  const dispatch = { ...(order.dispatch || {}) }
  if (payload.dispatchStatus) dispatch.status = payload.dispatchStatus
  if (payload.assignMode) dispatch.assignMode = payload.assignMode
  dispatch.manualDeadlineAt = payload.manualDeadlineAt || null
  return {
    ...order,
    dispatch,
    liveAssignment: {
      event: payload.event,
      riderName: payload.riderName || "",
      note: payload.note || "",
      at: payload.at,
    },
  }
}

const RIDER_NOTE = /(assigned by|unassigned by|^declined by|didn['’]t respond)/i
const DECLINE_OR_TIMEOUT = /(^declined by|didn['’]t respond)/i

/**
 * What the status line should say for an order.
 *
 * kind: 'pending'  -- manual assignment waiting on the rider
 *       'accepted' -- a manually assigned rider took it
 *       'declined' -- the last manual hand-off was declined / timed out
 *       'none'
 */
export const describeManualAssignment = (order) => {
  if (!order) return { kind: "none" }
  const dispatch = order.dispatch || {}
  const live = order.liveAssignment
  const riderName = riderNameOf(order) || live?.riderName || ""
  const manual = dispatch.assignMode === "manual" || !!dispatch.assignedBy

  if (dispatch.status === "assigned" && dispatch.assignMode === "manual") {
    return {
      kind: "pending",
      riderName,
      adminName: dispatch.assignedBy?.name || "",
      deadline: dispatch.manualDeadlineAt || null,
    }
  }
  if (dispatch.status === "accepted" && manual) {
    return { kind: "accepted", riderName }
  }
  if (dispatch.status === "accepted") return { kind: "none" }

  if (live && (live.event === "rider_declined" || live.event === "rider_timeout")) {
    const note =
      live.event === "rider_timeout"
        ? `${live.riderName || "Rider"} didn't respond`
        : live.note || `Declined by ${live.riderName || "rider"}`
    return { kind: "declined", note }
  }
  if (live && live.event === "rider_unassigned") return { kind: "none" }

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : []
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const note = String(history[i]?.note || "")
    if (!RIDER_NOTE.test(note)) continue
    return DECLINE_OR_TIMEOUT.test(note) ? { kind: "declined", note } : { kind: "none" }
  }
  return { kind: "none" }
}

/** Should the "Assign rider" button show for this order? */
export const canAssignRider = (order) =>
  ASSIGNABLE_STATUSES.includes(rawOrderStatus(order)) && order?.dispatch?.status !== "accepted"

/** True while a manual assignment is waiting on the rider. */
export const isManualPending = (order) =>
  order?.dispatch?.status === "assigned" && order?.dispatch?.assignMode === "manual"

/** The server's message for a failed request, or a fallback. */
export const apiErrorMessage = (error, fallback = "Something went wrong") =>
  error?.response?.data?.message || error?.message || fallback
