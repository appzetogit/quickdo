/**
 * Who may be offered a job (plan §3.2–3.4).
 *
 *  - vendorSubscriptionGateActive: the vendor subscription gate only applies once
 *    Settings.requireVendorSubscription is on and the grace date has passed.
 *  - bookingSlot / isAvailableAt / filterAvailable: skip providers whose
 *    Availability calendar says they are off at the booked slot.
 *
 * CommonJS like the rest of the module.
 */

const DEFAULT_TZ = 'Asia/Kolkata';

const vendorSubscriptionGateActive = (settings, now = new Date()) => {
  if (!settings?.requireVendorSubscription) return false;
  const grace = settings.vendorSubscriptionGraceUntil ? new Date(settings.vendorSubscriptionGraceUntil) : null;
  return !grace || grace.getTime() <= now.getTime();
};

const subscriptionQuery = (now = new Date()) => ({
  'subscription.isActive': true,
  'subscription.expiryDate': { $gt: now }
});

/** 'HH:mm', 'H:mm AM', '10 AM', '10:00 - 11:00' -> minutes since midnight, or null. */
const parseTimeToMinutes = (value) => {
  if (value === undefined || value === null) return null;
  const m = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
};

const localParts = (date, tz = DEFAULT_TZ) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: days[get('weekday')],
    minutes: Number(get('hour')) * 60 + Number(get('minute'))
  };
};

const weekdayOf = (dateStr) => new Date(`${dateStr}T00:00:00Z`).getUTCDay();

/**
 * The slot a booking is for, as { dateStr, weekday, minutes } in the platform
 * timezone. Instant bookings (or no date) are "now". A 'YYYY-MM-DD' date is taken
 * as that calendar day; a full timestamp is converted to the local day.
 */
const bookingSlot = ({ bookingType, scheduledDate, date, time, timeSlot, scheduledTime } = {}, now = new Date(), tz = DEFAULT_TZ) => {
  const rawDate = date || scheduledDate;
  if (bookingType === 'instant' || !rawDate) return localParts(now, tz);
  let dateStr;
  if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    dateStr = rawDate;
  } else {
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime())) return localParts(now, tz);
    dateStr = localParts(d, tz).dateStr;
  }
  const minutes = parseTimeToMinutes(time ?? timeSlot?.start ?? scheduledTime);
  return { dateStr, weekday: weekdayOf(dateStr), minutes };
};

const inSlots = (slots, minutes) => {
  if (!Array.isArray(slots) || !slots.length) return false;
  if (minutes === null || minutes === undefined) return true; // whole day requested: any slot will do
  return slots.some((s) => {
    const a = parseTimeToMinutes(s.start);
    const b = s.end === '24:00' ? 1440 : parseTimeToMinutes(s.end);
    return a !== null && b !== null && minutes >= a && minutes < b;
  });
};

/** availability: an Availability document (or null = always available). */
const isAvailableAt = (availability, slot) => {
  if (!availability || !slot) return true;
  const override = (availability.overrides || []).find((o) => o.date === slot.dateStr);
  if (override) {
    if (override.type === 'leave') return false;
    return inSlots(override.slots, slot.minutes);
  }
  const weekly = availability.weekly || [];
  if (!weekly.length) return true;
  const day = weekly.find((d) => d.day === slot.weekday);
  if (!day || day.off) return false;
  return inSlots(day.slots, slot.minutes);
};

/** Drop providers that are unavailable at `slot`. One query for the whole list. */
const filterAvailable = async (providers, providerType, slot) => {
  if (!slot || !providers?.length) return providers || [];
  const Availability = require('../models/Availability');
  const docs = await Availability.find({
    providerType,
    providerId: { $in: providers.map((p) => p._id) }
  }).lean();
  const byId = new Map(docs.map((d) => [String(d.providerId), d]));
  return providers.filter((p) => isAvailableAt(byId.get(String(p._id)), slot));
};

module.exports = {
  DEFAULT_TZ,
  vendorSubscriptionGateActive,
  subscriptionQuery,
  parseTimeToMinutes,
  localParts,
  bookingSlot,
  isAvailableAt,
  filterAvailable
};
