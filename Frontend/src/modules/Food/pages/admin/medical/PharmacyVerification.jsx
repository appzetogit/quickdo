import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, CircleAlert, ExternalLink, FileText, Loader2, MapPin, ShieldCheck, XCircle } from "lucide-react"
import { adminAPI } from "@food/api"

/**
 * Pharmacy verification: every application, its documents and photos side by
 * side, and approve or reject.
 *
 * The checklist is the server's, the same one the pharmacy saw while applying,
 * so "Approve" is only offered once nothing required is missing -- and the server
 * refuses it anyway if it is. Rejecting needs a reason, because the pharmacy is
 * shown it and has to know what to fix.
 */

const TABS = [
  { id: "pending", label: "Waiting for review" },
  { id: "rejected", label: "Rejected" },
  { id: "approved", label: "Approved" },
]

const SECTION_LABELS = {
  basic: "Basic details",
  documents: "Documents",
  photos: "Store photos",
  bank: "Bank details",
}

const LICENCE_BADGE = {
  valid: { label: "Licence valid", className: "bg-emerald-100 text-emerald-700" },
  expiring: { label: "Licence expiring soon", className: "bg-amber-100 text-amber-700" },
  expired: { label: "Licence expired", className: "bg-rose-100 text-rose-700" },
  missing: { label: "No licence expiry", className: "bg-slate-200 text-slate-700" },
}

