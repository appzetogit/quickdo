import { useEffect, useMemo, useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, CircleAlert, Loader2 } from "lucide-react"
import MapPinPicker from "../components/MapPinPicker"
import UploadField from "../components/UploadField"
import { PARTNER_TYPES, partnerApi, partnerSession, errorMessage } from "../partnerApi"

/**
 * The application: four steps, saved as a draft in this browser, submitted once.
 *
 * Which fields are required comes from the server's checklist (the same list
 * the admin approves against), keyed by the stored field name -- so the form
 * never marks something optional that approval will then refuse on.
 */

const STORE_TYPES = [
  { value: "grocery", label: "Grocery" },
  { value: "kirana", label: "Kirana" },
  { value: "supermarket", label: "Supermarket" },
  { value: "pet", label: "Pet supplies" },
  { value: "electronics", label: "Electronics" },
  { value: "stationery", label: "Stationery" },
  { value: "general", label: "General store" },
]

const EMPTY = {
  restaurantName: "",
  ownerName: "",
  ownerEmail: "",
  storeType: "grocery",
  addressLine1: "",
  addressLine2: "",
  area: "",
  city: "",
  state: "",
  pincode: "",
  landmark: "",
  latitude: null,
  longitude: null,
  drugLicenseNumber: "",
  drugLicenseExpiry: "",
  drugLicenseImage: "",
  gstRegistered: false,
  gstNumber: "",
  gstImage: "",
  panNumber: "",
  nameOnPan: "",
  panImage: "",
  fssaiNumber: "",
  fssaiImage: "",
  businessRegistrationImage: "",
  pharmacistName: "",
  pharmacistRegistrationNumber: "",
  pharmacistCertificateImage: "",
  storeFrontImage: "",
  storeInsideImage: "",
  storeSignboardImage: "",
  accountHolderName: "",
  accountNumber: "",
  ifscCode: "",
  upiId: "",
}

/** Form field -> the checklist key the server uses for it. */
const CHECK_KEY = {
  restaurantName: "restaurantName",
  ownerName: "ownerName",
  ownerEmail: "ownerEmail",
  addressLine1: "address",
  city: "address",
  latitude: "location",
  drugLicenseNumber: "drugLicenseNumber",
  drugLicenseExpiry: "drugLicenseExpiry",
  drugLicenseImage: "drugLicenseImage",
  panNumber: "panNumber",
  panImage: "panImage",
  fssaiImage: "fssaiImage",
  businessRegistrationImage: "businessRegistrationImage",
  pharmacistName: "pharmacist.name",
  pharmacistRegistrationNumber: "pharmacist.registrationNumber",
  pharmacistCertificateImage: "pharmacist.certificateImage",
  storeFrontImage: "storePhotos.front",
  storeInsideImage: "storePhotos.inside",
  storeSignboardImage: "storePhotos.signboard",
  accountHolderName: "accountHolderName",
  accountNumber: "accountNumber",
  ifscCode: "ifscCode",
  upiId: "upiId",
}

const STEPS = [
  { id: "basic", title: "Basic details" },
  { id: "documents", title: "Documents" },
  { id: "photos", title: "Store photos" },
  { id: "bank", title: "Bank details" },
]

const STEP_FIELDS = {
  basic: ["restaurantName", "ownerName", "ownerEmail", "addressLine1", "city", "latitude"],
  documents: [
    "drugLicenseNumber", "drugLicenseExpiry", "drugLicenseImage", "panNumber", "panImage",
    "businessRegistrationImage", "pharmacistName", "pharmacistRegistrationNumber", "pharmacistCertificateImage",
    "fssaiImage", "gstImage",
  ],
  photos: ["storeFrontImage", "storeInsideImage", "storeSignboardImage"],
  bank: ["accountHolderName", "accountNumber", "ifscCode", "upiId"],
}

