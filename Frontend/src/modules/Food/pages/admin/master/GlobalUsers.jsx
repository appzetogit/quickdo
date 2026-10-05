import { useState, useEffect, useCallback, useRef } from "react"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Search, Download, Users, ChevronLeft, ChevronRight } from "lucide-react"

/**
 * Master > Customers: every customer on the platform, in one list.
 *
 * Food and taxi customers are already the same documents in one `users`
 * collection; quick commerce and services keep their own, matched in by link or
 * by phone. So this screen replaces four per-vertical customer lists that could
 * each only see their own slice of the same person.
 *
 * One write: Block / Unblock, which the server applies to every app with plain
 * flag updates (core/users/globalUsers.service.js setCustomerBlocked). Editing
 * stays on the screens whose schema owns those fields -- two schemas share the
 * collection and a full-document write from here could drop the other's fields.
 */

const PAGE_SIZE = 25

const STATUSES = [
  { id: "", label: "Everyone" },
  { id: "active", label: "Active" },
  { id: "blocked", label: "Blocked" },
  { id: "verified", label: "Verified" },
  { id: "unverified", label: "Unverified" },
]

const APP_STYLES = {
  food: "bg-orange-50 text-orange-700 border-orange-200",
  taxi: "bg-blue-50 text-blue-700 border-blue-200",
  quick: "bg-emerald-50 text-emerald-700 border-emerald-200",
  services: "bg-purple-50 text-purple-700 border-purple-200",
}

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`
const onDay = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—")

function AppTags({ apps }) {
  if (!apps?.length) return <span className="text-xs text-neutral-400">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {apps.map((a) => (
        <span key={a} className={`rounded border px-1.5 py-0.5 text-[11px] font-medium capitalize ${APP_STYLES[a] || "bg-neutral-100 text-neutral-600 border-neutral-200"}`}>
          {a}
        </span>
      ))}
    </div>
  )
}

export default function GlobalUsers() {
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [blockingId, setBlockingId] = useState(null)

  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [page, setPage] = useState(1)

  // What the server is actually filtered by, so the export cannot send a
  // half-typed search the operator never saw results for.
  const [applied, setApplied] = useState({ search: "", status: "", from: "", to: "" })
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { ...applied, page, limit: PAGE_SIZE }
      const res = await platformSettingsAPI.getGlobalUsers(params)
      const data = res?.data?.data
      setRows(data?.users || [])
      setPagination(data?.pagination || { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(errText(err, "Could not load customers"))
    } finally {
      setLoading(false)
      firstLoad.current = false
    }
  }, [applied, page])

  useEffect(() => {
    load()
  }, [load])

  const toggleBlocked = async (u) => {
    const block = u.isActive
    if (block && !window.confirm(`Block ${u.name || u.phone}? They will be signed out of every Quick Drop app.`)) return
    setBlockingId(u.id)
    try {
      await platformSettingsAPI.setGlobalUserBlocked(u.id, block)
      setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, isActive: !block } : r)))
      toast.success(block ? "Customer blocked in every app" : "Customer unblocked")
    } catch (err) {
      toast.error(errText(err, block ? "Could not block this customer" : "Could not unblock this customer"))
    } finally {
      setBlockingId(null)
    }
  }

  // Typing settles before the server is asked, so each keystroke is not a query
  // against every customer on the platform.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setApplied({ search, status, from, to })
    }, firstLoad.current ? 0 : 350)
    return () => clearTimeout(t)
  }, [search, status, from, to])

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await platformSettingsAPI.exportGlobalUsers(applied)
      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success("Export downloaded")
    } catch (err) {
      toast.error(errText(err, "Could not export customers"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Customers</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Everyone who uses Food, Quick Commerce, Medical, Taxi or Services — one person, one row.
            </p>
          </div>
          <button type="button" className={btnCls} onClick={exportCsv} disabled={exporting || loading}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </button>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block lg:col-span-2">
              <span className="text-xs font-medium text-neutral-600">Search</span>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  className={`${inputCls} pl-9`}
                  placeholder="Name, phone or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Status</span>
              <select className={`${inputCls} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">Joined from</span>
                <input type="date" className={`${inputCls} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">to</span>
                <input type="date" className={`${inputCls} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
            <Users className="h-4 w-4 text-neutral-400" />
            <p className="text-sm text-neutral-600">
              {loading ? "Loading…" : `${pagination.total.toLocaleString("en-IN")} customers`}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-5 py-12 text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading customers
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-neutral-500">No customers match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="px-5 py-2">Customer</th>
                    <th className="px-3 py-2">Apps used</th>
                    <th className="px-3 py-2 text-right">Orders</th>
                    <th className="px-3 py-2 text-right">Spend</th>
                    <th className="px-3 py-2 text-right">Rides</th>
                    <th className="px-3 py-2 text-right">Wallet</th>
                    <th className="px-3 py-2">Joined</th>
                    <th className="px-5 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-neutral-900">{u.name || "Unnamed"}</p>
                        <p className="text-xs text-neutral-500">{u.phone}</p>
                        {u.email && <p className="text-xs text-neutral-400">{u.email}</p>}
                        {u.city && <p className="text-xs text-neutral-400">{u.city}</p>}
                      </td>
                      <td className="px-3 py-3"><AppTags apps={u.apps} /></td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {u.orders}
                        {u.orders > 0 && (
                          <p className="text-[11px] text-neutral-400">
                            {u.foodOrders} food · {u.quickOrders} quick
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{rupees(u.orderValue)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{u.rides}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{rupees(u.walletBalance)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-neutral-600">{onDay(u.joinedAt)}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${u.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                          {u.isActive ? "Active" : "Blocked"}
                        </span>
                        {!u.isVerified && <p className="mt-0.5 text-[11px] text-amber-600">Unverified</p>}
                        <button
                          type="button"
                          disabled={blockingId === u.id}
                          onClick={() => toggleBlocked(u)}
                          className={`mt-1 block text-xs font-medium underline-offset-2 hover:underline disabled:opacity-50 ${u.isActive ? "text-red-700" : "text-emerald-700"}`}
                        >
                          {blockingId === u.id ? "Saving…" : u.isActive ? "Block" : "Unblock"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination.pages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
              <p className="text-xs text-neutral-500">Page {pagination.page} of {pagination.pages}</p>
              <div className="flex gap-2">
                <button type="button" className={ghostCls} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button type="button" className={ghostCls} disabled={page >= pagination.pages || loading} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </section>

        <p className="px-1 text-xs text-neutral-500">
          Orders counts Food, and Quick Commerce with Medical, from their own order records; the
          small figures under each total show the split. Blocking here blocks the customer in every app.
        </p>
      </div>
    </div>
  )
}
