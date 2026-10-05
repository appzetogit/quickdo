import { useEffect, useMemo, useState } from "react"
import { Gift, Loader2, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * "Spend ₹200, get a free dish", per restaurant, from the admin side.
 *
 * Reads and writes the same document the restaurant's own panel edits rather
 * than an admin-side copy: two ladders for one restaurant would mean the order
 * path picks one, and whichever it picked would surprise somebody.
 *
 * Nothing here decides what a customer receives. WHETHER a tier is earned is
 * resolved by the server from the order subtotal; the customer then claims it
 * themselves with their own Add tap, same as any other line in their cart --
 * this page only configures the ladder.
 */

const emptyTier = () => ({
  localId: `tier-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  minOrderValue: "",
  rewardType: "item",
  rewardId: "",
  rewardName: "",
})

const toTierDraft = (tier = {}) => ({
  localId: String(tier._id || `tier-${Math.random().toString(36).slice(2, 8)}`),
  minOrderValue: tier.minOrderValue != null ? String(tier.minOrderValue) : "",
  rewardType: tier.rewardType === "addon" ? "addon" : tier.rewardType === "manual" ? "manual" : "item",
  rewardId: String(tier.rewardAddonId || tier.rewardItemId || ""),
  rewardName: tier.rewardName || "",
})

export default function RestaurantFreebieOffers() {
  const [restaurants, setRestaurants] = useState([])
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [loadingList, setLoadingList] = useState(true)
  const [loadingOffer, setLoadingOffer] = useState(false)
  const [saving, setSaving] = useState(false)

  const [isActive, setIsActive] = useState(true)
  const [tiers, setTiers] = useState([])
  const [items, setItems] = useState([])
  const [addons, setAddons] = useState([])

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
        const [offerRes, foodRes, addonRes] = await Promise.all([
          adminAPI.getRestaurantFreebieOffer(selectedId),
          adminAPI.getFoods({ restaurantId: selectedId, limit: 200 }).catch(() => null),
          adminAPI.getAddons?.({ restaurantId: selectedId, limit: 200 }).catch(() => null),
        ])
        if (cancelled) return

        const offer = offerRes?.data?.data?.offer || offerRes?.data?.offer || null
        setIsActive(offer?.isActive !== false)
        setTiers((offer?.tiers || []).map(toTierDraft))

        const foods = foodRes?.data?.data?.foods || foodRes?.data?.foods || foodRes?.data?.data || []
        setItems(
          (Array.isArray(foods) ? foods : [])
            .filter((f) => String(f.restaurantId || f.restaurant?._id || "") === String(selectedId) || true)
            .map((f) => ({ id: String(f._id || f.id), name: f.name, price: f.price })),
        )

        const addonList =
          addonRes?.data?.data?.addons || addonRes?.data?.addons || addonRes?.data?.data || []
        setAddons(
          (Array.isArray(addonList) ? addonList : []).map((a) => ({
            id: String(a._id || a.id || ""),
            name: a.name || a.published?.name || a.draft?.name || "Add-on",
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

  const rewardOptions = useMemo(() => ({ item: items, addon: addons }), [items, addons])

  const updateTier = (localId, field, value) =>
    setTiers((prev) =>
      prev.map((t) =>
        t.localId === localId
          ? { ...t, [field]: value, ...(field === "rewardType" ? { rewardId: "", rewardName: "" } : {}) }
          : t,
      ),
    )

  const handleSave = async () => {
    const cleaned = tiers.filter(
      (t) => String(t.minOrderValue).trim() || t.rewardId || t.rewardName.trim(),
    )

    for (const tier of cleaned) {
      const amount = Number(tier.minOrderValue)
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Every tier needs an order amount greater than 0")
        return
      }
      if (tier.rewardType === "manual") {
        if (!tier.rewardName.trim()) {
          toast.error(`Name the reward for orders over ${amount}`)
          return
        }
      } else if (!tier.rewardId) {
        toast.error(`Choose what customers get free on orders over ${amount}`)
        return
      }
    }

    const amounts = cleaned.map((t) => Number(t.minOrderValue))
    if (new Set(amounts).size !== amounts.length) {
      toast.error("Two tiers share the same order amount. Use one reward per amount.")
      return
    }

    setSaving(true)
    try {
      await adminAPI.updateRestaurantFreebieOffer(selectedId, {
        isActive,
        tiers: cleaned.map((t) => ({
          minOrderValue: Number(t.minOrderValue),
          rewardType: t.rewardType,
          ...(t.rewardType === "manual"
            ? { rewardName: t.rewardName.trim() }
            : t.rewardType === "addon"
              ? { rewardAddonId: t.rewardId }
              : { rewardItemId: t.rewardId }),
        })),
      })
      toast.success("Free-item offers saved")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save the offers")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Free Item Offers</h1>
        <p className="text-sm text-slate-500">
          Unlock a dish, add-on, or a custom reward once an order reaches an amount. The customer adds it
          themselves once it's unlocked.
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
              <Gift className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-800">Pick a restaurant</p>
              <p className="mt-1 text-xs text-slate-500">
                Its free-item offers will appear here.
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
                  <p className="text-sm font-medium text-slate-900">Offer is {isActive ? "on" : "off"}</p>
                  <p className="text-xs text-slate-500">
                    Turning it off keeps the tiers, so it can be switched back on without retyping them.
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

              {tiers.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
                  <p className="text-sm font-medium text-slate-800">No offers configured</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Add a tier to give something free once an order reaches an amount.
                  </p>
                </div>
              )}

              {tiers.map((tier) => {
                const REWARD_MODES = [
                  { value: "item", label: "A dish" },
                  { value: "addon", label: "An add-on" },
                  { value: "manual", label: "Type manually" },
                ]
                return (
                  <div key={tier.localId} className="space-y-3 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="w-40 shrink-0">
                        <label className="mb-1 block text-xs text-slate-600">On orders over</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={tier.minOrderValue}
                          onChange={(e) => updateTier(tier.localId, "minOrderValue", e.target.value)}
                          placeholder="200"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setTiers((prev) => prev.filter((t) => t.localId !== tier.localId))}
                        className="mt-5 shrink-0 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-red-500"
                        aria-label="Remove tier"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-600">Give away</label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {REWARD_MODES.map((mode) => (
                          <button
                            key={mode.value}
                            type="button"
                            onClick={() => updateTier(tier.localId, "rewardType", mode.value)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                              tier.rewardType === mode.value
                                ? "bg-orange-500 text-white"
                                : "border border-slate-300 bg-white text-slate-600 hover:text-slate-900"
                            }`}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-slate-600">
                        {tier.rewardType === "addon"
                          ? "Which add-on"
                          : tier.rewardType === "manual"
                            ? "Reward name"
                            : "Which dish"}
                      </label>
                      {tier.rewardType === "manual" ? (
                        <input
                          type="text"
                          value={tier.rewardName}
                          onChange={(e) => updateTier(tier.localId, "rewardName", e.target.value)}
                          placeholder="e.g. Cold Drink"
                          maxLength={120}
                          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                      ) : (
                        <select
                          value={tier.rewardId}
                          onChange={(e) => updateTier(tier.localId, "rewardId", e.target.value)}
                          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value="">Select…</option>
                          {(rewardOptions[tier.rewardType] || []).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTiers((prev) => [...prev, emptyTier()])}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add a tier
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
                If an order clears more than one tier only the highest one unlocks. The customer sees an Add
                button once they've earned it — it's their choice to take it, and does not count towards the
                amount that earned it.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
