import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, MapPin, RefreshCw, Save, Send } from "lucide-react"
import { adminAPI } from "@food/api"

/**
 * How far a prescription travels, and where each one went.
 *
 * A customer with a prescription can do one of two things: pick a pharmacy, or
 * ask every pharmacy nearby. The first reaches one shop and is an ordinary
 * order from the moment it is placed. The second is what this screen is about
 * — it shows the same health record to several shops at once, and the range
 * below is the only thing deciding how many.
 *
 * That is why the range is set here rather than left to the shops or the
 * customer: it is the platform's call how far a prescription is allowed to be
 * seen, and it is also the cut-off on the list of pharmacies a customer
 * browses, so the shops somebody can see are exactly the shops their
 * prescription would reach.
 */

const STATUS_BADGE = {
  open: { label: "Waiting", className: "bg-amber-100 text-amber-700" },
  claimed: { label: "Accepted", className: "bg-emerald-100 text-emerald-700" },
  expired: { label: "Expired", className: "bg-slate-200 text-slate-700" },
  cancelled: { label: "Cancelled", className: "bg-rose-100 text-rose-700" },
}

const TABS = [
  { id: "all", label: "All" },
  { id: "open", label: "Waiting" },
  { id: "claimed", label: "Accepted" },
  { id: "expired", label: "Expired" },
  { id: "cancelled", label: "Cancelled" },
]

const formatWhen = (value) => {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
}

export default function MedicalRequests() {
  const [settings, setSettings] = useState({
    requestRadiusKm: 5,
    requestExpiryMinutes: 30,
    broadcastEnabled: true,
  })
  const [draft, setDraft] = useState(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [activeTab, setActiveTab] = useState("all")
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const loadSettings = useCallback(async () => {
    try {
      const res = await adminAPI.getMedicalSettings()
      const next = res?.data?.settings || res?.settings
      if (next) {
        setSettings(next)
        setDraft(null)
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load the medical settings")
    }
  }, [])

  const loadRequests = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminAPI.getMedicalRequests({ status: activeTab, limit: 50 })
      setRows(res?.data?.requests || res?.requests || [])
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load the requests")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    loadRequests()
  }, [loadRequests])

  const current = draft || settings
  const dirty = draft !== null

  const save = async () => {
    setSavingSettings(true)
    try {
      const res = await adminAPI.updateMedicalSettings({
        requestRadiusKm: Number(current.requestRadiusKm),
        requestExpiryMinutes: Number(current.requestExpiryMinutes),
        broadcastEnabled: current.broadcastEnabled === true,
      })
      const saved = res?.data?.settings || res?.settings
      if (saved) setSettings(saved)
      setDraft(null)
      toast.success("Saved")
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not save")
    } finally {
      setSavingSettings(false)
    }
  }

  const edit = (patch) => setDraft({ ...current, ...patch })

  return (
    <div className="p-4 space-y-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Prescription Requests</h1>
        <p className="mt-1 text-sm text-slate-600">
          Prescriptions sent to every pharmacy nearby, and the range that decides which
          ones those are.
        </p>
      </div>

      {/* --- the range ---------------------------------------------------- */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-5">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Delivery range</h2>
            <p className="mt-1 text-sm text-slate-600">
              A customer is shown the pharmacies within this distance of their address, and
              a prescription sent to &ldquo;nearby pharmacies&rdquo; goes to exactly those
              shops. Changing it does not affect requests already sent.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Range (km)
                </span>
                <input
                  type="number"
                  min="0.5"
                  max="50"
                  step="0.5"
                  value={current.requestRadiusKm}
                  onChange={(e) => edit({ requestRadiusKm: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
                <span className="mt-1 block text-xs text-slate-500">Between 0.5 and 50 km.</span>
              </label>

              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Give pharmacies (minutes)
                </span>
                <input
                  type="number"
                  min="5"
                  max="720"
                  step="5"
                  value={current.requestExpiryMinutes}
                  onChange={(e) => edit({ requestExpiryMinutes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  After this, nobody can accept it and the customer is free to try again.
                </span>
              </label>

              <label className="flex items-start gap-3 sm:col-span-2 lg:col-span-1">
                <input
                  type="checkbox"
                  checked={current.broadcastEnabled === true}
                  onChange={(e) => edit({ broadcastEnabled: e.target.checked })}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-900">
                    Allow sending to all nearby pharmacies
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Turn off and customers must choose a pharmacy themselves. Medical
                    ordering keeps working either way.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={!dirty || savingSettings}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {savingSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="text-sm text-slate-600 hover:text-slate-900"
                >
                  Discard
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* --- the log ------------------------------------------------------ */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={loadRequests}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            <Send className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            No requests here yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Sent</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Sent to</th>
                  <th className="px-4 py-2 font-medium">Range</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Accepted by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const badge = STATUS_BADGE[row.status] || STATUS_BADGE.open
                  const winner = (row.invited || []).find(
                    (i) => String(i.pharmacyId) === String(row.claimedBy),
                  )
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                        {formatWhen(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.customerName || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="font-medium text-slate-900">
                          {row.invitedCount} {row.invitedCount === 1 ? "pharmacy" : "pharmacies"}
                        </span>
                        {(row.invited || []).length > 0 && (
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {row.invited
                              .map((i) =>
                                i.distanceKm === null || i.distanceKm === undefined
                                  ? i.name
                                  : `${i.name} (${i.distanceKm} km)`,
                              )
                              .join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {row.radiusKm} km
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.status === "claimed" ? winner?.name || "Pharmacy" : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
