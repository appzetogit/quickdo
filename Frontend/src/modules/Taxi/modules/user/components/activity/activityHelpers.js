// No static icons

export const PAGE_SIZE = 4;
export const TABS = ['All', 'Rides', 'Outstation', 'Scheduled', 'Support'];

export const pickFirstString = (...values) => {
  for (const value of values) {
    const normalized = String(value || '').trim();

    if (normalized) {
      return normalized;
    }
  }

  return '';
};

export const buildAvatarFallback = (name = 'Captain') =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=E2E8F0&color=0F172A&bold=true`;

export const isLikelyVehiclePhoto = (value) => {
  const url = String(value || '').trim().toLowerCase();

  if (!url) {
    return false;
  }

  return !url.endsWith('.svg') && !url.includes('/icon') && !url.includes('map_icon');
};

export const getVehicleTypeAsset = (iconType = '') => {
  return null;
};

export const getStatusTone = (status = '') => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed' || normalized === 'confirmed') return 'success';
  if (normalized === 'cancelled' || normalized === 'failed' || normalized === 'expired') return 'danger';
  return 'warning';
};

export const formatRideDate = (value) => {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export const formatRideTime = (value) => {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }

  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export const toTimestamp = (value) => {
  if (!value) {
    return 0;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

export const formatStatus = (status) => {
  const normalized = String(status || 'searching').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const getRideTimeSource = (ride) =>
  ride.completedAt || ride.startedAt || ride.acceptedAt || ride.createdAt || ride.updatedAt;

export const coordLabel = (location, fallback) => {
  const coords = location?.coordinates || [];
  const [lng, lat] = coords;

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }

  return fallback;
};

export const getVehicleVisual = (ride) => {
  return getVehicleTypeAsset(
    ride?.vehicleIconType ||
    ride?.driver?.vehicleIconType ||
    ride?.driver?.vehicleType ||
    ride?.serviceType
  );
};

export const normalizeRide = (ride) => {
  const timeSource = getRideTimeSource(ride);
  const driverName = pickFirstString(
    ride?.driver?.name,
    ride?.driver?.fullName,
    ride?.driverName,
    ride?.driver?.phone ? `Driver ${ride.driver.phone}` : '',
    'Driver assigned',
  );
  const vehicle = ride.driver?.vehicleType || ride.vehicleIconType || 'Ride';
  const status = formatStatus(ride.status || ride.liveStatus);
  const serviceType = String(ride.serviceType || ride.type || 'ride').toLowerCase();
  // Old parcel trips (parcel delivery was removed) are shown as rides.
  const type = 'ride';
  const pickup = ride.pickupAddress || coordLabel(ride.pickupLocation, 'Pickup');
  const drop = ride.dropAddress || coordLabel(ride.dropLocation, 'Drop');
  const isScheduled = Boolean(ride?.scheduledAt);
  const isOutstation = serviceType === 'intercity';
  const title = isScheduled
    ? `Scheduled ride with ${driverName}`
    : isOutstation
      ? `Outstation trip with ${driverName}`
      : (status === 'Searching' ? 'Ride request' : `Ride with ${driverName}`);

  return {
    id: ride.rideId || ride._id || ride.id,
    type,
    title,
    address: `${pickup} to ${drop}`,
    date: formatRideDate(timeSource),
    time: formatRideTime(timeSource),
    status,
    statusTone: getStatusTone(status),
    price: Number(ride.fare || 0).toFixed(0),
    ride,
    vehicle,
    driverName,
    eyebrow: isScheduled
      ? 'Scheduled booking'
      : isOutstation
        ? 'Outstation trip'
        : 'Driver trip',
    driverImage: pickFirstString(
      ride?.driver?.profileImage,
      ride?.driver?.profile_image,
      ride?.driver?.image,
      ride?.driver?.avatar,
      buildAvatarFallback(driverName),
    ),
    vehicleImage: getVehicleVisual(ride),
    sortTimestamp: toTimestamp(timeSource),
  };
};

