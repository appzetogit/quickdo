import { useState, useEffect, useCallback } from "react"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Ticket, ShieldCheck } from "lucide-react"

/**
 * Master > Promotions: a ceiling on what any promo code may give away.
 *
 * A ceiling, deliberately, not a default. A default pre-fills a form and is then
 * ignored by every code already live; a ceiling is applied when the code is
 * redeemed, so it reaches existing promos too.
 *
 * And it only ever TIGHTENS. A code allowing fewer uses than the ceiling keeps
 * its own number, so raising the ceiling can never quietly make a live promo
 * more generous than whoever created it intended. The screen says so, because an
 * operator who expects "set 5 and every code becomes 5" would be surprised by
 * the opposite.
 *
 * Empty = no ceiling, which is how the platform behaved before this existed.
 */

const KEYS = {
  perUser: "promo.maxUsesPerUser",
  total: "promo.maxUsesTotal",
}

const MODULES = [
  { id: "*", level: "global", label: "All modules" },
  { id: "taxi", level: "vertical", label: "Taxi" },
  { id: "food", level: "vertical", label: "Food" },
  { id: "quickCommerce", level: "vertical", label: "Quick Commerce" },
  { id: "medical", level: "vertical", label: "Medical" },
]

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

/** The value saved at one level, as opposed to the one merely in force there. */
const savedAt = (setting, level, scopeId) => {
  const link = (setting?.chain || []).find(
    (l) => l.level === level && (level === "global" || l.scopeId === scopeId),
  )
  return link?.set ? link.value : null
}

function Row({ label, hint, value, onChange, effective, disabled }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_11rem] sm:items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
        {effective !== null && effective !== undefined && (
          <p className="mt-1 text-xs text-neutral-600">
            In force here: <span className="font-medium tabular-nums">{effective}</span>
          </p>
        )}
      </div>
      <input
        type="number"
        min="1"
        step="1"
        placeholder="No ceiling"
        className={inputCls}
        value={value === null || value === undefined ? "" : value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(1, Number(e.target.value)))}
      />
    </div>
  )
}

export default function PromoCeiling() {
  const [moduleId, setModuleId] = useState("*")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [perUser, setPerUser] = useState(null)
  const [total, setTotal] = useState(null)
  const [settings, setSettings] = useState({ perUser: null, total: null })

  const mod = MODULES.find((m) => m.id === moduleId) || MODULES[0]

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const context = moduleId === "*" ? {} : { vertical: moduleId }
      const [a, b] = await Promise.all([
        platformSettingsAPI.explain(KEYS.perUser, context),
        platformSettingsAPI.explain(KEYS.total, context),
      ])
      const pu = a?.data?.data || null
      const tt = b?.data?.data || null
      setSettings({ perUser: pu, total: tt })
      setPerUser(savedAt(pu, mod.level, moduleId))
      setTotal(savedAt(tt, mod.level, moduleId))
    } catch (err) {
      toast.error(errText(err, "Could not load promotion limits"))
    } finally {
      setLoading(false)
    }
  }, [moduleId, mod.level])

  useEffect(() => {
    load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const scopeId = mod.level === "global" ? "*" : moduleId
      await Promise.all([
        platformSettingsAPI.set(KEYS.perUser, { level: mod.level, scopeId, value: perUser }),
        platformSettingsAPI.set(KEYS.total, { level: mod.level, scopeId, value: total }),
      ])
      toast.success(`Promotion limits saved for ${mod.label}`)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save promotion limits"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Promotions</h1>
          <p className="mt-1 text-sm text-neutral-600">The most any single promo code may be used, across every module.</p>
        </div>

        <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-white p-1">
        {MODULES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setModuleId(m.id)}
            className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${moduleId === m.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
          <Ticket className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
          <div className="min-w-0">
            <h2 className="font-semibold text-neutral-900">Promo code ceiling</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              The most any single promo code may be used, whatever the code itself says.
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This only ever tightens. A code that allows fewer uses keeps its own limit, so raising
              the ceiling never makes a live promo more generous. Leave empty for no ceiling.
            </p>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading
            </div>
          ) : (
            <div className="space-y-5">
              <Row
                label="Most uses per customer"
                hint="One customer may not use the same code more times than this."
                value={perUser}
                onChange={setPerUser}
                effective={settings.perUser?.effective ?? null}
                disabled={saving}
              />
              <Row
                label="Most uses in total"
                hint="The code stops working once it has been used this many times by anyone."
                value={total}
                onChange={setTotal}
                effective={settings.total?.effective ?? null}
                disabled={saving}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3">
          <button type="button" className={btnCls} disabled={saving || loading} onClick={save}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save for {mod.label}
          </button>
        </div>
      </section>
        </div>
      </div>
    </div>
  )
}
