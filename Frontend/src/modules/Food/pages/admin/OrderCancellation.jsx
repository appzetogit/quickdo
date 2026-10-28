import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import apiClient from "@food/api/axios"

/**
 * How long a customer may cancel a food order after the restaurant accepts it.
 * The server enforces it (orders/services/cancellationPolicy.js); the customer
 * app shows Cancel with a countdown while the window is open.
 */

const PRESETS = [2, 5, 10, 15]

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${checked ? "bg-emerald-600" : "bg-neutral-300"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  )
}

export default function OrderCancellation() {
  const [saved, setSaved] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient
      .get("/food/admin/order-cancellation", { contextModule: "admin" })
      .then((res) => {
        const data = res?.data?.data
        setSaved(data)
        setForm({ ...data, windowMinutes: String(data?.windowMinutes ?? 5) })
      })
      .catch((err) => toast.error(err?.response?.data?.message || "Could not load the setting"))
  }, [])

  if (!form) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-neutral-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading
      </div>
    )
  }

  const minutes = Number(form.windowMinutes)
  const validMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= 120
  const dirty =
    form.allowAfterAccept !== saved.allowAfterAccept ||
    form.stopWhenPreparing !== saved.stopWhenPreparing ||
    minutes !== Number(saved.windowMinutes)

  const save = async () => {
    if (form.allowAfterAccept && !validMinutes) return toast.error("Choose between 1 and 120 minutes")
    setSaving(true)
    try {
      const res = await apiClient.put(
        "/food/admin/order-cancellation",
        {
          allowAfterAccept: form.allowAfterAccept,
          stopWhenPreparing: form.stopWhenPreparing,
          ...(validMinutes ? { windowMinutes: minutes } : {}),
        },
        { contextModule: "admin" },
      )
      const data = res?.data?.data
      setSaved(data)
      setForm({ ...data, windowMinutes: String(data?.windowMinutes ?? minutes) })
      toast.success("Saved. It applies to orders straight away.")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not save")
    } finally {
      setSaving(false)
    }
  }

  const summary = !form.allowAfterAccept
    ? "Customers can cancel only while the restaurant has not accepted the order."
    : `Customers can cancel for ${validMinutes ? minutes : "…"} minute${minutes === 1 ? "" : "s"} after the restaurant accepts${form.stopWhenPreparing ? ", unless the kitchen has already started preparing it" : ""}. Never once the rider has picked it up.`

  return (
    <div className="min-h-full bg-neutral-100 p-4 lg:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Order cancellation</h1>
          <p className="mt-1 text-sm text-neutral-600">How long a customer can still cancel a food order after the restaurant accepts it.</p>
        </div>

        {saved?.overriddenByMaster?.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <p className="font-medium">Master &gt; Cancellation Policy is overriding this page.</p>
            <p className="mt-0.5">
              In force now: {saved.inForce.allowAfterAccept
                ? `cancelling allowed for ${saved.inForce.windowMinutes} minutes after acceptance${saved.inForce.stopWhenPreparing ? ", until preparing starts" : ""}`
                : "cancelling only before the restaurant accepts"}
              . Changes here are saved but take effect only once the Master value is cleared.{" "}
              <a href="/admin/master/cancellation" className="font-medium underline">Open Master</a>
            </p>
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div>
              <p className="font-medium text-neutral-900">Allow cancelling after the restaurant accepts</p>
              <p className="mt-0.5 text-sm text-neutral-500">Off: the Cancel option disappears the moment the restaurant accepts.</p>
            </div>
            <Toggle checked={form.allowAfterAccept} onChange={(v) => setForm((f) => ({ ...f, allowAfterAccept: v }))} label="Allow cancelling after the restaurant accepts" />
          </div>

          {form.allowAfterAccept && (
            <>
              <div className="border-t border-neutral-100 px-5 py-4">
                <label htmlFor="cancel-minutes" className="font-medium text-neutral-900">For how long</label>
                <p className="mt-0.5 text-sm text-neutral-500">Counted from the moment the restaurant accepts.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, windowMinutes: String(m) }))}
                      aria-pressed={minutes === m}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${minutes === m ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700 hover:border-neutral-500"}`}
                    >
                      {m} min
                    </button>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      id="cancel-minutes"
                      type="number"
                      min="1"
                      max="120"
                      value={form.windowMinutes}
                      onChange={(e) => setForm((f) => ({ ...f, windowMinutes: e.target.value.replace(/[^0-9]/g, "") }))}
                      className={`w-20 rounded-lg border px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-neutral-900/10 ${validMinutes ? "border-neutral-300" : "border-red-400"}`}
                    />
                    <span className="text-sm text-neutral-600">minutes</span>
                  </div>
                </div>
                {!validMinutes && <p className="mt-1.5 text-xs text-red-600">Choose between 1 and 120 minutes.</p>}
              </div>

              <div className="flex items-start justify-between gap-4 border-t border-neutral-100 px-5 py-4">
                <div>
                  <p className="font-medium text-neutral-900">Stop once the kitchen starts preparing</p>
                  <p className="mt-0.5 text-sm text-neutral-500">Recommended. When the restaurant marks the order Preparing, cancelling ends even if minutes are left.</p>
                </div>
                <Toggle checked={form.stopWhenPreparing} onChange={(v) => setForm((f) => ({ ...f, stopWhenPreparing: v }))} label="Stop once the kitchen starts preparing" />
              </div>
            </>
          )}

          <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-3 text-sm text-neutral-700">{summary}</div>
        </section>

        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <button type="button" onClick={() => setForm({ ...saved, windowMinutes: String(saved.windowMinutes) })} className="rounded-lg px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-200">
              Discard
            </button>
          )}
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2 text-sm font-semibold text-white hover:bg-neutral-800 disabled:bg-neutral-300"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}
