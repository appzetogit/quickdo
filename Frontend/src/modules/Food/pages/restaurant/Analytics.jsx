import { useState, useEffect, useMemo, useRef } from "react"
import {
  ArrowLeft, TrendingUp, Users, DollarSign, Truck, ShoppingBag,
  Star, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Clock, Package, ExternalLink,
  AlertCircle, Calendar, BarChart2
} from "lucide-react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { restaurantAPI } from "@food/api"
import { isoDay } from "@food/utils/downloadFile"

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

function StatusBadge({ label, color, icon: Icon }) {
  const colorMap = {
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-600 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    purple: "bg-purple-50 text-purple-700 border-purple-200",
    gray: "bg-gray-50 text-gray-600 border-gray-200",
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorMap[color] || colorMap.gray}`}>
      {Icon && <Icon className="w-2.5 h-2.5" />}
      {label}
    </span>
  )
}

// ─── Mini bar chart ───────────────────────────────────────────────────────────
function MiniBar({ values, color = "#ff6d00" }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm transition-all"
          style={{ height: `${Math.max((v / max) * 100, 8)}%`, background: color, opacity: 0.7 + (i / values.length) * 0.3 }}
        />
      ))}
    </div>
  )
}

// ─── Period Picker Bottom Sheet ───────────────────────────────────────────────
function PeriodPickerSheet({ open, onClose, tabs, activeTab, onChange, periodType }) {
  const listRef = useRef(null)

  // Scroll the active item into view when sheet opens
  useEffect(() => {
    if (!open || !listRef.current) return
    const idx = tabs.findIndex((t) => t.id === activeTab)
    if (idx > -1) {
      const el = listRef.current.children[idx]
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [open, activeTab, tabs])

  // Prevent body scroll while sheet is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  const typeLabel = periodType === "week" ? "Select Week" : periodType === "month" ? "Select Month" : "Select Year"

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200]"
            onClick={onClose}
          />

          {/* Modal Dialog */}
          <motion.div
            key="sheet"
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 32, stiffness: 280 }}
            className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl z-[201] flex flex-col max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle - mobile only */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-gray-200 rounded-full" />
            </div>

            {/* Title */}
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">{typeLabel}</h3>
              <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Scrollable list */}
            <div ref={listRef} className="overflow-y-auto flex-1 px-4 py-3 space-y-1.5">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab
                return (
                  <button
                    key={tab.id}
                    onClick={() => { onChange(tab.id); onClose() }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all text-left border ${
                      isActive
                        ? "bg-[#ff6d00] text-white border-[#ff6d00] shadow-sm"
                        : "bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    <div>
                      <p className={`text-sm font-bold ${isActive ? "text-white" : "text-gray-900"}`}>{tab.label}</p>
                      {tab.start && tab.end && (
                        <p className={`text-[10px] font-medium mt-0.5 ${
                          isActive ? "text-orange-100" : "text-gray-400"
                        }`}>
                          {tab.start.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          {" – "}
                          {tab.end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      )}
                    </div>
                    {isActive && (
                      <svg className="w-4 h-4 text-white flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── Stat row ────────────────────────────────────────────────────────────────
function StatRow({ label, value, sub, right, rightColor = "text-gray-900" }) {
  return (
    <div className="flex items-center justify-between text-xs py-1.5">
      <div>
        <span className="font-semibold text-gray-600">{label}</span>
        {sub && <span className="ml-1 text-gray-400">({sub})</span>}
      </div>
      <span className={`font-bold ${rightColor}`}>{right ?? value}</span>
    </div>
  )
}

// ─── Order status funnel ─────────────────────────────────────────────────────
function OrderFunnel({ data, onStatusClick }) {
  const rows = [
    { label: "Total Placed", value: data.total, color: "bg-blue-500", icon: ShoppingBag, textColor: "text-blue-700", statusKey: null },
    { label: "Preparing / Confirmed", value: data.preparing, color: "bg-amber-500", icon: Clock, textColor: "text-amber-700", statusKey: "preparing" },
    { label: "Out For Delivery", value: data.outForDelivery, color: "bg-purple-500", icon: Truck, textColor: "text-purple-700", statusKey: "out-for-delivery" },
    { label: "Delivered", value: data.delivered, color: "bg-green-500", icon: CheckCircle, textColor: "text-green-700", statusKey: "delivered" },
    { label: "Cancelled", value: data.cancelled, color: "bg-red-400", icon: XCircle, textColor: "text-red-600", statusKey: "cancelled" },
    { label: "Rejected", value: data.rejected, color: "bg-rose-400", icon: AlertCircle, textColor: "text-rose-600", statusKey: "rejected" },
  ]

  return (
    <div className="space-y-2.5 mt-2">
      {rows.map(({ label, value, color, icon: Icon, textColor, statusKey }) => {
        const barPct = data.total > 0 ? Math.round((value / data.total) * 100) : 0
        const isClickable = statusKey !== null && value > 0
        return (
          <div
            key={label}
            onClick={() => isClickable && onStatusClick(statusKey)}
            className={isClickable ? "cursor-pointer group" : ""}
          >
            <div className="flex items-center justify-between text-xs mb-1">
              <span className={`font-semibold flex items-center gap-1.5 ${
                isClickable ? "text-gray-600 group-hover:text-gray-900" : "text-gray-600"
              }`}>
                <Icon className={`w-3 h-3 ${textColor}`} />
                {label}
              </span>
              <span className={`font-bold flex items-center gap-1 ${
                isClickable ? "text-gray-900 group-hover:text-[#ff6d00]" : "text-gray-900"
              }`}>
                {value} <span className="text-gray-400 font-medium text-[10px]">({barPct}%)</span>
                {isClickable && <ExternalLink className="w-2.5 h-2.5 text-gray-300 group-hover:text-[#ff6d00] transition-colors" />}
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${color} ${
                  isClickable ? "group-hover:opacity-80" : ""
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${barPct}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── Main component ───────────────────────────────────────────────────────────
/*
 * Every figure on this page is aggregated on the server
 * (GET /food/restaurant/analytics/sales), from the orders and the payout
 * ledger, for the period picked here. Nothing is computed from a capped list
 * of orders in the browser and nothing is made up: a period with no orders
 * shows an empty state.
 */
export default function Analytics() {
  const goBack = useRestaurantBackNavigation()
  const navigate = useNavigate()
  const [daily, setDaily] = useState(null)
  const [trend, setTrend] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [expandedDay, setExpandedDay] = useState(null)

  // Date scroll tabs: month / week / year
  const [periodType, setPeriodType] = useState("week") // "week" | "month" | "year"
  const [periodIndex, setPeriodIndex] = useState(0) // 0 = most recent
  const [pickerOpen, setPickerOpen] = useState(false)

  // ── Build period tabs for the selected type ──────────────────────────────
  const periodTabs = useMemo(() => {
    const now = new Date()
    const tabs = []

    if (periodType === "week") {
      for (let i = 0; i < 12; i++) {
        const end = new Date(now)
        end.setDate(now.getDate() - i * 7)
        const start = new Date(end)
        start.setDate(end.getDate() - 6)
        const label = i === 0 ? "This Week" : i === 1 ? "Last Week" : `${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
        tabs.push({ id: String(i), label, start, end })
      }
    } else if (periodType === "month") {
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const start = new Date(d.getFullYear(), d.getMonth(), 1)
        const end = i === 0 ? now : new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
        const label = i === 0 ? "This Month" : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
        tabs.push({ id: String(i), label, start, end })
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const yr = now.getFullYear() - i
        const start = new Date(yr, 0, 1)
        const end = i === 0 ? now : new Date(yr, 11, 31, 23, 59, 59)
        const label = i === 0 ? "This Year" : String(yr)
        tabs.push({ id: String(i), label, start, end })
      }
    }
    return tabs
  }, [periodType])

  const activePeriod = periodTabs[Number(periodIndex)] || periodTabs[0]

  // ── Fetch the period from the server ─────────────────────────────────────
  useEffect(() => {
    if (!activePeriod) return undefined
    let alive = true
    const from = isoDay(activePeriod.start)
    const to = isoDay(activePeriod.end)
    const trendGroup = periodType === "week" ? "day" : periodType === "month" ? "week" : "month"
    setLoading(true)
    setError("")
    Promise.all([
      restaurantAPI.getSalesAnalytics({ from, to, groupBy: "day" }),
      trendGroup === "day" ? null : restaurantAPI.getSalesAnalytics({ from, to, groupBy: trendGroup }),
    ])
      .then(([dayRes, trendRes]) => {
        if (!alive) return
        const day = dayRes?.data?.data || null
        setDaily(day)
        setTrend((trendRes?.data?.data || day)?.series || [])
      })
      .catch((e) => {
        if (!alive) return
        setDaily(null)
        setTrend([])
        setError(e?.response?.data?.message || "Could not load analytics for this period.")
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activePeriod, periodType])

  // ── Metrics, straight from the server's totals ───────────────────────────
  const metrics = useMemo(() => {
    const t = daily?.totals || {}
    const discountsOf = (row) =>
      Math.max(0, Math.round(((row.taxableValue || 0) + (row.packaging || 0) - (row.commission || 0) - (row.payout || 0)) * 100) / 100)
    const daysDetails = (daily?.series || [])
      .filter((d) => d.orders > 0)
      .map((d) => ({
        date: new Date(d.start).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        totalOrders: d.orders,
        delivered: d.delivered,
        cancelled: d.cancelled,
        rejected: d.rejected,
        sales: d.grossSales,
        commission: d.commission,
        discounts: discountsOf(d),
        netPayout: d.payout,
      }))
      .reverse()
    return {
      total: t.orders || 0,
      statusBuckets: {
        delivered: t.delivered || 0,
        preparing: t.preparing || 0,
        outForDelivery: t.outForDelivery || 0,
        cancelled: t.cancelled || 0,
        rejected: t.rejected || 0,
        pending: 0,
      },
      grossSales: t.grossSales || 0,
      discounts: discountsOf(t),
      commission: t.commission || 0,
      tax: t.gst || 0,
      netPayout: t.payout || 0,
      avgOrderValue: t.avgOrderValue || 0,
      uniqueCustomers: t.uniqueCustomers || 0,
      repeatCustomers: t.repeatCustomers || 0,
      newCustomers: t.newCustomers || 0,
      repeatRate: t.repeatRate || 0,
      daysDetails,
      trendData: trend.map((s) => ({
        label: periodType === "week"
          ? new Date(s.start).toLocaleDateString("en-IN", { weekday: "short" })
          : periodType === "month"
            ? new Date(s.start).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
            : new Date(s.start).toLocaleDateString("en-IN", { month: "short" }),
        value: s.grossSales,
      })),
    }
  }, [daily, trend, periodType])

  const isEmpty = !loading && !error && metrics.total === 0

  const toggleDay = (d) => setExpandedDay(expandedDay === d ? null : d)

  const PERIOD_TYPES = [
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
  ]

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col font-sans pb-28 text-gray-900">
      <style>{`.no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}.no-scrollbar::-webkit-scrollbar{display:none}`}</style>

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={goBack} className="p-2 -ml-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors" aria-label="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">Outlet Analytics</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Performance metrics & order insights</p>
            </div>
          </div>
          <button
            onClick={() => navigate("/food/restaurant/download-report")}
            className="text-[10px] font-bold px-3 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
          >
            Download report
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">

        {/* ── PERIOD SELECTOR ─────────────────────────────────────────────── */}
        <div className="bg-white px-4 py-3.5 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-3">
          {PERIOD_TYPES.map((pt) => (
            <button
              key={pt.id}
              onClick={() => {
                if (periodType !== pt.id) {
                  setPeriodType(pt.id)
                  setPeriodIndex(0)
                  setExpandedDay(null)
                }
                setPickerOpen(true)
              }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-2xl transition-all border ${
                periodType === pt.id
                  ? "bg-[#ff6d00] text-white border-[#ff6d00] shadow-sm"
                  : "bg-gray-50 text-gray-500 border-gray-200 hover:border-gray-400"
              }`}
            >
              {pt.label}
            </button>
          ))}
        </div>

        {activePeriod && (
          <button
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-between bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 group hover:bg-orange-100 transition-colors"
          >
            <div className="text-left">
              <p className="text-xs font-bold text-[#ff6d00]">{activePeriod.label}</p>
              <p className="text-[10px] text-orange-400 font-medium mt-0.5">
                {activePeriod.start.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {" – "}
                {activePeriod.end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-[#ff6d00] group-hover:translate-y-0.5 transition-transform" />
          </button>
        )}

        <PeriodPickerSheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          tabs={periodTabs}
          activeTab={String(periodIndex)}
          periodType={periodType}
          onChange={(id) => { setPeriodIndex(Number(id)); setExpandedDay(null) }}
        />

        {error && (
          <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="bg-white p-10 rounded-3xl border border-gray-100 shadow-sm text-center text-xs text-gray-400 font-semibold animate-pulse">
            Loading analytics…
          </div>
        ) : isEmpty ? (
          <div className="bg-white p-10 rounded-3xl border border-gray-100 shadow-sm text-center space-y-2">
            <BarChart2 className="w-8 h-8 text-gray-300 mx-auto" />
            <p className="text-sm font-bold text-gray-700">No orders in this period</p>
            <p className="text-xs text-gray-400">Analytics appear here once customers order from your outlet. Try another period.</p>
          </div>
        ) : !error && (
          <>
            {/* ── KPI CARDS ───────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3">
              <KPICard icon={DollarSign} iconBg="bg-orange-50" iconColor="text-[#ff6d00]" label="Total Sales" value={fmt(metrics.grossSales)} />
              <KPICard icon={ShoppingBag} iconBg="bg-blue-50" iconColor="text-blue-600" label="Orders" value={metrics.total} />
              <KPICard icon={TrendingUp} iconBg="bg-purple-50" iconColor="text-purple-600" label="Avg. Order Value" value={fmt(metrics.avgOrderValue)} />
              <KPICard icon={Star} iconBg="bg-yellow-50" iconColor="text-yellow-500" label="Net Payout" value={fmt(metrics.netPayout)} />
            </div>

            {/* ── ORDER STATUS ANALYTICS ──────────────────────────────────── */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <SectionHeader icon={Package} title="Order Status Analytics" sub="Tap a status to view filtered orders" />
              <OrderFunnel
                data={{
                  total: metrics.total,
                  delivered: metrics.statusBuckets.delivered,
                  preparing: metrics.statusBuckets.preparing + metrics.statusBuckets.pending,
                  outForDelivery: metrics.statusBuckets.outForDelivery,
                  cancelled: metrics.statusBuckets.cancelled,
                  rejected: metrics.statusBuckets.rejected,
                }}
                onStatusClick={(statusKey) =>
                  navigate(`/food/restaurant/orders/all?status=${statusKey}`, { state: { from: '/food/restaurant/analytics' } })
                }
              />

              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-100">
                {[
                  { label: `${metrics.statusBuckets.delivered} Delivered`, status: "delivered", cls: "bg-green-50 text-green-700 border-green-200" },
                  { label: `${metrics.statusBuckets.outForDelivery} Out Now`, status: "out-for-delivery", cls: "bg-purple-50 text-purple-700 border-purple-200" },
                  { label: `${metrics.statusBuckets.preparing + metrics.statusBuckets.pending} Preparing`, status: "preparing", cls: "bg-amber-50 text-amber-700 border-amber-200" },
                  { label: `${metrics.statusBuckets.cancelled} Cancelled`, status: "cancelled", cls: "bg-red-50 text-red-600 border-red-200" },
                  { label: `${metrics.statusBuckets.rejected} Rejected`, status: "rejected", cls: "bg-rose-50 text-rose-600 border-rose-200" },
                ].map(({ label, status, cls }) => (
                  <button
                    key={status}
                    onClick={() => navigate(`/food/restaurant/orders/all?status=${status}`, { state: { from: '/food/restaurant/analytics' } })}
                    className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all hover:shadow-sm hover:scale-[1.03] active:scale-95 ${cls}`}
                  >
                    {label}
                    <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                  </button>
                ))}
              </div>

              <button
                onClick={() => navigate('/food/restaurant/orders/all?status=delivered', { state: { from: '/food/restaurant/analytics' } })}
                className="mt-4 w-full p-3.5 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-between hover:bg-green-100 transition-colors group"
              >
                <div className="text-left">
                  <p className="text-xs font-bold text-green-700">Delivery Success Rate</p>
                  <p className="text-[11px] text-green-500 font-medium mt-0.5 flex items-center gap-1">
                    Tap to view all delivered orders <ExternalLink className="w-3 h-3 opacity-60" />
                  </p>
                </div>
                <span className="text-2xl font-black text-green-700">
                  {pct(metrics.statusBuckets.delivered, metrics.total)}%
                </span>
              </button>
            </div>

            {/* ── TREND CHART ─────────────────────────────────────────────── */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <SectionHeader icon={BarChart2} title="Sales Trend" sub="Delivered sales over time" />
              <div className="flex items-end justify-between h-36 pt-4 px-1 gap-1.5 mt-2">
                {metrics.trendData.map((item, idx) => {
                  const maxV = Math.max(...metrics.trendData.map((t) => t.value), 1)
                  const h = Math.max((item.value / maxV) * 100, 6)
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                      <span className="text-[9px] opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white px-1 py-0.5 rounded mb-0.5 whitespace-nowrap">
                        {fmt(item.value)}
                      </span>
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${h}%` }}
                        transition={{ type: "spring", stiffness: 80, delay: idx * 0.02 }}
                        className="w-full rounded-t-md bg-gradient-to-t from-[#ff6d00] to-[#ffaa44] group-hover:from-[#e05600] transition-colors"
                      />
                      <span className="text-[9px] font-semibold text-gray-400 mt-1.5 block truncate max-w-full text-center">
                        {item.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── ORDER DATE-WISE DETAILS ACCORDION ───────────────────────── */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <SectionHeader icon={Calendar} title="Daily Order Breakdown" sub="Tap a date to see the day's figures" />
              {metrics.daysDetails.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400 font-semibold">No orders found for this period</div>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {metrics.daysDetails.map((day) => {
                    const isOpen = expandedDay === day.date
                    const successRate = pct(day.delivered, day.totalOrders)
                    return (
                      <div key={day.date} className="py-3.5 first:pt-0">
                        <button onClick={() => toggleDay(day.date)} className="w-full flex items-center justify-between group text-left">
                          <div className="flex items-start gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Calendar className="w-3.5 h-3.5 text-[#ff6d00]" />
                            </div>
                            <div>
                              <span className="text-xs font-bold text-gray-800 group-hover:text-[#ff6d00] transition-colors block">{day.date}</span>
                              <span className="text-[10px] text-gray-400 font-medium">
                                {day.totalOrders} orders · {day.delivered} delivered · {day.cancelled} cancelled
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <span className="text-xs font-black text-green-600">{fmt(day.netPayout)}</span>
                            {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                          </div>
                        </button>

                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 pt-3 border-t border-dashed border-gray-200 space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                  <div className="col-span-3 flex items-center justify-between p-3 rounded-xl bg-green-50 border border-green-100">
                                    <span className="text-[11px] font-bold text-green-700">Success Rate</span>
                                    <span className="text-xl font-black text-green-600">{successRate}%</span>
                                  </div>
                                  {[
                                    { label: "Delivered", val: day.delivered, color: "text-green-600", bg: "bg-green-50 border-green-100" },
                                    { label: "Cancelled", val: day.cancelled, color: "text-red-600", bg: "bg-red-50 border-red-100" },
                                    { label: "Rejected", val: day.rejected, color: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
                                  ].map(({ label, val, color, bg }) => (
                                    <div key={label} className={`p-2.5 rounded-xl border flex flex-col items-center ${bg}`}>
                                      <span className={`text-base font-black ${color}`}>{val}</span>
                                      <span className="text-[10px] font-semibold text-gray-500">{label}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 space-y-1">
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Financial Details</span>
                                  <StatRow label="Gross Sales" right={fmt(day.sales)} />
                                  <StatRow label="Discounts & adjustments" right={`- ${fmt(day.discounts)}`} rightColor="text-red-500" />
                                  <StatRow label="Platform Commission" right={`- ${fmt(day.commission)}`} rightColor="text-red-500" />
                                  <div className="border-t border-gray-200 pt-2 mt-2">
                                    <StatRow label="Net Payout" right={fmt(day.netPayout)} rightColor="text-green-600" />
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── COST BREAKDOWN ──────────────────────────────────────────── */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <SectionHeader icon={DollarSign} title="Cost Breakdown" sub="Revenues, commissions & net payout (delivered orders)" />
              <div className="mt-4 space-y-3">
                {[
                  { label: "Gross Sales", val: fmt(metrics.grossSales), color: "text-gray-900" },
                  { label: "Your own offers & adjustments", val: `- ${fmt(metrics.discounts)}`, color: "text-red-500" },
                  { label: "Platform Commission", val: `- ${fmt(metrics.commission)}`, color: "text-red-500" },
                  { label: "GST on food (paid by the platform)", val: fmt(metrics.tax), color: "text-gray-700" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="font-semibold text-gray-500">{label}</span>
                    <span className={`font-bold ${color}`}>{val}</span>
                  </div>
                ))}
                <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Net Payout</p>
                    <p className="text-[10px] text-gray-400">To bank account</p>
                  </div>
                  <p className="text-xl font-black text-green-600">{fmt(metrics.netPayout)}</p>
                </div>
              </div>
            </div>

            {/* ── CUSTOMER RETENTION ──────────────────────────────────────── */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <SectionHeader icon={Users} title="Customer Retention" sub="New vs. repeating customers in this period" />
              <div className="flex items-center gap-6 py-3 mt-1">
                <div className="relative w-20 h-20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <path className="text-gray-100" strokeWidth="3.5" stroke="currentColor" fill="transparent" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <motion.path
                      className="text-purple-600"
                      strokeDasharray={`${metrics.repeatRate}, 100`}
                      strokeWidth="3.5" strokeLinecap="round" stroke="currentColor" fill="transparent"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      initial={{ strokeDasharray: "0, 100" }}
                      animate={{ strokeDasharray: `${metrics.repeatRate}, 100` }}
                      transition={{ duration: 1 }}
                    />
                  </svg>
                  <div className="absolute text-center">
                    <p className="text-sm font-extrabold text-gray-900">{metrics.repeatRate}%</p>
                    <p className="text-[7px] font-bold text-gray-400 uppercase">Repeat</p>
                  </div>
                </div>
                <div className="flex-1 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-600" />Repeat Customers</span>
                    <span className="font-bold text-gray-900">{metrics.repeatCustomers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-200" />New Customers</span>
                    <span className="font-bold text-gray-900">{metrics.newCustomers}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-50 flex justify-between font-bold text-gray-700">
                    <span>Total Unique Customers</span>
                    <span>{metrics.uniqueCustomers}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Shared section header ────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <p className="text-[11px] text-gray-400 font-medium">{sub}</p>
      </div>
      <div className="p-2 rounded-xl bg-orange-50 text-[#ff6d00]">
        <Icon className="w-4 h-4" />
      </div>
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KPICard({ icon: Icon, iconBg, iconColor, label, value }) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
      <div className="flex justify-between items-start mb-2">
        <div className={`p-2 rounded-xl ${iconBg} ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400">{label}</p>
        <h3 className="text-xl font-bold text-gray-950 mt-0.5">{value}</h3>
      </div>
    </div>
  )
}