const formatDate = (value) => {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

const isPdf = (url) => /\.pdf(\?|$)/i.test(String(url || ""))

function DocumentTile({ label, url, large = false }) {
  if (!url) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 ${large ? "h-56" : "h-32"}`}>
        <FileText className="mb-1 h-5 w-5" />
        {label}
        <span>Not provided</span>
      </div>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`group relative block overflow-hidden rounded-lg border border-slate-200 bg-slate-100 ${large ? "h-56" : "h-32"}`}
    >
      {isPdf(url) ? (
        <div className="flex h-full flex-col items-center justify-center text-sm text-slate-600">
          <FileText className="mb-1 h-7 w-7 text-rose-500" />
          PDF — open
        </div>
      ) : (
        <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" />
      )}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/60 px-2 py-1 text-xs text-white">
        {label}
        <ExternalLink className="h-3 w-3 opacity-70 group-hover:opacity-100" />
      </span>
    </a>
  )
}

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="truncate text-sm font-medium text-slate-900" title={value || ""}>
        {value || "—"}
      </div>
    </div>
  )
}

function ApplicationDetail({ app, onApprove, onReject, busy }) {
  const [reason, setReason] = useState("")
  const licence = LICENCE_BADGE[app.drugLicence?.state] || LICENCE_BADGE.missing
  const bySection = useMemo(() => {
    const out = {}
    for (const item of app.checklist?.items || []) (out[item.section] ||= []).push(item)
    return out
  }, [app.checklist])
  const mapUrl = app.latitude != null && app.longitude != null
    ? `https://www.google.com/maps?q=${app.latitude},${app.longitude}`
    : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{app.restaurantName || "Unnamed pharmacy"}</h2>
          <p className="text-sm text-slate-500">
            {app.ownerName} · {app.ownerPhone} · applied {formatDate(app.submittedAt)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${licence.className}`}>{licence.label}</span>
      </div>

      {app.status === "rejected" && app.rejectionReason && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          Rejected: {app.rejectionReason}
        </p>
      )}

      {/* The front photo is the main check that this is a real shop, so it leads. */}
      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <DocumentTile label="Front / entrance" url={app.storeFrontImage} large />
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-500">
              <MapPin className="h-3.5 w-3.5" /> Store address
            </div>
            <p className="text-sm text-slate-900">
              {[app.addressLine1, app.addressLine2, app.area, app.city, app.state, app.pincode].filter(Boolean).join(", ") || "—"}
            </p>
            {mapUrl && (
              <a href={mapUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">
                Open the pin on Google Maps <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DocumentTile label="Inside" url={app.storeInsideImage} />
            <DocumentTile label="Signboard" url={app.storeSignboardImage} />
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Documents</h3>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Drug licence no." value={app.drugLicenseNumber} />
          <Field label="Licence expires" value={formatDate(app.drugLicenseExpiry)} />
          <Field label="PAN" value={app.panNumber} />
          <Field label="GST" value={app.gstRegistered ? app.gstNumber : "Not registered"} />
          <Field label="Pharmacist" value={app.pharmacistName} />
          <Field label="Pharmacist reg. no." value={app.pharmacistRegistrationNumber} />
          <Field label="Email" value={app.ownerEmail} />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <DocumentTile label="Drug licence" url={app.drugLicenseImage} />
          <DocumentTile label="Pharmacist certificate" url={app.pharmacistCertificateImage} />
          <DocumentTile label="Business registration" url={app.businessRegistrationImage} />
          <DocumentTile label="PAN card" url={app.panImage} />
          <DocumentTile label="GST certificate" url={app.gstImage} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Bank details</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Account holder" value={app.accountHolderName} />
          <Field label="Account number" value={app.accountNumber} />
          <Field label="IFSC" value={app.ifscCode} />
          <Field label="UPI" value={app.upiId} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">
          Checklist{" "}
          {app.checklist?.complete ? (
            <span className="ml-1 text-emerald-700">complete</span>
          ) : (
            <span className="ml-1 text-rose-700">{app.checklist?.missing?.length || 0} missing</span>
          )}
        </h3>
        <div className="grid gap-4 md:grid-cols-4">
          {Object.entries(bySection).map(([section, items]) => (
            <div key={section}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {SECTION_LABELS[section] || section}
              </div>
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.key} className="flex items-start gap-1.5 text-sm">
                    {item.done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : item.required ? (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                    ) : (
                      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-slate-300" />
                    )}
                    <span className={item.done ? "text-slate-700" : item.required ? "text-rose-700" : "text-slate-400"}>
                      {item.label}
                      {!item.required && !item.done ? " (optional)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {app.status !== "approved" && (
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={`reason-${app.id}`}>
              Reason, if rejecting
            </label>
            <input
              id={`reason-${app.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Drug licence photo is blurred — upload a clear copy"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReject(app, reason)}
              disabled={busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" /> Reject
            </button>
            <button
              type="button"
              onClick={() => onApprove(app)}
              disabled={busy || !app.checklist?.complete}
              title={app.checklist?.complete ? "" : "Every required item must be provided first"}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default function PharmacyVerification() {
  const [tab, setTab] = useState("pending")
  const [rows, setRows] = useState([])
  const [selectedId, setSelectedId] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getPharmacyApplications({ status: tab })
      const list = res?.data?.data?.applications || []
      setRows(list)
      setSelectedId((current) => (list.some((r) => r.id === current) ? current : list[0]?.id || ""))
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load applications")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  const selected = rows.find((r) => r.id === selectedId)

  const approve = async (app) => {
    setBusy(true)
    try {
      await adminAPI.approvePharmacyApplication(app.id)
      toast.success(`${app.restaurantName} is approved and can now take orders.`)
      await load()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not approve")
    } finally {
      setBusy(false)
    }
  }

  const reject = async (app, reason) => {
    if (String(reason || "").trim().length < 5) {
      toast.error("Write the reason — the pharmacy sees it and needs to know what to fix.")
      return
    }
    setBusy(true)
    try {
      await adminAPI.rejectPharmacyApplication(app.id, reason.trim())
      toast.success(`${app.restaurantName} was rejected. They can fix and resubmit.`)
      await load()
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not reject")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Pharmacy verification</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Check each pharmacy&rsquo;s documents and photos before it can take prescription orders. Use the front photo
          and map pin to confirm it is a real shop. A pharmacy can only be approved once everything required is provided.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              tab === t.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading applications
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {tab === "pending" ? "No pharmacies are waiting for review." : "Nothing here."}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <ul className="max-h-[75vh] divide-y overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={`w-full px-4 py-3 text-left ${row.id === selectedId ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                >
                  <div className="truncate text-sm font-semibold text-slate-900">{row.restaurantName || "Unnamed"}</div>
                  <div className="text-xs text-slate-500">
                    {row.city || "—"} · {formatDate(row.submittedAt)}
                  </div>
                  <div className={`mt-1 text-xs ${row.checklist?.complete ? "text-emerald-700" : "text-rose-700"}`}>
                    {row.checklist?.complete ? "Everything provided" : `${row.checklist?.missing?.length || 0} required items missing`}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            {selected ? (
              <ApplicationDetail key={selected.id} app={selected} onApprove={approve} onReject={reject} busy={busy} />
            ) : (
              <p className="text-sm text-slate-500">Choose an application.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
