import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { platformSettingsAPI } from "@food/api"

/**
 * Master settings > Global platform: country, currency, phone code, time zone
 * and the delivery / schedule defaults, saved once through the settings
 * resolver (core/config/registry.js, core/config/globalPlatform.js). Apps read
 * them from /v1/platform/global-settings.
 *
 * An empty number means "not set here": each service keeps its own default.
 */

const FIELDS = [
  { key: "platform.countryCode", label: "Country", placeholder: "IN", hint: "Two-letter ISO code" },
  { key: "platform.currencyCode", label: "Currency", placeholder: "INR", hint: "Three-letter ISO code" },
  { key: "platform.currencySymbol", label: "Currency symbol", placeholder: "₹" },
  { key: "platform.phoneCode", label: "Phone country code", placeholder: "+91" },
  { key: "platform.timezone", label: "Time zone", placeholder: "Asia/Kolkata", hint: "IANA name" },
  { key: "delivery.defaultRadiusKm", label: "Default delivery radius (km)", number: true },
  { key: "schedule.maxDaysAhead", label: "Schedule up to (days ahead)", number: true },
  { key: "schedule.minLeadMinutes", label: "Earliest scheduled time (minutes from now)", number: true },
]

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"

export default function GlobalPlatformSettings() {
  const [settings, setSettings] = useState(null)
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await platformSettingsAPI.resolveAll({})
      const list = res?.data?.data?.settings || []
      const map = Object.fromEntries(list.map((s) => [s.key, s]))
      setSettings(map)
      setValues(Object.fromEntries(FIELDS.map((f) => {
        const s = map[f.key]
        const v = s?.effective
        return [f.key, v === null || v === undefined ? "" : String(v)]
      })))
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load global settings")
    }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      for (const f of FIELDS) {
        const current = settings?.[f.key]?.effective
        const next = values[f.key]
        const same = String(current ?? "") === String(next ?? "")
        if (same) continue
        // eslint-disable-next-line no-await-in-loop
        await platformSettingsAPI.set(f.key, {
          level: "global",
          value: next === "" ? null : f.number ? Number(next) : next.trim(),
          reason: "Master > Global platform",
        })
      }
      toast.success("Saved")
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return <div className="flex items-center gap-2 py-10 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings</div>
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Global platform</h2>
        <p className="mt-1 text-xs text-neutral-500">One country, currency, dialling code and time zone for every service and app. Empty numbers leave each service on its own default.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const s = settings[f.key]
            return (
              <label key={f.key} className="block text-sm">
                <span className="font-medium text-neutral-800">{f.label}</span>
                <input
                  className={`${inputCls} mt-1`}
                  type={f.number ? "number" : "text"}
                  min={f.number ? 0 : undefined}
                  placeholder={f.placeholder || "Each service's own"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
                <span className="mt-0.5 block text-xs text-neutral-500">
                  {f.hint ? `${f.hint}. ` : ""}{s?.source ? `Now: ${s.source}` : ""}
                </span>
              </label>
            )
          })}
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save global settings
          </button>
        </div>
      </section>
    </div>
  )
}
