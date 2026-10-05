import { useState, useEffect, useCallback } from "react"
import { Link } from "react-router-dom"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Receipt, Info, ExternalLink } from "lucide-react"
import ZonePicker from "./ZonePicker"
import { useAdminAccess, isRestricted, can, hasPanel } from "@food/utils/adminAccess"

/**
 * Master > Platform Fee & GST: the platform fee on an order, and the GST on it,
 * set once for Food and Quick & Medical (core/finance/platformFees.service.js).
 *
 * Empty keeps each service's own fee setting, which is how it worked before.
 * GST on the platform fee is charged by Food and, since 2026-09-28, by Quick &
 * Medical too, at the rate set here (unset for Quick & Medical = not charged).
 */

const KEYS = { platformFee: "fees.platformFee", platformFeeGstRate: "fees.platformFeeGstRate" }

const SCOPES = [
  { id: "*", level: "global", label: "All services" },
  { id: "food", level: "vertical", label: "Food" },
  { id: "quickCommerce", level: "vertical", label: "Quick & Medical" },
]
const SERVICE_LABEL = { food: "Food", quickCommerce: "Quick & Medical" }
// Whose zones each tab's zone picker lists. A pharmacy order carries a Medical zone.
const ZONE_MODULES = { "*": ["food", "quickCommerce", "medical"], food: ["food"], quickCommerce: ["quickCommerce", "medical"] }

const OWN_SCREENS = [
  { label: "Food fee settings", path: "/admin/food/fee-settings" },
  { label: "Quick & Medical fee settings", path: "/admin/quick-commerce/fee-settings" },
  { label: "Taxi platform fee (per vehicle)", path: "/taxi/admin/pricing/set-price" },
]

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50 disabled:text-neutral-400"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

const savedAt = (setting, level, scopeId) => {
  const link = (setting?.chain || []).find((l) => l.level === level && (level === "global" || l.scopeId === scopeId))
  return link?.set ? link.value : null
}

function Source({ from }) {
  if (from === "master") return <span className="ml-1.5 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Master</span>
  if (from === "service") return <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Own</span>
  return null
}

function Row({ label, hint, value, onChange, prefix, suffix, max, disabled, note }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_11rem] sm:items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{note || hint}</p>
      </div>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">{prefix}</span>}
        <input
          type="number"
          min="0"
          max={max}
          step="0.01"
          inputMode="decimal"
          placeholder="Service's own"
          aria-label={label}
          className={`${inputCls} ${prefix ? "pl-7" : ""} ${suffix ? "pr-8" : ""}`}
          value={value === null || value === undefined ? "" : value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? null : Math.min(max, Math.max(0, Number(e.target.value))))}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">{suffix}</span>}
      </div>
    </div>
  )
}

