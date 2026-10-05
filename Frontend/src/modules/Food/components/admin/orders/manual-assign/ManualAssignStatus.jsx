import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Clock, Loader2, UserCheck, UserX } from "lucide-react"
import { adminAPI } from "@food/api"
import { apiErrorMessage, describeManualAssignment, orderKey } from "./manualAssignUtils"

const formatLeft = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return `${minutes}:${seconds}`
}

/** Milliseconds until `deadline`, ticking once a second only while it is in the future. */
function useCountdown(deadline) {
  const target = Date.parse(deadline || "") || 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!target) return undefined
    setNow(Date.now())
    if (target <= Date.now()) return undefined
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= target) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [target])
  return target ? target - now : null
}

/**
 * One line about a hand-picked rider on an order:
 *   waiting  -- "Assigned to X by Y · waiting for rider (m:ss left)" + Unassign
 *   accepted -- "Accepted by X"
 *   declined -- "Declined by X: reason — back to auto-dispatch"
 * Renders nothing when there is no manual assignment to talk about.
 */
export default function ManualAssignStatus({ order, vertical, onChanged, compact = false }) {
  const state = describeManualAssignment(order)
  const left = useCountdown(state.kind === "pending" ? state.deadline : null)
  const [unassigning, setUnassigning] = useState(false)

  if (state.kind === "none") return null

  const handleUnassign = async (event) => {
    event?.stopPropagation?.()
    const who = state.riderName || "the rider"
    if (!window.confirm(`Take this order back from ${who}? It goes back to auto-dispatch.`)) return
    setUnassigning(true)
    try {
      await adminAPI.unassignRider(vertical, orderKey(order))
      toast.success(`Unassigned ${who} — back to auto-dispatch`)
      onChanged?.()
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not unassign the rider"))
    } finally {
      setUnassigning(false)
    }
  }

  const textSize = compact ? "text-[11px]" : "text-sm"

  if (state.kind === "pending") {
    const waiting =
      left == null ? "waiting for rider" : left > 0 ? `waiting for rider (${formatLeft(left)} left)` : "waiting for rider (time up)"
    return (
      <div
        className={`flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 ${textSize} text-amber-800 whitespace-normal`}
        role="status"
        aria-live="polite"
      >
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>
          Assigned to <strong>{state.riderName || "rider"}</strong>
          {state.adminName ? ` by ${state.adminName}` : ""} · {waiting}
        </span>
        <button
          type="button"
          onClick={handleUnassign}
          disabled={unassigning}
          className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-60 text-[11px] font-medium"
        >
          {unassigning ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Unassign
        </button>
      </div>
    )
  }

  if (state.kind === "accepted") {
    return (
      <div className={`flex items-center gap-1.5 ${textSize} text-emerald-700`} role="status">
        <UserCheck className="w-3.5 h-3.5 shrink-0" />
        <span>
          Accepted by <strong>{state.riderName || "rider"}</strong>
        </span>
      </div>
    )
  }

  return (
    <div className={`flex items-start gap-1.5 ${textSize} text-rose-700 whitespace-normal`} role="status">
      <UserX className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{state.note} — back to auto-dispatch</span>
    </div>
  )
}