const LABELS = {
  restaurantName: "Store name",
  ownerName: "Owner name",
  ownerEmail: "Email",
  addressLine1: "Store address",
  city: "City",
  latitude: "Location on map",
  drugLicenseNumber: "Drug licence number",
  drugLicenseExpiry: "Drug licence expiry date",
  drugLicenseImage: "Drug licence document",
  panNumber: "PAN number",
  panImage: "PAN card photo",
  businessRegistrationImage: "Store / business registration document",
  pharmacistName: "Pharmacist name",
  pharmacistRegistrationNumber: "Pharmacist registration number",
  pharmacistCertificateImage: "Pharmacist registration certificate",
  fssaiImage: "FSSAI licence",
  gstImage: "GST certificate",
  storeFrontImage: "Front / entrance photo",
  storeInsideImage: "Inside the store photo",
  storeSignboardImage: "Signboard photo",
  accountHolderName: "Account holder name",
  accountNumber: "Account number",
  ifscCode: "IFSC code",
  upiId: "UPI ID",
}

const draftKey = (phone, type) => `partner_draft_${type}_${phone}`

const fromApplication = (app) => {
  if (!app) return {}
  const out = {}
  for (const key of Object.keys(EMPTY)) {
    if (app[key] !== undefined && app[key] !== null) out[key] = app[key]
  }
  if (app.drugLicenseExpiry) out.drugLicenseExpiry = String(app.drugLicenseExpiry).slice(0, 10)
  return out
}

function TextInput({ label, required, value, onChange, ...rest }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-800">
        {label}
        {required ? <span className="text-rose-600"> *</span> : <span className="text-slate-400"> (optional)</span>}
      </span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:ring-2 focus:ring-emerald-500"
        {...rest}
      />
    </label>
  )
}

