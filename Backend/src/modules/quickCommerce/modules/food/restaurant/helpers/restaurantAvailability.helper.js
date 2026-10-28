import {
  getPreviousDayName,
  getRestaurantLocalTimeParts,
} from '../../../../utils/timezone.js';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const normalizeDay = (value) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const match = DAY_NAMES.find((day) => day.toLowerCase() === trimmed);
  if (match) return match;
  const abbreviatedMatch = DAY_NAMES.find((day) =>
    day.toLowerCase().startsWith(trimmed.slice(0, 3)),
  );
  return abbreviatedMatch || null;
};

const parseTimeToMinutes = (timeValue) => {
  if (!timeValue || typeof timeValue !== 'string') return null;
  const raw = timeValue.trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase();
  const meridiemMatch = normalized.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/);
  if (meridiemMatch) {
    let hour = Number(meridiemMatch[1]);
    const minute = Number(meridiemMatch[2]);
    const period = meridiemMatch[3];
    if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) return null;
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) return null;
    return hour * 60 + minute;
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!twentyFourHourMatch) return null;

  const hour = Number(twentyFourHourMatch[1]);
  const minute = Number(twentyFourHourMatch[2]);
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
};

const getTimingForSource = (source, dayName) => {
  if (!source || typeof source !== 'object') return null;

  const outletTimingsArray = source?.timings;
  if (Array.isArray(outletTimingsArray)) {
    const exact = outletTimingsArray.find((entry) => normalizeDay(entry?.day) === dayName);
    if (exact) return exact;
  }

  if (!Array.isArray(source)) {
    const direct = source[dayName];
    if (direct && typeof direct === 'object') return direct;
  }

  return null;
};

const getTodayTiming = (restaurant, dayName) => {
  const fromOutlet = getTimingForSource(restaurant?.outletTimings, dayName);
  if (fromOutlet) return fromOutlet;
  return null;
};

const isWithinTimeWindow = (nowMinutes, openingMinutes, closingMinutes) => {
  if (openingMinutes === null || closingMinutes === null) return true;
  if (openingMinutes === closingMinutes) return true;

  if (closingMinutes > openingMinutes) {
    return nowMinutes >= openingMinutes && nowMinutes <= closingMinutes;
  }

  return nowMinutes >= openingMinutes || nowMinutes <= closingMinutes;
};

const checkDayWindow = (restaurant, dayName, nowMinutes) => {
  const timing = getTodayTiming(restaurant, dayName);
  const openDays = Array.isArray(restaurant?.openDays) ? restaurant.openDays : [];

  if (timing && timing.isOpen === false) {
    return {
      isWithin: false,
      isDayClosed: true,
      hasWindow: true,
      dayName,
      timing,
    };
  }

  const openingTime =
    timing?.openingTime ||
    restaurant?.deliveryTimings?.openingTime ||
    restaurant?.openingTime ||
    null;
  const closingTime =
    timing?.closingTime ||
    restaurant?.deliveryTimings?.closingTime ||
    restaurant?.closingTime ||
    null;
  const openingMinutes = parseTimeToMinutes(openingTime);
  const closingMinutes = parseTimeToMinutes(closingTime);
  const hasExplicitWindow = Boolean(openingTime || closingTime);

  if (!timing && openDays.length > 0) {
    const normalizedOpenDays = new Set(
      openDays.map((d) => normalizeDay(d)).filter(Boolean),
    );
    if (normalizedOpenDays.size > 0 && !normalizedOpenDays.has(dayName)) {
      return {
        isWithin: false,
        isDayClosed: true,
        hasWindow: true,
        dayName,
        reason: 'closed-day',
      };
    }
  }

  const isWithin = hasExplicitWindow
    ? openingMinutes !== null &&
      closingMinutes !== null &&
      isWithinTimeWindow(nowMinutes, openingMinutes, closingMinutes)
    : true;

  return {
    isWithin,
    isDayClosed: false,
    hasWindow: hasExplicitWindow,
    dayName,
    openingTime,
    closingTime,
    openingMinutes,
    closingMinutes,
    timing,
  };
};

