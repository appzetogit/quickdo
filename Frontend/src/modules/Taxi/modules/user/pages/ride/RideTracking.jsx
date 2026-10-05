import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, MessageCircle, AlertTriangle, Shield, Star, ChevronLeft, Share2, Clock3, FileText, ChevronDown, X, Check } from 'lucide-react';
import { GoogleMap, MarkerF, OverlayView, OverlayViewF, PolylineF } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { socketService } from '../../../../shared/api/socket';
import api from '../../../../shared/api/axiosInstance';
import { getLocalUserToken } from '../../services/authService';
import { clearCurrentRide, getCurrentRide, saveCurrentRide } from '../../services/currentRideService';
import { useAuthStore } from '../../../../../../core/auth/auth.store';
import { useSettings } from '../../../../shared/context/SettingsContext';
import { BACKEND_ORIGIN } from '../../../../shared/api/runtimeConfig';
import toast from 'react-hot-toast';
import FloatingSOS from '../safety/FloatingSOS';
import SafetyToolkit from '../safety/SafetyToolkit';

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const DEFAULT_CENTER = { lat: 22.7196, lng: 75.8577 };
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'delivered']);
const ACTIVE_RIDE_VALIDATE_MS = 15000;
const COMPLETED_TRACKING_STATUSES = new Set(['completed', 'delivered']);
const POST_RIDE_REDIRECT_STATUSES = new Set(['completed', 'delivered']);

const toLatLng = (coords, fallback = DEFAULT_CENTER) => {
  const [lng, lat] = coords || [];

  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  return fallback;
};

const arePositionsNearlyEqual = (first, second, threshold = 0.0002) => (
  Math.abs(Number(first?.lat ?? 0) - Number(second?.lat ?? 0)) < threshold &&
  Math.abs(Number(first?.lng ?? 0) - Number(second?.lng ?? 0)) < threshold
);

const normalizeHeading = (value, fallback = 0) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return ((numeric % 360) + 360) % 360;
};

const calculateBearing = (from, to, fallback = 0) => {
  if (!from || !to || arePositionsNearlyEqual(from, to, 0.00001)) {
    return fallback;
  }

  const fromLat = Number(from.lat) * (Math.PI / 180);
  const toLat = Number(to.lat) * (Math.PI / 180);
  const deltaLng = (Number(to.lng) - Number(from.lng)) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);

  return normalizeHeading(Math.atan2(y, x) * (180 / Math.PI), fallback);
};

const getRouteHeading = (position, path = [], fallback = 0) => {
  const nextPoint = path.find((point) => !arePositionsNearlyEqual(position, point, 0.00001));
  return nextPoint ? calculateBearing(position, nextPoint, fallback) : fallback;
};

const getVehicleMarkerOffset = (width, height) => ({
  x: -(width / 2),
  y: -(height / 2),
});

const RotatingVehicleMarker = ({ position, iconUrl, heading = 0, title = 'Driver' }) => (
  <OverlayViewF
    position={position}
    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    getPixelPositionOffset={getVehicleMarkerOffset}
  >
    <div title={title} className="pointer-events-none flex h-14 w-14 items-center justify-center">
      <div
        className="flex h-11 w-11 items-center justify-center transition-transform duration-500 ease-out"
        style={{ transform: `rotate(${normalizeHeading(heading)}deg)` }}
      >
        {iconUrl && (
          <img
            src={iconUrl}
            alt={title}
            className="h-12 w-12 object-contain drop-shadow-[0_8px_10px_rgba(15,23,42,0.35)]"
            draggable={false}
          />
        )}
      </div>
    </div>
  </OverlayViewF>
);

const getTrackingVehicleIcon = (ride, driver) => {
  const customIcon = String(
    ride?.vehicleIconUrl ||
    ride?.vehicle?.vehicleIconUrl ||
    ride?.vehicle?.icon ||
    driver?.vehicleIconUrl ||
    driver?.map_icon ||
    driver?.icon ||
    '',
  ).trim();

  if (customIcon) return customIcon;

  return null;
};

const getInitials = (name = '') =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'DR';

const unwrapApiPayload = (response) => response?.data?.data || response?.data || response;
const isLikelyVehiclePhoto = (value = '') => /^(https?:|data:image\/|blob:|\/uploads\/|\/images\/)/i.test(String(value || '').trim());
const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const pickPreferredValue = (...values) => values.find((value) => String(value || '').trim()) || '';
const resolveAssetUrl = (value = '') => {
  const raw = String(value || '').trim();

  if (!raw) {
    return '';
  }

  if (/^(https?:|data:image\/|blob:)/i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('/')) {
    return `${BACKEND_ORIGIN}${raw}`;
  }

  return `${BACKEND_ORIGIN}/${raw.replace(/^\/+/, '')}`;
};

const buildRideShareText = ({ appName, driverName, vehicleNumber, pickupLabel, dropLabel }) =>
  `I'm riding with ${appName}!\nDriver: ${driverName} (${vehicleNumber || 'Assigned'})\nFrom: ${pickupLabel}\nTo: ${dropLabel}`;

const buildShareLinks = (text) => ({
  whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
  sms: `sms:?&body=${encodeURIComponent(text)}`,
});

const formatTimerClock = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const formatWholeMinutes = (value) => `${Math.max(0, Math.floor(Number(value) || 0))} min`;

