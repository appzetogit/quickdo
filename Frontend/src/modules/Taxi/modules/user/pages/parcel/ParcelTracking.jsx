import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Phone, 
  MessageCircle, 
  AlertTriangle, 
  Shield, 
  Star, 
  ChevronLeft, 
  Share2, 
  Package, 
  CheckCircle2,
  Receipt,
  Clock, 
  ShieldCheck, 
  ChevronRight,
  Banknote,
  CreditCard,
  Wallet
} from 'lucide-react';
import { GoogleMap, MarkerF, OverlayView, OverlayViewF, PolylineF } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { socketService } from '../../../../shared/api/socket';
import api from '../../../../shared/api/axiosInstance';
import { BACKEND_ORIGIN } from '../../../../shared/api/runtimeConfig';
import { clearCurrentRide, getCurrentRide, saveCurrentRide } from '../../services/currentRideService';
import { useAuthStore } from '../../../../../../core/auth/auth.store';

// Assets (Using the same icons as RideTracking)
import carIcon from '../../../../assets/icons/car.png';
import bikeIcon from '../../../../assets/icons/bike.png';
import autoIcon from '../../../../assets/icons/auto.png';
import deliveryIcon from '../../../../assets/icons/Delivery.png';

const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const DEFAULT_CENTER = { lat: 22.7196, lng: 75.8577 };
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'delivered']);
const ACTIVE_RIDE_VALIDATE_MS = 4000;
const COMPLETED_TRACKING_STATUSES = new Set(['completed', 'delivered']);
const TIP_OPTIONS = [0, 20, 50, 100];

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
  if (!Number.isFinite(numeric)) return fallback;
  return ((numeric % 360) + 360) % 360;
};

const calculateBearing = (from, to, fallback = 0) => {
  if (!from || !to || arePositionsNearlyEqual(from, to, 0.00001)) return fallback;
  const fromLat = Number(from.lat) * (Math.PI / 180);
  const toLat = Number(to.lat) * (Math.PI / 180);
  const deltaLng = (Number(to.lng) - Number(from.lng)) * (Math.PI / 180);
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  return normalizeHeading(Math.atan2(y, x) * (180 / Math.PI), fallback);
};

const getRouteHeading = (position, path = [], fallback = 0) => {
  const nextPoint = path.find((point) => !arePositionsNearlyEqual(position, point, 0.00001));
  return nextPoint ? calculateBearing(position, nextPoint, fallback) : fallback;
};

const RotatingVehicleMarker = ({ position, iconUrl = deliveryIcon, heading = 0, title = 'Delivery Captain' }) => (
  <OverlayViewF
    position={position}
    mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    getPixelPositionOffset={(w, h) => ({ x: -(w / 2), y: -(h / 2) })}
  >
    <div title={title} className="pointer-events-none flex h-14 w-14 items-center justify-center">
      <div
        className="flex h-11 w-11 items-center justify-center transition-transform duration-500 ease-out"
        style={{ transform: `rotate(${normalizeHeading(heading)}deg)` }}
      >
        <img
          src={iconUrl || deliveryIcon}
          alt={title}
          className="h-12 w-12 object-contain drop-shadow-[0_8px_10px_rgba(15,23,42,0.35)]"
          draggable={false}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = deliveryIcon;
          }}
        />
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
  const iconType = String(ride?.vehicleIconType || driver?.vehicleIconType || driver?.vehicleType || '').toLowerCase();
  if (iconType.includes('bike')) return bikeIcon;
  if (iconType.includes('auto')) return autoIcon;
  if (iconType.includes('car')) return carIcon;
  return deliveryIcon;
};

const unwrapApiPayload = (response) => response?.data?.data || response?.data || response;

const resolveAssetUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(https?:|data:image\/|blob:)/i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${BACKEND_ORIGIN}${raw}`;
  return `${BACKEND_ORIGIN}/${raw.replace(/^\/+/, '')}`;
};

const mergeDriverSnapshot = (baseDriver = {}, incomingDriver = {}) => ({
  ...baseDriver,
  ...incomingDriver,
  profileImage: incomingDriver.profileImage || baseDriver.profileImage || '',
  vehicleImage: incomingDriver.vehicleImage || baseDriver.vehicleImage || '',
  name: incomingDriver.name || baseDriver.name || 'Delivery Captain',
  phone: incomingDriver.phone || baseDriver.phone || '',
  rating: incomingDriver.rating || baseDriver.rating || '4.9',
  plate: incomingDriver.plate || baseDriver.plate || incomingDriver.vehicleNumber || baseDriver.vehicleNumber || 'Assigned',
});

const getInitials = (name = '') =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'DC';

const PAYMENT_OPTIONS = [
  { id: 'cash', label: 'COD / Cash', sub: 'Pay driver directly', Icon: Banknote },
  { id: 'online', label: 'Online', sub: 'UPI, cards or Razorpay', Icon: CreditCard },
  { id: 'wallet', label: 'Wallet', sub: 'Use in-app wallet balance', Icon: Wallet },
];

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

const ParcelTracking = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = useMemo(
    () => (location.pathname.startsWith('/taxi/user') ? '/taxi/user' : ''),
    [location.pathname],
  );
  const userHomeRoute = routePrefix || '/taxi/user';
  const storedRide = useMemo(() => getCurrentRide(), []);
  const state = useMemo(() => location.state || storedRide || {}, [location.state, storedRide]);
  const [rideRealtime, setRideRealtime] = useState(null);
  const [routePath, setRoutePath] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showCancellationBillModal, setShowCancellationBillModal] = useState(false);
  const [cancellationBill, setCancellationBill] = useState(null);
  const [showReasonSelection, setShowReasonSelection] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [otherReasonText, setOtherReasonText] = useState('');
  const [shareToast, setShareToast] = useState(false);
  const [map, setMap] = useState(null);
  const [step, setStep] = useState(() => {
    if (state.feedback?.submittedAt) {
      if (Number(state.feedback?.rating || 0) === 0) return 'rating';
      return 'success';
    }
    return 'payment';
  });
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [showSubmittedOverlay, setShowSubmittedOverlay] = useState(false);
  const [rating, setRating] = useState(() => Number(state.feedback?.rating || 0));
  const [comment, setComment] = useState(() => state.feedback?.comment || '');
  const [selectedTip, setSelectedTip] = useState(() => Number(state.feedback?.tipAmount || 0));
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('online');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(Boolean(state.feedback?.submittedAt));
  const [feedbackError, setFeedbackError] = useState('');
  const [tipSettings, setTipSettings] = useState({
    enable_tips: '1',
    min_tip_amount: '10',
  });
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const latestStateRef = useRef(state);
  const latestDriverRef = useRef(state.driver || {});
  const latestRideRealtimeRef = useRef(null);
  const hydrateRideStateRef = useRef(async () => {});
  const hasAutoFramedMapRef = useRef(false);
  const hasCompletedRedirectRef = useRef(false);

  const rideId = state.rideId || '';
  const tripStatus = String(rideRealtime?.status || state.liveStatus || state.status || 'accepted').toLowerCase();
  
  const pickupPosition = useMemo(() => toLatLng(rideRealtime?.pickup?.coordinates || state.pickupCoords || [75.9048, 22.7039]), [rideRealtime?.pickup?.coordinates, state.pickupCoords]);
  const dropPosition = useMemo(() => toLatLng(rideRealtime?.drop?.coordinates || state.dropCoords || [75.8937, 22.7533], pickupPosition), [pickupPosition, rideRealtime?.drop?.coordinates, state.dropCoords]);
  const driverPosition = useMemo(() => toLatLng(rideRealtime?.driverLocation?.coordinates, pickupPosition), [pickupPosition, rideRealtime?.driverLocation?.coordinates]);
  const activeDestination = useMemo(
    () => (['started', 'ongoing', 'arrived', 'completed', 'delivered'].includes(tripStatus) ? dropPosition : pickupPosition),
    [dropPosition, pickupPosition, tripStatus],
  );

  const driver = useMemo(() => mergeDriverSnapshot(state.driver || {}, rideRealtime?.driver || {}), [state.driver, rideRealtime?.driver]);
  const vehicleIcon = getTrackingVehicleIcon(state, driver);
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
  const fare = rideRealtime?.fare || state.fare || 45;
  const waitingPricing = rideRealtime?.pricingSnapshot || state.pricingSnapshot || {};
  const { user } = useAuthStore();
  const pendingCancellationDue = Number(rideRealtime?.pending_cancellation_due || state.pending_cancellation_due || user?.pending_cancellation_due || 0);
  const applicableCancellationDue = tripStatus === 'completed' || tripStatus === 'delivered' ? 0 : pendingCancellationDue;
  const currentTotalFare = Math.max(0, Math.round(Number(fare || 0) + applicableCancellationDue));
  
  const otp = String(rideRealtime?.otp || state.otp || '');
  const completedAt = rideRealtime?.completedAt || state.completedAt || Date.now();
  const isDeliveryCompleted = COMPLETED_TRACKING_STATUSES.has(tripStatus);
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);
  const availableTipOptions = useMemo(
    () =>
      [...new Set([0, minimumTipAmount, ...TIP_OPTIONS].filter((amount) => Number.isFinite(amount) && amount >= 0))]
        .sort((left, right) => left - right),
    [minimumTipAmount],
  );
  const totalBill = Number(fare || 0) + Number(selectedTip || 0);
  const completedDateLabel = new Date(completedAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const completedTimeLabel = new Date(completedAt).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  useEffect(() => {
    hasCompletedRedirectRef.current = false;
  }, [rideId]);

  useEffect(() => {
    const fetchTipSettings = async () => {
      try {
        const response = await api.get('/rides/app-settings/tip');
        const nextSettings = response?.data?.settings || response?.settings || {};
        setTipSettings((current) => ({
          ...current,
          ...nextSettings,
        }));
      } catch {
        // keep defaults for parcel feedback
      }
    };

    fetchTipSettings();
  }, []);

  useEffect(() => {
    const feedback = rideRealtime?.feedback || state.feedback || null;
    if (!feedback || !feedback.submittedAt) {
      return;
    }

    setRating(Number(feedback.rating || 0));
    setComment(feedback.comment || '');
    setSelectedTip(Number(feedback.tipAmount || 0));
    setIsFeedbackSubmitted(Boolean(feedback.submittedAt));
    if (Number(feedback.rating || 0) === 0) {
      setStep('rating');
    } else {
      setStep('success');
    }
  }, [rideRealtime?.feedback, state.feedback]);

  useEffect(() => {
    let active = true;

    if (!rideId) {
      return () => {
        active = false;
      };
    }

    const hydrateRideState = async () => {
      try {
        const payload = unwrapApiPayload(await api.get(`/rides/${rideId}`));

        if (!active || !payload) {
          return;
        }

        const mergedDriver = mergeDriverSnapshot(latestStateRef.current.driver || {}, payload?.driver || {});
        const nextRealtime = {
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
            : latestRideRealtimeRef.current?.driverLocation || null,
          status: payload?.liveStatus || payload?.status || 'accepted',
          fare: payload?.fare || latestStateRef.current.fare || 0,
          paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
          vehicleIconType: payload?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
          vehicleIconUrl: payload?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
          otp: payload?.otp || latestStateRef.current.otp || '',
          completedAt: payload?.completedAt || latestStateRef.current.completedAt || null,
          feedback: payload?.feedback || latestStateRef.current.feedback || null,
          driver: mergedDriver,
        };

        const nextStatus = String(nextRealtime.status || '').toLowerCase();
        if (COMPLETED_TRACKING_STATUSES.has(nextStatus)) {
          setRideRealtime(nextRealtime);
          saveCurrentRide({
            ...latestStateRef.current,
            ...payload,
            rideId,
            driver: mergedDriver,
            fare: payload?.fare || latestStateRef.current.fare || 0,
            paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
            status: nextStatus,
            liveStatus: nextStatus,
            completedAt: payload?.completedAt || latestStateRef.current.completedAt || Date.now(),
            feedback: payload?.feedback || latestStateRef.current.feedback || null,
          });
          return;
        }

        if (TERMINAL_STATUSES.has(nextStatus)) {
          clearCurrentRide();
          navigate(userHomeRoute, { replace: true });
          return;
        }

        setRideRealtime(nextRealtime);
        saveCurrentRide({
          ...latestStateRef.current,
          rideId,
          driver: mergedDriver,
          status: payload?.status || latestStateRef.current.status || 'accepted',
          liveStatus: payload?.liveStatus || payload?.status || latestStateRef.current.liveStatus || 'accepted',
        });
      } catch {
        // socket updates continue to drive the UI
      }
    };

    hydrateRideStateRef.current = hydrateRideState;
    hydrateRideState();
    const intervalId = window.setInterval(hydrateRideState, ACTIVE_RIDE_VALIDATE_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [rideId]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    latestDriverRef.current = driver;
  }, [driver]);

  useEffect(() => {
    latestRideRealtimeRef.current = rideRealtime;
  }, [rideRealtime]);

  useEffect(() => {
    if (!rideId) {
      return undefined;
    }

    const refreshTrackingState = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') {
        return;
      }

      socketService.connect({ role: 'user' });
      socketService.emit('ride:join', { rideId });

      const hydrate = hydrateRideStateRef.current;
      if (typeof hydrate === 'function') {
        Promise.resolve(hydrate()).catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', refreshTrackingState);
    window.addEventListener('focus', refreshTrackingState);

    return () => {
      document.removeEventListener('visibilitychange', refreshTrackingState);
      window.removeEventListener('focus', refreshTrackingState);
    };
  }, [rideId]);

  useEffect(() => {
    hasAutoFramedMapRef.current = false;
  }, [rideId, tripStatus, activeDestination.lat, activeDestination.lng]);

  useEffect(() => {
    if (!tipsEnabled && selectedTip !== 0) {
      setSelectedTip(0);
      return;
    }

    if (tipsEnabled && minimumTipAmount > 0 && selectedTip > 0 && selectedTip < minimumTipAmount) {
      setSelectedTip(minimumTipAmount);
    }
  }, [minimumTipAmount, selectedTip, tipsEnabled]);

  // Socket & Polling
  useEffect(() => {
    if (!rideId) return;
    const socket = socketService.connect({ role: 'user' });
    if (!socket) return;

    const onRideState = (payload) => {
      if (String(payload?.rideId) !== String(rideId)) {
        return;
      }

      const nextStatus = String(payload?.liveStatus || payload?.status || '').toLowerCase();
      if (COMPLETED_TRACKING_STATUSES.has(nextStatus)) {
        const mergedDriver = mergeDriverSnapshot(latestDriverRef.current, payload?.driver || {});
        setRideRealtime((prev) => ({
          ...(prev || {}),
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
            : prev?.driverLocation || latestRideRealtimeRef.current?.driverLocation || null,
          status: nextStatus,
          fare: payload?.fare || prev?.fare || latestStateRef.current.fare || 0,
          paymentMethod: payload?.paymentMethod || prev?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
          vehicleIconType: payload?.vehicleIconType || prev?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
          vehicleIconUrl: payload?.vehicleIconUrl || prev?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
          otp: payload?.otp || prev?.otp || latestStateRef.current.otp || '',
          completedAt: payload?.completedAt || prev?.completedAt || Date.now(),
          feedback: payload?.feedback || prev?.feedback || null,
          driver: mergedDriver,
        }));
        saveCurrentRide({
          ...latestStateRef.current,
          ...payload,
          rideId,
          driver: mergedDriver,
          fare: payload?.fare || latestStateRef.current.fare || 0,
          paymentMethod: payload?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
          status: nextStatus,
          liveStatus: nextStatus,
          completedAt: payload?.completedAt || Date.now(),
          feedback: payload?.feedback || null,
        });
        return;
      }

      if (TERMINAL_STATUSES.has(nextStatus)) {
        clearCurrentRide();
        navigate(userHomeRoute, { replace: true });
        return;
      }

      const mergedDriver = mergeDriverSnapshot(latestDriverRef.current, payload?.driver || {});
      setRideRealtime((prev) => ({
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
          : prev?.driverLocation || null,
        status: payload?.liveStatus || payload?.status || prev?.status || 'accepted',
        fare: payload?.fare || prev?.fare || latestStateRef.current.fare || 0,
        paymentMethod: payload?.paymentMethod || prev?.paymentMethod || latestStateRef.current.paymentMethod || 'Cash',
        vehicleIconType: payload?.vehicleIconType || prev?.vehicleIconType || latestStateRef.current.vehicleIconType || '',
        vehicleIconUrl: payload?.vehicleIconUrl || prev?.vehicleIconUrl || latestStateRef.current.vehicleIconUrl || '',
        otp: payload?.otp || prev?.otp || latestStateRef.current.otp || '',
        completedAt: payload?.completedAt || prev?.completedAt || null,
        feedback: payload?.feedback || prev?.feedback || null,
        driver: mergedDriver,
      }));
    };
    const onLocationUpdated = (payload) => {
      if (String(payload.rideId) === String(rideId)) {
        setRideRealtime(prev => ({
          ...prev,
          driverLocation: {
            coordinates: payload.coordinates,
            heading: payload.heading ?? prev?.driverLocation?.heading ?? null,
          }
        }));
      }
    };
    const onStatusUpdated = (payload) => {
      if (String(payload.rideId) === String(rideId)) {
        const nextStatus = String(payload.liveStatus || payload.status).toLowerCase();
        if (COMPLETED_TRACKING_STATUSES.has(nextStatus)) {
          setRideRealtime((prev) => ({
            ...(prev || {}),
            status: nextStatus,
            completedAt: payload?.completedAt || prev?.completedAt || Date.now(),
            feedback: payload?.feedback || prev?.feedback || null,
          }));
          saveCurrentRide({
            ...latestStateRef.current,
            ...payload,
            rideId,
            driver: latestDriverRef.current,
            status: nextStatus,
            liveStatus: nextStatus,
            completedAt: payload?.completedAt || Date.now(),
            feedback: payload?.feedback || null,
          });
          return;
        }
        if (TERMINAL_STATUSES.has(nextStatus)) {
          clearCurrentRide();
          navigate(userHomeRoute, { replace: true });
          return;
        }
        setRideRealtime(prev => ({ ...prev, status: nextStatus }));
      }
    };

    socketService.on('ride:state', onRideState);
    socketService.on('ride:driver-location:updated', onLocationUpdated);
    socketService.on('ride:status:updated', onStatusUpdated);
    socketService.emit('ride:join', { rideId });

    return () => {
      socketService.off('ride:state', onRideState);
      socketService.off('ride:driver-location:updated', onLocationUpdated);
      socketService.off('ride:status:updated', onStatusUpdated);
    };
  }, [rideId, navigate, routePrefix, userHomeRoute]);

  useEffect(() => {
    if (!TERMINAL_STATUSES.has(tripStatus)) {
      return;
    }

    if (COMPLETED_TRACKING_STATUSES.has(tripStatus)) {
      return;
    }

    clearCurrentRide();
    navigate(userHomeRoute, { replace: true });
  }, [navigate, tripStatus, userHomeRoute]);

  // Route Path Update
  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.DirectionsService) {
      setRoutePath(arePositionsNearlyEqual(driverPosition, activeDestination) ? [driverPosition] : [driverPosition, activeDestination]);
      return;
    }

    if (arePositionsNearlyEqual(driverPosition, activeDestination)) {
      setRoutePath([driverPosition]);
      return;
    }

    let active = true;
    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route({
      origin: driverPosition,
      destination: activeDestination,
      travelMode: window.google.maps.TravelMode.DRIVING,
      provideRouteAlternatives: false,
    }, (result, status) => {
      if (!active) {
        return;
      }

      if (status === 'OK' && result?.routes?.[0]?.overview_path?.length) {
        setRoutePath(result.routes[0].overview_path.map(p => ({ lat: p.lat(), lng: p.lng() })));
        return;
      }

      setRoutePath([driverPosition, activeDestination]);
    });

    return () => {
      active = false;
    };
  }, [isLoaded, driverPosition, activeDestination]);

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
        map.fitBounds(bounds, { top: 120, right: 48, bottom: 320, left: 48 });
        hasAutoFramedMapRef.current = true;
        return;
      }

      map.panTo(driverPosition);
      return;
    }

    if (!hasAutoFramedMapRef.current) {
      map.panTo(driverPosition);
      map.setZoom(15);
      hasAutoFramedMapRef.current = true;
      return;
    }

    map.panTo(driverPosition);
  }, [activeDestination, driverPosition, map, routePath]);

  const handleCall = () => {
    if (driver.phone) window.open(`tel:${driver.phone}`, '_self');
  };

  const handleShare = () => {
    const text = `Tracking my delivery! Driver: ${driver.name}, Vehicle: ${driver.plate}. Destination: ${state.drop}`;
    if (navigator.share) navigator.share({ title: 'Parcel Tracking', text });
    else {
      navigator.clipboard.writeText(text);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    }
  };

  const submitParcelFeedback = async () => {
    if (!rideId) {
      clearCurrentRide();
      navigate(userHomeRoute, { replace: true });
      return;
    }

    if (step === 'rating') {
      if (rating < 1) {
        setFeedbackError('Please rate your delivery driver before finishing.');
        return;
      }
      try {
        setIsSubmittingFeedback(true);
        setFeedbackError('');
        const response = await api.patch(`/rides/${rideId}/feedback`, {
          rating,
          comment,
        });

        const payload = response?.data?.data || response?.data || response;
        if (payload?.feedback?.submittedAt) {
          setIsFeedbackSubmitted(true);
          setStep('success');
          setShowSubmittedOverlay(true);
          
          saveCurrentRide({
            ...latestStateRef.current,
            ...(rideRealtime || {}),
            rideId,
            driver,
            fare,
            paymentMethod: rideRealtime?.paymentMethod || state.paymentMethod || 'Cash',
            status: tripStatus,
            liveStatus: tripStatus,
            completedAt: payload?.completedAt || completedAt,
            feedback: payload.feedback,
          });

          setTimeout(() => {
            navigate(userHomeRoute, { replace: true });
          }, 2500);
        }
        return;
      } catch (error) {
        console.error('Error submitting parcel feedback:', error);
        setFeedbackError(error?.response?.data?.message || error?.message || 'Could not submit rating.');
      } finally {
        setIsSubmittingFeedback(false);
      }
      return;
    }

    try {
      setIsSubmittingFeedback(true);
      setFeedbackError('');

      let response;

      if (selectedPaymentMethod === 'online') {
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
          throw new Error('Razorpay SDK failed to load');
        }

        const orderResponse = await api.post(`/rides/${rideId}/tip/razorpay/order`, {
          rating: 0,
          comment: '',
          tipAmount: selectedTip || 0,
        });
        
        const orderPayload = orderResponse?.data?.data || orderResponse?.data || orderResponse || {};

        if (!orderPayload.keyId || !orderPayload.orderId) {
          throw new Error('Unable to start tip payment');
        }

        const order = orderPayload;

        let userInfo = {};
        try {
          userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
        } catch {
          userInfo = {};
        }

        response = await new Promise((resolve, reject) => {
          const options = {
            key: order.keyId,
            amount: order.amount,
            currency: order.currency || 'INR',
            name: 'Quick Drop',
            description: `Tip for delivery captain`,
            order_id: order.orderId,
            prefill: {
              name: userInfo?.name || '',
              email: userInfo?.email || '',
              contact: userInfo?.phone ? `+91${userInfo.phone}` : '',
            },
            modal: {
              ondismiss: () => reject(new Error('Tip payment was cancelled')),
            },
            handler: async (paymentResponse) => {
              try {
                const verifyResponse = await api.post(`/rides/${rideId}/tip/razorpay/verify`, {
                  ...paymentResponse,
                  rating: 0,
                  comment: '',
                  tipAmount: selectedTip || 0,
                });
                resolve(verifyResponse);
              } catch (verifyError) {
                reject(new Error(verifyError?.message || 'Tip payment verification failed'));
              }
            },
            theme: {
              color: '#0f172a',
            },
          };

          const rzp = new window.Razorpay(options);

          rzp.on('payment.failed', (event) => {
            reject(new Error(event?.error?.description || event?.error?.reason || 'Tip payment failed'));
          });

          rzp.open();
        });
      } else if (Number(selectedTip || 0) > 0 && selectedPaymentMethod === 'wallet') {
        response = await api.post(`/rides/${rideId}/complete-payment/wallet`, {
          rating: 0,
          comment: '',
          tipAmount: selectedTip || 0,
        });
      } else {
        response = await api.patch(`/rides/${rideId}/feedback`, {
          rating: 0,
          comment: '',
          tipAmount: selectedTip || 0,
        });
      }

      setShowPaymentSuccess(true);
      setTimeout(() => {
        setShowPaymentSuccess(false);
        setStep('rating');
      }, 1500);

    } catch (error) {
      console.error('Error submitting tip payment:', error);
      const backendMessage = error?.response?.data?.message || error?.message;
      
      if (error?.response?.status === 409 || (backendMessage && backendMessage.toLowerCase().includes('already submitted'))) {
        setShowPaymentSuccess(true);
        setTimeout(() => {
          setShowPaymentSuccess(false);
          setStep('rating');
        }, 1500);
        return;
      }

      setFeedbackError(backendMessage || 'Could not process tip payment right now.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 max-w-lg mx-auto relative font-sans overflow-hidden">
      {/* Map Content */}
      <div className="absolute inset-0 z-0">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER_STYLE}
            center={driverPosition}
            zoom={15}
            onLoad={setMap}
            options={{
              disableDefaultUI: true,
              styles: [
                { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                { featureType: 'transit', stylers: [{ visibility: 'off' }] }
              ]
            }}
          >
            {routePath.length > 0 && (
              <PolylineF
                path={routePath}
                options={{ strokeColor: '#0f172a', strokeOpacity: 0.9, strokeWeight: 6 }}
              />
            )}
            <RotatingVehicleMarker position={driverPosition} iconUrl={vehicleIcon} heading={displayDriverHeading} />
            <MarkerF position={activeDestination} />
          </GoogleMap>
        ) : (
          <div className="h-full w-full bg-slate-200 animate-pulse" />
        )}
      </div>

      {/* Header Overlays */}
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="absolute top-8 left-4 right-4 z-10 flex gap-3">
        <button onClick={() => navigate(userHomeRoute, { replace: true })} className="w-12 h-12 bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-white/80 flex items-center justify-center text-gray-900">
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
        <div className="min-w-0 flex-1 bg-white/90 backdrop-blur-xl rounded-2xl p-3 shadow-xl border border-white/80 flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-900">
            <Package size={16} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Destination</p>
            <p className="mt-1 truncate text-xs font-black text-gray-900">
              {state.drop || 'Drop'}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Toast Notification */}
      <AnimatePresence>
        {shareToast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-full text-xs font-black shadow-2xl">
            Tracking link copied!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Tracking Card */}
      <motion.div
        initial={{ y: 300 }}
        animate={{ y: 0 }}
        className="absolute bottom-0 left-0 right-0 z-20 bg-white rounded-t-[40px] shadow-[0_-20px_60px_rgba(0,0,0,0.1)] p-6 pb-8 border-t border-gray-100 max-h-[85vh] overflow-y-auto scrollbar-hide overscroll-contain"
      >
        <div className="w-12 h-1.5 bg-gray-100 rounded-full mx-auto mb-6" />

        {isDeliveryCompleted ? (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 shadow-[0_8px_20px_rgba(16,185,129,0.28)]">
                <CheckCircle2 size={22} className="text-white" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Parcel Delivered</p>
                <h2 className="text-[22px] font-black text-slate-900">Delivered successfully</h2>
              </div>
            </div>

            <div className="overflow-hidden rounded-[22px] border border-white/80 bg-white/95 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between bg-slate-900 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/10">
                    <Receipt size={14} className="text-primary-orange/40" />
                  </div>
                  <div>
                    <p className="text-[13px] font-black text-white">Delivery Summary</p>
                    <p className="text-[10px] font-bold text-slate-400">{completedDateLabel} · {completedTimeLabel}</p>
                  </div>
                </div>
                <button type="button" onClick={handleShare} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black text-white">
                  <Share2 size={12} />
                  Share
                </button>
              </div>

              <div className="space-y-4 px-4 py-4">
                <div className="flex items-center gap-3 rounded-[18px] border border-slate-100 bg-slate-50/80 p-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-slate-900 text-[18px] font-black text-white">
                    {getInitials(driver.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-black text-slate-900">{driver.name}</p>
                    <p className="truncate text-[11px] font-bold text-slate-500">{driver.plate || 'Assigned'} · {driver.vehicle || 'Delivery Agent'}</p>
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-black text-slate-800">
                      <Star size={10} className="fill-yellow-500 text-yellow-500" />
                      {driver.rating || '4.9'}
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-100 bg-white p-3">
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center pt-1">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      <div className="h-10 border-l border-dashed border-slate-200" />
                      <div className="h-2.5 w-2.5 rounded-full bg-primary-orange/50" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <p className="truncate text-[13px] font-black text-slate-900">{state.pickup || 'Pickup'}</p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Pickup</p>
                      </div>
                      <div>
                        <p className="truncate text-[13px] font-black text-slate-900">{state.drop || 'Drop'}</p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Destination</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-100 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-slate-500">Delivery fare</span>
                    <span className="text-[13px] font-black text-slate-900">Rs {Number(fare || 0).toFixed(2)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[12px] font-bold text-slate-500">Tip</span>
                    <span className="text-[13px] font-black text-slate-900">Rs {Number(selectedTip || 0).toFixed(2)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-[15px] font-black text-slate-900">Total</span>
                    <span className="text-[18px] font-black text-slate-900">Rs {totalBill.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {step === 'payment' && (
              <div className="relative overflow-hidden rounded-[20px] border border-white/80 bg-white/95 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                <p className="text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                  {tipsEnabled ? 'Tip your delivery driver' : 'Driver tips disabled'}
                </p>
                {tipsEnabled && minimumTipAmount > 0 ? (
                  <p className="mt-2 text-center text-[11px] font-bold text-slate-500">Minimum tip amount: Rs {minimumTipAmount}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {availableTipOptions.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => {
                        setSelectedTip(amount);
                        setFeedbackError('');
                      }}
                      disabled={!tipsEnabled && amount > 0}
                      className={`rounded-full border px-4 py-2 text-[11px] font-black transition-all ${
                        selectedTip === amount ? 'border-primary-orange/50 bg-primary-orange/50 text-white shadow-[0_8px_18px_rgba(249,115,22,0.24)]' : 'border-slate-100 bg-slate-50 text-slate-600'
                      } ${!tipsEnabled && amount > 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      {amount === 0 ? 'No tip' : `Rs ${amount}`}
                    </button>
                  ))}
                </div>

                {Number(selectedTip || 0) > 0 && (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <p className="text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-3">
                      Select Tip Payment Method
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {PAYMENT_OPTIONS.map((method) => {
                        const Icon = method.Icon;
                        const isSelected = selectedPaymentMethod === method.id;
                        return (
                          <button
                            key={method.id}
                            type="button"
                            onClick={() => {
                              setSelectedPaymentMethod(method.id);
                              setFeedbackError('');
                            }}
                            className={`flex flex-col items-center justify-center py-4 rounded-2xl border-2 transition-all ${
                              isSelected
                                ? 'border-[#0F766E] bg-[#0F766E]/5'
                                : 'border-slate-100 bg-slate-50/50 hover:border-[#0F766E]/30'
                            }`}
                          >
                            <Icon 
                              size={22} 
                              className={isSelected ? 'text-[#0F766E]' : 'text-slate-400'} 
                              strokeWidth={2.5} 
                            />
                            <span className={`text-[10px] font-bold uppercase tracking-wide mt-2 ${
                              isSelected ? 'text-[#0F766E]' : 'text-slate-500'
                            }`}>
                              {method.id === 'cash' ? 'Cash' : method.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                <AnimatePresence>
                  {showPaymentSuccess && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[20px] bg-white/95 backdrop-blur-sm"
                    >
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-[0_8px_20px_rgba(16,185,129,0.3)]">
                        <CheckCircle2 size={32} className="text-white" strokeWidth={3} />
                      </div>
                      <p className="mt-4 text-[16px] font-black tracking-wide text-[#0F766E]">Payment Confirmed!</p>
                      <p className="mt-1 text-[12px] font-bold text-slate-500">Processing tip...</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {(step === 'rating' || step === 'success') && (
              <div className="rounded-[20px] border border-white/80 bg-white/95 px-4 py-4 text-center shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
                {step === 'success' && (
                  <div className="mb-6 text-center">
                    <p className="text-center text-[10px] font-black uppercase tracking-[0.22em] text-emerald-500">
                      Feedback submitted
                    </p>
                    <p className="mt-2 text-[12px] font-bold text-slate-500">
                      Rating: {rating || 0}/5 {selectedTip > 0 ? `| Tip added: Rs ${Number(selectedTip || 0).toFixed(2)}` : '| No tip added'}
                    </p>
                  </div>
                )}
                
                <p className="text-[16px] font-black text-slate-900">How was your delivery with {driver.name?.split(' ')[0] || 'your driver'}?</p>
                <div className="mt-4 flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        if (step !== 'success') {
                          setRating(value);
                          setFeedbackError('');
                        }
                      }}
                      disabled={step === 'success'}
                      className={`flex h-11 w-11 items-center justify-center rounded-[12px] transition-all ${
                        rating >= value ? 'bg-primary-orange/50 shadow-[0_10px_20px_rgba(249,115,22,0.24)]' : 'bg-slate-100'
                      } ${step === 'success' ? 'cursor-default' : ''}`}
                    >
                      <Star size={19} className={rating >= value ? 'fill-white text-white' : 'text-slate-300'} />
                    </button>
                  ))}
                </div>

                <div className="mt-4 rounded-[16px] border border-slate-100 bg-slate-50/80 px-3 py-3">
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    rows={3}
                    maxLength={500}
                    disabled={step === 'success'}
                    placeholder="Tell us about the delivery"
                    className="w-full resize-none rounded-[12px] border border-slate-100 bg-white px-3 py-2 text-[13px] font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                </div>
              </div>
            )}

            {feedbackError ? <p className="mt-3 text-[12px] font-black text-red-500">{feedbackError}</p> : null}

            <button
              type="button"
              onClick={submitParcelFeedback}
              disabled={isSubmittingFeedback || step === 'success'}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#0F766E] py-3.5 text-[14px] font-black text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] disabled:opacity-60"
            >
              {isSubmittingFeedback 
                ? 'Processing...' 
                : step === 'success' 
                  ? 'Feedback already saved' 
                  : step === 'payment'
                    ? (selectedTip > 0) 
                      ? `Pay Tip Rs ${selectedTip} via ${selectedPaymentMethod === 'cash' ? 'Cash' : selectedPaymentMethod === 'wallet' ? 'Wallet' : 'Online'} & Continue`
                      : 'Continue to Rating'
                    : 'Submit rating'}
              <ChevronRight size={16} />
            </button>

            <button
              type="button"
              onClick={() => {
                clearCurrentRide();
                navigate(userHomeRoute, { replace: true });
              }}
              className="mt-3 text-[12px] font-black text-slate-500"
            >
              Continue home
            </button>
          </div>
      ) : (
        <div className="space-y-6">
          {/* Driver Info Section */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-[24px] bg-slate-900 overflow-hidden border-2 border-white shadow-sm">
                  <img src={`https://ui-avatars.com/api/?name=${driver.name.replace(' ', '+')}&background=0f172a&color=fff&bold=true`} alt="Driver" className="w-full h-full object-cover" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-white px-2 py-0.5 rounded-full border border-gray-100 flex items-center gap-1 shadow-sm">
                  <Star size={10} className="text-amber-400 fill-amber-400" />
                  <span className="text-[10px] font-black text-gray-900">{driver.rating}</span>
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-black text-gray-900 leading-tight tracking-tight">{driver.name}</h3>
                <p className="text-xs font-bold text-gray-400 mt-0.5 uppercase tracking-tight">{driver.plate} • {driver.vehicle || 'Delivery Agent'}</p>
                <div className="flex items-center gap-1.5 mt-2 text-slate-900">
                  <Clock size={12} strokeWidth={3} />
                  <span className="text-[11px] font-black uppercase tracking-wider">
                    {tripStatus === 'arrived' || tripStatus === 'arriving'
                      ? 'Driver Has Arrived'
                      : tripStatus === 'started' || tripStatus === 'ongoing'
                        ? 'Heading to Drop'
                        : 'Arriving Shortly'}
                  </span>
                </div>
              </div>
            </div>

            {/* OTP Display */}
            {otp && (
              <div className="bg-slate-100 border border-slate-200 rounded-2xl px-4 py-3 flex flex-col items-center">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">OTP</span>
                <span className="text-xl font-black text-slate-900 leading-none">{otp}</span>
              </div>
            )}
          </div>

          {/* Action Grid */}
          <div className="grid grid-cols-4 gap-3">
            <ActionButton icon={Phone} label="Call" onClick={handleCall} />
            <ActionButton icon={MessageCircle} label="Chat" onClick={() => navigate(`${routePrefix}/ride/chat`, { state: { rideId, peer: driver } })} />
            <ActionButton icon={Share2} label="Share" onClick={handleShare} />
            <ActionButton icon={ShieldCheck} label="Safety" onClick={() => navigate(`${routePrefix}/support`)} color="dark" />
          </div>

          {/* Trip Footer */}
          <div className="flex items-center justify-between pt-6 border-t border-gray-50">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Estimated Fare</p>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-gray-900">₹{currentTotalFare}</span>
                <span className="px-2 py-0.5 rounded-md bg-gray-100 text-[10px] font-black text-gray-500 uppercase tracking-widest">{state.paymentMethod || 'Cash'}</span>
                {applicableCancellationDue > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-red-50 text-[10px] font-black text-red-500 uppercase tracking-widest">+₹{applicableCancellationDue} Cancel Due</span>
                )}
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowCancelConfirm(true)}
              className="px-6 py-3 rounded-2xl border border-red-100 text-red-500 text-xs font-black uppercase tracking-widest hover:bg-red-50 transition-colors"
            >
              Cancel
            </motion.button>
          </div>
        </div>
        )}
      </motion.div>

      {/* Cancel Confirmation Modal */}
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
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[100] max-w-lg mx-auto"
            />
            {showReasonSelection ? (
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 40 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-sm bg-white rounded-[28px] p-7 z-[101] shadow-2xl text-center"
              >
                <h3 className="text-[17px] font-black text-gray-900 mb-4 uppercase tracking-wider">Select Reason</h3>
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
                        className="h-4 w-4 text-gray-900 focus:ring-slate-900 border-gray-355"
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
                    onClick={() => {
                      const finalReason = selectedReason === 'Others' ? otherReasonText : selectedReason;
                      api.patch(`/rides/${rideId}/cancel`, { reason: finalReason }).then((res) => {
                        const bill = res?.data?.data?.cancellationBill;
                        if (bill && (Number(bill.cancellationFee) > 0 || Number(bill.waitingCharge) > 0)) {
                          setCancellationBill(bill);
                          setShowCancellationBillModal(true);
                          setShowCancelConfirm(false);
                          setShowReasonSelection(false);
                        } else {
                          clearCurrentRide();
                          navigate(userHomeRoute, { replace: true });
                        }
                      }).catch(() => {
                        clearCurrentRide();
                        navigate(userHomeRoute, { replace: true });
                      });
                    }}
                    className="flex-1 py-3 bg-red-500 hover:bg-red-650 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg disabled:opacity-50"
                  >
                    Cancel Delivery
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 40 }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85%] max-w-sm bg-white rounded-[40px] p-8 z-[101] shadow-2xl text-center"
              >
                <div className="w-16 h-16 bg-red-50 rounded-[24px] flex items-center justify-center mx-auto mb-6 text-red-500">
                  <AlertTriangle size={32} strokeWidth={2.5} />
                </div>
                <h3 className="text-xl font-black text-gray-900 mb-2">Cancel Delivery?</h3>
                {waitingPricing?.cancellation_policy_message ? (
                  <p className="text-[11px] font-semibold text-red-500 bg-red-50/50 rounded-xl p-3 mb-6 leading-relaxed text-left border border-red-100/30">
                    {waitingPricing.cancellation_policy_message}
                  </p>
                ) : (
                  <p className="text-sm font-bold text-gray-400 mb-8 leading-relaxed">
                    Your delivery agent is already moving. Cancellation may incur charges.
                  </p>
                )}
                <div className="flex flex-col gap-3">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      if (waitingPricing?.enable_cancellation_reasons !== false) {
                        setShowReasonSelection(true);
                      } else {
                        api.patch(`/rides/${rideId}/cancel`, { reason: 'User cancelled' }).then((res) => {
                          const bill = res?.data?.data?.cancellationBill;
                          if (bill && (Number(bill.cancellationFee) > 0 || Number(bill.waitingCharge) > 0)) {
                            setCancellationBill(bill);
                            setShowCancellationBillModal(true);
                            setShowCancelConfirm(false);
                            setShowReasonSelection(false);
                          } else {
                            clearCurrentRide();
                            navigate(userHomeRoute, { replace: true });
                          }
                        }).catch(() => {
                          clearCurrentRide();
                          navigate(userHomeRoute, { replace: true });
                        });
                      }
                    }}
                    className="w-full bg-red-500 text-white py-5 rounded-[24px] text-sm font-black uppercase tracking-widest shadow-xl shadow-red-500/20"
                  >
                    Yes, Cancel
                  </motion.button>
                  <button onClick={() => setShowCancelConfirm(false)} className="w-full py-4 text-sm font-black text-gray-400 uppercase tracking-widest">Keep Tracking</button>
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
              onClick={() => {
                setShowCancellationBillModal(false);
                clearCurrentRide();
                navigate(userHomeRoute, { replace: true });
              }}
              className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[100] max-w-lg mx-auto"
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
              <h3 className="text-[18px] font-black text-gray-900 text-center mb-1.5">Cancellation Receipt</h3>
              <p className="text-[12px] font-bold text-slate-400 text-center mb-6">
                Your delivery has been cancelled. Waiting time and cancellation fees are calculated below:
              </p>

              <div className="space-y-3.5 border-t border-b border-slate-100 py-4 mb-6">
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Standard Cancellation Fee</span>
                  <span className="text-slate-800">₹{cancellationBill?.cancellationFee || 0}.00</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Waiting Time</span>
                  <span className="text-slate-800">{cancellationBill?.waitingTimeMinutes || 0} mins</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Waiting Charge</span>
                  <span className="text-slate-800">₹{cancellationBill?.waitingCharge || 0}.00</span>
                </div>
                <div className="flex justify-between items-center pt-2.5 border-t border-slate-100/60 font-black text-[14px]">
                  <span className="text-gray-900">Total Deducted</span>
                  <span className="text-red-500">₹{cancellationBill?.totalCancellationFee || 0}.00</span>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  setShowCancellationBillModal(false);
                  clearCurrentRide();
                  navigate(userHomeRoute, { replace: true });
                }}
                className="w-full bg-gray-900 text-white py-3.5 rounded-[16px] text-[13px] font-bold uppercase tracking-widest"
              >
                Okay
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

const ActionButton = ({ icon: Icon, label, onClick, color = 'gray' }) => (
  <motion.button
    whileTap={{ scale: 0.94 }}
    onClick={onClick}
    className={`flex flex-col items-center gap-1.5 py-4 rounded-[24px] border ${
      color === 'dark'
        ? 'bg-slate-900 border-slate-900 text-white'
        : 'bg-gray-50 border-gray-100 text-gray-700'
    }`}
  >
    <Icon size={20} strokeWidth={2.5} />
    <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
  </motion.button>
);

export default ParcelTracking;
