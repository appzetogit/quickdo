import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react"
import { masterSubscriptionsAPI } from "@food/api/masterAnalytics"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"
import { Card, DataTable, Figure, count, errorText, ghostCls, inputCls, rupees, verticalMeta } from "./masterKit"

/**
 * Master > Subscriptions: every paid plan in one list -- Services worker and
 * vendor plans, Quick seller subscriptions and Taxi customer ride plans -- as
 * active, expiring or lapsed, with the subscription income the platform kept
 * (core/analytics/subscriptions.service.js). Plans are managed on each service's
 * own screen.
 */

const STATUS = [
  { key: "", label: "Any status" },
  { key: "active", label: "Active" },
  { key: "expiring", label: "Expiring soon" },
  { key: "lapsed", label: "Lapsed" },
]
const STATUS_CLS = {
  active: "bg-green-50 text-green-700",
  expiring: "bg-amber-50 text-amber-800",
  lapsed: "bg-neutral-100 text-neutral-600",
}
const MANAGE = [
  ...(SERVICE_PROVIDER_ENABLED ? [{ label: "Services plans", to: "/admin/sp/worker-plans" }] : []),
  { label: "Quick seller plans", to: "/admin/quick-commerce/stores/monetization-mode" },
  { label: "Taxi customer plans", to: "/taxi/admin/users/subscriptions" },
  { label: "Taxi driver plans", to: "/taxi/admin/drivers/subscription" },
]

const COLUMNS = [
  { key: "service", label: "Service" },
  { key: "holderType", label: "Who" },
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone" },
  { key: "plan", label: "Plan" },
  { key: "amount", label: "Price", type: "money" },
  { key: "expiresAt", label: "Ends", type: "date" },
  { key: "statusBadge", label: "Status" },
]

export default function MasterSubscriptions() {
  const [status, setStatus] = useState("")
  const [vertical, setVertical] = useState("all")
  const [search, setSearch] = useState("")
  const [term, setTerm] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])
  useEffect(() => { setPage(1) }, [status, vertical, term])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await masterSubscriptionsAPI.list({ status, vertical, search: term, page, limit: 25 })
      setData(res?.data?.data || null)
    } catch (err) {
      setData(null)
      setError(errorText(err, "Could not load subscriptions."))
    } finally {
      setLoading(false)
    }
  }, [status, vertical, term, page])

  useEffect(() => { load() }, [load])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const rows = (data?.rows || []).map((r) => ({
    ...r,
    service: verticalMeta(r.vertical).label,
    statusBadge: r.status,
  }))
  const allCounts = Object.values(data?.counts || {}).reduce(
    (a, c) => ({ active: a.active + c.active, expiring: a.expiring + c.expiring, lapsed: a.lapsed + c.lapsed }),
    { active: 0, expiring: 0, lapsed: 0 },
  )
  const income = data?.income || {}
  const incomeTotal = ["serviceProvider", "quickCommerce", "taxi"].reduce((a, k) => a + (income[k]?.platformIncome || 0), 0)

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Subscriptions</h1>
            <p className="mt-1 text-sm text-neutral-600">Paid plans across Services, Quick Commerce and Taxi.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {MANAGE.map((m) => <Link key={m.to} to={m.to} className={ghostCls}>{m.label}</Link>)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure label="Active" value={count(allCounts.active)} onClick={() => setStatus("active")} />
          <Figure label={`Expiring in ${data?.expiringDays || 7} days`} value={count(allCounts.expiring)} onClick={() => setStatus("expiring")} />
          <Figure label="Lapsed" value={count(allCounts.lapsed)} onClick={() => setStatus("lapsed")} />
          <Figure
            strong
            label="Subscription income, last 30 days"
            value={rupees(incomeTotal)}
            hint={["serviceProvider", "quickCommerce", "taxi"].filter((k) => income[k]).map((k) => `${verticalMeta(k).label} ${rupees(income[k].platformIncome)}`).join(" · ")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input className={`${inputCls} pl-9`} placeholder="Name, phone or plan" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select aria-label="Status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select aria-label="Service" className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value)}>
            <option value="all">All services</option>
            {(data?.verticals || []).map((v) => <option key={v} value={v}>{verticalMeta(v).label}</option>)}
          </select>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <Card title="Plans" action={loading ? <Loader2 className="h-4 w-4 animate-spin text-neutral-400" /> : null}>
          <DataTable
            columns={COLUMNS.map((c) => (c.key === "statusBadge" ? { ...c, type: "text" } : c))}
            rows={rows.map((r) => ({ ...r, statusBadge: r.status === "expiring" ? "Expiring" : r.status === "active" ? "Active" : "Lapsed" }))}
            empty={loading ? "Loading" : "No plans match."}
          />
          <div className="mt-3 flex items-center justify-between text-sm text-neutral-600">
            <span className="tabular-nums">{count(data?.total || 0)} plans</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-neutral-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-neutral-300 p-1.5 disabled:opacity-40" aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </Card>

        {data?.notes?.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
            {data.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
        <p className="text-xs text-neutral-500">
          Services: only the platform fee of each plan payment is income; the rest is recorded as the subscription remainder.
          Status colours: <span className={`rounded px-1 ${STATUS_CLS.active}`}>active</span> <span className={`rounded px-1 ${STATUS_CLS.expiring}`}>expiring</span> <span className={`rounded px-1 ${STATUS_CLS.lapsed}`}>lapsed</span>.
        </p>
      </div>
    </div>
  )
}
