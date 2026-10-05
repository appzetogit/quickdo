const RESTAURANT_TIMEZONE =
  process.env.RESTAURANT_TIMEZONE?.trim() || 'Asia/Kolkata';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const getPartValue = (parts, type) =>
  parts.find((part) => part.type === type)?.value ?? null;

export const getRestaurantTimezone = () => RESTAURANT_TIMEZONE;

export const getRestaurantLocalTimeParts = (
  date = new Date(),
  timeZone = RESTAURANT_TIMEZONE,
) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  let hour = Number(getPartValue(parts, 'hour'));
  if (!Number.isFinite(hour)) hour = 0;
  if (hour === 24) hour = 0;

  const minute = Number(getPartValue(parts, 'minute'));
  const dayName = getPartValue(parts, 'weekday');

  return {
    dayName: DAY_NAMES.includes(dayName) ? dayName : DAY_NAMES[date.getDay()],
    nowMinutes: hour * 60 + (Number.isFinite(minute) ? minute : 0),
  };
};

export const getPreviousDayName = (dayName) => {
  const index = DAY_NAMES.indexOf(dayName);
  if (index < 0) return DAY_NAMES[6];
  return DAY_NAMES[(index + 6) % 7];
};
