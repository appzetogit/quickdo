import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, CheckCircle2, Clock, FileText, Loader2, Upload, XCircle } from "lucide-react"
import { toast } from "sonner"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { restaurantAPI } from "@food/api"

/*
 * Compliance documents: PAN, GST, FSSAI and, for a medical store, the drug
 * licence. An edit goes to the admin as a change request and the outlet keeps
 * taking orders meanwhile; what is shown as "On file" stays in force until the
 * admin approves. Serves restaurants, stores and medical stores alike.
 */

const GROUPS = [
  { title: "PAN", fields: ["panNumber", "nameOnPan", "panImage"] },
  { title: "GST", fields: ["gstRegistered", "gstNumber", "gstLegalName", "gstAddress", "gstImage"] },
  { title: "FSSAI food licence", fields: ["fssaiNumber", "fssaiExpiry", "fssaiImage"] },
  { title: "Drug licence", fields: ["drugLicenseNumber", "drugLicenseExpiry", "drugLicenseImage"] },
]

const HINTS = {
  panNumber: "10 characters, like ABCDE1234F",
  gstNumber: "15-character GSTIN, like 22ABCDE1234F1Z5",
  fssaiNumber: "14 digits",
}

const isImage = (f) => f.endsWith("Image")
const isDate = (f) => f.endsWith("Expiry")
const isBool = (f) => f === "gstRegistered"

const toInput = (field, value) => {
  if (isBool(field)) return value === true
  if (isDate(field)) return value ? String(value).slice(0, 10) : ""
  return value ?? ""
}

const shown = (field, value) => {
  if (isBool(field)) return value === true ? "Yes" : "No"
  if (isDate(field)) return value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"
  return value ? String(value) : "—"
}

function ReviewBanner({ review, labels }) {
  if (!review) return null
  const changed = Object.keys(review.changes || {})
  const names = changed.map((f) => labels?.[f] || f).join(", ")
  if (review.status === "pending") {
    return (
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <Clock className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Under review: {names}</p>
          <p className="mt-0.5 text-amber-800">
            Your outlet stays live and keeps taking orders. The documents on file stay in use until the admin approves.
          </p>
        </div>
      </div>
    )
  }
  if (review.status === "rejected") {
    return (
      <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">Change not approved: {names}</p>
          <p className="mt-0.5">Reason: {review.rejectionReason || "Not given"}</p>
          <p className="mt-0.5 text-red-800">Fix it below and send it again.</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
      <p><span className="font-semibold">Approved.</span> Your latest document change is on file.</p>
    </div>
  )
}

export default function Documents() {
  const goBack = useRestaurantBackNavigation()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState("")
  const [error, setError] = useState("")

  const fill = useCallback((d) => {
    setData(d)
    // Start from what is waiting for review, so a second edit builds on it.
    const pending = d?.review?.status === "pending" ? d.review.changes || {} : {}
    const next = {}
    for (const f of d?.fields || []) next[f] = toInput(f, f in pending ? pending[f] : d.values?.[f])
    setForm(next)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await restaurantAPI.getDocuments()
      fill(res?.data?.data || null)
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load your documents.")
    } finally {
      setLoading(false)
    }
  }, [fill])

  useEffect(() => {
    load()
  }, [load])

  const fields = useMemo(() => new Set(data?.fields || []), [data])
  const labels = data?.labels || {}
  const pendingChanges = data?.review?.status === "pending" ? data.review.changes || {} : {}

  const dirty = useMemo(() => {
    if (!data) return false
    return (data.fields || []).some((f) => {
      const base = toInput(f, f in pendingChanges ? pendingChanges[f] : data.values?.[f])
      return String(form[f] ?? "") !== String(base ?? "")
    })
  }, [data, form, pendingChanges])

  const setField = (f, v) => setForm((prev) => ({ ...prev, [f]: v }))

  const upload = async (field, file) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Upload a photo of the document (JPG or PNG)")
      return
    }
    setUploading(field)
    try {
      const body = new FormData()
      body.append("folder", "documents")
      body.append("file", file)
      const res = await restaurantAPI.uploadAttachment(body)
      const url = res?.data?.data?.url || res?.data?.url
      if (!url) throw new Error("Upload failed")
      setField(field, url)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Upload failed. Try again.")
    } finally {
      setUploading("")
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const body = {}
      for (const f of data.fields) body[f] = form[f]
      const res = await restaurantAPI.updateDocuments(body)
      fill(res?.data?.data || null)
      toast.success("Sent for review. Your outlet stays live meanwhile.")
    } catch (err) {
      setError(err?.response?.data?.message || "Could not send your documents. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const input =
    "h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"

  const renderField = (f) => {
    const onFile = data.values?.[f]
    const waiting = f in pendingChanges
    return (
      <div key={f} className={isImage(f) || f === "gstAddress" ? "sm:col-span-2" : ""}>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <label htmlFor={`doc-${f}`} className="text-xs font-semibold text-gray-700">{labels[f] || f}</label>
          {waiting && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">In review</span>}
        </div>
        {isBool(f) ? (
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setField(f, v)}
                aria-pressed={form[f] === v}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold ${form[f] === v ? "bg-gray-900 text-white" : "text-gray-600"}`}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        ) : isImage(f) ? (
          <div className="flex flex-wrap items-center gap-3">
            {form[f] ? (
              <a href={form[f]} target="_blank" rel="noreferrer" className="block">
                <img src={form[f]} alt={labels[f]} className="h-20 w-28 rounded-lg border border-gray-200 object-cover" onError={(e) => { e.currentTarget.style.display = "none" }} />
              </a>
            ) : (
              <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400">
                <FileText className="h-6 w-6" />
              </div>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {uploading === f ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {form[f] ? "Replace" : "Upload"}
              <input id={`doc-${f}`} type="file" accept="image/*" className="sr-only" disabled={Boolean(uploading)} onChange={(e) => upload(f, e.target.files?.[0])} />
            </label>
          </div>
        ) : (
          <input
            id={`doc-${f}`}
            type={isDate(f) ? "date" : "text"}
            value={form[f] ?? ""}
            onChange={(e) => setField(f, e.target.value)}
            placeholder={HINTS[f] || ""}
            className={input}
          />
        )}
        {!isImage(f) && <p className="mt-1 text-[11px] text-gray-500">On file: {shown(f, onFile)}</p>}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-28">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3.5">
          <button type="button" onClick={goBack} aria-label="Go back" className="rounded-full p-1.5 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-800" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Documents</h1>
            <p className="text-xs text-gray-500">PAN, GST and licences. Changes are reviewed; your outlet stays live.</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {loading && !data ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-gray-500" /></div>
        ) : !data ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error || "Could not load your documents."}{" "}
            <button type="button" onClick={load} className="font-semibold underline">Retry</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <ReviewBanner review={data.review} labels={labels} />
            {GROUPS.filter((g) => g.fields.some((f) => fields.has(f))).map((g) => (
              <section key={g.title} className="rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">{g.title}</h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {g.fields.filter((f) => fields.has(f)).filter((f) => g.title !== "GST" || f === "gstRegistered" || form.gstRegistered === true).map(renderField)}
                </div>
              </section>
            ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur-md lg:sticky">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                <p className="text-xs text-gray-500">{dirty ? "Unsent changes" : "No changes"}</p>
                <button
                  type="submit"
                  disabled={!dirty || saving || Boolean(uploading)}
                  className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-500"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Send for review
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
