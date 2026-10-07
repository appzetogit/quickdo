import { useEffect, useState } from "react"
import { masterZonesAPI } from "@food/api/masterAnalytics"

/**
 * Small shared pieces for the Master cross-vertical pages (dashboard, reports,
 * GST, subscriptions, insights): date range presets, service and zone pickers,
 * figure cards and a table that formats by column type.
 */

const IST_OFFSET = 5.5 * 3600 * 1000
export const todayIst = () => new Date(Date.now() + IST_OFFSET).toISOString().slice(0, 10)
export const shiftDay = (day, days) => {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const monthStart = (day) => `${day.slice(0, 8)}01`

export const PRESETS = [
  { key: "7", label: "7 days", range: () => ({ from: shiftDay(todayIst(), -6), to: todayIst() }) },
  { key: "30", label: "30 days", range: () => ({ from: shiftDay(todayIst(), -29), to: todayIst() }) },
  { key: "90", label: "90 days", range: () => ({ from: shiftDay(todayIst(), -89), to: todayIst() }) },
  { key: "month", label: "This month", range: () => ({ from: monthStart(todayIst()), to: todayIst() }) },
  {
    key: "lastMonth",
    label: "Last month",
    range: () => {
      const end = shiftDay(monthStart(todayIst()), -1)
      return { from: monthStart(end), to: end }
    },
  },
]

export const VERTICALS = [
  { key: "food", label: "Food", color: "#f97316", zoneModule: "food" },
  { key: "quickCommerce", label: "Quick Commerce", color: "#059669", zoneModule: "quickCommerce" },
  { key: "taxi", label: "Taxi", color: "#eab308", zoneModule: "taxi" },
  { key: "serviceProvider", label: "Services", color: "#0284c7", zoneModule: null },
]
export const verticalMeta = (key) => VERTICALS.find((v) => v.key === key) || { key, label: key, color: "#525252" }

export const rupees = (n) => {
  const v = Number(n || 0)
  const s = `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
  return v < 0 ? `−${s}` : s
}
export const count = (n) => Number(n || 0).toLocaleString("en-IN")
export const niceDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "")
export const errorText = (err, fallback) => err?.response?.data?.message || fallback

export const inputCls =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
export const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-300"
export const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

export function useRange(initial = "30") {
  const [preset, setPreset] = useState(initial)
  const [range, setRange] = useState(() => (PRESETS.find((p) => p.key === initial) || PRESETS[1]).range())
  const pick = (key) => {
    const p = PRESETS.find((x) => x.key === key)
    setPreset(key)
    if (p) setRange(p.range())
  }
  const setCustom = (patch) => {
    setPreset("custom")
    setRange((r) => ({ ...r, ...patch }))
  }
  return { preset, range, pick, setCustom }
}

export function RangeBar({ state, presets = PRESETS }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-white p-1">
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => state.pick(p.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${state.preset === p.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input type="date" aria-label="From" className={inputCls} value={state.range.from} max={state.range.to} onChange={(e) => state.setCustom({ from: e.target.value })} />
      <span className="text-sm text-neutral-500">to</span>
      <input type="date" aria-label="To" className={inputCls} value={state.range.to} min={state.range.from} max={todayIst()} onChange={(e) => state.setCustom({ to: e.target.value })} />
    </div>
  )
}

export function VerticalSelect({ value, onChange, allowAll = true, only }) {
  const list = only ? VERTICALS.filter((v) => only.includes(v.key)) : VERTICALS
  return (
    <select aria-label="Service" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowAll && <option value="all">All services</option>}
      {list.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
    </select>
  )
}

/** Zones of one service; Services has cities, typed instead. Empty = all zones. */
export function ZoneSelect({ vertical, value, onChange }) {
  const meta = verticalMeta(vertical)
  const [zones, setZones] = useState([])
  useEffect(() => {
    let alive = true
    setZones([])
    if (!meta.zoneModule) return undefined
    masterZonesAPI.list(meta.zoneModule)
      .then((res) => { if (alive) setZones(res?.data?.data?.zones || []) })
      .catch(() => {})
    return () => { alive = false }
  }, [meta.zoneModule])
  if (!vertical || vertical === "all") {
    return <select aria-label="Zone" className={inputCls} disabled><option>All zones (pick a service)</option></select>
  }
  if (!meta.zoneModule) {
    return <input aria-label="City" className={inputCls} placeholder="City (all)" value={value} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <select aria-label="Zone" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All zones</option>
      {zones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.active === false ? " (off)" : ""}</option>)}
    </select>
  )
}

export function Figure({ label, value, hint, strong, onClick }) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left ${strong ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white"} ${onClick ? "hover:border-neutral-400" : ""}`}
    >
      <p className={`text-xs font-medium ${strong ? "text-neutral-300" : "text-neutral-500"}`}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className={`mt-0.5 text-xs ${strong ? "text-neutral-400" : "text-neutral-500"}`}>{hint}</p>}
    </Tag>
  )
}

export function Card({ title, action, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export const formatCell = (value, type) => {
  if (value === null || value === undefined || value === "") return <span className="text-neutral-400">-</span>
  if (type === "money") return rupees(value)
  if (type === "number") return count(value)
  if (type === "percent") return `${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`
  if (type === "date") {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
  }
  return String(value)
}

export function DataTable({ columns = [], rows = [], empty = "Nothing in this range.", maxRows = 500 }) {
  const shown = rows.slice(0, maxRows)
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-3 py-2 ${["money", "number", "percent"].includes(c.type) ? "text-right" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {shown.length === 0 ? (
            <tr><td colSpan={Math.max(1, columns.length)} className="px-3 py-10 text-center text-neutral-500">{empty}</td></tr>
          ) : shown.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-3 py-2 ${["money", "number", "percent"].includes(c.type) ? "text-right tabular-nums" : ""}`}>
                  {formatCell(r[c.key], c.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && <p className="px-3 py-2 text-xs text-neutral-500">Showing {maxRows} of {rows.length}. Export for the full list.</p>}
    </div>
  )
}
