import { useEffect, useState } from "react"
import { Tag } from "lucide-react"
import { toast } from "sonner"

import { adminAPI } from "@food/api"

/**
 * The price point the value shelf runs at.
 *
 * One number, but changing it moves dishes on and off a customer-facing shelf,
 * so the page says plainly what will happen before the admin saves. The two
 * directions genuinely behave differently and the difference is not guessable:
 * raising backfills, lowering does not clear anything.
 */

const DEFAULT_CAP = 99

export default function NinetyNineStore() {
    const [cap, setCap] = useState("")
    const [savedCap, setSavedCap] = useState(DEFAULT_CAP)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const res = await adminAPI.getLandingSettings()
                const s = res?.data?.data || res?.data || {}
                const value = Number(s.ninetyNineStoreMaxPrice)
                const resolved = Number.isFinite(value) && value > 0 ? value : DEFAULT_CAP
                if (!cancelled) {
                    setCap(String(resolved))
                    setSavedCap(resolved)
                }
            } catch (error) {
                if (!cancelled) toast.error(error?.response?.data?.message || "Could not load the shelf settings.")
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const wanted = Number(cap)
    const valid = Number.isFinite(wanted) && wanted > 0 && wanted <= 10000
    const changed = valid && wanted !== savedCap
    const direction = !changed ? null : wanted > savedCap ? "raised" : "lowered"

    const save = async () => {
        if (!valid) return toast.error("Set a price above zero, up to 10000.")
        setSaving(true)
        try {
            await adminAPI.updateLandingSettings({ ninetyNineStoreMaxPrice: wanted })
            setSavedCap(wanted)
            toast.success(
                direction === "raised"
                    ? `Shelf now runs at ₹${wanted}. Newly eligible dishes have been added.`
                    : `Shelf now runs at ₹${wanted}.`,
            )
        } catch (error) {
            toast.error(error?.response?.data?.message || "Could not save the price.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <Tag className="w-6 h-6 text-emerald-600" />
                <div>
                    <h1 className="text-xl font-bold text-slate-900">99 Store</h1>
                    <p className="text-sm text-slate-500">
                        The price point the value shelf runs at. Dishes at or under this price, approved and marked for
                        the shelf, appear on it in the customer app.
                    </p>
                </div>
            </div>

            <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6">
                <label className="block text-sm font-semibold text-slate-700 mb-2">Shelf price (₹)</label>
                <input
                    value={cap}
                    onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))}
                    disabled={loading}
                    className="w-full max-w-xs px-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all bg-white disabled:bg-slate-100"
                    placeholder="99"
                />
                <p className="text-xs text-slate-500 mt-2">
                    Currently running at ₹{savedCap}. The customer app reads this, so the shelf&rsquo;s name and headings
                    follow it automatically.
                </p>

                {changed && (
                    <div
                        className={`mt-4 rounded-lg px-3 py-2.5 text-sm ${
                            direction === "raised"
                                ? "bg-emerald-50 text-emerald-800"
                                : "bg-amber-50 text-amber-900"
                        }`}
                    >
                        {direction === "raised" ? (
                            <>
                                <span className="font-semibold">Raising ₹{savedCap} → ₹{wanted}.</span> Every approved
                                dish at or under ₹{wanted} joins the shelf straight away, except any you have taken off
                                by hand — those stay off.
                            </>
                        ) : (
                            <>
                                <span className="font-semibold">Lowering ₹{savedCap} → ₹{wanted}.</span> Dishes above ₹
                                {wanted} leave the shelf, but keep their marking, so setting it back to ₹{savedCap}
                                restores the shelf exactly as it is now.
                            </>
                        )}
                    </div>
                )}

                <div className="mt-5 flex justify-end">
                    <button
                        onClick={save}
                        disabled={saving || loading || !valid || !changed}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                    >
                        {saving ? "Saving…" : "Save price"}
                    </button>
                </div>
            </section>

            <section className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 text-sm text-slate-600 space-y-3">
                <h2 className="text-sm font-semibold text-slate-800">How the shelf decides</h2>
                <p>
                    A dish is on the shelf when it is approved, priced at or under this price, and marked for the shelf.
                    The marking is set automatically when a dish becomes eligible — on approval, or when a price edit
                    brings it under the price.
                </p>
                <p>
                    Taking a dish off the shelf by hand is remembered. It will not be put back by a later price change to
                    this setting; only editing that dish&rsquo;s own price back under the cap will.
                </p>
                <p>
                    Individual dishes are toggled from the food list, not here. This page only sets the price point.
                </p>
            </section>
        </div>
    )
}
