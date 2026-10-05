import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, X, Banknote, CreditCard, ChevronDown, Clock3, LoaderCircle, Eye, TicketPercent, CheckCircle2 } from 'lucide-react';
import { GoogleMap, MarkerF, OverlayView, PolylineF } from '@react-google-maps/api';
import api from '../../../../shared/api/axiosInstance';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { userService } from '../../services/userService';
import { userAuthService } from '../../services/authService';
import { useSettings } from '../../../../shared/context/SettingsContext';
import { useAuthStore } from '../../../../../../core/auth/auth.store';
// Static icons removed, depending entirely on admin

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const SELECT_VEHICLE_MAP_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  streetViewControl: false,
  fullscreenControl: false,
  mapTypeControl: false,
  gestureHandling: 'greedy',
};

const toLatLng = (coords, fallback = { lat: 22.7196, lng: 75.8577 }) => {
  const [lng, lat] = coords || [];

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  return fallback;
};

const getZoneServiceLocationId = (zone) =>
  zone?.service_location_id?._id
  || zone?.service_location_id?.id
  || zone?.service_location_id
  || zone?.service_location?._id
  || zone?.service_location?.id
  || zone?.service_location
  || '';

const getDriverPosition = (driver) => toLatLng(driver?.location?.coordinates, null);

const getOverlayCenterOffset = (width = 56, height = 56) => ({
  x: -(width / 2),
  y: -(height / 2),
});

const getMarkerDimensionsForZoom = (zoom) => {
  const normalizedZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 13;

  if (normalizedZoom <= 10) {
    return { shell: 76, pulse: 52, icon: 42 };
  }

  if (normalizedZoom <= 11) {
    return { shell: 70, pulse: 48, icon: 38 };
  }

  if (normalizedZoom <= 12) {
    return { shell: 64, pulse: 44, icon: 35 };
  }

  if (normalizedZoom <= 13) {
    return { shell: 58, pulse: 40, icon: 32 };
  }

  return { shell: 54, pulse: 36, icon: 30 };
};

const normalizeHeading = (value) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return ((numeric % 360) + 360) % 360;
};

const calculateHeadingBetween = (from, to) => {
  if (!from || !to) {
    return 0;
  }

  const angle = Math.atan2(Number(to.lat || 0) - Number(from.lat || 0), Number(to.lng || 0) - Number(from.lng || 0));
  return normalizeHeading((angle * 180) / Math.PI + 90);
};

const AnimatedVehicleMarker = React.memo(({ driver, iconUrl, isMapInteracting = false, mapZoom = 13 }) => {
  const position = getDriverPosition(driver);
  const markerDimensions = useMemo(() => getMarkerDimensionsForZoom(mapZoom), [mapZoom]);

  if (!position) {
    return null;
  }

  return (
    <OverlayView
      position={position}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
      getPixelPositionOffset={() => getOverlayCenterOffset(markerDimensions.shell, markerDimensions.shell)}
    >
      <div
        className="pointer-events-none relative flex items-center justify-center"
        style={{ width: markerDimensions.shell, height: markerDimensions.shell }}
      >
        {!isMapInteracting && (
          <motion.span
            className="absolute rounded-full border border-emerald-500/35 bg-emerald-400/10"
            style={{ width: markerDimensions.pulse, height: markerDimensions.pulse }}
            animate={{ scale: [0.92, 1.2, 0.92], opacity: [0.24, 0.08, 0.24] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
          />
        )}
        <motion.div
          className="relative flex items-center justify-center"
          style={{ width: markerDimensions.icon + 10, height: markerDimensions.icon + 10 }}
          animate={{ rotate: normalizeHeading(driver?.heading) }}
          transition={{ rotate: { duration: 0.8, ease: [0.22, 1, 0.36, 1] } }}
        >
          {iconUrl && (
            <img
              src={iconUrl}
              alt={driver?.name || 'Available driver'}
              draggable={false}
              className="object-contain drop-shadow-[0_6px_8px_rgba(15,23,42,0.34)] will-change-transform"
              style={{ width: markerDimensions.icon, height: markerDimensions.icon }}
            />
          )}
        </motion.div>
      </div>
    </OverlayView>
  );
});

const buildFallbackRoute = (origin, destination) => {
  if (!origin || !destination) {
    return [];
  }

  const latDelta = destination.lat - origin.lat;
  const lngDelta = destination.lng - origin.lng;
  const bendScale = Math.abs(latDelta) > Math.abs(lngDelta) ? 0.28 : -0.28;
  const latBend = latDelta * bendScale;
  const lngBend = lngDelta * bendScale;

  return [
    origin,
    { lat: origin.lat + latDelta * 0.18, lng: origin.lng + lngDelta * 0.08 },
    { lat: origin.lat + latDelta * 0.36 + latBend, lng: origin.lng + lngDelta * 0.34 - lngBend },
    { lat: origin.lat + latDelta * 0.62 - latBend, lng: origin.lng + lngDelta * 0.58 + lngBend },
    { lat: origin.lat + latDelta * 0.84, lng: origin.lng + lngDelta * 0.9 },
    destination,
  ];
};

const VehicleMapPreview = React.memo(({ center, dropPosition, stops = [], drivers, selectedVehicle, isLoaded, loadError }) => {
  const mapRef = useRef(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeError, setRouteError] = useState('');
  const [isMapInteracting, setIsMapInteracting] = useState(false);
  const [mapZoom, setMapZoom] = useState(13);
  const waypointRequests = useMemo(
    () =>
      (Array.isArray(stops) ? stops : [])
        .map((stop) => String(stop || '').trim())
        .filter(Boolean)
        .map((stop) => ({ location: stop, stopover: true })),
    [stops],
  );

  useEffect(() => {
    if (!isLoaded || !dropPosition || !window.google?.maps?.DirectionsService) {
      setRoutePath([]);
      setRouteError('');
      return;
    }

    let active = true;
    const directionsService = new window.google.maps.DirectionsService();

    directionsService.route(
      {
        origin: center,
        destination: dropPosition,
        waypoints: waypointRequests,
        travelMode: window.google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (!active) {
          return;
        }

        if (status === 'OK' && result?.routes?.[0]?.overview_path?.length) {
          setRoutePath(
            result.routes[0].overview_path.map((point) => ({
              lat: point.lat(),
              lng: point.lng(),
            })),
          );
          setRouteError('');
          return;
        }

        setRoutePath(buildFallbackRoute(center, dropPosition));
        setRouteError(status || 'Directions unavailable');
      },
    );

    return () => {
      active = false;
    };
  }, [center, dropPosition, isLoaded, waypointRequests]);

  if (!HAS_VALID_GOOGLE_MAPS_KEY) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-200 px-6 text-center">
        <div className="rounded-[18px] bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[12px] font-bold text-slate-900">Google Maps key missing</p>
          <p className="mt-1 text-[11px] font-bold text-slate-500">Set `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`.</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-200 px-6 text-center">
        <div className="rounded-[18px] bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-[12px] font-bold text-slate-900">Google Maps failed to load</p>
          <p className="mt-1 text-[11px] font-bold text-slate-500">Check the browser key restrictions and reload.</p>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-200">
        <div className="flex items-center gap-2 rounded-[16px] bg-white/90 px-4 py-3 shadow-sm">
          <LoaderCircle size={18} className="animate-spin text-slate-500" />
          <span className="text-[12px] font-bold text-slate-700">Loading map</span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={center}
        zoom={13}
        options={SELECT_VEHICLE_MAP_OPTIONS}
        onLoad={(map) => {
          mapRef.current = map;
          setMapZoom(map.getZoom?.() || 13);
        }}
        onUnmount={() => {
          mapRef.current = null;
        }}
        onDragStart={() => setIsMapInteracting(true)}
        onZoomChanged={() => {
          setIsMapInteracting(true);
          setMapZoom(mapRef.current?.getZoom?.() || 13);
        }}
        onIdle={() => setIsMapInteracting(false)}
      >
        <MarkerF
          position={center}
          title="Pickup"
          icon={{
            path: window.google.maps.SymbolPath.CIRCLE,
            fillColor: '#059669',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            scale: 8,
          }}
        />
        {dropPosition && (
          <MarkerF
            position={dropPosition}
            title="Drop"
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              fillColor: '#fb923c',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
              scale: 7,
            }}
          />
        )}
        {routePath.length > 1 && (
          <PolylineF
            path={routePath}
            options={{
              strokeColor: '#111827',
              strokeOpacity: 0.85,
              strokeWeight: 4,
            }}
          />
        )}
        {drivers.slice(0, 8).map((driver, index) => (
          <AnimatedVehicleMarker
            key={driver.id || driver._id || index}
            driver={driver}
            iconUrl={selectedVehicle?.vehicleIconUrl || selectedVehicle?.icon || '/4_Taxi.png'}
            isMapInteracting={isMapInteracting}
            mapZoom={mapZoom}
          />
        ))}
      </GoogleMap>

      <div className="pointer-events-none absolute bottom-24 left-4 rounded-[12px] border border-white/70 bg-white/90 px-3 py-2 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pickup</p>
        <p className="text-[11px] font-bold text-slate-800">{center.lat.toFixed(4)}, {center.lng.toFixed(4)}</p>
      </div>
      {routeError && (
        <div className="pointer-events-none absolute bottom-10 left-4 rounded-[12px] border border-amber-100 bg-white/90 px-3 py-2 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Route</p>
          <p className="text-[11px] font-bold text-slate-700">Using fallback path while directions load.</p>
        </div>
      )}
    </div>
  );
});

const unwrap = (response) => response?.data?.data || response?.data || response;
const PAYMENT_OPTIONS = [
  { id: 'cash', stateValue: 'Cash', label: 'Cash', sub: 'Pay after ride', Icon: Banknote, bg: 'bg-green-50', color: 'text-green-600' },
  { id: 'online', stateValue: 'Online Payment', label: 'Online Payment', sub: 'UPI, Cards or Wallets', Icon: CreditCard, bg: 'bg-blue-50', color: 'text-blue-600' },
];
const DEFAULT_AVAILABILITY = {
  drivers: [],
  totalDrivers: 0,
  closestDriverDistanceMeters: null,
  closestDriverEtaMinutes: null,
  allowedPaymentMethods: ['cash', 'online'],
};

const normalizeAllowedPaymentMethods = (value) => {
  const items = Array.isArray(value) ? value : [];
  const normalized = items
    .map((item) => String(item || '').trim().toLowerCase())
    .map((item) => (item === 'cash' ? 'cash' : item === 'online' ? 'online' : null))
    .filter(Boolean);

  return [...new Set(normalized)].length ? [...new Set(normalized)] : ['cash', 'online'];
};

