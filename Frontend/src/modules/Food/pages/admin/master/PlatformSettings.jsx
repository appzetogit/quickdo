import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { platformSettingsAPI, uploadAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Building2, FileText, ScrollText, PlugZap, Wallet, CheckCircle2, ExternalLink, ImagePlus } from "lucide-react"
import { legalHtmlToPlainText, plainTextToLegalHtml } from "@food/utils/legalContentFormat"
import CashLimitSettings from "./CashLimitSettings"
import AppLegalPages from "./AppLegalPages"

/**
 * Master settings: what every service shares, set once for the whole platform
 * (core/settings/platformProfile.service.js on the server).
 *
 * Empty means "not managed here": each service keeps showing its own value
 * until one is saved here, and payments, SMS and email keep using the server's
 * .env. Saving a value makes every app use it.
 */

const TABS = [
  { key: "brand", label: "Brand & contact", icon: Building2 },
  { key: "legal", label: "Legal pages", icon: FileText },
  { key: "appTerms", label: "App terms", icon: ScrollText },
  { key: "integrations", label: "Payments & messages", icon: PlugZap },
  { key: "money", label: "Money rules", icon: Wallet },
]

const LEGAL = [
  { key: "terms", label: "Terms & Conditions" },
  { key: "privacy", label: "Privacy Policy" },
  { key: "refund", label: "Refund Policy" },
  { key: "cancellation", label: "Cancellation Policy" },
  { key: "shipping", label: "Shipping Policy" },
]

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

function Field({ label, hint, children, wide }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-sm font-medium text-neutral-800">{label}</span>
      {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

function Card({ title, description, children, footer }) {
  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-100 px-5 py-4">
        <h2 className="font-semibold text-neutral-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">{footer}</div>}
    </section>
  )
}

