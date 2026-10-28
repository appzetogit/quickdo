import { useState, useEffect, useCallback } from "react"
import { platformSettingsAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Wallet, ChevronDown } from "lucide-react"

/**
 * Platform settings: only the settings that change something on the live site.
 *
 * Today that is the partner cash limit (core/finance/cashLimit.service.js).
 * The other keys in core/config/registry.js feed only the eligibility shadow
 * engine, which decides nothing and is off unless ELIGIBILITY_SHADOW_ENABLED
 * is set, or are read nowhere (maintenance mode, max concurrent jobs). They
 * stay registered on the server and are deliberately not shown here: a switch
 * that does nothing tells an admin something is protected when it is not. Add
 * a key to this screen when the code starts obeying it.
 *
 * How the limit applies:
 *   - The shared value covers riders (one limit across Taxi, Food and Quick
 *     Commerce) and service providers.
 *   - Service providers may have their own value (vertical override); riders
 *     may not -- a per-service rider value is ignored by the server.
 *   - Empty = not managed here: each partner keeps the limit from its own
 *     older screen. 0 = no limit.
 *   - Per-partner overrides are set on the partner's own page, not here.
 */

const LIMIT_KEY = "finance.cashLimit"
const ENFORCE_KEY = "finance.enforceCashLimit"

const savedValue = (setting, level) => {
  const link = (setting?.chain || []).find((l) => l.level === level)
  return link?.set ? link.value : null
}

const rupees = (n) => `₹${Number(n).toLocaleString("en-IN")}`

function LimitInput({ value, onChange, disabled, id }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500">₹</span>
      <input
        id={id}
        type="number"
        min="0"
        step="100"
        inputMode="numeric"
        value={value === null || value === undefined ? "" : value}
        placeholder="Not set"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
        className="w-40 rounded-lg border border-neutral-300 bg-white py-2 pl-7 pr-3 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
      />
    </div>
  )
}

const describe = (value) =>
  value === null
    ? "Not set here: each partner keeps the limit from its own older screen."
    : value === 0
      ? "No limit: partners can hold any amount of cash."
      : `Partners holding more than ${rupees(value)} in cash get no new cash orders until they deposit it.`

export default function CashLimitSettings() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [saved, setSaved] = useState({ limit: null, enforce: true, spLimit: null })
  const [limit, setLimit] = useState(null)
  const [spLimit, setSpLimit] = useState(null)
  const [spOpen, setSpOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [base, sp] = await Promise.all([
        platformSettingsAPI.resolveAll({}),
        platformSettingsAPI.resolveAll({ vertical: "serviceProvider" }),
      ])
      const find = (res, key) => (res?.data?.data?.settings || []).find((s) => s.key === key)
      const next = {
        limit: savedValue(find(base, LIMIT_KEY), "global"),
        enforce: savedValue(find(base, ENFORCE_KEY), "global") !== false,
        spLimit: savedValue(find(sp, LIMIT_KEY), "vertical"),
      }
      setSaved(next)
      setLimit(next.limit)
      setSpLimit(next.spLimit)
      if (next.spLimit !== null) setSpOpen(true)
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not load platform settings")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (key, level, scopeId, value, busyKey, message) => {
    setBusy(busyKey)
    try {
      await platformSettingsAPI.set(key, { level, scopeId, value })
      // Other server processes cache settings for 30s; clear this one's now.
      await platformSettingsAPI.invalidateCache().catch(() => {})
      toast.success(message)
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
    } finally {
      setBusy("")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
            <div className="rounded-lg bg-neutral-100 p-2 text-neutral-700">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-neutral-900">Cash limit for partners</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                The most cash a rider or partner can hold from cash orders before they must deposit it. One limit covers a
                rider across Taxi, Food and Quick Commerce combined.
              </p>
            </div>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label htmlFor="cash-limit" className="text-sm font-medium text-neutral-800">
                Cash limit
                <span className="block text-xs font-normal text-neutral-500">0 = no limit</span>
              </label>
              <div className="flex items-center gap-2">
                <LimitInput id="cash-limit" value={limit} onChange={setLimit} disabled={busy === "limit"} />
                <button
                  type="button"
                  disabled={limit === saved.limit || busy === "limit"}
                  onClick={() => save(LIMIT_KEY, "global", "*", limit, "limit", limit === null ? "Cash limit cleared" : "Cash limit saved")}
                  className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
                >
                  {busy === "limit" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </button>
              </div>
            </div>
            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
              {saved.enforce ? describe(saved.limit) : "Not enforced right now: the limit is shown to partners but nobody is stopped."}
            </p>

            <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-neutral-800">Stop new cash orders above the limit</p>
                <p className="text-xs text-neutral-500">Turn off to keep the limit visible without blocking anyone.</p>
              </div>
              <div role="radiogroup" aria-label="Enforce the cash limit" className="inline-flex self-start rounded-lg bg-neutral-100 p-0.5 text-sm">
                {[
                  [true, "On"],
                  [false, "Off"],
                ].map(([v, text]) => (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={saved.enforce === v}
                    disabled={busy === "enforce"}
                    onClick={() =>
                      saved.enforce !== v &&
                      save(ENFORCE_KEY, "global", "*", v, "enforce", v ? "Cash limit is now enforced" : "Cash limit is no longer enforced")
                    }
                    className={`rounded-md px-4 py-1.5 font-medium ${saved.enforce === v ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-neutral-100 pt-4">
              <button
                type="button"
                onClick={() => setSpOpen((o) => !o)}
                aria-expanded={spOpen}
                className="inline-flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-neutral-900"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${spOpen ? "rotate-180" : ""}`} />
                A different limit for service providers
              </button>
              {spOpen && (
                <div className="mt-3 flex flex-col gap-3 rounded-lg bg-neutral-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-neutral-600">
                    {spLimit === null && saved.spLimit === null
                      ? "Leave empty to use the limit above."
                      : "Service providers use this instead of the limit above."}
                  </p>
                  <div className="flex items-center gap-2">
                    <LimitInput id="sp-cash-limit" value={spLimit} onChange={setSpLimit} disabled={busy === "sp"} />
                    <button
                      type="button"
                      disabled={spLimit === saved.spLimit || busy === "sp"}
                      onClick={() =>
                        save(LIMIT_KEY, "vertical", "serviceProvider", spLimit, "sp", spLimit === null ? "Service providers now use the main limit" : "Saved")
                      }
                      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <p className="text-xs text-neutral-500">
          A limit for one particular rider or partner is set on that partner&apos;s own page.
        </p>
      </div>
    </div>
  )
}
