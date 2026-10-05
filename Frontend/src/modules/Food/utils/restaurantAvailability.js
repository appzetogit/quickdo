const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const normalizeDay = (value) => {
  if (!value || typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  const match = DAY_NAMES.find((day) => day.toLowerCase() === trimmed)
  if (match) return match

  const abbreviatedMatch = DAY_NAMES.find((day) =>
    day.toLowerCase().startsWith(trimmed.slice(0, 3))
  )
  return abbreviatedMatch || null
}

const parseTimeToMinutes = (timeValue) => {
  if (!timeValue || typeof timeValue !== "string") return null
  const raw = timeValue.trim()
  if (!raw) return null

  const normalized = raw.toLowerCase()
  const meridiemMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/)
  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1])
    const minute = Number(meridiemMatch[2])
    const period = meridiemMatch[3]

    if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null

    if (period === "pm" && hour < 12) hour += 12
    if (period === "am" && hour === 12) hour = 0
    if (hour < 0 || hour > 23) return null
    return hour * 60 + minute
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/)
  if (!twentyFourHourMatch) return null

  const hour = Number(twentyFourHourMatch[1])
  const minute = Number(twentyFourHourMatch[2])
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return hour * 60 + minute
}

const getTodayTiming = (restaurant, dayName) => {
  const outletTimingsArray = restaurant?.outletTimings?.timings
  if (Array.isArray(outletTimingsArray)) {
    const exact = outletTimingsArray.find((entry) => normalizeDay(entry?.day) === dayName)
    if (exact) return exact
  }

  const outletTimingsObject = restaurant?.outletTimings
  if (outletTimingsObject && typeof outletTimingsObject === "object" && !Array.isArray(outletTimingsObject)) {
    const direct = outletTimingsObject[dayName]
    if (direct && typeof direct === "object") return direct
  }

  return null
}

const isWithinTimeWindow = (nowMinutes, openingMinutes, closingMinutes) => {
  if (openingMinutes === null || closingMinutes === null) return true
  if (openingMinutes === closingMinutes) return true

  if (closingMinutes > openingMinutes) {
    return nowMinutes >= openingMinutes && nowMinutes <= closingMinutes
  }

  return nowMinutes >= openingMinutes || nowMinutes <= closingMinutes
}

const getMinutesUntilClosing = (nowMinutes, openingMinutes, closingMinutes) => {
  if (openingMinutes === null || closingMinutes === null) return null
  if (!isWithinTimeWindow(nowMinutes, openingMinutes, closingMinutes)) return null

  if (closingMinutes > openingMinutes) {
    return closingMinutes - nowMinutes
  }

  if (nowMinutes <= closingMinutes) {
    return closingMinutes - nowMinutes
  }

  return (24 * 60 - nowMinutes) + closingMinutes
}

