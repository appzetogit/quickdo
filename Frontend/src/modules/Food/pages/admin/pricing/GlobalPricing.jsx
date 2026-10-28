import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, IndianRupee, Loader2, RotateCcw, TrendingDown, TrendingUp } from "lucide-react"
import { toast } from "sonner"
import { adminAPI } from "@food/api"

const RUPEE = "₹"

const QUICK_PERCENTS = [5, 10, 15, 20]

const formatPercent = (value) => {
  const number = Number(value) || 0
  const rounded = Math.round(number * 100) / 100
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}

const formatDate = (value) => {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString()
}

export default function GlobalPricing() {
  const [restaurants, setRestaurants] = useState([])
  const [restaurantId, setRestaurantId] = useState("")
  const [direction, setDirection] = useState("increase")
  const [percent, setPercent] = useState("10")
  const [itemCount, setItemCount] = useState(null)
  const [cappedCount, setCappedCount] = useState(0)
  // Dishes that would be left with nothing struck through. A decrease can
  // move every figure correctly and still blank the whole menu.
  const [noComparisonCount, setNoComparisonCount] = useState(0)
  const [history, setHistory] = useState([])
  // What the menus carry right now. The history above records what was asked
  // for, which is not the same thing -- a direct correction or a reset never
  // appears there -- and an admin who cannot see the standing figure compounds
  // a markup that is already applied.
  const [standing, setStanding] = useState([])
  // Real dishes at their real values. A generic "Rs 500 becomes Rs 550"
  // cannot tell you whether the last run actually landed; these can.
  const [samples, setSamples] = useState([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [revertingId, setRevertingId] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  const signedPercent = useMemo(() => {
    const parsed = Number(percent)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return direction === "decrease" ? -parsed : parsed
  }, [percent, direction])

  const loadHistory = useCallback(async () => {
    try {
      const response = await adminAPI.getPriceAdjustments({ limit: 20 })
      setHistory(response?.data?.data?.adjustments || [])
    } catch {
      toast.error("Failed to load adjustment history")
    }
  }, [])

  const loadStanding = useCallback(async () => {
    try {
      const response = await adminAPI.getStandingAdjustments()
      setStanding(response?.data?.data?.standing || [])
    } catch {
      // Silent: the form and the history are still usable without it, and a
      // second red toast on a page that already reports its own failures
      // teaches the operator to dismiss them.
      setStanding([])
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const response = await adminAPI.getRestaurants({ limit: 1000 })
        setRestaurants(
          response?.data?.data?.restaurants || response?.data?.restaurants || [],
        )
        await Promise.all([loadHistory(), loadStanding()])
      } catch {
        toast.error("Failed to load restaurants")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [loadHistory, loadStanding])

  useEffect(() => {
    let cancelled = false
    const loadPreview = async () => {
      try {
        const response = await adminAPI.getPriceAdjustmentPreview({
          ...(restaurantId ? { restaurantId } : {}),
          // Signed, not the raw box. Sending the unsigned number previewed every
          // decrease as an increase: the samples showed 500 -> 550 and the
          // "nothing struck through" warning was computed for the wrong
          // direction, which is the one case that warning exists to catch.
          percent: signedPercent ?? 0,
          // target is derived from the direction server-side; see priceAdjustment.service.js
        })
        if (!cancelled) {
          setItemCount(response?.data?.data?.itemCount ?? null)
          setCappedCount(response?.data?.data?.itemsCappedByMrp ?? 0)
          setSamples(response?.data?.data?.samples ?? [])
          setNoComparisonCount(response?.data?.data?.itemsWithoutComparison ?? 0)
        }
      } catch {
        if (!cancelled) {
          setItemCount(null)
          setCappedCount(0)
          setSamples([])
          setNoComparisonCount(0)
        }
      }
    }
    loadPreview()
    return () => {
      cancelled = true
    }
    // signedPercent covers both the number and the increase/decrease toggle, and
    // the direction is now the only thing deciding which figure moves -- the
    // server derives that from the sign, so there is nothing else to depend on.
    // It was missing entirely once: flipping to Decrease left the previous
    // preview on screen, describing a run the admin was no longer about to make.
  }, [restaurantId, signedPercent])

  const scopeLabel = restaurantId
    ? restaurants.find((r) => String(r?._id || r?.id) === restaurantId)?.restaurantName ||
      "the selected restaurant"
    : "every restaurant"


  const handleApply = async () => {
    if (signedPercent === null) {
      toast.error("Enter a percent greater than 0")
      return
    }
    try {
      setApplying(true)
      const response = await adminAPI.applyPriceAdjustment({
        percent: signedPercent,
        // target is derived from the direction server-side
        ...(restaurantId ? { restaurantId } : {}),
      })
      const capped = response?.data?.data?.itemsCappedByMrp ?? 0
      const baseMessage = response?.data?.message || "Prices updated"
      toast.success(
        capped > 0
          ? baseMessage + " — " + capped + " held at their MRP."
          : baseMessage,
      )
      setConfirmOpen(false)
      await Promise.all([loadHistory(), loadStanding()])
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to update prices")
    } finally {
      setApplying(false)
    }
  }

  const handleRevert = async (adjustment) => {
    const id = String(adjustment?._id || adjustment?.id || "")
    if (!id) return
    try {
      setRevertingId(id)
      const response = await adminAPI.revertPriceAdjustment(id)
      toast.success(response?.data?.message || "Adjustment reverted")
      await Promise.all([loadHistory(), loadStanding()])
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to revert adjustment")
    } finally {
      setRevertingId("")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Global Price Adjustment</h1>
        <p className="mt-1 text-sm text-slate-500">
          Raise or cut every menu price at once by a percentage. The new prices apply
          everywhere immediately &mdash; menu, cart, checkout and invoices.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Apply to</label>
          <select
            value={restaurantId}
            onChange={(e) => setRestaurantId(e.target.value)}
            className="w-full md:max-w-md px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
          >
            <option value="">All restaurants</option>
            {restaurants.map((restaurant) => {
              const id = String(restaurant?._id || restaurant?.id || "")
              return (
                <option key={id} value={id}>
                  {restaurant?.restaurantName || "Unnamed restaurant"}
                </option>
              )
            })}
          </select>
          {itemCount !== null && (
            <p className="mt-1 text-xs text-slate-500">
              {itemCount} food item{itemCount === 1 ? "" : "s"} will be updated.
              {cappedCount > 0 && (
                <span className="mt-1 block text-amber-700">
                  {cappedCount} of them would go above their MRP and will be held at it instead.
                </span>
              )}
              {noComparisonCount > 0 && (
                <span className="mt-1 block text-amber-700">
                  {noComparisonCount} of them would be left with nothing struck through — a
                  comparison only shows while it sits above the price you charge.
                </span>
              )}
            </p>
          )}
        </div>

        {/*
          What the percentage moves, spelled out because the two directions
          touch entirely different fields and the old copy did not say which:

            Both directions now store ONE number on each dish: the
            formulation percent, measured against the restaurant's own base
            price, which a run never writes. formulationPrice is re-derived
            from it, and what the customer sees follows:

              pays   = min(basePrice, formulationPrice)
              struck = max(basePrice, formulationPrice)

            increase -> formulationPrice lands above the base, so the base is
                        charged and the formulation is struck through. Nothing
                        a customer pays moves, and repeats are no-ops.
            decrease -> formulationPrice lands below, so it becomes what is
                        charged and the base is struck. This one does change
                        what customers pay.

            A run REPLACES the percent rather than compounding it, which is
            what stops +20% twice from meaning +44%.

          The comparison figure stays the default: a mis-click must not be able
          to silently reprice a live menu.
        */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">What this does</label>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {direction === "increase" ? (
              <>
                An <span className="font-semibold">increase</span> sets the struck-through comparison only.
                What the customer pays does not move: a &#8377;200 dish stays &#8377;200 and is shown as
                &ldquo;&#8377;200, was &#8377;{Math.round(200 * (1 + (Number(percent) || 0) / 100))}&rdquo;.
                Running it again lands on the same figure rather than compounding.
              </>
            ) : (
              <>
                A <span className="font-semibold">decrease</span> marks the menu down. Today&rsquo;s price becomes
                the struck-through one and the reduced figure is charged beneath it: a &#8377;200 dish becomes
                &ldquo;&#8377;{Math.max(1, Math.round(200 * (1 - (Number(percent) || 0) / 100)))}, was
                &#8377;200&rdquo;.
              </>
            )}
          </p>
          {direction === "decrease" && (
            <p className="mt-2 text-xs text-amber-700">
              A decrease changes what customers are charged. Each restaurant&rsquo;s own base price is kept
              exactly as typed &mdash; the cut is stored as a percentage against it, so running a decrease twice
              cuts from the same starting price rather than from the reduced one. Prices are saved first, so
              this can be reverted.
            </p>
          )}
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">Direction</span>
          <div className="flex gap-2">
            {[
              { value: "increase", label: "Increase", Icon: TrendingUp },
              { value: "decrease", label: "Decrease", Icon: TrendingDown },
            ].map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDirection(value)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium ${
                  direction === value
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Percent</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min="0"
              max="300"
              step="0.5"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className="w-32 px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
            />
            {QUICK_PERCENTS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPercent(String(value))}
                className="px-3 py-1.5 rounded-full border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {value}%
              </button>
            ))}
          </div>
        </div>

        {signedPercent !== null && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700">
            <span className="inline-flex items-center gap-1 font-medium">
              <IndianRupee className="h-4 w-4" />
              Formulation price on your actual menu
            </span>
            {samples.length === 0 ? (
              <span className="ml-2">
                {RUPEE}500 becomes {RUPEE}
                {Math.max(0.01, Math.round(500 * (1 + signedPercent / 100) * 100) / 100)}
              </span>
            ) : (
              <ul className="mt-2 space-y-1">
                {samples.map((s) => (
                  <li key={s.name} className="flex items-center justify-between gap-3">
                    <span className="truncate text-slate-600">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-right">
                      <span className="text-slate-500">{RUPEE}{s.current}</span>
                      <span className="mx-1 text-slate-400">&rarr;</span>
                      <span className="font-semibold text-slate-900">{RUPEE}{s.next}</span>
                      {/* What the formulation figure means for the bill. The
                          samples used to show only the number being moved, so a
                          run that changed the strike and a run that changed the
                          price looked identical here. */}
                      {s.paysAfter !== undefined && (
                        <span className="ml-2 text-xs text-slate-500">
                          (pays {RUPEE}{s.paysAfter}
                          {s.strikeAfter ? <>, was {RUPEE}{s.strikeAfter}</> : null})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={signedPercent === null}
          onClick={() => setConfirmOpen(true)}
          className="px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:bg-slate-300"
        >
          Apply {signedPercent !== null ? formatPercent(signedPercent) : ""} to {scopeLabel}
        </button>
      </div>


      {/* What is standing right now, per menu. Placed ABOVE the history on
          purpose: the history is what was asked for, and an admin about to
          apply another percent needs to see what is already on the menu first
          -- that is how a markup gets compounded twice. */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 md:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Currently applied</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Read from the menus themselves, so a correction made outside this page still shows.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 shrink-0">
            {standing.length} {standing.length === 1 ? "restaurant" : "restaurants"}
          </span>
        </div>
        {standing.length === 0 ? (
          <p className="px-4 md:px-6 py-8 text-sm text-slate-500">
            No approved dishes to read a formulation from yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {standing.map((row) => {
              const isSelected = restaurantId && String(restaurantId) === String(row.restaurantId)
              return (
                <li
                  key={row.restaurantId}
                  className={`px-4 md:px-6 py-3 flex items-center justify-between gap-4 ${
                    isSelected ? "bg-slate-50" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{row.restaurantName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {row.totalItems} {row.totalItems === 1 ? "dish" : "dishes"}
                      {row.isMixed
                        ? ` · ${row.onThisFormulation} on this formulation, the rest differ`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {row.isUntouched ? (
                      <span className="text-xs font-medium text-slate-400">Nothing applied</span>
                    ) : (
                      <>
                        {row.markupPercent > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            +{row.markupPercent}% markup
                          </span>
                        )}
                        {row.discountPercent > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            -{row.discountPercent}% off
                          </span>
                        )}
                      </>
                    )}
                    {row.isMixed && (
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200"
                        title="Part of this menu sits on a different formulation"
                      >
                        mixed
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 md:px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">Recent adjustments</h2>
        </div>
        {history.length === 0 ? (
          <p className="px-4 md:px-6 py-8 text-sm text-slate-500">
            No price adjustments applied yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((adjustment) => {
              const id = String(adjustment?._id || adjustment?.id || "")
              const isRevert = Boolean(adjustment?.revertsAdjustmentId)
              return (
                <li
                  key={id}
                  className="px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="text-sm">
                    <p className="font-medium text-slate-900">
                      {formatPercent(adjustment?.percent)} &middot;{" "}
                      {adjustment?.restaurantName || "All restaurants"}
                      {isRevert && (
                        <span className="ml-2 text-xs font-normal text-slate-500">(revert)</span>
                      )}
                      {adjustment?.isReverted && (
                        <span className="ml-2 text-xs font-normal text-amber-600">reverted</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {adjustment?.itemsUpdated || 0} item(s) &middot;{" "}
                      {formatDate(adjustment?.createdAt)}
                      {adjustment?.appliedByName ? ` · ${adjustment.appliedByName}` : ""}
                    </p>
                  </div>
                  {!isRevert && !adjustment?.isReverted && (
                    <button
                      type="button"
                      onClick={() => handleRevert(adjustment)}
                      disabled={revertingId === id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 disabled:opacity-50"
                    >
                      {revertingId === id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      Revert
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-slate-900">Confirm price change</h3>
                <p className="mt-1 text-sm text-slate-600">
                  This will change the price of{" "}
                  <strong>
                    {itemCount ?? "all"} food item{itemCount === 1 ? "" : "s"}
                  </strong>{" "}
                  across <strong>{scopeLabel}</strong> by{" "}
                  <strong>{formatPercent(signedPercent)}</strong>. Customers see the new
                  prices right away. You can revert this from the history below.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={applying}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:bg-slate-400"
              >
                {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
