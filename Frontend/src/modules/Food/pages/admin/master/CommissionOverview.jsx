import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, RefreshCw, ExternalLink, Search, AlertTriangle } from "lucide-react"
import { commissionOverviewAPI } from "@food/api"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"

/**
 * Master > Report Management > Commission Overview.
 *
 * What the platform takes from every partner, in one place
 * (core/finance/commissionOverview.service.js). Each seller's rate is the one
 * its next order would be charged, from the services' own rate functions --
 * schedules and the Medical default included -- beside what it actually paid
 * over the last 30 days. Read-only: each block links to where its rates are set.
 */

const SOURCE = {
  restaurant_default: { label: "Own rate", tone: "bg-neutral-100 text-neutral-700" },
  schedule_restaurant: { label: "Scheduled", tone: "bg-sky-50 text-sky-800" },
  schedule_platform: { label: "Scheduled (all)", tone: "bg-sky-50 text-sky-800" },
  medical_default: { label: "Medical default", tone: "bg-violet-50 text-violet-800" },
  plan: { label: "On a plan", tone: "bg-emerald-50 text-emerald-800" },
  none: { label: "No rate", tone: "bg-amber-50 text-amber-800" },
}

const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const rateText = (r) => (!r || !(r.value > 0) ? "—" : r.type === "amount" ? `${rupees(r.value)} per order` : `${r.value}%`)
const errorText = (err, fallback) => err?.response?.data?.message || fallback

