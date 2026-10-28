import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Plus, Tag, Trash2 } from "lucide-react"
import toast from "react-hot-toast"

import { restaurantAPI } from "@food/api"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

/**
 * "Buy 1, get 1 free."
 *
 * The free units are worked out by the server from the quantity actually
 * ordered, so nothing here decides what a customer receives -- this only
 * nominates the dishes and the ratio. The same document is editable from the
 * admin panel; whichever side saves last wins.
 */

const emptyOffer = () => ({
  localId: `bogo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  itemId: "",
  buyQty: "1",
  getQty: "1",
  maxFreeUnitsPerOrder: "",
  startDate: "",
  endDate: "",
})

/** A stored ISO timestamp back to the yyyy-mm-dd a date input wants, in local time. */
const toDateInput = (value) => {
  if (!value) return ""
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}

const toOfferDraft = (offer = {}) => ({
  localId: String(offer._id || `bogo-${Math.random().toString(36).slice(2, 8)}`),
  itemId: String(offer.itemId || ""),
  buyQty: offer.buyQty != null ? String(offer.buyQty) : "1",
  getQty: offer.getQty != null ? String(offer.getQty) : "1",
  maxFreeUnitsPerOrder:
    offer.maxFreeUnitsPerOrder != null ? String(offer.maxFreeUnitsPerOrder) : "",
  startDate: toDateInput(offer.startDate),
  endDate: toDateInput(offer.endDate),
})

/**
 * What a customer has to order before anything is free, and what they get.
 *
 * Shown per row because "buy 2 get 1" is easy to misread as "3 for the price of
 * 1", and a restaurant that misreads it finds out from its takings.
 */
const describeRatio = (buyQty, getQty) => {
  const buy = Number(buyQty)
  const get = Number(getQty)
  if (!Number.isInteger(buy) || !Number.isInteger(get) || buy < 1 || get < 1) return ""
  const group = buy + get
  return `Customer orders ${group} → pays for ${buy}, gets ${get} free`
}

export default function BogoOffersPage() {
  const goBack = useRestaurantBackNavigation()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [offers, setOffers] = useState([])
  const [items, setItems] = useState([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [offerRes, menuRes] = await Promise.all([
          restaurantAPI.getBogoOffer(),
          restaurantAPI.getMenu().catch(() => null),
        ])
        if (cancelled) return

        const doc = offerRes?.data?.data?.offer || offerRes?.data?.offer || null
        setIsActive(doc?.isActive !== false)
        setOffers((doc?.offers || []).map(toOfferDraft))

        // The menu comes back as { sections: [{ name, items, subsections }] }.
        // Read those two levels explicitly rather than walking the tree for
        // anything with a name: sections carry a name and an id too, so a walk
        // would offer "Breads" as a dish, and picking it would store a category
        // id that matches no order line -- an offer that silently never fires.
        // The body is { success, message, data: { menu: { sections } } }, so the
        // sections sit two levels down. Reading data.data.sections instead left
        // the dish picker permanently empty with no error, because getMenu is
        // caught and the missing key just yielded an empty list.
        const payload =
          menuRes?.data?.data?.menu || menuRes?.data?.menu || menuRes?.data?.data || menuRes?.data || {}
        const sections = Array.isArray(payload.sections) ? payload.sections : []
        const flat = []
        for (const section of sections) {
          for (const item of section?.items || []) flat.push(item)
          for (const sub of section?.subsections || []) {
            for (const item of sub?.items || []) flat.push(item)
          }
        }

        const seen = new Set()
        setItems(
          flat
            .filter((f) => {
              const id = String(f?._id || f?.id || "")
              if (!id || !f?.name || seen.has(id)) return false
              seen.add(id)
              return true
            })
            .map((f) => ({ id: String(f._id || f.id), name: f.name, price: f.price })),
        )
      } catch (error) {
        if (!cancelled) toast.error("Could not load your buy one get one offers")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )

  const updateOffer = (localId, field, value) =>
    setOffers((prev) => prev.map((o) => (o.localId === localId ? { ...o, [field]: value } : o)))

  const handleSave = async () => {
    const cleaned = offers.filter((o) => o.itemId)

    const seen = new Set()
    for (const offer of cleaned) {
      if (seen.has(offer.itemId)) {
        const name = itemsById.get(offer.itemId)?.name || "That dish"
        toast.error(`${name} is listed twice. Use one row per dish.`)
        return
      }
      seen.add(offer.itemId)

      const buy = Number(offer.buyQty)
      const get = Number(offer.getQty)
      if (!Number.isInteger(buy) || buy < 1 || !Number.isInteger(get) || get < 1) {
        toast.error("Buy and free quantities must be whole numbers of 1 or more")
        return
      }
      if (offer.maxFreeUnitsPerOrder !== "") {
        const cap = Number(offer.maxFreeUnitsPerOrder)
        if (!Number.isInteger(cap) || cap < 1) {
          toast.error("Maximum free units per order must be a whole number of 1 or more")
          return
        }
      }
      if (offer.startDate && offer.endDate && offer.endDate < offer.startDate) {
        toast.error("An offer cannot end before it starts")
        return
      }
    }

    if (offers.length > cleaned.length) {
      toast.error("Every row needs a dish. Remove the blank ones or pick a dish.")
      return
    }

    setSaving(true)
    try {
      await restaurantAPI.updateBogoOffer({
        isActive,
        offers: cleaned.map((o) => ({
          itemId: o.itemId,
          buyQty: Number(o.buyQty),
          getQty: Number(o.getQty),
          maxFreeUnitsPerOrder: o.maxFreeUnitsPerOrder === "" ? null : Number(o.maxFreeUnitsPerOrder),
          // The server treats the end as exclusive, so the last day is sent as
          // its final millisecond. Without this, picking a date would end the
          // offer at midnight as that day BEGAN -- a whole day short of the label.
          startDate: o.startDate ? `${o.startDate}T00:00:00` : null,
          endDate: o.endDate ? `${o.endDate}T23:59:59.999` : null,
        })),
      })
      toast.success("Buy one get one offers saved")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save your offers")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="rounded-xl p-2 -ml-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Buy One Get One</h1>
            <p className="text-xs text-gray-500 hidden sm:block">
              Pick the dishes where ordering more than one makes some of them free.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="hidden sm:inline-flex items-center justify-center px-6 py-2 rounded-xl text-sm font-semibold text-white bg-primary-orange hover:brightness-95 disabled:opacity-50 transition-all shadow-sm"
        >
          {saving ? "Saving..." : "Save Offers"}
        </button>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-sm font-bold text-gray-900">
              Buy One Get One Promotion:{" "}
              <span className={isActive ? "text-emerald-600 font-semibold" : "text-gray-500"}>
                {isActive ? "Active" : "Paused"}
              </span>
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Turning it off keeps your configured dishes so you can reactivate anytime without
              rebuilding the list.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive((v) => !v)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              isActive ? "bg-primary-orange" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                isActive ? "translate-x-[24px]" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500 shadow-sm">
            Loading your offers...
          </div>
        ) : (
          <div className="space-y-4">
            {offers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
                <Tag className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                <p className="text-sm font-bold text-gray-900">No buy one get one dishes yet</p>
                <p className="mt-1 text-xs text-gray-500 max-w-sm mx-auto">
                  Add a dish to make a second one free, and customers ordering a single portion get
                  nudged to add another.
                </p>
              </div>
            )}

            {offers.map((offer, index) => (
              <div
                key={offer.localId}
                className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4"
              >
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Offer #{index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOffers((prev) => prev.filter((o) => o.localId !== offer.localId))}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    aria-label="Remove offer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                    Dish On Offer
                  </label>
                  <select
                    value={offer.itemId}
                    onChange={(e) => updateOffer(offer.localId, "itemId", e.target.value)}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                  >
                    <option value="">Choose dish...</option>
                    {items.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} {option.price ? `(₹${option.price})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      Customer Buys
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={offer.buyQty}
                      onChange={(e) =>
                        updateOffer(offer.localId, "buyQty", e.target.value.replace(/[^0-9]/g, ""))
                      }
                      placeholder="1"
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      Customer Gets Free
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={offer.getQty}
                      onChange={(e) =>
                        updateOffer(offer.localId, "getQty", e.target.value.replace(/[^0-9]/g, ""))
                      }
                      placeholder="1"
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      Max Free Per Order
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={offer.maxFreeUnitsPerOrder}
                      onChange={(e) =>
                        updateOffer(
                          offer.localId,
                          "maxFreeUnitsPerOrder",
                          e.target.value.replace(/[^0-9]/g, ""),
                        )
                      }
                      placeholder="No limit"
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      Starts <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={offer.startDate}
                      onChange={(e) => updateOffer(offer.localId, "startDate", e.target.value)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      Last Day <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="date"
                      value={offer.endDate}
                      onChange={(e) => updateOffer(offer.localId, "endDate", e.target.value)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    />
                  </div>
                </div>

                {describeRatio(offer.buyQty, offer.getQty) && (
                  <p className="rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                    {describeRatio(offer.buyQty, offer.getQty)}
                  </p>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setOffers((prev) => [...prev, emptyOffer()])}
                className="inline-flex items-center gap-2 rounded-xl border border-primary-orange/30 bg-primary-orange/5 px-4 py-2.5 text-xs font-bold text-accent-orange hover:bg-primary-orange/10 transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" />
                <span>Add Dish</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600 leading-relaxed space-y-1.5">
              <p>
                Free units are worked out from the quantity ordered, rounded down. On buy 1 get 1,
                two portions means one is free and three portions still means one is free.
              </p>
              <p>
                The free portion is the same size the customer picked, so a free large pizza only
                comes with a paid large pizza. Add-ons and packaging on the free portion are still
                charged &mdash; only the dish price is waived.
              </p>
              <p>
                You are not charged commission on the free portions, and they do not count towards
                any free-item order threshold you have set.
              </p>
            </div>
          </div>
        )}

        <div className="sm:hidden pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="w-full rounded-xl bg-primary-orange py-3.5 text-sm font-bold text-white shadow-md disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Offers"}
          </button>
        </div>
      </div>
    </div>
  )
}
