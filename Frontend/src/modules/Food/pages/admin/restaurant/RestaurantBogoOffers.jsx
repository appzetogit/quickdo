import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Search, Tag, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * "Buy 1, get 1 free", per restaurant, from the admin side.
 *
 * Reads and writes the same document the restaurant's own panel edits rather
 * than an admin-side copy: two lists for one restaurant would mean the order
 * path picks one, and whichever it picked would surprise somebody.
 *
 * Nothing here decides what a customer receives. The free units are worked out
 * by the server from the quantity ordered at checkout; this only nominates the
 * dishes and the ratio.
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

export default function RestaurantBogoOffers() {
  const [restaurants, setRestaurants] = useState([])
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [loadingList, setLoadingList] = useState(true)
  const [loadingOffer, setLoadingOffer] = useState(false)
  const [saving, setSaving] = useState(false)

  const [isActive, setIsActive] = useState(true)
  const [offers, setOffers] = useState([])
  const [items, setItems] = useState([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await adminAPI.getRestaurants({ limit: 200 })
        const list =
          res?.data?.data?.restaurants || res?.data?.restaurants || res?.data?.data || []
        if (!cancelled) setRestaurants(Array.isArray(list) ? list : [])
      } catch {
        if (!cancelled) toast.error("Could not load restaurants")
      } finally {
        if (!cancelled) setLoadingList(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false

    const load = async () => {
      setLoadingOffer(true)
      try {
        const [offerRes, foodRes] = await Promise.all([
          adminAPI.getRestaurantBogoOffer(selectedId),
          adminAPI.getFoods({ restaurantId: selectedId, limit: 200 }).catch(() => null),
        ])
        if (cancelled) return

        const doc = offerRes?.data?.data?.offer || offerRes?.data?.offer || null
        setIsActive(doc?.isActive !== false)
        setOffers((doc?.offers || []).map(toOfferDraft))

        const foods = foodRes?.data?.data?.foods || foodRes?.data?.foods || foodRes?.data?.data || []
        setItems(
          (Array.isArray(foods) ? foods : []).map((f) => ({
            id: String(f._id || f.id),
            name: f.name,
            price: f.price,
          })),
        )
      } catch {
        if (!cancelled) toast.error("Could not load this restaurant's offers")
      } finally {
        if (!cancelled) setLoadingOffer(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return restaurants
    return restaurants.filter((r) =>
      String(r.restaurantName || r.name || "").toLowerCase().includes(q),
    )
  }, [restaurants, search])

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

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
      await adminAPI.updateRestaurantBogoOffer(selectedId, {
        isActive,
        offers: cleaned.map((o) => ({
          itemId: o.itemId,
          buyQty: Number(o.buyQty),
          getQty: Number(o.getQty),
          maxFreeUnitsPerOrder:
            o.maxFreeUnitsPerOrder === "" ? null : Number(o.maxFreeUnitsPerOrder),
          // The server treats the end as exclusive, so the last day is sent as
          // its final millisecond. Without this, picking a date would end the
          // offer at midnight as that day BEGAN -- a whole day short of the label.
          startDate: o.startDate ? `${o.startDate}T00:00:00` : null,
          endDate: o.endDate ? `${o.endDate}T23:59:59.999` : null,
        })),
      })
      toast.success("Buy one get one offers saved")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save the offers")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Buy One Get One</h1>
        <p className="text-sm text-slate-500">
          Dishes where ordering more than one makes some of them free. Applied automatically at
          checkout.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search restaurants"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
            />
          </div>

          {loadingList ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {filtered.map((r) => {
                const id = String(r._id || r.id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedId(id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === id
                        ? "bg-orange-50 font-semibold text-orange-700"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {r.restaurantName || r.name || "Restaurant"}
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500">No restaurants match.</p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {!selectedId ? (
            <div className="py-16 text-center">
              <Tag className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-800">Pick a restaurant</p>
              <p className="mt-1 text-xs text-slate-500">
                Its buy one get one dishes will appear here.
              </p>
            </div>
          ) : loadingOffer ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    Offer is {isActive ? "on" : "off"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Turning it off keeps the dishes, so it can be switched back on without
                    rebuilding the list.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => setIsActive((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    isActive ? "bg-orange-500" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                      isActive ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {offers.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
                  <p className="text-sm font-medium text-slate-800">No offers configured</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a dish to make a second one free.
                  </p>
                </div>
              )}

              {offers.map((offer) => (
                <div
                  key={offer.localId}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
                >
                  <div className="flex-1 space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-600">Dish</label>
                      <select
                        value={offer.itemId}
                        onChange={(e) => updateOffer(offer.localId, "itemId", e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      >
                        <option value="">Select…</option>
                        {items.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs text-slate-600">Buys</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={offer.buyQty}
                          onChange={(e) => updateOffer(offer.localId, "buyQty", e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-600">Gets free</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={offer.getQty}
                          onChange={(e) => updateOffer(offer.localId, "getQty", e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-600">Max free / order</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={offer.maxFreeUnitsPerOrder}
                          onChange={(e) =>
                            updateOffer(offer.localId, "maxFreeUnitsPerOrder", e.target.value)
                          }
                          placeholder="No limit"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs text-slate-600">Starts (optional)</label>
                        <input
                          type="date"
                          value={offer.startDate}
                          onChange={(e) => updateOffer(offer.localId, "startDate", e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-600">Last day (optional)</label>
                        <input
                          type="date"
                          value={offer.endDate}
                          onChange={(e) => updateOffer(offer.localId, "endDate", e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOffers((prev) => prev.filter((o) => o.localId !== offer.localId))}
                    className="mt-6 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-red-500"
                    aria-label="Remove offer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOffers((prev) => [...prev, emptyOffer()])}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add a dish
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-lg bg-orange-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save offers"}
                </button>
              </div>

              <p className="text-xs text-slate-500">
                Free units are worked out from the quantity ordered, rounded down, and the free
                portion matches the size the customer picked. Add-ons and packaging on it are still
                charged; the restaurant pays no commission on the free portions, and they do not
                count towards a free-item order threshold.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
