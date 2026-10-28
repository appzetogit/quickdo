import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertTriangle, Loader2, MapPin, Search, Star, UserCheck } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { apiErrorMessage, orderKey } from "./manualAssignUtils"

const SEARCH_DEBOUNCE_MS = 300
const PAGE_SIZE = 20

const rupees = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`

const minutesUntil = (iso) => {
  const ms = (Date.parse(iso || "") || 0) - Date.now()
  return ms > 0 ? Math.max(1, Math.round(ms / 60000)) : 3
}

/**
 * Pick a delivery rider for one order, nearest first.
 *
 * Choosing a rider asks the server without `force`; if it comes back with
 * warnings (offline, on a trip, over the cash limit, far, location unknown)
 * nothing has changed yet and the operator confirms with "Assign anyway".
 */
export default function AssignRiderModal({ open, onOpenChange, order, vertical, onAssigned }) {
  const orderId = orderKey(order)
  const displayId = order?.orderId || orderId

  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [riders, setRiders] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [assigningId, setAssigningId] = useState(null)
  const [confirm, setConfirm] = useState(null) // { rider, warnings }
  const requestSeq = useRef(0)

  // Reset when (re)opened.
  useEffect(() => {
    if (!open) return
    setQuery("")
    setDebouncedQuery("")
    setConfirm(null)
    setError("")
    setAssigningId(null)
  }, [open, orderId])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // A phone search needs 3+ digits on the server; shorter is treated as no search.
  const tooShortDigits = /^\d{1,2}$/.test(debouncedQuery)
  const effectiveQuery = tooShortDigits ? "" : debouncedQuery

  const loadRiders = useCallback(async () => {
    if (!open || !orderId) return
    const seq = ++requestSeq.current
    setLoading(true)
    setError("")
    try {
      const res = await adminAPI.getRiderCandidates(vertical, orderId, { q: effectiveQuery, limit: PAGE_SIZE })
      if (seq !== requestSeq.current) return
      const data = res?.data?.data || {}
      setRiders(Array.isArray(data.riders) ? data.riders : [])
      setTotal(Number(data.total) || 0)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setRiders([])
      setTotal(0)
      setError(apiErrorMessage(err, "Could not load riders"))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [open, orderId, vertical, effectiveQuery])

  useEffect(() => {
    loadRiders()
  }, [loadRiders])

  const assign = async (rider, force = false) => {
    if (!rider?.id || assigningId) return
    setAssigningId(rider.id)
    setError("")
    try {
      const res = await adminAPI.assignRider(vertical, orderId, { deliveryPartnerId: rider.id, force })
      const data = res?.data?.data || {}
      if (data.needsConfirmation) {
        setConfirm({ rider: data.rider || rider, warnings: Array.isArray(data.warnings) ? data.warnings : [] })
        return
      }
      const name = data.assignedRider?.name || rider.name || "rider"
      toast.success(`Assigned to ${name} — waiting for them to accept (${minutesUntil(data.acceptanceDeadlineAt)} min)`)
      setConfirm(null)
      onOpenChange?.(false)
      onAssigned?.(data)
    } catch (err) {
      const message = apiErrorMessage(err, "Could not assign the rider")
      setError(message)
      toast.error(message)
      setConfirm(null)
    } finally {
      setAssigningId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] bg-white p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-200">
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserCheck className="w-5 h-5 text-accent-orange" />
            Assign rider · {displayId}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Nearest first. The rider has a few minutes to accept, then the order goes back to auto-dispatch.
          </DialogDescription>
        </DialogHeader>

        {confirm ? (
          <div className="px-5 py-5 space-y-4" role="alertdialog" aria-labelledby="assign-confirm-title">
            <p id="assign-confirm-title" className="text-sm font-semibold text-slate-900">
              Assign {confirm.rider?.name || "this rider"} anyway?
            </p>
            <ul className="space-y-2">
              {confirm.warnings.map((warning, index) => (
                <li
                  key={`${warning.code}-${index}`}
                  className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{warning.message || warning.code}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={!!assigningId}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => assign(confirm.rider, true)}
                disabled={!!assigningId}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 flex items-center gap-1.5"
              >
                {assigningId ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Assign anyway
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 pt-4 pb-2">
              <label className="relative block">
                <span className="sr-only">Search riders by name or phone</span>
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or phone (3+ digits)"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </label>
              {tooShortDigits && (
                <p className="mt-1 text-xs text-slate-500">Type at least 3 digits to search by phone.</p>
              )}
            </div>

            {error && (
              <div role="alert" className="mx-5 mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-5 pb-4" aria-busy={loading}>
              {loading && riders.length === 0 ? (
                <div className="py-12 flex items-center justify-center text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Finding riders
                </div>
              ) : riders.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-500">
                  {error ? (
                    <button
                      type="button"
                      onClick={loadRiders}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      Try again
                    </button>
                  ) : effectiveQuery ? (
                    "No approved rider matches that search."
                  ) : (
                    "No approved riders found."
                  )}
                </div>
              ) : (
                <ul className={`space-y-2 ${loading ? "opacity-60" : ""}`}>
                  {riders.map((rider) => (
                    <li key={rider.id}>
                      <RiderRow
                        rider={rider}
                        busy={assigningId === rider.id}
                        disabled={!!assigningId}
                        onSelect={() => assign(rider, false)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {riders.length > 0 && (
              <p className="px-5 py-2 border-t border-slate-100 text-xs text-slate-500">
                Showing {riders.length} of {total} rider{total === 1 ? "" : "s"}
                {total > riders.length ? " — search to narrow down" : ""}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RiderRow({ rider, busy, disabled, onSelect }) {
  const distance = rider.distanceKm == null ? "—" : `${Number(rider.distanceKm).toFixed(1)} km`
  const rating = Number(rider.rating) || 0
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`Assign ${rider.name || "rider"}${rider.isAssigned ? " (currently assigned)" : ""}`}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed ${
        rider.isAssigned ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      } ${disabled && !busy ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-900 truncate">{rider.name || "Unnamed rider"}</span>
            <span
              className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                rider.online ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {rider.online ? "Online" : "Offline"}
            </span>
            {rider.onTrip && (
              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                On trip
              </span>
            )}
            {rider.isAssigned && (
              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-600 text-white">
                Assigned
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{rider.phone || "No phone"}</p>
        </div>
        <div className="shrink-0 text-right text-xs space-y-0.5">
          <p className="flex items-center justify-end gap-1 text-slate-700">
            <MapPin className="w-3 h-3" />
            {distance}
          </p>
          <p className={rider.overCashLimit ? "text-red-600 font-semibold" : "text-slate-600"}>
            Cash {rupees(rider.cashInHand)} / {rupees(rider.cashLimit)}
          </p>
          <p className="flex items-center justify-end gap-1 text-slate-600">
            {busy ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Star className="w-3 h-3 text-amber-500" />
                {rating ? rating.toFixed(1) : "—"}
                {rider.totalRatings ? <span className="text-slate-400">({rider.totalRatings})</span> : null}
              </>
            )}
          </p>
        </div>
      </div>
    </button>
  )
}
