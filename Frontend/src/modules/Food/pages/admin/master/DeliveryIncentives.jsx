import { useState, useEffect, useCallback } from "react"
import { incentiveRulesAPI } from "@food/api"
import { toast } from "sonner"
import { Loader2, Target, History, Plus, Trash2 } from "lucide-react"
import ZonePicker from "./ZonePicker"
import { useAdminAccess, isRestricted, can } from "@food/utils/adminAccess"

/**
 * Master > Delivery Incentives: an order-count LADDER per duty segment —
 * "1-5 orders → ₹100, 5-10 → ₹150, 10-15 → ₹200" — not a single target.
 * Each rung pays independently the moment a rider reaches it, on top of
 * whatever earlier rungs already paid that day.
 *
 * Two segments, not per-module tabs like Delivery Earnings — a rider works
 * one of two duty segments at a time (the Flutter app's DutySegment), and
 * both food+quick-commerce+medical riders and taxi+porter riders share one
 * ladder within their segment. Saving inserts a new active rule and
 * deactivates whichever was active for that segment before it (server-side,
 * see incentiveRule.model.js) — this screen never edits a rule in place, so
 * "recent" below is real history, not a log of the same document changing.
 */

const SEGMENTS = [
  {
    id: "foodAndQuick",
    label: "Food, Daily needs, Medical & Bike parcel",
    hint: "Food + Daily needs + Medical + Bike parcel riders — food, groceries, medicine and parcels on a 2-wheeler all count toward the same ladder.",
    // A zone ladder can be for a Food, Quick or Medical zone: whichever the order
    // (or the bike parcel's pickup) is in.
    zoneModules: ["food", "quickCommerce", "medical"],
  },
  {
    // Key kept for the ladders already saved; passenger rides only now.
    id: "taxiAndPorter",
    label: "Taxi",
    hint: "Passenger rides only — bike taxi, auto and cab trips count toward this ladder. Parcels are not counted here.",
    zoneModules: ["taxi"],
  },
  {
    id: "heavyParcel",
    label: "Heavy parcel",
    hint: "Parcel and porter jobs on anything bigger than a 2-wheeler — tempo, van, truck. Bike parcels count on the food ladder instead.",
    zoneModules: ["taxi"],
  },
]

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm tabular-nums focus:border-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/10 disabled:bg-neutral-50"
const btnCls =
  "inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-500"
const ghostCls =
  "inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"

const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

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

const emptyTier = (fromOrders = 1, toOrders = 5, rewardAmount = 100) => ({ fromOrders, toOrders, rewardAmount })

/** Next row starts right after the previous one's "to", so the ladder reads
 *  continuously (1-5, 5-10, 10-15, ...) by default — the admin can still
 *  edit either boundary afterward. */
const nextTierAfter = (tiers) => {
  const last = tiers[tiers.length - 1]
  const from = last ? last.toOrders : 0
  return emptyTier(from, from + 5, 0)
}

const tiersFromRule = (rule) =>
  Array.isArray(rule?.tiers) && rule.tiers.length
    ? rule.tiers.map((t) => ({ fromOrders: t.fromOrders, toOrders: t.toOrders, rewardAmount: t.rewardAmount }))
    : [emptyTier()]

const emptyForm = () => ({ title: "", tiers: [emptyTier()] })

/** Null when every tier is individually valid and the ladder is in order;
 *  otherwise the reason, so the save button can stay disabled with a hint
 *  rather than letting an invalid ladder reach the server. */
function tiersError(tiers) {
  if (!tiers.length) return "Add at least one tier"
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i]
    if (!(Number(t.fromOrders) >= 1)) return `Tier ${i + 1}: "from" must be at least 1`
    if (!(Number(t.toOrders) >= Number(t.fromOrders))) return `Tier ${i + 1}: "to" must be at or above "from"`
    if (t.rewardAmount === "" || Number(t.rewardAmount) < 0) return `Tier ${i + 1}: reward can't be negative`
    if (i > 0 && Number(t.toOrders) <= Number(tiers[i - 1].toOrders)) {
      return `Tier ${i + 1}: "to" must be higher than the tier before it`
    }
  }
  return null
}

