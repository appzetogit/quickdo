import { useEffect, useState } from "react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion } from "framer-motion"
import { ArrowLeft, MapPin, AlertTriangle, Loader2, Info } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { toast } from "sonner"

const QUICK_PICKS = [3, 5, 8, 10, 15]

const digits = (value) => String(value ?? "").replace(/[^0-9.]/g, "")

const whenLabel = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

/**
 * How far this outlet delivers.
 *
 * The admin panel edits this same number. Whatever either side saves is what
 * the customer app lists by, what the cart checks and what order placement
 * refuses on -- so this screen always reloads from the server after saving
 * rather than trusting what was typed.
 */
export default function DeliveryRadius() {
  const goBack = useRestaurantBackNavigation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [km, setKm] = useState("")

  const apply = (payload) => {
    setData(payload)
    setEnabled(payload?.serviceRadiusKm != null)
    setKm(payload?.serviceRadiusKm != null ? String(payload.serviceRadiusKm) : "")
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await restaurantAPI.getServiceRadius()
        if (!cancelled) apply(res?.data?.data || res?.data || {})
      } catch (error) {
        if (!cancelled) toast.error(error?.response?.data?.message || "Could not load your delivery radius")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const max = Number(data?.maxRadiusKm) || 20
  const min = Number(data?.minRadiusKm) || 1

  const save = async () => {
    let value = null
    if (enabled) {
      value = Number(km)
      if (!Number.isFinite(value) || km === "") return toast.error("Enter your delivery radius in km")
      if (value < min) return toast.error(`The delivery radius must be at least ${min} km`)
      if (value > max) return toast.error(`The delivery radius cannot be more than ${max} km`)
    }
    setSaving(true)
    try {
      const res = await restaurantAPI.updateServiceRadius(value)
      apply(res?.data?.data || res?.data || {})
      toast.success(value === null ? `You now deliver within the platform radius (${max} km)` : `You now deliver within ${value} km`)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save your delivery radius")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3.5 flex items-center gap-3">
          <button
            onClick={goBack}
            className="p-2 -ml-2 hover:bg-gray-100 rounded-xl text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Delivery radius</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Choose how far from your outlet you deliver</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full flex-1 px-4 sm:px-6 py-6 space-y-4">
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 flex items-center justify-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading your setting</span>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {data && data.hasLocation === false && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Your outlet has no location saved, so a radius cannot be measured. Update your outlet
                  address first.
                </p>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Where you deliver</h2>
                  <p className="text-xs text-gray-500">Measured along the road from your outlet</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { on: false, title: "Platform radius", hint: `Customers within ${max} km can order` },
                  { on: true, title: "Only within a radius", hint: "Customers further away cannot see or order from you" },
                ].map((opt) => (
                  <button
                    key={String(opt.on)}
                    type="button"
                    onClick={() => setEnabled(opt.on)}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      enabled === opt.on ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <span className="block text-sm font-bold text-gray-900">{opt.title}</span>
                    <span className="block text-xs text-gray-500 mt-0.5">{opt.hint}</span>
                  </button>
                ))}
              </div>

              {enabled && (
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-gray-700" htmlFor="radius-km">
                    Deliver within (km)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="radius-km"
                      inputMode="decimal"
                      value={km}
                      onChange={(e) => setKm(digits(e.target.value))}
                      placeholder="10"
                      className="w-32 px-4 py-2.5 border border-gray-300 rounded-xl text-lg font-semibold tabular-nums outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-500">km, between {min} and {max}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PICKS.filter((n) => n >= min && n <= max).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setKm(String(n))}
                        className={`px-3 py-1.5 rounded-full text-sm border tabular-nums ${
                          Number(km) === n
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {n} km
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={save}
                  disabled={saving || (enabled && data?.hasLocation === false)}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {data?.capped && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  You saved {data.serviceRadiusKm} km, but the platform currently allows at most {data.maxRadiusKm} km,
                  so you are delivering within {data.effectiveRadiusKm} km. Your {data.serviceRadiusKm} km comes back
                  if the limit is raised.
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white p-4 flex gap-3">
              <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <div className="text-xs text-gray-600 leading-relaxed space-y-1">
                <p>
                  {data?.effectiveRadiusKm != null
                    ? `In effect now: you deliver within ${data.effectiveRadiusKm} km of your outlet${data.usesDefault ? " (the platform radius)" : ""}.`
                    : "In effect now: you deliver across your whole zone."}
                  {data?.updatedBy &&
                    ` Last changed by ${data.updatedBy === "admin" ? "the Quick Drop team" : "you"}${
                      whenLabel(data.updatedAt) ? ` on ${whenLabel(data.updatedAt)}` : ""
                    }.`}
                </p>
                <p>Orders already placed are not affected.</p>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
