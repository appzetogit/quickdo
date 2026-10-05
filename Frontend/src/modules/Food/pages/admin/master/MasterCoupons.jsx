import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Loader2, Search, Ticket, Plus, RefreshCw } from "lucide-react"
import { couponListAPI } from "@food/api"

/**
 * Master > Coupons: every coupon on the platform in one list.
 *
 * Coupons stay in their own service (core/promotions/couponList.service.js).
 * Pause and resume work here for all of them; creating and editing open the
 * service's own screen, because each service's form asks for different things.
 */

const STATES = [
  { key: "live", label: "Live", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  { key: "scheduled", label: "Scheduled", tone: "bg-sky-50 text-sky-800 ring-sky-200" },
  { key: "paused", label: "Paused", tone: "bg-amber-50 text-amber-800 ring-amber-200" },
  { key: "used_up", label: "Used up", tone: "bg-neutral-100 text-neutral-700 ring-neutral-200" },
  { key: "expired", label: "Expired", tone: "bg-neutral-100 text-neutral-500 ring-neutral-200" },
]
const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]))

const CREATE_LINKS = [
  { label: "Food coupon", path: "/admin/food/coupons" },
  { label: "Quick & Medical coupon", path: "/admin/quick-commerce/coupons" },
  { label: "Taxi promo code", path: "/taxi/admin/promotions/promo-codes" },
]
const EDIT_PATH = {
  food: "/admin/food/coupons",
  quick: "/admin/quick-commerce/coupons",
  taxi: "/taxi/admin/promotions/promo-codes",
}

const errorText = (err, fallback) => err?.response?.data?.message || fallback
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`
const day = (v) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "")

function StatePill({ state }) {
  const s = STATE[state] || { label: state, tone: "bg-neutral-100 text-neutral-700 ring-neutral-200" }
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.tone}`}>{s.label}</span>
}

function validity(r) {
  if (r.startDate && r.endDate) return `${day(r.startDate)} – ${day(r.endDate)}`
  if (r.endDate) return `Until ${day(r.endDate)}`
  if (r.startDate) return `From ${day(r.startDate)}`
  return "No end date"
}

export default function MasterCoupons() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState(null)
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [state, setState] = useState("live")
  const [source, setSource] = useState("")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState("")
  const limit = 50

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const res = await couponListAPI.list({ state, source, q: query, page, limit })
      const data = res?.data?.data || {}
      setRows(data.items || [])
      setTotal(data.total || 0)
      setCounts(data.counts || null)
      setSources(data.sources || [])
    } catch (err) {
      setLoadError(errorText(err, "Could not load coupons."))
    } finally {
      setLoading(false)
    }
  }, [state, source, query, page])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (r) => {
    const live = r.state === "paused"
    setBusy(r.key)
    try {
      await couponListAPI.setLive(r.source, r.id, live)
      toast.success(live ? `${r.code} is live again` : `${r.code} paused`)
      await load()
    } catch (err) {
      toast.error(errorText(err, "Could not change this coupon."))
    } finally {
      setBusy("")
    }
  }

  const allCount = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null
  const tabs = [...STATES.map((s) => ({ key: s.key, label: s.label, count: counts?.[s.key] })), { key: "", label: "All", count: allCount }]
  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Coupons</h1>
            <p className="mt-1 text-sm text-neutral-600">Every coupon and promo code in Food, Quick &amp; Medical and Taxi.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <details className="relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white hover:bg-neutral-800 [&::-webkit-details-marker]:hidden">
                <Plus className="h-4 w-4" />
                New coupon
              </summary>
              <ul className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                {CREATE_LINKS.map((l) => (
                  <li key={l.path}>
                    <Link to={l.path} className="block px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {tabs.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              onClick={() => {
                setState(t.key)
                setPage(1)
              }}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${state === t.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${state === t.key ? "bg-white/20" : "bg-neutral-100 text-neutral-700"}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search coupons</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by code, restaurant, store or city"
              className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
          </label>
          <select
            aria-label="Filter by service"
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All services</option>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {loadError ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-red-700">{loadError}</p>
              <button type="button" onClick={load} className="mt-3 text-sm font-medium text-neutral-900 underline">Try again</button>
            </div>
          ) : loading && !rows.length ? (
            <div className="flex justify-center py-14"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Ticket className="mx-auto h-8 w-8 text-neutral-300" />
              <p className="mt-2 text-sm font-medium text-neutral-800">
                {query || source ? "No coupon matches these filters" : state ? `No ${STATE[state]?.label.toLowerCase()} coupons` : "No coupons yet"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Service</th>
                    <th className="px-4 py-3 font-medium">Applies to</th>
                    <th className="px-4 py-3 font-medium">Used</th>
                    <th className="px-4 py-3 font-medium">Valid</th>
                    <th className="px-4 py-3 font-medium">State</th>
                    <th className="px-4 py-3" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((r) => (
                    <tr key={r.key} className={r.state === "expired" ? "text-neutral-500" : ""}>
                      <td className="px-4 py-3">
                        <p className="font-mono text-sm font-semibold tracking-wide text-neutral-900">{r.code}</p>
                        <p className="text-xs text-neutral-600">{r.discount}{r.minOrder > 0 ? ` · min ${rupees(r.minOrder)}` : ""}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                        {r.sourceLabel}
                        {r.createdBy !== "admin" && <span className="block text-xs text-neutral-500">made by the {r.createdBy}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-neutral-900">{r.where}</p>
                        <p className="text-xs text-neutral-500">{r.audience}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                        <p className="text-neutral-900">{r.used}{r.limit !== null ? ` / ${r.limit}` : ""}</p>
                        <p className="text-xs text-neutral-500">{r.perUser !== null ? `${r.perUser} per customer` : "No limit per customer"}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{validity(r)}</td>
                      <td className="px-4 py-3"><StatePill state={r.state} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {r.state !== "expired" && (
                            <button
                              type="button"
                              disabled={busy === r.key}
                              onClick={() => toggle(r)}
                              className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                            >
                              {busy === r.key && <Loader2 className="h-3 w-3 animate-spin" />}
                              {r.state === "paused" ? "Resume" : "Pause"}
                            </button>
                          )}
                          <Link to={EDIT_PATH[r.source]} className="rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900">
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {total > limit && (
          <div className="flex items-center justify-between text-sm text-neutral-600">
            <span className="tabular-nums">{(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 disabled:opacity-50">Previous</button>
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 disabled:opacity-50">Next</button>
            </div>
          </div>
        )}

        <p className="text-xs text-neutral-500">
          Limits shown are the ones checkout enforces, including the platform limits in Master Settings → Promo Limits.
        </p>
      </div>
    </div>
  )
}
