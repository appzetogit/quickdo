import { useState } from "react"
import { Loader2, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

/*
 * GSTIN verification status in restaurant review (SOW plan 6.4).
 *
 * Shows what the server stored at registration (restaurant.gstVerification)
 * and lets the reviewer re-run the check: POST /food/admin/restaurants/:id/gst-verify.
 * The legal name / address are filled from the register only where the
 * restaurant left them blank; disagreements are listed for the reviewer.
 */
const STATUS = {
  verified: { label: "Verified with the GST register", tone: "green" },
  offline_valid: { label: "Format and check digit valid (no GST register lookup configured)", tone: "blue" },
  invalid: { label: "Invalid GSTIN", tone: "red" },
  not_found: { label: "Not found in the GST register", tone: "red" },
  inactive: { label: "GSTIN is not active", tone: "red" },
  error: { label: "GST register unreachable at the last check", tone: "amber" },
}
const TONES = {
  green: "bg-green-50 border-green-200 text-green-800",
  blue: "bg-blue-50 border-blue-200 text-blue-800",
  red: "bg-red-50 border-red-200 text-red-800",
  amber: "bg-amber-50 border-amber-200 text-amber-800",
  gray: "bg-slate-50 border-slate-200 text-slate-700",
}
const FIELD = { legalName: "Legal name", pan: "PAN", state: "State" }

export default function GstVerificationPanel({ restaurantId, verification, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const status = verification ? STATUS[verification.status] || { label: verification.status, tone: "gray" } : null
  const good = verification && ["verified", "offline_valid"].includes(verification.status) && !(verification.mismatches || []).length

  const recheck = async () => {
    if (!restaurantId) return
    setBusy(true)
    try {
      const res = await adminAPI.reverifyRestaurantGst(restaurantId)
      const data = res?.data?.data || {}
      onUpdated?.(data)
      toast.success("GSTIN re-checked")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not re-check the GSTIN")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`md:col-span-2 rounded-lg border px-3 py-2.5 text-xs ${TONES[status?.tone || "gray"]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {good ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          <div>
            <p className="font-semibold">{status ? status.label : "Not verified yet"}</p>
            {verification?.reason && <p className="mt-0.5">{verification.reason}</p>}
            {verification?.legalName && <p className="mt-0.5">On record: {verification.legalName}{verification.tradeName ? ` (${verification.tradeName})` : ""}</p>}
            {verification?.address && <p className="mt-0.5">Registered address: {verification.address}</p>}
            {(verification?.mismatches || []).map((m) => (
              <p key={m.field} className="mt-0.5 font-semibold">
                Mismatch – {FIELD[m.field] || m.field}: entered "{m.provided}", on record "{m.registered}"
              </p>
            ))}
            {verification?.checkedAt && (
              <p className="mt-0.5 opacity-70">Checked {new Date(verification.checkedAt).toLocaleString("en-IN")}{verification.provider && verification.provider !== "none" ? ` via ${verification.provider}` : ""}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={recheck}
          disabled={busy || !restaurantId}
          className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-1 font-semibold whitespace-nowrap disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Re-check
        </button>
      </div>
    </div>
  )
}
