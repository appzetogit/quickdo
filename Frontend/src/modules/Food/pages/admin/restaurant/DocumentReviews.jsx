import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileText, Loader2, RefreshCw, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Card } from "@food/components/ui/card"
import { adminAPI } from "@food/api"
import { adminPanelOf } from "@food/utils/adminPanel"

/*
 * Document change requests from outlets: restaurants (Food) and stores and
 * medical stores (quick commerce). The outlet keeps trading while a request
 * waits; approving puts the new values on file, rejecting keeps the old ones
 * and tells the outlet why. See core/sellerDocuments.js on the server.
 */

const STATUSES = [
  { key: "pending", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
]

const isImage = (f) => f.endsWith("Image")
const isDate = (f) => f.endsWith("Expiry")

const show = (field, value) => {
  if (value === true) return "Yes"
  if (value === false) return "No"
  if (value == null || value === "") return "—"
  if (isDate(field)) return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
  return String(value)
}

const when = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""

function Value({ field, value }) {
  if (isImage(field)) {
    return value ? (
      <a href={value} target="_blank" rel="noreferrer">
        <img src={value} alt="" className="h-16 w-24 rounded-md border border-gray-200 object-cover" />
      </a>
    ) : (
      <span className="inline-flex h-16 w-24 items-center justify-center rounded-md border border-dashed border-gray-300 text-gray-400">
        <FileText className="h-5 w-5" />
      </span>
    )
  }
  return <span className="break-all">{show(field, value)}</span>
}

export default function DocumentReviews() {
  const [status, setStatus] = useState("pending")
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState("")
  const [rejecting, setRejecting] = useState(null) // row
  const [reason, setReason] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    // Each panel reviews its own outlets: restaurants in Food, stores in Quick
    // Commerce, pharmacies in Medical (the same store API, narrowed here).
    const panel = adminPanelOf()
    try {
      const res = await adminAPI.getDocumentReviews(panel.vertical, status)
      const next = (res?.data?.data?.reviews || [])
        .filter((row) => !panel.pharmacyOnly || row.storeType === "pharmacy")
        .map((row) => ({ ...row, vertical: panel.vertical }))
      setRows(next)
    } catch {
      toast.error("Could not load document reviews")
      setRows([])
    }
    setLoading(false)
  }, [status])

  useEffect(() => {
    load()
  }, [load])

  const typeOf = (row) =>
    row.vertical === "food" ? "Restaurant" : row.storeType === "pharmacy" ? "Medical store" : "Store"

  const approve = async (row) => {
    if (!window.confirm(`Put ${row.name}'s new documents on file?`)) return
    setBusyId(row.id)
    try {
      await adminAPI.approveDocumentReview(row.vertical, row.id)
      toast.success(`Approved ${row.name}'s documents`)
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not approve")
    } finally {
      setBusyId("")
    }
  }

  const reject = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      toast.error("Give a reason so the outlet knows what to fix")
      return
    }
    const row = rejecting
    setBusyId(row.id)
    try {
      await adminAPI.rejectDocumentReview(row.vertical, row.id, reason.trim())
      toast.success(`Rejected ${row.name}'s change`)
      setRejecting(null)
      setReason("")
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not reject")
    } finally {
      setBusyId("")
    }
  }

  const count = rows.length
  const title = useMemo(() => STATUSES.find((s) => s.key === status)?.label || "", [status])

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">Document reviews</h1>
          <p className="text-sm text-gray-500">
            PAN, GST, FSSAI and drug licence changes sent by {adminPanelOf().vertical === "food" ? "restaurants" : adminPanelOf().pharmacyOnly ? "medical stores" : "stores"}. They keep taking orders while they wait.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatus(s.key)}
                aria-pressed={status === s.key}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === s.key ? "bg-[#006fbd] text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={load} aria-label="Refresh" className="rounded-lg border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#006fbd]" /></div>
      ) : count === 0 ? (
        <Card className="border border-gray-200 p-10 text-center text-sm text-gray-500">No {title.toLowerCase()} document changes.</Card>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const changes = row.review?.changes || {}
            const previous = row.review?.previous || {}
            const fields = Object.keys(changes)
            return (
              <Card key={`${row.vertical}-${row.id}`} className="border border-gray-200 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{row.name || "Unnamed outlet"}</h2>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{typeOf(row)}</span>
                      {row.outletStatus && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Outlet {row.outletStatus}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {[row.ownerName, row.ownerPhone].filter(Boolean).join(" · ")} · sent {when(row.review?.requestedAt)}
                      {row.review?.reviewedAt ? ` · reviewed ${when(row.review.reviewedAt)}` : ""}
                    </p>
                    {row.review?.status === "rejected" && (
                      <p className="mt-1 text-xs text-red-700">Reason: {row.review.rejectionReason}</p>
                    )}
                  </div>
                  {row.review?.status === "pending" && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => { setRejecting(row); setReason("") }}
                        disabled={busyId === row.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" /> Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => approve(row)}
                        disabled={busyId === row.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-2">Document</th>
                        <th className="px-4 py-2">Was on file</th>
                        <th className="px-4 py-2">Requested</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {fields.map((f) => (
                        <tr key={f} className="align-top">
                          <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-800">{row.labels?.[f] || f}</td>
                          <td className="px-4 py-2.5 text-gray-500"><Value field={f} value={previous[f]} /></td>
                          <td className="px-4 py-2.5 font-semibold text-gray-900"><Value field={f} value={changes[f]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="reject-title">
          <form onSubmit={reject} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="reject-title" className="text-base font-semibold text-gray-900">Reject {rejecting.name}'s change</h2>
            <p className="mt-1 text-sm text-gray-500">The outlet sees this reason. What is on file stays as it is.</p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              autoFocus
              placeholder="e.g. GST certificate photo is blurry, upload a clear one"
              className="mt-3 w-full rounded-lg border border-gray-300 p-3 text-sm outline-none focus:border-[#006fbd] focus:ring-1 focus:ring-[#006fbd]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRejecting(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
                Cancel
              </button>
              <button type="submit" disabled={busyId === rejecting.id} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                Reject change
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