function SourceBadge({ source, label }) {
  const s = SOURCE[source] || { label: source, tone: "bg-neutral-100 text-neutral-700" }
  return (
    <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${s.tone}`} title={label || undefined}>
      {s.label}
      {label ? ` · ${label}` : ""}
    </span>
  )
}

function EditLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
      {children}
      <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
    </Link>
  )
}

function SellerTable({ rows, q, showKind }) {
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q))
  if (!shown.length) return <p className="px-5 py-6 text-sm text-neutral-500">{rows.length ? "No seller matches the search." : "No sellers yet."}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wider text-neutral-500">
            <th className="px-5 py-2.5 font-medium">Seller</th>
            <th className="px-3 py-2.5 font-medium">Rate now</th>
            <th className="px-3 py-2.5 text-right font-medium">Orders (30 days)</th>
            <th className="px-3 py-2.5 text-right font-medium">Commission (30 days)</th>
            <th className="px-5 py-2.5 text-right font-medium">Effective</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {shown.map((r) => (
            <tr key={r.id} className={r.source === "none" ? "bg-amber-50/40" : ""}>
              <td className="px-5 py-2.5">
                <p className="font-medium text-neutral-900">{r.name}</p>
                {showKind && <p className="text-xs capitalize text-neutral-500">{r.kind}</p>}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-neutral-900">{rateText(r.rate)}</span>
                  <SourceBadge source={r.source} label={r.label} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{r.last30.orders}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{rupees(r.last30.commission)}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">{r.last30.effectivePct === null ? "—" : `${r.last30.effectivePct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Summary({ s }) {
  if (!s) return null
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-600">
      <span><span className="font-semibold tabular-nums text-neutral-900">{s.withRate}</span> of {s.sellers} pay a rate</span>
      {s.withoutRate > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-semibold tabular-nums">{s.withoutRate}</span> with no rate set
        </span>
      )}
      <span><span className="font-semibold tabular-nums text-neutral-900">{rupees(s.commissionLast30)}</span> collected in 30 days</span>
    </div>
  )
}

export default function CommissionOverview() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [q, setQ] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await commissionOverviewAPI.get()
      setData(res?.data?.data || null)
    } catch (err) {
      setError(errorText(err, "Could not load the commission overview."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const services = useMemo(
    () => (data?.services || []).filter((s) => s.key !== "services" || SERVICE_PROVIDER_ENABLED),
    [data],
  )
  const query = q.trim().toLowerCase()

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Commission overview</h1>
            <p className="mt-1 text-sm text-neutral-600">
              What the platform takes from every partner: the rate each seller&rsquo;s next order is charged, and what it actually paid.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search sellers</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sellers"
                className="w-48 rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              />
            </label>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-14 text-center">
            <p className="text-sm font-medium text-red-700">{error}</p>
            <button type="button" onClick={load} className="mt-3 text-sm font-medium text-neutral-900 underline">Try again</button>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>
        ) : (
          services.map((s) => (
            <section key={s.key} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
                <div className="min-w-0 space-y-1">
                  <h2 className="font-semibold text-neutral-900">{s.label}</h2>
                  {s.key === "food" && s.mode === "plan" && (
                    <p className="text-sm text-emerald-800">Restaurants are on a subscription plan, so no commission is charged.</p>
                  )}
                  {s.key === "quick" && (
                    <p className="text-sm text-neutral-600">
                      Pharmacies with no rate of their own pay the Medical default:{" "}
                      <span className="font-medium text-neutral-900">{s.medicalDefault?.value > 0 ? rateText(s.medicalDefault) : "not set"}</span>.
                    </p>
                  )}
                  {s.key === "taxi" && <p className="text-sm text-neutral-600">Taken from the driver&rsquo;s fare, set on each vehicle and city price row.</p>}
                  <Summary s={s.summary} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.key === "quick" && <EditLink to="/admin/medical/commission">Medical default</EditLink>}
                  <EditLink to={s.editPath}>Change rates</EditLink>
                </div>
              </div>

              {s.key === "food" && <SellerTable rows={s.rows} q={query} />}
              {s.key === "quick" && <SellerTable rows={s.rows} q={query} showKind />}

              {s.key === "taxi" &&
                (s.rows.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead>
                        <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wider text-neutral-500">
                          <th className="px-5 py-2.5 font-medium">Vehicle</th>
                          <th className="px-3 py-2.5 font-medium">City</th>
                          <th className="px-3 py-2.5 font-medium">Commission</th>
                          <th className="px-5 py-2.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {s.rows.map((r) => (
                          <tr key={r.id} className={r.rate.value > 0 ? "" : "bg-amber-50/40"}>
                            <td className="px-5 py-2.5 font-medium text-neutral-900">
                              {r.vehicle}
                              {r.transport && r.transport !== "taxi" && <span className="ml-1 text-xs font-normal text-neutral-500">· {r.transport}</span>}
                            </td>
                            <td className="px-3 py-2.5 text-neutral-700">{r.where}</td>
                            <td className="px-3 py-2.5 tabular-nums text-neutral-900">
                              {r.rate.value > 0 ? (r.rate.type === "amount" ? `${rupees(r.rate.value)} per ride` : `${r.rate.value}% of the fare`) : "None — the driver keeps the whole fare"}
                            </td>
                            <td className="px-5 py-2.5 text-neutral-600">{r.active ? "Active" : "Off"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-5 py-6 text-sm text-neutral-500">No price rows yet.</p>
                ))}

              {s.key === "services" && (
                <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-neutral-500">Platform&rsquo;s share of service charges</dt>
                    <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{s.platformShare.service}%</dd>
                    <dd className="text-xs text-neutral-500">Vendor keeps {s.vendorShare.service}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-neutral-500">Platform&rsquo;s share of parts</dt>
                    <dd className="text-2xl font-semibold tabular-nums text-neutral-900">{s.platformShare.parts}%</dd>
                    <dd className="text-xs text-neutral-500">Vendor keeps {s.vendorShare.parts}%</dd>
                  </div>
                  <p className="text-xs text-neutral-500 sm:col-span-2">
                    {s.fromSettings ? "From Services settings." : "Services settings have no values, so these are the built-in defaults."} A booking taken directly by a worker pays the worker in full.
                  </p>
                </dl>
              )}
            </section>
          ))
        )}

        <p className="text-xs text-neutral-500">
          &ldquo;Effective&rdquo; is commission paid divided by the food or goods value of delivered orders in the last 30 days. It differs from the rate when a schedule ran, a rate changed, or a flat per-order rate applies.
        </p>
      </div>
    </div>
  )
}
