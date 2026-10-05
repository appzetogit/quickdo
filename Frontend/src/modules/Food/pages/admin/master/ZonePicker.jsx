import { useEffect, useState } from "react"
import { platformSettingsAPI } from "@food/api"
import { MapPin } from "lucide-react"

/**
 * Picks the zone a Master setting is saved for.
 *
 * Every module draws its own zones (Food zones, Quick zones, Medical zones,
 * Taxi zones), so the list comes from the module or modules given. Empty is
 * "All zones": the module's own default, which every zone without a value of
 * its own uses. The server resolves zone > module > all modules.
 *
 *   <ZonePicker modules={["food"]} value={zoneId} onChange={(id, name) => ...} />
 */

const MODULE_LABEL = { food: "Food", quickCommerce: "Quick", medical: "Medical", taxi: "Taxi" }
const cache = new Map()

// Per signed-in admin: a zone sub-admin's list is only their zones.
const sessionKey = () => {
  try {
    return String(localStorage.getItem("admin_accessToken") || "").slice(-16)
  } catch {
    return ""
  }
}

async function zonesOf(module) {
  const key = `${sessionKey()}:${module}`
  if (!cache.has(key)) {
    cache.set(
      key,
      platformSettingsAPI
        .zones(module)
        .then((res) => res?.data?.data?.zones || [])
        .catch(() => {
          cache.delete(key)
          return []
        }),
    )
  }
  return cache.get(key)
}

/**
 * `required`: a zone sub-admin must work in one of their zones, so there is no
 * "All zones" option and the picker selects their first zone by itself.
 */
export default function ZonePicker({ modules = [], value = "", onChange, disabled = false, allLabel = "All zones (default)", required = false }) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const key = modules.join(",")

  useEffect(() => {
    let alive = true
    if (!modules.length) {
      setOptions([])
      return undefined
    }
    setLoading(true)
    Promise.all(modules.map((m) => zonesOf(m).then((zones) => zones.map((z) => ({ ...z, module: m })))))
      .then((lists) => {
        if (alive) setOptions(lists.flat())
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // A required picker never sits on "All zones": take the first zone offered.
  useEffect(() => {
    if (required && !value && options.length) onChange?.(options[0].id, options[0].name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, value, options])

  const labelOf = (z) => `${z.name}${modules.length > 1 ? ` · ${MODULE_LABEL[z.module] || z.module}` : ""}${z.active ? "" : " (inactive)"}`

  return (
    <label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
      <MapPin className="h-4 w-4 shrink-0 text-neutral-400" />
      <span className="shrink-0 text-sm font-medium text-neutral-700">Zone</span>
      <select
        className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50"
        value={value || ""}
        disabled={disabled || !modules.length || loading}
        onChange={(e) => {
          const id = e.target.value
          const zone = options.find((z) => z.id === id)
          onChange?.(id, zone ? zone.name : "")
        }}
      >
        {!required && <option value="">{modules.length ? allLabel : "Pick a module first to set a zone"}</option>}
        {required && !options.length && <option value="">{loading ? "Loading your zones…" : "No zones assigned to you here"}</option>}
        {options.map((z) => (
          <option key={`${z.module}:${z.id}`} value={z.id}>
            {labelOf(z)}
          </option>
        ))}
      </select>
      {loading && <span className="shrink-0 text-xs text-neutral-400">Loading…</span>}
    </label>
  )
}