export function getOutletScheduleStatus(restaurant, now = new Date()) {
  if (!restaurant) {
    return {
      isOpen: true,
      isDayClosed: false,
      isWithinTimings: true,
      hasConfiguredHours: false,
      reason: 'no-restaurant',
    };
  }

  const { dayName, nowMinutes } = getRestaurantLocalTimeParts(now);
  const today = checkDayWindow(restaurant, dayName, nowMinutes);
  const yesterday = checkDayWindow(
    restaurant,
    getPreviousDayName(dayName),
    nowMinutes,
  );

  const yesterdayCrossesMidnight =
    yesterday.openingMinutes !== null &&
    yesterday.closingMinutes !== null &&
    yesterday.closingMinutes < yesterday.openingMinutes;
  const isYesterdayStillOpen =
    yesterdayCrossesMidnight && nowMinutes <= yesterday.closingMinutes;
  const isTodayOpen = today.isWithin;
  const scheduleOpen = isTodayOpen || isYesterdayStillOpen;
  const activeWindow = isTodayOpen ? today : isYesterdayStillOpen ? yesterday : today;

  return {
    isOpen: scheduleOpen,
    isDayClosed: today.isDayClosed && !isYesterdayStillOpen,
    isWithinTimings: scheduleOpen,
    hasConfiguredHours: Boolean(activeWindow?.hasWindow),
    openingTime: activeWindow?.openingTime || null,
    closingTime: activeWindow?.closingTime || null,
    dayName: activeWindow?.dayName || dayName,
    reason: scheduleOpen
      ? 'within-hours'
      : today.isDayClosed
        ? 'closed-day'
        : activeWindow?.hasWindow
          ? 'outside-hours'
          : 'no-timings',
  };
}

export function getRestaurantOperationalStatus(restaurant, now = new Date()) {
  const schedule = getOutletScheduleStatus(restaurant, now);
  // Manual toggle OFF (isAcceptingOrders=false) always wins over outlet timings.
  // Toggle ON only clears the override — availability then follows outlet timings.
  const isAcceptingOrders = restaurant?.isAcceptingOrders !== false;
  const outsideHoursOverride = false;
  const isEffectivelyOnline = isAcceptingOrders && schedule.isOpen;

  return {
    ...schedule,
    isAcceptingOrders,
    outsideHoursOverride,
    isEffectivelyOnline,
    reason: !isAcceptingOrders
      ? 'not-accepting-orders'
      : schedule.isOpen
        ? 'open'
        : schedule.reason,
  };
}

export function getRestaurantAvailabilityStatus(restaurant, now = new Date(), options = {}) {
  if (!restaurant) {
    return {
      isOpen: false,
      isActive: false,
      isAcceptingOrders: false,
      isWithinTimings: false,
      reason: 'missing-restaurant',
    };
  }

  const ignoreOperationalStatus = options?.ignoreOperationalStatus === true;
  const isActive = restaurant.isActive !== false;
  const isAcceptingOrders = restaurant.isAcceptingOrders !== false;

  if (!ignoreOperationalStatus && !isActive) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: 'inactive',
    };
  }

  if (!ignoreOperationalStatus && !isAcceptingOrders) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: 'not-accepting-orders',
    };
  }

  const { dayName, nowMinutes } = getRestaurantLocalTimeParts(now);
  const today = checkDayWindow(restaurant, dayName, nowMinutes);
  const yesterday = checkDayWindow(
    restaurant,
    getPreviousDayName(dayName),
    nowMinutes,
  );

  const yesterdayCrossesMidnight =
    yesterday.openingMinutes !== null &&
    yesterday.closingMinutes !== null &&
    yesterday.closingMinutes < yesterday.openingMinutes;
  const isYesterdayStillOpen =
    yesterdayCrossesMidnight && nowMinutes <= yesterday.closingMinutes;
  const isTodayOpen = today.isWithin;
  const isOpenNow = isTodayOpen || isYesterdayStillOpen;
  const activeWindow = isTodayOpen ? today : isYesterdayStillOpen ? yesterday : today;

  return {
    isOpen: isOpenNow,
    isActive,
    isAcceptingOrders,
    isWithinTimings: isOpenNow,
    openingTime: activeWindow?.openingTime || null,
    closingTime: activeWindow?.closingTime || null,
    reason: isOpenNow
      ? isAcceptingOrders
        ? 'open'
        : 'open-by-timings'
      : activeWindow?.hasWindow
        ? 'outside-hours'
        : 'no-timings',
  };
}

export function assertRestaurantAcceptingOrders(restaurant, at = new Date()) {
  const availability = getRestaurantAvailabilityStatus(restaurant, at);
  if (availability.isOpen) return availability;

  if (availability.reason === 'not-accepting-orders') {
    throw new Error('RESTAURANT_OFFLINE');
  }

  throw new Error('RESTAURANT_CLOSED');
}

export function shouldAutoTurnOffAcceptingOrders(restaurant, now = new Date()) {
  // Toggle ON must remain sticky so outlet timings can control availability.
  // Never auto-flip isAcceptingOrders off just because the schedule is closed.
  void restaurant;
  void now;
  return false;
}
