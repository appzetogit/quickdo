/**
 * A multi-stop ride's route, for the "Route Stops" timeline in RideTracking
 * (rider) and ActiveTrip (driver) -- SOW plan §4.1.
 *
 * The server sends `stops: [{ address, lat, lng, order, reachedAt }]` on the
 * ride (ride:state, the offer, the active ride). The timeline wants the whole
 * route: pickup, each stop, drop, with what is done and the next ETA.
 * A plain A-to-B ride has no stops and gets no timeline.
 */
const isServerStop = (stop) => stop && typeof stop === 'object' && Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng));

export const getRideStops = (source) => (Array.isArray(source) ? source.filter(isServerStop) : [])
  .slice()
  .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

/**
 * @param {object} ride  anything with stops, pickupAddress/dropAddress, status
 * @param {object} eta   the last `ride:eta:updated` payload, if any
 */
export const buildStopsTimeline = (ride = {}, eta = null) => {
  const stops = getRideStops(ride?.stops);
  if (!stops.length) return [];

  const status = String(ride?.liveStatus || ride?.status || '').toLowerCase();
  const tripStarted = ['started', 'ongoing', 'arrived', 'completed'].includes(status);
  const tripDone = ['arrived', 'completed'].includes(status);

  return [
    {
      id: 'pickup',
      type: 'pickup',
      address: ride?.pickupAddress || ride?.pickup || '',
      status: tripStarted ? 'completed' : undefined,
      etaMinutes: !tripStarted && eta?.target === 'pickup' ? eta.etaMinutes : undefined,
    },
    ...stops.map((stop) => ({
      id: `stop-${stop.order}`,
      type: 'stop',
      order: stop.order,
      label: `Stop ${stop.order}`,
      address: stop.address || `${Number(stop.lat).toFixed(5)}, ${Number(stop.lng).toFixed(5)}`,
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      reachedAt: stop.reachedAt || null,
      status: stop.reachedAt || tripDone ? 'completed' : undefined,
    })),
    {
      id: 'drop',
      type: 'drop',
      address: ride?.dropAddress || ride?.drop || '',
      status: tripDone ? 'completed' : undefined,
      // The server's drop ETA runs through the stops still ahead.
      etaMinutes: tripStarted && !tripDone && eta?.target === 'drop' ? eta.etaMinutes : undefined,
    },
  ];
};

/**
 * Google Maps directions to `destination` through `waypoints` ({lat, lng}),
 * for the driver's navigation handoff.
 */
export const buildGoogleDirectionsUrl = (destination, waypoints = []) => {
  if (!destination || !Number.isFinite(Number(destination.lat)) || !Number.isFinite(Number(destination.lng))) return '';
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'driving',
  });
  const points = (Array.isArray(waypoints) ? waypoints : [])
    .filter((point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)))
    .map((point) => `${point.lat},${point.lng}`);
  if (points.length) params.set('waypoints', points.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};
