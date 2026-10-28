import { useMemo } from "react"

/**
 * Per-item serving windows, in both directions:
 *
 *   "breakfast, 08:00-11:30"        -- the hours it is ON
 *   "off between 12:00 and 15:00"   -- a kitchen break
 *
 * Both were needed and only the first existed, so a restaurant wanting a dish
 * off over lunch typed those hours into the only control there was and got the
 * exact opposite: the dish sold for those three hours and no others. Each day
 * now says which way its window reads.
 *
 * Shared by the restaurant menu editor and the admin food editor so both panels
 * produce exactly the shape the server normalizes
 * (Backend/src/modules/food/shared/itemAvailability.js). The server is the
 * authority: it re-normalizes on save and re-checks at checkout. This is a
 * convenience, never the enforcement.
 */

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]

const DEFAULT_START = "09:00"
const DEFAULT_END = "22:00"

/** The value this editor works with, built from whatever the API returned. */
export const buildScheduleState = (schedule) => {
  const days = Array.isArray(schedule?.days) ? schedule.days : []
  return {
    isEnabled: schedule?.isEnabled === true,
    timezone: schedule?.timezone || "Asia/Kolkata",
    days: DAY_NAMES.map((day) => {
      const found = days.find(
        (d) => String(d?.day || "").toLowerCase() === day.toLowerCase()
      )
      return {
        day,
        isAvailable: found ? found.isAvailable !== false : true,
        startTime: found?.startTime || DEFAULT_START,
        endTime: found?.endTime || DEFAULT_END,
        // Anything the server has not sent a mode for was saved before modes
        // existed, and means "available during" -- same as the server's default.
        mode: found?.mode === "unavailable" ? "unavailable" : "available",
      }
    }),
  }
}

/** True when the schedule would hide the item on every day of the week. */
export const isScheduleEmpty = (state) =>
  state?.isEnabled === true && (state?.days || []).every((d) => d.isAvailable === false)

export default function ItemAvailabilityScheduleEditor({ value, onChange, disabled = false }) {
  const state = useMemo(() => buildScheduleState(value), [value])

  const update = (next) => {
    if (disabled) return
    onChange?.(next)
  }

  const setDay = (day, patch) =>
    update({
      ...state,
      days: state.days.map((d) => (d.day === day ? { ...d, ...patch } : d)),
    })

  const applyMondayToAll = () => {
    const monday = state.days.find((d) => d.day === "Monday")
    if (!monday) return
    update({
      ...state,
      days: state.days.map((d) => ({
        ...d,
        isAvailable: monday.isAvailable,
        startTime: monday.startTime,
        endTime: monday.endTime,
        // The mode copies with the hours. Copying 12:00-15:00 without it would
        // turn a break into a serving window on the other six days, which is
        // the exact confusion the mode exists to end.
        mode: monday.mode,
      })),
    })
  }

  const noDaysOn = isScheduleEmpty(state)

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-gray-900">Set hours for this item</p>
          <p className="mt-0.5 text-sm text-gray-500">
            Off means the item can be ordered whenever the outlet is open. On, each
            day can either be sold <em>only</em> during its hours, or sold all day{" "}
            <em>except</em> during them.
          </p>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={state.isEnabled}
            disabled={disabled}
            onChange={(e) => update({ ...state, isEnabled: e.target.checked })}
          />
          <span className="text-sm">{state.isEnabled ? "On" : "Off"}</span>
        </label>
      </div>

      {state.isEnabled && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Times are {state.timezone.replace("_", " ")} local time. An end time
              earlier than the start (e.g. 22:00&ndash;02:00) runs past midnight.
            </p>
            <button
              type="button"
              onClick={applyMondayToAll}
              disabled={disabled}
              className="shrink-0 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
            >
              Copy Monday to all
            </button>
          </div>

          {state.days.map((d) => (
            <div key={d.day} className="flex flex-wrap items-center gap-3 rounded-md bg-gray-50 px-3 py-2">
              <label className="inline-flex w-32 shrink-0 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={d.isAvailable}
                  disabled={disabled}
                  onChange={(e) => setDay(d.day, { isAvailable: e.target.checked })}
                />
                <span className="text-sm">{d.day}</span>
              </label>

              {d.isAvailable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={d.mode}
                    disabled={disabled}
                    onChange={(e) => setDay(d.day, { mode: e.target.value })}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                  >
                    <option value="available">Available only</option>
                    <option value="unavailable">Off between</option>
                  </select>
                  <input
                    type="time"
                    value={d.startTime}
                    disabled={disabled}
                    onChange={(e) => setDay(d.day, { startTime: e.target.value })}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                  <span className="text-sm text-gray-400">to</span>
                  <input
                    type="time"
                    value={d.endTime}
                    disabled={disabled}
                    onChange={(e) => setDay(d.day, { endTime: e.target.value })}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                  {d.startTime >= d.endTime && (
                    <span className="text-xs text-amber-600">runs past midnight</span>
                  )}
                  <span className="w-full text-xs text-gray-500 sm:w-auto">
                    {d.mode === "unavailable"
                      ? `Sold all day except ${d.startTime}–${d.endTime}`
                      : `Sold only ${d.startTime}–${d.endTime}`}
                  </span>
                </div>
              ) : (
                <span className="text-sm text-gray-400">Not available</span>
              )}
            </div>
          ))}

          {noDaysOn && (
            <p className="text-sm text-red-600">
              Every day is switched off, so the item would never be orderable. Turn
              on at least one day, or switch the schedule off.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
