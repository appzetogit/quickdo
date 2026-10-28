import { useEffect, useState } from "react"
import { FileText, Loader2, Upload } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { adminAPI, restaurantAPI } from "@food/api"
import { adminPanelOf } from "@food/utils/adminPanel"

/*
 * The admin edits an outlet's compliance documents directly (restaurant,
 * store or medical store -- this card sits on the shared Edit page). Unlike the
 * outlet's own edits, these go straight on file: the admin is the reviewer.
 * A change the outlet has waiting is shown so the admin can review it on the
 * Document Reviews page instead of overwriting it here unknowingly.
 */

const FIELDS = [
  { key: "panNumber", label: "PAN number", placeholder: "ABCDE1234F" },
  { key: "nameOnPan", label: "Name on PAN" },
  { key: "panImage", label: "PAN card photo", image: true },
  { key: "gstNumber", label: "GST number", placeholder: "22ABCDE1234F1Z5" },
  { key: "gstLegalName", label: "GST legal name" },
  { key: "gstImage", label: "GST certificate", image: true },
  { key: "fssaiNumber", label: "FSSAI licence number", placeholder: "14 digits" },
  { key: "fssaiExpiry", label: "FSSAI expiry", date: true },
  { key: "fssaiImage", label: "FSSAI licence photo", image: true },
]

// A pharmacy also files its drug licence; the store API checks it on save.
const PHARMACY_FIELDS = [
  { key: "drugLicenseNumber", label: "Drug licence number" },
  { key: "drugLicenseExpiry", label: "Drug licence expiry", date: true },
  { key: "drugLicenseImage", label: "Drug licence photo", image: true },
]

const fieldsFor = (r) => (r?.storeType === "pharmacy" ? [...FIELDS, ...PHARMACY_FIELDS] : FIELDS)

const fromRestaurant = (r) => {
  const out = { gstRegistered: r?.gstRegistered === true }
  for (const f of fieldsFor(r)) {
    const v = r?.[f.key]
    out[f.key] = f.date ? (v ? String(v).slice(0, 10) : "") : f.image ? (typeof v === "object" ? v?.url || "" : v || "") : v || ""
  }
  return out
}

export default function AdminRestaurantDocuments({ restaurantId, restaurant, onSaved }) {
  const [form, setForm] = useState(() => fromRestaurant(restaurant))
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState("")

  useEffect(() => {
    setForm(fromRestaurant(restaurant))
  }, [restaurant])

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const waiting = restaurant?.documentReview?.status === "pending"
  const fields = fieldsFor(restaurant)
  const reviewsPath = `${adminPanelOf().base}/document-reviews`

  const upload = async (key, file) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      alert("Upload a photo of the document (JPG or PNG)")
      return
    }
    setUploading(key)
    try {
      const body = new FormData()
      body.append("folder", "documents")
      body.append("file", file)
      const res = await restaurantAPI.uploadAttachment(body)
      const url = res?.data?.data?.url || res?.data?.url
      if (!url) throw new Error("Upload failed")
      set(key, url)
    } catch (e) {
      alert(e?.response?.data?.message || "Upload failed")
    } finally {
      setUploading("")
    }
  }

  const save = async () => {
    // Only what changed: a medical store's licence is re-checked whenever it is
    // sent, and an incomplete one on file must not block saving a PAN.
    const original = fromRestaurant(restaurant)
    const payload = {}
    for (const [key, value] of Object.entries(form)) {
      if (value !== original[key]) payload[key] = key.endsWith("Expiry") ? value || null : value
    }
    if (!Object.keys(payload).length) {
      alert("Nothing changed")
      return
    }
    setSaving(true)
    try {
      const res = await adminAPI.updateRestaurant(restaurantId, payload)
      const updated = res?.data?.data?.restaurant || res?.data?.data || null
      onSaved?.(updated || payload)
      alert("Documents saved")
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to save documents")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
          <p className="mt-1 text-xs text-slate-500">
            PAN, GST and FSSAI{restaurant?.storeType === "pharmacy" ? ", and the drug licence" : ""}. Saved here they go straight on file; the outlet stays live.
          </p>
          {waiting && (
            <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
              The outlet has a document change waiting. Review it on{" "}
              <a href={reviewsPath} className="underline">Document Reviews</a>.
            </p>
          )}
        </div>
        <Button onClick={save} disabled={saving || Boolean(uploading)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Documents"}
        </Button>
      </div>

      <div className="mb-1 flex items-center gap-3">
        <Label>GST registered?</Label>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => set("gstRegistered", v)}
            className={`rounded-md border px-3 py-1 text-sm ${form.gstRegistered === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
      {/* What the switch does to money (food/orders/services/foodTransaction.service.js). */}
      <p className="mb-4 text-xs text-slate-500">
        {form.gstRegistered
          ? "Yes: the GST on this restaurant's food is paid to it with each payout (e.g. Rs 100 incl. 5% GST at 10% commission pays Rs 90.48), and it files that GST itself."
          : "No: the restaurant is paid without the GST on its food (Rs 100 incl. 5% GST at 10% commission pays Rs 85.72); the platform pays that GST to the government."}{" "}
        Applies to orders placed after you save.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key}>
            <Label>{f.label}</Label>
            {f.image ? (
              <div className="mt-1 flex items-center gap-3">
                {form[f.key] ? (
                  <a href={form[f.key]} target="_blank" rel="noreferrer">
                    <img src={form[f.key]} alt={f.label} className="h-14 w-20 rounded-md border border-slate-200 object-cover" />
                  </a>
                ) : (
                  <span className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-400">
                    <FileText className="h-5 w-5" />
                  </span>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  {uploading === f.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {form[f.key] ? "Replace" : "Upload"}
                  <input type="file" accept="image/*" className="sr-only" disabled={Boolean(uploading)} onChange={(e) => upload(f.key, e.target.files?.[0])} />
                </label>
              </div>
            ) : (
              <Input
                type={f.date ? "date" : "text"}
                value={form[f.key]}
                placeholder={f.placeholder || ""}
                onChange={(e) => set(f.key, f.date ? e.target.value : e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
