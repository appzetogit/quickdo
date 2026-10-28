import { useCallback, useEffect, useMemo, useState } from "react"
import { MapPin, Search } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * Delivery radius: the platform ceiling, and each restaurant's own radius.
 *
 * The per-restaurant number is the same field the restaurant edits from its
 * app. Both sides save through one service on the server, so this page shows
 * who changed it last rather than pretending the admin owns it.
 *
 * The ceiling is the admin's alone. Lowering it narrows every restaurant above
 * it straight away, without overwriting what they saved.
 */

const digits = (value) => String(value ?? "").replace(/[^0-9.]/g, "")

const whenLabel = (iso) => {
    if (!iso) return ""
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

export default function DeliveryRadiusPage() {
    const [overview, setOverview] = useState(null)
    const [ceiling, setCeiling] = useState("")
    const [savingCeiling, setSavingCeiling] = useState(false)

    const [restaurants, setRestaurants] = useState([])
    const [search, setSearch] = useState("")
    const [selectedId, setSelectedId] = useState("")
    const [radius, setRadius] = useState(null)
    const [enabled, setEnabled] = useState(false)
    const [km, setKm] = useState("")
    const [loadingRadius, setLoadingRadius] = useState(false)
    const [savingRadius, setSavingRadius] = useState(false)

    const applyOverview = (payload) => {
        setOverview(payload)
        setCeiling(String(payload?.settings?.maxRadiusKm ?? 20))
    }

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const [settingsRes, listRes] = await Promise.all([
                    adminAPI.getServiceRadiusSettings(),
                    adminAPI.getRestaurants({ limit: 200 }).catch(() => null),
                ])
                if (cancelled) return
                applyOverview(settingsRes?.data?.data || {})
                const list =
                    listRes?.data?.data?.restaurants || listRes?.data?.restaurants || listRes?.data?.data || []
                setRestaurants(Array.isArray(list) ? list : [])
            } catch (error) {
                if (!cancelled) toast.error(error?.response?.data?.message || "Could not load delivery radius settings.")
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const applyRadius = (payload) => {
        setRadius(payload)
        setEnabled(payload?.serviceRadiusKm != null)
        setKm(payload?.serviceRadiusKm != null ? String(payload.serviceRadiusKm) : "")
    }

    const loadRadius = useCallback(async (restaurantId) => {
        if (!restaurantId) return
        setLoadingRadius(true)
        try {
            const res = await adminAPI.getRestaurantServiceRadius(restaurantId)
            applyRadius(res?.data?.data || {})
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not load that restaurant's radius.")
            setRadius(null)
        } finally {
            setLoadingRadius(false)
        }
    }, [])

    useEffect(() => {
        if (selectedId) loadRadius(selectedId)
        else setRadius(null)
    }, [selectedId, loadRadius])

    const saveCeiling = async () => {
        const value = Number(ceiling)
        if (!Number.isFinite(value) || ceiling === "") return toast.error("Enter the largest radius in km.")
        if (value < 1 || value > 100) return toast.error("The largest radius must be between 1 and 100 km.")
        setSavingCeiling(true)
        try {
            const res = await adminAPI.updateServiceRadiusSettings(value)
            applyOverview(res?.data?.data || {})
            toast.success(`Restaurants can now deliver up to ${value} km.`)
            if (selectedId) loadRadius(selectedId)
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not save the largest radius.")
        } finally {
            setSavingCeiling(false)
        }
    }

    const saveRadius = async () => {
        if (!selectedId) return
        let value = null
        if (enabled) {
            value = Number(km)
            const max = Number(radius?.maxRadiusKm) || 20
            if (!Number.isFinite(value) || km === "") return toast.error("Enter the radius in km.")
            if (value < 1) return toast.error("The radius must be at least 1 km.")
            if (value > max) return toast.error(`The radius cannot be more than ${max} km. Raise the limit above first.`)
        }
        setSavingRadius(true)
        try {
            const res = await adminAPI.updateRestaurantServiceRadius(selectedId, value)
            applyRadius(res?.data?.data || {})
            toast.success(value === null ? "This restaurant now delivers across its zone." : `Saved: within ${value} km.`)
            adminAPI.getServiceRadiusSettings().then((r) => applyOverview(r?.data?.data || {})).catch(() => {})
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not save that restaurant's radius.")
        } finally {
            setSavingRadius(false)
        }
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return restaurants
        return restaurants.filter((r) => String(r.restaurantName || r.name || "").toLowerCase().includes(q))
    }, [restaurants, search])

    const field =
        "w-full px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white tabular-nums"

    return (
        <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <MapPin className="w-6 h-6 text-emerald-600" />
                <div>
                    <h1 className="text-xl font-bold text-slate-900">Delivery Radius</h1>
                    <p className="text-sm text-slate-500">
                        How far each restaurant delivers, measured along the road from its outlet. Customers further
                        away do not see the restaurant and cannot order from it. The zone still applies as well.
                    </p>
                </div>
            </div>

            {/* ---------------- ceiling ---------------- */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6">
                <h2 className="text-sm font-semibold text-slate-800">Delivery radius for every restaurant</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                    Restaurants without a radius of their own deliver within this distance, and customers further
                    away don't see them. A restaurant can choose a smaller radius, never a larger one. Changes apply
                    immediately.
                </p>
                <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="w-full sm:w-48 space-y-2">
                        <label className="block text-sm font-semibold text-slate-700" htmlFor="ceiling-km">
                            Up to (km)
                        </label>
                        <input
                            id="ceiling-km"
                            value={ceiling}
                            onChange={(e) => setCeiling(digits(e.target.value))}
                            className={field}
                            placeholder="20"
                        />
                    </div>
                    <button
                        onClick={saveCeiling}
                        disabled={savingCeiling || !overview}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                    >
                        {savingCeiling ? "Saving…" : "Save limit"}
                    </button>
                </div>
                {overview && (
                    <p className="mt-4 text-sm text-slate-600">
                        {overview.restaurantsWithRadius} restaurant{overview.restaurantsWithRadius === 1 ? "" : "s"}{" "}
                        {overview.restaurantsWithRadius === 1 ? "has" : "have"} set a radius
                        {overview.restaurantsCapped > 0 && (
                            <span className="text-amber-700">
                                {" "}
                                · {overview.restaurantsCapped} held back by this limit
                            </span>
                        )}
                        .
                    </p>
                )}
            </section>

            {/* ---------------- per restaurant ---------------- */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6">
                <h2 className="text-sm font-semibold text-slate-800">One restaurant at a time</h2>
                <p className="text-xs text-slate-500 mt-0.5 mb-5">
                    The same setting the restaurant sees in its app. A change here shows there straight away.
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
                        {!selectedId && <p className="text-sm text-slate-500">Pick a restaurant to see its radius.</p>}
                        {selectedId && loadingRadius && <p className="text-sm text-slate-500">Loading…</p>}
                        {selectedId && !loadingRadius && radius && (
                            <div className="space-y-5">
                                {radius.hasLocation === false && (
                                    <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                                        This restaurant has no location saved, so a radius cannot be measured. Set
                                        its location first.
                                    </p>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {[
                                        { on: false, title: "Platform radius", hint: `Within ${radius.maxRadiusKm} km, set above.` },
                                        { on: true, title: "Only within a radius", hint: "Further away is refused." },
                                    ].map((opt) => (
                                        <button
                                            key={String(opt.on)}
                                            type="button"
                                            onClick={() => setEnabled(opt.on)}
                                            className={`text-left p-3 rounded-xl border transition-colors ${
                                                enabled === opt.on
                                                    ? "border-emerald-500 bg-emerald-50"
                                                    : "border-slate-200 hover:bg-slate-50"
                                            }`}
                                        >
                                            <span className="block text-sm font-semibold text-slate-800">{opt.title}</span>
                                            <span className="block text-xs text-slate-500">{opt.hint}</span>
                                        </button>
                                    ))}
                                </div>

                                {enabled && (
                                    <div className="w-full md:w-60 space-y-2">
                                        <label className="block text-sm font-semibold text-slate-700" htmlFor="restaurant-km">
                                            Deliver within (km)
                                        </label>
                                        <input
                                            id="restaurant-km"
                                            value={km}
                                            onChange={(e) => setKm(digits(e.target.value))}
                                            className={field}
                                            placeholder="10"
                                        />
                                        <p className="text-xs text-slate-500">Between 1 and {radius.maxRadiusKm} km.</p>
                                    </div>
                                )}

                                <p className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                    <span className="font-semibold">In effect now — </span>
                                    {radius.effectiveRadiusKm != null
                                        ? `delivers within ${radius.effectiveRadiusKm} km${radius.usesDefault ? " (the platform radius)" : ""}`
                                        : "delivers across its whole zone"}
                                    {radius.capped &&
                                        ` (saved ${radius.serviceRadiusKm} km, held to ${radius.maxRadiusKm} km by the limit)`}
                                    .
                                    {radius.updatedBy && (
                                        <span className="block text-xs text-slate-500 mt-1">
                                            Last changed by {radius.updatedBy === "admin" ? "an admin" : "the restaurant"}
                                            {whenLabel(radius.updatedAt) ? ` on ${whenLabel(radius.updatedAt)}` : ""}.
                                        </span>
                                    )}
                                </p>

                                <div className="flex justify-end">
                                    <button
                                        onClick={saveRadius}
                                        disabled={savingRadius || (enabled && radius.hasLocation === false)}
                                        className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                                    >
                                        {savingRadius ? "Saving…" : "Save for this restaurant"}
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
