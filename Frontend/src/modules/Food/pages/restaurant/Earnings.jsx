import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { restaurantAPI } from "@food/api"

/*
 * Earnings, day by day: what the outlet earned from delivered orders, with
 * orders, sales and commission beside it. Serves restaurants, stores and
 * medical stores alike (requests go to /food or /qc as signed in).
 */

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
]

const BAR = "#059669" // one series: emerald, the money colour of this page

const inr = (n, { compact = false } = {}) => {
  const value = Number(n) || 0
  if (compact && Math.abs(value) >= 1000) {
    return `₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`
  }
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

const dayLabel = (iso, opts = { day: "numeric", month: "short" }) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", ...opts })

function StatTile({ label, data, emphasis = false }) {
  return (
    <div className={`rounded-xl border p-4 ${emphasis ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{inr(data?.earnings)}</p>
      <p className="mt-1 text-xs text-gray-500 tabular-nums">
        {data?.orders || 0} {data?.orders === 1 ? "order" : "orders"} · sales {inr(data?.sales)}
      </p>
    </div>
  )
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-gray-900">{dayLabel(d.date, { weekday: "short", day: "numeric", month: "short" })}</p>
      <p className="mt-1 text-gray-700 tabular-nums">Earned <b>{inr(d.earnings)}</b></p>
      <p className="text-gray-500 tabular-nums">{d.orders} orders · sales {inr(d.sales)}</p>
      {d.cancelled > 0 && <p className="text-gray-500 tabular-nums">{d.cancelled} cancelled</p>}
    </div>
  )
}

export default function Earnings() {
  const goBack = useRestaurantBackNavigation()
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await restaurantAPI.getDailyEarnings(days)
      setData(res?.data?.data || null)
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load your earnings. Try again.")
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  const daily = data?.daily || []
  const s = data?.summary || {}
  // Newest first in the table; the chart reads left to right in time.
  const tableRows = useMemo(() => [...daily].reverse(), [daily])
  const best = useMemo(
    () => daily.reduce((top, d) => (d.earnings > (top?.earnings ?? 0) ? d : top), null),
    [daily],
  )
  const tickEvery = days <= 7 ? 0 : days <= 30 ? 4 : 13

  return (
    <div className="min-h-screen bg-gray-100 pb-28">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3.5 sm:px-6">
          <button type="button" onClick={goBack} aria-label="Go back" className="rounded-full p-1.5 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-800" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-gray-900">Earnings</h1>
            <p className="text-xs text-gray-500">From delivered orders, by day (India time)</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            aria-label="Refresh"
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{" "}
            <button type="button" onClick={load} className="font-semibold underline">Retry</button>
          </div>
        )}

        {!data && loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-gray-500" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Today" data={s.today} emphasis />
              <StatTile label="Yesterday" data={s.yesterday} />
              <StatTile label="Last 7 days" data={s.last7Days} />
              <StatTile label="This month" data={s.thisMonth} />
            </div>

            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Earned per day</h2>
                  <p className="text-xs text-gray-500 tabular-nums">
                    {inr(s.range?.earnings)} over {days} days · {s.range?.orders || 0} orders
                    {best && best.earnings > 0 ? ` · best day ${dayLabel(best.date)} (${inr(best.earnings)})` : ""}
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5" role="group" aria-label="Date range">
                  {RANGES.map((r) => (
                    <button
                      key={r.days}
                      type="button"
                      onClick={() => setDays(r.days)}
                      aria-pressed={days === r.days}
                      className={`rounded-md px-3 py-1 text-xs font-semibold ${
                        days === r.days ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={days > 30 ? 1 : 4}>
                    <CartesianGrid vertical={false} stroke="#e5e7eb" strokeDasharray="0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => dayLabel(v)}
                      interval={tickEvery}
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={{ stroke: "#d1d5db" }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => inr(v, { compact: true })}
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                      axisLine={false}
                      tickLine={false}
                      width={56}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(5,150,105,0.08)" }} />
                    <Bar dataKey="earnings" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Day by day</h2>
                <p className="text-xs text-gray-500">Commission is what the platform keeps</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5 text-right">Orders</th>
                      <th className="px-4 py-2.5 text-right">Cancelled</th>
                      <th className="px-4 py-2.5 text-right">Sales</th>
                      <th className="px-4 py-2.5 text-right">Commission</th>
                      <th className="px-4 py-2.5 text-right">You earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 tabular-nums">
                    {tableRows.map((d) => (
                      <tr key={d.date} className={d.orders === 0 && d.cancelled === 0 ? "text-gray-400" : "text-gray-800"}>
                        <td className="whitespace-nowrap px-4 py-2.5">{dayLabel(d.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                        <td className="px-4 py-2.5 text-right">{d.orders}</td>
                        <td className="px-4 py-2.5 text-right">{d.cancelled || "–"}</td>
                        <td className="px-4 py-2.5 text-right">{inr(d.sales)}</td>
                        <td className="px-4 py-2.5 text-right">{inr(d.commission)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{inr(d.earnings)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900 tabular-nums">
                    <tr>
                      <td className="px-4 py-2.5">{days} days</td>
                      <td className="px-4 py-2.5 text-right">{s.range?.orders || 0}</td>
                      <td className="px-4 py-2.5 text-right">{s.range?.cancelled || 0}</td>
                      <td className="px-4 py-2.5 text-right">{inr(s.range?.sales)}</td>
                      <td className="px-4 py-2.5 text-right">{inr(s.range?.commission)}</td>
                      <td className="px-4 py-2.5 text-right">{inr(s.range?.earnings)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <p className="px-1 text-xs text-gray-500">
              Orders still being prepared or on the way show up once delivered. Payouts and withdrawals are on the Payouts page.
            </p>
          </>
        ) : null}
      </div>
    </div>
  )
}
