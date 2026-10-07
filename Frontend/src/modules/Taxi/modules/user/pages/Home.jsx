import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, ChevronRight, Clock3, MapPin, ShieldCheck, User, X, ArrowRight } from 'lucide-react';
import HeaderGreeting from '../components/HeaderGreeting';
import FeaturesHighlight from '../components/FeaturesHighlight';
import ServiceGrid from '../components/ServiceGrid';
import LocationMapSection from '../components/LocationMapSection';
import ActionsSection from '../components/ActionsSection';
import PromoBanners from '../components/PromoBanners';
import ExplorerSection from '../components/ExplorerSection';
import BottomNavbar from '../components/BottomNavbar';
import indiaGateRealImg from '@/assets/india_gate_real.png';
import api from '../../../shared/api/axiosInstance';
import { useSettings } from '../../../shared/context/SettingsContext';
import {
  CURRENT_RIDE_UPDATED_EVENT,
  getCurrentRide,
  isActiveCurrentRide,
  saveCurrentRide,
  clearCurrentRide,
} from '../services/currentRideService';

const Motion = motion;
const ACTIVE_RIDE_SYNC_INTERVAL_MS = 12000;
const IDLE_RIDE_SYNC_INTERVAL_MS = 30000;
const DEFERRED_SECTION_DELAY_MS = 250;

const getCurrentRideIcon = (ride) => {
  const customIcon = String(
    ride?.vehicleIconUrl ||
    ride?.vehicle?.vehicleIconUrl ||
    ride?.vehicle?.icon ||
    ride?.driver?.vehicleIconUrl ||
    '',
  ).trim();

  if (customIcon) {
    return customIcon;
  }

  return null;
};

const unwrapApiPayload = (response) => response?.data?.data || response?.data || response;

