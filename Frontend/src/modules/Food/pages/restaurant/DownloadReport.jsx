import { useMemo, useState } from "react"
import { ArrowLeft, Download, FileText, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { restaurantAPI } from "@food/api"
import { saveBlobResponse, blobErrorMessage, isoDay } from "@food/utils/downloadFile"

/*
 * Reports are generated on the server (GET /food/restaurant/reports) from the
 * orders and the payout ledger, for the date range picked here, as CSV or PDF.
 */
const REPORT_TYPES = [
  { id: "orders", label: "Orders", hint: "Every order with its GST, commission, discount and payout" },
  { id: "sales", label: "Sales summary", hint: "Orders, sales, GST, commission and payout per day / week / month" },
  { id: "commission", label: "Commission", hint: "Commission charged on each delivered order" },
  { id: "gst", label: "GST", hint: "Taxable value with CGST / SGST per delivered order" },
  { id: "payouts", label: "Payouts", hint: "Withdrawals and settlements in the period" },
]

const GROUPS = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
]

const DURATIONS = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
  { id: "custom", label: "Custom range" },
]

export default function DownloadReport() {
  const goBack = useRestaurantBackNavigation()
  const [type, setType] = useState("orders")
  const [groupBy, setGroupBy] = useState("day")
  const [duration, setDuration] = useState("30")
  const today = isoDay(new Date())
  const [customFrom, setCustomFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86400000)))
  const [customTo, setCustomTo] = useState(today)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const range = useMemo(() => {
    if (duration === "custom") return { from: customFrom, to: customTo }
    const days = DURATIONS.find((d) => d.id === duration)?.days || 30
    return { from: isoDay(new Date(Date.now() - (days - 1) * 86400000)), to: today }
  }, [duration, customFrom, customTo, today])

  const download = async (format) => {
    setError("")
    if (!range.from || !range.to || range.from > range.to) {
      setError("Choose a start date on or before the end date.")
      return
    }
    setBusy(format)
    try {
      const params = { type, format, from: range.from, to: range.to }
      if (type === "sales") params.groupBy = groupBy
      const res = await restaurantAPI.downloadReport(params)
      saveBlobResponse(res, `${type}-report_${range.from}_to_${range.to}.${format}`)
    } catch (err) {
      setError(await blobErrorMessage(err, "Could not generate the report. Please try again."))
    } finally {
      setBusy("")
    }
  }

  const card = "bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3"
  const choice = (selected) =>
    `flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
      selected ? "bg-gray-50 border-gray-900 shadow-sm ring-1 ring-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"
    }`

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <button
            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
            onClick={goBack}
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-gray-900">Download Reports</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Orders, sales, commission, GST and payouts as CSV or PDF</p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">1. Report</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {REPORT_TYPES.map((opt) => (
              <label key={opt.id} className={choice(type === opt.id)}>
                <input
                  type="radio"
                  name="reportType"
                  value={opt.id}
                  checked={type === opt.id}
                  onChange={() => setType(opt.id)}
                  className="w-4 h-4 accent-black shrink-0"
                />
                <span>
                  <span className="block text-sm font-bold text-gray-900">{opt.label}</span>
                  <span className="block text-[11px] text-gray-500">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {type === "sales" && (
          <div className={card}>
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Group by</h2>
            <div className="grid grid-cols-3 gap-2 bg-gray-100 p-1.5 rounded-2xl text-center text-xs font-bold">
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupBy(g.id)}
                  className={`py-2.5 rounded-xl transition-all ${groupBy === g.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">2. Period</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {DURATIONS.map((opt) => (
              <label key={opt.id} className={choice(duration === opt.id)}>
                <input
                  type="radio"
                  name="duration"
                  value={opt.id}
                  checked={duration === opt.id}
                  onChange={() => setDuration(opt.id)}
                  className="w-4 h-4 accent-black"
                />
                <span className="text-xs font-bold text-gray-900">{opt.label}</span>
              </label>
            ))}
          </div>
          {duration === "custom" && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="text-xs font-semibold text-gray-600">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || today}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-semibold text-gray-600">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={today}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          )}
          <p className="text-[11px] text-gray-500">
            {range.from} to {range.to} (Indian time). Up to 12 months per report.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => download("csv")}
            disabled={Boolean(busy)}
            className="w-full bg-white border border-gray-900 text-gray-900 hover:bg-gray-50 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {busy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            <span>Download CSV</span>
          </button>
          <button
            type="button"
            onClick={() => download("pdf")}
            disabled={Boolean(busy)}
            className="w-full bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
          >
            {busy === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            <span>Download PDF</span>
          </button>
        </div>
        <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
          <Download className="w-3 h-3" /> The file is generated from your orders and payout ledger when you download it.
        </p>
      </div>
    </div>
  )
}
