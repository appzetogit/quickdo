import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { ArrowLeft, Download, FileSpreadsheet, Loader2, AlertCircle, ChevronDown } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { saveBlobResponse, blobErrorMessage } from "@food/utils/downloadFile"

/*
 * Settlement statement per cycle (15th to 14th), from
 * GET /food/restaurant/settlements and /settlements/:cycleId. Every figure is
 * the server's: the orders and the payout ledger, nothing estimated here.
 */
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const TABS = [
  { id: "summary", label: "Summary" },
  { id: "orders", label: "Orders" },
  { id: "payouts", label: "Payouts" },
]

function Row({ label, value, strong, muted, note }) {
  return (
    <div className={`flex items-start justify-between gap-4 px-4 py-3 border-b border-gray-100 ${strong ? "bg-gray-50" : ""}`}>
      <div>
        <span className={`text-sm ${strong ? "font-bold text-gray-900" : muted ? "text-gray-500" : "text-gray-800"}`}>{label}</span>
        {note && <p className="text-[11px] text-gray-400 mt-0.5">{note}</p>}
      </div>
      <span className={`text-sm whitespace-nowrap ${strong ? "font-bold text-gray-900" : muted ? "text-gray-500" : "font-semibold text-gray-900"}`}>{value}</span>
    </div>
  )
}

export default function FinanceDetailsPage() {
  const goBack = useRestaurantBackNavigation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [cycles, setCycles] = useState([])
  const [cycleId, setCycleId] = useState(searchParams.get("cycle") || "")
  const [statement, setStatement] = useState(null)
  const [tab, setTab] = useState("summary")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")

  useEffect(() => {
    let alive = true
    restaurantAPI
      .getSettlementStatements({ limit: 12 })
      .then((res) => {
        if (!alive) return
        const list = res?.data?.data?.statements || []
        setCycles(list)
        if (!cycleId && list.length) setCycleId(list[0].id)
        if (!list.length) setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        setError(err?.response?.data?.message || "Could not load settlement statements.")
        setLoading(false)
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!cycleId) return undefined
    let alive = true
    setLoading(true)
    setError("")
    restaurantAPI
      .getSettlementStatement(cycleId)
      .then((res) => { if (alive) setStatement(res?.data?.data || null) })
      .catch((err) => { if (alive) setError(err?.response?.data?.message || "Could not load this statement.") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [cycleId])

  const chooseCycle = (id) => {
    setCycleId(id)
    setSearchParams(id ? { cycle: id } : {}, { replace: true })
  }

  const download = async (format) => {
    if (!cycleId) return
    setBusy(format)
    setError("")
    try {
      const res = await restaurantAPI.downloadSettlementStatement(cycleId, format)
      saveBlobResponse(res, `settlement-statement_${cycleId}.${format}`)
    } catch (err) {
      setError(await blobErrorMessage(err, "Could not download the statement."))
    } finally {
      setBusy("")
    }
  }

  const t = statement?.totals
  const restaurant = statement?.restaurant

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <div className="sticky bg-white top-0 z-40 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="p-1 rounded-full hover:bg-gray-100" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{restaurant?.name || "Settlement statements"}</h1>
            {restaurant && (
              <p className="text-xs text-gray-600 mt-0.5 truncate">
                ID: {restaurant.code}{restaurant.address ? ` • ${restaurant.address}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4 max-w-3xl w-full mx-auto">
        <div className="bg-white rounded-lg p-4 space-y-3">
          <label className="block text-xs font-semibold text-gray-600">
            Settlement cycle
            <div className="relative mt-1">
              <select
                value={cycleId}
                onChange={(e) => chooseCycle(e.target.value)}
                className="w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 pr-9 text-sm font-semibold text-gray-900"
                disabled={!cycles.length}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}{c.status === "open" ? " (current)" : ""} · {inr(c.totals?.netPayout)}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => download("pdf")}
              disabled={!cycleId || Boolean(busy)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Statement PDF
            </button>
            <button
              onClick={() => download("csv")}
              disabled={!cycleId || Boolean(busy)}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-900 px-3 py-2.5 text-xs font-bold text-gray-900 disabled:opacity-50"
            >
              {busy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Orders CSV
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2">
          {TABS.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={`px-5 py-2.5 rounded-full text-sm font-medium ${tab === x.id ? "bg-black text-white" : "bg-white text-black"}`}
            >
              {x.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="bg-white rounded-lg p-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading statement…
          </div>
        ) : !statement ? (
          <div className="bg-white rounded-lg p-8 text-center text-sm text-gray-500">No settlement statement to show yet.</div>
        ) : tab === "summary" ? (
          <div className="space-y-4">
            <div className="bg-white rounded-lg p-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-600 mb-1">Net payout for this cycle</p>
                <p className="text-2xl font-bold text-gray-900">{inr(t.netPayout)}</p>
                <p className="text-xs text-gray-600">{statement.cycle.label}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-1">Status</p>
                <p className="text-sm font-semibold text-gray-900">{statement.cycle.status === "open" ? "In progress" : "Closed"}</p>
                <p className="text-xs text-gray-600 mt-1">Paid out during cycle: {inr(t.paidOut)}</p>
              </div>
            </div>
            <div className="bg-white rounded-lg overflow-hidden">
              <Row label="Orders" value={t.orders} />
              <Row label="Item sales" value={inr(t.itemSales)} />
              <Row
                label="GST on food"
                value={inr(t.gstCollected)}
                muted
                note="Collected from customers and paid to the government by the platform under section 9(5); not part of your payout."
              />
              <Row label="Taxable food value (A)" value={inr(t.taxableValue)} />
              <Row label="Packaging charges (B)" value={inr(t.packaging)} />
              <Row label="Platform commission (C)" value={`- ${inr(t.commission)}`} />
              <Row label="Discounts you funded (D)" value={`- ${inr(t.restaurantDiscounts)}`} />
              <Row label="Other adjustments (E)" value={inr(t.otherAdjustments)} />
              <Row label="Net payout (A + B - C - D + E)" value={inr(t.netPayout)} strong />
              {t.refundedOrders > 0 && <Row label="Refunded orders (not payable)" value={t.refundedOrders} muted />}
            </div>
          </div>
        ) : tab === "orders" ? (
          <div className="bg-white rounded-lg overflow-x-auto">
            {statement.lines?.length ? (
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Order</th>
                    <th className="text-right px-3 py-2">Items</th>
                    <th className="text-right px-3 py-2">Commission</th>
                    <th className="text-right px-3 py-2">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.lines.map((l) => (
                    <tr key={l.orderId} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <span className="font-semibold text-gray-900">{l.orderId}</span>
                        <span className="block text-[10px] text-gray-500">{l.date} · {l.paymentMethod}</span>
                      </td>
                      <td className="text-right px-3 py-2">{inr(l.itemSubtotal)}</td>
                      <td className="text-right px-3 py-2">- {inr(l.commission)}</td>
                      <td className="text-right px-3 py-2 font-semibold">{inr(l.payout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">No orders in this cycle.</p>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg overflow-hidden">
            {statement.payoutsMade?.length ? (
              statement.payoutsMade.map((p, i) => (
                <Row
                  key={`${p.type}-${i}`}
                  label={p.type === "withdrawal" ? "Withdrawal paid" : "Settlement paid"}
                  note={`${new Date(p.at).toLocaleString("en-IN")}${p.reference ? ` · Ref ${p.reference}` : ""}`}
                  value={inr(p.amount)}
                />
              ))
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">No payouts were made during this cycle.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
