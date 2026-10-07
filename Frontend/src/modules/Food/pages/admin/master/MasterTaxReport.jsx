import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { masterReportsAPI, saveBlobResponse } from "@food/api/masterAnalytics"
import { SERVICE_PROVIDER_ENABLED } from "@/config/features"
import {
  Card, DataTable, Figure, RangeBar, VerticalSelect, ZoneSelect, count, errorText, ghostCls, inputCls, rupees, useRange,
} from "./masterKit"

/**
 * Master > Tax: one GST report across Food, Quick Commerce, Taxi and Services
 * (core/analytics/tax.service.js). Taxi's GST is worked out from the fare at the
 * ride's rate; rides booked before the rate was recorded are marked estimated.
 */
export default function MasterTaxReport() {
  const range = useRange("90")
  const [vertical, setVertical] = useState("all")
  const [zoneId, setZoneId] = useState("")
  const [group, setGroup] = useState("month")
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [exporting, setExporting] = useState("")

  const params = { ...range.range, vertical, group, ...(zoneId ? { zoneId } : {}) }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await masterReportsAPI.gst({ ...range.range, vertical, group, ...(zoneId ? { zoneId } : {}) })
      setReport(res?.data?.data || null)
    } catch (err) {
      setReport(null)
      setError(errorText(err, "Could not load the GST report."))
    } finally {
      setLoading(false)
    }
  }, [range.range, vertical, group, zoneId])

  useEffect(() => { load() }, [load])
  useEffect(() => { setZoneId("") }, [vertical])

  const doExport = async (format) => {
    setExporting(format)
    try {
      saveBlobResponse(await masterReportsAPI.exportGst({ ...params, format }), `gst-report.${format}`)
    } catch (err) {
      toast.error(errorText(err, "Could not export the report."))
    } finally {
      setExporting("")
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">GST report</h1>
          <p className="mt-1 text-sm text-neutral-600">GST on completed orders, rides and paid service bills, for every service you have Reports access for.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RangeBar state={range} />
          <VerticalSelect value={vertical} onChange={setVertical} />
          <ZoneSelect vertical={vertical} value={zoneId} onChange={setZoneId} />
          <select aria-label="Group by" className={inputCls} value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="month">By month</option>
            <option value="day">By day</option>
          </select>
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Figure strong label="GST" value={rupees(report.totals.gst)} hint={`${count(report.totals.invoices)} invoices`} />
              {report.summary.map((s) => (
                <Figure key={s.vertical} label={s.label} value={rupees(s.gst)} hint={`${s.basis}${s.estimated ? ` · ${count(s.estimated)} estimated` : ""}`} />
              ))}
            </div>
            <Card title="GST by period and service">
              <DataTable columns={report.columns} rows={report.rows} />
            </Card>
            <ul className="list-disc space-y-1 pl-5 text-xs text-neutral-500">
              {report.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link to="/admin/food/tax-report" className={ghostCls}>Food tax report</Link>
              <Link to="/admin/quick-commerce/tax-report" className={ghostCls}>Quick tax report</Link>
              {SERVICE_PROVIDER_ENABLED && <Link to="/admin/sp/reports" className={ghostCls}>Services GSTR &amp; TDS</Link>}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