const attachDriverMotionMetadata = (drivers = [], previousDrivers = []) => {
  const previousById = new Map(
    (Array.isArray(previousDrivers) ? previousDrivers : []).map((driver) => [String(driver?.id || driver?._id || ''), driver]),
  );

  return (Array.isArray(drivers) ? drivers : []).map((driver, index) => {
    const key = String(driver?.id || driver?._id || index);
    const previousDriver = previousById.get(key);
    const currentPosition = getDriverPosition(driver);
    const previousPosition = getDriverPosition(previousDriver);
    const derivedHeading = calculateHeadingBetween(previousPosition, currentPosition);
    const heading = Number.isFinite(Number(driver?.heading))
      ? normalizeHeading(driver.heading)
      : previousPosition && currentPosition
        ? derivedHeading
        : normalizeHeading(previousDriver?.heading ?? 90 + index * 16);

    return {
      ...driver,
      heading,
    };
  });
};

const toPaymentStateValue = (methodId) => PAYMENT_OPTIONS.find((option) => option.id === methodId)?.stateValue || 'Cash';
const normalizeSelectedPaymentState = (value) => String(value || '').trim().toLowerCase() === 'cash' ? 'cash' : 'online';
const resolveRideTransportType = (...values) => {
  for (const value of values) {
    const normalized = String(value || '').trim().toLowerCase();

    if (!normalized) continue;
    if (normalized === 'both' || normalized === 'all') continue;
    return normalized;
  }

  return 'taxi';
};

const getVehicleTypes = (response) => {
  const data = unwrap(response);
  return data?.vehicle_types || data?.results || (Array.isArray(data) ? data : []);
};

const getTypeLabel = (type) => type?.name || type?.vehicle_type || type?.label || 'Vehicle';

const getIconValue = (type) => String(type?.icon_types || type?.vehicleIconType || type?.name || '').toLowerCase();

const getVehicleMapIcon = (type) => {
  const customIcon = String(type?.map_icon || type?.icon || type?.vehicleIconUrl || '').trim();
  if (customIcon) {
    return customIcon;
  }

  const value = getIconValue(type);

  if (value.includes('bike')) {
    return '/1_Bike.png';
  }

  if (value.includes('auto')) {
    return '/2_AutoRickshaw.png';
  }

  if (value.includes('ehc')) {
    return '/ehcv.png';
  }

  if (value.includes('hcv')) {
    return '/hcv.png';
  }

  if (value.includes('lcv')) {
    return '/LCV.png';
  }

  if (value.includes('mcv')) {
    return '/mcv.png';
  }

  if (value.includes('truck')) {
    return '/truck.png';
  }

  if (value.includes('lux')) {
    return '/Luxury.png';
  }

  if (value.includes('premium')) {
    return '/Premium.png';
  }

  if (value.includes('suv')) {
    return '/SUV.png';
  }

  return '/4_Taxi.png';
};

const getVehiclePreviewImage = (type) => {
  const previewImage = String(type?.image || type?.preview_image || type?.previewImage || '').trim();
  if (previewImage) {
    return previewImage;
  }

  return null;
};

const getCapacity = (type) => {
  const value = getIconValue(type);

  if (value.includes('bike')) {
    return 1;
  }

  if (value.includes('auto')) {
    return 3;
  }

  if (value.includes('suv')) {
    return 6;
  }

  return 4;
};

const AVERAGE_CITY_SPEED_KMPH = 24;

const calculateDistanceMeters = (fromCoords = [], toCoords = []) => {
  const [fromLng, fromLat] = fromCoords;
  const [toLng, toLat] = toCoords;

  if (![fromLng, fromLat, toLng, toLat].every((value) => Number.isFinite(Number(value)))) {
    return 0;
  }

  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusMeters * c);
};

const estimateDurationMinutes = (distanceMeters = 0) => {
  if (!Number.isFinite(Number(distanceMeters)) || Number(distanceMeters) <= 0) {
    return 0;
  }

  const metersPerMinute = (AVERAGE_CITY_SPEED_KMPH * 1000) / 60;
  return Math.max(1, Math.round(Number(distanceMeters) / metersPerMinute));
};

const getFallbackVehicleEstimate = (type) => {
  const value = getIconValue(type);
  const label = getTypeLabel(type).toLowerCase();

  if (value.includes('bike') || label.includes('bike')) {
    return 22;
  }

  if (value.includes('auto') || label.includes('auto')) {
    return 40;
  }

  if (value.includes('premium') || value.includes('lux') || label.includes('premium') || label.includes('lux')) {
    return 130;
  }

  if (value.includes('suv') || label.includes('suv')) {
    return 150;
  }

  return 106;
};

const getSetPriceRows = (response) => {
  const data = unwrap(response);
  return (data?.paginator?.data || data?.results || []).filter((row) => {
    const scope = String(row?.pricing_scope || 'ride').trim().toLowerCase();
    return scope === 'ride';
  });
};

const normalizeId = (value) => String(value?._id || value?.id || value || '').trim();

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getRuleServiceLocationId = (rule) => normalizeId(
  rule?.service_location_id?._id
  || rule?.service_location_id?.id
  || rule?.service_location_id
  || rule?.zone?.service_location?._id
  || rule?.zone?.service_location?.id
  || rule?.zone?.service_location_id
  || '',
);

const sortPricingRules = (rules = []) => (
  [...rules].sort((first, second) => {
    const firstUpdatedAt = new Date(first?.updatedAt || first?.createdAt || 0).getTime();
    const secondUpdatedAt = new Date(second?.updatedAt || second?.createdAt || 0).getTime();
    return secondUpdatedAt - firstUpdatedAt;
  })
);

const isActiveRidePricingRule = (rule, transportType) => {
  const isActive = Number(rule?.active ?? 1) === 1 && String(rule?.status || 'active').toLowerCase() !== 'inactive';
  const scope = String(rule?.pricing_scope || 'ride').trim().toLowerCase();
  
  if (String(transportType).toLowerCase() === 'intercity') {
    return isActive && scope === 'ride' && Boolean(rule?.enable_outstation_ride);
  }
  
  return isActive && scope === 'ride';
};

const matchesTransportType = (rule, transportType) => {
  const normalizedRuleTransport = String(rule?.transport_type || 'taxi').trim().toLowerCase();
  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';

  if (normalizedTransportType === 'intercity' && Boolean(rule?.enable_outstation_ride)) {
    return true;
  }

  return normalizedRuleTransport === normalizedTransportType
    || normalizedRuleTransport === 'both';
};

const isPointInPolygon = (point, polygonCoordinates) => {
  let x, y;
  if (Array.isArray(point)) {
    x = Number(point[0]);
    y = Number(point[1]);
  } else if (point && typeof point === 'object') {
    x = Number(point.lng || point.longitude);
    y = Number(point.lat || point.latitude);
  }
  
  if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = polygonCoordinates.length - 1; i < polygonCoordinates.length; j = i++) {
    const xi = polygonCoordinates[i][0], yi = polygonCoordinates[i][1];
    const xj = polygonCoordinates[j][0], yj = polygonCoordinates[j][1];
    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const findZoneForLocation = (coords, zonesList) => {
  if (!coords || !Array.isArray(zonesList)) return null;
  for (const zone of zonesList) {
    if (zone.active !== false && String(zone.status || 'active').toLowerCase() === 'active') {
      if (zone.geometry?.coordinates) {
        const type = zone.geometry.type;
        const polys = type === 'Polygon' ? [zone.geometry.coordinates] : zone.geometry.coordinates;
        for (const poly of polys) {
          const ring = Array.isArray(poly[0]?.[0]) ? poly[0] : poly;
          if (isPointInPolygon(coords, ring)) {
            return zone;
          }
        }
      } else if (Array.isArray(zone.coordinates) && zone.coordinates.length > 0) {
        const ring = zone.coordinates.map(p => [Number(p.lng), Number(p.lat)]);
        if (isPointInPolygon(coords, ring)) {
          return zone;
        }
      }
    }
  }
  return null;
};

const findBestPricingRule = ({ rules, vehicleTypeId, serviceLocationId, zoneId, transportType }) => {
  const normalizedVehicleTypeId = normalizeId(vehicleTypeId);
  const normalizedServiceLocationId = normalizeId(serviceLocationId);
  const normalizedZoneId = normalizeId(zoneId);
  const normalizedTransportType = String(transportType || 'taxi').trim().toLowerCase() || 'taxi';

  const candidates = sortPricingRules(rules.filter((rule) => {
    const matchesVehicle = normalizeId(rule?.vehicle_type?._id || rule?.vehicle_type || rule?.type_id) === normalizedVehicleTypeId;
    return matchesVehicle && isActiveRidePricingRule(rule, normalizedTransportType) && matchesTransportType(rule, normalizedTransportType);
  }));

  if (!candidates.length) {
    return null;
  }

  const exactTransportMatch = (rule) => String(rule?.transport_type || 'taxi').trim().toLowerCase() === normalizedTransportType;

  // 1. Try to match specific zone first
  if (normalizedZoneId) {
    const exactZone = candidates.find((rule) => (
      rule.zone_id && normalizeId(rule.zone_id) === normalizedZoneId && exactTransportMatch(rule)
    ));
    if (exactZone) return exactZone;

    const zoneAnyTransport = candidates.find((rule) => (
      rule.zone_id && normalizeId(rule.zone_id) === normalizedZoneId
    ));
    if (zoneAnyTransport) return zoneAnyTransport;
  }

  // 2. Fallback to service location (no zone match)
  const exactServiceLocation = candidates.find((rule) => (
    normalizedServiceLocationId
    && getRuleServiceLocationId(rule) === normalizedServiceLocationId
    && !rule.zone_id
    && exactTransportMatch(rule)
  ));

  if (exactServiceLocation) {
    return exactServiceLocation;
  }

  const exactServiceLocationAnyTransport = candidates.find((rule) => (
    normalizedServiceLocationId
    && getRuleServiceLocationId(rule) === normalizedServiceLocationId
    && !rule.zone_id
  ));

  if (exactServiceLocationAnyTransport) {
    return exactServiceLocationAnyTransport;
  }

  const genericTransportMatch = candidates.find((rule) => (
    !getRuleServiceLocationId(rule) && !rule.zone_id && exactTransportMatch(rule)
  ));

  if (genericTransportMatch) {
    return genericTransportMatch;
  }

  const genericBoth = candidates.find((rule) => !getRuleServiceLocationId(rule) && !rule.zone_id);
  return genericBoth || candidates[0];
};

const calculateEstimatedFare = ({ vehicle, pricingRule, distanceMeters, durationMinutes, pickupZone, transportType = 'taxi' }) => {
  const fallbackFare = getFallbackVehicleEstimate(vehicle?.raw || vehicle);

  if (!pricingRule) {
    return fallbackFare;
  }

  const isIntercity = String(transportType).toLowerCase() === 'intercity';
  const distanceKm = Math.max(0, Number(distanceMeters || 0) / 1000);
  const basePrice = isIntercity
    ? toFiniteNumber(pricingRule.outstation_base_price, 0)
    : toFiniteNumber(pricingRule.base_price, 0);
  const baseDistance = isIntercity
    ? Math.max(0, toFiniteNumber(pricingRule.outstation_base_distance, 0))
    : Math.max(0, toFiniteNumber(pricingRule.base_distance, 0));
  const pricePerDistance = isIntercity
    ? toFiniteNumber(pricingRule.outstation_price_per_distance, 0)
    : toFiniteNumber(pricingRule.price_per_distance, 0);
  const timePrice = isIntercity
    ? toFiniteNumber(pricingRule.outstation_time_price, 0)
    : toFiniteNumber(pricingRule.time_price, 0);
  const serviceTax = toFiniteNumber(pricingRule.service_tax, 0);
  // Include the ride surge set by admin — only if the zone actually has it enabled (matching backend)
  const rideSurgeAmount = Boolean(pickupZone?.ride_surge_enabled)
    ? toFiniteNumber(pricingRule.ride_surge_amount, 0)
    : 0;
  const isWithinBaseDistance = baseDistance > 0 && distanceKm <= baseDistance;
  const extraDistanceKm = Math.max(0, distanceKm - baseDistance);
  const subtotal = isWithinBaseDistance
    ? basePrice
    : basePrice + (extraDistanceKm * pricePerDistance) + (Math.max(0, Number(durationMinutes || 0)) * timePrice);

  if (subtotal <= 0) {
    return fallbackFare;
  }

  const total = subtotal + (subtotal * serviceTax) / 100;
  return Math.max(0, Math.round(total)) + rideSurgeAmount;
};

const getDropTime = (minutesAway = 0) => {
  const safeMinutes = Math.max(6, Number(minutesAway) || 0);
  const date = new Date(Date.now() + safeMinutes * 60 * 1000);
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const formatDistanceLabel = (distanceMeters) => {
  if (!Number.isFinite(Number(distanceMeters))) {
    return 'No distance yet';
  }

  const meters = Number(distanceMeters);

  if (meters < 1000) {
    return `${Math.max(50, Math.round(meters / 10) * 10)} m`;
  }

  return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
};

const formatCurrency = (amount) => `₹${Math.round(Number(amount) || 0)}`;

const formatPromoSummary = (promo) => {
  const percent = Math.max(0, Number(promo?.discount_percentage || 0));
  const maxDiscount = Math.max(0, Number(promo?.maximum_discount_amount || 0));
  const minimumTripAmount = Math.max(0, Number(promo?.minimum_trip_amount || 0));

  const parts = [];
  if (percent > 0) {
    parts.push(`${percent}% off`);
  }
  if (maxDiscount > 0) {
    parts.push(`up to ${formatCurrency(maxDiscount)}`);
  }
  if (minimumTripAmount > 0) {
    parts.push(`min ${formatCurrency(minimumTripAmount)}`);
  }

  return parts.join(' • ') || 'Promo available';
};

const toConfiguredPositiveInteger = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
};

const clampPercentage = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, numeric));
};

