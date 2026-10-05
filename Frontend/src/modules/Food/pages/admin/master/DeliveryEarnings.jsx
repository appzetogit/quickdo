import { useState, useEffect, useCallback, useMemo } from "react"
import { Link } from "react-router-dom"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Plus, Trash2, RotateCcw, Bike, Gift, Calculator } from "lucide-react"
import ZonePicker from "./ZonePicker"
import { useAdminAccess, isRestricted, can, hasPanel } from "@food/utils/adminAccess"

/**
 * Master > Delivery earnings: what the customer pays for delivery and what the
 * rider earns, set as two separate lines.
 *
 *     customer pays  = base fee for the first N km + per km after that
 *     rider earns    = base pay for the first N km + per km after that
 *     platform keeps = the difference
 *
 * It replaces the distance-band table, whose "per km" was the customer's rate
 * and whose rider pay was the customer's fee less a commission % set elsewhere.
 * The server does the real pricing (core/finance/deliveryFormula.js); the
 * preview below repeats the same arithmetic so an admin sees the result before
 * saving.
 *
 * "For one module or all" is the override chain: saving under All modules sets
 * the global formula; saving under Food overrides it for food only; clearing an
 * override drops back to global. Until a formula is saved anywhere, each module
 * keeps its old table, and the page opens on that table translated into the
 * formula, so saving without edits changes no price.
 */

const FORMULA_KEY = "earnings.formula"
const INCENTIVE_KEY = "earnings.incentive"
const PREVIEW_KM = [1, 3, 5, 10, 15]

const MODULES = [
  { id: "*", level: "global", label: "All modules", hint: "The formula every module uses unless it has its own" },
  { id: "food", level: "vertical", label: "Food", hint: "Overrides the all-modules formula for food" },
  { id: "quickCommerce", level: "vertical", label: "Quick Commerce", hint: "Overrides it for grocery orders" },
  { id: "medical", level: "vertical", label: "Medical", hint: "Overrides it for pharmacy orders" },
  // Rides are priced by base fare, per km and per minute in the Taxi panel.
  { id: "taxi", level: "vertical", label: "Taxi", hint: "Driver incentive only — ride fares are set in the Taxi panel", incentiveOnly: true },
]

/**
 * Whose zones the zone picker lists for each tab. A zone value is keyed by the
 * zone alone, so on All modules every delivery zone is listed, by module.
 */
const ZONE_MODULES = { "*": ["food", "quickCommerce", "medical"], food: ["food"], quickCommerce: ["quickCommerce"], medical: ["medical"], taxi: ["taxi"] }

/** Which module's figures to READ when showing "what is charged today". */
const readVertical = (moduleId) => (moduleId === "*" ? "food" : moduleId)

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback
const num = (v) => (v === "" || v === null || v === undefined ? "" : Number(v))
const rupees = (n) => `₹${(Math.round(Number(n) * 100) / 100).toLocaleString("en-IN")}`

const emptyFormula = () => ({
  mode: "simple",
  customer: { base: 0, includedKm: 0, perKm: 0 },
  rider: { base: 0, includedKm: 0, perKm: 0 },
  minFee: null,
  maxFee: null,
  bands: [],
})

/** The same arithmetic as the server's priceDelivery (core/finance/deliveryFormula.js). */
function priceDelivery(f, km) {
  if (!f) return null
  let fee
  let pay
  if (f.mode === "bands" && f.bands?.length) {
    const sorted = [...f.bands].sort((a, b) => Number(a.fromKm) - Number(b.fromKm))
    const band =
      sorted.find((b) => km >= Number(b.fromKm) && (b.toKm === null || b.toKm === "" || km < Number(b.toKm))) ||
      sorted[sorted.length - 1]
    const past = Math.max(0, km - Number(band.fromKm || 0))
    fee = Number(band.customerFee || 0) + Number(band.customerPerKm || 0) * past
    pay = Number(band.riderPay || 0) + Number(band.riderPerKm || 0) * past
  } else {
    const c = f.customer || {}
    const r = f.rider || {}
    fee = Number(c.base || 0) + Number(c.perKm || 0) * Math.max(0, km - Number(c.includedKm || 0))
    pay = Number(r.base || 0) + Number(r.perKm || 0) * Math.max(0, km - Number(r.includedKm || 0))
  }
  if (f.minFee !== null && f.minFee !== "" && f.minFee !== undefined) fee = Math.max(fee, Number(f.minFee))
  if (f.maxFee !== null && f.maxFee !== "" && f.maxFee !== undefined) fee = Math.min(fee, Number(f.maxFee))
  const r2 = (n) => Math.round(n * 100) / 100
  return { fee: r2(fee), pay: r2(pay), keeps: r2(fee - pay) }
}

