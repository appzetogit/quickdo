import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import {
  Bike, ChevronLeft, ChevronRight, Layers, Loader2, RefreshCw, Search, ShoppingBasket, Trash2, UtensilsCrossed,
} from "lucide-react"
import { platformSettingsAPI } from "@food/api"
import AssignRiderButton from "@food/components/admin/orders/manual-assign/AssignRiderButton"
import ManualAssignStatus from "@food/components/admin/orders/manual-assign/ManualAssignStatus"
import { canAssignRider, isManualPending } from "@food/components/admin/orders/manual-assign/manualAssignUtils"

/**
 * Master > Orders: every order on the platform in one list, a tab per service.
 *
 * Food and Quick Commerce orders can be handed to a rider from here
 * (the same assign window as each service's own order screen; the call goes to
 * that service's admin API). Taxi trips are dispatched by the ride
 * engine and are listed read-only.
 */

const TABS = [
  { key: "all", label: "All orders", icon: Layers },
  { key: "food", label: "Food", icon: UtensilsCrossed },
  { key: "quick", label: "Quick Commerce", icon: ShoppingBasket },
  { key: "taxi", label: "Taxi", icon: Bike },
]

const SOURCE_STYLE = {
  food: { label: "Food", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  quick: { label: "Quick", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  taxi: { label: "Taxi", cls: "bg-blue-50 text-blue-700 border-blue-200" },
}

const STATUSES = [
  { id: "", label: "Any status" },
  { id: "active", label: "In progress" },
  { id: "delivered", label: "Delivered / completed" },
  { id: "cancelled", label: "Cancelled" },
]

const STATUS_STYLE = (s) => {
  const v = String(s || "").toLowerCase()
  if (v === "delivered" || v === "completed") return "bg-green-50 text-green-700"
  if (v.startsWith("cancel") || v === "rejected") return "bg-red-50 text-red-700"
  if (v === "created" || v === "searching") return "bg-neutral-100 text-neutral-700"
  return "bg-blue-50 text-blue-700"
}

const prettyStatus = (s) =>
  String(s || "-").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

const when = (d) => {
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return "-"
  return t.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

const PAGE_SIZE = 25

/*
 * Which rows offer Delete. The server has the last word (it also refuses a
 * paid or delivered order, whose payment and payouts must stay on record);
 * this only keeps the button off rows it would certainly refuse.
 */
const IN_PROGRESS = new Set(["created", "confirmed", "preparing", "ready_for_pickup", "ready", "reached_pickup", "picked_up", "reached_drop",
  "searching", "accepted", "ongoing", "arriving", "started", "arrived"])
const canDelete = (o) => {
  const s = String(o.status || "").toLowerCase()
  if (IN_PROGRESS.has(s)) return false
  if (o.vertical === "taxi") return true
  return s !== "delivered" && String(o.paymentStatus || "").toLowerCase() !== "paid"
}

/**
 * A horizontal scrollbar pinned to the bottom of the screen for a wide table,
 * so the right-hand columns can be reached without scrolling to the table's
 * end first. It mirrors the table's own scroll position both ways and hides
 * itself when the table fits.
 */
function useFloatingScrollbar() {
  const tableRef = useRef(null)
  const barRef = useRef(null)
  const [width, setWidth] = useState({ inner: 0, outer: 0 })
  useEffect(() => {
    const el = tableRef.current
    if (!el) return undefined
    const measure = () => setWidth({ inner: el.scrollWidth, outer: el.clientWidth })
    measure()
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)
    window.addEventListener("resize", measure)
    return () => { ro?.disconnect(); window.removeEventListener("resize", measure) }
  }, [])
  useEffect(() => {
    const table = tableRef.current
    const bar = barRef.current
    if (!table || !bar) return undefined
    let syncing = false
    const follow = (from, to) => () => {
      if (syncing) { syncing = false; return }
      syncing = true
      to.scrollLeft = from.scrollLeft
    }
    const onTable = follow(table, bar)
    const onBar = follow(bar, table)
    table.addEventListener("scroll", onTable, { passive: true })
    bar.addEventListener("scroll", onBar, { passive: true })
    return () => { table.removeEventListener("scroll", onTable); bar.removeEventListener("scroll", onBar) }
  }, [width.inner > width.outer])
  return { tableRef, barRef, overflowing: width.inner > width.outer + 1, innerWidth: width.inner }
}

export default function MasterOrders() {
  const navigate = useNavigate()
  const { tab: tabParam } = useParams()
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam : "all"
  const setTab = (key) => {
    setPage(1)
    navigate(key === "all" ? "/admin/master/orders" : `/admin/master/orders/${key}`, { replace: true })
  }

  const [orders, setOrders] = useState([])
  const [counts, setCounts] = useState({})
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState("")
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [deletingKey, setDeletingKey] = useState("")
  const inFlight = useRef(0)
  const { tableRef, barRef, overflowing, innerWidth } = useFloatingScrollbar()

  const load = useCallback(async ({ quiet = false } = {}) => {
    const ticket = ++inFlight.current
    if (!quiet) setLoading(true)
    try {
      const res = await platformSettingsAPI.getMasterOrders({ tab, page, limit: PAGE_SIZE, status, search: query })
      if (ticket !== inFlight.current) return
      const data = res?.data?.data || {}
      setOrders(data.orders || [])
      setCounts(data.counts || {})
      setTotal(data.total || 0)
    } catch (e) {
      if (!quiet) toast.error(e?.response?.data?.message || "Could not load orders")
    } finally {
      if (ticket === inFlight.current) setLoading(false)
    }
  }, [tab, page, status, query])

  const removeOrder = async (o) => {
    if (!window.confirm(`Delete ${o.orderId}? It disappears from every admin list. This cannot be undone.`)) return
    const key = `${o.source}-${o._id}`
    setDeletingKey(key)
    try {
      await platformSettingsAPI.deleteMasterOrder(o.source, o._id)
      setOrders((prev) => prev.filter((x) => `${x.source}-${x._id}` !== key))
      setTotal((t) => Math.max(0, t - 1))
      toast.success(`${o.orderId} deleted`)
      load({ quiet: true })
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not delete this order")
    } finally {
      setDeletingKey("")
    }
  }

  useEffect(() => { load() }, [load])

  // Keep it live without a manual refresh: new orders and rider changes show up.
  useEffect(() => {
    const id = setInterval(() => load({ quiet: true }), 30000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(search.trim()) }, 400)
    return () => clearTimeout(t)
  }, [search])

  const tabCount = (key) => {
    if (key === "all") return Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0)
    return counts[key]
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">All orders</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Food, Quick Commerce and Taxi in one place. Assign a rider to any Food or Quick order.
            </p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {tabCount(key) != null && (
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${tab === key ? "bg-white/20" : "bg-neutral-100 text-neutral-600"}`}>
                  {tabCount(key)}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order number (FOD-, QC-)"
              className="w-full rounded-lg border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-900 focus:outline-none"
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setPage(1); setStatus(e.target.value) }}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <div className="overflow-clip rounded-xl border border-neutral-200 bg-white">
          <div ref={tableRef} className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Store / Trip</th>
                  <th className="px-4 py-3">Rider</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assign</th>
                  <th className="px-4 py-3"><span className="sr-only">Delete</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading && orders.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-neutral-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-neutral-500">No orders here.</td></tr>
                ) : orders.map((o) => {
                  const src = SOURCE_STYLE[o.source] || SOURCE_STYLE.food
                  const assignable = o.vertical !== "taxi"
                  return (
                    <tr key={`${o.source}-${o._id}`} className="align-top">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-neutral-900">{o.orderId}</div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${src.cls}`}>{src.label}</span>
                          <span className="text-xs text-neutral-500">{when(o.createdAt)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-neutral-900">{o.customerName}</div>
                        <div className="text-xs text-neutral-500">{o.customerPhone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-neutral-900">{o.storeName || (o.vertical === "taxi" ? "Trip" : "-")}</div>
                        <div className="max-w-[260px] truncate text-xs text-neutral-500" title={o.address}>{o.address}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-neutral-900">{o.riderName || <span className="text-neutral-400">Not assigned</span>}</div>
                        <div className="text-xs text-neutral-500">{o.riderPhone}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="font-semibold text-neutral-900">{money(o.total)}</div>
                        <div className="text-xs uppercase text-neutral-500">{o.paymentMethod}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE(o.status)}`}>
                          {prettyStatus(o.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {!assignable ? (
                          <span className="text-xs text-neutral-400">Ride dispatch</span>
                        ) : (
                          <div className="flex flex-col items-start gap-1.5">
                            {isManualPending(o) && (
                              <ManualAssignStatus order={o} vertical={o.vertical} onChanged={() => load({ quiet: true })} compact />
                            )}
                            {canAssignRider(o) ? (
                              <AssignRiderButton order={o} vertical={o.vertical} onAssigned={() => load({ quiet: true })} />
                            ) : !isManualPending(o) ? (
                              <span className="text-xs text-neutral-400">-</span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canDelete(o) && (
                          <button
                            type="button"
                            onClick={() => removeOrder(o)}
                            disabled={deletingKey === `${o.source}-${o._id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                            title="Delete this order"
                          >
                            {deletingKey === `${o.source}-${o._id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {overflowing && (
            // Pinned to the bottom of the screen while the table runs past it.
            <div
              ref={barRef}
              className="sticky bottom-0 z-10 overflow-x-auto border-t border-neutral-200 bg-white/95 backdrop-blur"
              aria-hidden="true"
            >
              <div style={{ width: innerWidth, height: 1 }} />
            </div>
          )}
          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3 text-sm text-neutral-600">
            <span className="tabular-nums">{total} orders</span>
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
        </div>
      </div>
    </div>
  )
}
