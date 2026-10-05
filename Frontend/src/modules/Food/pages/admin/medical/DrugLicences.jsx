import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Loader2, Search, ShieldCheck } from "lucide-react"
import { adminAPI } from "@food/api"

/**
 * Every pharmacy's drug licence, and how long it has left.
 *
 * Onboarding already refuses a pharmacy that cannot produce one, but a licence
 * that was current then goes stale on its own with nobody touching anything.
 * Nothing else on the platform would notice: the shop keeps taking orders for
 * medicine on a licence that expired months ago. This is the screen that
 * notices.
 *
 * Read-only. Licences are edited through the seller record, where they are
 * saved alongside the store type so a pharmacy cannot end up with one and not
 * the other.
 */

const TABS = [
  { id: "expired", label: "Expired" },
  { id: "expiring_soon", label: "Expiring soon" },
  { id: "missing", label: "Missing" },
  { id: "valid", label: "Valid" },
  { id: "all", label: "All" },
]

const STATE_BADGE = {
  expired: { label: "Expired", className: "bg-rose-100 text-rose-700" },
  expiring_soon: { label: "Expiring soon", className: "bg-amber-100 text-amber-700" },
  missing: { label: "Missing", className: "bg-slate-200 text-slate-700" },
  valid: { label: "Valid", className: "bg-emerald-100 text-emerald-700" },
}

const formatDate = (value) => {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

/**
 * Days phrased the way someone chasing a renewal would say it. "-2" on its own
 * reads as a number nobody can act on.
 */
const remainingLabel = (state, days) => {
  if (state === "missing" || days === null || days === undefined) return "No expiry on file"
  if (days < 0) return `Ran out ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`
  if (days === 0) return "Runs out today"
  return `${days} ${days === 1 ? "day" : "days"} left`
}

export default function DrugLicences() {
  const [activeTab, setActiveTab] = useState("expired")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({ all: 0, expired: 0, expiring_soon: 0, missing: 0, valid: 0 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const response = await adminAPI.getDrugLicences({
        limit: 500,
        state: activeTab,
        ...(search.trim() ? { search: search.trim() } : {}),
      })
      const data = response?.data?.data || {}
      setRows(data.licences || [])
      // The list returns the counts for every state alongside the filtered
      // rows, so the tabs never disagree with the table under them.
      setCounts(data.counts || { all: 0 })
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not load drug licences")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, search])

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [load])

  const tabs = useMemo(
    () => TABS.map((tab) => ({ ...tab, count: Number(counts[tab.id]) || 0 })),
    [counts],
  )
  const needsAttention = (Number(counts.expired) || 0) + (Number(counts.missing) || 0)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Drug licences</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Every pharmacy on the platform and the licence it dispenses under.
        </p>
      </div>

      {needsAttention > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {needsAttention} {needsAttention === 1 ? "pharmacy is" : "pharmacies are"} dispensing without a
          valid licence on file. Each is still taking orders until someone switches it off.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
            }`}
          >
            {tab.label}
            <span className={`ml-2 text-xs ${activeTab === tab.id ? "text-slate-300" : "text-slate-400"}`}>
              {tab.count}
            </span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pharmacy, owner or phone"
            className="pl-9 pr-3 py-2 w-64 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            No pharmacy in this state.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Pharmacy", "Owner", "Licence", "Expires", "State", "Document"].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-[10px] font-bold text-slate-700 uppercase tracking-wider"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const badge = STATE_BADGE[row.licenceState] || STATE_BADGE.missing
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-slate-900">{row.name}</p>
                        <p className="text-xs text-slate-500">
                          {row.status === "approved" ? "Approved seller" : row.status || ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-slate-700">{row.ownerName || "—"}</p>
                        <p className="text-xs text-slate-500">{row.phone || ""}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.licenceNumber || <span className="text-slate-400">Not on file</span>}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-slate-900">{formatDate(row.licenceExpiry)}</p>
                        <p className="text-xs text-slate-500">
                          {remainingLabel(row.licenceState, row.daysRemaining)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.licenceImage ? (
                          <a
                            href={row.licenceImage}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-blue-600 hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-sm text-slate-400">None</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Licences are edited on the pharmacy's own record, where they are saved with the store type — so a
          pharmacy cannot end up with one and not the other. A pharmacy that should stop dispensing is
          switched off from the sellers list.
        </p>
      </div>
    </div>
  )
}
