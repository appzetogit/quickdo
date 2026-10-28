/**
 * The value shelf's price point, on the client side.
 *
 * The shelf runs at a price business sets from the admin panel (99 Store ->
 * Shelf price), and the server has consumed that setting for a while: it
 * decides which dishes are on the shelf, and it emits the resolved number on
 * the public landing settings so no client has to re-derive it.
 *
 * The screens did not. "Switch 99", "Under Rs 99" and the admin's "250 Banner"
 * tab were three unrelated literals, none of them the configured price -- and
 * one of them a leftover from a Rs 250 band that shelf has not been for a long
 * time. Setting the shelf to Rs 59 changed what it CONTAINED and nothing that
 * NAMED it, so every heading in the app then lied about its own contents. The
 * settings page even promises "the customer app reads this, so the shelf's name
 * and headings follow it automatically"; this is the part that makes that true.
 *
 * Cached per page load rather than fetched per screen: the name is rendered by
 * the bottom bar, the desktop bar, the promo row and the shelf itself, all of
 * which can mount within a frame of each other. The memo also means a screen
 * mounted later paints the right name immediately instead of flashing 99 and
 * correcting itself.
 */
import { useEffect, useState } from "react"
import { publicGetOnce } from "@food/api"

/** What the shelf was before its price became a setting. */
export const DEFAULT_VALUE_SHELF_CAP = 99

/**
 * Mirrors `resolveNinetyNineCap` on the server. A cap has to be a positive
 * number; anything else -- a settings document written before the field
 * existed, a stray string, a zero -- is the default rather than a shelf that
 * silently names itself "Switch 0".
 */
export const resolveValueShelfCap = (raw) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_VALUE_SHELF_CAP
}

/** The shelf's name, wherever it is named: `Switch 99`, `Switch 59`. */
export const valueShelfName = (cap) => `Switch ${resolveValueShelfCap(cap)}`

/** The shelf's heading: `Under ₹99`. */
export const valueShelfHeading = (cap) => `Under ₹${resolveValueShelfCap(cap)}`

/**
 * Is this dish on the shelf?
 *
 * The same rule the server applies in `qualifiesFor99Store`, repeated here for
 * the screens that filter a menu they already hold. Both halves matter: the
 * flag is the admin's curation, and the cap is applied at read time so a dish
 * whose price later rose above it leaves the shelf without anyone clearing the
 * flag.
 *
 * A server that does not send `showIn99Store` at all is a server from before
 * the shelf was curated, and on it the price is the whole rule -- so an ABSENT
 * flag falls back to the price test while an explicit `false` is respected as
 * the admin's "not on the shelf". Reading absence as false instead would empty
 * the shelf completely against that server, which is worse than the string
 * match this replaced.
 */
export const isOnValueShelf = (item, cap) => {
  if (item?.showIn99Store === false) return false
  const price = Number(item?.price)
  return Number.isFinite(price) && price > 0 && price <= resolveValueShelfCap(cap)
}

// A short TTL, not a permanent memo: an admin who changes the price on the 99
// Store page and walks over to Landing Page Management should see the tab
// rename itself rather than wonder whether the save took.
const TTL_MS = 60_000
let value = DEFAULT_VALUE_SHELF_CAP
let fetchedAt = 0
let inFlight = null

/**
 * Never throws and never rejects. A settings lookup must not be able to stop a
 * navigation bar from rendering, so a failed one keeps the last known price --
 * the default on a cold load, which is exactly what the screens hardcoded
 * before.
 */
export const getValueShelfCap = async () => {
  if (fetchedAt && Date.now() - fetchedAt < TTL_MS) return value
  if (inFlight) return inFlight

  inFlight = publicGetOnce("/food/landing/settings/public")
    .then((res) => {
      value = resolveValueShelfCap(res?.data?.data?.ninetyNineStoreMaxPrice)
      fetchedAt = Date.now()
      return value
    })
    .catch(() => value)
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

/** The configured price, for a component. Starts at the last known one. */
export const useValueShelfCap = () => {
  const [cap, setCap] = useState(value)

  useEffect(() => {
    let cancelled = false
    getValueShelfCap().then((next) => {
      if (!cancelled) setCap(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return cap
}
