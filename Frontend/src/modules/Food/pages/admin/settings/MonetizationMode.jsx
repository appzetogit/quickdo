import { useEffect, useRef, useState } from "react"
import { Percent, CalendarClock, Loader2, AlertTriangle, Check } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@food/components/ui/dialog"
import { adminAPI } from "@food/api"
import { toast } from "sonner"

/**
 * The platform-wide choice between charging restaurants a per-order commission
 * and billing them a recurring plan. One switch for every restaurant: the two
 * are alternatives, and a restaurant on both is charged twice.
 *
 * Confirmation is deliberate. This changes what every future order earns, and
 * the number it affects is shown in the dialog because "switch to plan billing"
 * reads very differently against 3 restaurants than against 300.
 */
const MODES = [
  {
    value: "commission",
    label: "Commission",
    Icon: Percent,
    blurb: "Each restaurant is charged its own rate on every order.",
    detail:
      "Rates come from Restaurant Commission, including any dated schedules. Nothing is billed to the restaurant separately.",
  },
  {
    value: "plan",
    label: "Subscription plan",
    Icon: CalendarClock,
    blurb: "No per-order cut. Restaurants pay a recurring fee instead.",
    detail:
      "Orders record a zero commission for the reason 'plan mode'. Existing per-restaurant rates are kept, not deleted, so switching back restores them.",
  },
]

export default function MonetizationMode() {
  const [mode, setMode] = useState(null)
  const [restaurantCount, setRestaurantCount] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)

  /*
   * Never fall back to a mode when the read fails.
   *
   * Defaulting to "commission" here would paint the Active badge on a state
   * nothing confirmed -- and a dev server answering an unproxied API path with
   * index.html is enough to trigger it, which is exactly how this was caught.
   * Showing which billing model is live is the entire job of this screen, so a
   * guess is worse than an error.
   */
  const load = async () => {
    try {
      const res = await adminAPI.getMonetizationMode()
      const data = res?.data?.data ?? res?.data
      const next = data?.monetizationMode
      if (next !== "commission" && next !== "plan") {
        throw new Error("Unrecognised billing mode in response")
      }
      setMode(next)
      setRestaurantCount(Number.isFinite(data?.restaurantCount) ? data.restaurantCount : null)
      setUpdatedAt(data?.updatedAt ?? null)
      setLoadFailed(false)
    } catch {
      setMode(null)
      setLoadFailed(true)
      toast.error("Could not load the billing mode")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const apply = async () => {
    if (!pending) return
    setSaving(true)
    try {
      const res = await adminAPI.updateMonetizationMode(pending)
      const data = res?.data?.data ?? res?.data
      setMode(data?.monetizationMode ?? pending)
      setPending(null)
      toast.success(
        data?.monetizationMode === "plan"
          ? "Switched to subscription plans. New orders will not be charged commission."
          : "Switched to commission. New orders are charged each restaurant's rate.",
      )
      load()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not change the billing mode")
    } finally {
      setSaving(false)
    }
  }

  /*
   * The dialog keeps its wording while it animates closed.
   *
   * Clearing `pending` on confirm closes the dialog, but the exit animation
   * still paints a frame or two -- and reading the copy straight off `pending`
   * rendered "Switch to ?" with a blank button for that moment, which looks
   * like the confirmation failed at the exact instant it succeeded.
   */
  const lastModeRef = useRef(null)
  const livePendingMode = MODES.find((m) => m.value === pending)
  if (livePendingMode) lastModeRef.current = livePendingMode
  const pendingMode = livePendingMode || lastModeRef.current

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-black text-slate-900 tracking-tight">Monetization Mode</h1>
      <p className="mt-1 text-sm text-slate-600">
        How the platform earns from restaurants. This applies to every restaurant at once.
      </p>

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : loadFailed ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <AlertTriangle className="h-5 w-5" />
            Could not read the current billing mode
          </div>
          <p className="mt-2 text-sm text-amber-800">
            Switching is disabled until it loads, because changing a mode without knowing the
            current one could turn commission off across the platform by accident.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              load()
            }}
            className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {MODES.map(({ value, label, Icon, blurb, detail }) => {
              const active = mode === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => !active && setPending(value)}
                  aria-pressed={active}
                  className={`text-left rounded-2xl border p-5 transition ${
                    active
                      ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-200"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${active ? "text-indigo-600" : "text-slate-400"}`} />
                    <span className="font-bold text-slate-900">{label}</span>
                    {active && (
                      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white">
                        <Check className="h-3 w-3" /> Active
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-700">{blurb}</p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p>
                </button>
              )
            })}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            {restaurantCount === null ? null : (
              <>Applies to {restaurantCount} approved restaurant{restaurantCount === 1 ? "" : "s"}. </>
            )}
            Orders already placed keep the mode they were taken under, so changing this never
            re-prices past orders.
            {updatedAt ? ` Last changed ${new Date(updatedAt).toLocaleString()}.` : ""}
          </p>
        </>
      )}

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && !saving && setPending(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Switch to {pendingMode?.label}?
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm text-slate-600 space-y-2">
            <p>{pendingMode?.detail}</p>
            <p>
              This changes how every future order is billed
              {restaurantCount !== null ? ` across ${restaurantCount} restaurant${restaurantCount === 1 ? "" : "s"}` : ""}.
              Orders already placed are unaffected.
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Switch to {pendingMode?.label}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
