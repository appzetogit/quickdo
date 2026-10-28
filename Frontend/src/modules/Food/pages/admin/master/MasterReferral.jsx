import { useState, useEffect, useCallback } from "react"
import { Link } from "react-router-dom"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Gift, Info, ExternalLink } from "lucide-react"

/**
 * Master > Referral: what a referral pays, set once for every service.
 *
 * Food, Quick & Medical and Taxi each still decide WHEN they pay (at sign-up,
 * on rider approval, after a number of rides) on their own screens. The AMOUNT
 * and the cap per person are set here, for all of them or for one
 * (core/referral/referralSettings.service.js on the server).
 *
 * Empty keeps each service's own number, which is how it worked before; the
 * table at the top shows what is being paid right now and where it comes from.
 */

const KEYS = {
  customerReward: "referral.customerReward",
  customerLimit: "referral.customerLimit",
  partnerReward: "referral.partnerReward",
  partnerLimit: "referral.partnerLimit",
}

const SCOPES = [
  { id: "*", level: "global", label: "All services" },
  { id: "food", level: "vertical", label: "Food" },
  { id: "quickCommerce", level: "vertical", label: "Quick & Medical" },
  { id: "taxi", level: "vertical", label: "Taxi" },
]

const SERVICE_LABEL = { food: "Food", quickCommerce: "Quick & Medical", taxi: "Taxi" }

// Each service's own referral screen, for the rules Master does not set.
const OWN_SCREENS = [
  { label: "Food referral rules", path: "/admin/food/referral-settings" },
  { label: "Quick & Medical referral rules", path: "/admin/quick-commerce/referral-settings" },
  { label: "Taxi customer referral rules", path: "/taxi/admin/referrals/user-settings" },
  { label: "Taxi driver referral rules", path: "/taxi/admin/referrals/driver-settings" },
]

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50 disabled:text-neutral-400"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`

/** The value saved at one level, as opposed to the one merely in force there. */
const savedAt = (setting, level, scopeId) => {
  const link = (setting?.chain || []).find((l) => l.level === level && (level === "global" || l.scopeId === scopeId))
  return link?.set ? link.value : null
}

function Row({ label, hint, value, onChange, money, min, disabled, disabledNote }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_11rem] sm:items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{disabledNote || hint}</p>
      </div>
      <div className="relative">
        {money && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">₹</span>}
        <input
          type="number"
          min={min}
          step="1"
          inputMode="numeric"
          placeholder="Service's own"
          aria-label={label}
          className={`${inputCls} ${money ? "pl-7" : ""}`}
          value={value === null || value === undefined ? "" : value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.max(min, Math.floor(Number(e.target.value))))}
        />
      </div>
    </div>
  )
}

function Source({ from }) {
  if (from === "master") return <span className="ml-1.5 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Master</span>
  if (from === "service") return <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Own</span>
  return null
}

function Cell({ field, money }) {
  if (!field || field.from === "none") return <span className="text-neutral-400">No cap</span>
  const v = field.value
  const shown = money ? rupees(v) : Number(v) > 0 ? `${v} people` : "Off"
  return (
    <span className="whitespace-nowrap tabular-nums">
      {shown}
      <Source from={field.from} />
    </span>
  )
}