function ImageField({ label, hint, value, onChange, folder }) {
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const res = await uploadAPI.uploadMedia(file, { folder })
      const url = res?.data?.data?.url || res?.data?.url
      if (!url) throw new Error("Upload returned no link")
      onChange(url)
    } catch (err) {
      toast.error(errText(err, "Upload failed"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
          {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-neutral-400" />}
        </div>
        <label className={`${ghostCls} cursor-pointer`}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {value ? "Replace" : "Upload"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {value && (
          <button type="button" className="text-xs text-neutral-500 hover:text-neutral-900" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
    </Field>
  )
}

/* ---------------------------------------------------------------- Brand -- */

function BrandTab({ profile, onSaved }) {
  const [brand, setBrand] = useState(profile.brand)
  const [contact, setContact] = useState(profile.contact)
  const [business, setBusiness] = useState(profile.business)
  const [busy, setBusy] = useState(false)
  const setB = (k) => (v) => setBrand((o) => ({ ...o, [k]: v }))
  const setC = (k) => (e) => setContact((o) => ({ ...o, [k]: e.target.value }))
  const setBiz = (k) => (e) => setBusiness((o) => ({ ...o, [k]: e.target.value }))

  const save = async () => {
    setBusy(true)
    try {
      await onSaved(await platformSettingsAPI.updateProfile({ brand, contact, business }), "Saved. Every app now shows these details.")
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card title="Brand" description="One name and logo for Food, Quick Commerce, Medical and Taxi.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App name" hint="Shown in every app, email and SMS" wide>
            <input className={inputCls} value={brand.name} placeholder="Quick Drop" onChange={(e) => setB("name")(e.target.value)} />
          </Field>
          <ImageField label="Logo" value={brand.logoUrl} onChange={setB("logoUrl")} folder="platform/brand" />
          <ImageField label="Favicon" hint="The small icon in the browser tab" value={brand.faviconUrl} onChange={setB("faviconUrl")} folder="platform/brand" />
        </div>
        <a href="/admin/food/business-setup" className="mt-4 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900">
          Separate logos for the driver, restaurant and delivery apps <ExternalLink className="h-3 w-3" />
        </a>
      </Card>

      <Card title="Contact" description="Where customers and partners reach you.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email">
            <input type="email" className={inputCls} value={contact.email} placeholder="support@quickdropsindia.com" onChange={setC("email")} />
          </Field>
          <Field label="Support phone">
            <div className="flex gap-2">
              <input className={`${inputCls} w-20`} value={contact.phoneCountryCode} placeholder="+91" onChange={setC("phoneCountryCode")} />
              <input className={inputCls} inputMode="numeric" value={contact.phone} placeholder="9876543210" onChange={setC("phone")} />
            </div>
          </Field>
          <Field label="WhatsApp number">
            <input className={inputCls} inputMode="numeric" value={contact.whatsapp} placeholder="9876543210" onChange={setC("whatsapp")} />
          </Field>
          <Field label="City">
            <input className={inputCls} value={contact.city} onChange={setC("city")} />
          </Field>
          <Field label="Address" wide>
            <input className={inputCls} value={contact.address} onChange={setC("address")} />
          </Field>
          <Field label="State">
            <input className={inputCls} value={contact.state} onChange={setC("state")} />
          </Field>
          <Field label="Pincode">
            <input className={inputCls} inputMode="numeric" value={contact.pincode} onChange={setC("pincode")} />
          </Field>
        </div>
      </Card>

      <Card
        title="Business details"
        description="Printed on invoices."
        footer={
          <button type="button" className={btnCls} disabled={busy} onClick={save}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save brand & contact
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registered company name" wide>
            <input className={inputCls} value={business.legalName} placeholder="Quick Drop India Pvt Ltd" onChange={setBiz("legalName")} />
          </Field>
          <Field label="GSTIN">
            <input className={inputCls} value={business.gstin} onChange={setBiz("gstin")} />
          </Field>
          <Field label="PAN">
            <input className={inputCls} value={business.pan} onChange={setBiz("pan")} />
          </Field>
          <Field label="Currency code">
            <input className={inputCls} value={business.currencyCode} placeholder="INR" onChange={setBiz("currencyCode")} />
          </Field>
          <Field label="Currency symbol">
            <input className={inputCls} value={business.currencySymbol} placeholder="₹" onChange={setBiz("currencySymbol")} />
          </Field>
        </div>
      </Card>
      <p className="text-xs text-neutral-500">Leave a field empty to let each service keep showing its own value.</p>
    </div>
  )
}

/* ---------------------------------------------------------------- Legal -- */

function LegalTab({ profile, onSaved }) {
  const [active, setActive] = useState("terms")
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(LEGAL.map(({ key }) => [key, legalHtmlToPlainText(profile.legal?.[key] || "")])),
  )
  const [busy, setBusy] = useState(false)
  const savedText = legalHtmlToPlainText(profile.legal?.[active] || "")
  const dirty = texts[active] !== savedText

  const save = async (value) => {
    setBusy(true)
    try {
      const html = value ? plainTextToLegalHtml(value) : null
      await onSaved(
        await platformSettingsAPI.updateProfile({ legal: { [active]: html } }),
        value ? "Saved. Every app now shows this page." : "Cleared. Each service shows its own page again.",
      )
      if (!value) setTexts((t) => ({ ...t, [active]: "" }))
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setBusy(false)
    }
  }

  const current = LEGAL.find((l) => l.key === active)
  return (
    <Card
      title="Legal pages"
      description="Written once, shown in every customer app. A page Medical has written for itself stays."
      footer={
        <>
          {savedText && (
            <button type="button" className={ghostCls} disabled={busy} onClick={() => save("")}>
              Stop using this page
            </button>
          )}
          <button type="button" className={btnCls} disabled={!dirty || busy || !texts[active].trim()} onClick={() => save(texts[active])}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save {current.label}
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LEGAL.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${active === key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
          >
            {label}
            {profile.legal?.[key] ? " ✓" : ""}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-neutral-500">
        {savedText ? "Every app shows this page." : "Not set here: each service still shows its own page. Write it here to use one page everywhere."}
      </p>
      <textarea
        rows={16}
        className={`${inputCls} font-mono text-[13px] leading-relaxed`}
        value={texts[active]}
        placeholder={`Write the ${current.label} here…`}
        onChange={(e) => setTexts((t) => ({ ...t, [active]: e.target.value }))}
      />
    </Card>
  )
}

/* --------------------------------------------------------- Integrations -- */

function InUse({ source, children }) {
  return (
    <p className={`mb-4 flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs ${source === "master" ? "bg-emerald-50 text-emerald-800" : "bg-neutral-50 text-neutral-600"}`}>
      <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        {source === "master" ? "Using the values saved here." : "Nothing saved here yet: using the server's configuration file."} {children}
      </span>
    </p>
  )
}

function IntegrationCard({ kind, title, description, initial, fields, inUse, testExtra, onSaved, saveNote }) {
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState("")
  const [extra, setExtra] = useState("")
  const set = (k) => (e) => setValues((o) => ({ ...o, [k]: e.target.value }))

  const test = async () => {
    setBusy("test")
    try {
      const res = await platformSettingsAPI.testIntegration(kind, { ...values, ...(testExtra ? { [testExtra.key]: extra } : {}) })
      toast.success(res?.data?.message || "Works")
    } catch (err) {
      toast.error(errText(err, "Test failed"))
    } finally {
      setBusy("")
    }
  }
  const save = async () => {
    if (saveNote && !window.confirm(saveNote)) return
    setBusy("save")
    try {
      await onSaved(await platformSettingsAPI.updateProfile({ integrations: { [kind]: values } }), `${title} saved. It is used from now on.`)
    } catch (err) {
      toast.error(errText(err, "Could not save"))
    } finally {
      setBusy("")
    }
  }

  return (
    <Card
      title={title}
      description={description}
      footer={
        <>
          {testExtra && (
            <input className={`${inputCls} w-56`} placeholder={testExtra.placeholder} value={extra} onChange={(e) => setExtra(e.target.value)} />
          )}
          <button type="button" className={ghostCls} disabled={!!busy} onClick={test}>
            {busy === "test" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Test
          </button>
          <button type="button" className={btnCls} disabled={!!busy} onClick={save}>
            {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </>
      }
    >
      {inUse}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} wide={f.wide}>
            {f.textarea ? (
              <textarea rows={3} className={inputCls} value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={set(f.key)} />
            ) : (
              <input
                type={f.secret ? "password" : f.type || "text"}
                autoComplete="off"
                className={inputCls}
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onFocus={(e) => f.secret && String(e.target.value).startsWith("•") && setValues((o) => ({ ...o, [f.key]: "" }))}
                onChange={set(f.key)}
              />
            )}
          </Field>
        ))}
      </div>
    </Card>
  )
}

function IntegrationsTab({ profile, onSaved }) {
  const { razorpay, sms, email } = profile.integrations
  return (
    <div className="space-y-5">
      <IntegrationCard
        kind="razorpay"
        title="Razorpay (online payments)"
        description="The account every online payment goes to, in every service."
        initial={{ keyId: razorpay.keyId, keySecret: razorpay.keySecret, webhookSecret: razorpay.webhookSecret }}
        inUse={
          <InUse source={razorpay.inUse.source}>
            Current key: <b>{razorpay.inUse.keyId || "none"}</b>
            {razorpay.inUse.mode === "test" && <span className="ml-1 font-semibold text-amber-700">(TEST mode: no real money is collected)</span>}
          </InUse>
        }
        fields={[
          { key: "keyId", label: "Key id", placeholder: "rzp_live_…", wide: true },
          { key: "keySecret", label: "Key secret", secret: true, placeholder: "Leave as is to keep the saved one" },
          { key: "webhookSecret", label: "Webhook secret", secret: true, hint: "From Razorpay > Webhooks", placeholder: "Leave as is to keep the saved one" },
        ]}
        saveNote="New Razorpay keys are used for every payment from now on. Payments already started with the old keys may fail to confirm. Test first. Continue?"
        onSaved={onSaved}
      />
      <IntegrationCard
        kind="sms"
        title="SMS (OTP codes)"
        description="SMS India Hub account used to send login codes in every app."
        initial={{ apiKey: sms.apiKey, senderId: sms.senderId, templateId: sms.templateId, templateText: sms.templateText }}
        inUse={
          <InUse source={sms.inUse.source}>
            {sms.inUse.configured ? <>Sender id: <b>{sms.inUse.senderId || "—"}</b></> : <b>No SMS account is set up.</b>}
          </InUse>
        }
        fields={[
          { key: "apiKey", label: "API key", secret: true, placeholder: "Leave as is to keep the saved one" },
          { key: "senderId", label: "Sender id", placeholder: "QKDROP" },
          { key: "templateId", label: "DLT template id", placeholder: "1007…" },
          { key: "templateText", label: "Message", hint: "Must match the DLT template exactly. Put {{OTP}} where the code goes.", textarea: true, wide: true, placeholder: "Your Quick Drop code is {{OTP}}. Valid for {{MINUTES}} minutes." },
        ]}
        testExtra={{ key: "phone", placeholder: "Mobile number to send a test" }}
        saveNote="Login codes in every app will be sent with this account from now on. Send a test first. Continue?"
        onSaved={onSaved}
      />
      <IntegrationCard
        kind="email"
        title="Email"
        description="Mail server for invoices, password resets and notifications."
        initial={{ host: email.host, port: email.port ?? "", user: email.user, pass: email.pass, from: email.from }}
        inUse={
          <InUse source={email.inUse.source}>
            {email.inUse.configured ? <>Sending as <b>{email.inUse.from}</b> via {email.inUse.host}</> : <b>No mail server is set up.</b>}
          </InUse>
        }
        fields={[
          { key: "host", label: "Mail server", placeholder: "smtp.gmail.com" },
          { key: "port", label: "Port", type: "number", placeholder: "587" },
          { key: "user", label: "Username", placeholder: "you@yourdomain.com" },
          { key: "pass", label: "Password", secret: true, placeholder: "Leave as is to keep the saved one" },
          { key: "from", label: "Send as", placeholder: "Quick Drop <noreply@quickdropsindia.com>", wide: true },
        ]}
        testExtra={{ key: "sendTo", placeholder: "Email to send a test (optional)" }}
        onSaved={onSaved}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- Page -- */

export default function PlatformSettings() {
  // The tab is in the URL (/admin/master/settings/legal) so the Master sidebar
  // can link straight to one, and a reload stays on it.
  const { tab: tabParam } = useParams()
  const navigate = useNavigate()
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam : "brand"
  const setTab = (key) => navigate(`/admin/master/settings/${key}`, { replace: true })
  const [profile, setProfile] = useState(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await platformSettingsAPI.getProfile()
      setProfile(res?.data?.data)
      setVersion((v) => v + 1)
    } catch (err) {
      toast.error(errText(err, "Could not load master settings"))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onSaved = async (res, message) => {
    setProfile(res?.data?.data)
    setVersion((v) => v + 1)
    toast.success(message)
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Master settings</h1>
          <p className="mt-1 text-sm text-neutral-600">Set once here for Food, Quick Commerce, Medical and Taxi.</p>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {/* shrink-0, not flex-1: with nowrap labels flex-1 squeezed each tab
              below its text width and they drew over one another. */}
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${tab === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {tab === "money" ? (
          <CashLimitSettings />

        ) : tab === "appTerms" ? (
          <AppLegalPages />
        ) : !profile ? (
          <div className="flex items-center gap-2 py-10 text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading settings
          </div>
        ) : tab === "brand" ? (
          <BrandTab key={version} profile={profile} onSaved={onSaved} />
        ) : tab === "legal" ? (
          <LegalTab key={version} profile={profile} onSaved={onSaved} />
        ) : (
          <IntegrationsTab key={version} profile={profile} onSaved={onSaved} />
        )}
      </div>
    </div>
  )
}
