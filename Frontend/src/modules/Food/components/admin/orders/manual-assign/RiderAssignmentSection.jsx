import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bike } from "lucide-react"
import { adminAPI } from "@food/api"
import AssignRiderButton from "./AssignRiderButton"
import ManualAssignStatus from "./ManualAssignStatus"
import { useAdminDispatchSocket } from "./useAdminDispatchSocket"
import {
  adminVerticalFromPath,
  canAssignRider,
  describeManualAssignment,
  eventMatchesOrder,
  isManualPending,
  orderKey,
  withLiveEvent,
} from "./manualAssignUtils"

const FALLBACK_REFRESH_MS = 10000

/**
 * Rider assignment block for an order details view.
 *
 * Reads the order afresh when shown (list rows can be a few seconds old, and
 * some lists -- the prescription queue -- carry no dispatch data at all), then
 * stays current from the admin socket. Without a socket it re-reads every 10s,
 * and only while a manual assignment is waiting on the rider.
 *
 * `order` must carry the raw orderStatus somewhere (status / rawOrderStatus)
 * for the button to decide whether to show before the fresh read lands.
 */
export default function RiderAssignmentSection({ order, vertical: verticalProp, onChanged, title = "Rider assignment" }) {
  const vertical = verticalProp || adminVerticalFromPath()
  const id = orderKey(order)
  const [fresh, setFresh] = useState(null)
  const [liveEvent, setLiveEvent] = useState(null)
  const refetchTimer = useRef(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!id) return
    const mySeq = ++seq.current
    try {
      const res = await adminAPI.getOrderById(id)
      const next = res?.data?.data?.order || res?.data?.order || null
      if (next && mySeq === seq.current) {
        setFresh(next)
        setLiveEvent(null)
      }
    } catch {
      // Keep showing what the list gave us; the next event or tick retries.
    }
  }, [id])

  useEffect(() => {
    setFresh(null)
    setLiveEvent(null)
    refresh()
  }, [refresh])

  useEffect(() => () => clearTimeout(refetchTimer.current), [])

  const base = useMemo(
    () => (fresh ? { ...order, ...fresh, rawOrderStatus: fresh.orderStatus } : order),
    [order, fresh],
  )

  const onSocketEvent = useCallback(
    (eventName, payload) => {
      if (!eventMatchesOrder(payload, base)) return
      if (eventName === "manual_assignment_update") setLiveEvent(payload)
      clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(refresh, 400)
    },
    [base, refresh],
  )
  const { connected } = useAdminDispatchSocket(vertical, onSocketEvent, { enabled: !!id })

  const pending = isManualPending(base)
  useEffect(() => {
    if (connected || !pending) return undefined
    const timer = setInterval(refresh, FALLBACK_REFRESH_MS)
    return () => clearInterval(timer)
  }, [connected, pending, refresh])

  const shown = liveEvent ? withLiveEvent(base, liveEvent) : base
  const hasStatus = describeManualAssignment(shown).kind !== "none"
  const showButton = canAssignRider(shown)
  if (!hasStatus && !showButton) return null

  const handleChanged = () => {
    refresh()
    onChanged?.()
  }

  return (
    <div className="border-t border-slate-200 pt-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
        <Bike className="w-4 h-4" />
        {title}
      </h3>
      <div className="space-y-3">
        <ManualAssignStatus order={shown} vertical={vertical} onChanged={handleChanged} />
        <AssignRiderButton order={shown} vertical={vertical} onAssigned={handleChanged} />
      </div>
    </div>
  )
}