const alignBidAmountToStep = ({ baseFare, amount, stepAmount, direction = 'up' }) => {
  const safeBaseFare = Math.max(0, Math.round(Number(baseFare || 0)));
  const safeStepAmount = toConfiguredPositiveInteger(stepAmount, 10);
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const delta = safeAmount - safeBaseFare;

  if (delta === 0) {
    return safeBaseFare;
  }

  const absoluteDelta = Math.abs(delta);
  const rawSteps = absoluteDelta / safeStepAmount;
  const normalizedSteps = direction === 'down' ? Math.floor(rawSteps) : Math.ceil(rawSteps);
  return Math.max(0, safeBaseFare + (Math.sign(delta) * normalizedSteps * safeStepAmount));
};

const getBidFareBounds = (vehicle, stepCount) => {
  const baseFare = Math.max(0, Math.round(Number(vehicle?.price) || 0));
  const maxSteps = Math.max(0, Number(vehicle?.maxBidSteps) || 0);
  const safeStepCount = Math.min(
    maxSteps,
    Math.max(0, Number.isFinite(Number(stepCount)) ? Number(stepCount) : maxSteps),
  );
  const stepAmount = Math.max(0, Math.round(Number(vehicle?.bidStepAmount) || 0));

  return {
    min: baseFare,
    max: baseFare + (safeStepCount * stepAmount),
  };
};

const formatVehicleFare = (vehicle, stepCount) => {
  if (!vehicle?.supportsBidding) {
    return formatCurrency(vehicle?.price);
  }

  const { min, max } = getBidFareBounds(vehicle, stepCount);
  return `${formatCurrency(min)}-${formatCurrency(max)}`;
};

const pad = (value) => String(value).padStart(2, '0');

const formatDateTimeInputValue = (date) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getMinScheduledDateTime = () => {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  return formatDateTimeInputValue(next);
};

const getMaxScheduledDateTime = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return formatDateTimeInputValue(nextWeek);
};