function TierRow({ tier, onChange, onRemove, disabled }) {
  const set = (field) => (e) => {
    const raw = e.target.value
    onChange({ ...tier, [field]: raw === "" ? "" : Number(raw) })
  }
  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="py-2 pr-2">
        <input type="number" min="1" step="1" className={inputCls} value={tier.fromOrders} onChange={set("fromOrders")} disabled={disabled} />
      </td>
      <td className="py-2 pr-2">
        <input type="number" min="1" step="1" className={inputCls} value={tier.toOrders} onChange={set("toOrders")} disabled={disabled} />
      </td>
      <td className="py-2 pr-2">
        <input type="number" min="0" step="10" className={inputCls} value={tier.rewardAmount} onChange={set("rewardAmount")} disabled={disabled} />
      </td>
      <td className="py-2 text-right">
        <button type="button" onClick={onRemove} disabled={disabled} className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" aria-label="Remove tier">
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

/** "2026-10-05" for a date input, in IST. */
const dayOf = (d) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : "")
const isDated = (r) => Boolean(r?.startsAt || r?.endsAt)
const runText = (r) => {
  if (!isDated(r)) return ""
  const f = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })
  if (r.startsAt && r.endsAt) return `${f(r.startsAt)} – ${f(r.endsAt)}`
  return r.startsAt ? `from ${f(r.startsAt)}` : `until ${f(r.endsAt)}`
}
const seedForm = (rule) => ({
  title: rule?.title || "",
  tiers: tiersFromRule(rule),
  startsAt: dayOf(rule?.startsAt),
  endsAt: dayOf(rule?.endsAt),
})

const ladderLine = (rule) => (rule?.tiers || []).map((t) => `${t.fromOrders}-${t.toOrders} → ₹${t.rewardAmount}`).join(",  ")

