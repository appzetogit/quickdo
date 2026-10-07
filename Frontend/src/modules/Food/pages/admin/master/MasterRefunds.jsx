import { useState, useEffect, useCallback, useRef } from "react"
import { platformRefundsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Search, RotateCcw, ChevronLeft, ChevronRight, Undo2 } from "lucide-react"

/**
 * Master > Refunds: every refund on the platform, with the payment gateway's own
 * status for refunds to the customer's card / UPI.
 *
 * Rows come from core/payments/refund.service.js. A refund to the original payment
 * method is "pending" at Razorpay until its `refund.processed` (or `refund.failed`)
 * webhook arrives; that is the Gateway column. A failed one can be retried here: the
 * retry reuses the refund's idempotency key, so it can never refund twice.
 */

const PAGE_SIZE = 25

const VERTICALS = [
  { id: "", label: "All services" },
  { id: "food", label: "Food" },
  { id: "quickCommerce", label: "Quick Commerce" },
  { id: "serviceProvider", label: "Services" },
  { id: "taxi", label: "Taxi" },
]
const VERTICAL_LABEL = Object.fromEntries(VERTICALS.filter((v) => v.id).map((v) => [v.id, v.label]))

const STATUSES = [
  { id: "", label: "Any status" },
  { id: "pending", label: "Pending" },
  { id: "processed", label: "Processed" },
  { id: "failed", label: "Failed" },
]

const GATEWAY = {
  initiating: { label: "Sending to gateway", tone: "bg-sky-50 text-sky-700" },
  created: { label: "Accepted", tone: "bg-sky-50 text-sky-700" },
  pending: { label: "Pending at gateway", tone: "bg-amber-50 text-amber-800" },
  processed: { label: "Refunded", tone: "bg-emerald-50 text-emerald-700" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-700" },
}
const STATUS_TONE = {
  pending: "bg-amber-50 text-amber-800",
  processed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
}

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

export default function MasterRefunds() {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 })
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(null)

  const [vertical, setVertical] = useState("")
  const [status, setStatus] = useState("")
  const [refundTo, setRefundTo] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [applied, setApplied] = useState({ vertical: "", status: "", refundTo: "", q: "" })
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = Object.fromEntries(Object.entries({ ...applied, page, limit: PAGE_SIZE }).filter(([, v]) => v !== ""))
      const res = await platformRefundsAPI.list(params)
      const data = res?.data?.data
      setRows(data?.refunds || [])
      setMeta({ page: data?.page || 1, totalPages: data?.totalPages || 1, total: data?.total || 0 })
    } catch (err) {
      toast.error(errText(err, "Could not load refunds"))
    } finally {
      setLoading(false)
      firstLoad.current = false
    }
  }, [applied, page])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setApplied({ vertical, status, refundTo, q: q.trim() })
    }, firstLoad.current ? 0 : 350)
    return () => clearTimeout(t)
  }, [vertical, status, refundTo, q])

  const retry = async (r) => {
    const reason = window.prompt(`Retry the ${rupees(r.amount)} refund to the original payment method? Give a short reason:`)
    if (reason === null) return
    setRetrying(r._id)
    try {
      await platformRefundsAPI.retry(r._id, { reason })
      toast.success("Refund sent to the payment gateway")
      load()
    } catch (err) {
      toast.error(errText(err, "The gateway refused the refund"))
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Refunds</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Every refund across Food, Quick Commerce and Services, with the payment gateway&apos;s status for card and UPI refunds.
          </p>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block lg:col-span-2">
              <span className="text-xs font-medium text-neutral-600">Search</span>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input className={`${inputCls} pl-9`} placeholder="Order, pay_… or rfnd_… id" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Service</span>
              <select className={`${inputCls} mt-1`} value={vertical} onChange={(e) => setVertical(e.target.value)}>
                {VERTICALS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Status</span>
              <select className={`${inputCls} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Refunded to</span>
              <select className={`${inputCls} mt-1`} value={refundTo} onChange={(e) => setRefundTo(e.target.value)}>
                <option value="">Anywhere</option>
                <option value="gateway">Original payment method</option>
                <option value="wallet">Wallet</option>
              </select>
            </label>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
            <Undo2 className="h-4 w-4 text-neutral-400" />
            <p className="text-sm text-neutral-600">{loading ? "Loading…" : `${meta.total.toLocaleString("en-IN")} refunds`}</p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-5 py-12 text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading refunds
            </div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-neutral-500">No refunds match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <th className="px-5 py-2">When</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">To</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Gateway</th>
                    <th className="px-5 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const gw = GATEWAY[r.gatewayStatus]
                    return (
                      <tr key={r._id} className="border-b border-neutral-100 align-top last:border-0 hover:bg-neutral-50">
                        <td className="whitespace-nowrap px-5 py-3 text-neutral-700">{when(r.createdAt)}</td>
                        <td className="px-3 py-3 text-neutral-700">{VERTICAL_LABEL[r.vertical] || r.vertical || "—"}</td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-neutral-900">{r.orderRef || (r.orderId ? `…${String(r.orderId).slice(-6)}` : "—")}</p>
                          {r.reason && <p className="text-xs text-neutral-500">{r.reason}</p>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{rupees(r.amount)}</td>
                        <td className="px-3 py-3 text-neutral-700">{r.refundTo === "gateway" ? "Card / UPI" : "Wallet"}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[r.status] || "bg-neutral-100 text-neutral-700"}`}>{r.status}</span>
                        </td>
                        <td className="px-3 py-3">
                          {r.refundTo === "gateway" ? (
                            <>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${gw?.tone || "bg-neutral-100 text-neutral-700"}`}>{gw?.label || r.gatewayStatus || "—"}</span>
                              {r.gatewayRefundId && <p className="mt-1 font-mono text-[11px] text-neutral-500">{r.gatewayRefundId}</p>}
                              {r.gatewayPaymentId && <p className="font-mono text-[11px] text-neutral-400">{r.gatewayPaymentId}</p>}
                              {r.failureReason && <p className="mt-1 max-w-[16rem] text-[11px] text-red-700">{r.failureReason}</p>}
                            </>
                          ) : (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {r.refundTo === "gateway" && r.status === "failed" && (
                            <button type="button" className={ghostCls} disabled={retrying === r._id} onClick={() => retry(r)}>
                              {retrying === r._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
              <p className="text-xs text-neutral-500">Page {meta.page} of {meta.totalPages}</p>
              <div className="flex gap-2">
                <button type="button" className={ghostCls} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button type="button" className={ghostCls} disabled={page >= meta.totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