const formatScheduledDisplay = (value) => {
  if (!value) {
    return 'Pick date & time';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Pick date & time';
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatAvailabilityLine = (availability) => {
  if (!availability?.totalDrivers) {
    return 'Not available right now';
  }

  const etaMinutes = availability.closestDriverEtaMinutes || 1;
  const dropTime = getDropTime(etaMinutes + 10);
  return `Closest driver ${formatDistanceLabel(availability.closestDriverDistanceMeters)} away - ${etaMinutes} mins away - Drop ${dropTime}`;
};

const formatDispatchLabel = (vehicle) => {
  const dispatchType = String(vehicle?.dispatchType || '').toLowerCase();
  if (dispatchType === 'bidding') {
    return 'Bid booking';
  }
  if (dispatchType === 'both') {
    return 'Bid or instant booking';
  }

  return 'Instant booking';
};

const getAvailabilityBadge = (availability) => {
  if (!availability?.totalDrivers) {
    return 'NOT AVAILABLE';
  }

  if ((availability.closestDriverEtaMinutes || Number.POSITIVE_INFINITY) <= 2) {
    return 'FASTEST';
  }

  if (availability.totalDrivers >= 5) {
    return 'POPULAR';
  }

  return null;
};

const normalizeVehicleType = (type, index) => {
  const id = String(type?.ui_id || type?._id || type?.id || type?.name || index);
  const dispatchType = String(type?.dispatch_type || 'normal').trim().toLowerCase();

  return {
    id,
    vehicleTypeId: type?.original_id || type?._id || type?.id || '',
    transportType: String(type?.transport_type || 'taxi').trim().toLowerCase() || 'taxi',
    iconType: type?.icon_types || 'car',
    icon: getVehiclePreviewImage(type),
    vehicleIconUrl: getVehicleMapIcon(type),
    name: getTypeLabel(type),
    capacity: getCapacity(type),
    badge: null,
    badgeColor: 'bg-primary-orange/5 text-primary-orange/50 border-primary-orange/10',
    sublabel: dispatchType === 'bidding' ? 'Bid booking' : 'Instant booking',
    price: getFallbackVehicleEstimate(type),
    dispatchType,
    supportsBidding: dispatchType === 'bidding' || dispatchType === 'both',
    bidStepAmount: 10,
    maxBidSteps: 5,
    raw: type,
  };
};

const ScrollIndicator = ({ show }) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        className="pointer-events-none absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center"
      >
        <div className="flex h-6 w-6 animate-bounce items-center justify-center rounded-full border border-slate-100 bg-white/95 text-slate-400 shadow-[0_4px_12px_rgba(15,23,42,0.12)] backdrop-blur-sm">
          <ChevronDown size={14} strokeWidth={3} />
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

const SelectVehicle = () => {
  const location = useLocation();
  const routeState = location.state || {};
  const { user, token, role, setAuth } = useAuthStore();
  const pendingCancellationDue = Number(user?.pending_cancellation_due || 0);

  useEffect(() => {
    let active = true;
    const fetchUser = async () => {
      try {
        const response = await userAuthService.getCurrentUser();
        if (active && response?.data?.user) {
          setAuth(response.data.user, token, role);
        }
      } catch (error) {
        console.error('Failed to fetch current user:', error);
      }
    };
    fetchUser();
    return () => {
      active = false;
    };
  }, [setAuth, token, role]);
  const [vehicles, setVehicles] = useState([]);
  const [availabilityByVehicleId, setAvailabilityByVehicleId] = useState({});
  const [selected, setSelected] = useState('');
  const [activeTab, setActiveTab] = useState(() => routeState.rideType === 'bid' ? 'bidding' : 'normal');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [showBidModal, setShowBidModal] = useState(false);
  const [previewVehicleId, setPreviewVehicleId] = useState('');
  const [availablePromos, setAvailablePromos] = useState([]);
  const [isLoadingPromos, setIsLoadingPromos] = useState(false);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoFeedback, setPromoFeedback] = useState('');
  const [promoError, setPromoError] = useState('');
  const [applyingPromoCode, setApplyingPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [rideMode, setRideMode] = useState(() => (location.state?.rideMode === 'schedule' ? 'schedule' : 'now'));
  const [scheduledAt, setScheduledAt] = useState(() => (
    location.state?.scheduledAt ? String(location.state.scheduledAt).slice(0, 16) : getMinScheduledDateTime()
  ));
  const [scheduleError, setScheduleError] = useState('');
  const [bidStepCount, setBidStepCount] = useState(2);
  const [isLoadingVehicles, setIsLoadingVehicles] = useState(true);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);
  const [vehicleLoadError, setVehicleLoadError] = useState('');
  const [driverLoadError, setDriverLoadError] = useState('');
  const [pricingRules, setPricingRules] = useState([]);
  const [isLoadingPricingRules, setIsLoadingPricingRules] = useState(true);
  const [zones, setZones] = useState([]);
  const [isLoadingZones, setIsLoadingZones] = useState(true);
  const [tripMetrics, setTripMetrics] = useState(() => {
    if (
      Number.isFinite(Number(routeState?.estimatedDistanceMeters))
      && Number.isFinite(Number(routeState?.estimatedDurationMinutes))
    ) {
      return {
        distanceMeters: Number(routeState.estimatedDistanceMeters),
        durationMinutes: Number(routeState.estimatedDurationMinutes),
      };
    }

    return { distanceMeters: 0, durationMinutes: 0 };
  });
  const [isResolvingTripMetrics, setIsResolvingTripMetrics] = useState(true);
  const [showScrollArrow, setShowScrollArrow] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const scrollRef = React.useRef(null);
  const availabilityHistoryRef = useRef({});
  const scheduledAtInputRef = useRef(null);
  const navigate = useNavigate();
  const { settings } = useSettings();
  const pickup = routeState.pickup || 'Pipaliyahana, Indore';
  const drop = routeState.drop || 'Vijay Nagar, Indore';
  const pickupCoords = useMemo(() => routeState.pickupCoords || [75.9048, 22.7039], [routeState.pickupCoords]);
  const dropCoords = useMemo(() => routeState.dropCoords || [75.8937, 22.7533], [routeState.dropCoords]);
  const stops = useMemo(
    () => (Array.isArray(routeState.stops) ? routeState.stops : []),
    [routeState.stops],
  );
  
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const pickupPosition = useMemo(() => toLatLng(pickupCoords), [pickupCoords]);
  const dropPosition = useMemo(() => toLatLng(dropCoords, null), [dropCoords]);
  const { isLoaded: isMapLoaded, loadError: mapLoadError } = useAppGoogleMapsLoader();
  const minScheduledAt = useMemo(() => getMinScheduledDateTime(), []);
  const maxScheduledAt = useMemo(() => getMaxScheduledDateTime(), []);

  const matchedZone = useMemo(() => findZoneForLocation(pickupCoords, zones), [pickupCoords, zones]);
  const matchedZoneId = matchedZone?._id || matchedZone?.id || null;

  const effectiveServiceLocationId = useMemo(() => {
    return routeState.service_location_id || routeState.serviceLocationId || getZoneServiceLocationId(matchedZone) || null;
  }, [routeState.service_location_id, routeState.serviceLocationId, matchedZone]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const hasMore = scrollTop + clientHeight < scrollHeight - 8;
    setShowScrollArrow(hasMore);
  };

  useEffect(() => {
    if (!scheduledAt) {
      return;
    }

    if (scheduledAt < minScheduledAt) {
      setScheduledAt(minScheduledAt);
      return;
    }

    if (scheduledAt > maxScheduledAt) {
      setScheduledAt(maxScheduledAt);
    }
  }, [maxScheduledAt, minScheduledAt, scheduledAt]);

  useEffect(() => {
    let active = true;

    const loadVehicleTypes = async () => {
      setIsLoadingVehicles(true);
      setVehicleLoadError('');

      try {
        const response = await api.get('/users/vehicle-types');

        if (!active) {
          return;
        }

        const nextVehicles = getVehicleTypes(response)
          .filter((type) => {
            const isActive = type.active !== false && Number(type.status ?? 1) !== 0;
            const typeTransport = String(type.transport_type || 'taxi').toLowerCase();
            const requestedTransport = resolveRideTransportType(routeState.transportType, routeState.transport_type);
            const isMatch = typeTransport === requestedTransport || typeTransport === 'both' || 
                           (requestedTransport === 'intercity' && typeTransport === 'outstation') || 
                           (requestedTransport === 'outstation' && typeTransport === 'intercity');
            return isActive && isMatch;
          })
          .flatMap((type) => {
            const dispatchType = String(type?.dispatch_type || 'normal').trim().toLowerCase();
            if (dispatchType === 'both') {
              return [
                normalizeVehicleType({ ...type, dispatch_type: 'normal', original_id: type._id, ui_id: `${type._id}_normal` }),
                normalizeVehicleType({ ...type, dispatch_type: 'bidding', original_id: type._id, ui_id: `${type._id}_bidding` })
              ];
            }
            return [normalizeVehicleType(type)];
          });

        setVehicles(nextVehicles);
        setSelected((current) => current || nextVehicles[0]?.id || '');
      } catch (error) {
        if (active) {
          setVehicleLoadError(error.message || 'Could not load vehicle types.');
        }
      } finally {
        if (active) {
          setIsLoadingVehicles(false);
        }
      }
    };

    loadVehicleTypes();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadPricingRules = async () => {
      setIsLoadingPricingRules(true);

      try {
        const response = await api.get('/admin/types/set-prices', {
          params: { scope: 'ride' },
        });

        if (!active) {
          return;
        }

        setPricingRules(getSetPriceRows(response));
      } catch {
        if (active) {
          setPricingRules([]);
        }
      } finally {
        if (active) {
          setIsLoadingPricingRules(false);
        }
      }
    };

    const loadZones = async () => {
      setIsLoadingZones(true);
      try {
        const response = await api.get('/admin/zones');
        if (!active) {
          return;
        }
        const payload = response?.data;
        if (Array.isArray(payload?.results)) {
          setZones(payload.results);
        } else if (Array.isArray(payload?.data)) {
          setZones(payload.data);
        } else if (Array.isArray(payload)) {
          setZones(payload);
        } else {
          setZones([]);
        }
      } catch {
        if (active) {
          setZones([]);
        }
      } finally {
        if (active) {
          setIsLoadingZones(false);
        }
      }
    };

    loadPricingRules();
    loadZones();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const fallbackDistanceMeters = calculateDistanceMeters(pickupCoords, dropCoords);
    const fallbackDurationMinutes = estimateDurationMinutes(fallbackDistanceMeters);

    if (!dropPosition) {
      setIsResolvingTripMetrics(false);
      setTripMetrics({
        distanceMeters: fallbackDistanceMeters,
        durationMinutes: fallbackDurationMinutes,
      });
      return;
    }

    if (mapLoadError || !HAS_VALID_GOOGLE_MAPS_KEY) {
      setIsResolvingTripMetrics(false);
      setTripMetrics({
        distanceMeters: fallbackDistanceMeters,
        durationMinutes: fallbackDurationMinutes,
      });
      return;
    }

    if (!isMapLoaded || !window.google?.maps?.DirectionsService) {
      setIsResolvingTripMetrics(true);
      return;
    }

    let active = true;
    setIsResolvingTripMetrics(true);
    const directionsService = new window.google.maps.DirectionsService();

    directionsService.route(
      {
        origin: pickupPosition,
        destination: dropPosition,
        waypoints: stops
          .map((stop) => String(stop || '').trim())
          .filter(Boolean)
          .map((stop) => ({ location: stop, stopover: true })),
        travelMode: window.google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false,
      },
      (result, status) => {
        if (!active) {
          return;
        }

        const leg = result?.routes?.[0]?.legs?.[0];
        const distanceMeters = toFiniteNumber(leg?.distance?.value, fallbackDistanceMeters);
        const durationMinutes = Math.max(
          1,
          Math.round(toFiniteNumber(leg?.duration?.value, fallbackDurationMinutes * 60) / 60),
        );

        if (status === 'OK' && leg) {
          setIsResolvingTripMetrics(false);
          setTripMetrics({ distanceMeters, durationMinutes });
          return;
        }

        setIsResolvingTripMetrics(false);
        setTripMetrics({
          distanceMeters: fallbackDistanceMeters,
          durationMinutes: fallbackDurationMinutes,
        });
      },
    );

    return () => {
      active = false;
    };
  }, [dropCoords, dropPosition, isMapLoaded, mapLoadError, pickupCoords, pickupPosition, stops]);



  /*
   * What the server will actually charge, per vehicle.
   *
   * This screen priced every vehicle in the browser (calculateEstimatedFare),
   * and the booking is charged by the server (rideService.createRideRecord),
   * which ignores the fare the app sends. The two disagreed: the browser left
   * out the platform fee, timed the trip from Google's traffic estimate where
   * the server uses 25 km/h, and read surge from the price row where the server
   * uses the zone's time slots. So the customer was shown one price and charged
   * another.
   *
   * POST /rides/quote runs the very calculation the booking runs, on the trip
   * the server measures itself. Its figure is what we show; the browser's
   * estimate is only a placeholder until it arrives, or a fallback if the quote
   * cannot be fetched, so the screen is never blank.
   */
  const [serverQuotes, setServerQuotes] = useState({});
  const [isLoadingServerQuotes, setIsLoadingServerQuotes] = useState(false);
  const vehicleQuoteKey = useMemo(
    () => vehicles.map((v) => `${v.vehicleTypeId || ''}:${v.transportType || ''}`).join(','),
    [vehicles],
  );

  useEffect(() => {
    if (!vehicles.length || !Array.isArray(pickupCoords) || !Array.isArray(dropCoords)) {
      setServerQuotes({});
      return undefined;
    }

    // A quote is priced for one transport type, so one request per type.
    const groups = new Map();
    for (const vehicle of vehicles) {
      if (!vehicle?.vehicleTypeId) continue;
      const transportType = resolveRideTransportType(routeState.transport_type, routeState.transportType, vehicle?.transportType);
      if (!groups.has(transportType)) groups.set(transportType, []);
      groups.get(transportType).push(String(vehicle.vehicleTypeId));
    }
    if (!groups.size) {
      setServerQuotes({});
      return undefined;
    }

    let active = true;
    setIsLoadingServerQuotes(true);
    // A short pause so moving a pin or adding a stop asks once, not per frame.
    const timer = setTimeout(async () => {
      try {
        const results = await Promise.all(
          [...groups].map(([transport_type, vehicleTypeIds]) =>
            api
              .post('/rides/quote', {
                pickup: pickupCoords,
                drop: dropCoords,
                stops,
                vehicleTypeIds,
                transport_type,
                service_location_id: effectiveServiceLocationId || undefined,
              })
              .then((res) => res?.data?.quotes ?? res?.quotes ?? [])
              .catch(() => [])),
        );
        if (!active) return;
        const next = {};
        for (const quote of results.flat()) {
          const total = Number(quote?.fare?.total);
          if (quote?.available && Number.isFinite(total)) next[String(quote.vehicleTypeId)] = total;
        }
        setServerQuotes(next);
      } finally {
        if (active) setIsLoadingServerQuotes(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
    // vehicleQuoteKey stands in for `vehicles`, whose identity changes on every
    // refresh even when the list does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleQuoteKey, pickupCoords, dropCoords, stops, effectiveServiceLocationId, routeState.transport_type, routeState.transportType]);

  const pricedVehicles = useMemo(
    () =>
      vehicles.map((vehicle) => {
        const resolvedVehicleTransportType = resolveRideTransportType(routeState.transport_type, routeState.transportType, vehicle?.transportType);
        const pricingRule = findBestPricingRule({
          rules: pricingRules,
          vehicleTypeId: vehicle.vehicleTypeId,
          serviceLocationId: effectiveServiceLocationId,
          zoneId: matchedZoneId,
          transportType: resolvedVehicleTransportType,
        });

        const serverTotal = serverQuotes[String(vehicle.vehicleTypeId)];
        const hasServerQuote = Number.isFinite(serverTotal);

        return {
          ...vehicle,
          pricingRule,
          // The server's figure when we have it -- that is what is charged. A
          // cancellation fee owed from an earlier ride is added at completion, so
          // it is added here too, as it always was.
          price: (hasServerQuote
            ? serverTotal
            : calculateEstimatedFare({
              vehicle,
              pricingRule,
              distanceMeters: tripMetrics.distanceMeters,
              durationMinutes: tripMetrics.durationMinutes,
              pickupZone: matchedZone,
              transportType: resolvedVehicleTransportType,
            })) + pendingCancellationDue,
          priceIsServerQuote: hasServerQuote,
        };
      }),
    [pricingRules, effectiveServiceLocationId, matchedZoneId, tripMetrics.distanceMeters, tripMetrics.durationMinutes, vehicles, pendingCancellationDue, serverQuotes],
  );

  // Held until the server's price arrives, so the customer is not shown the
  // browser's estimate and then watch it change.
  const isFarePending = isResolvingTripMetrics || isLoadingPricingRules || isLoadingServerQuotes;

  const hasAvailabilityResults = Object.keys(availabilityByVehicleId).length > 0;

  const displayedVehicles = useMemo(() => {
    if (!hasAvailabilityResults) {
      return pricedVehicles;
    }

    const rankedVehicles = pricedVehicles
      .map((vehicle, index) => ({
        vehicle,
        index,
        availability: availabilityByVehicleId[vehicle.id] || DEFAULT_AVAILABILITY,
      }))
      .sort((a, b) => {
        const aAvailable = a.availability.totalDrivers > 0;
        const bAvailable = b.availability.totalDrivers > 0;

        if (aAvailable !== bAvailable) {
          return aAvailable ? -1 : 1;
        }

        if (aAvailable && bAvailable) {
          const driverDelta = (b.availability.totalDrivers || 0) - (a.availability.totalDrivers || 0);
          if (driverDelta !== 0) return driverDelta;

          const etaDelta = (a.availability.closestDriverEtaMinutes || Number.POSITIVE_INFINITY)
            - (b.availability.closestDriverEtaMinutes || Number.POSITIVE_INFINITY);
          if (etaDelta !== 0) return etaDelta;
        }

        return a.index - b.index;
      })
      .map(({ vehicle, availability }) => ({
        vehicle,
        availability,
      }));

    if (rideMode !== 'schedule') {
      return rankedVehicles
        .filter(({ availability }) => (availability.totalDrivers || 0) > 0)
        .map(({ vehicle }) => vehicle);
    }

    return rankedVehicles.map(({ vehicle }) => vehicle);
  }, [availabilityByVehicleId, hasAvailabilityResults, pricedVehicles, rideMode]);

  const selectedVehicle = useMemo(() => pricedVehicles.find((v) => v.id === selected), [pricedVehicles, selected]);
  const previewVehicle = useMemo(
    () => pricedVehicles.find((vehicle) => vehicle.id === previewVehicleId) || null,
    [previewVehicleId, pricedVehicles],
  );
  const resolvedTransportType = useMemo(
    () => resolveRideTransportType(
      routeState.transport_type,
      routeState.transportType,
      selectedVehicle?.transportType,
    ),
    [routeState.transportType, routeState.transport_type, selectedVehicle?.transportType],
  );
  const appliedPromoDiscount = Math.max(0, Number(appliedPromo?.breakdown?.discount_amount || 0));
  const discountedSelectedFare = Math.max(
    0,
    Number(appliedPromo?.breakdown?.fare_after_discount ?? selectedVehicle?.price ?? 0),
  );
  const selectedAvailability = selectedVehicle ? (availabilityByVehicleId[selectedVehicle.id] || DEFAULT_AVAILABILITY) : DEFAULT_AVAILABILITY;
  const previewAvailability = previewVehicle ? (availabilityByVehicleId[previewVehicle.id] || DEFAULT_AVAILABILITY) : DEFAULT_AVAILABILITY;
  const canProceed = Boolean(selectedVehicle) && !isFarePending && (rideMode === 'schedule' || Boolean(selectedAvailability.totalDrivers));
  const hasBookableVehicles = useMemo(
    () => displayedVehicles.some((vehicle) => (availabilityByVehicleId[vehicle.id]?.totalDrivers || 0) > 0),
    [availabilityByVehicleId, displayedVehicles],
  );
  const shouldUseDriverBidding = Boolean(
    routeState.intercity ||
    routeState.serviceType === 'intercity' ||
    routeState.transport_type === 'intercity' ||
    routeState.transportType === 'intercity',
  );
  const bidRideSettings = settings?.bidRide || {};
  const selectedBidStepAmount = shouldUseDriverBidding
    ? toConfiguredPositiveInteger(
      bidRideSettings.bidding_amount_increase_or_decrease,
      Number(selectedVehicle?.bidStepAmount || 10),
    )
    : Number(selectedVehicle?.bidStepAmount || 10);
  const bidLowPercentage = clampPercentage(bidRideSettings.user_bidding_low_percentage, 10);
  const bidHighPercentage = clampPercentage(bidRideSettings.user_bidding_high_percentage, 20);
  const normalizedBidLowPercentage = Math.min(bidLowPercentage, bidHighPercentage);
  const normalizedBidHighPercentage = Math.max(bidLowPercentage, bidHighPercentage);
  const selectedBidFloorFare = shouldUseDriverBidding
    ? alignBidAmountToStep({
      baseFare: Number(selectedVehicle?.price || 0),
      amount: Number(selectedVehicle?.price || 0) * (1 + (normalizedBidLowPercentage / 100)),
      stepAmount: selectedBidStepAmount,
      direction: 'up',
    })
    : Number(selectedVehicle?.price || 0);
  const selectedBidCeilingMaxFare = shouldUseDriverBidding
    ? alignBidAmountToStep({
      baseFare: Number(selectedVehicle?.price || 0),
      amount: Number(selectedVehicle?.price || 0) * (1 + (normalizedBidHighPercentage / 100)),
      stepAmount: selectedBidStepAmount,
      direction: 'up',
    })
    : Number(selectedVehicle?.price || 0);
  const selectedBidSteps = shouldUseDriverBidding
    ? Math.max(0, Math.round((selectedBidCeilingMaxFare - selectedBidFloorFare) / selectedBidStepAmount))
    : Number(selectedVehicle?.maxBidSteps || 5);
  const selectedBidIncrement = (selectedVehicle?.supportsBidding ? bidStepCount : 0) * selectedBidStepAmount;
  const selectedBidCeiling = shouldUseDriverBidding
    ? selectedBidFloorFare + selectedBidIncrement
    : Number(selectedVehicle?.price || 0) + selectedBidIncrement;
  const allowedPaymentMethods = useMemo(
    () => normalizeAllowedPaymentMethods(selectedAvailability?.allowedPaymentMethods),
    [selectedAvailability?.allowedPaymentMethods],
  );
  const paymentOptions = useMemo(
    () => PAYMENT_OPTIONS.filter((option) => allowedPaymentMethods.includes(option.id)),
    [allowedPaymentMethods],
  );
  const onlineDrivers = selectedAvailability.drivers || [];

  useEffect(() => {
    if (!paymentOptions.length) {
      return;
    }

    const normalizedCurrent = normalizeSelectedPaymentState(paymentMethod);
    if (!paymentOptions.some((option) => option.id === normalizedCurrent)) {
      setPaymentMethod(paymentOptions[0].stateValue);
    }
  }, [paymentMethod, paymentOptions]);

  const clearAppliedPromo = (nextFeedback = '') => {
    setAppliedPromo(null);
    setApplyingPromoCode('');
    setPromoError('');
    setPromoFeedback(nextFeedback);
  };

  const applyPromoCode = async (rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();

    if (!effectiveServiceLocationId) {
      setPromoError('Pickup zone is missing for this ride.');
      setPromoFeedback('');
      return false;
    }

    if (!selectedVehicle) {
      setPromoError('Select a vehicle before applying a coupon.');
      setPromoFeedback('');
      return false;
    }

    if (!code) {
      setPromoError('Enter a coupon code.');
      setPromoFeedback('');
      return false;
    }

    setApplyingPromoCode(code);
    setPromoError('');
    setPromoFeedback('');

    try {
      const response = await userService.validatePromo({
        code,
        fare: Number(selectedVehicle.price || 0),
        service_location_id: effectiveServiceLocationId,
        transport_type: resolvedTransportType,
      });
      const payload = unwrap(response);

      if (!payload?.eligible) {
        setAppliedPromo(null);
        setPromoError(payload?.message || 'This coupon is not valid for this ride.');
        return false;
      }

      setAppliedPromo(payload);
      setPromoCodeInput(code);
      setPromoFeedback(`${code} applied. You save ${formatCurrency(payload?.breakdown?.discount_amount || 0)}.`);
      return true;
    } catch (error) {
      setAppliedPromo(null);
      setPromoError(error?.response?.data?.message || error?.message || 'Could not apply this coupon right now.');
      return false;
    } finally {
      setApplyingPromoCode('');
    }
  };

  useEffect(() => {
    let active = true;

    const loadPromos = async () => {
      if (!effectiveServiceLocationId) {
        if (active) {
          setAvailablePromos([]);
          clearAppliedPromo('');
        }
        return;
      }

      setIsLoadingPromos(true);

      try {
        const response = await userService.getAvailablePromos({
          service_location_id: effectiveServiceLocationId,
          transport_type: resolvedTransportType,
          limit: 20,
        });

        if (!active) {
          return;
        }

        const promos = Array.isArray(unwrap(response)) ? unwrap(response) : [];
        setAvailablePromos(promos);

        if (appliedPromo?.promo?.code) {
          const stillAvailable = promos.some((promo) => String(promo?.code || '').toUpperCase() === String(appliedPromo.promo.code || '').toUpperCase());
          if (!stillAvailable) {
            clearAppliedPromo('Coupon removed because it does not apply in this zone.');
          }
        }
      } catch (_error) {
        if (active) {
          setAvailablePromos([]);
        }
      } finally {
        if (active) {
          setIsLoadingPromos(false);
        }
      }
    };

    loadPromos();

    return () => {
      active = false;
    };
  }, [resolvedTransportType, effectiveServiceLocationId]);

  useEffect(() => {
    if (!appliedPromo?.promo?.code || !selectedVehicle) {
      return;
    }

    let active = true;

    const refreshAppliedPromo = async () => {
      try {
        const response = await userService.validatePromo({
          code: appliedPromo.promo.code,
          fare: Number(selectedVehicle.price || 0),
          service_location_id: effectiveServiceLocationId,
          transport_type: resolvedTransportType,
        });
        const payload = unwrap(response);

        if (!active) {
          return;
        }

        if (!payload?.eligible) {
          clearAppliedPromo(payload?.message || 'Coupon removed because it is no longer valid for this fare.');
          return;
        }

        setAppliedPromo(payload);
      } catch (error) {
        if (active) {
          clearAppliedPromo(error?.response?.data?.message || 'Coupon removed because validation failed.');
        }
      }
    };

    refreshAppliedPromo();

    return () => {
      active = false;
    };
  }, [appliedPromo?.promo?.code, resolvedTransportType, selectedVehicle?.price, effectiveServiceLocationId]);

  useEffect(() => {
    const timer = setTimeout(handleScroll, 200);
    return () => clearTimeout(timer);
  }, [displayedVehicles, tripMetrics]);

  useEffect(() => {
    setBidStepCount(0);
  }, [selected]);

  useEffect(() => {
    if (!hasAvailabilityResults || !displayedVehicles.length) {
      return;
    }

    const currentAvailability = selected ? (availabilityByVehicleId[selected] || DEFAULT_AVAILABILITY) : DEFAULT_AVAILABILITY;
    const firstAvailable = displayedVehicles.find((vehicle) => (availabilityByVehicleId[vehicle.id]?.totalDrivers || 0) > 0);

    if (firstAvailable && (!selected || currentAvailability.totalDrivers <= 0)) {
      setSelected(firstAvailable.id);
      return;
    }

    if (!firstAvailable && rideMode !== 'schedule' && selected && currentAvailability.totalDrivers <= 0) {
      setSelected('');
    }
  }, [availabilityByVehicleId, displayedVehicles, hasAvailabilityResults, rideMode, selected]);

  useEffect(() => {
    let active = true;
    let intervalId;

    const fetchVehicleAvailabilities = async (vehicleSubset, { replace = false, silent = false } = {}) => {
      const fetchableVehicles = (Array.isArray(vehicleSubset) ? vehicleSubset : []).filter((vehicle) => vehicle?.vehicleTypeId);

      if (!fetchableVehicles.length) {
        if (replace) {
          availabilityHistoryRef.current = {};
          setAvailabilityByVehicleId({});
        }
        return;
      }

      if (!silent) {
        setIsLoadingDrivers(true);
      }
      setDriverLoadError('');

      try {
        const responses = await Promise.all(
          fetchableVehicles.map(async (vehicle) => {
            const response = await api.get('/rides/available-drivers', {
              params: {
                vehicleTypeId: vehicle.vehicleTypeId,
                vehicleIconType: vehicle.iconType,
                lng: pickupCoords[0],
                lat: pickupCoords[1],
                service_location_id: effectiveServiceLocationId,
                transport_type: resolveRideTransportType(routeState.transport_type, routeState.transportType, vehicle?.transportType),
              },
            });

            return [vehicle.id, { ...DEFAULT_AVAILABILITY, ...unwrap(response) }];
          }),
        );

        if (!active) {
          return;
        }

        setAvailabilityByVehicleId((current) => {
          const base = replace ? {} : current;
          const nextEntries = { ...base };

          responses.forEach(([vehicleId, payload]) => {
            const previousDrivers = availabilityHistoryRef.current?.[vehicleId]?.drivers || current?.[vehicleId]?.drivers || [];
            nextEntries[vehicleId] = {
              ...payload,
              drivers: attachDriverMotionMetadata(payload?.drivers, previousDrivers),
            };
          });

          availabilityHistoryRef.current = nextEntries;
          return nextEntries;
        });
      } catch (error) {
        if (active) {
          if (replace) {
            availabilityHistoryRef.current = {};
            setAvailabilityByVehicleId({});
          }
          setDriverLoadError(error.message || 'Could not load online drivers.');
        }
      } finally {
        if (active && !silent) {
          setIsLoadingDrivers(false);
        }
      }
    };

    if (!vehicles.length) {
      availabilityHistoryRef.current = {};
      setAvailabilityByVehicleId({});
      return undefined;
    }

    fetchVehicleAvailabilities(vehicles, { replace: true });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Option to refresh if needed
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pickupCoords, effectiveServiceLocationId, routeState.transportType, routeState.transport_type, selected, vehicles]);

  const openPicker = (inputRef) => {
    if (typeof inputRef.current?.showPicker === 'function') {
      inputRef.current.showPicker();
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.click();
  };

  const openLocationEditor = () => {
    navigate(`${routePrefix}/ride/select-location`, {
      state: {
        pickup,
        drop,
        pickupCoords,
        dropCoords,
        stops,
      },
    });
  };

  const proceedToBooking = () => {
    if (!selectedVehicle) {
      return;
    }

    setShowBidModal(false);
    const baseFare = Number(selectedVehicle.price || 0);
    const finalFare = appliedPromo?.breakdown?.fare_after_discount ?? baseFare;

    navigate(`${routePrefix}/ride/searching`, {
      state: {
        pickup,
        drop,
        pickupCoords,
        dropCoords,
        stops,
        service_location_id: effectiveServiceLocationId,
        transport_type: resolvedTransportType,
        vehicle: selectedVehicle,
        vehicleTypeId: selectedVehicle.vehicleTypeId,
        vehicleIconType: selectedVehicle.iconType,
        vehicleIconUrl: selectedVehicle.vehicleIconUrl || selectedVehicle.icon,
        paymentMethod,
        fare: finalFare,
        baseFare,
        promo_code: appliedPromo?.promo?.code || '',
        promo: appliedPromo?.promo || null,
        promoBreakdown: appliedPromo?.breakdown || null,
        bookingMode: selectedVehicle.supportsBidding ? 'bidding' : 'normal',
        pricingNegotiationMode: selectedVehicle.supportsBidding
          ? shouldUseDriverBidding
            ? 'driver_bid'
            : 'user_increment_only'
          : 'none',
        bidStepAmount: selectedBidStepAmount,
        bidFloorFare: selectedBidFloorFare,
        bidCeilingMaxFare: selectedBidCeilingMaxFare,
        userMaxBidFare: selectedVehicle.supportsBidding && shouldUseDriverBidding ? selectedBidCeiling : finalFare,
        bidIncrement: selectedVehicle.supportsBidding && shouldUseDriverBidding ? selectedBidIncrement : 0,
        estimatedDistanceMeters: tripMetrics.distanceMeters,
        estimatedDurationMinutes: tripMetrics.durationMinutes,
        rideMode,
        scheduledAt: rideMode === 'schedule' ? new Date(scheduledAt).toISOString() : null,
        allowedPaymentMethods,
        searchNonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
  };

  const handleBook = () => {
    if (!selectedVehicle) {
      return;
    }

    if (rideMode === 'schedule') {
      const parsedSchedule = new Date(scheduledAt);

      if (!scheduledAt || Number.isNaN(parsedSchedule.getTime())) {
        setScheduleError('Choose a valid schedule date and time.');
        return;
      }

      if (parsedSchedule.getTime() <= Date.now() + 60 * 1000) {
        setScheduleError('Schedule time must be at least 1 minute ahead.');
        return;
      }

      if (scheduledAt < minScheduledAt) {
        setScheduleError('Schedule time cannot be earlier than now.');
        return;
      }

      if (scheduledAt > maxScheduledAt) {
        setScheduleError('Advance booking is available for up to 7 days only.');
        return;
      }
    }

    setScheduleError('');

    proceedToBooking();
  };

  return (
    <div className="h-[100dvh] bg-slate-50 max-w-lg mx-auto relative font-['Plus_Jakarta_Sans'] overflow-hidden">
      <div className="absolute inset-0 w-full bg-gray-200">
        <VehicleMapPreview
          center={pickupPosition}
          dropPosition={dropPosition}
          stops={stops}
          drivers={onlineDrivers}
          selectedVehicle={selectedVehicle}
          isLoaded={isMapLoaded}
          loadError={mapLoadError}
        />

        <div className="absolute top-6 left-4 right-4 z-20 flex items-center gap-2.5">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate(-1)}
            className="w-10 h-10 bg-white/95 rounded-[14px] shadow-[0_4px_14px_rgba(15,23,42,0.12)] flex items-center justify-center shrink-0"
          >
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
        </div>

      </div>

      <div className="absolute bottom-0 left-0 right-0 z-40 flex max-h-[69dvh] min-h-[360px] flex-col overflow-hidden rounded-t-[26px] bg-white shadow-[0_-12px_44px_rgba(15,23,42,0.16)]">
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2.5 mb-2 shrink-0" />

        <div className="shrink-0 border-b border-slate-100 px-4 pb-3">
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex gap-3">
                <div className="flex w-2.5 shrink-0 flex-col items-center">
                  <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[#7fc76d]" />
                  <span className="my-1 h-6 w-px bg-slate-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#d95c6a]" />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <p className="pt-0.5 truncate text-[13px] font-medium text-slate-700">{pickup}</p>
                  <button
                    type="button"
                    onClick={openLocationEditor}
                    className="flex w-full items-start rounded-[12px] -mx-1 px-1 py-1 text-left transition hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-slate-700">{drop}</p>
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">Edit</span>
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowScheduleModal(true)}
              className={`flex w-[42px] shrink-0 flex-col items-center justify-center rounded-[12px] border px-1 py-2 text-[10px] font-medium ${rideMode === 'schedule'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
                }`}
            >
              <Clock3 size={14} strokeWidth={2.2} />
              <span className="mt-1">{rideMode === 'schedule' ? 'Later' : 'Now'}</span>
            </button>
          </div>
        </div>

        <div className="mx-3 mt-1 mb-2 flex rounded-[12px] bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('normal');
              const firstNormal = displayedVehicles.find(v => v.dispatchType === 'normal' || v.dispatchType === 'both');
              if (firstNormal) setSelected(firstNormal.id);
            }}
            className={`flex-1 rounded-[10px] py-1.5 text-[12px] font-bold transition-all ${activeTab === 'normal' ? 'bg-white text-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)]' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Instant Booking
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('bidding');
              const firstBidding = displayedVehicles.find(v => v.dispatchType === 'bidding' || v.dispatchType === 'both');
              if (firstBidding) setSelected(firstBidding.id);
            }}
            className={`flex-1 rounded-[10px] py-1.5 text-[12px] font-bold transition-all ${activeTab === 'bidding' ? 'bg-white text-slate-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)]' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Bid Booking
          </button>
        </div>

        <div className="relative flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto no-scrollbar px-3 pt-1 pb-2 space-y-2.5"
          >
            {isLoadingVehicles && (
              <div className="min-h-[180px] flex flex-col items-center justify-center gap-3 text-slate-400">
                <LoaderCircle size={26} className="animate-spin" />
                <p className="text-[11px] font-bold uppercase tracking-widest">Finding available rides</p>
              </div>
            )}

            {!isLoadingVehicles && vehicleLoadError && (
              <div className="rounded-[18px] border border-red-50 bg-white px-4 py-5 text-center">
                <p className="text-[12px] font-black text-red-500">{vehicleLoadError}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-400">Please try again later.</p>
              </div>
            )}

            {!isLoadingVehicles && !vehicleLoadError && displayedVehicles.filter(v => v.dispatchType === activeTab || v.dispatchType === 'both').length === 0 && (
              <div className="rounded-[18px] border border-slate-100 bg-white px-4 py-5 text-center">
                <p className="text-[13px] font-bold text-slate-900">No vehicles available</p>
                <p className="mt-1 text-[11px] font-bold text-slate-400">Try changing your location or method.</p>
              </div>
            )}

            {!isLoadingVehicles && !vehicleLoadError && displayedVehicles
              .filter(v => v.dispatchType === activeTab || v.dispatchType === 'both')
              .map((v, i, arr) => {
              const isSelected = selected === v.id;
              const availability = availabilityByVehicleId[v.id] || DEFAULT_AVAILABILITY;
              const isUnavailable = !availability.totalDrivers;
              const canSelectVehicle = rideMode === 'schedule' || !isUnavailable;
              const compactEta = Math.max(
                1,
                availability.closestDriverEtaMinutes || tripMetrics.durationMinutes || 1,
              );
              const fareLabel = isUnavailable && rideMode !== 'schedule'
                ? 'N/A'
                : isFarePending
                  ? '...'
                  : formatCurrency(v.price);

              return (
                <React.Fragment key={v.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.04, ease: [0.23, 1, 0.32, 1] }}
                    className={`overflow-hidden rounded-[18px] border transition-all ${isSelected
                        ? 'border-slate-200 bg-[#fbfaf8] shadow-[0_6px_16px_rgba(15,23,42,0.08)]'
                        : 'border-transparent bg-white'
                      }`}
                  >
                  <div
                    role={canSelectVehicle ? 'button' : undefined}
                    tabIndex={canSelectVehicle ? 0 : undefined}
                    onClick={() => {
                      if (canSelectVehicle) {
                        setSelected(v.id);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (!canSelectVehicle) {
                        return;
                      }

                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(v.id);
                      }
                    }}
                    className={`flex items-center gap-3 px-3 py-3 text-left ${canSelectVehicle ? 'cursor-pointer' : 'cursor-default opacity-55'
                      }`}
                  >
                    <div className="flex w-[52px] shrink-0 flex-col items-center">
                      <div className="flex h-9 w-full items-center justify-center">
                        {v.icon && <img src={v.icon} alt={v.name} className="h-8 w-12 object-contain" draggable={false} />}
                      </div>
                      <span className="mt-1 text-[10px] font-medium text-slate-500">{compactEta} min</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold leading-tight text-slate-900">
                            {v.name}
                          </span>
                          <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">
                            {v.sublabel}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`flex flex-col items-end ${isUnavailable && rideMode !== 'schedule' ? 'text-slate-300' : 'text-slate-900'}`}>
                            {isSelected && activeTab === 'bidding' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setBidStepCount(Math.max(0, bidStepCount - 1)); }}
                                  className={`flex h-7 w-7 items-center justify-center rounded-full border border-emerald-600 text-emerald-600 ${bidStepCount <= 0 ? 'opacity-30' : 'active:bg-emerald-50'}`}
                                  disabled={bidStepCount <= 0}
                                >
                                  -
                                </button>
                                <span className="block text-[20px] font-semibold leading-none">
                                  {formatCurrency(selectedBidCeiling)}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setBidStepCount(Math.min(selectedBidSteps, bidStepCount + 1)); }}
                                  className={`flex h-7 w-7 items-center justify-center rounded-full border border-emerald-600 text-emerald-600 ${bidStepCount >= selectedBidSteps ? 'opacity-30' : 'active:bg-emerald-50'}`}
                                  disabled={bidStepCount >= selectedBidSteps}
                                >
                                  +
                                </button>
                              </div>
                            ) : isSelected && appliedPromo ? (
                              <>
                                <span className="text-[12px] text-slate-400 line-through leading-none mb-1">{fareLabel}</span>
                                <span className="block text-[20px] font-semibold leading-none text-emerald-600">
                                  {formatCurrency(discountedSelectedFare)}
                                </span>
                              </>
                            ) : (
                              <span className="block text-[20px] font-semibold leading-none">
                                {fareLabel}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <div className="mt-1 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPreviewVehicleId(v.id);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                                aria-label={`View details for ${v.name}`}
                                title={`View details for ${v.name}`}
                              >
                                <Eye size={12} strokeWidth={2.4} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="mt-2">
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-medium text-slate-500">
                              {rideMode === 'schedule'
                                ? `Scheduled for ${formatScheduledDisplay(scheduledAt)}`
                                : isUnavailable
                                  ? 'Unavailable right now'
                                  : formatAvailabilityLine(availability)}
                            </p>
                            {driverLoadError && (
                              <p className="mt-1 text-[10px] font-medium text-rose-500">{driverLoadError}</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {!isSelected && i < arr.length - 1 && arr[i + 1].dispatchType === v.dispatchType && (
                    <div className="ml-[68px] border-b border-slate-100" />
                  )}
                  </motion.div>
                </React.Fragment>
              );
            })}
          </div>
          <ScrollIndicator show={showScrollArrow} />
        </div>

        <div className="shrink-0 border-t border-slate-100 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5">
          <input
            ref={scheduledAtInputRef}
            type="datetime-local"
            value={scheduledAt}
            min={minScheduledAt}
            max={maxScheduledAt}
            onChange={(event) => {
              setScheduledAt(event.target.value);
              setRideMode('schedule');
              setScheduleError('');
            }}
            className="sr-only"
          />

          <div className="grid grid-cols-3 rounded-[12px] border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              className="flex items-center justify-center gap-2 border-r border-slate-200 px-3 py-2.5 text-[12px] font-medium text-slate-700"
            >
              <Banknote size={15} strokeWidth={2.2} className="text-green-600" />
              <span>{paymentMethod === 'Cash' ? 'Cash' : 'Online'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCouponModal(true)}
              className={`flex items-center justify-center gap-2 border-r border-slate-200 px-3 py-2.5 text-[12px] font-medium ${appliedPromo ? 'text-emerald-700' : 'text-slate-700'
                }`}
            >
              <TicketPercent size={14} strokeWidth={2.3} className={appliedPromo ? 'text-emerald-600' : 'text-slate-500'} />
              <span>{appliedPromo?.promo?.code || (availablePromos.length ? `Coupon ${availablePromos.length}` : 'Coupon')}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowScheduleModal(true)}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 text-[12px] font-medium ${rideMode === 'schedule' ? 'text-emerald-700' : 'text-slate-700'}`}
            >
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${rideMode === 'schedule' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>•</span>
              <span>{rideMode === 'schedule' ? 'Scheduled' : 'Schedule ride'}</span>
            </button>
          </div>

          {(appliedPromo || promoError || promoFeedback) && (
            <div className={`mt-2 rounded-[12px] border px-3 py-2 ${promoError ? 'border-rose-100 bg-rose-50/70' : 'border-emerald-100 bg-emerald-50/70'
              }`}>
              {appliedPromo && !promoError ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-emerald-700">
                      {appliedPromo.promo?.code} applied for this zone
                    </p>
                    <p className="mt-0.5 text-[10px] font-medium text-emerald-700/80">
                      Save {formatCurrency(appliedPromoDiscount)}. Fare now {formatCurrency(discountedSelectedFare)}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => clearAppliedPromo('Coupon removed.')}
                    className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <p className={`text-[10px] font-medium ${promoError ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {promoError || promoFeedback}
                </p>
              )}
            </div>
          )}

          <motion.button
            whileHover={canProceed ? { scale: 1.01 } : {}}
            whileTap={canProceed ? { scale: 0.98 } : undefined}
            disabled={!canProceed}
            onClick={handleBook}
            className={`mt-3 flex w-full items-center justify-center rounded-[8px] px-4 py-3.5 text-[16px] font-medium transition ${canProceed
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-200 text-slate-400'
              }`}
          >
            {selectedVehicle
              ? isFarePending
                ? 'Calculating fare...'
                : selectedVehicle.supportsBidding && shouldUseDriverBidding
                  ? `Request Bid for ${selectedVehicle.name}`
                  : rideMode === 'schedule'
                    ? `Schedule ${selectedVehicle.name}`
                    : selectedAvailability.totalDrivers
                      ? `Book ${selectedVehicle.name}`
                      : `${selectedVehicle.name} Unavailable`
              : rideMode !== 'schedule' && !hasBookableVehicles
                ? 'No Vehicles Available'
                : 'Select Vehicle'}
          </motion.button>

          {rideMode === 'schedule' ? (
            scheduleError ? (
              <p className="mt-2 text-[11px] font-medium text-rose-500">{scheduleError}</p>
            ) : (
              <p className="mt-2 text-[11px] font-medium text-slate-500">
                Scheduled for {formatScheduledDisplay(scheduledAt)}.
              </p>
            )
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {previewVehicle && (
          <React.Fragment key="vehicle-preview-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPreviewVehicleId('')}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-[28px] px-5 pt-4 pb-8 z-[101]"
            >
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary-orange/50 mb-1">Vehicle details</p>
                  <h3 className="text-[20px] font-extrabold text-slate-900">{previewVehicle.name}</h3>
                  <p className="mt-1 text-[12px] font-bold text-slate-500">
                    {previewVehicle.sublabel || 'Comfortable ride option for this route.'}
                  </p>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-slate-50">
                  <img src={previewVehicle.icon} alt={previewVehicle.name} className="h-12 w-14 object-contain" draggable={false} />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Estimated fare</p>
                  <p className="mt-1 text-[17px] font-extrabold text-slate-900">
                    {isFarePending ? 'Calculating...' : formatVehicleFare(previewVehicle)}
                  </p>
                </div>
                <div className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Seats</p>
                  <p className="mt-1 text-[17px] font-extrabold text-slate-900">{previewVehicle.capacity}</p>
                </div>
                <div className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Booking type</p>
                  <p className="mt-1 text-[14px] font-extrabold text-slate-900">{formatDispatchLabel(previewVehicle)}</p>
                </div>
                <div className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Availability</p>
                  <p className="mt-1 text-[14px] font-extrabold text-slate-900">
                    {rideMode === 'schedule'
                      ? 'Can be scheduled'
                      : previewAvailability.totalDrivers
                        ? `${previewAvailability.totalDrivers} nearby`
                        : 'Unavailable now'}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-[20px] border border-primary-orange/10 bg-primary-orange/5/60 px-4 py-4">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-orange/50">Trip snapshot</p>
                <p className="mt-2 text-[12px] font-bold leading-5 text-slate-700">
                  {rideMode === 'schedule'
                    ? 'This vehicle can be reserved for a later trip at your chosen time.'
                    : previewAvailability.totalDrivers
                      ? formatAvailabilityLine(previewAvailability)
                      : 'No driver is currently online for this vehicle around your pickup.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPreviewVehicleId('')}
                className="mt-5 w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[13px] font-black uppercase tracking-[0.14em] text-slate-700"
              >
                Close
              </button>
            </motion.div>
          </React.Fragment>
        )}

        {showBidModal && selectedVehicle?.supportsBidding && shouldUseDriverBidding && (
          <React.Fragment key="bid-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBidModal(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-[28px] px-5 pt-4 pb-10 z-[101]"
            >
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary-orange/50 mb-1">Bid fare</p>
              <h3 className="text-[18px] font-bold text-slate-900">Choose your max fare</h3>
              <p className="mt-1 text-[12px] font-bold text-slate-500">
                Drivers can send offers up to this amount for {selectedVehicle.name}.
              </p>

              <div className="mt-5 rounded-[20px] border border-primary-orange/10 bg-primary-orange/5/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-primary-orange/50">Bid Range</p>
                    <p className="mt-1 text-[13px] font-bold text-slate-900">Adjust the fare ceiling inside the admin-configured bidding range.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Max fare</p>
                    <p className="mt-1 text-[20px] font-black text-slate-900">{formatCurrency(selectedBidCeiling)}</p>
                  </div>
                </div>

                <input
                  type="range"
                  min={0}
                  max={selectedBidSteps}
                  step={1}
                  value={Math.min(bidStepCount, selectedBidSteps)}
                  onChange={(event) => setBidStepCount(Number(event.target.value || 0))}
                  className="mt-4 h-2 w-full cursor-pointer accent-orange-500"
                />

                <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-500">
                  <span>Floor {formatCurrency(selectedBidFloorFare)}</span>
                  <span>Ceiling {formatCurrency(selectedBidCeilingMaxFare)}</span>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowBidModal(false)}
                  className="flex-1 rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-[13px] font-black uppercase tracking-[0.14em] text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={proceedToBooking}
                  className="flex-1 rounded-[18px] bg-emerald-600 px-4 py-3 text-[13px] font-black uppercase tracking-[0.14em] text-white shadow-[0_12px_28px_-4px_rgba(5,150,105,0.4)]"
                >
                  Send Bid
                </button>
              </div>
            </motion.div>
          </React.Fragment>
        )}

        <AnimatePresence>
          {showScheduleModal && (
            <React.Fragment key="schedule-modal">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowScheduleModal(false)}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-[28px] px-5 pt-4 pb-10 z-[101]"
              >
                <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Schedule Ride</p>
                <h3 className="text-[20px] font-bold text-slate-900 mb-6">When do you want to leave?</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">Select Date & Time</label>
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      min={minScheduledAt}
                      max={maxScheduledAt}
                      onChange={(event) => {
                        setScheduledAt(event.target.value);
                        setScheduleError('');
                      }}
                      className="w-full rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-3.5 text-[15px] font-bold text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20"
                    />
                  </div>

                  {scheduleError && (
                    <p className="text-[12px] font-bold text-rose-500 mt-2">{scheduleError}</p>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScheduledAt('');
                        setRideMode('now');
                        setShowScheduleModal(false);
                      }}
                      className="flex-1 rounded-[16px] bg-slate-100 px-4 py-3.5 text-[14px] font-bold text-slate-700 active:bg-slate-200"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (scheduledAt) {
                          setRideMode('schedule');
                          setShowScheduleModal(false);
                        } else {
                          setScheduleError('Please select a valid date and time.');
                        }
                      }}
                      className="flex-1 rounded-[16px] bg-emerald-600 px-4 py-3.5 text-[14px] font-bold text-white shadow-lg shadow-emerald-600/30 active:bg-emerald-700"
                    >
                      Confirm Schedule
                    </button>
                  </div>
                </div>
              </motion.div>
            </React.Fragment>
          )}

          {showCouponModal && (
            <React.Fragment key="coupon-modal">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowCouponModal(false)}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-[28px] px-5 pt-4 pb-8 z-[101]"
              >
                <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 mb-1">Coupons</p>
                <h3 className="text-[18px] font-bold text-slate-900">Apply for this zone</h3>
                <p className="mt-1 text-[12px] font-bold text-slate-500">
                  Only coupons created for this service location show here.
                </p>

                <div className="mt-5 flex gap-2">
                  <input
                    type="text"
                    value={promoCodeInput}
                    onChange={(event) => {
                      setPromoCodeInput(event.target.value.toUpperCase());
                      setPromoError('');
                      setPromoFeedback('');
                    }}
                    placeholder="Enter coupon code"
                    className="min-w-0 flex-1 rounded-[16px] border border-slate-200 px-4 py-3 text-[13px] font-semibold text-slate-900 outline-none transition focus:border-emerald-300"
                  />
                  <button
                    type="button"
                    disabled={Boolean(applyingPromoCode) || !selectedVehicle}
                    onClick={async () => {
                      const applied = await applyPromoCode(promoCodeInput);
                      if (applied) {
                        setShowCouponModal(false);
                      }
                    }}
                    className="rounded-[16px] bg-slate-950 px-4 py-3 text-[12px] font-black uppercase tracking-[0.14em] text-white disabled:opacity-60"
                  >
                    {applyingPromoCode ? 'Applying' : 'Apply'}
                  </button>
                </div>

                {(promoError || promoFeedback) && (
                  <p className={`mt-3 text-[11px] font-semibold ${promoError ? 'text-rose-500' : 'text-emerald-600'}`}>
                    {promoError || promoFeedback}
                  </p>
                )}

                <div className="mt-5 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
                  {isLoadingPromos ? (
                    <div className="flex items-center gap-2 rounded-[18px] border border-slate-100 bg-slate-50 px-4 py-4">
                      <LoaderCircle size={16} className="animate-spin text-slate-500" />
                      <span className="text-[12px] font-semibold text-slate-600">Loading available coupons</span>
                    </div>
                  ) : availablePromos.length ? (
                    availablePromos.map((promo) => {
                      const isApplied = String(appliedPromo?.promo?.code || '').toUpperCase() === String(promo?.code || '').toUpperCase();

                      return (
                        <div
                          key={promo?._id || promo?.code}
                          className={`rounded-[18px] border px-4 py-4 ${isApplied ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-100 bg-slate-50/70'
                            }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-[14px] font-black text-slate-900">{promo?.code}</p>
                                {isApplied && <CheckCircle2 size={14} className="text-emerald-600" strokeWidth={2.6} />}
                              </div>
                              <p className="mt-1 text-[11px] font-medium text-slate-600">{formatPromoSummary(promo)}</p>
                            </div>
                            <button
                              type="button"
                              disabled={Boolean(applyingPromoCode)}
                              onClick={async () => {
                                const applied = await applyPromoCode(promo?.code);
                                if (applied) {
                                  setShowCouponModal(false);
                                }
                              }}
                              className={`shrink-0 rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] ${isApplied ? 'bg-emerald-600 text-white' : 'bg-white text-slate-800 border border-slate-200'
                                } disabled:opacity-60`}
                            >
                              {applyingPromoCode === String(promo?.code || '').toUpperCase() ? 'Applying' : isApplied ? 'Applied' : 'Use'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-[18px] border border-slate-100 bg-slate-50 px-4 py-4">
                      <p className="text-[12px] font-semibold text-slate-600">
                        No coupons are active for this zone right now.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            </React.Fragment>
          )}
          {showPaymentModal && (
            <React.Fragment key="payment-modal">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowPaymentModal(false)}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
              />
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 320 }}
                className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white rounded-t-[28px] px-5 pt-4 pb-10 z-[101]"
              >
                <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Payment</p>
                <h3 className="text-[18px] font-bold text-slate-900 mb-5">Select Method</h3>
                <div className="space-y-2.5">
                  {paymentOptions.map(({ id, stateValue, label, sub, Icon, bg, color }) => (
                    <motion.button
                      key={stateValue}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setPaymentMethod(stateValue);
                        setShowPaymentModal(false);
                      }}
                      className={`w-full flex items-center gap-3.5 p-4 rounded-[18px] border-2 transition-all ${paymentMethod === stateValue ? 'border-primary-orange/20 bg-primary-orange/5/40' : 'border-slate-100 bg-slate-50/50'
                        }`}
                    >
                      <div className={`w-10 h-10 rounded-[12px] ${bg} flex items-center justify-center shrink-0`}>
                        <Icon size={18} className={color} strokeWidth={2} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-[14px] font-bold text-slate-900">{label}</p>
                        <p className="text-[11px] font-bold text-slate-400">{sub}</p>
                      </div>
                      {paymentMethod === stateValue && (
                        <div className="w-5 h-5 rounded-full bg-primary-orange/50 flex items-center justify-center shrink-0">
                          <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                            <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      )}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            </React.Fragment>
          )}
        </AnimatePresence>
      </AnimatePresence>
    </div>
  );
};

export default SelectVehicle;