export default function MasterFees() {
  const [scopeId, setScopeId] = useState("*")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState({ platformFee: null, platformFeeGstRate: null })
  const [overview, setOverview] = useState(null)

  // A zone sub-admin works only in their zones: no All services tab, only the
  // services they have, and saving only with Manage on this section.
  const access = useAdminAccess()
  const limited = isRestricted(access)
  const visibleScopes = limited
    ? SCOPES.filter((s) => s.id !== "*" && (s.id === "quickCommerce" ? hasPanel(access, "quickCommerce") || hasPanel(access, "medical") : hasPanel(access, s.id)))
    : SCOPES
  useEffect(() => {
    if (limited && visibleScopes.length && !visibleScopes.some((s) => s.id === scopeId)) setScopeId(visibleScopes[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limited, visibleScopes.length, scopeId])

  const scope = SCOPES.find((s) => s.id === scopeId) || SCOPES[0]
  const isQuick = scopeId === "quickCommerce"
  // A zone of the current service, or none: the service's own value.
  const [zone, setZone] = useState({ id: "", name: "" })
  const target = zone.id
    ? { level: "zone", scopeId: zone.id, label: `${scope.label} · ${zone.name}` }
    : { level: scope.level, scopeId: scope.level === "global" ? "*" : scopeId, label: scope.label }
  const canEdit = !limited || (Boolean(zone.id) && can(access, "zone_fees", "write"))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const context = {
        ...(scopeId === "*" ? {} : { vertical: scopeId }),
        ...(zone.id ? { zoneId: zone.id } : {}),
      }
      const [ov, fee, gst] = await Promise.all([
        platformSettingsAPI.feesOverview(),
        platformSettingsAPI.explain(KEYS.platformFee, context),
        platformSettingsAPI.explain(KEYS.platformFeeGstRate, context),
      ])
      setOverview(ov?.data?.data || null)
      setValues({
        platformFee: savedAt(fee?.data?.data, target.level, target.scopeId),
        platformFeeGstRate: savedAt(gst?.data?.data, target.level, target.scopeId),
      })
    } catch (err) {
      toast.error(errText(err, "Could not load platform fee settings"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, scope.level, zone.id])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const writes = [platformSettingsAPI.set(KEYS.platformFee, { level: target.level, scopeId: target.scopeId, value: values.platformFee })]
      writes.push(platformSettingsAPI.set(KEYS.platformFeeGstRate, { level: target.level, scopeId: target.scopeId, value: values.platformFeeGstRate }))
      await Promise.all(writes)
      toast.success(`Platform fee saved for ${target.label}`)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save platform fee settings"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Platform fee &amp; GST</h1>
          <p className="mt-1 text-sm text-neutral-600">The fee added to every order, set once for Food and Quick &amp; Medical.</p>
        </div>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 className="font-semibold text-neutral-900">Charged right now</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              <span className="font-medium text-neutral-700">Master</span> means set on this page;{" "}
              <span className="font-medium text-neutral-700">Own</span> means the service&rsquo;s fee settings.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">Service</th>
                  <th className="px-3 py-2.5 font-medium">Platform fee</th>
                  <th className="px-3 py-2.5 font-medium">GST on it</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {!overview ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-6 text-neutral-500">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      Loading
                    </td>
                  </tr>
                ) : (
                  overview.services.map((s) => (
                    <tr key={s.vertical}>
                      <td className="px-5 py-3 font-medium text-neutral-900">{SERVICE_LABEL[s.vertical] || s.vertical}</td>
                      <td className="px-3 py-3 tabular-nums">
                        ₹{Number(s.platformFee.value || 0).toLocaleString("en-IN")}
                        <Source from={s.platformFee.from} />
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {s.platformFeeGstRate.from === "not_charged" ? (
                          <span className="text-neutral-500">Not charged</span>
                        ) : (
                          <>
                            {s.platformFeeGstRate.value}%
                            <Source from={s.platformFeeGstRate.from} />
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
                <tr>
                  <td className="px-5 py-3 font-medium text-neutral-900">Taxi</td>
                  <td colSpan={2} className="px-3 py-3 text-neutral-500">Set per vehicle on Taxi&rsquo;s price screen</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
          {visibleScopes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setScopeId(s.id)
                setZone({ id: "", name: "" })
              }}
              className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${scopeId === s.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {limited && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              You manage your zones only. Values head office sets for a whole module or all modules apply wherever your
              zone has none of its own; you can see them here but not change them.
            </p>
          )}
        {(
          <ZonePicker
            modules={ZONE_MODULES[scopeId] || []}
            value={zone.id}
            required={limited}
            allLabel={scopeId === "*" ? "All zones" : `All zones (${scope.label} default)`}
            disabled={saving}
            onChange={(id, name) => setZone({ id, name })}
          />
        )}

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
            <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
            <div className="min-w-0">
              <h2 className="font-semibold text-neutral-900">{scope.id === "*" ? "For every service" : `Only for ${target.label}`}</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                {scope.id === "*"
                  ? "Applies to Food and Quick & Medical unless a service has its own value in its tab."
                  : zone.id
                    ? `Overrides ${scope.label}'s value for orders in ${zone.name} only. Leave empty to use ${scope.label}'s.`
                    : `Overrides the "All services" value for ${scope.label}. Leave empty to use it.`}
              </p>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Leave a box empty and the service keeps its own setting. Enter 0 to charge no platform fee.
                Changes apply to the next cart a customer opens.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading
              </div>
            ) : (
              <div className="space-y-5">
                <Row
                  label="Platform fee per order"
                  hint="A flat amount added to every order's bill."
                  value={values.platformFee}
                  onChange={(v) => setValues((c) => ({ ...c, platformFee: v }))}
                  prefix="₹"
                  max={1000}
                  disabled={saving}
                />
                <Row
                  label="GST on the platform fee"
                  hint="Added on top of the platform fee, on Food and Quick & Medical orders."
                  value={values.platformFeeGstRate}
                  onChange={(v) => setValues((c) => ({ ...c, platformFeeGstRate: v }))}
                  suffix="%"
                  max={100}
                  disabled={saving}
                  note={isQuick ? "Also applies to Medical (pharmacy) orders." : ""}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
            <button type="button" className={btnCls} disabled={saving || loading || !canEdit} onClick={save}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save for {target.label}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-900">Other charges stay with each service</h2>
          <p className="mt-0.5 text-sm text-neutral-500">Delivery fees, packaging, cash-on-delivery limits, and Taxi&rsquo;s per-vehicle platform fee.</p>
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
