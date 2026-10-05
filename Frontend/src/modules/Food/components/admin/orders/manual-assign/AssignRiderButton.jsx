import { useState } from "react"
import { Bike } from "lucide-react"
import AssignRiderModal from "./AssignRiderModal"
import { canAssignRider, isManualPending } from "./manualAssignUtils"

/**
 * "Assign rider" (or "Reassign rider" while a manual hand-off is pending) plus
 * its modal. Renders nothing once the order is past the assignable states or a
 * rider has accepted it.
 */
export default function AssignRiderButton({ order, vertical, onAssigned, size = "sm", className = "" }) {
  const [open, setOpen] = useState(false)
  if (!order || !canAssignRider(order)) return null

  const label = isManualPending(order) ? "Reassign rider" : "Assign rider"
  const sizing = size === "xs" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        title={label}
        className={`inline-flex items-center gap-1 rounded font-medium text-white bg-slate-800 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-colors ${sizing} ${className}`}
      >
        <Bike className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>
      {open && (
        // React events bubble out of the dialog's portal to this button's
        // ancestors; a clickable table row must not see clicks made inside it.
        <span className="contents" onClick={(event) => event.stopPropagation()}>
          <AssignRiderModal
            open={open}
            onOpenChange={setOpen}
            order={order}
            vertical={vertical}
            onAssigned={onAssigned}
          />
        </span>
      )}
    </>
  )
}
