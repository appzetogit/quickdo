import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"

/**
 * Add-ons for one dish, chosen before it goes in the cart.
 *
 * Only shown for dishes that actually offer add-ons; everything else adds
 * straight to the cart as it always did, so this never gets in the way of the
 * common case.
 *
 * The list is the intersection of the restaurant's sellable add-ons and the ones
 * this dish opts into (`addonIds`), plus any attached to the chosen variant --
 * extra cheese on the large, but not the small. The server re-checks that
 * intersection at checkout and prices from its own records, so nothing here
 * decides what is allowed or what it costs -- this only decides what to offer.
 */
export default function AddonPickerSheet({
  open,
  dish,
  variant = null,
  restaurantAddons = [],
  onClose,
  onConfirm,
}) {
  const [selected, setSelected] = useState([])

  // Reset on each open: a previous dish's choices must not carry over.
  useEffect(() => {
    if (open) setSelected([])
  }, [open, dish?.id, variant?.id, variant?._id])

  // The price of an add-on here is the price of the PAIRING: the chosen
  // variant may set its own figure (cheese on a large is more cheese), and the
  // server charges that figure -- so this must display it, or the customer
  // sees one number and pays another. Falls back to the published price for
  // pairings that set none, which is every pairing made before this existed.
  const pairingPriceOf = (addonId) => {
    const pair = (variant?.addons || []).find((entry) => String(entry?.addonId) === String(addonId))
    const override = pair?.price
    return override !== null && override !== undefined && Number.isFinite(Number(override))
      ? Number(override)
      : null
  }

  const options = useMemo(() => {
    // Mirrors resolveAllowedAddonIds on the server: the dish's own list applies
    // to every variant, and the chosen variant adds any extras of its own.
    const allowed = new Set((dish?.addonIds || []).map((id) => String(id)))
    for (const id of variant?.addonIds || []) allowed.add(String(id))
    if (allowed.size === 0) return []
    return (restaurantAddons || []).filter((addon) =>
      allowed.has(String(addon?._id || addon?.id || "")),
    )
  }, [dish, variant, restaurantAddons])

  const chosen = useMemo(
    () =>
      options
        .filter((addon) => selected.includes(String(addon._id || addon.id)))
        .map((addon) => ({
          addonId: String(addon._id || addon.id),
          name: addon.name || "Add-on",
          price: pairingPriceOf(addon._id || addon.id) ?? (Number(addon.price) || 0),
        })),
    [options, selected, variant],
  )

  const addonsTotal = chosen.reduce((sum, a) => sum + a.price, 0)
  const basePrice = Number(variant?.price ?? dish?.price) || 0

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/40"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3">
            <div>
              <p className="text-base font-semibold text-gray-900">{dish?.name}</p>
              <p className="text-xs text-gray-500">Add anything extra?</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-1 text-gray-500 hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-3">
            {options.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                No add-ons available for this item right now.
              </p>
            ) : (
              <div className="space-y-2">
                {options.map((addon) => {
                  const addonId = String(addon._id || addon.id)
                  const checked = selected.includes(addonId)
                  return (
                    <label
                      key={addonId}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-3"
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={(e) =>
                            setSelected((prev) =>
                              e.target.checked
                                ? [...prev, addonId]
                                : prev.filter((x) => x !== addonId),
                            )
                          }
                        />
                        <span>
                          <span className="block text-sm font-medium text-gray-900">
                            {addon.name}
                          </span>
                          {addon.description ? (
                            <span className="block text-xs text-gray-500">{addon.description}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-gray-700">
                        + ₹{pairingPriceOf(addon._id || addon.id) ?? (Number(addon.price) || 0)}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 border-t border-gray-100 bg-white px-4 py-3">
            <button
              type="button"
              onClick={() => onConfirm(chosen)}
              className="flex w-full items-center justify-between rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white"
            >
              <span>{chosen.length > 0 ? `Add with ${chosen.length} add-on${chosen.length === 1 ? "" : "s"}` : "Add without add-ons"}</span>
              <span>₹{basePrice + addonsTotal}</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
