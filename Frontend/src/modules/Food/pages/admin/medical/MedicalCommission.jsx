import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Percent, Search, IndianRupee } from "lucide-react"
import { adminAPI } from "@food/api"

/**
 * Commission for medical shops: one default every pharmacy pays, and a shop's
 * own rate where one is set. Changes apply to orders placed after saving; an
 * order keeps the commission it was priced with.
 */

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
const btnCls =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"

const rateText = (rate) =>
  rate?.type === "amount" ? `₹${Number(rate.value || 0).toLocaleString("en-IN")} per order` : `${Number(rate?.value || 0)}%`

function RateInput({ rate, onChange }) {
  return (
    <div className="flex gap-2">
      <div className="inline-flex shrink-0 rounded-lg border border-slate-300 p-0.5">
        {[
          { type: "percentage", icon: Percent, label: "Percent" },
          { type: "amount", icon: IndianRupee, label: "Flat ₹" },
        ].map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => onChange({ ...rate, type })}
            className={`rounded-md px-2.5 py-1.5 ${rate.type === type ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <input
        type="number"
        min="0"
        max={rate.type === "percentage" ? 100 : undefined}
        step="0.01"
        className={`${inputCls} tabular-nums`}
        value={rate.value}
        onChange={(e) => onChange({ ...rate, value: e.target.value })}
      />
    </div>
  )
}

function ShopRow({ shop, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [rate, setRate] = useState(shop.rate)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await adminAPI.setMedicalShopCommission(shop.id, { type: rate.type, value: Number(rate.value) })
      toast.success(`${shop.name} now pays ${rateText(rate)}`)
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    setBusy(true)
    try {
      await adminAPI.clearMedicalShopCommission(shop.id)
      toast.success(`${shop.name} is back on the default rate`)
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(errText(err, "Could not reset"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-t border-slate-100 align-middle">
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900">{shop.name || "Unnamed pharmacy"}</p>
        <p className="text-xs text-slate-500">
          {shop.zone || "No zone"} · <span className="capitalize">{shop.status}</span>
        </p>
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <div className="w-60"><RateInput rate={rate} onChange={setRate} /></div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums text-slate-900">{rateText(shop.rate)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${shop.source === "own" ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-500"}`}>
              {shop.source === "own" ? "Own rate" : "Default"}
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {editing ? (
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" onClick={() => { setRate(shop.rate); setEditing(false) }}>Cancel</button>
            <button type="button" className={btnCls} disabled={busy || rate.value === ""} onClick={save}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            {shop.source === "own" && (
              <button type="button" disabled={busy} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" onClick={reset}>Use default</button>
            )}
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setEditing(true)}>
              Set own rate
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

export default function MedicalCommission() {
  const [data, setData] = useState(null)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [def, setDef] = useState({ type: "percentage", value: "" })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await adminAPI.getMedicalCommissions({ status: status || undefined })
      const d = res?.data?.data
      setData(d)
      setDef({ type: d?.default?.type || "percentage", value: String(d?.default?.value ?? 0) })
    } catch (err) {
      toast.error(errText(err, "Could not load commission"))
    }
  }, [status])
  useEffect(() => { load() }, [load])

  const shops = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.shops || []).filter((s) => !q || s.name.toLowerCase().includes(q) || s.zone.toLowerCase().includes(q))
  }, [data, search])
  const ownCount = (data?.shops || []).filter((s) => s.source === "own").length
  const defDirty = data && (def.type !== data.default.type || Number(def.value) !== Number(data.default.value))

  const saveDefault = async () => {
    setBusy(true)
    try {
      await adminAPI.setMedicalDefaultCommission({ type: def.type, value: Number(def.value) })
      toast.success(`Default commission is now ${rateText(def)}`)
      load()
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-100 p-4 lg:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Pharmacy commission</h1>
          <p className="mt-1 text-sm text-slate-600">What the platform keeps from each medical order. Changes apply to new orders only.</p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_320px] md:items-end">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Default rate</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Every pharmacy pays this unless it has its own rate.{" "}
                {data && <>Now {data.shops.length - ownCount} of {data.shops.length} pharmacies are on it.</>}
              </p>
            </div>
            <div className="flex gap-2">
              <div className="flex-1"><RateInput rate={def} onChange={setDef} /></div>
              <button type="button" className={btnCls} disabled={!defDirty || busy || def.value === ""} onClick={saveDefault}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-9`} placeholder="Search pharmacy or zone" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All pharmacies</option>
              <option value="approved">Approved</option>
              <option value="pending">Waiting for review</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            {!data ? (
              <div className="flex items-center gap-2 p-8 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading pharmacies</div>
            ) : shops.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No pharmacies match.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-2 font-semibold">Pharmacy</th>
                    <th className="px-4 py-2 font-semibold">Commission</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop) => <ShopRow key={`${shop.id}:${shop.source}:${shop.rate.type}:${shop.rate.value}`} shop={shop} onSaved={load} />)}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