/** Simple formula -> bands, so switching to bands starts from the same prices. */
function bandsFromSimple(f) {
  const c = f.customer
  const r = f.rider
  const split = Number(c.includedKm) > 0 && Number(c.includedKm) === Number(r.includedKm)
  if (split) {
    const at = Number(c.includedKm)
    return [
      { fromKm: 0, toKm: at, customerFee: c.base, customerPerKm: 0, riderPay: r.base, riderPerKm: 0 },
      { fromKm: at, toKm: null, customerFee: c.base, customerPerKm: c.perKm, riderPay: r.base, riderPerKm: r.perKm },
    ]
  }
  return [{ fromKm: 0, toKm: null, customerFee: c.base, customerPerKm: c.perKm, riderPay: r.base, riderPerKm: r.perKm }]
}

function Card({ title, description, icon: Icon, children, footer }) {
  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
        {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />}
        <div className="min-w-0">
          <h2 className="font-semibold text-neutral-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
          {footer}
        </div>
      )}
    </section>
  )
}

/** Where the value in force came from, in words an operator can act on. */
function SourceLine({ tone = "ok", children }) {
  const cls =
    tone === "warn" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>
}

function Money({ value, onChange, disabled, step = 1, placeholder }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-neutral-400">₹</span>
      <input
        type="number"
        min="0"
        step={step}
        className={`${inputCls} pl-6`}
        value={num(value)}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? (placeholder ? null : 0) : Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  )
}

/** One side of the simple formula: "₹X for the first N km, then ₹Y per km". */
function SideRow({ label, hint, value, onChange, disabled }) {
  const set = (field) => (v) => onChange({ ...value, [field]: v ?? 0 })
  return (
    <div className="grid items-end gap-3 border-b border-neutral-100 py-3 last:border-0 sm:grid-cols-[9rem_1fr_1fr_1fr]">
      <div>
        <div className="text-sm font-semibold text-neutral-900">{label}</div>
        <div className="text-xs text-neutral-500">{hint}</div>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Base</span>
        <Money value={value.base} onChange={set("base")} disabled={disabled} />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Covers the first (km)</span>
        <input
          type="number"
          min="0"
          step="0.5"
          className={inputCls}
          value={num(value.includedKm)}
          onChange={(e) => set("includedKm")(e.target.value === "" ? 0 : Number(e.target.value))}
          disabled={disabled}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-neutral-600">Then per extra km</span>
        <Money value={value.perKm} onChange={set("perKm")} disabled={disabled} />
      </label>
    </div>
  )
}