const formatScheduledDateTime = (value) => {
  if (!value) {
    return 'Scheduled time pending';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Scheduled time pending';
  }

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
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

const Home = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const isTaxi = location.pathname.includes('/taxi');
  const theme = {
    activeBg: isTaxi ? 'bg-[#2563eb]' : 'bg-[#d82c23]',
    activeHex: isTaxi ? '#2563eb' : '#d82c23',
    inactiveHex: isTaxi ? '#0c1428' : '#6e0d09',
    containerHex: isTaxi ? '#111d3a' : '#9c1c16',
  };

  const [currentRide, setCurrentRide] = useState(() => {
    const ride = getCurrentRide();
    return isActiveCurrentRide(ride) ? ride : null;
  });
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [showDeferredSections, setShowDeferredSections] = useState(false);
  const [bgIndex, setBgIndex] = useState(0);
  const footerImages = useMemo(() => ['/food/taxi1.jpeg', '/food/taxi2.jpeg'], []);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex((prev) => (prev + 1) % footerImages.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [footerImages]);

  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const currentRideRef = useRef(currentRide);

  const persistCurrentRide = (ride) => {
    const normalizedRide = isActiveCurrentRide(ride) ? ride : null;
    setCurrentRide(normalizedRide);

    if (normalizedRide) {
      saveCurrentRide(normalizedRide);
    } else {
      clearCurrentRide();
    }
  };

  useEffect(() => {
    currentRideRef.current = currentRide;
  }, [currentRide]);

  useEffect(() => {
    const token = localStorage.getItem('userToken') || localStorage.getItem('token');
    if (!token) {
      navigate('/taxi/user/login', { replace: true });
    }
  }, [navigate]);

  const shouldTickClock =
    Number.isFinite(currentRide?.scheduledAt ? new Date(currentRide.scheduledAt).getTime() : NaN);

  useEffect(() => {
    if (!shouldTickClock) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [shouldTickClock]);

  useEffect(() => {
    let cancelled = false;
    const scheduleDeferredSections = window.requestIdleCallback
      ? window.requestIdleCallback(() => {
          if (!cancelled) {
            setShowDeferredSections(true);
          }
        }, { timeout: DEFERRED_SECTION_DELAY_MS })
      : window.setTimeout(() => {
          if (!cancelled) {
            setShowDeferredSections(true);
          }
        }, DEFERRED_SECTION_DELAY_MS);

    return () => {
      cancelled = true;
      if (typeof scheduleDeferredSections === 'number') {
        window.clearTimeout(scheduleDeferredSections);
        return;
      }

      window.cancelIdleCallback?.(scheduleDeferredSections);
    };
  }, []);

  useEffect(() => {
    const refreshCurrentRide = () => {
      const ride = getCurrentRide();
      setCurrentRide(isActiveCurrentRide(ride) ? ride : null);
    };

    refreshCurrentRide();
    window.addEventListener('storage', refreshCurrentRide);
    window.addEventListener(CURRENT_RIDE_UPDATED_EVENT, refreshCurrentRide);

    let cancelled = false;
    let syncTimer = null;
    let syncInFlight = false;

    const scheduleNextSync = () => {
      if (cancelled) {
        return;
      }

      const nextInterval = currentRideRef.current ? ACTIVE_RIDE_SYNC_INTERVAL_MS : IDLE_RIDE_SYNC_INTERVAL_MS;
      syncTimer = window.setTimeout(() => {
        syncCurrentRide();
      }, nextInterval);
    };

    const syncCurrentRide = async () => {
      if (cancelled || syncInFlight || document.visibilityState === 'hidden') {
        scheduleNextSync();
        return;
      }

      syncInFlight = true;
      try {
        let rideData = null;

        try {
          rideData = unwrapApiPayload(await api.get('/rides/active/me'));
        } catch (error) {
          const status = Number(error?.response?.status || 0);
          if (status !== 404) {
            throw error;
          }
        }

        if (rideData?._id || rideData?.rideId) {
          const normalizedRide = {
            rideId: rideData._id || rideData.rideId,
            pickup: rideData.pickupAddress || rideData.pickup,
            drop: rideData.dropAddress || rideData.drop,
            pickupCoords: rideData.pickupLocation?.coordinates || rideData.pickupCoords || null,
            dropCoords: rideData.dropLocation?.coordinates || rideData.dropCoords || null,
            fare: rideData.fare,
            baseFare: rideData.baseFare || rideData.fare || 0,
            status: rideData.status,
            liveStatus: rideData.liveStatus,
            serviceType: rideData.serviceType,
            scheduledAt: rideData.scheduledAt || null,
            acceptedAt: rideData.acceptedAt || null,
            arrivedAt: rideData.arrivedAt || null,
            estimatedDistanceMeters: rideData.estimatedDistanceMeters || 0,
            estimatedDurationMinutes: rideData.estimatedDurationMinutes || 0,
            paymentMethod: rideData.paymentMethod || 'Cash',
            pricingSnapshot: rideData.pricingSnapshot || null,
            otp: rideData.otp || '',
            driver: rideData.driverId || rideData.driver,
            vehicleIconUrl: rideData.vehicleIconUrl,
            vehicleIconType: rideData.vehicleIconType,
          };
          if (cancelled) return;
          persistCurrentRide(normalizedRide);
          currentRideRef.current = normalizedRide;
          return;
        }

        if (cancelled) return;
        persistCurrentRide(null);
        currentRideRef.current = null;
      } finally {
        syncInFlight = false;
        scheduleNextSync();
      }
    };

    const handleWindowFocus = () => {
      if (document.visibilityState !== 'hidden') {
        syncCurrentRide();
      }
    };

    syncCurrentRide();
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      cancelled = true;
      if (syncTimer) {
        window.clearTimeout(syncTimer);
      }
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
      window.removeEventListener('storage', refreshCurrentRide);
      window.removeEventListener(CURRENT_RIDE_UPDATED_EVENT, refreshCurrentRide);
    };
  }, []);

  const driverName = currentRide?.driver?.name || 'Captain';
  const serviceType = String(currentRide?.serviceType || currentRide?.type || 'ride').toLowerCase();
  const vehicleLabel = currentRide?.driver?.vehicle || currentRide?.driver?.vehicleType || 'Taxi';
  const currentRideIcon = getCurrentRideIcon(currentRide);
  const trackingPath = `${routePrefix}/ride/tracking`;
  const rideStage = String(currentRide?.liveStatus || currentRide?.status || 'accepted').toLowerCase();
  const hasAssignedDriver = Boolean(currentRide?.driver?._id || currentRide?.driver?.id || currentRide?.driver?.name);
  const scheduledTimestamp = currentRide?.scheduledAt ? new Date(currentRide.scheduledAt).getTime() : NaN;
  const isScheduledRide = Number.isFinite(scheduledTimestamp);
  const isScheduledUpcoming = isScheduledRide && scheduledTimestamp > clockNow;
  const isScheduledAcceptedRide = ['ride', 'intercity'].includes(serviceType) && isScheduledUpcoming && hasAssignedDriver && ['accepted', 'arriving'].includes(rideStage);
  const rideStageLabel =
    rideStage === 'started'
        ? 'Ride in progress'
        : rideStage === 'arrived'
        ? `${driverName} reached destination`
        : rideStage === 'arriving'
        ? `${driverName} has arrived`
        : 'Ride booked';
  const rideStageContextLabel = isScheduledAcceptedRide
    ? 'Driver assigned for your scheduled trip'
    : rideStageLabel;
  const scheduledDateLabel = formatScheduledDateTime(currentRide?.scheduledAt);
  const scheduledCountdown = getScheduledCountdownLabel(currentRide?.scheduledAt, clockNow);
  const footerIllustrationBg = {
    backgroundImage: `url(${footerImages[bgIndex]})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center calc(100% + 65px)',
    backgroundSize: 'cover',
  };
  const footerIllustrationFadeMask = {
    WebkitMaskImage:
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)',
    maskImage:
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,1) 88%, rgba(0,0,0,0) 100%)',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
  };

  const footerIllustrationEdgeBlurMask = {
    WebkitMaskImage:
      'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 16%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 100%)',
    maskImage:
      'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 16%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 100%)',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
  };

  return (
    <div className="min-h-screen bg-[#111d3a] pb-24 max-w-lg mx-auto relative overflow-hidden font-sans no-scrollbar">
      <div className="absolute top-0 right-0 h-40 w-40 rounded-full bg-blue-900/10 blur-[80px] pointer-events-none" />
      <div className="absolute bottom-20 left-0 h-40 w-40 rounded-full bg-indigo-900/10 blur-[80px] pointer-events-none" />


      <div className="relative z-10 space-y-4 pb-6">
        <HeaderGreeting />

        {!isScheduledAcceptedRide && (
          <>
            <ServiceGrid />
            <FeaturesHighlight bgImageUrl={footerImages[bgIndex]} />
          </>
        )}

        {isScheduledAcceptedRide && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => navigate(trackingPath, { state: currentRide })}
            className="mx-5 block w-[calc(100%-2.5rem)] overflow-hidden rounded-[32px] border border-emerald-100/50 bg-[linear-gradient(135deg,#ffffff_0%,#f0fdf4_100%)] p-6 text-left shadow-[0_24px_48px_rgba(16,185,129,0.12)]"
          >
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/50 px-3 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-700">
                <ShieldCheck size={12} strokeWidth={3} />
                Confirmed
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Live Status</span>
              </div>
            </div>

            <div className="mt-5 flex items-end justify-between">
              <div className="min-w-0">
                <h2 className="text-[32px] font-black tracking-tight text-slate-950 leading-none">
                  {scheduledCountdown}
                </h2>
                <p className="mt-2 text-[14px] font-bold text-slate-500">
                  {scheduledDateLabel}
                </p>
              </div>
              <div className="relative mb-1">
                <div className="absolute -inset-4 rounded-full bg-emerald-100/30 blur-xl animate-pulse" />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 shadow-2xl shadow-slate-950/40 border border-slate-800">
                  {currentRideIcon && <img src={currentRideIcon} alt="Vehicle" className="h-10 w-10 object-contain" />}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/60 p-3 shadow-sm border border-white">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 shrink-0 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-100">
                  <User size={20} className="text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 leading-none">Driver & Vehicle</p>
                  <p className="mt-1 truncate text-[13px] font-black text-slate-900">{driverName} • {vehicleLabel}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 leading-none">Fare</p>
                <p className="mt-1 text-[13px] font-black text-slate-900">₹{Number(currentRide?.fare || 0).toFixed(0)}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-950 px-4 py-3.5 text-white shadow-xl shadow-slate-950/20">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/40">Trip Route</p>
                <div className="mt-1 flex items-center gap-2 text-[12px] font-bold">
                  <span className="truncate max-w-[100px] text-white/90">{(currentRide?.pickup || 'Pickup').split(',')[0]}</span>
                  <ChevronRight size={12} className="text-white/30" />
                  <span className="truncate max-w-[100px] text-emerald-400">{(currentRide?.drop || 'Drop').split(',')[0]}</span>
                </div>
              </div>
              <div className="h-8 w-8 shrink-0 rounded-full bg-white/10 flex items-center justify-center">
                <ChevronRight size={18} strokeWidth={3} className="text-white" />
              </div>
            </div>
          </motion.button>
        )}
        
        {showDeferredSections ? (
          <>
            <LocationMapSection />
            <ActionsSection />
            <ExplorerSection />
          </>
        ) : (
          <div className="space-y-4 px-5">
            <div className="h-[170px] animate-pulse rounded-[20px] border border-white/80 bg-white/70 shadow-[0_10px_22px_rgba(15,23,42,0.05)]" />
            <div className="h-[112px] animate-pulse rounded-[24px] border border-white/80 bg-white/70 shadow-[0_10px_22px_rgba(15,23,42,0.05)]" />
            <div className="h-[160px] animate-pulse rounded-[24px] border border-white/80 bg-white/70 shadow-[0_10px_22px_rgba(15,23,42,0.05)]" />
          </div>
        )}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative w-full overflow-hidden shadow-[0_-10px_40px_rgba(15,23,42,0.05)]"
          style={{ height: 380 }}
        >
          {/* Shimmer Effect overlay from the old PromoBanner */}
          <motion.div 
            animate={{ x: ["-100%", "200%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear", delay: 1 }}
            className="absolute inset-0 z-30 w-[50%] bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] pointer-events-none"
          />

          <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-[#EEF2F7] via-[#EEF2F7]/80 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-900/70 to-transparent" />
            <div className="absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-slate-950 to-transparent" />
          </div>

          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              filter: 'brightness(0.9) contrast(1.05)',
              ...footerIllustrationFadeMask,
            }}
          >
            <div className="absolute inset-0 transition-all duration-1000 ease-in-out bg-cover bg-right" style={footerIllustrationBg} />
          </div>

          {/* Promotional Content Overlay - Aligned Top/Center Left */}
          <div className="absolute top-24 left-0 right-12 px-8 z-20 flex flex-col items-start text-left">
            <motion.h3 
              initial={{ x: -20, opacity: 0 }}
              whileInView={{ x: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="text-[30px] font-black text-white leading-tight drop-shadow-lg tracking-tight"
            >
              Everywhere you <br /> want to be.
            </motion.h3>
            <motion.p 
              initial={{ x: -20, opacity: 0 }}
              whileInView={{ x: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="mt-3 text-[14px] font-bold text-slate-300 drop-shadow-md"
            >
              Reliable rides. Transparent pricing.
            </motion.p>
            <motion.button 
              initial={{ x: -20, opacity: 0 }}
              whileInView={{ x: 0, opacity: 1 }}
              viewport={{ once: true }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={{ delay: 0.4 }}
              onClick={() => navigate('/taxi/user/ride/select-location')}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-[14px] font-black text-slate-900 shadow-[0_8px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_12px_25px_rgba(0,0,0,0.4)] transition-all"
            >
              Book a Ride
              <ArrowRight size={18} strokeWidth={3} />
            </motion.button>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {currentRide && (
          <Motion.div
            initial={{ y: 32, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.95 }}
            onClick={() => navigate(trackingPath, { state: currentRide })}
            className="fixed bottom-28 left-4 right-4 z-[60] mx-auto flex max-w-[calc(32rem-2rem)] items-center justify-between rounded-[28px] border border-slate-100 bg-white p-4 pr-5 text-left shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl cursor-pointer hover:bg-slate-50/80 transition-all duration-200"
          >
            {/* Left side: Icon + Info */}
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Icon Container with dynamic theme opacity background */}
              <div 
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] border"
                style={{ 
                  backgroundColor: `${theme.activeHex}15`,
                  borderColor: `${theme.activeHex}25` 
                }}
              >
                <img 
                  src={currentRideIcon} 
                  alt={vehicleLabel} 
                  className="h-10 w-10 object-contain" 
                  style={{ filter: 'url(#remove-white)' }}
                  draggable={false} 
                />
              </div>

              {/* Title and Subtitle Status */}
              <div className="min-w-0">
                <h4 className="text-[16px] font-black text-slate-900 leading-tight tracking-tight">
                  Quick Drop
                </h4>
                <p 
                  className="text-[12px] font-bold mt-1 flex items-center gap-0.5 leading-none"
                  style={{ color: theme.activeHex }}
                >
                  {rideStageContextLabel}
                  <ChevronRight size={12} className="stroke-[3]" />
                </p>
              </div>
            </div>

            {/* Right side: Arriving Pill with Dismiss Close Button */}
            <div className="relative shrink-0 flex items-center ml-3">
              <div 
                className="flex flex-col justify-center items-center rounded-[20px] text-white px-4 py-2.5 min-w-[95px] text-center shadow-lg"
                style={{ 
                  backgroundColor: theme.activeHex,
                  boxShadow: `0 8px 20px ${theme.activeHex}35`
                }}
              >
                <span className="text-[8px] font-extrabold uppercase tracking-widest opacity-90 leading-none">
                  {rideStage === 'arrived' ? 'REACHED' : 'ARRIVING IN'}
                </span>
                <span className="text-[16px] font-black leading-tight mt-0.5">
                  {rideStage === 'arrived' ? 'Now' : `${currentRide?.estimatedDurationMinutes || 5} min`}
                </span>
              </div>

              {/* Close / Dismiss Button */}
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  persistCurrentRide(null); // Clear active ride representation
                }}
                className="absolute -top-1.5 -right-1.5 bg-white text-slate-400 hover:text-slate-600 rounded-full p-1 border border-slate-100 shadow-md hover:scale-105 active:scale-95 transition-transform"
              >
                <X size={10} className="stroke-[3]" />
              </button>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>

      <BottomNavbar />
    </div>
  );
};

export default Home;
