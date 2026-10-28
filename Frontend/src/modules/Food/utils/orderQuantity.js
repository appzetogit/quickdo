/**
 * Client mirror of Backend/src/modules/food/shared/orderQuantityRules.js.
 * The server is the authority — this only keeps the UI from offering
 * quantities checkout would reject.
 */

export const DEFAULT_MIN_ORDER_QUANTITY = 1
export const ABSOLUTE_MAX_ORDER_QUANTITY = 99

const toInt = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? Math.floor(num) : NaN
}

/** `{ min, max, hasCap }` for a menu item; max is always a usable number. */
export const resolveOrderQuantityRules = (item = null) => {
  const rawMin = toInt(item?.minOrderQuantity)
  const min =
    Number.isFinite(rawMin) && rawMin > 0
      ? Math.min(rawMin, ABSOLUTE_MAX_ORDER_QUANTITY)
      : DEFAULT_MIN_ORDER_QUANTITY

  const rawMax = toInt(item?.maxOrderQuantity)
  const hasCap = Number.isFinite(rawMax) && rawMax > 0
  const max = hasCap
    ? Math.min(Math.max(rawMax, min), ABSOLUTE_MAX_ORDER_QUANTITY)
    : ABSOLUTE_MAX_ORDER_QUANTITY

  return { min, max, hasCap }
}

/** Quantity the first "Add" should put in the cart. */
export const getInitialOrderQuantity = (item = null) =>
  resolveOrderQuantityRules(item).min

/** Pull a quantity into the item's allowed range. */
export const clampOrderQuantity = (quantity, item = null) => {
  const { min, max } = resolveOrderQuantityRules(item)
  const qty = toInt(quantity)
  if (!Number.isFinite(qty)) return min
  return Math.min(max, Math.max(min, qty))
}

/** True when decreasing past this point should remove the line instead. */
export const isBelowMinimumOrderQuantity = (quantity, item = null) =>
  toInt(quantity) < resolveOrderQuantityRules(item).min