function BandRow({ band, onChange, onRemove, disabled, isLast }) {
  const set = (field) => (v) => onChange({ ...band, [field]: v })
  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="py-2 pr-2">
        <input type="number" min="0" step="0.5" className={inputCls} value={num(band.fromKm)} onChange={(e) => set("fromKm")(e.target.value === "" ? 0 : Number(e.target.value))} disabled={disabled} />
      </td>
      <td className="py-2 pr-2">
        <input
          type="number"
          min="0"
          step="0.5"
          className={inputCls}
          value={band.toKm === null ? "" : num(band.toKm)}
          placeholder={isLast ? "No limit" : ""}
          onChange={(e) => set("toKm")(e.target.value === "" ? null : Number(e.target.value))}
          disabled={disabled}
        />
      </td>
      <td className="py-2 pr-2"><Money value={band.customerFee} onChange={(v) => set("customerFee")(v ?? 0)} disabled={disabled} /></td>
      <td className="py-2 pr-2"><Money value={band.customerPerKm} onChange={(v) => set("customerPerKm")(v ?? 0)} disabled={disabled} /></td>
      <td className="py-2 pr-2"><Money value={band.riderPay} onChange={(v) => set("riderPay")(v ?? 0)} disabled={disabled} /></td>
      <td className="py-2 pr-2"><Money value={band.riderPerKm} onChange={(v) => set("riderPerKm")(v ?? 0)} disabled={disabled} /></td>
      <td className="py-2 text-right">
        <button type="button" onClick={onRemove} disabled={disabled} className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" aria-label="Remove band">
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

export default function DeliveryEarnings() {
  const [moduleId, setModuleId] = useState("*")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [data, setData] = useState(null)
  const [formula, setFormula] = useState(emptyFormula())
  const [incentive, setIncentive] = useState({ isEnabled: false, minOrderAmount: 0, incentivePercent: 0 })
  const [chain, setChain] = useState(null)
  // A zone of the current module, or none: the module's own default.
  const [zone, setZone] = useState({ id: "", name: "" })

  // A zone sub-admin works only in their zones: no All modules tab, only the
  // modules they have, and saving only with Manage on zone earnings.
  const access = useAdminAccess()
  const limited = isRestricted(access)
  const visibleModules = limited
    ? MODULES.filter((m) => m.id !== "*" && (m.id === "medical" ? hasPanel(access, "medical") || hasPanel(access, "quickCommerce") : hasPanel(access, m.id)))
    : MODULES
  useEffect(() => {
    if (limited && visibleModules.length && !visibleModules.some((m) => m.id === moduleId)) setModuleId(visibleModules[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limited, visibleModules.length, moduleId])
  const canEdit = !limited || (Boolean(zone.id) && can(access, "zone_earnings", "write"))

  const mod = MODULES.find((m) => m.id === moduleId) || MODULES[0]
  // Where a save goes: this zone, else the module, else all modules.
  const target = zone.id
    ? { level: "zone", scopeId: zone.id, label: `${mod.label} · ${zone.name}` }
    : { level: mod.level, scopeId: mod.level === "global" ? "*" : moduleId, label: mod.label }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const vertical = readVertical(moduleId)
      const context = {
        ...(moduleId === "*" ? {} : { vertical: moduleId }),
        ...(zone.id ? { zoneId: zone.id } : {}),
      }
      const [effective, explained] = await Promise.all([
        platformSettingsAPI.getEarnings(vertical, zone.id ? { zoneId: zone.id } : {}),
        platformSettingsAPI.explain(FORMULA_KEY, context),
      ])
      const d = effective?.data?.data
      setData(d)
      setChain(explained?.data?.data || null)

      // The formula saved AT THIS LEVEL is what the editor edits. A level with
      // nothing of its own opens on what is in force (inherited), else on
      // today's table translated into the formula -- so saving without edits
      // changes no price.
      const own = (explained?.data?.data?.chain || []).find(
        (l) => l.level === target.level && (target.level === "global" || String(l.scopeId) === String(target.scopeId)),
      )
      const start = (own?.set ? own.value : null) || d?.formula || d?.currentAsFormula || emptyFormula()
      setFormula({ ...emptyFormula(), ...start, bands: start.bands || [] })
      setIncentive({
        isEnabled: d?.incentive?.isEnabled === true,
        minOrderAmount: Number(d?.incentive?.minOrderAmount || 0),
        incentivePercent: Number(d?.incentive?.incentivePercent || 0),
      })
    } catch (err) {
      toast.error(errText(err, "Could not load delivery earnings"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, mod.level, zone.id])

  useEffect(() => {
    load()
  }, [load])

  const save = async (key, value, what) => {
    setSaving(true)
    try {
      await platformSettingsAPI.set(key, { level: target.level, scopeId: target.scopeId, value })
      toast.success(value === null ? `${what} cleared for ${target.label}` : `${what} saved for ${target.label}`)
      await load()
    } catch (err) {
      toast.error(errText(err, `Could not save ${what.toLowerCase()}`))
    } finally {
      setSaving(false)
    }
  }

  const savedAtThisLevel = (chain?.chain || []).some(
    (l) => l.level === target.level && l.set && (target.level === "global" || String(l.scopeId) === String(target.scopeId)),
  )

  // What is charged today: the formula in force, else the old table as a formula.
  const today = data?.formula || data?.currentAsFormula || null
  const preview = useMemo(
    () =>
      PREVIEW_KM.map((km) => ({
        km,
        now: priceDelivery(formula, km),
        before: today ? priceDelivery(today, km) : null,
      })),
    [formula, today],
  )
  const losing = preview.filter((p) => p.now.keeps < 0)

  const saveFormula = () => {
    const changed = preview.filter((p) => p.before && (p.before.fee !== p.now.fee || p.before.pay !== p.now.pay))
    if (changed.length) {
      const lines = changed
        .slice(0, 4)
        .map((p) => `${p.km} km: customer ${rupees(p.before.fee)} → ${rupees(p.now.fee)}, rider ${rupees(p.before.pay)} → ${rupees(p.now.pay)}`)
        .join("\n")
      if (!window.confirm(`New orders for ${target.label} will be priced like this:\n\n${lines}\n\nOrders already placed keep what they were charged. Save?`)) return
    }
    save(FORMULA_KEY, formula, "Delivery formula")
  }

  const setMode = (bands) => {
    if (bands) setFormula({ ...formula, mode: "bands", bands: formula.bands?.length ? formula.bands : bandsFromSimple(formula) })
    else setFormula({ ...formula, mode: "simple" })
  }
  const lastBand = formula.bands?.[formula.bands.length - 1]

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Delivery earnings</h1>
          <p className="mt-1 text-sm text-neutral-600">
            What the customer pays for delivery and what the rider earns, set once for every module or overridden for one.
          </p>
        </div>

        <div className="space-y-5">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
            {visibleModules.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setModuleId(m.id)
                  setZone({ id: "", name: "" })
                }}
                className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${moduleId === m.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="-mt-3 px-1 text-xs text-neutral-500">{mod.hint}</p>
          {(
            <ZonePicker
              modules={ZONE_MODULES[moduleId] || []}
              value={zone.id}
              required={limited}
              allLabel={moduleId === "*" ? "All zones" : `All zones (${mod.label} default)`}
              disabled={saving}
              onChange={(id, name) => setZone({ id, name })}
            />
          )}

          {limited && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              You manage your zones only. Values head office sets for a whole module or all modules apply wherever your
              zone has none of its own; you can see them here but not change them.
            </p>
          )}
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading
            </div>
          ) : (
            <>
              {mod.incentiveOnly && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  A ride is priced by base fare, per km and per minute in the Taxi panel, so the delivery formula does
                  not apply here. The incentive does.
                </p>
              )}

              {!mod.incentiveOnly && (
                <Card
                  title="Delivery formula"
                  icon={Bike}
                  description="Two lines: what the customer pays, and what the rider earns. The platform keeps the difference."
                  footer={
                    <>
                      {savedAtThisLevel && (
                        <button type="button" className={ghostCls} disabled={saving || !canEdit} onClick={() => save(FORMULA_KEY, null, "Delivery formula")}>
                          <RotateCcw className="h-4 w-4" />
                          {zone.id ? `Reset to ${mod.label} default` : mod.level === "global" ? "Clear formula" : "Reset to all modules"}
                        </button>
                      )}
                      <button
                        type="button"
                        className={ghostCls}
                        disabled={saving || !data?.currentAsFormula}
                        onClick={() => setFormula({ ...emptyFormula(), ...data.currentAsFormula })}
                        title="Fill in the numbers that give today's prices"
                      >
                        Start from today&apos;s pricing
                      </button>
                      <button type="button" className={btnCls} disabled={saving || !canEdit} onClick={saveFormula}>
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        Save formula
                      </button>
                    </>
                  }
                >
                  {data?.formula ? (
                    <SourceLine>
                      In force now: <span className="font-medium">{data.formulaSource}</span>
                      {!savedAtThisLevel && target.level !== "global" &&
                        (zone.id ? " (this zone has no formula of its own)" : " (this module has no formula of its own)")}
                    </SourceLine>
                  ) : (
                    <SourceLine tone="warn">
                      No formula saved yet — orders are still priced from the old distance table
                      {data?.slabSource ? ` (${data.slabSource})` : ""}. The numbers below reproduce it; saving takes over.
                    </SourceLine>
                  )}

                  {zone.id && (
                    <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                      {savedAtThisLevel ? (
                        <>
                          <span className="font-medium">{zone.name}</span> has its own formula. Saving changes it for this zone
                          only; &ldquo;Reset to {mod.label} default&rdquo; removes it.
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{zone.name}</span> has no formula of its own yet. The numbers below are
                          the ones in force there now, as a starting point. Saving creates {zone.name}&apos;s own formula and
                          leaves every other zone and the {mod.label} formula unchanged.
                        </>
                      )}
                    </p>
                  )}
                  <label className="mb-3 flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-neutral-300"
                      checked={formula.mode === "bands"}
                      disabled={saving}
                      onChange={(e) => setMode(e.target.checked)}
                    />
                    <span className="text-sm text-neutral-700">
                      Advanced: different rates by distance
                    </span>
                  </label>

                  {formula.mode !== "bands" ? (
                    <div>
                      <SideRow
                        label="Customer pays"
                        hint="Delivery fee on the bill"
                        value={formula.customer}
                        disabled={saving}
                        onChange={(customer) => setFormula({ ...formula, customer })}
                      />
                      <SideRow
                        label="Rider earns"
                        hint="Before tip and incentives"
                        value={formula.rider}
                        disabled={saving}
                        onChange={(rider) => setFormula({ ...formula, rider })}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[680px] text-sm">
                          <thead>
                            <tr className="text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                              <th className="pb-1 pr-2" colSpan={2}>Distance (km)</th>
                              <th className="pb-1 pr-2" colSpan={2}>Customer pays</th>
                              <th className="pb-1 pr-2" colSpan={2}>Rider earns</th>
                              <th />
                            </tr>
                            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                              <th className="pb-2 pr-2 font-normal">From</th>
                              <th className="pb-2 pr-2 font-normal">To</th>
                              <th className="pb-2 pr-2 font-normal">Fee</th>
                              <th className="pb-2 pr-2 font-normal">+ per km in band</th>
                              <th className="pb-2 pr-2 font-normal">Pay</th>
                              <th className="pb-2 pr-2 font-normal">+ per km in band</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {formula.bands.map((b, i) => (
                              <BandRow
                                key={i}
                                band={b}
                                isLast={i === formula.bands.length - 1}
                                disabled={saving}
                                onChange={(next) => setFormula({ ...formula, bands: formula.bands.map((x, j) => (j === i ? next : x)) })}
                                onRemove={() => setFormula({ ...formula, bands: formula.bands.filter((_, j) => j !== i) })}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className={ghostCls}
                          disabled={saving || (lastBand && lastBand.toKm === null)}
                          onClick={() => {
                            const from = lastBand ? Number(lastBand.toKm) : 0
                            setFormula({
                              ...formula,
                              bands: [...formula.bands, { fromKm: from, toKm: null, customerFee: 0, customerPerKm: 0, riderPay: 0, riderPerKm: 0 }],
                            })
                          }}
                        >
                          <Plus className="h-4 w-4" />
                          Add band
                        </button>
                        <span className="text-xs text-neutral-500">
                          Per km is charged on the distance past the band&apos;s start. Leave the last band&apos;s
                          &ldquo;To&rdquo; empty so longer trips are covered; give it an end first to add another.
                        </span>
                      </div>
                    </>
                  )}

                  <div className="mt-4 grid gap-3 border-t border-neutral-100 pt-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-neutral-600">Minimum delivery fee (optional)</span>
                      <Money value={formula.minFee} placeholder="None" disabled={saving} onChange={(v) => setFormula({ ...formula, minFee: v })} />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-neutral-600">Maximum delivery fee (optional)</span>
                      <Money value={formula.maxFee} placeholder="None" disabled={saving} onChange={(v) => setFormula({ ...formula, maxFee: v })} />
                    </label>
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                      <Calculator className="h-4 w-4 text-neutral-400" /> Preview
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm tabular-nums">
                        <thead>
                          <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                            <th className="pb-2 pr-2">Trip</th>
                            <th className="pb-2 pr-2">Customer pays</th>
                            <th className="pb-2 pr-2">Rider earns</th>
                            <th className="pb-2 pr-2">Platform keeps</th>
                            {today && <th className="pb-2">Today</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.map((p) => (
                            <tr key={p.km} className={`border-b border-neutral-100 last:border-0 ${p.now.keeps < 0 ? "bg-red-50" : ""}`}>
                              <td className="py-2 pr-2 text-neutral-600">{p.km} km</td>
                              <td className="py-2 pr-2 font-medium text-neutral-900">{rupees(p.now.fee)}</td>
                              <td className="py-2 pr-2">{rupees(p.now.pay)}</td>
                              <td className={`py-2 pr-2 font-medium ${p.now.keeps < 0 ? "text-red-700" : "text-emerald-700"}`}>
                                {p.now.keeps < 0 ? `−${rupees(-p.now.keeps)}` : rupees(p.now.keeps)}
                              </td>
                              {today && (
                                <td className="py-2 text-xs text-neutral-500">
                                  {p.before.fee === p.now.fee && p.before.pay === p.now.pay
                                    ? "no change"
                                    : `was ${rupees(p.before.fee)} / ${rupees(p.before.pay)}`}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {losing.length > 0 && (
                      <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        The platform pays out more than it charges on {losing.map((p) => `${p.km} km`).join(", ")} trips.
                        That may be deliberate (free or cheap delivery), but check before saving.
                      </p>
                    )}
                    <p className="mt-3 text-xs text-neutral-500">
                      On top of what the rider earns here: the customer&apos;s tip in full, any surge, the{" "}
                      <Link to="/admin/master/delivery-incentives" className="font-medium text-neutral-800 underline">
                        daily incentive ladder
                      </Link>
                      , and the large-order incentive below.
                    </p>
                  </div>
                </Card>
              )}

              <Card
                title="Rider incentive"
                icon={Gift}
                description="An extra percentage of the order value, paid to the rider on orders at or above the minimum."
                footer={
                  <>
                    <button type="button" className={ghostCls} disabled={saving || !canEdit} onClick={() => save(INCENTIVE_KEY, null, "Incentive")}>
                      <RotateCcw className="h-4 w-4" />
                      Clear
                    </button>
                    <button type="button" className={btnCls} disabled={saving || !canEdit} onClick={() => save(INCENTIVE_KEY, incentive, "Incentive")}>
                      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save incentive
                    </button>
                  </>
                }
              >
                <SourceLine tone={data?.incentive?.level === "legacy" || !data?.incentive?.level ? "warn" : "ok"}>
                  In force now: <span className="font-medium">{data?.incentive?.source}</span>
                </SourceLine>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="flex items-center gap-2 sm:col-span-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-neutral-300"
                      checked={incentive.isEnabled}
                      disabled={saving}
                      onChange={(e) => setIncentive({ ...incentive, isEnabled: e.target.checked })}
                    />
                    <span className="text-sm font-medium text-neutral-800">Pay an incentive on large orders</span>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-neutral-800">Minimum order value</span>
                    <input
                      type="number"
                      min="0"
                      step="50"
                      className={`${inputCls} mt-1.5`}
                      value={num(incentive.minOrderAmount)}
                      disabled={saving || !incentive.isEnabled}
                      onChange={(e) => setIncentive({ ...incentive, minOrderAmount: Number(e.target.value || 0) })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-neutral-800">Incentive percent</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      className={`${inputCls} mt-1.5`}
                      value={num(incentive.incentivePercent)}
                      disabled={saving || !incentive.isEnabled}
                      onChange={(e) => setIncentive({ ...incentive, incentivePercent: Number(e.target.value || 0) })}
                    />
                  </label>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
