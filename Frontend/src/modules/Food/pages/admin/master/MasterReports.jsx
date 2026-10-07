import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { masterReportsAPI, saveBlobResponse } from "@food/api/masterAnalytics"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"
import {
  Card, DataTable, Figure, RangeBar, VerticalSelect, ZoneSelect, count, errorText, ghostCls, niceDay, rupees, useRange, verticalMeta,
} from "./masterKit"

/**
 * Master > Reports: sales, revenue, customers, vendors, drivers and providers
 * across every service, filtered by service, zone and date, exportable as CSV
 * or Excel (core/analytics/reports.service.js).
 */

const KINDS = [
  { key: "sales", label: "Sales" },
  { key: "revenue", label: "Revenue" },
  { key: "customers", label: "Customers" },
  { key: "vendors", label: "Vendors" },
  { key: "drivers", label: "Drivers & riders" },
  ...(SERVICE_PROVIDER_ENABLED ? [{ key: "providers", label: "Service providers" }] : []),
]

function Summary({ kind, report }) {
  const s = report.summary
  if (kind === "customers" && s) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure label="Customers who ordered" value={count(s.customers)} />
        <Figure label="New" value={count(s.newCustomers)} hint="First order ever in this range" />
        <Figure label="Returning" value={count(s.returningCustomers)} hint={`${s.returningRate}% of customers`} />
        <Figure strong label="Average lifetime value" value={rupees(s.averageLifetimeValue)} hint={`${s.averageOrders} orders each`} />
      </div>
    )
  }
  if ((kind === "sales") && Array.isArray(s)) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {s.map((v) => (
          <Figure key={v.vertical} label={v.label} value={rupees(v.revenue)} hint={`${count(v.completed)} completed of ${count(v.orders)} · ${v.cancelRate}% cancelled`} />
        ))}
      </div>
    )
  }
  if (kind === "revenue" && s) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Figure label="Revenue" value={rupees(s.revenue)} />
        <Figure label="Subscription income" value={rupees(s.subscriptionIncome)} />
        <Figure strong label="Platform earnings" value={rupees(s.platformEarnings)} />
      </div>
    )
  }
  return null
}

function Cohorts({ table }) {
  if (!table?.rows?.length) return null
  const cols = table.columns.filter((c) => c.key.startsWith("m"))
  const shade = (v) => (v === undefined || v === null ? "transparent" : `rgba(23,23,23,${Math.min(0.85, Number(v) / 100)})`)
  return (
    <Card title={table.title}>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="px-2 py-1">First order</th>
              <th className="px-2 py-1 text-right">Customers</th>
              {cols.map((c) => <th key={c.key} className="px-2 py-1 text-center">{c.label.replace("Month ", "M")}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.cohort}>
                <td className="whitespace-nowrap px-2 py-1 font-medium">{r.cohort}</td>
                <td className="px-2 py-1 text-right tabular-nums">{count(r.size)}</td>
                {cols.map((c) => (
                  <td key={c.key} className="px-0.5 py-0.5">
                    {r[c.key] === undefined ? null : (
                      <div className="w-12 rounded px-1 py-1 text-center tabular-nums" style={{ background: shade(r[c.key]), color: Number(r[c.key]) > 45 ? "#fff" : "#171717" }}>
                        {r[c.key]}%
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Of the customers whose first order was in a month, the share who ordered again 0, 1, 2… months later.</p>
    </Card>
  )
}

export default function MasterReports() {
  const { kind: kindParam } = useParams()
  const navigate = useNavigate()
  const kind = KINDS.some((k) => k.key === kindParam) ? kindParam : "sales"
  const range = useRange(kind === "customers" ? "90" : "30")
  const [vertical, setVertical] = useState("all")
  const [zoneId, setZoneId] = useState("")
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState("")

  const params = { ...range.range, vertical, ...(zoneId ? { zoneId } : {}) }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await masterReportsAPI.get(kind, { ...range.range, vertical, ...(zoneId ? { zoneId } : {}) })
      setReport(res?.data?.data || null)
    } catch (err) {
      setReport(null)
      setError(errorText(err, "Could not load the report."))
    } finally {
      setLoading(false)
    }
  }, [kind, range.range, vertical, zoneId])

  useEffect(() => { load() }, [load])
  useEffect(() => { setZoneId("") }, [vertical])

  const doExport = async (format) => {
    setExporting(format)
    try {
      const res = await masterReportsAPI.export(kind, { ...params, format })
      saveBlobResponse(res, `${kind}-report.${format}`)
    } catch (err) {
      toast.error(errorText(err, "Could not export the report."))
    } finally {
      setExporting("")
    }
  }

  const chartRows = (report?.charts?.daily || []).map((d) => ({ ...d, label: niceDay(d.date) }))
  const chartKeys = report?.verticals || []

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Reports</h1>
          <p className="mt-1 text-sm text-neutral-600">Across Food, Quick Commerce, Taxi and Services. You see the services you have Reports access for.</p>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => navigate(`/admin/master/reports/${k.key}`, { replace: true })}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${kind === k.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RangeBar state={range} />
          <VerticalSelect value={vertical} onChange={setVertical} only={kind === "providers" ? ["serviceProvider"] : undefined} />
          <ZoneSelect vertical={vertical} value={zoneId} onChange={setZoneId} />
          <div className="ml-auto flex gap-2">
            <button type="button" className={ghostCls} onClick={() => doExport("csv")} disabled={!!exporting || !report}>
              {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV
            </button>
            <button type="button" className={ghostCls} onClick={() => doExport("xlsx")} disabled={!!exporting || !report}>
              {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Excel
            </button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {loading && !report ? (
          <div className="flex items-center gap-2 py-16 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Building the report</div>
        ) : report ? (
          <>
            <Summary kind={kind} report={report} />

            {chartRows.length > 0 && (
              <Card title={kind === "revenue" ? "Platform earnings per day" : "Revenue per day"}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" />
                      <YAxis fontSize={11} width={60} tickFormatter={(v) => `₹${Number(v).toLocaleString("en-IN")}`} />
                      <Tooltip formatter={(v) => rupees(v)} />
                      <Legend />
                      {chartKeys.map((k) => (
                        <Line key={k} type="monotone" dataKey={k} name={verticalMeta(k).label} stroke={verticalMeta(k).color} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            <Card title={report.title} action={loading ? <Loader2 className="h-4 w-4 animate-spin text-neutral-400" /> : null}>
              <DataTable columns={report.columns} rows={report.rows} />
            </Card>

            {kind === "customers" && <Cohorts table={report.tables?.find((t) => t.key === "cohorts")} />}
            {(report.tables || []).filter((t) => t.key !== "cohorts").map((t) => (
              <Card key={t.key} title={t.title}><DataTable columns={t.columns} rows={t.rows} /></Card>
            ))}

            {report.notes?.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
                {report.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
