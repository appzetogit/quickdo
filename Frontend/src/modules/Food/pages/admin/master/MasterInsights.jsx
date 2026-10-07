import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { masterInsightsAPI } from "@food/api/masterAnalytics"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"
import { Card, DataTable, Figure, count, errorText, ghostCls, inputCls, niceDay, rupees, verticalMeta } from "./masterKit"

/**
 * Master > Insights (core/analytics/insights.service.js). Computed every night
 * from order history, without an external model:
 *   - forecast of daily orders and revenue for the next 14 days, per service and zone
 *   - expected orders per zone for the coming hours, for placing riders and drivers
 *   - items customers often buy together, which the apps use for recommendations
 */

const SERVICES = ["food", "quickCommerce", "taxi", ...(SERVICE_PROVIDER_ENABLED ? ["serviceProvider"] : [])]

function ForecastCard() {
  const [vertical, setVertical] = useState("food")
  const [zoneId, setZoneId] = useState("all")
  const [metric, setMetric] = useState("orders")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setZoneId("all") }, [vertical])
  useEffect(() => {
    let alive = true
    setLoading(true)
    masterInsightsAPI.forecast({ vertical, zoneId })
      .then((res) => { if (alive) setData(res?.data?.data || null) })
      .catch((err) => { if (alive) { setData(null); toast.error(errorText(err, "Could not load the forecast")) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [vertical, zoneId])

  const rows = [
    ...(data?.history || []).map((h) => ({ label: niceDay(h.date), actual: h[metric] })),
    ...(data?.forecast || []).map((f) => ({
      label: niceDay(f.date),
      forecast: f[metric],
      band: [f[`${metric}Low`], f[`${metric}High`]],
    })),
  ]
  const fmt = metric === "revenue" ? rupees : (v) => count(Math.round(v * 10) / 10)

  return (
    <Card
      title="Forecast: next 14 days"
      action={(
        <div className="flex flex-wrap gap-2">
          <select aria-label="Service" className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value)}>
            {SERVICES.map((v) => <option key={v} value={v}>{verticalMeta(v).label}</option>)}
          </select>
          <select aria-label="Zone" className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            <option value="all">All zones</option>
            {(data?.zones || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          <select aria-label="Measure" className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="orders">Orders</option>
            <option value="revenue">Revenue</option>
          </select>
        </div>
      )}
    >
      {loading ? (
        <div className="flex h-64 items-center justify-center text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : !data?.forecast?.length ? (
        <p className="py-10 text-center text-sm text-neutral-500">No forecast yet. It is computed every night after 2 am, or with Recompute.</p>
      ) : (
        <>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
                <YAxis fontSize={11} width={60} tickFormatter={(v) => (metric === "revenue" ? `₹${Number(v).toLocaleString("en-IN")}` : v)} />
                <Tooltip formatter={(v) => (Array.isArray(v) ? `${fmt(v[0])} – ${fmt(v[1])}` : fmt(v))} />
                <Legend />
                <Area dataKey="band" name="Likely range" stroke="none" fill={verticalMeta(vertical).color} fillOpacity={0.15} />
                <Line dataKey="actual" name="Actual" stroke="#171717" strokeWidth={2} dot={false} />
                <Line dataKey="forecast" name="Forecast" stroke={verticalMeta(vertical).color} strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Next 7 days: {count(Math.round(data.next7?.orders || 0))} orders, {rupees(data.next7?.revenue)} (last 7 days: {count(data.last7?.orders)} orders, {rupees(data.last7?.revenue)}).
            {" "}Method: {data.method === "holt_winters" ? "seasonal smoothing (Holt-Winters, weekly)" : data.method === "seasonal_average" ? "same weekday average" : "average"}
            {data.mape !== null && data.mape !== undefined ? `, typical error ${data.mape}%` : ""}. Based on {data.historyDays} days.
          </p>
        </>
      )}
    </Card>
  )
}

function DemandCard() {
  const [vertical, setVertical] = useState("food")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    masterInsightsAPI.demand({ vertical, hours: 12 })
      .then((res) => { if (alive) setData(res?.data?.data || null) })
      .catch(() => { if (alive) setData(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [vertical])
  const max = Math.max(1, ...(data?.zones || []).flatMap((z) => z.hours.map((h) => h.expected)))
  return (
    <Card
      title="Expected orders per zone, next 12 hours"
      action={(
        <select aria-label="Service" className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value)}>
          {["food", "quickCommerce", "taxi"].map((v) => <option key={v} value={v}>{verticalMeta(v).label}</option>)}
        </select>
      )}
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /></div>
      ) : !data?.zones?.length ? (
        <p className="py-6 text-center text-sm text-neutral-500">No demand profile yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Zone</th>
                <th className="px-2 py-1 text-right">Next hour</th>
                <th className="px-2 py-1 text-right">12 hours</th>
                <th className="px-2 py-1">By hour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.zones.slice(0, 20).map((z) => (
                <tr key={z.zoneId}>
                  <td className="whitespace-nowrap px-2 py-2">{z.name}{z.trendFactor !== 1 && <span className="ml-1 text-xs text-neutral-500">({z.trendFactor > 1 ? "+" : ""}{Math.round((z.trendFactor - 1) * 100)}% lately)</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{z.nextHour}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{z.total}</td>
                  <td className="px-2 py-2">
                    <div className="flex h-8 items-end gap-0.5">
                      {z.hours.map((h) => (
                        <div
                          key={h.at}
                          title={`${new Date(h.at).toLocaleTimeString("en-IN", { hour: "numeric" })}: ${h.expected}`}
                          className="w-2.5 rounded-sm"
                          style={{ height: `${Math.max(4, (h.expected / max) * 100)}%`, background: verticalMeta(vertical).color, opacity: h.expected ? 1 : 0.25 }}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-500">Average of the same hour over the last 8 weeks, scaled by the last 2. Rider and driver apps read it from /v1/platform/recommendations/demand.</p>
        </div>
      )}
    </Card>
  )
}

function PairsCard() {
  const [vertical, setVertical] = useState("food")
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    masterInsightsAPI.pairs({ vertical, limit: 25 })
      .then((res) => { if (alive) setData(res?.data?.data || null) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [vertical])
  const rows = (data?.pairs || []).map((p) => ({ a: p.a.name || p.a.id, b: p.b.name || p.b.id, count: p.count, confidence: Math.round(p.confidence * 1000) / 10, lift: p.lift }))
  return (
    <Card
      title="Often bought together"
      action={(
        <select aria-label="Service" className={inputCls} value={vertical} onChange={(e) => setVertical(e.target.value)}>
          {["food", "quickCommerce"].map((v) => <option key={v} value={v}>{verticalMeta(v).label}</option>)}
        </select>
      )}
    >
      <DataTable
        columns={[
          { key: "a", label: "Item" }, { key: "b", label: "Bought with" }, { key: "count", label: "Orders", type: "number" },
          { key: "confidence", label: "How often", type: "percent" }, { key: "lift", label: "Lift", type: "number" },
        ]}
        rows={rows}
        empty="No pairs yet (an item pair needs at least two orders)."
      />
      <p className="mt-2 text-xs text-neutral-500">From completed orders in the last 90 days. Apps read it from /v1/platform/recommendations/together and /popular.</p>
    </Card>
  )
}

export default function MasterInsights() {
  const [summary, setSummary] = useState(null)
  const [recomputing, setRecomputing] = useState(false)
  const [key, setKey] = useState(0)

  const loadSummary = useCallback(async () => {
    try {
      const res = await masterInsightsAPI.summary()
      setSummary(res?.data?.data || null)
    } catch (err) {
      toast.error(errorText(err, "Could not load insights"))
    }
  }, [])
  useEffect(() => { loadSummary() }, [loadSummary])

  const recompute = async () => {
    setRecomputing(true)
    try {
      await masterInsightsAPI.recompute()
      toast.success("Insights recomputed")
      await loadSummary()
      setKey((k) => k + 1)
    } catch (err) {
      toast.error(errorText(err, "Could not recompute insights"))
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Insights</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Forecasts, demand by zone and buying patterns, worked out every night from order history.
              {summary?.lastRun ? ` Last run ${new Date(summary.lastRun.finishedAt).toLocaleString("en-IN")}.` : " Not run yet."}
            </p>
          </div>
          <button type="button" className={ghostCls} onClick={recompute} disabled={recomputing}>
            {recomputing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recompute now
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {summary.verticals.map((v) => (
              <Figure
                key={v.key}
                label={`${v.label}: next 7 days`}
                value={v.next7 ? `${count(Math.round(v.next7.orders))} orders` : "-"}
                hint={v.next7 ? `${rupees(v.next7.revenue)} · last 7 days ${count(v.last7?.orders)}` : "No forecast yet"}
              />
            ))}
          </div>
        )}

        <div key={key} className="space-y-5">
          <ForecastCard />
          <div className="grid gap-5 lg:grid-cols-2">
            <DemandCard />
            <PairsCard />
          </div>
        </div>
      </div>
    </div>
  )
}
