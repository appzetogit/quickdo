const CURRENT_RIDE_STORAGE_KEY = 'Quick Drop_current_ride';

export const CURRENT_RIDE_UPDATED_EVENT = 'Quick Drop:current-ride-updated';

const ACTIVE_RIDE_STATUSES = new Set(['accepted', 'arriving', 'started', 'ongoing', 'assigned', 'confirmed', 'end_requested']);
const TERMINAL_RIDE_STATUSES = new Set(['completed', 'cancelled', 'delivered']);

const notifyCurrentRideChange = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(CURRENT_RIDE_UPDATED_EVENT));
};

export const getCurrentRide = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawRide = window.localStorage.getItem(CURRENT_RIDE_STORAGE_KEY);
    return rawRide ? JSON.parse(rawRide) : null;
  } catch {
    return null;
  }
};

export const isActiveCurrentRide = (ride) => {
  if (!ride?.rideId) {
    return false;
  }

  const status = String(ride.status || '').toLowerCase();
  const liveStatus = String(ride.liveStatus || '').toLowerCase();

  if (TERMINAL_RIDE_STATUSES.has(status) || TERMINAL_RIDE_STATUSES.has(liveStatus)) {
    return false;
  }

  return ACTIVE_RIDE_STATUSES.has(liveStatus || status || 'accepted');
};

export const saveCurrentRide = (ride) => {
  if (typeof window === 'undefined' || !ride?.rideId) {
    return;
  }

  const nextRide = {
    ...ride,
    status: ride.status || 'accepted',
    liveStatus: ride.liveStatus || ride.status || 'accepted',
    updatedAt: Date.now(),
  };

  window.localStorage.setItem(CURRENT_RIDE_STORAGE_KEY, JSON.stringify(nextRide));
  notifyCurrentRideChange();
};

export const clearCurrentRide = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(CURRENT_RIDE_STORAGE_KEY);
  notifyCurrentRideChange();
};
