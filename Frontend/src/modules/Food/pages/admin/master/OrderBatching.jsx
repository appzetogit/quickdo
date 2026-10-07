import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Layers, Loader2 } from "lucide-react"
import { platformSettingsAPI } from "@food/api"
import { Switch } from "@food/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@food/components/ui/card"

/**
 * Master > Order Batching: when a rider already on a trip may be given a
 * second order. The rule itself is core/delivery/batching.js; these are its
 * platform-wide settings (registry keys batching.*).
 */

const FIELDS = [
  { key: "batching.maxOrders", label: "Most orders on one trip", unit: "orders", min: 2, max: 3, step: 1 },
  { key: "batching.pickupRadiusM", label: "Stores at most this far apart", unit: "metres", min: 0, max: 3000, step: 50, hint: "0 means the same store only." },
  { key: "batching.dropRadiusKm", label: "Drops at most this far apart", unit: "km", min: 0.2, max: 15, step: 0.1 },
  { key: "batching.maxWaitMinutes", label: "Only within this long of the first order being accepted", unit: "minutes", min: 1, max: 60, step: 1, hint: "Keeps the first customer from waiting on a detour." },
]
const KEYS = ["batching.enabled", ...FIELDS.map((f) => f.key)]

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

export default function OrderBatching() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState({})
  const [saved, setSaved] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await Promise.all(KEYS.map((k) => platformSettingsAPI.explain(k)))
      const next = Object.fromEntries(rows.map((r, i) => [KEYS[i], r?.data?.data?.effective]))
      setValues(next)
      setSaved(next)
    } catch (err) {
      toast.error(errText(err, "Could not load batching settings"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const changed = KEYS.filter((k) => String(values[k]) !== String(saved[k]))

  const save = async () => {
    for (const f of FIELDS) {
      const n = Number(values[f.key])
      if (!Number.isFinite(n) || n < f.min || n > f.max) {
        toast.error(`${f.label}: enter ${f.min} to ${f.max} ${f.unit}`)
        return
      }
    }
    setSaving(true)
    try {
      for (const k of changed) {
        // eslint-disable-next-line no-await-in-loop
        await platformSettingsAPI.set(k, {
          level: "global",
          value: k === "batching.enabled" ? values[k] === true : Number(values[k]),
          reason: "Master > Order Batching",
        })
      }
      toast.success(values["batching.enabled"] ? "Batching settings saved" : "Saved: one order per rider")
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save batching settings"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900">
            <Layers className="h-5 w-5" /> Order batching
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Give a rider who is on the way to a store a second Food or Quick order from the same or a nearby store,
            going the same way. They pick both up together and deliver one after the other. Each order pays its own delivery fee.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Batching</CardTitle>
            <CardDescription>Applies to every zone. Off, every rider carries one order at a time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
            ) : (
              <>
                <label className="flex items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-medium text-neutral-900">Give riders a second order on the same trip</span>
                    <span className="block text-xs text-neutral-500">Only when every rule below holds; otherwise the order goes to a free rider.</span>
                  </span>
                  <Switch
                    checked={values["batching.enabled"] === true}
                    onCheckedChange={(on) => setValues((v) => ({ ...v, "batching.enabled": on }))}
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="block text-sm text-neutral-800">{f.label}</span>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="number"
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          value={values[f.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                        />
                        <span className="shrink-0 text-xs text-neutral-500">{f.unit}</span>
                      </div>
                      {f.hint && <span className="mt-1 block text-xs text-neutral-500">{f.hint}</span>}
                    </label>
                  ))}
                </div>

                <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
                  A second order joins a trip only while the rider has not picked up the first one yet. Orders you assign to a rider by hand
                  are not held to these rules. Riders need the latest delivery app to see two orders on one trip.
                </p>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || changed.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save
                  </button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