export default function MasterReferral() {
  const [scopeId, setScopeId] = useState("*")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState({ customerReward: null, customerLimit: null, partnerReward: null, partnerLimit: null })
  const [overview, setOverview] = useState(null)

  const scope = SCOPES.find((s) => s.id === scopeId) || SCOPES[0]
  const isTaxi = scopeId === "taxi"

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const context = scopeId === "*" ? {} : { vertical: scopeId }
      const names = Object.keys(KEYS)
      const [ov, ...explained] = await Promise.all([
        platformSettingsAPI.referralOverview(),
        ...names.map((n) => platformSettingsAPI.explain(KEYS[n], context)),
      ])
      setOverview(ov?.data?.data || null)
      setValues(Object.fromEntries(names.map((n, i) => [n, savedAt(explained[i]?.data?.data, scope.level, scopeId)])))
    } catch (err) {
      toast.error(errText(err, "Could not load referral settings"))
    } finally {
      setLoading(false)
    }
  }, [scopeId, scope.level])

  useEffect(() => {
    load()
  }, [load])

  const set = (name) => (v) => setValues((cur) => ({ ...cur, [name]: v }))

  const save = async () => {
    setSaving(true)
    try {
      const id = scope.level === "global" ? "*" : scopeId
      // Taxi has no per-person cap, so its caps are never written.
      const names = Object.keys(KEYS).filter((n) => !(isTaxi && n.endsWith("Limit")))
      await Promise.all(names.map((n) => platformSettingsAPI.set(KEYS[n], { level: scope.level, scopeId: id, value: values[n] })))
      toast.success(`Referral saved for ${scope.label}`)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save referral settings"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Referral</h1>
          <p className="mt-1 text-sm text-neutral-600">What an invite pays, set once for Food, Quick &amp; Medical and Taxi.</p>
        </div>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 className="font-semibold text-neutral-900">Paid right now</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              <span className="font-medium text-neutral-700">Master</span> means set on this page;{" "}
              <span className="font-medium text-neutral-700">Own</span> means the service&rsquo;s own referral screen.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">Service</th>
                  <th className="px-3 py-2.5 font-medium">Per customer invited</th>
                  <th className="px-3 py-2.5 font-medium">Cap</th>
                  <th className="px-3 py-2.5 font-medium">Per rider / driver</th>
                  <th className="px-3 py-2.5 font-medium">Cap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {!overview ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-6 text-neutral-500">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      Loading
                    </td>
                  </tr>
                ) : (
                  overview.services.map((s) => (
                    <tr key={s.vertical}>
                      <td className="px-5 py-3 font-medium text-neutral-900">
                        {SERVICE_LABEL[s.vertical] || s.vertical}
                        {s.afterRides && (
                          <span className="block text-xs font-normal text-neutral-500">
                            Paid after {s.afterRides.user || 0} ride{s.afterRides.user === 1 ? "" : "s"} (customers)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3"><Cell field={s.customerReward} money /></td>
                      <td className="px-3 py-3"><Cell field={s.customerLimit} /></td>
                      <td className="px-3 py-3"><Cell field={s.partnerReward} money /></td>
                      <td className="px-3 py-3"><Cell field={s.partnerLimit} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScopeId(s.id)}
              className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${scopeId === s.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
            <Gift className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
            <div className="min-w-0">
              <h2 className="font-semibold text-neutral-900">{scope.id === "*" ? "For every service" : `Only for ${scope.label}`}</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                {scope.id === "*"
                  ? "Applies everywhere unless a service has its own value in its tab."
                  : `Overrides the "All services" value for ${scope.label}. Leave empty to use it.`}
              </p>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Leave a box empty and the service keeps paying what its own screen says. Enter 0 to switch that reward off.
                When a reward is paid (at sign-up, on approval, after rides) stays on each service&rsquo;s own screen.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading
              </div>
            ) : (
              <div className="space-y-5">
                <Row
                  label="Reward for inviting a customer"
                  hint="Credited to the wallet of the person whose invite brought a new customer."
                  value={values.customerReward}
                  onChange={set("customerReward")}
                  money
                  min={0}
                  disabled={saving}
                />
                <Row
                  label="Rewarded customer invites per person"
                  hint="After this many rewarded invites, a customer earns nothing more."
                  value={values.customerLimit}
                  onChange={set("customerLimit")}
                  min={1}
                  disabled={saving || isTaxi}
                  disabledNote={isTaxi ? "Taxi has no cap on invites." : ""}
                />
                <Row
                  label="Reward for inviting a rider or driver"
                  hint="Credited to the rider or driver who brought in a new one."
                  value={values.partnerReward}
                  onChange={set("partnerReward")}
                  money
                  min={0}
                  disabled={saving}
                />
                <Row
                  label="Rewarded rider or driver invites per person"
                  hint="Food and Quick riders stop earning after this many. Taxi has no cap."
                  value={values.partnerLimit}
                  onChange={set("partnerLimit")}
                  min={1}
                  disabled={saving || isTaxi}
                  disabledNote={isTaxi ? "Taxi has no cap on invites." : ""}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
            <button type="button" className={btnCls} disabled={saving || loading} onClick={save}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save for {scope.label}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Rules that stay with each service</h2>
          <p className="mt-0.5 text-sm text-neutral-500">When a reward is paid, invite links, and Taxi&rsquo;s driver milestones.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {OWN_SCREENS.map((s) => (
              <li key={s.path}>
                <Link to={s.path} className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-800 hover:underline">
                  {s.label}
                  <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
