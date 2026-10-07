import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react"
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { masterDashboardAPI } from "@food/api/masterAnalytics"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"
import {
  Card, Figure, RangeBar, VerticalSelect, count, errorText, ghostCls, niceDay, rupees, useRange, verticalMeta,
} from "./masterKit"

/**
 * Master > Dashboard: the admin home. Food, Quick Commerce, Taxi and Services
 * side by side -- customers, partners, orders today and over a period, revenue,
 * commission and subscription income (core/admin/dashboard.service.js).
 *
 * The server sends only the services this admin may see, so a taxi-only
 * sub-admin's dashboard is taxi's.
 */

const PANEL_LINKS = [
  { key: "food", label: "Food admin", to: "/admin/food" },
  { key: "quickCommerce", label: "Quick Commerce admin", to: "/admin/quick-commerce" },
  { key: "taxi", label: "Taxi admin", to: "/taxi/admin/dashboard" },
  ...(SERVICE_PROVIDER_ENABLED ? [{ key: "serviceProvider", label: "Services admin", to: "/admin/sp/dashboard" }] : []),
]

function ServiceCard({ s }) {
  const meta = verticalMeta(s.key)
  const p = s.period
  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
          <h2 className="text-sm font-semibold text-neutral-900">{s.label}</h2>
        </div>
        <Link to={s.link} className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900">
          Open admin <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm sm:grid-cols-3">
        <Stat label={`${s.unit} today`} value={count(s.today.orders)} hint={`${count(s.today.completed)} done · ${rupees(s.today.revenue)}`} />
        <Stat label={`${s.unit} in period`} value={count(p.orders)} hint={`${count(p.completed)} done · ${p.cancelRate}% cancelled`} />
        <Stat label="Revenue" value={rupees(p.revenue)} hint={`Avg ${rupees(p.averageOrderValue)}`} />
        <Stat label="Commission" value={rupees(p.commission)} hint={p.platformFee ? `+ ${rupees(p.platformFee)} platform fee` : null} />
        <Stat
          label="Subscriptions"
          value={s.subscriptions ? rupees(s.subscriptions.platformIncome) : "-"}
          hint={s.subscriptions && s.subscriptions.collected !== s.subscriptions.platformIncome ? `${rupees(s.subscriptions.collected)} collected` : null}
        />
        <Stat
          label="Customers"
          value={count(s.customers.registered)}
          hint={`${count(s.customers.active)} ordered · ${count(s.customers.joined)} new`}
        />
      </div>
      <div className="border-t border-neutral-100 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {s.partners.map((x) => (
            <div key={x.key} className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              <span className="font-semibold text-neutral-900">{count(x.approved)}</span> {x.label.toLowerCase()}
              {x.online !== null && x.online !== undefined && <span> · {count(x.online)} online</span>}
              {x.pending > 0 && <span className="text-amber-700"> · {count(x.pending)} pending</span>}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <p className="text-xs capitalize text-neutral-500">{label}</p>
      <p className="font-semibold tabular-nums text-neutral-900">{value}</p>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

export default function MasterDashboard() {
  const range = useRange("30")
  const [vertical, setVertical] = useState("all")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    setError("")
    try {
      const res = await masterDashboardAPI.get({ ...range.range, vertical, ...(fresh ? { fresh: 1 } : {}) })
      setData(res?.data?.data || null)
    } catch (err) {
      setError(errorText(err, "Could not load the dashboard."))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [range.range, vertical])

  useEffect(() => { load() }, [load])

  const services = data?.services || []
  const t = data?.totals
  const chart = (data?.daily || []).map((d) => ({ ...d, label: niceDay(d.date), ...d.byService }))
  const visibleLinks = PANEL_LINKS.filter((l) => !data || data.verticals.includes(l.key))

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Dashboard</h1>
            <p className="mt-1 text-sm text-neutral-600">Every service at a glance. Revenue is what customers paid on completed orders, rides and bookings.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleLinks.map((l) => (
              <Link key={l.key} to={l.to} className={ghostCls}>
                {l.label} <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RangeBar state={range} />
          <VerticalSelect value={vertical} onChange={setVertical} />
          <button type="button" className={ghostCls} onClick={() => load(true)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {!data && loading ? (
          <div className="flex items-center gap-2 py-16 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : t ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Figure label="Orders today" value={count(t.today.orders)} hint={`${count(t.today.completed)} completed · ${rupees(t.today.revenue)}`} />
              <Figure label="Orders in period" value={count(t.orders)} hint={`${count(t.completed)} completed · ${count(t.cancelled)} cancelled`} />
              <Figure label="Revenue" value={rupees(t.revenue)} hint="Customer paid, completed work" />
              <Figure
                strong
                label="Platform earnings"
                value={rupees(t.platformEarnings)}
                hint={`${rupees(t.commission)} commission · ${rupees(t.platformFee)} fees · ${rupees(t.subscriptionIncome)} subscriptions`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Orders per day">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
                      <YAxis fontSize={11} allowDecimals={false} width={40} />
                      <Tooltip />
                      <Legend />
                      {services.map((s) => (
                        <Bar key={s.key} dataKey={s.key} name={s.label} stackId="o" fill={verticalMeta(s.key).color} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Revenue per day">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
                      <YAxis fontSize={11} width={60} tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} />
                      <Tooltip formatter={(v) => rupees(v)} />
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#171717" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            {data.pendingApprovals?.length > 0 && (
              <Card title="Waiting for approval">
                <div className="flex flex-wrap gap-2">
                  {data.pendingApprovals.map((p) => (
                    <span key={p.label} className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
                      {p.label}: <span className="font-semibold">{count(p.count)}</span>
                    </span>
                  ))}
                </div>
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {services.map((s) => <ServiceCard key={s.key} s={s} />)}
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <Link to="/admin/master/reports/sales" className={ghostCls}>Reports</Link>
              <Link to="/admin/master/tax" className={ghostCls}>GST report</Link>
              <Link to="/admin/master/insights" className={ghostCls}>Insights</Link>
              <Link to="/admin/master/subscriptions" className={ghostCls}>Subscriptions</Link>
              <Link to="/admin/master/orders" className={ghostCls}>All orders</Link>
            </div>
            <p className="text-xs text-neutral-500">Figures refresh every minute. Food and Taxi share one customer list.</p>
          </>
        ) : null}
      </div>
    </div>
  )
}
