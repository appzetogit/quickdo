import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react"
import ZonePicker from "@food/pages/admin/master/ZonePicker"
import { deliverySlotsAdminAPI } from "@/services/api/marketplace"

/**
 * Master > Delivery Slots (plan §5.3): the windows customers can schedule a
 * Quick delivery into, per zone, with how many orders each takes per day.
 *
 * No slots means scheduling works as before (any time). Once a zone has slots,
 * a scheduled order must fall into one with room, and rider search starts
 * before the slot (Master settings: orders.scheduledDispatchLeadMinutes).
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const EMPTY = { label: "", startTime: "09:00", endTime: "11:00", capacity: 20, cutoffMinutes: 60, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], isActive: true }
const errText = (err, fallback) => err?.response?.data?.message || err?.message || fallback

export default function DeliverySlots() {
  const [zoneId, setZoneId] = useState("")
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await deliverySlotsAdminAPI.list({ vertical: "quickCommerce", zoneId: zoneId || "all" })
      setRows(res?.data?.data || [])
    } catch (err) {
      toast.error(errText(err, "Could not load delivery slots"))
    } finally {
      setLoading(false)
    }
  }, [zoneId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft.startTime || !draft.endTime) return toast.error("Set the start and end time")
    if (!(Number(draft.capacity) >= 1)) return toast.error("Capacity must be at least 1")
    if (!draft.daysOfWeek.length) return toast.error("Pick at least one day")
    setSaving(true)
    try {
      const body = {
        vertical: "quickCommerce",
        zoneId: zoneId || null,
        label: draft.label,
        startTime: draft.startTime,
        endTime: draft.endTime,
        capacity: Number(draft.capacity),
        cutoffMinutes: Number(draft.cutoffMinutes) || 0,
        daysOfWeek: draft.daysOfWeek,
        isActive: draft.isActive !== false,
      }
      if (draft._id) await deliverySlotsAdminAPI.update(draft._id, body)
      else await deliverySlotsAdminAPI.create(body)
      toast.success("Slot saved")
      setDraft(null)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not save the slot"))
    } finally {
      setSaving(false)
    }
    return undefined
  }

  const remove = async (row) => {
    if (!window.confirm("Remove this slot? Orders already booked into it keep their time.")) return
    try {
      await deliverySlotsAdminAPI.remove(row._id)
      await load()
    } catch (err) {
      toast.error(errText(err, "Could not remove the slot"))
    }
  }

  const toggleDay = (d) =>
    setDraft((x) => ({ ...x, daysOfWeek: x.daysOfWeek.includes(d) ? x.daysOfWeek.filter((y) => y !== d) : [...x.daysOfWeek, d].sort() }))

  return (
    <div className="min-h-screen bg-neutral-50 p-4 lg:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-neutral-900">
            <CalendarClock className="h-5 w-5" /> Delivery slots (Quick)
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            With no slots, customers may schedule for any time. Once a zone has slots, a scheduled order must fit one that still has room.
            &quot;All zones&quot; slots apply to every zone that has none of its own.
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full max-w-xs">
            <ZonePicker modules={["quickCommerce"]} value={zoneId} onChange={(id) => setZoneId(id || "")} allLabel="All zones" />
          </div>
          <button type="button" onClick={() => setDraft({ ...EMPTY })} className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white">
            <Plus className="h-4 w-4" /> Add slot
          </button>
        </div>

        {draft && (
          <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Label (optional)</span>
                <input value={draft.label} onChange={(e) => setDraft((x) => ({ ...x, label: e.target.value }))} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="Morning" />
              </label>
              <label className="block text-sm">
                <span className="text-neutral-700">Starts</span>
                <input type="time" value={draft.startTime} onChange={(e) => setDraft((x) => ({ ...x, startTime: e.target.value }))} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-neutral-700">Ends</span>
                <input type="time" value={draft.endTime} onChange={(e) => setDraft((x) => ({ ...x, endTime: e.target.value }))} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-neutral-700">Orders per day</span>
                <input type="number" min={1} value={draft.capacity} onChange={(e) => setDraft((x) => ({ ...x, capacity: e.target.value }))} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-neutral-700">Booking closes (minutes before)</span>
                <input type="number" min={0} value={draft.cutoffMinutes} onChange={(e) => setDraft((x) => ({ ...x, cutoffMinutes: e.target.value }))} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
              </label>
              <label className="flex items-end gap-2 pb-2 text-sm text-neutral-700">
                <input type="checkbox" checked={draft.isActive !== false} onChange={(e) => setDraft((x) => ({ ...x, isActive: e.target.checked }))} />
                Open for booking
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`rounded-full border px-3 py-1 text-xs ${draft.daysOfWeek.includes(i) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr><th className="px-4 py-2">Slot</th><th className="px-4 py-2">Days</th><th className="px-4 py-2">Orders/day</th><th className="px-4 py-2">Closes</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="px-4 py-2 font-medium text-neutral-900">{r.label ? `${r.label} · ` : ""}{r.startTime} - {r.endTime}</td>
                    <td className="px-4 py-2 text-neutral-600">{(r.daysOfWeek || []).length === 7 ? "Every day" : (r.daysOfWeek || []).map((d) => DAYS[d]).join(", ")}</td>
                    <td className="px-4 py-2">{r.capacity}</td>
                    <td className="px-4 py-2 text-neutral-600">{r.cutoffMinutes} min before</td>
                    <td className="px-4 py-2">{r.isActive ? "Open" : "Closed"}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => setDraft({ ...EMPTY, ...r })} className="mr-3 text-xs text-neutral-700 underline">Edit</button>
                      <button type="button" aria-label="Remove" onClick={() => remove(r)} className="text-red-500"><Trash2 className="inline h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">No slots for this zone: scheduling is open-ended.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
