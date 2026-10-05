/**
 * Time-slot surge: an admin marks, per zone, the hours of each weekday when
 * rides cost a percentage more -- for every vehicle or only the chosen ones.
 *
 * Pure functions only, so the booking, the quote and the admin checks all agree
 * and can be checked without a database (see __checks__/surgeSlot.check.js).
 *
 * A slot's times are wall-clock "HH:MM" in SURGE_TIMEZONE. An end at or before
 * the start runs past midnight: Mon 22:00-02:00 covers Mon 22:00 to Tue 02:00.
 */
export const SURGE_TIMEZONE = 'Asia/Kolkata';
export const MAX_SURGE_PERCENT = 300;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const parseTime = (value) => {
  const match = TIME_RE.exec(String(value || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Weekday (0 = Sunday) and minute of the day, at `at`, in the surge timezone. */
export const localClock = (at = new Date(), timeZone = SURGE_TIMEZONE) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
};

/**
 * The stretches of the week a slot covers, as [start, end) minutes from
 * Sunday 00:00. An overnight slot is one stretch crossing midnight (and the
 * Saturday one wraps into Sunday, split in two).
 */
const WEEK = 7 * 1440;
export const slotRanges = (slot) => {
  const start = parseTime(slot.start_time);
  const end = parseTime(slot.end_time);
  if (start === null || end === null) return [];
  const length = end > start ? end - start : end + 1440 - start;
  const ranges = [];
  for (const day of new Set(slot.days || [])) {
    const from = day * 1440 + start;
    const to = from + length;
    if (to <= WEEK) ranges.push([from, to]);
    else ranges.push([from, WEEK], [0, to - WEEK]);
  }
  return ranges;
};

const minuteOfWeek = ({ day, minute }) => day * 1440 + minute;

export const slotCoversVehicle = (slot, vehicleTypeId) => {
  const ids = (slot.vehicle_type_ids || []).map(String);
  return ids.length === 0 || (vehicleTypeId != null && ids.includes(String(vehicleTypeId)));
};

export const slotIsActiveAt = (slot, clock) => {
  if (!slot || slot.active === false) return false;
  const now = minuteOfWeek(clock);
  return slotRanges(slot).some(([from, to]) => now >= from && now < to);
};

/**
 * The slot that applies to this vehicle in this zone right now. Overlaps are
 * refused when saving, but should old data ever hold two, the higher percent
 * wins -- never both.
 */
export const pickSurgeSlot = (slots = [], { zoneId, vehicleTypeId, at = new Date() } = {}) => {
  if (!zoneId) return null;
  const clock = localClock(at);
  let best = null;
  for (const slot of slots) {
    if (!(slot.zone_ids || []).map(String).includes(String(zoneId))) continue;
    if (!slotCoversVehicle(slot, vehicleTypeId)) continue;
    if (!slotIsActiveAt(slot, clock)) continue;
    if (!best || Number(slot.percent) > Number(best.percent)) best = slot;
  }
  return best;
};

/** The surge in rupees for a fare: whole rupees, as the fare itself is. */
export const surgeFromPercent = (fareBeforeSurge, percent) =>
  Math.max(0, Math.round((Math.max(0, Number(fareBeforeSurge) || 0) * Math.max(0, Number(percent) || 0)) / 100));

/** Checks a slot's fields; returns the cleaned slot or throws with a message. */
export const normalizeSurgeSlot = (input = {}) => {
  const fail = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };
  const name = String(input.name || '').trim();
  const zoneIds = [...new Set((input.zone_ids || []).map(String).filter(Boolean))];
  const vehicleIds = input.all_vehicles === true
    ? []
    : [...new Set((input.vehicle_type_ids || []).map(String).filter(Boolean))];
  const days = [...new Set((input.days || []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  const percent = Number(input.percent);

  if (zoneIds.length === 0) fail('Choose at least one zone');
  if (days.length === 0) fail('Choose at least one day');
  if (parseTime(input.start_time) === null) fail('Start time must be HH:MM');
  if (parseTime(input.end_time) === null) fail('End time must be HH:MM');
  if (input.start_time === input.end_time) fail('Start and end time cannot be the same');
  if (!(percent > 0) || percent > MAX_SURGE_PERCENT) fail(`Surge must be between 1 and ${MAX_SURGE_PERCENT}%`);
  if (input.all_vehicles !== true && vehicleIds.length === 0) fail('Choose vehicles, or apply to all vehicles');

  return {
    name,
    zone_ids: zoneIds,
    vehicle_type_ids: vehicleIds,
    days,
    start_time: String(input.start_time).trim(),
    end_time: String(input.end_time).trim(),
    percent: Math.round(percent * 100) / 100,
    active: input.active !== false,
  };
};

const shares = (a = [], b = []) => {
  if (a.length === 0 || b.length === 0) return true; // empty = all
  const set = new Set(a.map(String));
  return b.some((id) => set.has(String(id)));
};

/** An existing active slot that would clash with `slot`: same zone, vehicle and time. */
export const findOverlappingSlot = (slot, others = []) => {
  if (slot.active === false) return null;
  const mine = slotRanges(slot);
  return others.find((other) => {
    if (other.active === false) return false;
    const zonesClash = (slot.zone_ids || []).some((z) => (other.zone_ids || []).map(String).includes(String(z)));
    if (!zonesClash || !shares(slot.vehicle_type_ids, other.vehicle_type_ids)) return false;
    return slotRanges(other).some(([f2, t2]) => mine.some(([f1, t1]) => f1 < t2 && f2 < t1));
  }) || null;
};
