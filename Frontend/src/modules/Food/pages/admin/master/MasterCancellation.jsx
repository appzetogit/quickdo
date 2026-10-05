import { useState, useEffect, useCallback } from "react"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Ban, Info } from "lucide-react"
import ZonePicker from "./ZonePicker"
import { useAdminAccess, isRestricted, can, hasPanel } from "@food/utils/adminAccess"

/**
 * Master > Cancellation Policy: how long a customer may cancel after the
 * restaurant or store accepts, set once for Food and Quick & Medical
 * (modules/food/orders/services/cancellationPolicy.js on the server).
 *
 * Each setting has three states: the service's own (not set here), on, off.
 * Unset keeps Food's Order cancellation screen and Quick's "only before the
 * store accepts". Never once the rider has picked the order up, whatever is set.
 */

const KEYS = {
  holdSeconds: "orders.holdSeconds",
  allowAfterAccept: "orders.cancelAfterAccept",
  windowMinutes: "orders.cancelWindowMinutes",
  stopWhenPreparing: "orders.cancelStopWhenPreparing",
}

const SCOPES = [
  { id: "*", level: "global", label: "All services" },
  { id: "food", level: "vertical", label: "Food" },
  { id: "quickCommerce", level: "vertical", label: "Quick & Medical" },
]
const SERVICE_LABEL = { food: "Food", quickCommerce: "Quick & Medical" }
// Whose zones each tab's zone picker lists. A pharmacy order carries a Medical zone.
const ZONE_MODULES = { "*": ["food", "quickCommerce", "medical"], food: ["food"], quickCommerce: ["quickCommerce", "medical"] }

const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

const savedAt = (setting, level, scopeId) => {
  const link = (setting?.chain || []).find((l) => l.level === level && (level === "global" || l.scopeId === scopeId))
  return link?.set ? link.value : null
}

/** 90 -> "90 sec", 120 -> "2 min". */
const holdText = (sec) => (sec % 60 === 0 && sec >= 60 ? `${sec / 60} min` : `${sec} sec`)

function describe(r) {
  const hold = r.holdSeconds > 0 ? `Held ${holdText(r.holdSeconds)} before the restaurant sees it. ` : ""
  if (!r.allowAfterAccept) return `${hold}Cancel only before it is accepted`
  return `${hold}Cancel up to ${r.windowMinutes} min after acceptance${r.stopWhenPreparing ? ", until preparing starts" : ""}`
}

