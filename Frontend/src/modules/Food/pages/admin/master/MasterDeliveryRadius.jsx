import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, MapPin, Search } from "lucide-react"
import { toast } from "sonner"
import apiClient from "@food/api/axios"

/*
 * Master > Delivery Radius: how far each restaurant delivers, every restaurant
 * on one page.
 *
 * A restaurant only reaches customers inside its zone AND within its radius
 * (straight line in the list, road distance at checkout), so one big zone for
 * a town plus a radius per restaurant is enough. A blank radius means the
 * platform maximum. The restaurant can change its own radius from its app;
 * both sides save the same field, so "Last changed by" says who did it.
 */

const kmText = (n) => (n == null ? "" : String(Number(n)))

const whenLabel = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}

const apiError = (err, fallback) => err?.response?.data?.message || fallback

export default function MasterDeliveryRadius() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState("")
  const [ceiling, setCeiling] = useState("")
  const [savingCeiling, setSavingCeiling] = useState(false)
  const [q, setQ] = useState("")

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/food/admin/service-radius/restaurants", { contextModule: "admin" })
      const d = res?.data?.data || null
      setData(d)
      setCeiling(kmText(d?.settings?.maxRadiusKm))
      setDrafts({})
    } catch (err) {
      toast.error(apiError(err, "Could not load delivery radii"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const maxKm = data?.settings?.maxRadiusKm ?? 20
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const all = data?.restaurants || []
    return needle ? all.filter((r) => r.restaurantName.toLowerCase().includes(needle)) : all
  }, [data, q])

  const draftOf = (r) => (r.restaurantId in drafts ? drafts[r.restaurantId] : kmText(r.serviceRadiusKm))
  const isDirty = (r) => draftOf(r).trim() !== kmText(r.serviceRadiusKm)

  const saveRow = async (r) => {
    const text = draftOf(r).trim()
    const value = text === "" ? null : Number(text)
    if (value !== null && !Number.isFinite(value)) {
      toast.error("Enter the radius in km, or leave it blank for the maximum")
      return
    }
    setSavingId(r.restaurantId)
    try {
      const res = await apiClient.put(
        `/food/admin/restaurants/${r.restaurantId}/service-radius`,
        { serviceRadiusKm: value },
        { contextModule: "admin" },
      )
      const saved = res?.data?.data
      setData((d) => ({
        ...d,
        restaurants: d.restaurants.map((x) => (x.restaurantId === r.restaurantId ? { ...x, ...saved } : x)),
      }))
      setDrafts(({ [r.restaurantId]: _drop, ...rest }) => rest)
      toast.success(
        value === null
          ? `${r.restaurantName} now delivers up to the ${maxKm} km maximum`
          : `${r.restaurantName} now delivers within ${saved?.effectiveRadiusKm ?? value} km`,
      )
    } catch (err) {
      toast.error(apiError(err, "Could not save the radius"))
    } finally {
      setSavingId("")
    }
  }

  const saveCeiling = async () => {
    setSavingCeiling(true)
    try {
      await apiClient.put(
        "/food/admin/service-radius/settings",
        { maxRadiusKm: Number(ceiling) },
        { contextModule: "admin" },
      )
      toast.success("Maximum radius saved")
      await load()
    } catch (err) {
      toast.error(apiError(err, "Could not save the maximum radius"))
    } finally {
      setSavingCeiling(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Delivery Radius</h1>
          <p className="max-w-2xl text-sm text-neutral-500">
            How far each restaurant delivers from its kitchen. A customer must be inside the restaurant&apos;s zone and
            within this distance. Leave a radius blank to use the maximum.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-800">Maximum radius for any restaurant</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                step="0.5"
                value={ceiling}
                onChange={(e) => setCeiling(e.target.value)}
                className="w-24 rounded-lg border border-neutral-300 px-3 py-1.5 tabular-nums"
              />
              <span className="text-neutral-500">km</span>
            </span>
          </label>
          <button
            type="button"
            onClick={saveCeiling}
            disabled={savingCeiling || ceiling.trim() === kmText(data?.settings?.maxRadiusKm)}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {savingCeiling ? "Saving…" : "Save maximum"}
          </button>
          <p className="basis-full text-xs text-neutral-500">
            Restaurants with a blank radius deliver this far. A restaurant set higher is held to this, and gets its own
            value back if you raise the maximum again.
          </p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 p-3">
            <span className="text-sm text-neutral-600">{data ? `${data.restaurants.length} restaurants` : ""}</span>
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search restaurant"
                className="w-full rounded-lg border border-neutral-300 py-2 pl-8 pr-3 text-sm"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">Restaurant</th>
                  <th className="px-4 py-2.5">Delivers within</th>
                  <th className="px-4 py-2.5">Set radius (km)</th>
                  <th className="px-4 py-2.5">Last changed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-neutral-500">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-neutral-500">
                      No restaurant matches this search.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.restaurantId}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-neutral-900">{r.restaurantName || "Unnamed"}</div>
                        <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
                          {r.status && <span className="capitalize">{r.status}</span>}
                          {!r.hasLocation && (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <MapPin className="h-3 w-3" />
                              No location saved
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        <span className="font-medium text-neutral-900">{r.effectiveRadiusKm} km</span>
                        {r.usesDefault && <span className="ml-1.5 text-xs text-neutral-500">maximum</span>}
                        {r.capped && (
                          <span className="ml-1.5 text-xs text-amber-700">held to maximum (set {r.serviceRadiusKm} km)</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            saveRow(r)
                          }}
                        >
                          <input
                            type="number"
                            min="1"
                            max={maxKm}
                            step="0.5"
                            value={draftOf(r)}
                            placeholder={`${maxKm} (max)`}
                            disabled={!r.hasLocation}
                            onChange={(e) => setDrafts((d) => ({ ...d, [r.restaurantId]: e.target.value }))}
                            className="w-24 rounded-lg border border-neutral-300 px-2.5 py-1.5 tabular-nums disabled:bg-neutral-100"
                          />
                          <button
                            type="submit"
                            disabled={!isDirty(r) || savingId === r.restaurantId}
                            className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-40"
                          >
                            {savingId === r.restaurantId ? "Saving…" : "Save"}
                          </button>
                        </form>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-neutral-500">
                        {r.updatedBy ? (
                          <>
                            <span className="capitalize">{r.updatedBy}</span>
                            {r.updatedAt && <span> · {whenLabel(r.updatedAt)}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
