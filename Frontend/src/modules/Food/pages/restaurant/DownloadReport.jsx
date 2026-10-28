import { useState, useMemo, useEffect } from "react"
import { ArrowLeft, CheckCircle, Mail } from "lucide-react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

const REPORT_VIEWS = [
  { id: "detailed", label: "Detailed report" },
  { id: "item", label: "Item sales report" },
]

const VIEW_TYPES = ["DAILY", "WEEKLY", "MONTHLY"]

export default function DownloadReport() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const [reportView, setReportView] = useState("detailed")
  const [viewType, setViewType] = useState("DAILY")
  const durations = useMemo(() => {
    if (viewType === "WEEKLY") {
      return [
        { id: "4w", label: "Last 4 weeks" },
        { id: "8w", label: "Last 8 weeks" },
        { id: "12w", label: "Last 12 weeks" },
        { id: "custom", label: "Custom" },
      ]
    }
    if (viewType === "MONTHLY") {
      return [
        { id: "3m", label: "Last 3 months" },
        { id: "6m", label: "Last 6 months" },
        { id: "12m", label: "Last 12 months" },
        { id: "custom", label: "Custom" },
      ]
    }
    return [
      { id: "7", label: "Last 7 days" },
      { id: "14", label: "Last 14 days" },
      { id: "30", label: "Last 30 days" },
      { id: "custom", label: "Custom" },
    ]
  }, [viewType])

  const [duration, setDuration] = useState("7")
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    if (durations.length > 0 && !durations.find((d) => d.id === duration)) {
      setDuration(durations[0].id)
    }
  }, [viewType, durations, duration])

  const handleSend = () => {
    setShowSuccess(true)
    setTimeout(() => setShowSuccess(false), 2000)
  }

  return (
    <div className="min-h-screen bg-neutral-50/60 flex flex-col pb-28 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center gap-3 border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="p-2 -ml-2 rounded-xl hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
              onClick={goBack}
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-gray-900">Download Reports</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Export financial and sales activity records to spreadsheet / PDF</p>
            </div>
          </div>
          <button
            onClick={handleSend}
            className="hidden sm:inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-black text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Mail className="w-4 h-4" />
            <span>Email Report</span>
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 text-xs font-semibold text-amber-900">
          Generating unified report for <span className="font-bold">All Linked Outlets</span>
        </div>

        {/* 1. Report View */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">1. Select Report Type</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {REPORT_VIEWS.map((opt) => {
              const isSelected = reportView === opt.id
              return (
                <label
                  key={opt.id}
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected ? "bg-gray-50 border-gray-900 shadow-sm ring-1 ring-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="reportView"
                    value={opt.id}
                    checked={isSelected}
                    onChange={() => setReportView(opt.id)}
                    className="w-4 h-4 accent-black"
                  />
                  <span className="text-sm font-bold text-gray-900">{opt.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* 2. Frequency View */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">2. Aggregation Interval</h2>
          <div className="grid grid-cols-3 gap-2 bg-gray-100 p-1.5 rounded-2xl text-center text-xs font-bold">
            {VIEW_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setViewType(type)}
                className={`py-2.5 rounded-xl transition-all ${viewType === type ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Duration */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">3. Select Date Duration</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {durations.map((opt) => {
              const isSelected = duration === opt.id
              return (
                <label
                  key={opt.id}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSelected ? "bg-gray-50 border-gray-900 shadow-sm ring-1 ring-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="duration"
                    value={opt.id}
                    checked={isSelected}
                    onChange={() => setDuration(opt.id)}
                    className="w-4 h-4 accent-black"
                  />
                  <span className="text-xs font-bold text-gray-900">{opt.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        {/* Mobile Submit Button */}
        <div className="sm:hidden pt-2">
          <button
            onClick={handleSend}
            className="w-full bg-gray-900 hover:bg-black text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-all"
          >
            <Mail className="w-4 h-4" />
            <span>Send to Registered Email</span>
          </button>
        </div>
      </div>

      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-gray-200 p-5 pointer-events-auto text-center space-y-3 animate-in fade-in zoom-in duration-200">
            <CheckCircle className="w-10 h-10 text-emerald-600 mx-auto" />
            <div>
              <p className="text-base font-bold text-gray-900">Report Queued</p>
              <p className="text-xs text-gray-500 mt-1">We are generating your report and will email it to you shortly.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}






