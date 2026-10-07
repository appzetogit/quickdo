import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, KeyRound, ShoppingBag, CalendarClock } from "lucide-react"
import apiClient from "@/services/api/axios"
import { restaurantAPI } from "@food/api"

/**
 * Store panel tabs for the SOW §5 orders (quick-commerce stores):
 *
 *   mode="pickup"     self-pickup orders (plan §5.2). The customer shows a
 *                     4-digit code at the counter; entering it here hands the
 *                     order over and completes it.
 *   mode="scheduled"  orders booked into a delivery slot (plan §5.3). Rider
 *                     search starts shortly before the slot, by itself.
 *
 * Accepting and packing these orders is unchanged (the other tabs).
 */

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const OPEN = ["created", "confirmed", "preparing", "ready_for_pickup"]
const STATUS = {
  created: "New",
  confirmed: "Accepted",
  preparing: "Packing",
  ready_for_pickup: "Ready",
  delivered: "Collected",
}

function PickupCode({ order, onDone }) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const id = order.orderMongoId || order._id

  const verify = async () => {
    if (!/^\d{4}$/.test(code)) {
      toast.error("Enter the customer's 4-digit pickup code")
      return
    }
    setBusy(true)
    try {
      await apiClient.post(`/food/restaurant/orders/${id}/pickup/verify`, { otp: code }, { contextModule: "restaurant" })
      toast.success("Order handed over")
      setCode("")
      onDone?.()
    } catch (err) {
      toast.error(errText(err, "Could not verify the code"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        placeholder="Code"
        aria-label="Pickup code"
        className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-center text-sm tracking-widest"
      />
      <button
        type="button"
        onClick={verify}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Hand over
      </button>
    </div>
  )
}

export default function StoreFulfilmentOrders({ mode = "pickup", refreshToken = 0, onSelectOrder }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = mode === "pickup" ? { fulfilmentType: "pickup", limit: 50 } : { limit: 100 }
      const res = await restaurantAPI.getOrders(params)
      let list = res?.data?.data?.orders || res?.data?.data?.data || []
      if (mode === "scheduled") {
        list = list.filter((o) => o.scheduledAt && OPEN.includes(String(o.orderStatus || o.status)))
        list.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      }
      setOrders(list)
    } catch (err) {
      toast.error(errText(err, "Could not load orders"))
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => { load() }, [load, refreshToken])

  if (loading) {
    return <div className="flex items-center justify-center gap-2 py-12 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
  }
  if (!orders.length) {
    return (
      <div className="py-12 text-center text-sm text-gray-500">
        {mode === "pickup" ? "No pickup orders. Customers who choose to collect from your store appear here." : "No upcoming scheduled orders."}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const status = String(o.orderStatus || o.status || "")
        const canHandOver = mode === "pickup" && ["confirmed", "preparing", "ready_for_pickup"].includes(status)
        const items = (o.items || []).map((it) => `${it.quantity} x ${it.name}`).join(", ")
        return (
          <div key={o.orderMongoId || o._id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <button type="button" className="min-w-0 text-left" onClick={() => onSelectOrder?.({ orderId: o.orderId, status, customerName: o.userId?.name || o.customerName })}>
                <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                  {mode === "pickup" ? <ShoppingBag className="h-4 w-4 text-emerald-600" /> : <CalendarClock className="h-4 w-4 text-indigo-600" />}
                  Order #{o.orderId}
                </p>
                <p className="text-[11px] text-gray-500">{o.userId?.name || o.customerName || "Customer"}</p>
              </button>
              <span className="shrink-0 rounded-full border border-gray-300 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
                {STATUS[status] || status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-gray-700">{items}</p>
            {o.scheduledAt && (
              <p className="mt-1 text-[11px] text-indigo-700">
                Slot: {o.deliverySlot?.label || new Date(o.scheduledAt).toLocaleString()}
                {o.deliverySlot?.date ? ` on ${o.deliverySlot.date}` : ""}
              </p>
            )}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
              <span className="text-xs font-semibold text-gray-900">Rs {Number(o.pricing?.total || 0).toFixed(2)} · {String(o.payment?.method || "").toUpperCase()}</span>
              {canHandOver && <PickupCode order={o} onDone={load} />}
              {mode === "pickup" && status === "created" && <span className="text-[11px] text-gray-500">Accept it first</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