function SegmentCard({ segment, rules, saving, onSave, onTurnOff, busyId, limited = false, canWrite = true }) {
  // A zone's own ladder, or (no zone) the default one every other zone uses.
  const [zone, setZone] = useState({ id: "", name: "" })
  const mine = (r) => r.segment === segment.id
  // The permanent ladder is the one edited here; a limited-time one runs on top of it.
  const inZone = rules.filter((r) => mine(r) && String(r.zoneId || "") === zone.id)
  const active = inZone.find((r) => !isDated(r)) || inZone[0] || null
  const promos = inZone.filter((r) => isDated(r) && r !== active)
  const fallback = zone.id ? rules.find((r) => mine(r) && !r.zoneId && !isDated(r)) || null : null
  const busy = Boolean(active) && busyId === active._id
  // A zone sub-admin changes only their own zones' ladders; the default is head office's.
  const canEdit = canWrite && (!limited || Boolean(zone.id))
  const [form, setForm] = useState(() => seedForm(active))

  // Re-seed the form whenever the active rule for THIS segment changes (a
  // fresh load, or this segment's own save completing) — but never while the
  // admin is mid-edit on the other segment's card, since each card owns its
  // own independent form state.
  useEffect(() => {
    setForm(seedForm(active))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?._id])

  const invalidReason = tiersError(form.tiers)
    || (form.startsAt && form.endsAt && form.endsAt < form.startsAt ? "The end date is before the start date" : "")
  const dirty =
    !active ||
    form.title !== (active.title || "") ||
    form.startsAt !== dayOf(active.startsAt) ||
    form.endsAt !== dayOf(active.endsAt) ||
    JSON.stringify(form.tiers) !== JSON.stringify(tiersFromRule(active))
  const finalTier = form.tiers[form.tiers.length - 1]
  const totalReward = form.tiers.reduce((sum, t) => sum + (Number(t.rewardAmount) || 0), 0)

  return (
    <Card
      title={zone.id ? `${segment.label} · ${zone.name}` : segment.label}
      description={segment.hint}
      icon={Target}
      footer={
        <>
          {invalidReason && <span className="mr-auto text-xs text-red-600">{invalidReason}</span>}
          {active && (
            <button
              type="button"
              className={`${ghostCls} ${invalidReason ? "" : "mr-auto"}`}
              disabled={saving || busy || !canEdit}
              onClick={() => onTurnOff(active)}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Turn off
            </button>
          )}
          <button
            type="button"
            className={btnCls}
            disabled={saving || !dirty || Boolean(invalidReason) || !canEdit}
            onClick={() => onSave(segment.id, form, zone)}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {active ? "Save new ladder" : "Turn on"}
          </button>
        </>
      }
    >
      <div className="mb-4">
        <ZonePicker
          modules={segment.zoneModules}
          value={zone.id}
          required={limited}
          allLabel="All zones (default ladder)"
          disabled={saving}
          onChange={(id, name) => setZone({ id, name })}
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          A zone with its own ladder counts only the rider&apos;s trips in that zone; every other trip climbs the default ladder.
        </p>
      </div>
      {active ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Live now: {(active.tiers || []).map((t) => `${t.fromOrders}-${t.toOrders} → ₹${t.rewardAmount}`).join(",  ")}
          {active.title ? <> — &ldquo;{active.title}&rdquo;</> : null}
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {zone.id
            ? `${zone.name} has no ladder of its own — trips there climb the default ladder${fallback ? ` (${ladderLine(fallback)})` : ", and there is none"}. Save one to give ${zone.name} its own.`
            : "Nothing active for this segment — riders see no incentive card until one is turned on."}
        </div>
      )}

      <label className="mb-4 block">
        <span className="text-sm font-medium text-neutral-800">Headline (optional)</span>
        <input
          type="text"
          placeholder={finalTier ? `Complete ${finalTier.toOrders} orders, get up to ₹${totalReward}` : "Complete orders, get more"}
          className={`${inputCls} mt-1.5`}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <span className="mt-1 block text-xs text-neutral-500">
          Shown to the rider as-is. Left blank, the app fills in the numbers below.
        </span>
      </label>

      <div className="mb-4">
        <span className="text-sm font-medium text-neutral-800">Limited time <span className="font-normal text-neutral-500">(optional)</span></span>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <label className="block text-xs text-neutral-600">
            Starts
            <input type="date" className={`${inputCls} mt-1`} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </label>
          <label className="block text-xs text-neutral-600">
            Ends
            <input type="date" className={`${inputCls} mt-1`} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </label>
        </div>
        <span className="mt-1 block text-xs text-neutral-500">
          With dates, this ladder is an offer: it runs only between them, on top of the everyday ladder, which takes over again when it ends. Leave both empty for the everyday ladder.
        </span>
        {promos.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-neutral-700">
            {promos.map((p) => (
              <li key={p._id}>Offer {runText(p)}: {ladderLine(p)}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
              <th className="pb-2 pr-2">From (orders)</th>
              <th className="pb-2 pr-2">To (orders)</th>
              <th className="pb-2 pr-2">Reward (₹)</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {form.tiers.map((t, i) => (
              <TierRow
                key={i}
                tier={t}
                disabled={saving}
                onChange={(next) => setForm({ ...form, tiers: form.tiers.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setForm({ ...form, tiers: form.tiers.filter((_, j) => j !== i) })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={ghostCls}
          disabled={saving}
          onClick={() => setForm({ ...form, tiers: [...form.tiers, nextTierAfter(form.tiers)] })}
        >
          <Plus className="h-4 w-4" />
          Add tier
        </button>
        {finalTier && !invalidReason && (
          <span className="text-xs text-neutral-500">
            Ladder totals ₹{totalReward} if a rider reaches all {form.tiers.length} tier{form.tiers.length === 1 ? "" : "s"} ({finalTier.toOrders} orders).
          </span>
        )}
      </div>
    </Card>
  )
}

export default function DeliveryIncentives() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null) // segment id currently saving, or null
  const [active, setActive] = useState([])
  const [recent, setRecent] = useState([])
  const [busyId, setBusyId] = useState(null) // rule being turned off or deleted
  const access = useAdminAccess()
  const limited = isRestricted(access)
  const canWrite = !limited || can(access, "zone_incentives", "write")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await incentiveRulesAPI.list()
      const data = res?.data?.data || {}
      setActive(Array.isArray(data.active) ? data.active : [])
      setRecent(Array.isArray(data.recent) ? data.recent : [])
    } catch (err) {
      toast.error(errText(err, "Could not load incentive rules"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (segmentId, form, zone = { id: "", name: "" }) => {
    setSaving(segmentId)
    try {
      await incentiveRulesAPI.upsert({
        segment: segmentId,
        zoneId: zone.id || null,
        zoneName: zone.name || "",
        title: form.title,
        // Whole days in India time: from the start of the first to the end of the last.
        startsAt: form.startsAt ? `${form.startsAt}T00:00:00+05:30` : null,
        endsAt: form.endsAt ? `${form.endsAt}T23:59:59+05:30` : null,
        tiers: form.tiers.map((t) => ({
          fromOrders: Number(t.fromOrders),
          toOrders: Number(t.toOrders),
          rewardAmount: Number(t.rewardAmount),
        })),
      })
      toast.success(`Incentive ladder saved for ${SEGMENTS.find((s) => s.id === segmentId)?.label || segmentId}${zone.id ? ` · ${zone.name}` : ""}`)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save the incentive ladder"))
    } finally {
      setSaving(null)
    }
  }

  const ladderText = (r) => (r.tiers || []).map((t) => `${t.fromOrders}-${t.toOrders} → ₹${t.rewardAmount}`).join(", ")
  const zoneLabel = (r) => (r.zoneId ? r.zoneName || "one zone" : "all zones")
  const segmentLabel = (id) => SEGMENTS.find((s) => s.id === id)?.label || id

  const turnOff = async (rule) => {
    if (!window.confirm(`Turn off the incentive ladder for ${segmentLabel(rule.segment)} (${zoneLabel(rule)})? Riders stop seeing it straight away. It stays in Recent ladders.`)) return
    setBusyId(rule._id)
    try {
      await incentiveRulesAPI.deactivate(rule._id)
      toast.success("Incentive ladder turned off")
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not turn off the incentive ladder"))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (rule) => {
    const warning = rule.isActive ? " It is live now, so riders stop seeing it straight away." : ""
    if (!window.confirm(`Delete the ladder ${ladderText(rule)} for ${segmentLabel(rule.segment)} (${zoneLabel(rule)})?${warning} Rewards already paid to riders are not affected.`)) return
    setBusyId(rule._id)
    try {
      await incentiveRulesAPI.remove(rule._id)
      toast.success("Incentive ladder deleted")
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not delete the incentive ladder"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Delivery incentives</h1>
          <p className="mt-1 text-sm text-neutral-600">
            An order-count ladder per duty segment — e.g. 1-5 orders → ₹100, 5-10 → ₹150, 10-15 → ₹200. Each tier
            credits the rider's wallet automatically the moment they reach it; the rider app shows live progress up
            the ladder.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </div>
        ) : (
          <>
            <div className="space-y-5">
              {SEGMENTS.map((segment) => (
                <SegmentCard
                  key={segment.id}
                  segment={segment}
                  rules={active}
                  saving={saving === segment.id}
                  onSave={save}
                  onTurnOff={turnOff}
                  busyId={busyId}
                  limited={limited}
                  canWrite={canWrite}
                />
              ))}
            </div>

            {recent.length > 0 && (
              <Card title="Recent ladders" description="Every version saved for either segment, newest first." icon={History}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                        <th className="pb-2 pr-2">Segment</th>
                        <th className="pb-2 pr-2">Zone</th>
                        <th className="pb-2 pr-2">Tiers</th>
                        <th className="pb-2 pr-2">Status</th>
                        <th className="pb-2 pr-2">Saved</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((r) => (
                        <tr key={r._id} className="border-b border-neutral-100 last:border-0">
                          <td className="py-2 pr-2 align-top">{SEGMENTS.find((s) => s.id === r.segment)?.label || r.segment}</td>
                          <td className="py-2 pr-2 align-top text-neutral-600">
                            {r.zoneId ? r.zoneName || "Zone" : "All zones"}
                            {isDated(r) && <span className="block text-xs text-amber-700">Offer {runText(r)}</span>}
                          </td>
                          <td className="py-2 pr-2">
                            {(r.tiers || []).map((t) => `${t.fromOrders}-${t.toOrders} → ₹${t.rewardAmount}`).join(",  ")}
                          </td>
                          <td className="py-2 pr-2 align-top">
                            {r.isActive ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                Active
                              </span>
                            ) : (
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                                Retired
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-2 align-top text-neutral-500">
                            {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                          </td>
                          <td className="py-1 text-right align-top">
                            <button
                              type="button"
                              onClick={() => remove(r)}
                              disabled={busyId === r._id || (limited && (!canWrite || !r.zoneId))}
                              className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                              aria-label={`Delete ladder ${ladderText(r)}`}
                              title="Delete"
                            >
                              {busyId === r._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
