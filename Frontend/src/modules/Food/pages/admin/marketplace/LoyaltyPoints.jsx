import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Award, Loader2 } from "lucide-react"
import { Switch } from "@food/components/ui/switch"
import { loyaltyAdminAPI } from "@/services/api/marketplace"

/**
 * Master > Loyalty Points (plan §5.7): the earn and redeem rules, for every
 * service or one service, and the latest ledger movements.
 *
 * Off until switched on here. Points are earned on delivered orders and
 * redeemed at checkout; they belong to the customer's one account, so points
 * from Quick can be spent on Food.
 */

const SCOPES = [
  { value: "", label: "All services (default)" },
  { value: "quickCommerce", label: "Quick" },
  { value: "food", label: "Food" },
]
const FIELDS = [
  { key: "pointsPerRupee", label: "Points earned per Rs 1 spent", min: 0, max: 10, step: 0.01, hint: "0.1 = 1 point for every Rs 10 of items." },
  { key: "rupeesPerPoint", label: "Rs one point is worth at checkout", min: 0, max: 100, step: 0.01 },
  { key: "maxRedeemPercent", label: "Most of an order points may pay (%)", min: 0, max: 100, step: 1, hint: "Of the item value. 0 stops redeeming but not earning." },
  { key: "expiryDays", label: "Days before earned points expire", min: 0, max: 3650, step: 1, hint: "0 means never." },
]
const TYPE_LABEL = { earn: "Earned", burn: "Redeemed", reverse_burn: "Returned", expire: "Expired", adjust: "Adjusted" }
const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

export default function LoyaltyPoints() {
  const [scope, setScope] = useState("")
  const [values, setValues] = useState(null)
  const [saving, setSaving] = useState(false)
  const [ledger, setLedger] = useState({ rows: [], total: 0 })

  const load = useCallback(async () => {
    setValues(null)
    try {
      const [s, l] = await Promise.all([loyaltyAdminAPI.getSettings(scope || undefined), loyaltyAdminAPI.ledger({ limit: 30 })])
      setValues(s?.data?.data || {})
      setLedger(l?.data?.data || { rows: [], total: 0 })
    } catch (err) {
      toast.error(errText(err, "Could not load loyalty rules"))
      setValues({})
    }
  }, [scope])

  useEffect(() => { load() }, [load])

  const save = async () => {
    for (const f of FIELDS) {
      const n = Number(values[f.key])
      if (!Number.isFinite(n) || n < f.min || n > f.max) {
        toast.error(`${f.label}: enter ${f.min} to ${f.max}`)
        return
      }
    }
    setSaving(true)
    try {
      await loyaltyAdminAPI.saveSettings({
        ...(scope ? { vertical: scope } : {}),
        enabled: values.enabled === true,
        ...Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])])),
      })
      toast.success("Loyalty rules saved")
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save loyalty rules"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 lg:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900">
            <Award className="h-5 w-5" /> Loyalty points
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            Customers earn points on delivered orders and spend them at checkout. A service&apos;s own rules override the default.
          </p>
        </div>

        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
          <label className="block max-w-xs text-sm">
            <span className="text-neutral-700">Rules for</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>

          {!values ? (
            <div className="flex items-center gap-2 py-6 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
          ) : (
            <>
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block text-sm font-medium text-neutral-900">Loyalty points on</span>
                  <span className="block text-xs text-neutral-500">Off: nothing is earned or redeemed.</span>
                </span>
                <Switch checked={values.enabled === true} onCheckedChange={(on) => setValues((v) => ({ ...v, enabled: on }))} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-sm text-neutral-800">{f.label}</span>
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                    />
                    {f.hint && <span className="mt-1 block text-xs text-neutral-500">{f.hint}</span>}
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
                </button>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium text-neutral-800">Latest movements ({ledger.total})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Points</th><th className="px-4 py-2">Order</th><th className="px-4 py-2">Expires</th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {(ledger.rows || []).map((r) => (
                  <tr key={r._id}>
                    <td className="px-4 py-2 text-neutral-600">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 font-mono text-xs">{String(r.userId).slice(-8)}</td>
                    <td className="px-4 py-2">{TYPE_LABEL[r.type] || r.type}</td>
                    <td className={`px-4 py-2 ${r.type === "burn" || r.type === "expire" ? "text-red-600" : "text-emerald-700"}`}>
                      {r.type === "burn" || r.type === "expire" ? "-" : "+"}{r.points}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{r.orderRef || "-"}</td>
                    <td className="px-4 py-2 text-neutral-600">{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "-"}</td>
                  </tr>
                ))}
                {!ledger.rows?.length && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No points have moved yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