/** Service's own / On / Off. `null` is "not set here". */
function TriState({ value, onChange, label, disabled, ownLabel }) {
  const opts = [
    { v: null, text: ownLabel },
    { v: true, text: "On" },
    { v: false, text: "Off" },
  ]
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-neutral-100 p-0.5 text-sm">
      {opts.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${value === o.v ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

function Setting({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export default function MasterCancellation() {
  const [scopeId, setScopeId] = useState("*")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState({ holdSeconds: null, allowAfterAccept: null, windowMinutes: null, stopWhenPreparing: null })
  // The hold is stored in seconds; the admin may type it in minutes.
  const [holdUnit, setHoldUnit] = useState("sec")
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
  // A zone of the current service, or none: the service's own value.
  const [zone, setZone] = useState({ id: "", name: "" })
  const target = zone.id
    ? { level: "zone", scopeId: zone.id, label: `${scope.label} · ${zone.name}` }
    : { level: scope.level, scopeId: scope.level === "global" ? "*" : scopeId, label: scope.label }
  const canEdit = !limited || (Boolean(zone.id) && can(access, "zone_orders", "write"))
  const ownLabel = zone.id ? `${scope.label}'s value` : scope.id === "*" ? "Each service's own" : `${scope.label}'s own`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const context = {
        ...(scopeId === "*" ? {} : { vertical: scopeId }),
        ...(zone.id ? { zoneId: zone.id } : {}),
      }
      const names = Object.keys(KEYS)
      const [ov, ...explained] = await Promise.all([
        platformSettingsAPI.cancellationOverview(),
        ...names.map((n) => platformSettingsAPI.explain(KEYS[n], context)),
      ])
      setOverview(ov?.data?.data || null)
      setValues(Object.fromEntries(names.map((n, i) => [n, savedAt(explained[i]?.data?.data, target.level, target.scopeId)])))
    } catch (err) {
      toast.error(errText(err, "Could not load the cancellation policy"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId, scope.level, zone.id])

  useEffect(() => {
    load()
  }, [load])

  const set = (name) => (v) => setValues((c) => ({ ...c, [name]: v }))
  const minutes = values.windowMinutes
  const minutesOk = minutes === null || (Number.isInteger(Number(minutes)) && minutes >= 1 && minutes <= 120)
  const hold = values.holdSeconds
  const holdOk = hold === null || (Number.isInteger(Number(hold)) && hold >= 0 && hold <= 600)
  const holdShown = hold === null ? "" : holdUnit === "min" ? Math.round((hold / 60) * 100) / 100 : hold
  const setHold = (raw) => {
    if (raw === "") return set("holdSeconds")(null)
    const n = Number(raw)
    set("holdSeconds")(Math.round(holdUnit === "min" ? n * 60 : n))
  }

  const save = async () => {
    if (!minutesOk) return toast.error("Choose between 1 and 120 minutes")
    if (!holdOk) return toast.error("The hold can be at most 10 minutes (600 seconds)")
    setSaving(true)
    try {
      await Promise.all(Object.keys(KEYS).map((n) => platformSettingsAPI.set(KEYS[n], { level: target.level, scopeId: target.scopeId, value: values[n] })))
      toast.success(`Cancellation policy saved for ${target.label}. It applies to orders straight away.`)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save the cancellation policy"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Cancellation policy</h1>
          <p className="mt-1 text-sm text-neutral-600">How long new orders wait before reaching the restaurant, and how long a customer can still cancel after it accepts.</p>
        </div>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 className="font-semibold text-neutral-900">In force right now</h2>
            <p className="mt-0.5 text-sm text-neutral-500">Customers can always cancel while an order waits to be accepted, and never once the rider has it.</p>
          </div>
          <ul className="divide-y divide-neutral-100">
            {!overview ? (
              <li className="px-5 py-6 text-sm text-neutral-500">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading
              </li>
            ) : (
              overview.services.map((s) => {
                const fromMaster = Object.values(s.source || {}).includes("master")
                return (
                  <li key={s.vertical} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="font-medium text-neutral-900">{SERVICE_LABEL[s.vertical] || s.vertical}</span>
                    <span className="text-neutral-700">
                      {describe(s)}
                      <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${fromMaster ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"}`}>
                        {fromMaster ? "Master" : "Own"}
                      </span>
                    </span>
                  </li>
                )
              })
            )}
          </ul>
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
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
            <div className="min-w-0">
              <h2 className="font-semibold text-neutral-900">{scope.id === "*" ? "For every service" : `Only for ${target.label}`}</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                {scope.id === "*"
                  ? "Applies to Food and Quick & Medical unless a service or zone has its own value."
                  : zone.id
                    ? `Overrides ${scope.label}'s value for orders in ${zone.name} only. Empty fields keep ${scope.label}'s value.`
                    : `Overrides the "All services" value for ${scope.label}.`}
              </p>
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                &ldquo;{ownLabel}&rdquo; leaves it to the service: Food&rsquo;s Order cancellation screen, and for Quick &amp; Medical, cancelling only
                before the store accepts. When a customer cancels an accepted order, the restaurant or store is told to stop, and any assigned
                rider is told not to pick it up.
              </p>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading
              </div>
            ) : (
              <div className="space-y-5">
                <Setting
                  label="Hold new orders before they reach the restaurant"
                  hint="The order waits this long before the restaurant or store is alerted; the customer can cancel free meanwhile. 0 sends orders straight away. Empty keeps the all-services value."
                >
                  <div className="flex w-56 gap-2">
                    <input
                      type="number"
                      min="0"
                      max={holdUnit === "min" ? 10 : 600}
                      step={holdUnit === "min" ? 0.5 : 5}
                      inputMode="decimal"
                      placeholder={scope.id === "*" ? "0" : "All services"}
                      aria-label="Hold before the restaurant sees the order"
                      aria-invalid={!holdOk}
                      value={holdShown}
                      disabled={saving}
                      onChange={(e) => setHold(e.target.value)}
                      className={`w-full rounded-lg border bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900/10 ${holdOk ? "border-neutral-300 focus:border-neutral-900" : "border-red-400"}`}
                    />
                    <select
                      aria-label="Unit"
                      value={holdUnit}
                      disabled={saving}
                      onChange={(e) => setHoldUnit(e.target.value)}
                      className="rounded-lg border border-neutral-300 bg-white px-2 py-2 text-sm"
                    >
                      <option value="sec">seconds</option>
                      <option value="min">minutes</option>
                    </select>
                  </div>
                </Setting>
                <Setting label="Allow cancelling after acceptance" hint="Off: the Cancel option disappears the moment the order is accepted.">
                  <TriState value={values.allowAfterAccept} onChange={set("allowAfterAccept")} label="Allow cancelling after acceptance" disabled={saving} ownLabel={ownLabel} />
                </Setting>
                <Setting label="For how many minutes" hint="Counted from when the restaurant or store accepted. Empty keeps the service's own.">
                  <div className="relative w-40">
                    <input
                      type="number"
                      min="1"
                      max="120"
                      step="1"
                      inputMode="numeric"
                      placeholder="Service's own"
                      aria-label="Minutes after acceptance"
                      aria-invalid={!minutesOk}
                      value={minutes === null ? "" : minutes}
                      disabled={saving}
                      onChange={(e) => set("windowMinutes")(e.target.value === "" ? null : Math.floor(Number(e.target.value)))}
                      className={`w-full rounded-lg border bg-white px-3 py-2 pr-12 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900/10 ${minutesOk ? "border-neutral-300 focus:border-neutral-900" : "border-red-400"}`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">min</span>
                  </div>
                </Setting>
                <Setting label="Stop once preparing starts" hint="On: cancelling closes when the kitchen or store marks it preparing, even inside the window.">
                  <TriState value={values.stopWhenPreparing} onChange={set("stopWhenPreparing")} label="Stop once preparing starts" disabled={saving} ownLabel={ownLabel} />
                </Setting>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
            <button type="button" className={btnCls} disabled={saving || loading || !minutesOk || !holdOk || !canEdit} onClick={save}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save for {target.label}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
