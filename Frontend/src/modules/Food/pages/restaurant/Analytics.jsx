import { useState, useEffect, useMemo, useRef } from "react"
import {
  ArrowLeft, TrendingUp, Users, DollarSign, Truck, ShoppingBag,
  ArrowUpRight, ArrowDownRight, Star, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Clock, Package, ExternalLink,
  AlertCircle, Calendar, BarChart2
} from "lucide-react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { restaurantAPI } from "@food/api"

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
export default function Analytics() {
  const goBack = useRestaurantBackNavigation()
  const navigate = useNavigate()
  const [dbOrders, setDbOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedDay, setExpandedDay] = useState(null)

  // Date scroll tabs: month / week / year
  const [periodType, setPeriodType] = useState("week") // "week" | "month" | "year"
  const [periodIndex, setPeriodIndex] = useState(0) // 0 = most recent
  const [pickerOpen, setPickerOpen] = useState(false)

  // Fetch orders once
  useEffect(() => {
    (async () => {
      try {
        const res = await restaurantAPI.getOrders({ page: 1, limit: 2000 })
        if (res?.data?.success && res?.data?.data?.orders) setDbOrders(res.data.data.orders)
      } catch (e) {
        console.error("Analytics order fetch error:", e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ── Build period tabs for the selected type ──────────────────────────────
  const periodTabs = useMemo(() => {
    const now = new Date()
    const tabs = []

    if (periodType === "week") {
      // Last 12 weeks
      for (let i = 0; i < 12; i++) {
        const end = new Date(now)
        end.setDate(now.getDate() - i * 7)
        const start = new Date(end)
        start.setDate(end.getDate() - 6)
        const label = i === 0 ? "This Week" : i === 1 ? "Last Week" : `${start.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
        tabs.push({ id: String(i), label, start, end })
      }
    } else if (periodType === "month") {
      // Last 12 months
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const start = new Date(d.getFullYear(), d.getMonth(), 1)
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
        const label = i === 0 ? "This Month" : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" })
        tabs.push({ id: String(i), label, start, end })
      }
    } else {
      // Last 3 years
      for (let i = 0; i < 3; i++) {
        const yr = now.getFullYear() - i
        const start = new Date(yr, 0, 1)
        const end = new Date(yr, 11, 31, 23, 59, 59)
        const label = i === 0 ? "This Year" : String(yr)
        tabs.push({ id: String(i), label, start, end })
      }
    }
    return tabs
  }, [periodType])

  const activePeriod = periodTabs[Number(periodIndex)] || periodTabs[0]

  // ── Filter orders for the selected period ────────────────────────────────
  const periodOrders = useMemo(() => {
    if (!activePeriod) return []
    return dbOrders.filter((o) => {
      const d = new Date(o.createdAt)
      return d >= activePeriod.start && d <= activePeriod.end
    })
  }, [dbOrders, activePeriod])

  const isDemo = dbOrders.length === 0

  // ── Compute all metrics ──────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const orders = isDemo
      ? generateMockOrders(activePeriod?.start, activePeriod?.end)
      : periodOrders

    const total = orders.length

    const statusBuckets = { delivered: 0, preparing: 0, outForDelivery: 0, cancelled: 0, rejected: 0, pending: 0 }
    orders.forEach((o) => {
      const s = String(o.orderStatus || o.status || "pending").toLowerCase().replace(/_/g, " ")
      if (s.includes("deliver") && !s.includes("out")) statusBuckets.delivered++
      else if (s.includes("out")) statusBuckets.outForDelivery++
      else if (s.includes("prepar") || s.includes("confirm") || s.includes("ready")) statusBuckets.preparing++
      else if (s.includes("cancel")) statusBuckets.cancelled++
      else if (s.includes("reject")) statusBuckets.rejected++
      else statusBuckets.pending++
    })

    const deliveredOrders = orders.filter((o) => {
      const s = String(o.orderStatus || o.status || "").toLowerCase()
      return s.includes("deliver") && !s.includes("out")
    })

    /*
     * Every figure below is the order's own, never a percentage assumed here.
     *
     * This used to read gross sales off the customer's GRAND TOTAL -- delivery
     * fee, platform fee and the tax itself included, none of it the
     * restaurant's -- and then invent "commission" as 12% of it and "GST" as
     * 5% of it. Both percentages were wrong for anyone on a different
     * commission or GST rate, and the GST was wrong for EVERY restaurant whose
     * menu prices include tax, where the tax is inside the price and is
     * extracted (Rs 100 carries Rs 4.76 at 5%), not added on top.
     *
     * `restaurantPayout` is the server's own breakdown of the order, summing to
     * what the payout ledger credits. The fallback reads the stored figures for
     * an order that predates it, and still never guesses a rate.
     */
    const sum = (fn) => deliveredOrders.reduce((total, o) => total + (Number(fn(o)) || 0), 0)
    const payoutOf = (o) => o?.restaurantPayout || null
    const grossSales = sum((o) => {
      const p = payoutOf(o)
      if (p) return Number(p.subTotal || 0) + Number(p.packagingCharge || 0)
      return o.pricing?.subtotal ?? o.totalPrice ?? 0
    })
    // Only offers the restaurant funded itself. A platform coupon costs it
    // nothing, and counting those as its discounts overstated them.
    const discounts = sum((o) => payoutOf(o)?.discountFundedByRestaurant ?? 0)
    const commission = sum((o) => payoutOf(o)?.commissionAmount ?? o.pricing?.restaurantCommission ?? 0)
    const tax = sum((o) => {
      const p = payoutOf(o)
      if (p) return p.gstOnFood
      // Pre-breakdown orders: the tax the bill actually charged.
      return o.pricing?.tax ?? 0
    })
    const netPayout = sum((o) => {
      const p = payoutOf(o)
      if (p) return p.payout
      const food = Number(o.pricing?.commissionableAmount ?? o.pricing?.subtotal ?? 0)
      return food - Number(o.pricing?.restaurantCommission || 0)
    })
    const avgOrderValue = total > 0 ? Math.round(grossSales / total) : 0

    // Delivery vs dining
    let deliveryCount = 0, diningCount = 0
    orders.forEach((o) => {
      const type = String(o.orderType || "").toLowerCase()
      if (type.includes("dine") || !o.deliveryAddress) diningCount++
      else deliveryCount++
    })
    const deliveryPct = total > 0 ? Math.round((deliveryCount / total) * 100) : 100

    // Customer retention
    const custMap = {}
    orders.forEach((o) => {
      const id = o.userId?._id || String(o.userId || o.customerName || "guest")
      custMap[id] = (custMap[id] || 0) + 1
    })
    const uniqueCustomers = Object.keys(custMap).length
    let repeatCustomers = 0, newCustomers = 0
    Object.values(custMap).forEach((c) => (c > 1 ? repeatCustomers++ : newCustomers++))
    const repeatRate = pct(repeatCustomers, uniqueCustomers)

    // Daily grouped details
    const dayMap = {}
    orders.forEach((o) => {
      const key = new Date(o.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      if (!dayMap[key]) dayMap[key] = { date: key, orders: [], sales: 0, delivered: 0, cancelled: 0, rejected: 0 }
      const s = String(o.orderStatus || o.status || "").toLowerCase()
      dayMap[key].orders.push(o)
      if (s.includes("deliver") && !s.includes("out")) {
        dayMap[key].delivered++
        // The restaurant's own sales, as above: its menu and its packaging,
        // not the customer's grand total.
        dayMap[key].sales += Number(
          o.restaurantPayout
            ? Number(o.restaurantPayout.subTotal || 0) + Number(o.restaurantPayout.packagingCharge || 0)
            : (o.pricing?.subtotal ?? o.totalPrice ?? 0),
        ) || 0
      }
      if (s.includes("cancel")) dayMap[key].cancelled++
      if (s.includes("reject")) dayMap[key].rejected++
    })

    const daysDetails = Object.values(dayMap)
      .map((d) => ({
        ...d,
        totalOrders: d.orders.length,
        // Each day's real commission and payout, per order -- never a flat
        // percentage of the day's sales.
        commission: d.orders.reduce(
          (sum, o) => sum + (Number(o.restaurantPayout?.commissionAmount ?? o.pricing?.restaurantCommission ?? 0) || 0),
          0,
        ),
        discounts: d.orders.reduce(
          (sum, o) => sum + (Number(o.restaurantPayout?.discountFundedByRestaurant ?? 0) || 0),
          0,
        ),
        netPayout: d.orders.reduce((sum, o) => {
          const payout = o.restaurantPayout;
          if (payout) return sum + (Number(payout.payout) || 0);
          const food = Number(o.pricing?.commissionableAmount ?? o.pricing?.subtotal ?? 0);
          return sum + food - Number(o.pricing?.restaurantCommission || 0);
        }, 0),
        deliveryPct: d.orders.length > 0 ? Math.round(d.orders.filter((o) => o.deliveryAddress).length / d.orders.length * 100) : 100,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))

    // Trend chart (by sub-periods)
    const trendData = buildTrendData(orders, periodType, activePeriod)

    return {
      total, statusBuckets, grossSales, discounts, commission, tax, netPayout, avgOrderValue,
      deliveryPct, diningPct: 100 - deliveryPct, deliveryCount, diningCount,
      uniqueCustomers, repeatCustomers, newCustomers, repeatRate,
      daysDetails, trendData
    }
  }, [periodOrders, isDemo, periodType, activePeriod])

  const toggleDay = (d) => setExpandedDay(expandedDay === d ? null : d)

  // ── Period type tabs ─────────────────────────────────────────────────────
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
          <span className={`text-[10px] font-bold px-3 py-1 rounded-full border ${isDemo ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
            {isDemo ? "Demo Data" : "● Live Analytics"}
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">

        {/* ── PERIOD SELECTOR ─────────────────────────────────────────────── */}
        <div className="bg-white px-4 py-3.5 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-3">
          {/* Week / Month / Year toggle buttons — tap opens bottom sheet */}
          {PERIOD_TYPES.map((pt) => (
            <button
              key={pt.id}
              onClick={() => {
                if (periodType !== pt.id) {
                  // Switching type: reset index, open picker
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

        {/* Selected period chip */}
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

        {/* Bottom sheet picker */}
        <PeriodPickerSheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          tabs={periodTabs}
          activeTab={String(periodIndex)}
          periodType={periodType}
          onChange={(id) => { setPeriodIndex(Number(id)); setExpandedDay(null) }}
        />

        {/* ── KPI CARDS ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <KPICard icon={DollarSign} iconBg="bg-orange-50" iconColor="text-[#ff6d00]" label="Total Sales" value={fmt(metrics.grossSales)} trend="+12.4%" trendUp />
          <KPICard icon={ShoppingBag} iconBg="bg-blue-50" iconColor="text-blue-600" label="Orders" value={metrics.total} trend="+8.1%" trendUp />
          <KPICard icon={TrendingUp} iconBg="bg-purple-50" iconColor="text-purple-600" label="Avg. Order Value" value={fmt(metrics.avgOrderValue)} trend="+3.2%" trendUp />
          <KPICard icon={Star} iconBg="bg-yellow-50" iconColor="text-yellow-500" label="Net Payout" value={fmt(metrics.netPayout)} trend="+9.7%" trendUp />
        </div>

        {/* ── ORDER STATUS ANALYTICS ──────────────────────────────────────── */}
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

          {/* Quick stat chips — clickable, navigate with status filter */}
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

          {/* Delivery success rate — clickable */}
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

        {/* ── TREND CHART ─────────────────────────────────────────────────── */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <SectionHeader icon={BarChart2} title="Sales Trend" sub="Revenue over time" />
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
                    transition={{ type: "spring", stiffness: 80, delay: idx * 0.04 }}
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

        {/* ── ORDER DATE-WISE DETAILS ACCORDION ───────────────────────────── */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <SectionHeader icon={Calendar} title="Daily Order Breakdown" sub="Tap a date to see full order details" />
          {loading ? (
            <div className="py-8 text-center text-xs text-gray-400 font-semibold animate-pulse">Loading order data…</div>
          ) : metrics.daysDetails.length === 0 ? (
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

                            {/* Delivery success + mini order statuses */}
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

                            {/* Financials */}
                            <div className="bg-gray-50/50 p-3.5 rounded-xl border border-gray-100 space-y-1">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Financial Details</span>
                              <StatRow label="Gross Sales" value={fmt(day.sales)} right={fmt(day.sales)} />
                              <StatRow label="Discounts" right={`- ${fmt(day.discounts)}`} rightColor="text-red-500" />
                              <StatRow label="Platform Commission" right={`- ${fmt(day.commission)}`} rightColor="text-red-500" />
                              <div className="border-t border-gray-200 pt-2 mt-2">
                                <StatRow label="Net Payout" right={fmt(day.netPayout)} rightColor="text-green-600" />
                              </div>
                            </div>

                            {/* Fulfillment split */}
                            <div className="bg-gray-50/50 p-3.5 rounded-xl border border-gray-100">
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Fulfillment Split</span>
                              <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden flex text-[9px] font-bold text-white">
                                <div style={{ width: `${day.deliveryPct}%` }} className="bg-[#ff6d00] flex items-center justify-center">
                                  {day.deliveryPct > 20 ? `${day.deliveryPct}%` : ""}
                                </div>
                                <div style={{ width: `${100 - day.deliveryPct}%` }} className="bg-sky-500 flex items-center justify-center">
                                  {(100 - day.deliveryPct) > 20 ? `${100 - day.deliveryPct}%` : ""}
                                </div>
                              </div>
                              <div className="flex justify-between mt-1.5 text-[10px] font-semibold text-gray-400">
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#ff6d00]" />Delivery {day.deliveryPct}%</span>
                                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" />Dining {100 - day.deliveryPct}%</span>
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

        {/* ── DELIVERY ANALYTICS ──────────────────────────────────────────── */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <SectionHeader icon={Truck} title="Delivery Analytics" sub="Delivery performance & split" />

          <div className="mt-4 h-5 w-full bg-gray-100 rounded-full overflow-hidden flex text-[10px] font-bold text-white">
            <div style={{ width: `${metrics.deliveryPct}%` }} className="bg-[#ff6d00] flex items-center justify-center transition-all duration-700">
              {metrics.deliveryPct > 18 ? `${metrics.deliveryPct}% Delivery` : ""}
            </div>
            <div style={{ width: `${metrics.diningPct}%` }} className="bg-sky-500 flex items-center justify-center transition-all duration-700">
              {metrics.diningPct > 18 ? `${metrics.diningPct}% Dining` : ""}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
            {[
              { label: "Home Delivery Orders", val: metrics.deliveryCount, color: "bg-orange-50 border-orange-100", tColor: "text-[#ff6d00]" },
              { label: "Dine-in / Takeaway", val: metrics.diningCount, color: "bg-sky-50 border-sky-100", tColor: "text-sky-600" },
              { label: "Delivery Revenue", val: fmt(Math.round(metrics.grossSales * metrics.deliveryPct / 100)), color: "bg-green-50 border-green-100", tColor: "text-green-700" },
              { label: "Dining Revenue", val: fmt(Math.round(metrics.grossSales * metrics.diningPct / 100)), color: "bg-purple-50 border-purple-100", tColor: "text-purple-700" },
            ].map(({ label, val, color, tColor }) => (
              <div key={label} className={`p-3 rounded-xl border ${color}`}>
                <p className={`text-sm font-black ${tColor}`}>{val}</p>
                <p className="text-gray-500 font-semibold text-[10px] mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Avg delivery value metric */}
          <div className="mt-3 p-3.5 rounded-2xl bg-orange-50 border border-orange-100 flex justify-between items-center">
            <div>
              <p className="text-xs font-bold text-orange-700">Avg Delivery Order Value</p>
              <p className="text-[10px] text-orange-500 font-medium">vs dining avg value</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-black text-orange-700">{fmt(metrics.avgOrderValue)}</p>
            </div>
          </div>
        </div>

        {/* ── COST BREAKDOWN ──────────────────────────────────────────────── */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <SectionHeader icon={DollarSign} title="Cost Breakdown" sub="Revenues, commissions & net payout" />
          <div className="mt-4 space-y-3">
            {[
              { label: "Gross Sales", val: fmt(metrics.grossSales), color: "text-gray-900" },
              { label: "Your own offers", val: `- ${fmt(metrics.discounts)}`, color: "text-red-500" },
              { label: "Platform Commission", val: `- ${fmt(metrics.commission)}`, color: "text-red-500" },
              { label: "GST collected from customers", val: fmt(metrics.tax), color: "text-gray-700" },
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

        {/* ── CUSTOMER RETENTION ──────────────────────────────────────────── */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
          <SectionHeader icon={Users} title="Customer Retention" sub="New vs. repeating customers" />
          <div className="flex items-center gap-6 py-3 mt-1">
            {/* Ring */}
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
            {/* Stats */}
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
function KPICard({ icon: Icon, iconBg, iconColor, label, value, trend, trendUp }) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
      <div className="flex justify-between items-start mb-2">
        <div className={`p-2 rounded-xl ${iconBg} ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${trendUp ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
          {trendUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {trend}
        </span>
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-400">{label}</p>
        <h3 className="text-xl font-bold text-gray-950 mt-0.5">{value}</h3>
      </div>
    </div>
  )
}

// ─── Build trend sub-period data ──────────────────────────────────────────────
function buildTrendData(orders, periodType, activePeriod) {
  if (!activePeriod) return []

  if (periodType === "week") {
    // Day by day (Mon-Sun)
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    const dayTotals = Array(7).fill(0)
    orders.forEach((o) => {
      const dayIdx = (new Date(o.createdAt).getDay() + 6) % 7 // Mon=0
      const amt = Number(o.pricing?.total || o.totalPrice || 0)
      dayTotals[dayIdx] += amt
    })
    return days.map((label, i) => ({ label, value: dayTotals[i] }))
  }

  if (periodType === "month") {
    // Week 1 – 4/5
    const weeks = [0, 0, 0, 0, 0]
    orders.forEach((o) => {
      const day = new Date(o.createdAt).getDate()
      const wk = Math.min(Math.floor((day - 1) / 7), 4)
      weeks[wk] += Number(o.pricing?.total || o.totalPrice || 0)
    })
    return ["Wk 1", "Wk 2", "Wk 3", "Wk 4", "Wk 5"].map((label, i) => ({ label, value: weeks[i] })).filter((_, i) => i < 4 || weeks[4] > 0)
  }

  // Year → month by month
  const months = Array(12).fill(0)
  orders.forEach((o) => {
    const m = new Date(o.createdAt).getMonth()
    months[m] += Number(o.pricing?.total || o.totalPrice || 0)
  })
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((label, i) => ({ label, value: months[i] }))
}

// ─── Mock data generator ──────────────────────────────────────────────────────
function generateMockOrders(start, end) {
  if (!start || !end) return []
  const days = Math.round((end - start) / 86400000) + 1
  const orders = []
  const statuses = ["DELIVERED", "DELIVERED", "DELIVERED", "CANCELLED", "REJECTED", "PREPARING", "OUT_FOR_DELIVERY"]

  for (let d = 0; d < days; d++) {
    const dayOrderCount = 10 + Math.floor(Math.random() * 30)
    for (let i = 0; i < dayOrderCount; i++) {
      const date = new Date(start)
      date.setDate(start.getDate() + d)
      date.setHours(8 + Math.floor(Math.random() * 14))
      const status = statuses[Math.floor(Math.random() * statuses.length)]
      const total = 80 + Math.floor(Math.random() * 400)
      orders.push({
        _id: `mock-${d}-${i}`,
        createdAt: date.toISOString(),
        orderStatus: status,
        pricing: { total, discount: status === "DELIVERED" ? Math.floor(total * 0.05) : 0 },
        deliveryAddress: Math.random() > 0.2 ? { address: "Some Street" } : null,
        userId: { _id: `user-${Math.floor(Math.random() * 80)}` },
      })
    }
  }
  return orders
}
