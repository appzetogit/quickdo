import { useCallback, useEffect, useMemo, useState } from "react"
import { Search, Truck } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * Free delivery, in one place: the platform-wide rule and the per-restaurant
 * overrides that beat it.
 *
 * These used to be nowhere and inside the Delivery & Platform Fee page
 * respectively, which meant a promotion aimed at customers was filed under
 * rider administration. Both conditions of the rule -- close enough AND
 * spending enough -- are required, so the page always shows the pair together
 * rather than letting one be set without the other.
 *
 * Waiving the fee costs the platform, not the restaurant: the rider is paid in
 * full either way. That is why this is admin-only and why the copy says so.
 */

const MODES = [
    {
        value: "inherit",
        label: "Follow the platform rule",
        hint: "Whatever is set above applies here. This is the default.",
    },
    {
        value: "off",
        label: "Never free for this restaurant",
        hint: "Excluded even while the platform rule is running.",
    },
    {
        value: "custom",
        label: "Its own rule",
        hint: "Ignores the platform rule and uses the radius and minimum below.",
    },
]

const digits = (value) => String(value ?? "").replace(/[^0-9.]/g, "")

export default function FreeDeliveryPage() {
    // Platform-wide
    const [platform, setPlatform] = useState({ isEnabled: false, maxDistanceKm: "3", minOrderAmount: "300" })
    const [loadingPlatform, setLoadingPlatform] = useState(true)
    const [savingPlatform, setSavingPlatform] = useState(false)

    // Per restaurant
    const [restaurants, setRestaurants] = useState([])
    const [search, setSearch] = useState("")
    const [selectedId, setSelectedId] = useState("")
    const [setting, setSetting] = useState(null)
    const [effective, setEffective] = useState(null)
    const [loadingSetting, setLoadingSetting] = useState(false)
    const [savingSetting, setSavingSetting] = useState(false)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const [feeRes, listRes] = await Promise.all([
                    adminAPI.getFeeSettings(),
                    adminAPI.getRestaurants({ limit: 200 }).catch(() => null),
                ])
                if (cancelled) return

                const fee = feeRes?.data?.data?.feeSettings || feeRes?.data?.data || feeRes?.data || {}
                const rule = fee.freeDeliveryRule || {}
                setPlatform({
                    isEnabled: rule.isEnabled === true,
                    maxDistanceKm: String(rule.maxDistanceKm ?? 3),
                    minOrderAmount: String(rule.minOrderAmount ?? 300),
                })

                const list =
                    listRes?.data?.data?.restaurants || listRes?.data?.restaurants || listRes?.data?.data || []
                setRestaurants(Array.isArray(list) ? list : [])
            } catch (error) {
                if (!cancelled) toast.error(error?.response?.data?.message || "Could not load free delivery settings.")
            } finally {
                if (!cancelled) setLoadingPlatform(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const savePlatform = async () => {
        const km = Number(platform.maxDistanceKm)
        const amount = Number(platform.minOrderAmount)
        if (platform.isEnabled) {
            if (!Number.isFinite(km) || km <= 0) return toast.error("Set a radius above zero, or switch the rule off.")
            if (km > 50) return toast.error("That radius looks too large. Use 50 km or less.")
            if (!Number.isFinite(amount) || amount <= 0) {
                return toast.error("Set a minimum order amount above zero, or switch the rule off.")
            }
        }

        setSavingPlatform(true)
        try {
            // Fee settings save field by field, so sending only this rule leaves
            // the platform fee, GST and slabs untouched.
            await adminAPI.createOrUpdateFeeSettings({
                freeDeliveryRule: { isEnabled: platform.isEnabled, maxDistanceKm: km || 0, minOrderAmount: amount || 0 },
            })
            toast.success("Platform free delivery saved.")
            if (selectedId) loadSetting(selectedId)
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not save the platform rule.")
        } finally {
            setSavingPlatform(false)
        }
    }

    const loadSetting = useCallback(async (restaurantId) => {
        if (!restaurantId) return
        setLoadingSetting(true)
        try {
            const res = await adminAPI.getRestaurantFreeDelivery(restaurantId)
            const payload = res?.data?.data || res?.data || {}
            const s = payload.setting || {}
            setSetting({
                mode: s.mode || "inherit",
                maxDistanceKm: String(s.maxDistanceKm ?? 3),
                minOrderAmount: String(s.minOrderAmount ?? 300),
            })
            setEffective({ ...(payload.effective || {}), source: payload.effectiveSource })
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not load that restaurant's setting.")
            setSetting(null)
            setEffective(null)
        } finally {
            setLoadingSetting(false)
        }
    }, [])

    useEffect(() => {
        if (selectedId) loadSetting(selectedId)
        else {
            setSetting(null)
            setEffective(null)
        }
    }, [selectedId, loadSetting])

    const saveSetting = async () => {
        if (!selectedId || !setting) return
        const km = Number(setting.maxDistanceKm)
        const amount = Number(setting.minOrderAmount)
        if (setting.mode === "custom") {
            if (!Number.isFinite(km) || km <= 0) return toast.error("Set a radius above zero for this restaurant.")
            if (km > 50) return toast.error("That radius looks too large. Use 50 km or less.")
            if (!Number.isFinite(amount) || amount <= 0) return toast.error("Set a minimum order amount above zero.")
        }

        setSavingSetting(true)
        try {
            // Send the numbers as they stand, never 0 for a disabled field --
            // the server reads a zero as "nothing here" and keeps what it has.
            await adminAPI.updateRestaurantFreeDelivery(selectedId, {
                mode: setting.mode,
                maxDistanceKm: Number.isFinite(km) && km > 0 ? km : undefined,
                minOrderAmount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
            })
            toast.success("Restaurant free delivery saved.")
            loadSetting(selectedId)
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not save that restaurant's setting.")
        } finally {
            setSavingSetting(false)
        }
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return restaurants
        return restaurants.filter((r) =>
            String(r.restaurantName || r.name || "").toLowerCase().includes(q),
        )
    }, [restaurants, search])

    const effectiveLine = useMemo(() => {
        if (!effective) return ""
        if (!effective.isEnabled) {
            return effective.source === "restaurant_off"
                ? "Delivery is never free at this restaurant."
                : "Delivery is never free here, because no rule is running."
        }
        const who = effective.source === "restaurant" ? "This restaurant's own rule" : "The platform rule"
        return `${who}: free delivery within ${effective.maxDistanceKm} km on orders of ₹${effective.minOrderAmount} or more.`
    }, [effective])

    const field =
        "w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white disabled:bg-slate-100 disabled:text-slate-400"

    return (
        <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <Truck className="w-6 h-6 text-emerald-600" />
                <div>
                    <h1 className="text-xl font-bold text-slate-900">Free Delivery</h1>
                    <p className="text-sm text-slate-500">
                        Waive the delivery fee when the restaurant is close enough and the order is large enough. The
                        platform absorbs the fee and the rider is paid in full.
                    </p>
                </div>
            </div>

            {/* ---------------- platform-wide ---------------- */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-sm font-semibold text-slate-800">Everywhere on the platform</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Applies to every restaurant that has not been given its own setting below.
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={platform.isEnabled}
                        aria-label="Enable platform-wide free delivery"
                        onClick={() => setPlatform((p) => ({ ...p, isEnabled: !p.isEnabled }))}
                        className={`relative w-12 h-6 rounded-full shrink-0 transition-colors ${
                            platform.isEnabled ? "bg-emerald-600" : "bg-slate-300"
                        }`}
                    >
                        <span
                            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                                platform.isEnabled ? "translate-x-7" : "translate-x-1"
                            }`}
                        />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">Within radius (km)</label>
                        <input
                            value={platform.maxDistanceKm}
                            onChange={(e) => setPlatform((p) => ({ ...p, maxDistanceKm: digits(e.target.value) }))}
                            disabled={!platform.isEnabled}
                            className={field}
                            placeholder="3"
                        />
                        <p className="text-xs text-slate-500">
                            Measured along the road, the same distance the delivery slab is priced from.
                        </p>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-semibold text-slate-700">On orders of at least (₹)</label>
                        <input
                            value={platform.minOrderAmount}
                            onChange={(e) => setPlatform((p) => ({ ...p, minOrderAmount: digits(e.target.value) }))}
                            disabled={!platform.isEnabled}
                            className={field}
                            placeholder="300"
                        />
                        <p className="text-xs text-slate-500">Compared against the food subtotal, before fees and tax.</p>
                    </div>
                </div>

                {platform.isEnabled && (
                    <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                        Free delivery within {platform.maxDistanceKm || 0} km on orders of ₹
                        {platform.minOrderAmount || 0} or more.
                    </p>
                )}

                <div className="mt-5 flex justify-end">
                    <button
                        onClick={savePlatform}
                        disabled={savingPlatform || loadingPlatform}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                    >
                        {savingPlatform ? "Saving…" : "Save platform rule"}
                    </button>
                </div>
            </section>

            {/* ---------------- per restaurant ---------------- */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6">
                <h2 className="text-sm font-semibold text-slate-800">One restaurant at a time</h2>
                <p className="text-xs text-slate-500 mt-0.5 mb-5">
                    A restaurant's own setting beats the platform rule, including an exclusion.
                </p>

                <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
                    <div>
                        <div className="relative mb-3">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search restaurants"
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                        </div>
                        <div className="border border-slate-200 rounded-xl max-h-80 overflow-y-auto divide-y divide-slate-100">
                            {filtered.length === 0 && (
                                <p className="text-sm text-slate-500 px-3 py-4">No restaurants match that search.</p>
                            )}
                            {filtered.map((r) => {
                                const id = String(r._id || r.id)
                                return (
                                    <button
                                        key={id}
                                        onClick={() => setSelectedId(id)}
                                        className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                                            selectedId === id
                                                ? "bg-emerald-50 text-emerald-800 font-semibold"
                                                : "hover:bg-slate-50 text-slate-700"
                                        }`}
                                    >
                                        {r.restaurantName || r.name || "Unnamed restaurant"}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div>
                        {!selectedId && (
                            <p className="text-sm text-slate-500">Pick a restaurant to set its own rule.</p>
                        )}
                        {selectedId && loadingSetting && <p className="text-sm text-slate-500">Loading…</p>}
                        {selectedId && !loadingSetting && setting && (
                            <div className="space-y-5">
                                <div className="space-y-2">
                                    {MODES.map((m) => (
                                        <label
                                            key={m.value}
                                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                                                setting.mode === m.value
                                                    ? "border-emerald-500 bg-emerald-50"
                                                    : "border-slate-200 hover:bg-slate-50"
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="mode"
                                                checked={setting.mode === m.value}
                                                onChange={() => setSetting((s) => ({ ...s, mode: m.value }))}
                                                className="mt-1 accent-emerald-600"
                                            />
                                            <span>
                                                <span className="block text-sm font-semibold text-slate-800">
                                                    {m.label}
                                                </span>
                                                <span className="block text-xs text-slate-500">{m.hint}</span>
                                            </span>
                                        </label>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-700">
                                            Within radius (km)
                                        </label>
                                        <input
                                            value={setting.maxDistanceKm}
                                            onChange={(e) =>
                                                setSetting((s) => ({ ...s, maxDistanceKm: digits(e.target.value) }))
                                            }
                                            disabled={setting.mode !== "custom"}
                                            className={field}
                                            placeholder="3"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-semibold text-slate-700">
                                            On orders of at least (₹)
                                        </label>
                                        <input
                                            value={setting.minOrderAmount}
                                            onChange={(e) =>
                                                setSetting((s) => ({ ...s, minOrderAmount: digits(e.target.value) }))
                                            }
                                            disabled={setting.mode !== "custom"}
                                            className={field}
                                            placeholder="300"
                                        />
                                    </div>
                                </div>

                                {effectiveLine && (
                                    <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                        <span className="font-semibold">In effect now — </span>
                                        {effectiveLine}
                                    </p>
                                )}

                                <div className="flex justify-end">
                                    <button
                                        onClick={saveSetting}
                                        disabled={savingSetting}
                                        className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                                    >
                                        {savingSetting ? "Saving…" : "Save for this restaurant"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    )
}