const formatTimeLabel = (timeValue) => {
  const totalMinutes = parseTimeToMinutes(timeValue)
  if (totalMinutes === null) return timeValue || null

  const hours24 = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const period = hours24 >= 12 ? "PM" : "AM"
  const hours12 = hours24 % 12 || 12

  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`
}

const formatClosingCountdown = (minutesUntilClose, closingTime) => {
  if (minutesUntilClose === null || minutesUntilClose === undefined) return null

  if (minutesUntilClose <= 0) {
    const closingLabel = formatTimeLabel(closingTime)
    return closingLabel ? `Closes at ${closingLabel}` : null
  }

  if (minutesUntilClose < 60) {
    return `Closes in ${minutesUntilClose} min`
  }

  const hours = Math.floor(minutesUntilClose / 60)
  const minutes = minutesUntilClose % 60

  if (minutes === 0) {
    return `Closes in ${hours}h`
  }

  return `Closes in ${hours}h ${minutes}m`
}

export const getRestaurantAvailabilityStatus = (restaurant, now = new Date(), options = {}) => {
  if (!restaurant) {
    return {
      isOpen: false,
      isActive: false,
      isAcceptingOrders: false,
      isWithinTimings: false,
      reason: "missing-restaurant",
    }
  }

  const ignoreOperationalStatus = options?.ignoreOperationalStatus === true
  const isActive = restaurant.isActive !== false
  const isAcceptingOrders = restaurant.isAcceptingOrders !== false

  if (!ignoreOperationalStatus && !isActive) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: "inactive",
    }
  }

  if (!ignoreOperationalStatus && !isAcceptingOrders) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: "not-accepting-orders",
    }
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  
  /**
   * Check a specific day's timing window
   */
  const checkDayWindow = (targetDate) => {
    const dayName = DAY_NAMES[targetDate.getDay()]
    const timing = getTodayTiming(restaurant, dayName)
    const openDays = Array.isArray(restaurant.openDays) ? restaurant.openDays : []

    // If day is explicitly marked as closed in outlet timings
    if (timing && timing.isOpen === false) return { isWithin: false, hasWindow: true, timing }

    const openingTime = timing?.openingTime || restaurant?.deliveryTimings?.openingTime || restaurant?.openingTime || null
    const closingTime = timing?.closingTime || restaurant?.deliveryTimings?.closingTime || restaurant?.closingTime || null
    const openingMinutes = parseTimeToMinutes(openingTime)
    const closingMinutes = parseTimeToMinutes(closingTime)
    const hasExplicitWindow = Boolean(openingTime || closingTime)

    // Fallback to openDays if no specific timing for today
    if (!timing && openDays.length > 0) {
      const normalizedOpenDays = new Set(openDays.map(d => normalizeDay(d)).filter(Boolean))
      if (normalizedOpenDays.size > 0 && !normalizedOpenDays.has(dayName)) {
        return { isWithin: false, hasWindow: true, reason: "closed-day" }
      }
    }

    const isWithin = hasExplicitWindow
      ? (openingMinutes !== null && closingMinutes !== null
        ? isWithinTimeWindow(nowMinutes, openingMinutes, closingMinutes)
        : true)
      : true

    return { isWithin, hasWindow: hasExplicitWindow, openingTime, closingTime, openingMinutes, closingMinutes, timing }
  }

  // 1. Check Today's Window
  const today = checkDayWindow(now)

  // 2. Check Yesterday's Window (in case it crossed midnight and is still open)
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = checkDayWindow(yesterdayDate)

  // A restaurant is open if Today is active OR Yesterday's late night window is active
  // Yesterday's window is only relevant if it crosses midnight (closing < opening)
  const yesterdayCrossesMidnight = yesterday.openingMinutes !== null && yesterday.closingMinutes !== null && yesterday.closingMinutes < yesterday.openingMinutes
  const isYesterdayStillOpen = yesterdayCrossesMidnight && nowMinutes <= yesterday.closingMinutes
  
  // Today's window is also active if it's within the window
  const isTodayOpen = today.isWithin

  const isOpenNow = isTodayOpen || isYesterdayStillOpen
  const activeWindow = isTodayOpen ? today : (isYesterdayStillOpen ? yesterday : today)

  const minutesUntilClose = isOpenNow
    ? getMinutesUntilClosing(nowMinutes, activeWindow.openingMinutes, activeWindow.closingMinutes)
    : null

  return {
    isOpen: isOpenNow,
    isActive,
    isAcceptingOrders,
    isWithinTimings: isOpenNow,
    openingTime: activeWindow.openingTime,
    closingTime: activeWindow.closingTime,
    minutesUntilClose,
    closingCountdownLabel: isOpenNow
      ? formatClosingCountdown(minutesUntilClose, activeWindow.closingTime)
      : null,
    reason: isOpenNow
      ? (isAcceptingOrders ? "open" : "open-by-timings")
      : (activeWindow.hasWindow ? "outside-hours" : "no-timings"),
  }
}