const formatScheduledDateTime = (value) => {
  if (!value) {
    return 'Pickup time pending';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Pickup time pending';
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getScheduledCountdownLabel = (value, now = Date.now()) => {
  const parsed = value ? new Date(value) : null;
  const time = parsed?.getTime?.() || NaN;

  if (!Number.isFinite(time)) {
    return '';
  }

  const diffMs = time - now;
  if (diffMs <= 0) {
    return 'Pickup window is open';
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `Starts in ${days}d ${hours}h ${minutes}m ${seconds}s`;
  }

  if (hours > 0) {
    return `Starts in ${hours}h ${minutes}m ${seconds}s`;
  }

  return `Starts in ${minutes}m ${seconds}s`;
};

const mergeDriverSnapshot = (baseDriver = {}, incomingDriver = {}) => {
  const safeBaseDriver = isPlainObject(baseDriver) ? baseDriver : {};
  const safeIncomingDriver = isPlainObject(incomingDriver) ? incomingDriver : {};
  const incomingVehicle = isPlainObject(safeIncomingDriver.vehicle) ? safeIncomingDriver.vehicle : {};
  const baseVehicle = isPlainObject(safeBaseDriver.vehicle) ? safeBaseDriver.vehicle : {};

  return {
    ...safeBaseDriver,
    ...safeIncomingDriver,
    profileImage: pickPreferredValue(
      safeIncomingDriver.profileImage,
      safeIncomingDriver.profile_image,
      safeIncomingDriver.image,
      safeIncomingDriver.avatar,
      safeIncomingDriver.selfie,
      safeBaseDriver.profileImage,
      safeBaseDriver.profile_image,
      safeBaseDriver.image,
      safeBaseDriver.avatar,
      safeBaseDriver.selfie,
    ),
    vehicleImage: pickPreferredValue(
      safeIncomingDriver.vehicleImage,
      safeIncomingDriver.vehicle_image,
      safeIncomingDriver.vehiclePhoto,
      safeIncomingDriver.vehicle_photo,
      incomingVehicle.vehicleImage,
      incomingVehicle.vehicle_image,
      incomingVehicle.image,
      incomingVehicle.photo,
      safeBaseDriver.vehicleImage,
      safeBaseDriver.vehicle_image,
      safeBaseDriver.vehiclePhoto,
      safeBaseDriver.vehicle_photo,
      baseVehicle.vehicleImage,
      baseVehicle.vehicle_image,
      baseVehicle.image,
      baseVehicle.photo,
    ),
    image: pickPreferredValue(safeIncomingDriver.image, safeIncomingDriver.profileImage, safeBaseDriver.image, safeBaseDriver.profileImage),
    avatar: pickPreferredValue(safeIncomingDriver.avatar, safeIncomingDriver.profileImage, safeBaseDriver.avatar, safeBaseDriver.profileImage),
    name: pickPreferredValue(safeIncomingDriver.name, safeBaseDriver.name),
    phone: pickPreferredValue(safeIncomingDriver.phone, safeIncomingDriver.mobile, safeIncomingDriver.phoneNumber, safeBaseDriver.phone, safeBaseDriver.mobile, safeBaseDriver.phoneNumber),
    vehicle: pickPreferredValue(
      typeof safeIncomingDriver.vehicle === 'string' ? safeIncomingDriver.vehicle : '',
      safeIncomingDriver.vehicleType,
      safeIncomingDriver.vehicle_type,
      incomingVehicle.name,
      incomingVehicle.vehicleType,
      incomingVehicle.vehicle_type,
      typeof safeBaseDriver.vehicle === 'string' ? safeBaseDriver.vehicle : '',
      safeBaseDriver.vehicleType,
      safeBaseDriver.vehicle_type,
      baseVehicle.name,
      baseVehicle.vehicleType,
      baseVehicle.vehicle_type,
    ),
    vehicleType: pickPreferredValue(
      safeIncomingDriver.vehicleType,
      safeIncomingDriver.vehicle_type,
      incomingVehicle.vehicleType,
      incomingVehicle.vehicle_type,
      safeBaseDriver.vehicleType,
      safeBaseDriver.vehicle_type,
      baseVehicle.vehicleType,
      baseVehicle.vehicle_type,
    ),
    vehicleNumber: pickPreferredValue(
      safeIncomingDriver.vehicleNumber,
      safeIncomingDriver.vehicle_number,
      safeIncomingDriver.plate,
      incomingVehicle.vehicleNumber,
      incomingVehicle.vehicle_number,
      incomingVehicle.plate,
      safeBaseDriver.vehicleNumber,
      safeBaseDriver.vehicle_number,
      safeBaseDriver.plate,
      baseVehicle.vehicleNumber,
      baseVehicle.vehicle_number,
      baseVehicle.plate,
    ),
    plate: pickPreferredValue(
      safeIncomingDriver.plate,
      safeIncomingDriver.vehicleNumber,
      safeIncomingDriver.vehicle_number,
      incomingVehicle.plate,
      incomingVehicle.vehicleNumber,
      incomingVehicle.vehicle_number,
      safeBaseDriver.plate,
      safeBaseDriver.vehicleNumber,
      safeBaseDriver.vehicle_number,
      baseVehicle.plate,
      baseVehicle.vehicleNumber,
      baseVehicle.vehicle_number,
    ),
    vehicleColor: pickPreferredValue(safeIncomingDriver.vehicleColor, safeIncomingDriver.vehicle_color, incomingVehicle.vehicleColor, incomingVehicle.vehicle_color, safeBaseDriver.vehicleColor, safeBaseDriver.vehicle_color, baseVehicle.vehicleColor, baseVehicle.vehicle_color),
    vehicleMake: pickPreferredValue(safeIncomingDriver.vehicleMake, safeIncomingDriver.vehicle_make, incomingVehicle.vehicleMake, incomingVehicle.vehicle_make, safeBaseDriver.vehicleMake, safeBaseDriver.vehicle_make, baseVehicle.vehicleMake, baseVehicle.vehicle_make),
    vehicleModel: pickPreferredValue(safeIncomingDriver.vehicleModel, safeIncomingDriver.vehicle_model, incomingVehicle.vehicleModel, incomingVehicle.vehicle_model, safeBaseDriver.vehicleModel, safeBaseDriver.vehicle_model, baseVehicle.vehicleModel, baseVehicle.vehicle_model),
    rating: pickPreferredValue(safeIncomingDriver.rating, safeBaseDriver.rating),
  };
};

const RideTracking = () => {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancellationBill, setCancellationBill] = useState(null);
  const [showCancellationBillModal, setShowCancellationBillModal] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [otherReasonText, setOtherReasonText] = useState('');
  const [showReasonSelection, setShowReasonSelection] = useState(false);
  const [rideRealtime, setRideRealtime] = useState(null);
  const [poolGroup, setPoolGroup] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [routeError, setRouteError] = useState('');
  const [map, setMap] = useState(null);
  const [safetyToolkitOpen, setSafetyToolkitOpen] = useState(false);
  const [driverImageFallback, setDriverImageFallback] = useState('');
  const [driverImageBroken, setDriverImageBroken] = useState(false);
  const [vehicleImageFallback, setVehicleImageFallback] = useState('');
  const [vehicleImageBroken, setVehicleImageBroken] = useState(false);
  const [arrivalClockFallbackAt, setArrivalClockFallbackAt] = useState('');
  const [waitingNow, setWaitingNow] = useState(Date.now());
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const navigate = useNavigate();
  const location = useLocation();
  const storedRide = useMemo(() => getCurrentRide(), []);
  const state = useMemo(() => location.state || storedRide || {}, [location.state, storedRide]);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const routeHome = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '/';
  const routeComplete = location.pathname.startsWith('/taxi/user') ? '/taxi/user/ride/complete' : '/ride/complete';
  const routeChat = location.pathname.startsWith('/taxi/user') ? '/taxi/user/ride/chat' : '/ride/chat';
  const routeSupport = location.pathname.startsWith('/taxi/user') ? '/taxi/user/support' : '/support';
  const routeSos = location.pathname.startsWith('/taxi/user') ? '/taxi/user/safety/sos' : '/safety/sos';

  const rideId = state.rideId || '';
  const scheduledAt = rideRealtime?.scheduledAt || state.scheduledAt || null;
  const scheduledTimestamp = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  const isScheduledRide = Number.isFinite(scheduledTimestamp);
  const isScheduledUpcoming = isScheduledRide && scheduledTimestamp > waitingNow;
  const scheduledCountdown = getScheduledCountdownLabel(scheduledAt, waitingNow);
  const scheduledDateLabel = formatScheduledDateTime(scheduledAt);
  const fare = rideRealtime?.fare || state.fare || 22;
  const paymentMethod = rideRealtime?.paymentMethod || state.paymentMethod || 'Cash';
  const fallbackDriver = useMemo(
    () => state.driver || { name: 'Captain', rating: '4.9', vehicle: 'Taxi', plate: 'Assigned', phone: '', profileImage: '', vehicleImage: '' },
    [state.driver],
  );
  const pickupLabel = rideRealtime?.pickup?.address || state.pickup || 'Pipaliyahana, Indore';
  const dropLabel = rideRealtime?.drop?.address || state.drop || 'Vijay Nagar, Indore';
  const pickupPosition = useMemo(
    () => toLatLng(rideRealtime?.pickup?.coordinates || state.pickupCoords || [75.9048, 22.7039]),
    [rideRealtime?.pickup?.coordinates, state.pickupCoords],
  );
  const dropPosition = useMemo(
    () => toLatLng(rideRealtime?.drop?.coordinates || state.dropCoords || [75.8937, 22.7533], pickupPosition),
    [pickupPosition, rideRealtime?.drop?.coordinates, state.dropCoords],
  );
  const driverPosition = useMemo(
    () => toLatLng(rideRealtime?.driverLocation?.coordinates, pickupPosition),
    [pickupPosition, rideRealtime?.driverLocation?.coordinates],
  );
  const hasLiveDriverLocation = Boolean(rideRealtime?.driverLocation?.coordinates?.length);
  const tripStatus = String(rideRealtime?.status || state.liveStatus || state.status || 'accepted').toLowerCase();
  const latestTripStatusRef = useRef(tripStatus);
  useEffect(() => {
    latestTripStatusRef.current = tripStatus;
  }, [tripStatus]);
  const otp = ['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus)
    ? ''
    : String(rideRealtime?.otp || state.otp || state.ride_otp || '');
  const serviceType = String(state.serviceType || state.type || 'ride').toLowerCase();
  const activeDestination = useMemo(
    () => (['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus) ? dropPosition : pickupPosition),
    [dropPosition, pickupPosition, tripStatus],
  );
  const driver = useMemo(
    () => mergeDriverSnapshot(fallbackDriver, rideRealtime?.driver || {}),
    [fallbackDriver, rideRealtime?.driver],
  );
  const trackingSnapshot = useMemo(
    () => ({
      ...state,
      ...(rideRealtime || {}),
      fare,
      paymentMethod,
      serviceType,
      vehicleIconType: rideRealtime?.vehicleIconType || state.vehicleIconType || '',
      vehicleIconUrl: rideRealtime?.vehicleIconUrl || state.vehicleIconUrl || '',
      driver,
    }),
    [driver, fare, paymentMethod, rideRealtime, serviceType, state],
  );
  const waitingPricing = rideRealtime?.pricingSnapshot || state.pricingSnapshot || {};
  const waitingChargePerMinute = Math.max(0, Number(waitingPricing?.waiting_charge ?? 0));
  const freeWaitingBeforeMinutes = Math.max(0, Number(waitingPricing?.free_waiting_before ?? 0));
  const tripStartedAtRaw = rideRealtime?.startedAt || state?.startedAt || '';
  const waitingStartedAt = rideRealtime?.arrivedAt || state.arrivedAt || arrivalClockFallbackAt || '';
  const waitingEndedAt = tripStartedAtRaw ? new Date(tripStartedAtRaw).getTime() : waitingNow;
  const waitingElapsedSeconds = waitingStartedAt
    ? Math.max(0, Math.floor((waitingEndedAt - new Date(waitingStartedAt).getTime()) / 1000))
    : 0;
  const freeWaitingRemainingSeconds = Math.max(0, freeWaitingBeforeMinutes * 60 - waitingElapsedSeconds);
  const waitingChargeableMinutes = Math.max(0, Math.ceil(waitingElapsedSeconds / 60) - freeWaitingBeforeMinutes);
  const waitingCharge = ['ongoing', 'arrived', 'completed'].includes(tripStatus) || rideRealtime?.waitingChargeAmount !== undefined
    ? Number(rideRealtime?.waitingChargeAmount ?? state.waitingChargeAmount ?? 0)
    : (waitingChargeableMinutes * waitingChargePerMinute);
  const additionalCharge = Number(rideRealtime?.additionalCharge ?? state.additionalCharge ?? 0);
  const distanceChargeAmount = Number(rideRealtime?.distanceChargeAmount ?? state.distanceChargeAmount ?? 0);
  const timeChargeAmount = Number(rideRealtime?.timeChargeAmount ?? state.timeChargeAmount ?? 0);
  const adminExtraChargeAmount = Number(rideRealtime?.adminExtraCharge?.amount ?? state.adminExtraCharge?.amount ?? 0);

  const { user } = useAuthStore();
  const pendingCancellationDue = Number(rideRealtime?.pending_cancellation_due || state.pending_cancellation_due || user?.pending_cancellation_due || 0);
  const applicableCancellationDue = tripStatus === 'completed' ? 0 : pendingCancellationDue;

  const promoDiscountAmount = Number(rideRealtime?.promo?.discount_amount ?? state?.promo?.discount_amount ?? 0);
  const currentTotalFare = ['arrived', 'completed'].includes(tripStatus)
    ? Math.max(0, Math.round(Number(fare || 0) + adminExtraChargeAmount + applicableCancellationDue - promoDiscountAmount))
    : Math.max(0, Math.round(Number(fare || 0) + waitingCharge + distanceChargeAmount + timeChargeAmount + additionalCharge + adminExtraChargeAmount + applicableCancellationDue - promoDiscountAmount));
  const isWaitingForOtp = Boolean(waitingStartedAt) && !['started', 'ongoing', 'arrived', 'completed', 'cancelled', 'delivered'].includes(tripStatus);
  const vehicleIcon = getTrackingVehicleIcon(trackingSnapshot, driver);
  const isPoolRide = Boolean(trackingSnapshot?.isPoolRide || state?.isPoolRide);

  const stopsTimelineElement = useMemo(() => {
    if (!isPoolRide || !poolGroup?.routeSequence) {
      return null;
    }

    return (
      <div className="rounded-[22px] border border-slate-100 bg-slate-50/50 p-4 shadow-sm text-left">
        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3.5">
          Shared Ride Route ({poolGroup.occupiedSeats}/{poolGroup.totalCapacity} seats)
        </h4>
        <div className="space-y-4 relative before:absolute before:left-3 before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-slate-200">
          {poolGroup.routeSequence.map((stop, index) => {
            const isCompleted = stop.status === 'completed';
            const isPickup = stop.type === 'pickup';
            const isCurrent = !isCompleted && poolGroup.routeSequence.findIndex(s => s.status !== 'completed') === index;
            const isMyStop = String(stop.rideId) === String(rideId);
            return (
              <div key={stop.id || index} className={`flex items-start gap-3 relative transition-all duration-300 ${isCompleted ? 'opacity-30' : ''}`}>
                <div className={`w-6.5 h-6.5 rounded-full flex items-center justify-center border text-[9px] font-black shrink-0 z-10 transition-transform ${isCurrent ? 'scale-110 shadow-md ring-4 ring-[#0F766E]/10' : ''} ${
                  isCompleted 
                    ? 'bg-slate-200 text-slate-500 border-slate-300' 
                    : isMyStop
                      ? 'bg-[#0F766E] text-white border-[#0F766E]'
                      : isPickup 
                        ? 'bg-teal-50 text-[#0F766E] border-teal-200' 
                        : 'bg-orange-50 text-orange-600 border-orange-200'
                }`}>
                  {isCompleted ? <Check size={10} strokeWidth={3.5} /> : (index + 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[12px] font-bold tracking-tight uppercase leading-none ${isCurrent ? 'text-[#0F766E]' : 'text-slate-800'}`}>
                      {isPickup ? 'Pickup' : 'Drop'} - {isMyStop ? 'You' : stop.passengerName}
                    </p>
                    {!isCompleted && (
                      <span className="text-[10px] font-extrabold text-slate-500 uppercase tracking-tighter shrink-0">
                        ETA: {stop.etaMinutes}m
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 truncate leading-tight font-medium">
                    {stop.address}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [isPoolRide, poolGroup, rideId]);
  const displayDriverHeading = useMemo(() => {
    if (Number.isFinite(Number(rideRealtime?.driverLocation?.heading))) {
      return normalizeHeading(rideRealtime.driverLocation.heading);
    }

    return getRouteHeading(
      driverPosition,
      routePath,
      calculateBearing(driverPosition, activeDestination),
    );
  }, [activeDestination, driverPosition, rideRealtime?.driverLocation?.heading, routePath]);
  const vehicleLabel = driver.vehicle || driver.vehicleType || (serviceType === 'parcel' ? 'Parcel' : 'Taxi');
  const nextDriverImage = resolveAssetUrl(
    driver.profileImage || driver.profile_image || driver.image || driver.avatar || driver.selfie || '',
  );
  const nextVehicleImage = resolveAssetUrl(
    driver.vehicleImage || driver.vehicle_image || driver.vehiclePhoto || driver.vehicle_photo || '',
  );
  const driverImage = driverImageBroken ? '' : (nextDriverImage || driverImageFallback);
  const vehicleImage = vehicleImageBroken ? '' : (nextVehicleImage || vehicleImageFallback);
  const hasVehiclePhoto = isLikelyVehiclePhoto(vehicleImage) && !vehicleImageBroken;
  const arrivalDriverName = driver.name || (serviceType === 'parcel' ? 'Agent' : 'Driver');
  const driverSubtitle = isWaitingForOtp
    ? `${arrivalDriverName} has arrived`
    : isScheduledUpcoming && !hasLiveDriverLocation
      ? 'Driver assigned. Live tracking starts closer to pickup time'
      : tripStatus === 'arrived'
        ? (serviceType === 'parcel' ? 'Parcel reached destination' : 'Driver reached destination')
        : tripStatus === 'started' || tripStatus === 'ongoing'
          ? (serviceType === 'parcel' ? 'Parcel picked up' : 'Trip started')
          : serviceType === 'parcel'
            ? 'Delivery agent is on the way'
            : 'Captain is on the way';
  const vehicleDetails = [driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ');
  const activeRideEndpoint = serviceType === 'parcel' ? '/deliveries/active/me' : '/rides/active/me';
  const latestStateRef = useRef(state);
  const latestFallbackDriverRef = useRef(fallbackDriver);
  const latestDriverRef = useRef(driver);
  const latestCompleteTrackingRef = useRef(() => { });
  const hasCompletedRedirectRef = useRef(false);
  const hasAutoFramedMapRef = useRef(false);
  const lastMapPanPositionRef = useRef(null);

  const isChargeableConditionMet = useMemo(() => {
    if (waitingPricing.enable_cancellation_charge === false) return false;

    const acceptedAt = rideRealtime?.acceptedAt || state.acceptedAt;
    if (acceptedAt) {
      const freeMin = Number(waitingPricing.free_cancellation_time || 2);
      const timeSinceAccepted = (Date.now() - new Date(acceptedAt).getTime()) / 60000;
      if (timeSinceAccepted < freeMin) return false;
    }

    const liveStatusLower = String(rideRealtime?.liveStatus || rideRealtime?.status || state.liveStatus || state.status || '').toLowerCase();
    const isOtpStage = ['waiting_for_otp', 'otp_verification'].includes(liveStatusLower);
    const isReachedStage = !!rideRealtime?.arrivedAt || !!state.arrivedAt || liveStatusLower === 'arrived';
    const isAcceptedStage = !!driver || !!acceptedAt || liveStatusLower === 'accepted';

    if (isOtpStage) return waitingPricing.charge_after_otp || waitingPricing.charge_after_driver_reached_pickup || waitingPricing.charge_after_driver_accepted;
    if (isReachedStage) return waitingPricing.charge_after_driver_reached_pickup || waitingPricing.charge_after_driver_accepted;
    if (isAcceptedStage) return waitingPricing.charge_after_driver_accepted;
    return false;
  }, [waitingPricing, rideRealtime, state, driver]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestFallbackDriverRef.current = fallbackDriver;
  }, [fallbackDriver]);

  useEffect(() => {
    latestDriverRef.current = driver;
  }, [driver]);

  useEffect(() => {
    hasAutoFramedMapRef.current = false;
    lastMapPanPositionRef.current = null;
  }, [rideId, tripStatus, activeDestination.lat, activeDestination.lng]);

  const handleCancelRide = async (reasonOverride = null) => {
    const finalReason = reasonOverride || (selectedReason === 'Others' ? otherReasonText : selectedReason) || 'User cancelled';

    if (['started', 'ongoing', 'in_trip', 'completed'].includes(tripStatus)) {
      toast.error('Ride cancellation is not allowed after the trip has started.');
      return;
    }

    try {
      if (rideId) {
        const response = await api.patch(`/rides/${rideId}/cancel`, { reason: finalReason });
        const bill = response?.data?.data?.cancellationBill;
        if (bill && (Number(bill.cancellationFee) > 0 || Number(bill.waitingCharge) > 0)) {
          setCancellationBill(bill);
          setShowCancellationBillModal(true);
          setShowCancelConfirm(false);
          setShowReasonSelection(false);
          return;
        }
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Failed to cancel ride');
    }
    clearCurrentRide();
    navigate('/taxi/user');
  };

  const handleCloseCancellationBill = () => {
    setShowCancellationBillModal(false);
    clearCurrentRide();
    navigate('/taxi/user');
  };

  useEffect(() => {
    if (nextDriverImage) {
      setDriverImageFallback(nextDriverImage);
      setDriverImageBroken(false);
    }
  }, [nextDriverImage]);

  useEffect(() => {
    if (nextVehicleImage) {
      setVehicleImageFallback(nextVehicleImage);
      setVehicleImageBroken(false);
    }
  }, [nextVehicleImage]);

  useEffect(() => {
    if (rideRealtime?.arrivedAt || state.arrivedAt) {
      setArrivalClockFallbackAt('');
      return;
    }

    if (tripStatus === 'arriving') {
      setArrivalClockFallbackAt((current) => current || new Date().toISOString());
      return;
    }

    if (['started', 'ongoing', 'arrived', 'completed', 'cancelled', 'delivered'].includes(tripStatus)) {
      setArrivalClockFallbackAt('');
    }
  }, [rideRealtime?.arrivedAt, state.arrivedAt, tripStatus]);

  useEffect(() => {
    setWaitingNow(Date.now());
    const intervalId = window.setInterval(() => {
      setWaitingNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const exitTracking = useMemo(
    () => () => {
      // We don't clear the ride on mount anymore to allow refreshes on the rating page.
      // clearCurrentRide() is now called after submission or when skipping.
      navigate(routeHome, { replace: true });
    },
    [navigate, routeHome],
  );

  const completeTracking = useMemo(
    () => (statusValue = 'completed', latestRealtime = null) => {
      const sourceRealtime = latestRealtime || rideRealtime;
      const completedRideSnapshot = {
        ...state,
        rideId,
        fare: sourceRealtime?.fare ?? fare ?? 0,
        paymentMethod,
        driverPaymentCollection: sourceRealtime?.driverPaymentCollection || state.driverPaymentCollection || null,
        pickup: pickupLabel,
        drop: dropLabel,
        driver,
        status: statusValue,
        liveStatus: statusValue,
        feedback: sourceRealtime?.feedback || state.feedback || null,
        arrivedAt: sourceRealtime?.arrivedAt || state.arrivedAt || '',
        completedAt: sourceRealtime?.completedAt || sourceRealtime?.arrivedAt || state.arrivedAt || Date.now(),
        waitingChargeAmount: sourceRealtime?.waitingChargeAmount ?? state.waitingChargeAmount ?? waitingCharge ?? 0,
        distanceChargeAmount: sourceRealtime?.distanceChargeAmount ?? state.distanceChargeAmount ?? 0,
        timeChargeAmount: sourceRealtime?.timeChargeAmount ?? state.timeChargeAmount ?? 0,
        baseFare: sourceRealtime?.baseFare ?? state.baseFare ?? fare ?? 0,
        additionalCharge: sourceRealtime?.additionalCharge ?? state.additionalCharge ?? 0,
        adminExtraCharge: sourceRealtime?.adminExtraCharge ?? state.adminExtraCharge ?? null,
        recovered_cancellation_due: sourceRealtime?.recovered_cancellation_due ?? state.recovered_cancellation_due ?? 0,
      };

      saveCurrentRide(completedRideSnapshot);
      navigate(routeComplete, {
        replace: true,
        state: completedRideSnapshot,
      });
    },
    [driver, dropLabel, fare, navigate, paymentMethod, pickupLabel, rideId, rideRealtime, routeComplete, state, waitingCharge],
  );

  useEffect(() => {
    latestCompleteTrackingRef.current = completeTracking;
  }, [completeTracking]);

  useEffect(() => {
    hasCompletedRedirectRef.current = false;
  }, [rideId]);

  useEffect(() => {
    let active = true;

    if (!rideId) {
      exitTracking();
      return () => {
        active = false;
      };
    }

    const hydrateRideState = async () => {
      try {
        const response = await api.get(`/rides/${rideId}`);
        const payload = unwrapApiPayload(response);
        const nextStatus = String(payload?.liveStatus || payload?.status || '').toLowerCase();

        if (!active) {
          return;
        }

        if (POST_RIDE_REDIRECT_STATUSES.has(nextStatus)) {
          const mergedDriver = mergeDriverSnapshot(fallbackDriver, payload?.driver || {});
          const updatedRealtime = {
            pickup: {
              coordinates: payload?.pickupLocation?.coordinates,
              address: payload?.pickupAddress || latestStateRef.current.pickup || 'Pickup',
            },
            drop: {
              coordinates: payload?.dropLocation?.coordinates,
              address: payload?.dropAddress || latestStateRef.current.drop || 'Drop',
            },
            driverLocation: payload?.lastDriverLocation
              ? { coordinates: payload.lastDriverLocation.coordinates }
              : null,
            status: nextStatus,
            fare: payload?.fare || latestStateRef.current.fare || 0,
            baseFare: payload?.baseFare || latestStateRef.current.baseFare || 0,
            waitingChargeAmount: payload?.waitingChargeAmount || latestStateRef.current.waitingChargeAmount || 0,
            distanceChargeAmount: payload?.distanceChargeAmount || latestStateRef.current.distanceChargeAmount || 0,
            additionalCharge: payload?.additionalCharge || latestStateRef.current.additionalCharge || 0,
            recovered_cancellation_due: payload?.recovered_cancellation_due || latestStateRef.current.recovered_cancellation_due || 0,
            paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
            vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
            vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
            scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
            otp: payload?.otp || latestStateRef.current.otp || latestStateRef.current.ride_otp || '',
            arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
            promo: payload?.promo || latestStateRef.current.promo || null,
            pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
            driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
            completedAt: payload?.completedAt || null,
            feedback: payload?.feedback || null,
            driver: mergedDriver,
          };
          setRideRealtime(updatedRealtime);
          completeTracking(nextStatus, updatedRealtime);
          return;
        }

        if (TERMINAL_STATUSES.has(nextStatus)) {
          if (COMPLETED_TRACKING_STATUSES.has(nextStatus)) {
            const mergedDriver = mergeDriverSnapshot(fallbackDriver, payload?.driver || {});
            const updatedRealtime = {
              pickup: {
                coordinates: payload?.pickupLocation?.coordinates,
                address: payload?.pickupAddress || latestStateRef.current.pickup || 'Pickup',
              },
              drop: {
                coordinates: payload?.dropLocation?.coordinates,
                address: payload?.dropAddress || latestStateRef.current.drop || 'Drop',
              },
              driverLocation: payload?.lastDriverLocation
                ? { coordinates: payload.lastDriverLocation.coordinates }
                : null,
              status: nextStatus,
              fare: payload?.fare || latestStateRef.current.fare || 0,
              baseFare: payload?.baseFare || latestStateRef.current.baseFare || 0,
              waitingChargeAmount: payload?.waitingChargeAmount || latestStateRef.current.waitingChargeAmount || 0,
              distanceChargeAmount: payload?.distanceChargeAmount || latestStateRef.current.distanceChargeAmount || 0,
              additionalCharge: payload?.additionalCharge || latestStateRef.current.additionalCharge || 0,
              recovered_cancellation_due: payload?.recovered_cancellation_due || latestStateRef.current.recovered_cancellation_due || 0,
              paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
              vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
              vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
              scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
              otp: payload?.otp || latestStateRef.current.otp || latestStateRef.current.ride_otp || '',
              arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
              promo: payload?.promo || latestStateRef.current.promo || null,
              pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
              driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
              completedAt: payload?.completedAt || null,
              feedback: payload?.feedback || null,
              driver: mergedDriver,
            };
            setRideRealtime(updatedRealtime);
            completeTracking(nextStatus, updatedRealtime);
            return;
          }
          exitTracking();
          return;
        }

        const mergedDriver = mergeDriverSnapshot(fallbackDriver, payload?.driver || {});

        setRideRealtime({
          pickup: {
            coordinates: payload?.pickupLocation?.coordinates,
            address: payload?.pickupAddress || latestStateRef.current.pickup || 'Pickup',
          },
          drop: {
            coordinates: payload?.dropLocation?.coordinates,
            address: payload?.dropAddress || latestStateRef.current.drop || 'Drop',
          },
          driverLocation: payload?.lastDriverLocation
            ? {
              coordinates: payload.lastDriverLocation.coordinates,
              heading: payload.lastDriverLocation.heading,
            }
            : null,
          status: payload?.liveStatus || payload?.status || 'accepted',
          fare: payload?.fare || latestStateRef.current.fare || 0,
          baseFare: payload?.baseFare || latestStateRef.current.baseFare || 0,
          waitingChargeAmount: payload?.waitingChargeAmount || latestStateRef.current.waitingChargeAmount || 0,
          distanceChargeAmount: payload?.distanceChargeAmount || latestStateRef.current.distanceChargeAmount || 0,
          paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
          vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
          vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
          scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
          otp: payload?.otp || latestStateRef.current.otp || latestStateRef.current.ride_otp || '',
          arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
          promo: payload?.promo || latestStateRef.current.promo || null,
          pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
          driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
          completedAt: payload?.completedAt || null,
          feedback: payload?.feedback || null,
          driver: mergedDriver,
        });

        saveCurrentRide({
          ...latestStateRef.current,
          rideId,
          driver: mergedDriver,
          status: payload?.status || latestStateRef.current.status || 'accepted',
          liveStatus: payload?.liveStatus || payload?.status || latestStateRef.current.liveStatus || latestStateRef.current.status || 'accepted',
          scheduledAt: payload?.scheduledAt || latestStateRef.current.scheduledAt || null,
          arrivedAt: payload?.arrivedAt || latestStateRef.current.arrivedAt || '',
          promo: payload?.promo || latestStateRef.current.promo || null,
          pricingSnapshot: payload?.pricingSnapshot || latestStateRef.current.pricingSnapshot || null,
          driverPaymentCollection: payload?.driverPaymentCollection || latestStateRef.current.driverPaymentCollection || null,
        });

        if (payload?.poolGroupId) {
          api.get(`/rides/pooling/group/${payload.poolGroupId}`)
            .then(res => {
              if (active) {
                setPoolGroup(res.data?.data || null);
              }
            })
            .catch(() => {});
        }
      } catch {
        // Let the active-ride validator decide whether the ride ended or the fetch was transient.
      }
    };

    const validateActiveRide = async () => {
      try {
        const activePayload = unwrapApiPayload(await api.get(activeRideEndpoint));
        const activeRideId = String(activePayload?.rideId || '');
        const activeStatus = String(activePayload?.liveStatus || activePayload?.status || '').toLowerCase();

        if (TERMINAL_STATUSES.has(activeStatus)) {
          if (active) {
            if (COMPLETED_TRACKING_STATUSES.has(activeStatus)) {
              completeTracking(activeStatus);
            } else {
              exitTracking();
            }
          }
          return false;
        }

        const currentLocalStatus = String(latestTripStatusRef.current || '').toLowerCase();
        if (!activeRideId || activeRideId !== String(rideId) || activeStatus !== currentLocalStatus) {
          await hydrateRideState().catch(() => { });
          return false;
        }

        return true;
      } catch (err) {
        console.error('Active ride validation failed:', err);
        await hydrateRideState().catch(() => { });
        return false;
      }
    };

    hydrateRideState();
    const validationInterval = window.setInterval(() => {
      validateActiveRide().catch(() => { });
    }, ACTIVE_RIDE_VALIDATE_MS);

    return () => {
      active = false;
      window.clearInterval(validationInterval);
    };
  }, [activeRideEndpoint, rideId]); // Removed unstable dependencies (completeTracking, exitTracking, etc.) to stop infinite loop

  useEffect(() => {
    if (!TERMINAL_STATUSES.has(tripStatus)) {
      return;
    }

    if (COMPLETED_TRACKING_STATUSES.has(tripStatus)) {
      if (!hasCompletedRedirectRef.current) {
        hasCompletedRedirectRef.current = true;
        completeTracking(tripStatus);
      }
      return;
    }

    clearCurrentRide();
    const timeoutId = window.setTimeout(() => {
      navigate(routeHome, { replace: true });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, routeHome, tripStatus]);

  useEffect(() => {
    if (!rideId) {
      return () => { };
    }

    const socket = socketService.connect({ role: 'user' });

    if (!socket) {
      return () => { };
    }

    const onRideState = (payload) => {
      if (!payload || String(payload.rideId || '') !== String(rideId)) {
        return;
      }

      const nextStatus = String(payload.liveStatus || payload.status || 'accepted').toLowerCase();

      const latestState = latestStateRef.current;
      const latestFallbackDriver = latestFallbackDriverRef.current;

      setRideRealtime((prev) => ({
        pickup: {
          coordinates: payload.pickupLocation?.coordinates,
          address: payload.pickupAddress || latestState.pickup || 'Pickup',
        },
        drop: {
          coordinates: payload.dropLocation?.coordinates,
          address: payload.dropAddress || latestState.drop || 'Drop',
        },
        driverLocation: payload.lastDriverLocation
          ? {
            coordinates: payload.lastDriverLocation.coordinates,
            heading: payload.lastDriverLocation.heading,
          }
          : null,
        status: payload.liveStatus || payload.status || 'accepted',
        fare: payload.fare || prev?.fare || latestState.fare || 0,
        paymentMethod: payload.paymentMethod || prev?.paymentMethod || latestState.paymentMethod || 'Cash',
        vehicleIconType: payload.vehicleIconType || prev?.vehicleIconType || latestState.vehicleIconType || '',
        vehicleIconUrl: payload.vehicleIconUrl || prev?.vehicleIconUrl || latestState.vehicleIconUrl || '',
        scheduledAt: payload.scheduledAt || prev?.scheduledAt || latestState.scheduledAt || null,
        otp: payload.otp || prev?.otp || latestState.otp || latestState.ride_otp || '',
        arrivedAt: payload.arrivedAt || prev?.arrivedAt || latestState.arrivedAt || '',
        promo: payload.promo || prev?.promo || latestState.promo || null,
        pricingSnapshot: payload.pricingSnapshot || prev?.pricingSnapshot || latestState.pricingSnapshot || null,
        driverPaymentCollection: payload.driverPaymentCollection || prev?.driverPaymentCollection || latestState.driverPaymentCollection || null,
        completedAt: payload.completedAt || null,
        feedback: payload.feedback || null,
        baseFare: payload.baseFare ?? prev?.baseFare ?? latestState.baseFare ?? 0,
        waitingChargeAmount: payload.waitingChargeAmount ?? prev?.waitingChargeAmount ?? latestState.waitingChargeAmount ?? 0,
        distanceChargeAmount: payload.distanceChargeAmount ?? prev?.distanceChargeAmount ?? latestState.distanceChargeAmount ?? 0,
        timeChargeAmount: payload.timeChargeAmount ?? prev?.timeChargeAmount ?? latestState.timeChargeAmount ?? 0,
        additionalCharge: payload.additionalCharge ?? prev?.additionalCharge ?? latestState.additionalCharge ?? 0,
        recovered_cancellation_due: payload.recovered_cancellation_due ?? prev?.recovered_cancellation_due ?? latestState.recovered_cancellation_due ?? 0,
        driver: mergeDriverSnapshot(prev?.driver || latestFallbackDriver, payload.driver || {}),
      }));

      if (POST_RIDE_REDIRECT_STATUSES.has(nextStatus)) {
        const realtimeSnapshot = {
          pickup: {
            coordinates: payload.pickupLocation?.coordinates,
            address: payload.pickupAddress || latestState.pickup || 'Pickup',
          },
          drop: {
            coordinates: payload.dropLocation?.coordinates,
            address: payload.dropAddress || latestState.drop || 'Drop',
          },
          driverLocation: payload.lastDriverLocation
            ? {
              coordinates: payload.lastDriverLocation.coordinates,
              heading: payload.lastDriverLocation.heading,
            }
            : null,
          status: nextStatus,
          fare: payload.fare || latestState.fare || 0,
          paymentMethod: payload.paymentMethod || latestState.paymentMethod || 'Cash',
          vehicleIconType: payload.vehicleIconType || latestState.vehicleIconType || '',
          vehicleIconUrl: payload.vehicleIconUrl || latestState.vehicleIconUrl || '',
          scheduledAt: payload.scheduledAt || latestState.scheduledAt || null,
          otp: payload.otp || latestState.otp || latestState.ride_otp || '',
          arrivedAt: payload.arrivedAt || latestState.arrivedAt || '',
          promo: payload.promo || latestState.promo || null,
          pricingSnapshot: payload.pricingSnapshot || latestState.pricingSnapshot || null,
          driverPaymentCollection: payload.driverPaymentCollection || latestState.driverPaymentCollection || null,
          completedAt: payload.completedAt || null,
          feedback: payload.feedback || null,
          baseFare: payload.baseFare ?? latestState.baseFare ?? 0,
          waitingChargeAmount: payload.waitingChargeAmount ?? latestState.waitingChargeAmount ?? 0,
          distanceChargeAmount: payload.distanceChargeAmount ?? latestState.distanceChargeAmount ?? 0,
          timeChargeAmount: payload.timeChargeAmount ?? latestState.timeChargeAmount ?? 0,
          additionalCharge: payload.additionalCharge ?? latestState.additionalCharge ?? 0,
          recovered_cancellation_due: payload.recovered_cancellation_due ?? latestState.recovered_cancellation_due ?? 0,
          driver: mergeDriverSnapshot(latestFallbackDriver, payload.driver || {}),
        };
        setRideRealtime(realtimeSnapshot);
        latestCompleteTrackingRef.current(nextStatus, realtimeSnapshot);
        return;
      }

      if (nextStatus === 'cancelled') {
        clearCurrentRide();
      }
    };

    const onLocationUpdated = (payload) => {
      if (!payload || String(payload.rideId || '') !== String(rideId)) {
        return;
      }

      setRideRealtime((prev) => ({
        ...(prev || {}),
        driverLocation: {
          coordinates: payload.coordinates,
          heading: payload.heading ?? prev?.driverLocation?.heading ?? null,
        },
      }));
    };

    const onStatusUpdated = (payload) => {
      if (!payload || String(payload.rideId || '') !== String(rideId)) {
        return;
      }

      const nextStatus = payload.liveStatus || payload.status || 'accepted';
      const normalizedStatus = String(nextStatus).toLowerCase();

      if (POST_RIDE_REDIRECT_STATUSES.has(normalizedStatus)) {
        setRideRealtime((prev) => {
          const updated = {
            ...(prev || {}),
            status: normalizedStatus,
            arrivedAt: payload.arrivedAt || prev?.arrivedAt || null,
            driverPaymentCollection: payload.driverPaymentCollection || prev?.driverPaymentCollection || null,
            completedAt: payload.completedAt || prev?.completedAt || null,
            fare: payload.fare ?? prev?.fare ?? null,
            baseFare: payload.baseFare ?? prev?.baseFare ?? null,
            waitingChargeAmount: payload.waitingChargeAmount ?? prev?.waitingChargeAmount ?? null,
            distanceChargeAmount: payload.distanceChargeAmount ?? prev?.distanceChargeAmount ?? null,
            timeChargeAmount: payload.timeChargeAmount ?? prev?.timeChargeAmount ?? null,
          };
          latestCompleteTrackingRef.current(normalizedStatus, updated);
          return updated;
        });
        return;
      }

      if (normalizedStatus === 'cancelled') {
        clearCurrentRide();
      } else {
        const latestState = latestStateRef.current;
        saveCurrentRide({
          ...latestState,
          rideId,
          driver: latestDriverRef.current,
          status: nextStatus,
          scheduledAt: payload.scheduledAt || latestState.scheduledAt || null,
          arrivedAt: payload.arrivedAt || latestState.arrivedAt || '',
          promo: payload.promo || latestState.promo || null,
          pricingSnapshot: payload.pricingSnapshot || latestState.pricingSnapshot || null,
          driverPaymentCollection: payload.driverPaymentCollection || latestState.driverPaymentCollection || null,
        });
      }

      setRideRealtime((prev) => ({
        ...(prev || {}),
        status: nextStatus,
        scheduledAt: payload.scheduledAt || prev?.scheduledAt || latestStateRef.current.scheduledAt || null,
        arrivedAt: payload.arrivedAt || prev?.arrivedAt || '',
        promo: payload.promo || prev?.promo || null,
        pricingSnapshot: payload.pricingSnapshot || prev?.pricingSnapshot || null,
        driverPaymentCollection: payload.driverPaymentCollection || prev?.driverPaymentCollection || null,
        completedAt: payload.completedAt || prev?.completedAt || null,
        fare: payload.fare ?? prev?.fare ?? latestStateRef.current.fare ?? 0,
        baseFare: payload.baseFare ?? prev?.baseFare ?? latestStateRef.current.baseFare ?? 0,
        waitingChargeAmount: payload.waitingChargeAmount ?? prev?.waitingChargeAmount ?? latestStateRef.current.waitingChargeAmount ?? 0,
        distanceChargeAmount: payload.distanceChargeAmount ?? prev?.distanceChargeAmount ?? latestStateRef.current.distanceChargeAmount ?? 0,
        timeChargeAmount: payload.timeChargeAmount ?? prev?.timeChargeAmount ?? latestStateRef.current.timeChargeAmount ?? 0,
      }));
    };

    const onPoolUpdated = (payload) => {
      setPoolGroup(payload);
    };

    socketService.on('ride:state', onRideState);
    socketService.on('ride:driver-location:updated', onLocationUpdated);
    socketService.on('ride:status:updated', onStatusUpdated);
    socketService.on('pool.updated', onPoolUpdated);
    socketService.on('route.updated', onPoolUpdated);
    socketService.emit('ride:join', { rideId });

    return () => {
      socketService.off('ride:state', onRideState);
      socketService.off('ride:driver-location:updated', onLocationUpdated);
      socketService.off('ride:status:updated', onStatusUpdated);
      socketService.off('pool.updated', onPoolUpdated);
      socketService.off('route.updated', onPoolUpdated);
    };
  }, [rideId]);

  useEffect(() => {
    if (isScheduledUpcoming && !hasLiveDriverLocation) {
      setRoutePath([]);
      setRouteError('');
      return;
    }

    if (!isLoaded || !window.google?.maps?.DirectionsService) {
      setRoutePath([driverPosition, activeDestination]);
      setRouteError('');
      return;
    }

    if (arePositionsNearlyEqual(driverPosition, activeDestination)) {
      setRoutePath([driverPosition]);
      setRouteError('');
      return;
    }

    let active = true;
    const directionsService = new window.google.maps.DirectionsService();

    directionsService.route(
      {
        origin: driverPosition,
        destination: activeDestination,
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

        setRoutePath([driverPosition, activeDestination]);
        setRouteError(status || 'Directions unavailable');
      },
    );

    return () => {
      active = false;
    };
  }, [activeDestination, driverPosition, hasLiveDriverLocation, isLoaded, isScheduledUpcoming]);

  useEffect(() => {
    if (!map || !window.google?.maps) {
      return;
    }

    if (routePath.length > 1) {
      if (!hasAutoFramedMapRef.current) {
        const bounds = new window.google.maps.LatLngBounds();
        routePath.forEach((point) => bounds.extend(point));
        bounds.extend(driverPosition);
        bounds.extend(activeDestination);
        map.fitBounds(bounds, { top: 120, right: 48, bottom: 300, left: 48 });
        hasAutoFramedMapRef.current = true;
        lastMapPanPositionRef.current = driverPosition;
        return;
      }

      lastMapPanPositionRef.current = driverPosition;
      return;
    }

    if (!hasAutoFramedMapRef.current) {
      map.panTo(driverPosition);
      map.setZoom(15);
      hasAutoFramedMapRef.current = true;
      lastMapPanPositionRef.current = driverPosition;
      return;
    }

    lastMapPanPositionRef.current = driverPosition;
  }, [activeDestination, driverPosition, map, routePath, tripStatus]);

  const handleShare = async () => {
    const text = buildRideShareText({
      appName,
      driverName: driver.name,
      vehicleNumber: driver.plate || driver.vehicleNumber,
      pickupLabel,
      dropLabel,
    });

    if (navigator.share) {
      try {
        await navigator.share({ title: `Track My Ride - ${appName}`, text });
        setShareSheetOpen(false);
        return;
      } catch (_error) {
        // Fall through to the explicit share options below.
      }
    }

    setShareSheetOpen(true);
  };

  const handleCopyShareText = () => {
    const text = buildRideShareText({
      appName,
      driverName: driver.name,
      vehicleNumber: driver.plate || driver.vehicleNumber,
      pickupLabel,
      dropLabel,
    });

    navigator.clipboard?.writeText(text).then(() => {
      setShareToast(true);
      setShareSheetOpen(false);
      setTimeout(() => setShareToast(false), 2500);
    });
  };

  const handleCallDriver = () => {
    const phone = String(driver.phone || driver.mobile || driver.phoneNumber || '').replace(/[^\d+]/g, '');

    if (!phone) {
      window.alert('Driver phone number is not available yet.');
      return;
    }

    window.open(`tel:${phone}`, '_self');
  };

  const openRideChat = () => {
    navigate(routeChat, {
      state: {
        rideId,
        peer: {
          name: driver.name || 'Driver',
          phone: driver.phone || driver.mobile || driver.phoneNumber || '',
          subtitle: 'Driver - Active now',
          role: 'Driver',
        },
      },
    });
  };

  const ActionBtn = ({ icon: Icon, label, onClick, colorClass }) => (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-[14px] border border-slate-100 bg-slate-50/80 transition-all ${colorClass || ''}`}
    >
      <Icon size={17} className="text-slate-700" strokeWidth={2} />
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
    </motion.button>
  );

  return (
    <div className="min-h-screen bg-gray-100 max-w-lg mx-auto relative font-sans overflow-hidden">
      <AnimatePresence>
        {shareToast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] bg-[#0F766E] text-white px-5 py-3 rounded-[14px] text-[12px] font-black shadow-xl whitespace-nowrap"
          >
            Ride details copied!
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shareSheetOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] flex items-end justify-center bg-slate-950/45 px-4 pb-5 pt-12"
            onClick={() => setShareSheetOpen(false)}
          >
            <motion.div
              initial={{ y: 48, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 48, opacity: 0 }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl"
            >
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Share Ride</p>
              <h3 className="mt-2 text-[20px] font-black tracking-tight text-[#0F766E]">Send trip details</h3>
              <p className="mt-1 text-[12px] font-bold text-slate-500">Choose how you want to share this ongoing ride.</p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {navigator.share ? (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                  >
                    <p className="text-[13px] font-black text-[#0F766E]">System share</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">Open phone share apps</p>
                  </button>
                ) : null}
                <a
                  href={buildShareLinks(buildRideShareText({
                    appName,
                    driverName: driver.name,
                    vehicleNumber: driver.plate || driver.vehicleNumber,
                    pickupLabel,
                    dropLabel,
                  })).whatsapp}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                >
                  <p className="text-[13px] font-black text-[#0F766E]">WhatsApp</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">Share in chat</p>
                </a>
                <a
                  href={buildShareLinks(buildRideShareText({
                    appName,
                    driverName: driver.name,
                    vehicleNumber: driver.plate || driver.vehicleNumber,
                    pickupLabel,
                    dropLabel,
                  })).sms}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                >
                  <p className="text-[13px] font-black text-[#0F766E]">SMS</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">Open messages</p>
                </a>
                <button
                  type="button"
                  onClick={handleCopyShareText}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-left"
                >
                  <p className="text-[13px] font-black text-[#0F766E]">Copy details</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">Copy to clipboard</p>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShareSheetOpen(false)}
                className="mt-4 h-12 w-full rounded-[18px] bg-[#0F766E] text-[12px] font-black uppercase tracking-[0.16em] text-white"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0 z-0 bg-slate-200">
        {!HAS_VALID_GOOGLE_MAPS_KEY ? (
          <div className="flex h-full w-full items-center justify-center bg-slate-200 px-6 text-center">
            <div className="rounded-[18px] bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-[12px] font-bold text-[#0F766E]">Google Maps key missing</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">Set `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`.</p>
            </div>
          </div>
        ) : loadError ? (
          <div className="flex h-full w-full items-center justify-center bg-slate-200 px-6 text-center">
            <div className="rounded-[18px] bg-white/90 px-4 py-4 shadow-sm">
              <p className="text-[12px] font-bold text-[#0F766E]">Google Maps failed to load</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">Check the browser key restrictions and reload.</p>
            </div>
          </div>
        ) : isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={driverPosition}
            zoom={14}
            onLoad={setMap}
            onUnmount={() => setMap(null)}
            options={{
              disableDefaultUI: true,
              zoomControl: true,
              clickableIcons: false,
              streetViewControl: false,
              fullscreenControl: false,
              mapTypeControl: false,
              gestureHandling: 'greedy',
            }}
          >
            {routePath.length > 1 && hasLiveDriverLocation && (
              <>
                <PolylineF
                  path={routePath}
                  options={{
                    strokeColor: '#000000',
                    strokeOpacity: 0.16,
                    strokeWeight: 9,
                    zIndex: 10,
                  }}
                />
                <PolylineF
                  path={routePath}
                  options={{
                    strokeColor: '#0F766E',
                    strokeOpacity: 0.95,
                    strokeWeight: 5,
                    zIndex: 20,
                  }}
                />
              </>
            )}
            {hasLiveDriverLocation ? (
              <RotatingVehicleMarker
                position={driverPosition}
                title="Driver"
                iconUrl={vehicleIcon}
                heading={displayDriverHeading}
              />
            ) : null}
            <MarkerF
              position={activeDestination}
              title={['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus) ? 'Drop' : 'Pickup'}
              icon={{
                path: window.google.maps.SymbolPath.CIRCLE,
                fillColor: ['started', 'ongoing', 'arrived', 'completed'].includes(tripStatus) ? '#ef4444' : '#10b981',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
                scale: 7,
              }}
            />
          </GoogleMap>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-slate-200">
            <div className="rounded-[16px] bg-white/90 px-4 py-3 shadow-sm text-[12px] font-bold text-slate-700">
              Loading map
            </div>
          </div>
        )}
      </div>

      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => navigate(routeHome)}
        className="absolute top-8 left-4 z-10 w-10 h-10 bg-white/90 backdrop-blur-md rounded-[12px] shadow-[0_4px_14px_rgba(15,23,42,0.10)] border border-white/80 flex items-center justify-center"
      >
        <ChevronLeft size={18} className="text-[#0F766E]" strokeWidth={2.5} />
      </motion.button>

      <div className="absolute top-8 left-16 right-4 z-10 bg-white/90 backdrop-blur-md rounded-[14px] px-3.5 py-2.5 shadow-[0_4px_14px_rgba(15,23,42,0.08)] border border-white/80">
        <p className="text-[11px] font-black text-slate-500 truncate">{pickupLabel} → {dropLabel}</p>
      </div>

      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => navigate(routeSos)}
        className="absolute top-24 right-4 z-10 bg-white/90 backdrop-blur-md px-3.5 py-2 rounded-full border border-white/80 shadow-[0_4px_14px_rgba(15,23,42,0.08)] flex items-center gap-1.5"
      >
        <Shield size={13} className="text-blue-500" strokeWidth={2.5} />
        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Safety</span>
      </motion.button>

      {routeError && (
        <div className="absolute top-24 left-4 z-10 rounded-[12px] border border-amber-100 bg-white/90 px-3 py-2 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Route</p>
          <p className="text-[11px] font-bold text-slate-700">Using fallback path while directions load.</p>
        </div>
      )}

      {isScheduledUpcoming ? (
        <div className="absolute top-[132px] left-4 right-4 z-10 rounded-[18px] border border-emerald-100 bg-white/92 px-4 py-3 shadow-[0_10px_28px_rgba(16,185,129,0.12)] backdrop-blur-md">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Scheduled ride</p>
              <p className="mt-1 text-[15px] font-black tracking-tight text-slate-950">{scheduledDateLabel}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                {hasLiveDriverLocation
                  ? 'Your driver has started sharing location for this pickup.'
                  : 'Driver assigned. We will light up live movement here as pickup time gets closer.'}
              </p>
            </div>
            <div className="rounded-[16px] bg-emerald-50 px-3 py-2 text-right">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700">Countdown</p>
              <p className="mt-1 text-[13px] font-black text-slate-950">{scheduledCountdown || 'Ready'}</p>
            </div>
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {!drawerOpen && (
          <motion.button
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            onClick={() => setDrawerOpen(true)}
            className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-slate-900 text-white px-5 py-3 rounded-full shadow-xl border border-white/10"
          >
            <ChevronLeft size={16} strokeWidth={3} className="rotate-90 text-emerald-400" />
            <span className="text-[12px] font-black uppercase tracking-widest">View Ride Info</span>
          </motion.button>
        )}
      </AnimatePresence>

      <motion.div
        animate={{ y: drawerOpen ? 0 : "100%" }}
        className="absolute bottom-0 left-0 right-0 bg-white shadow-[0_-12px_44px_rgba(15,23,42,0.12)] z-20 rounded-t-[28px] border-t border-slate-100/50"
      >
        {/* Floating SOS on card edge */}
        {['started', 'ongoing', 'arrived'].includes(tripStatus) && (
          <FloatingSOS 
            rideId={rideId} 
            driverId={driver?._id || driver?.id} 
            location={driverPosition} 
            rideStatus={tripStatus} 
          />
        )}
        <div className="relative flex justify-center items-center mt-2.5 mb-3.5">
          <div className="w-12 h-1.5 bg-slate-200/60 rounded-full cursor-pointer hover:bg-slate-300 transition-colors" onClick={() => setDrawerOpen(!drawerOpen)} />
          <button 
            onClick={() => setDrawerOpen(!drawerOpen)} 
            className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            {drawerOpen ? <X size={14} strokeWidth={3} /> : <ChevronLeft size={14} strokeWidth={3} className="rotate-90" />}
          </button>
        </div>

        <div className="px-4 pb-6 space-y-3.5">
          {/* Header Section: Driver & OTP */}
          <div className="flex items-start justify-between">
            <div className="flex gap-3 min-w-0">
              <div className="relative shrink-0">
                <div className="w-[62px] h-[62px] rounded-[20px] bg-[#1d2333] overflow-hidden shadow-[0_8px_20px_rgba(15,23,42,0.15)]">
                  {driverImage ? (
                    <img
                      src={driverImage}
                      className="w-full h-full object-cover opacity-90"
                      alt={driver.name || 'Driver'}
                      onError={() => setDriverImageBroken(true)}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[21px] font-black text-white/90">
                      {getInitials(driver.name)}
                    </div>
                  )}
                </div>
                {/* Car Badge */}
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-lg bg-[#111827] border-2 border-white flex items-center justify-center shadow-md">
                  <img src={vehicleIcon} alt="Vehicle icon" className="h-3.5 w-3.5 object-contain brightness-0 invert" draggable={false} />
                </div>
                {/* Rating Badge */}
                <div className="absolute -bottom-1 -right-1 bg-yellow-400 px-1.5 py-0.5 rounded-full border-2 border-white flex items-center gap-0.5 shadow-md">
                  <Star size={9} className="text-[#0F766E] fill-slate-900" />
                  <span className="text-[9px] font-black text-[#0F766E]">{driver.rating || '4.9'}</span>
                </div>
              </div>

              <div className="min-w-0 pt-0.5">
                <h3 className="truncate text-[17px] font-black text-[#0F766E] leading-tight tracking-tight">
                  {driver.name || 'James Bond'}
                </h3>
                <p className="text-[13px] font-black text-[#f97316] mt-1 tracking-tight">
                  {tripStatus === 'arrived' ? 'Reached destination' : tripStatus === 'started' || tripStatus === 'ongoing' ? 'Trip started' : driverSubtitle}
                </p>
                <p className="truncate text-[11px] font-bold text-slate-400 mt-0.5 uppercase tracking-[0.14em]">
                  {driver.plate || 'MH12AB1234'} &middot; {vehicleLabel}
                </p>
              </div>
            </div>

            {/* OTP CARD - High Fidelity */}
            {otp && (
              <div className="bg-[#fff9ef] border border-[#fef3c7] rounded-[20px] px-3 py-3 flex flex-col items-center justify-center min-w-[80px] shadow-sm">
                <span className="text-[9px] font-black text-primary-orange/50 uppercase tracking-[0.18em] mb-1 leading-none">OTP</span>
                <span className="text-[18px] font-black text-[#0F766E] tracking-tighter leading-none">{otp}</span>
              </div>
            )}
          </div>

          {isScheduledRide ? (
            <div className="rounded-[22px] border border-emerald-100 bg-emerald-50/70 px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-700">Trip plan</p>
                  <p className="mt-1 text-[15px] font-black text-slate-950">{scheduledDateLabel}</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-500">
                    {isScheduledUpcoming
                      ? 'We will switch from booking mode to live pickup tracking automatically as your slot approaches.'
                      : 'Your scheduled ride is now in its live service window.'}
                  </p>
                </div>
                <div className="rounded-[16px] bg-white px-3 py-2 text-right shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Status</p>
                  <p className="mt-1 text-[13px] font-black text-slate-950">{isScheduledUpcoming ? scheduledCountdown || 'Ready' : 'Live now'}</p>
                </div>
              </div>
            </div>
          ) : null}

          {isWaitingForOtp && (
            <div className={`rounded-[24px] border px-4 py-4 shadow-sm ${waitingCharge > 0 ? 'border-rose-100 bg-rose-50/70' : 'border-amber-100 bg-amber-50/70'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ${waitingCharge > 0 ? 'text-rose-500' : 'text-amber-500'}`}>
                    <Clock3 size={18} strokeWidth={2.5} />
                  </div>
                  <div>
                    <p className={`text-[9px] font-black uppercase tracking-[0.22em] ${waitingCharge > 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {waitingCharge > 0 ? 'Paid Waiting' : 'Free Waiting'}
                    </p>
                    <p className="mt-1 text-[22px] font-black tracking-tight text-[#0F766E]">
                      {formatTimerClock(waitingCharge > 0 ? waitingElapsedSeconds - (freeWaitingBeforeMinutes * 60) : waitingElapsedSeconds)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  {waitingCharge > 0 ? (
                    <>
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-rose-500">Added to Bill</p>
                      <p className="mt-1 text-[18px] font-black text-rose-700">+Rs {waitingCharge}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Free Left</p>
                      <p className="mt-1 text-[13px] font-black text-[#0F766E]">{formatTimerClock(freeWaitingRemainingSeconds)}</p>
                    </>
                  )}
                </div>
              </div>
              <div className={`mt-4 grid gap-3 ${waitingCharge > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Free Before</p>
                  <p className="mt-1 text-[13px] font-black text-[#0F766E]">{formatWholeMinutes(freeWaitingBeforeMinutes)}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Rate</p>
                  <p className="mt-1 text-[13px] font-black text-[#0F766E]">Rs {waitingChargePerMinute}/min</p>
                </div>
                {waitingCharge > 0 && (
                  <div className="rounded-2xl bg-amber-100 px-3 py-3 shadow-sm border border-amber-200/60">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-600">Billed Mins</p>
                    <p className="mt-1 text-[13px] font-black text-amber-800">{waitingChargeableMinutes} min</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {stopsTimelineElement}

          {/* Pricing Policy Card */}
          {(waitingPricing?.percentage_cancellation_charge > 0 || waitingPricing?.fixed_cancellation_charge > 0 || waitingPricing?.user_cancellation_fee > 0 || waitingPricing?.waiting_charge > 0) && (
            <div className="rounded-[22px] border border-slate-100 bg-slate-50/50 p-4 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400 mb-2">Ride Rules & Pricing Policies</p>
              <div className="grid grid-cols-2 gap-3 text-[11px] font-bold text-slate-600">
                {(waitingPricing?.percentage_cancellation_charge > 0 || waitingPricing?.fixed_cancellation_charge > 0 || waitingPricing?.user_cancellation_fee > 0) && (
                  <div className="bg-white p-3 rounded-2xl border border-slate-100/50 shadow-sm flex flex-col justify-center gap-1">
                    <div className="flex items-center justify-between">
                      <span>Cancellation Fee</span>
                      <span className="font-black text-[#0F766E]">
                        {waitingPricing.user_cancellation_fee_type === 'percentage'
                          ? `${waitingPricing.percentage_cancellation_charge || waitingPricing.user_cancellation_fee || 0}%`
                          : `Rs ${waitingPricing.fixed_cancellation_charge || waitingPricing.user_cancellation_fee || 0}`}
                      </span>
                    </div>
                    <span className="text-[8.5px] font-medium leading-tight text-slate-400 mt-0.5">Will be added to your next ride</span>
                  </div>
                )}
                {waitingPricing?.waiting_charge > 0 && (
                  <div className="bg-white p-3 rounded-2xl border border-slate-100/50 shadow-sm flex items-center justify-between">
                    <span>Waiting Charge</span>
                    <span className="font-black text-[#0F766E]">Rs {waitingPricing.waiting_charge}/min</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Detailed Vehicle Status Card - High Fidelity */}
          <div className="flex items-center gap-3 rounded-[22px] bg-slate-50/40 border border-slate-50/80 px-3 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.02)]">
            <div className="w-12 h-12 shrink-0 flex items-center justify-center rounded-[16px] bg-white shadow-sm border border-slate-100/50 overflow-hidden p-2">
              {hasVehiclePhoto ? (
                <img
                  src={vehicleImage}
                  alt={vehicleLabel}
                  className="w-full h-full object-contain"
                  onError={() => setVehicleImageBroken(true)}
                />
              ) : vehicleIcon ? (
                <img src={vehicleIcon} alt={vehicleLabel} className="h-6 w-6 object-contain opacity-60" />
              ) : (
                <span className="text-2xl select-none">
                  {serviceType === 'parcel' ? '📦' : '🚗'}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 mb-0.5">Vehicle</p>
              <p className="text-[15px] font-black text-[#0F766E] leading-tight truncate">{vehicleLabel}</p>
              <p className="text-[12px] font-bold text-slate-500 mt-0.5 truncate">{vehicleDetails || 'Blue'}</p>
            </div>
          </div>

          {/* High-Fidelity Action Grid */}
          <div className="grid grid-cols-4 gap-2.5">
            {[
              { id: 'call', icon: Phone, label: 'CALL', action: handleCallDriver },
              { id: 'chat', icon: MessageCircle, label: 'CHAT', action: openRideChat },
              { id: 'safety', icon: Shield, label: 'SAFETY', action: () => setSafetyToolkitOpen(true) },
              { id: 'help', icon: AlertTriangle, label: 'HELP', action: () => navigate(routeSupport) }
            ].map((btn) => (
              <motion.button
                key={btn.id}
                whileTap={{ scale: 0.94 }}
                onClick={btn.action}
                className="flex flex-col items-center gap-1.5 py-3 rounded-[18px] bg-white border border-slate-100/60 shadow-[0_2px_8px_rgba(15,23,42,0.03)] hover:bg-slate-50 transition-all duration-200"
              >
                <div className="p-0.5">
                  <btn.icon size={18} className="text-slate-800" strokeWidth={2} />
                </div>
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em] leading-none">{btn.label}</span>
              </motion.button>
            ))}
          </div>

          {/* Footer: Fare & Cancellation Section */}
          <div className="pt-2 border-t border-slate-50 space-y-3">
            {['started', 'ongoing', 'arrived'].includes(tripStatus) ? (
              // TRIP STARTED: Show Premium Detailed Bill Breakdown
              <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex justify-between items-center border-b border-slate-150 pb-2">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">
                      Active Trip Bill
                    </span>
                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mt-1">
                      Admin-Managed Charges
                    </span>
                  </div>
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider border shadow-sm animate-pulse ${tripStatus === 'arrived' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-250/50'}`}>
                    {tripStatus === 'arrived' ? 'Payment Pending' : 'In Trip'}
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-slate-500">Starting Base Fare</span>
                    <span className="font-bold text-[#0F766E]">Rs {Math.round(Number(trackingSnapshot.baseFare || fare || 0))}</span>
                  </div>
                  {waitingCharge > 0 && (
                    <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200/50">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-500">Waiting Charge</span>
                        <span className="font-bold text-[#0F766E]">Rs {waitingCharge}</span>
                      </div>
                    </div>
                  )}
                  {distanceChargeAmount > 0 && (
                    <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200/50">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-500">Extra Distance Charge</span>
                        <span className="font-bold text-[#0F766E]">Rs {distanceChargeAmount}</span>
                      </div>
                    </div>
                  )}
                  {timeChargeAmount > 0 && (
                    <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200/50">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-500">Extra Time Charge</span>
                        <span className="font-bold text-[#0F766E]">Rs {timeChargeAmount}</span>
                      </div>
                    </div>
                  )}
                  {additionalCharge > 0 && (
                    <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200/50">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-500">Additional Charge</span>
                        <span className="font-bold text-[#0F766E]">Rs {additionalCharge}</span>
                      </div>
                    </div>
                  )}
                  {adminExtraChargeAmount > 0 && (
                    <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200/50">
                      <div className="flex justify-between items-center text-xs text-amber-600">
                        <span className="font-semibold">Admin Extra Charge</span>
                        <span className="font-bold">Rs {adminExtraChargeAmount}</span>
                      </div>
                    </div>
                  )}
                  {waitingPricing?.ride_surge_enabled && waitingPricing?.ride_surge_amount > 0 && (
                    <div className="mt-2.5 space-y-2 pt-2.5 border-t border-slate-200/50">
                      <div className="flex justify-between items-center text-xs text-amber-600">
                        <span className="font-semibold">Surge Amount (Admin Configured)</span>
                        <span className="font-bold">+Rs {waitingPricing.ride_surge_amount}</span>
                      </div>
                    </div>
                  )}

                  {tripStatus === 'arrived' && (
                    <div className="mt-3 p-3 bg-amber-50/80 border border-amber-100 rounded-xl shadow-sm text-center">
                      <p className="text-[10.5px] font-black text-amber-700 uppercase tracking-wider leading-tight">
                        Reached Destination
                      </p>
                      <p className="text-[10px] font-bold text-amber-600/80 mt-1 uppercase tracking-wide">
                        Please pay the driver and wait for them to finalize the trip
                      </p>
                    </div>
                  )}

                  <div className="h-px bg-slate-200/60 my-1 mt-2.5" />

                  {trackingSnapshot.promo && trackingSnapshot.promo.discount_amount > 0 && (
                    <div className="flex justify-between items-center text-xs mb-2">
                      <div className="flex flex-col">
                        <span className="font-bold text-emerald-600">Promo Applied ({trackingSnapshot.promo.code})</span>
                        <span className="text-[9px] font-bold text-emerald-600/80 uppercase mt-0.5 tracking-wider">Discount Saved</span>
                      </div>
                      <span className="text-[14px] font-bold text-emerald-600">-Rs {trackingSnapshot.promo.discount_amount}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center text-xs">
                    <div className="flex flex-col">
                      <span className="font-extrabold text-[#0F766E]">Current Total Fare</span>
                      <span className="text-[9px] font-black text-slate-400 uppercase mt-0.5 tracking-wider">Payment via {paymentMethod}</span>
                    </div>
                    <span className="text-[18px] font-black text-slate-950">Rs {currentTotalFare}.00</span>
                  </div>
                </div>
              </div>
            ) : (
              // TRIP NOT STARTED: Show normal fare info and Cancel button
              <div className="flex items-end justify-between">
                <div className="space-y-0.5">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.18em] leading-none mb-1">
                    {waitingCharge > 0 ? 'Updated Bill' : 'Total Fare'}
                  </p>
                  <div className="flex items-center gap-2">
                    {trackingSnapshot.promo && trackingSnapshot.promo.discount_amount > 0 && (
                      <span className="text-[16px] font-bold text-slate-400 line-through tracking-tight leading-none">
                        Rs {currentTotalFare + trackingSnapshot.promo.discount_amount}
                      </span>
                    )}
                    <span className="text-[19px] font-black text-slate-950 tracking-tight leading-none">
                      Rs {currentTotalFare}.00
                    </span>
                    <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg uppercase tracking-wider border border-slate-200/50 shadow-sm">{paymentMethod}</span>
                    {waitingCharge > 0 && (
                      <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-2 py-1 rounded-lg uppercase tracking-wider border border-amber-200/50 shadow-sm animate-pulse">
                        +{waitingCharge} wait
                      </span>
                    )}
                  </div>

                  {trackingSnapshot.promo && trackingSnapshot.promo.discount_amount > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-emerald-600">Promo ({trackingSnapshot.promo.code}) Applied</span>
                      <span className="text-[10px] font-bold text-emerald-600/80">- Rs {trackingSnapshot.promo.discount_amount}</span>
                    </div>
                  )}

                  {waitingCharge > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-slate-400">Base Rs {Math.round(Number(trackingSnapshot.baseFare || fare || 0))}</span>
                      <span className="text-[10px] font-bold text-amber-600">+ Rs {waitingCharge} waiting</span>
                    </div>
                  )}
                </div>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setShowCancelConfirm(true)}
                  className="bg-white border-2 border-slate-50 text-red-500 font-black text-[11px] uppercase tracking-[0.16em] px-5 py-3 rounded-[18px] shadow-[0_8px_20px_rgba(239,68,68,0.08)] active:shadow-none hover:bg-red-50/10 transition-all"
                >
                  Cancel
                </motion.button>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showCancelConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowCancelConfirm(false);
                setShowReasonSelection(false);
              }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
            />
            {showReasonSelection ? (
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 40 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm bg-white rounded-[28px] p-7 z-[101] shadow-2xl text-center"
              >
                <h3 className="text-[17px] font-black text-[#0F766E] mb-4 uppercase tracking-wider">Select Reason</h3>
                <div className="space-y-2 text-left mb-6 max-h-[240px] overflow-y-auto pr-1">
                  {[
                    'Driver asked to cancel',
                    'Long waiting time',
                    'Wrong address shown',
                    'Changed my mind',
                    'Others'
                  ].map((reason) => (
                    <label key={reason} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 cursor-pointer border border-slate-100/60 transition-colors">
                      <input
                        type="radio"
                        name="cancel_reason"
                        checked={selectedReason === reason}
                        onChange={() => setSelectedReason(reason)}
                        className="h-4 w-4 text-[#0F766E] focus:ring-slate-900 border-gray-355"
                      />
                      <span className="text-[13px] font-semibold text-slate-700">{reason}</span>
                    </label>
                  ))}

                  {selectedReason === 'Others' && (
                    <input
                      type="text"
                      placeholder="Enter reason here..."
                      className="w-full mt-2 border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-slate-400"
                      value={otherReasonText}
                      onChange={(e) => setOtherReasonText(e.target.value)}
                    />
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowReasonSelection(false)}
                    className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider"
                  >
                    Back
                  </button>
                  <button
                    disabled={!selectedReason || (selectedReason === 'Others' && !otherReasonText)}
                    onClick={() => handleCancelRide()}
                    className="flex-1 py-3 bg-red-500 hover:bg-red-650 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg disabled:opacity-50"
                  >
                    Cancel Ride
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 40 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm bg-white rounded-[28px] p-7 z-[101] shadow-2xl text-center"
              >
                <div className="w-14 h-14 bg-red-50 rounded-[18px] flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle size={26} className="text-red-400" strokeWidth={2} />
                </div>
                <h3 className="text-[18px] font-black text-[#0F766E] mb-1.5">Cancel Ride?</h3>
                <p className="text-[13px] font-semibold text-slate-400 leading-relaxed mb-4">
                  Are you sure you want to cancel this ride?
                </p>
                {waitingPricing?.cancellation_policy_message ? (
                  <p className="text-[11px] font-semibold text-red-500 bg-red-50/50 rounded-xl p-3 mb-6 leading-relaxed text-left border border-red-100/30">
                    {waitingPricing.cancellation_policy_message}
                  </p>
                ) : (
                  <p className="text-[11px] font-semibold text-slate-400 mb-6 leading-relaxed">
                    Cancellation charges may apply based on the platform policy.
                  </p>
                )}
                <div className="space-y-2.5">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowCancelConfirm(false)}
                    className="w-full bg-[#00BFA5] text-white py-3.5 rounded-[16px] text-[13px] font-bold uppercase tracking-widest shadow-lg"
                  >
                    No, Keep Ride
                  </motion.button>
                  <button
                    onClick={() => {
                      if (waitingPricing.enable_cancellation_reasons) {
                        setShowReasonSelection(true);
                      } else {
                        handleCancelRide('User cancelled');
                      }
                    }}
                    className="w-full py-3 text-[13px] font-bold text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors"
                  >
                    Yes, Cancel Ride
                  </button>
                </div>
              </motion.div>
            )}
          </>
        )}

        {showCancellationBillModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseCancellationBill}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] max-w-lg mx-auto"
            />
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 40 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm bg-white rounded-[28px] p-7 z-[101] shadow-2xl"
            >
              <div className="w-14 h-14 bg-red-50 rounded-[18px] flex items-center justify-center mx-auto mb-4">
                <FileText size={26} className="text-red-500" strokeWidth={2} />
              </div>
              <h3 className="text-[18px] font-black text-[#0F766E] text-center mb-1.5">Cancellation Receipt</h3>
              <p className="text-[12px] font-bold text-slate-400 text-center mb-6">
                Your ride has been cancelled. Waiting time and cancellation fees are calculated below:
              </p>

              <div className="space-y-3.5 border-t border-b border-slate-100 py-4 mb-6">
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Standard Cancellation Fee</span>
                  <span className="text-slate-800">Rs {cancellationBill?.cancellationFee || 0}.00</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Waiting Time</span>
                  <span className="text-slate-800">{cancellationBill?.waitingTimeMinutes || 0} mins</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Waiting Charge</span>
                  <span className="text-slate-800">Rs {cancellationBill?.waitingCharge || 0}.00</span>
                </div>
                <div className="flex justify-between items-center pt-2.5 border-t border-slate-100/60 font-black text-[14px]">
                  <span className="text-[#0F766E]">Total Deducted</span>
                  <span className="text-red-500">Rs {cancellationBill?.totalCancellationFee || 0}.00</span>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleCloseCancellationBill}
                className="w-full bg-[#0F766E] text-white py-3.5 rounded-[16px] text-[13px] font-bold uppercase tracking-widest"
              >
                Okay
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SafetyToolkit 
        isOpen={safetyToolkitOpen} 
        onClose={() => setSafetyToolkitOpen(false)} 
        rideId={rideId} 
        driver={driver} 
      />
    </div>
  );
};

export default RideTracking;
