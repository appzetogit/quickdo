import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { platformSettingsAPI } from "@food/api"
import { Card, VerticalSelect, ZoneSelect, inputCls, ghostCls, verticalMeta, errorText } from "./masterKit"

/**
 * Config provenance (MASTER_PRODUCT_PLAN Phase 6): the settings that used to
 * live only on each service's own screen, now read through the Master
 * settings resolver. For each one: the value in effect for a service (and a
 * zone), and where it comes from -- a zone, service (vertical) or global
 * Master value, or still the service's own screen.
 *
 * Precedence: zone > service > the service's own screen > global, except the
 * platform fee, where a global Master value has always beaten the service's own.
 * Backend: core/config/legacySettings.js, GET /v1/platform/settings/provenance.
 */

const ORIGIN_STYLE = {
  zone: "bg-violet-50 text-violet-700 ring-violet-200",
  vertical: "bg-sky-50 text-sky-700 ring-sky-200",
  global: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  legacy: "bg-amber-50 text-amber-800 ring-amber-200",
  default: "bg-neutral-100 text-neutral-600 ring-neutral-200",
}
const ORIGIN_TEXT = {
  zone: "Zone override",
  vertical: "Service override",
  global: "Global",
  legacy: "Service’s own screen",
  default: "Default",
}
const LEVEL_TEXT = { zone: "This zone", vertical: "This service", global: "Global" }

const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v))

function Row({ row, zoneId, onSaved }) {
  const levels = ["vertical", "global", ...(zoneId && row.scopes.includes("zone") ? ["zone"] : [])]
    .filter((l) => row.scopes.includes(l))
  const [level, setLevel] = useState(levels[0] || "vertical")
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)

  const save = async (clear) => {
    setBusy(true)
    try {
      await platformSettingsAPI.set(row.key, {
        level,
        scopeId: level === "vertical" ? row.vertical : level === "zone" ? zoneId : undefined,
        value: clear ? null : value === "" ? null : Number(value),
        reason: "Master > Global platform > Where values come from",
      })
      toast.success(clear ? "Override cleared" : "Saved")
      setValue("")
      onSaved()
    } catch (err) {
      toast.error(errorText(err, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  const chain = (row.chain || []).filter((c) => c.set)
  return (
    <tr className="border-t border-neutral-100 align-top">
      <td className="py-2 pr-3">
        <p className="font-medium text-neutral-900">{row.label}</p>
        <p className="text-xs text-neutral-500">{row.key}</p>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap">{verticalMeta(row.vertical).label}</td>
      <td className="py-2 pr-3 font-semibold tabular-nums">{show(row.effective)}</td>
      <td className="py-2 pr-3">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${ORIGIN_STYLE[row.origin] || ORIGIN_STYLE.default}`}>
          {ORIGIN_TEXT[row.origin] || row.origin}
        </span>
        {row.origin === "legacy" && <p className="mt-0.5 text-xs text-neutral-500">{row.legacy.source}</p>}
        {chain.length > 0 && (
          <p className="mt-0.5 text-xs text-neutral-500">
            {chain.map((c) => `${LEVEL_TEXT[c.level] || c.level}: ${show(c.value)}`).join(" · ")}
          </p>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-neutral-600">
        {show(row.legacy.value)}
        <span className="block text-neutral-400">{row.legacy.source}</span>
      </td>
      <td className="py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="Level" className={`${inputCls} py-1`} value={level} onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => <option key={l} value={l}>{LEVEL_TEXT[l]}</option>)}
          </select>
          <input aria-label="Value" className={`${inputCls} w-24 py-1`} type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" />
          <button type="button" className={`${ghostCls} py-1`} disabled={busy || value === ""} onClick={() => save(false)}>Set</button>
          <button type="button" className={`${ghostCls} py-1`} disabled={busy} onClick={() => save(true)}>Clear</button>
        </div>
      </td>
    </tr>
  )
}

export default function ConfigProvenance() {
  const [vertical, setVertical] = useState("all")
  const [zoneId, setZoneId] = useState("")
  const [rows, setRows] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await platformSettingsAPI.provenance({
        vertical: vertical === "all" ? undefined : vertical,
        zoneId: vertical !== "all" && zoneId ? zoneId : undefined,
      })
      setRows(res?.data?.data?.settings || [])
    } catch (err) {
      toast.error(errorText(err, "Could not load where settings come from"))
      setRows([])
    }
  }, [vertical, zoneId])
  useEffect(() => { load() }, [load])

  return (
    <Card
      title="Where each value comes from"
      action={
        <div className="flex flex-wrap gap-2">
          <VerticalSelect value={vertical} onChange={(v) => { setVertical(v); setZoneId("") }} only={["food", "quickCommerce", "taxi"]} />
          <ZoneSelect vertical={vertical} value={zoneId} onChange={setZoneId} />
        </div>
      }
    >
      <p className="mb-3 text-xs text-neutral-500">
        Settings that each service used to keep on its own screen, now read through Master settings. A zone value beats the
        service’s, which beats the service’s own screen, which beats global — except the platform fee, where a global value
        wins as it always has. Until the migration copies a service’s own value across, it shows as “Service’s own screen”.
      </p>
      {rows === null ? (
        <div className="flex items-center gap-2 py-6 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-neutral-500">Nothing to show for this service.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="pb-2 pr-3 font-medium">Setting</th>
                <th className="pb-2 pr-3 font-medium">Service</th>
                <th className="pb-2 pr-3 font-medium">In effect</th>
                <th className="pb-2 pr-3 font-medium">Comes from</th>
                <th className="pb-2 pr-3 font-medium">Service’s own screen</th>
                <th className="pb-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={`${row.key}:${row.vertical}`} row={row} zoneId={zoneId} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
