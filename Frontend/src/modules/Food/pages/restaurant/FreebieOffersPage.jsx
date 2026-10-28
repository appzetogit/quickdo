import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Gift, Plus, Trash2 } from "lucide-react"
import toast from "react-hot-toast"

import { restaurantAPI } from "@food/api"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

/**
 * "Spend ₹200, get a free dish."
 *
 * The reward is applied by the server from the order subtotal, so nothing here
 * decides what a customer receives -- this only configures the ladder. The same
 * document is editable from the admin panel; whichever side saves last wins.
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

export default function FreebieOffersPage() {
  const goBack = useRestaurantBackNavigation()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [tiers, setTiers] = useState([])
  const [items, setItems] = useState([])
  const [addons, setAddons] = useState([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [offerRes, menuRes, addonRes] = await Promise.all([
          restaurantAPI.getFreebieOffer(),
          restaurantAPI.getMenu().catch(() => null),
          restaurantAPI.getAddons().catch(() => null),
        ])
        if (cancelled) return

        const offer = offerRes?.data?.data?.offer || offerRes?.data?.offer || null
        setIsActive(offer?.isActive !== false)
        setTiers((offer?.tiers || []).map(toTierDraft))

        // The menu comes back as { sections: [{ name, items, subsections }] }.
        // Read those two levels explicitly rather than walking the tree for
        // anything with a name: sections carry a name and an id too, so a walk
        // would offer "Breads" as a dish, and picking it would store a category
        // id that resolves to no item at checkout -- a freebie that silently
        // never arrives.
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

        const addonList =
          addonRes?.data?.data?.addons || addonRes?.data?.addons || addonRes?.data?.data || []
        setAddons(
          (Array.isArray(addonList) ? addonList : []).map((a) => ({
            id: String(a._id || a.id || ""),
            name: a.name || a.published?.name || a.draft?.name || "Add-on",
          })),
        )
      } catch (error) {
        if (!cancelled) toast.error("Could not load your free-item offers")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const rewardOptions = useMemo(() => ({ item: items, addon: addons }), [items, addons])

  const updateTier = (localId, field, value) =>
    setTiers((prev) =>
      prev.map((t) =>
        t.localId === localId
          ? {
              ...t,
              [field]: value,
              // Switching reward type invalidates whatever was chosen/typed
              // for the previous one, so both are cleared rather than left
              // pointing at the wrong kind of reward.
              ...(field === "rewardType" ? { rewardId: "", rewardName: "" } : {}),
            }
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
      await restaurantAPI.updateFreebieOffer({
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
      toast.error(error?.response?.data?.message || "Could not save your offers")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 pb-28 text-gray-900">
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-200 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={goBack} className="rounded-xl p-2 -ml-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Free Item On Order Value</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Give a dish or add-on free once an order reaches a qualifying threshold.</p>
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
        {/* Toggle Offer Status */}
        <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-sm font-bold text-gray-900">Freebie Offer Promotion: <span className={isActive ? "text-emerald-600 font-semibold" : "text-gray-500"}>{isActive ? "Active" : "Paused"}</span></p>
            <p className="text-xs text-gray-500 mt-0.5">
              Turning it off keeps your configured reward tiers so you can reactivate anytime without retyping.
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
            Loading reward tiers...
          </div>
        ) : (
          <div className="space-y-4">
            {tiers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
                <Gift className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                <p className="text-sm font-bold text-gray-900">No free-item offer tiers yet</p>
                <p className="mt-1 text-xs text-gray-500 max-w-sm mx-auto">
                  Add reward tiers to incentivize customers with free items when their cart reaches a target amount.
                </p>
              </div>
            )}

            {tiers.map((tier, index) => (
              <div key={tier.localId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Tier #{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => setTiers((prev) => prev.filter((t) => t.localId !== tier.localId))}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    aria-label="Remove tier"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">On Orders Over (₹)</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-500">
                        {"₹"}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={tier.minOrderValue}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, "")
                          const parts = v.split(".")
                          updateTier(
                            tier.localId,
                            "minOrderValue",
                            parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : v,
                          )
                        }}
                        placeholder="200"
                        className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-8 pr-3 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">Reward Type</label>
                    <select
                      value={tier.rewardType}
                      onChange={(e) => updateTier(tier.localId, "rewardType", e.target.value)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                    >
                      <option value="item">Free Menu Dish</option>
                      <option value="addon">Free Add-On Item</option>
                      <option value="manual">Type Manually</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                      {tier.rewardType === "addon"
                        ? "Select Add-on Item"
                        : tier.rewardType === "manual"
                          ? "Reward Name"
                          : "Select Menu Dish"}
                    </label>
                    {tier.rewardType === "manual" ? (
                      <input
                        type="text"
                        value={tier.rewardName}
                        onChange={(e) => updateTier(tier.localId, "rewardName", e.target.value)}
                        placeholder="e.g. Cold Drink"
                        maxLength={120}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                      />
                    ) : (
                      <select
                        value={tier.rewardId}
                        onChange={(e) => updateTier(tier.localId, "rewardId", e.target.value)}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-gray-900 focus:outline-none"
                      >
                        <option value="">Choose item...</option>
                        {(rewardOptions[tier.rewardType] || []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name} {option.price ? `(₹${option.price})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setTiers((prev) => [...prev, emptyTier()])}
                className="inline-flex items-center gap-2 rounded-xl border border-primary-orange/30 bg-primary-orange/5 px-4 py-2.5 text-xs font-bold text-accent-orange hover:bg-primary-orange/10 transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" />
                <span>Add Reward Tier</span>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600 leading-relaxed">
              If an order clears multiple tiers, the customer receives the highest eligible tier reward only. Free items are attached automatically at checkout and do not increase the order threshold calculation.
            </div>
          </div>
        )}

        {/* Mobile Save Button */}
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