export default function PartnerApply() {
  const { type } = useParams()
  const navigate = useNavigate()
  const session = partnerSession.get()
  const [form, setForm] = useState(() => {
    if (!session) return EMPTY
    let draft = {}
    try {
      draft = JSON.parse(localStorage.getItem(draftKey(session.phone, type)) || "{}")
    } catch {
      draft = {}
    }
    // What the server holds beats the draft: it may have been fixed elsewhere.
    return { ...EMPTY, ...draft, ...fromApplication(session.application) }
  })
  const [step, setStep] = useState(0)
  const [checklist, setChecklist] = useState(session?.checklist || null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [shown, setShown] = useState([])

  useEffect(() => {
    if (!session) return
    try {
      localStorage.setItem(draftKey(session.phone, type), JSON.stringify(form))
    } catch {
      // No storage: the form still works, it just is not remembered.
    }
  }, [form, session, type])

  useEffect(() => {
    if (!session?.onboardingToken || checklist) return
    partnerApi.getApplication(session.onboardingToken).then((d) => setChecklist(d.checklist)).catch(() => {})
  }, [session, checklist])

  const requiredKeys = useMemo(() => {
    const set = new Set((checklist?.items || []).filter((i) => i.required).map((i) => i.key))
    return set
  }, [checklist])

  if (!session || session.type !== type || !PARTNER_TYPES[type] || type === "restaurant") {
    return <Navigate to="/partner" replace />
  }
  if (!session.onboardingToken) return <Navigate to="/partner/status" replace />

  const isMedical = type === "medical"
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const isRequired = (field) => {
    if (field === "gstImage") return form.gstRegistered === true
    if (field === "city") return requiredKeys.has("address")
    return requiredKeys.has(CHECK_KEY[field])
  }
  const isFilled = (field) => {
    if (field === "latitude") return Number.isFinite(form.latitude) && Number.isFinite(form.longitude)
    if (field === "gstImage") return Boolean(form.gstImage && form.gstNumber)
    return String(form[field] ?? "").trim() !== ""
  }
  const visible = (field) => {
    const medicalOnly = ["drugLicenseNumber", "drugLicenseExpiry", "drugLicenseImage", "businessRegistrationImage", "pharmacistName", "pharmacistRegistrationNumber", "pharmacistCertificateImage"]
    if (medicalOnly.includes(field)) return isMedical
    if (field === "fssaiImage") return !isMedical
    return true
  }
  const missingOn = (stepId) =>
    STEP_FIELDS[stepId].filter((f) => visible(f) && isRequired(f) && !isFilled(f)).map((f) => LABELS[f])

  const next = () => {
    const missing = missingOn(STEPS[step].id)
    if (missing.length) {
      setShown(missing)
      return
    }
    setShown([])
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const submit = async () => {
    const allMissing = STEPS.flatMap((s) => missingOn(s.id))
    if (allMissing.length) {
      setShown(allMissing)
      return
    }
    setBusy(true)
    setError("")
    try {
      const body = {
        ...form,
        storeType: isMedical ? "pharmacy" : form.storeType,
        latitude: form.latitude != null ? String(form.latitude) : undefined,
        longitude: form.longitude != null ? String(form.longitude) : undefined,
        gstRegistered: form.gstRegistered ? "true" : "false",
        panNumber: form.panNumber.toUpperCase(),
        ifscCode: form.ifscCode.toUpperCase(),
        formattedAddress: [form.addressLine1, form.addressLine2, form.area, form.city, form.state, form.pincode]
          .filter(Boolean)
          .join(", "),
      }
      const data = await partnerApi.submitApplication(session.onboardingToken, body)
      partnerSession.set({ ...session, state: data.state, application: data.application, checklist: data.checklist })
      try {
        localStorage.removeItem(draftKey(session.phone, type))
      } catch {
        // nothing to remove
      }
      navigate("/partner/status", { replace: true })
    } catch (err) {
      setError(errorMessage(err, "Could not submit. Check the details and try again."))
    } finally {
      setBusy(false)
    }
  }

  const current = STEPS[step].id
  const token = session.onboardingToken

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm font-medium text-emerald-700">{PARTNER_TYPES[type].label} registration</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {session.state === "rejected" ? "Fix and resubmit" : session.state === "pending" ? "Update your application" : "Register your store"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">Mobile number +91 {session.phone} · your progress is saved on this device</p>
      </div>

      <ol className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              className={`w-full border-t-4 pt-2 text-left text-xs font-medium ${
                i <= step ? "border-emerald-600 text-slate-900" : "border-slate-200 text-slate-400"
              }`}
            >
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      {session.state === "rejected" && session.application?.rejectionReason && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span className="font-semibold">Reason: </span>
          {session.application.rejectionReason}
        </p>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {current === "basic" && (
          <>
            <TextInput label={isMedical ? "Pharmacy / store name" : "Store name"} required={isRequired("restaurantName")} value={form.restaurantName} onChange={set("restaurantName")} />
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Owner name" required={isRequired("ownerName")} value={form.ownerName} onChange={set("ownerName")} autoComplete="name" />
              <TextInput label="Email" required={isRequired("ownerEmail")} value={form.ownerEmail} onChange={set("ownerEmail")} type="email" autoComplete="email" />
            </div>
            {!isMedical && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-800">What kind of store</span>
                <select
                  value={form.storeType}
                  onChange={(e) => set("storeType")(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3"
                >
                  {STORE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <TextInput label="Store address" required={isRequired("addressLine1")} value={form.addressLine1} onChange={set("addressLine1")} placeholder="Shop no., building, street" />
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Area / locality" value={form.area} onChange={set("area")} />
              <TextInput label="Landmark" value={form.landmark} onChange={set("landmark")} />
              <TextInput label="City" required={isRequired("city")} value={form.city} onChange={set("city")} />
              <TextInput label="State" value={form.state} onChange={set("state")} />
              <TextInput label="Pincode" value={form.pincode} onChange={(v) => set("pincode")(v.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" />
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-800">
                Location on map{isRequired("latitude") && <span className="text-rose-600"> *</span>}
              </span>
              <MapPinPicker
                value={{ lat: form.latitude, lng: form.longitude }}
                onChange={({ lat, lng }) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
              />
            </div>
          </>
        )}

        {current === "documents" && (
          <>
            {isMedical && (
              <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                <h2 className="text-sm font-semibold text-slate-800">Drug licence</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextInput label="Licence number" required={isRequired("drugLicenseNumber")} value={form.drugLicenseNumber} onChange={set("drugLicenseNumber")} />
                  <TextInput label="Valid until" required={isRequired("drugLicenseExpiry")} value={form.drugLicenseExpiry} onChange={set("drugLicenseExpiry")} type="date" min={new Date().toISOString().slice(0, 10)} />
                </div>
                <UploadField label="Drug licence" required={isRequired("drugLicenseImage")} value={form.drugLicenseImage} onChange={set("drugLicenseImage")} token={token} />
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="PAN number" required={isRequired("panNumber")} value={form.panNumber} onChange={(v) => set("panNumber")(v.toUpperCase().slice(0, 10))} placeholder="ABCDE1234F" />
              <TextInput label="Name on PAN" value={form.nameOnPan} onChange={set("nameOnPan")} />
            </div>
            <UploadField label="PAN card" required={isRequired("panImage")} value={form.panImage} onChange={set("panImage")} token={token} />
            {isMedical ? (
              <>
                <UploadField label="Store / business registration document" hint="Shop & establishment certificate, trade licence or similar" required={isRequired("businessRegistrationImage")} value={form.businessRegistrationImage} onChange={set("businessRegistrationImage")} token={token} />
                <div className="space-y-4 rounded-xl bg-slate-50 p-4">
                  <h2 className="text-sm font-semibold text-slate-800">Registered pharmacist</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextInput label="Pharmacist name" required={isRequired("pharmacistName")} value={form.pharmacistName} onChange={set("pharmacistName")} />
                    <TextInput label="Registration number" required={isRequired("pharmacistRegistrationNumber")} value={form.pharmacistRegistrationNumber} onChange={set("pharmacistRegistrationNumber")} />
                  </div>
                  <UploadField label="Pharmacist registration certificate" required={isRequired("pharmacistCertificateImage")} value={form.pharmacistCertificateImage} onChange={set("pharmacistCertificateImage")} token={token} />
                </div>
              </>
            ) : (
              <UploadField label="FSSAI licence" required={isRequired("fssaiImage")} value={form.fssaiImage} onChange={set("fssaiImage")} token={token} />
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.gstRegistered} onChange={(e) => set("gstRegistered")(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
              My business is GST registered
            </label>
            {form.gstRegistered && (
              <div className="grid gap-4 md:grid-cols-2">
                <TextInput label="GST number" required value={form.gstNumber} onChange={(v) => set("gstNumber")(v.toUpperCase())} />
                <UploadField label="GST certificate" required value={form.gstImage} onChange={set("gstImage")} token={token} />
              </div>
            )}
          </>
        )}

        {current === "photos" && (
          <>
            <p className="text-sm text-slate-600">
              We use the front photo to confirm your store is a real, physical shop. Take it from the street so the entrance
              {isMedical ? " and pharmacy sign are" : " is"} clearly visible.
            </p>
            <UploadField label="Front / entrance photo" required={isRequired("storeFrontImage")} value={form.storeFrontImage} onChange={set("storeFrontImage")} token={token} accept="image/*" capture="environment" />
            <UploadField label="Inside the store" required={isRequired("storeInsideImage")} value={form.storeInsideImage} onChange={set("storeInsideImage")} token={token} accept="image/*" capture="environment" />
            <UploadField label={isMedical ? "Pharmacy signboard" : "Signboard"} required={isRequired("storeSignboardImage")} value={form.storeSignboardImage} onChange={set("storeSignboardImage")} token={token} accept="image/*" capture="environment" />
          </>
        )}

        {current === "bank" && (
          <>
            <p className="text-sm text-slate-600">Payouts for your orders are sent to this account.</p>
            <TextInput label="Account holder name" required={isRequired("accountHolderName")} value={form.accountHolderName} onChange={set("accountHolderName")} />
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Account number" required={isRequired("accountNumber")} value={form.accountNumber} onChange={(v) => set("accountNumber")(v.replace(/\D/g, "").slice(0, 18))} inputMode="numeric" />
              <TextInput label="IFSC code" required={isRequired("ifscCode")} value={form.ifscCode} onChange={(v) => set("ifscCode")(v.toUpperCase().slice(0, 11))} placeholder="HDFC0001234" />
            </div>
            <TextInput label="UPI ID" required={isRequired("upiId")} value={form.upiId} onChange={set("upiId")} placeholder="name@bank" />
          </>
        )}
      </section>

      {shown.length > 0 && (
        <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">
          <p className="flex items-center gap-1.5 font-semibold">
            <CircleAlert className="h-4 w-4" /> Please add
          </p>
          <ul className="mt-1 list-disc pl-5">
            {shown.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => (step === 0 ? navigate("/partner") : setStep((s) => s - 1))}
          className="inline-flex h-12 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="inline-flex h-12 items-center gap-1.5 rounded-xl bg-slate-900 px-6 font-semibold text-white"
          >
            Next <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-emerald-600 px-6 font-semibold text-white disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {session.state === "new" ? "Submit application" : "Resubmit for review"}
          </button>
        )}
      </div>
    </div>
  )
}
