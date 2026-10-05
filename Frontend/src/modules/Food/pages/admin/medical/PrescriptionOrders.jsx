import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { FileText, Loader2, Search, Trash2, X } from "lucide-react"
import { adminAPI } from "@food/api"
import AssignRiderButton from "@food/components/admin/orders/manual-assign/AssignRiderButton"
import RiderAssignmentSection from "@food/components/admin/orders/manual-assign/RiderAssignmentSection"

// Medical orders are quick-commerce orders: the /qc admin API assigns their riders.
const ASSIGN_VERTICAL = "quickCommerce"

/**
 * Every order a pharmacy has been asked to dispense, and where it has got to.
 *
 * Read-only, deliberately. The pharmacist is the one licensed to say a
 * prescription may be filled, so there is no approve or reject here — an admin
 * button doing it would be a non-pharmacist authorising a dispense, which is
 * the whole point of the seller-side gate. What this answers is "where is this
 * order stuck, and who is it waiting on".
 */

const TABS = [
  { id: "pending_review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
]

const rupees = (value) => `₹${(Number(value) || 0).toFixed(2)}`

const formatDate = (value) => {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

const statusBadge = (status) => {
  switch (status) {
    case "approved":
      return { label: "Approved", className: "bg-emerald-100 text-emerald-700" }
    case "rejected":
      return { label: "Rejected", className: "bg-rose-100 text-rose-700" }
    case "pending_review":
      return { label: "Needs review", className: "bg-amber-100 text-amber-700" }
    default:
      return { label: "—", className: "bg-slate-100 text-slate-600" }
  }
}

/**
 * Who the order is actually waiting on, which is the question the queue exists
 * to answer and which no single stored field holds: the prescription status
 * says whether the pharmacist has read it, and the bill status says whether the
 * customer has answered the price.
 */
const waitingOn = (order) => {
  const rx = order.prescription || {}
  // The order's own state first: a delivered order read "The pharmacy — preparing"
  // because only the prescription and bill were looked at.
  const status = String(order.orderStatus || "").toLowerCase()
  if (status === "delivered") return "Delivered"
  if (status.startsWith("cancelled")) return "Cancelled"
  if (["picked_up", "reached_drop"].includes(status)) return "The rider — on the way"
  if (status === "pending_payment") return "The customer — paying online"
  if (rx.status === "rejected") return "Closed — prescription rejected"
  if (rx.status === "pending_review") return "The pharmacist"
  switch (rx.bill?.status) {
    case "submitted":
      return "The customer — bill sent"
    case "approved":
      return "The pharmacy — preparing"
    case "rejected":
      return "Closed — bill declined"
    default:
      return "The pharmacist — to bill it"
  }
}

export default function PrescriptionOrders() {
  const [activeTab, setActiveTab] = useState("pending_review")
  const [search, setSearch] = useState("")
  const [orders, setOrders] = useState([])
  const [counts, setCounts] = useState({ all: 0, pending_review: 0, approved: 0, rejected: 0 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [removingId, setRemovingId] = useState(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const params = { limit: 200, status: activeTab, ...(search.trim() ? { search: search.trim() } : {}) }
      const [listRes, countsRes] = await Promise.all([
        adminAPI.getPrescriptionOrders(params),
        adminAPI.getPrescriptionOrderCounts(search.trim() ? { search: search.trim() } : {}),
      ])
      setOrders(listRes?.data?.data?.orders || [])
      setCounts(countsRes?.data?.data?.counts || { all: 0 })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load the prescription queue")
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, search])


  // Removes a finished order from this list. The server keeps the order (and
  // its payment) and refuses one that is still being prepared or delivered.
  const removeOrder = async (order) => {
    const status = String(order.orderStatus || order.status || "").toLowerCase()
    const active = ["created", "confirmed", "preparing", "ready_for_pickup", "reached_pickup"].includes(status)
    const question = active
      ? `Order ${order.orderId} is still active. Cancel it (the customer is told and any online payment refunded) and remove it from the list?`
      : `Remove order ${order.orderId} from the prescription list? The order record is kept.`
    if (!window.confirm(question)) return
    setRemovingId(order.id)
    try {
      await adminAPI.removePrescriptionOrder(order.id)
      toast.success(active ? "Order cancelled and removed from the list" : "Removed from the list")
      if (selected?.id === order.id) setSelected(null)
      await load()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not remove this order")
    } finally {
      setRemovingId(null)
    }
  }
  useEffect(() => {
    // Typing in the search box should not fire a request per keystroke.
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [load])

  const tabs = useMemo(
    () => TABS.map((tab) => ({ ...tab, count: Number(counts[tab.id]) || 0 })),
    [counts],
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Prescription orders</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Every order sent to a pharmacy. The pharmacist decides on the prescription; this is the record of it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
            }`}
          >
            {tab.label}
            <span className={`ml-2 text-xs ${activeTab === tab.id ? "text-slate-300" : "text-slate-400"}`}>
              {tab.count}
            </span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order id, customer or phone"
            className="pl-9 pr-3 py-2 w-64 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading
          </div>
        ) : orders.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            Nothing here. Orders appear as customers send prescriptions to a pharmacy.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Order", "Pharmacy", "Customer", "Prescription", "Waiting on", "Amount", ""].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => {
                  const badge = statusBadge(order.prescription?.status)
                  return (
                    <tr
                      key={order.id}
                      onClick={() => setSelected(order)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-slate-900">{order.orderId}</p>
                        <p className="text-xs text-slate-500">{formatDate(order.createdAt)}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{order.sellerName || "—"}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-slate-900">{order.customerName || "—"}</p>
                        <p className="text-xs text-slate-500">{order.customerPhone || ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{waitingOn(order)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {order.total > 0 ? rupees(order.total) : "Not priced"}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {/* Rows carry no dispatch data, so this shows for every
                            assignable state; the server refuses an accepted order
                            or an unapproved bill with its own message. */}
                        <AssignRiderButton
                          order={order}
                          vertical={ASSIGN_VERTICAL}
                          onAssigned={load}
                          size="xs"
                          className="mr-1 align-middle"
                        />
                        <button
                          type="button"
                          title="Remove from this list"
                          aria-label={`Remove order ${order.orderId} from this list`}
                          disabled={removingId === order.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            removeOrder(order)
                          }}
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                        >
                          {removingId === order.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && <OrderPanel order={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  )
}

/** The documents and the decisions, side by side. */
function OrderPanel({ order, onClose, onChanged }) {
  const rx = order.prescription || {}
  const bill = rx.bill || {}

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-white shadow-xl overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <div>
            <h2 className="text-sm font-bold text-slate-900">{order.orderId}</h2>
            <p className="text-xs text-slate-500">{order.sellerName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <Field label="Customer" value={`${order.customerName || "—"}${order.customerPhone ? ` · ${order.customerPhone}` : ""}`} />
          <Field label="Waiting on" value={waitingOn(order)} />
          <Field
            label="Pharmacist's decision"
            value={statusBadge(rx.status).label}
            note={rx.rejectionReason}
          />
          <Field
            label="Bill"
            value={
              bill.status === "none" || !bill.status
                ? "Not sent yet"
                : `${rupees(bill.amount)} · ${
                    bill.status === "approved"
                      ? "approved by the customer"
                      : bill.status === "rejected"
                        ? "declined by the customer"
                        : "waiting on the customer"
                  }`
            }
            note={bill.declineReason}
          />
          <Field
            label="Payment"
            value={`${(order.paymentMethod || "—").toUpperCase()} · ${(order.paymentStatus || "—").toUpperCase()}`}
          />

          <RiderAssignmentSection order={order} vertical={ASSIGN_VERTICAL} onChanged={onChanged} title="Delivery rider" />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Documents</p>
            <div className="flex flex-wrap gap-3">
              {rx.imageUrl ? (
                <a href={rx.imageUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">
                  Prescription
                </a>
              ) : (
                <span className="text-sm text-slate-400">No prescription image</span>
              )}
              {bill.imageUrl ? (
                <a href={bill.imageUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600 hover:underline">
                  Pharmacy bill
                </a>
              ) : (
                <span className="text-sm text-slate-400">No bill uploaded</span>
              )}
            </div>
          </div>

          {Array.isArray(order.items) && order.items.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Dispensed ({order.items.length})
              </p>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {order.items.map((item, index) => (
                  <li key={`${item.itemId || item.name}-${index}`} className="px-3 py-2 flex justify-between text-sm">
                    <span className="text-slate-700">
                      {item.name}
                      {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                    </span>
                    <span className="font-medium text-slate-900">{rupees(item.price)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-2 text-xs text-slate-500 pt-2 border-t border-slate-100">
            <FileText className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              Only the pharmacist can approve or reject a prescription. This page records what they decided.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, note }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
      {note ? <p className="text-xs text-red-600">{note}</p> : null}
    </div>
  )
}
