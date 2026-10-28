import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Banknote,
  Bike,
  Clock,
  CreditCard,
  MapPin,
  Navigation,
  Phone,
  Package,
  Route,
  User,
  X,
} from 'lucide-react';
import { getScheduledRideCountdown } from '../utils/scheduledRideTime';

const Motion = motion;
const DEFAULT_ACCEPT_REJECT_SECONDS = 15;

const normalizePayment = (value = '') => String(value || 'cash').toUpperCase();

const getRequestExpiryTime = (data, requestDurationSeconds) => {
  const safeData = data || {};
  const rawExpiryTime = safeData.requestExpiresAt || safeData.raw?.requestExpiresAt;
  const expiryTimestamp = rawExpiryTime ? new Date(rawExpiryTime).getTime() : NaN;

  if (Number.isFinite(expiryTimestamp) && expiryTimestamp > Date.now()) {
    return expiryTimestamp;
  }

  return Date.now() + (requestDurationSeconds * 1000);
};

const getRequestDurationSeconds = (data) => {
  const safeData = data || {};
  const rawDuration = safeData.acceptRejectDurationSeconds ||
    safeData.expiresInSeconds ||
    safeData.raw?.acceptRejectDurationSeconds ||
    safeData.raw?.expiresInSeconds;
  const duration = Number(rawDuration);

  return Number.isFinite(duration) && duration > 0
    ? Math.ceil(duration)
    : DEFAULT_ACCEPT_REJECT_SECONDS;
};

const formatScheduledDateTime = (value) => {
  if (!value) {
    return 'Schedule time not available';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Schedule time not available';
  }

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const IncomingRideRequest = ({
  visible,
  onAccept,
  onDecline,
  onSubmitBid,
  onClose,
  requestData,
  isAccepting = false,
  onPreviewCancel,
  isPreviewCancelling = false,
  canPreviewCancel = true,
  previewCancelDisabledLabel = 'Cancel unavailable',
  previewCancelHelpText = '',
  mode = 'live',
}) => {
  const isPreviewMode = mode === 'preview';
  const requestDurationSeconds = getRequestDurationSeconds(requestData);
  const [timer, setTimer] = useState(requestDurationSeconds);
  const [previewNow, setPreviewNow] = useState(() => Date.now());
  const data = requestData;

  useEffect(() => {
    if (isPreviewMode || !visible || !data?.rideId) {
      return undefined;
    }

    const expiresAt = getRequestExpiryTime(data, requestDurationSeconds);
    let hasExpired = false;

    const syncTimer = () => {
      const remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setTimer(remainingSeconds);

      if (!hasExpired && remainingSeconds <= 0) {
        hasExpired = true;
        onDecline();
      }
    };

    syncTimer();
    const interval = setInterval(syncTimer, 250);

    return () => {
      clearInterval(interval);
    };
  }, [visible, onDecline, requestDurationSeconds, data?.rideId, data?.requestExpiresAt, isPreviewMode]);

  useEffect(() => {
    if (!visible || !isPreviewMode) {
      return undefined;
    }

    setPreviewNow(Date.now());
    const interval = setInterval(() => {
      setPreviewNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [visible, isPreviewMode]);

  if (!visible || !data) return null;

  const isParcel = data.type === 'parcel';
  const isIntercity = data.type === 'intercity';
  const scheduledAt = data.scheduledAt || data.raw?.scheduledAt || data.raw?.ride?.scheduledAt || null;
  const isScheduledRequest = Boolean(scheduledAt);
  const title = isPreviewMode
    ? (isParcel ? 'Scheduled delivery' : isIntercity ? 'Scheduled intercity trip' : 'Scheduled ride')
    : (isScheduledRequest
      ? (isParcel ? 'Scheduled delivery request' : isIntercity ? 'Scheduled intercity request' : 'Scheduled ride request')
      : (isParcel ? 'New delivery request' : isIntercity ? 'New intercity request' : 'New ride request'));
  const intercityRoute = [data.raw?.intercity?.fromCity, data.raw?.intercity?.toCity].filter(Boolean).join(' to ');
  const category = data.raw?.parcel?.category || data.raw?.parcel?.weight || (isParcel ? 'Parcel delivery' : isIntercity ? intercityRoute || 'Intercity trip' : 'Passenger ride');
  const payment = normalizePayment(data.payment);
  const timerProgress = Math.max(0, Math.min(100, (timer / requestDurationSeconds) * 100));
  const accentClass = isParcel ? 'bg-primary-orange/50' : isIntercity ? 'bg-yellow-400' : 'bg-blue-600';
  const accentTextClass = isParcel ? 'text-accent-orange' : isIntercity ? 'text-yellow-700' : 'text-blue-600';
  const pickupAddress = data.raw?.pickupAddress || data.pickup || 'Pickup point';
  const dropAddress = data.raw?.dropAddress || data.drop || 'Drop point';
  const attemptCount = Number(data.attempt || data.raw?.attempt || 1);
  const maxAttempts = Number(data.maxAttempts || data.raw?.maxAttempts || 1);
  const searchRadiusMeters = Number(data.raw?.radius || data.radius || 0);
  const searchRadiusLabel = searchRadiusMeters > 0 ? `${(searchRadiusMeters / 1000).toFixed(1)} km` : 'nearby';
  const customerName = data.customer?.name || data.raw?.user?.name || 'Customer';
  const customerPhone = [data.customer?.countryCode, data.customer?.phone]
    .filter(Boolean)
    .join(' ')
    .trim() || data.raw?.user?.phone || '';
  const pricingNegotiationMode = String(data.raw?.pricingNegotiationMode || 'none').toLowerCase();
  const isBidding = pricingNegotiationMode === 'driver_bid' && (Boolean(data.raw?.bidding?.enabled) || String(data.raw?.bookingMode || '').toLowerCase() === 'bidding');
  const isUserIncrementOnly = pricingNegotiationMode === 'user_increment_only';
  const fareWasIncreased = isUserIncrementOnly && Number(data.raw?.fare || 0) > Number(data.raw?.baseFare || data.raw?.fare || 0);
  const bidBaseFare = Number(data.raw?.bidding?.baseFare || data.raw?.baseFare || data.raw?.fare || 0);
  const bidFloorFare = Number(data.raw?.bidding?.bidFloorFare || bidBaseFare);
  const bidMaxFare = Number(data.raw?.bidding?.userMaxBidFare || data.raw?.userMaxBidFare || bidBaseFare);
  const bidStepAmount = Number(data.raw?.bidding?.bidStepAmount || 10);
  const scheduledCountdown = getScheduledRideCountdown(scheduledAt, previewNow);
  const bidOptions = isBidding
    ? Array.from({ length: Math.max(1, Math.floor((bidMaxFare - bidFloorFare) / bidStepAmount) + 1) }, (_, index) => bidFloorFare + (index * bidStepAmount))
    : [];

  return (
    <AnimatePresence mode="wait">
      <Motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 px-3 pb-4 sm:pb-8 backdrop-blur-[2px]"
      >
        <Motion.div
          initial={{ y: 80, scale: 0.96 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: 80, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          className="relative w-full max-w-[430px] overflow-x-hidden overflow-y-auto rounded-[28px] bg-white shadow-[0_30px_90px_rgba(0,0,0,0.28)] max-h-[calc(100dvh-2rem)]"
        >
          {!isPreviewMode ? (
            <div className="absolute inset-x-0 top-0 h-1 bg-slate-100">
              <Motion.div className={`h-full ${accentClass}`} animate={{ width: `${timerProgress}%` }} transition={{ duration: 0.35 }} />
            </div>
          ) : null}

          <div className="bg-slate-950 px-5 pb-5 pt-6 text-white">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] ${accentClass} text-slate-950 shadow-[0_10px_24px_rgba(0,0,0,0.24)]`}>
                  {isParcel ? <Package size={26} /> : isIntercity ? <Navigation size={26} /> : <Bike size={26} />}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/45">{isPreviewMode ? 'Scheduled trip' : 'Ride offer'}</p>
                  <h2 className="mt-1 text-[21px] font-black leading-tight tracking-tight">{title}</h2>
                  <p className="mt-0.5 truncate text-[12px] font-semibold text-white/55">{category}</p>
                  {isPreviewMode ? (
                    <p className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.14em] text-white/35">
                      Scheduled for {formatScheduledDateTime(scheduledAt)}
                    </p>
                  ) : isScheduledRequest ? (
                    <p className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">
                      Scheduled for {formatScheduledDateTime(scheduledAt)}
                    </p>
                  ) : (
                    <p className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.14em] text-white/35">
                      Wave {attemptCount} of {maxAttempts} • Radius {searchRadiusLabel}
                    </p>
                  )}
                  {fareWasIncreased ? (
                    <p className="mt-1 inline-flex rounded-full bg-emerald-400/15 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">
                      Fare increased
                    </p>
                  ) : null}
                </div>
              </div>

              {isPreviewMode ? (
                <button
                  type="button"
                  onClick={onClose || onDecline}
                  className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/80 transition-all active:scale-95"
                >
                  <X size={20} />
                </button>
              ) : (
                <div
                  className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full"
                  style={{ background: `conic-gradient(${isParcel ? '#f97316' : isIntercity ? '#facc15' : '#2563eb'} ${timerProgress}%, rgba(255,255,255,0.14) 0)` }}
                >
                  <div className="grid h-[48px] w-[48px] place-items-center rounded-full bg-slate-950">
                    <span className="text-[20px] font-black leading-none">{timer}</span>
                    <span className="-mt-1 text-[7px] font-black uppercase tracking-widest text-white/35">sec</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="px-5 pb-5 pt-4">
            <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-[18px] border border-slate-100 bg-slate-50">
              <div className="px-3 py-3">
                <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                  <Route size={13} />
                  <p className="text-[8px] font-black uppercase tracking-widest">Distance</p>
                </div>
                <p className="truncate text-[14px] font-black text-slate-950">{data.distance || 'Nearby'}</p>
              </div>
              <div className="border-x border-slate-100 px-3 py-3">
                <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                  <Banknote size={13} />
                  <p className="text-[8px] font-black uppercase tracking-widest">Earn</p>
                </div>
                <p className="truncate text-[18px] font-black leading-none text-slate-950">{data.fare || 'Rs 0'}</p>
              </div>
              <div className="px-3 py-3">
                <div className="mb-1 flex items-center gap-1.5 text-slate-400">
                  {payment.includes('CASH') ? <Banknote size={13} /> : <CreditCard size={13} />}
                  <p className="text-[8px] font-black uppercase tracking-widest">Pay</p>
                </div>
                <p className={`truncate text-[12px] font-black ${accentTextClass}`}>{payment}</p>
              </div>
            </div>

            {isPreviewMode ? (
              <div className="mb-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white text-blue-600 shadow-sm">
                    <Clock size={18} strokeWidth={2.3} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[8px] font-black uppercase tracking-[0.18em] text-blue-500/70">Scheduled time</p>
                    <p className="mt-1 text-[14px] font-black text-slate-950">{formatScheduledDateTime(scheduledAt)}</p>
                    <p className="mt-1 text-[11px] font-black text-blue-600">{scheduledCountdown}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">This request is stored for later dispatch and shown here with full details.</p>
                  </div>
                </div>
              </div>
            ) : isScheduledRequest ? (
              <div className="mb-4 rounded-[18px] border border-emerald-100 bg-emerald-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white text-emerald-600 shadow-sm">
                    <Clock size={18} strokeWidth={2.3} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[8px] font-black uppercase tracking-[0.18em] text-emerald-600/80">Scheduled time</p>
                    <p className="mt-1 text-[14px] font-black text-slate-950">{formatScheduledDateTime(scheduledAt)}</p>
                    <p className="mt-1 text-[11px] font-black text-emerald-600">{scheduledCountdown}</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-500">
                      This is a scheduled request. Accept only if you can commit to this pickup slot.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {isIntercity && (
              <div className="mb-4 grid grid-cols-3 gap-2 rounded-[16px] border border-yellow-100 bg-yellow-50 px-3 py-3">
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-yellow-700/60">Trip</p>
                  <p className="mt-1 truncate text-[11px] font-black text-slate-900">{data.raw?.intercity?.tripType || 'Intercity'}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-yellow-700/60">Date</p>
                  <p className="mt-1 truncate text-[11px] font-black text-slate-900">{data.raw?.intercity?.travelDate || 'Today'}</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-yellow-700/60">Pax</p>
                  <p className="mt-1 truncate text-[11px] font-black text-slate-900">{data.raw?.intercity?.passengers || 1}</p>
                </div>
              </div>
            )}

            <div className="mb-4 rounded-[18px] border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white border border-slate-100 text-slate-700 shadow-sm">
                  <User size={18} strokeWidth={2.3} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-400">Customer</p>
                  <p className="mt-1 truncate text-[14px] font-black text-slate-950">{customerName}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-slate-500">
                    <Phone size={11} strokeWidth={2.5} />
                    <p className="truncate text-[11px] font-bold">{customerPhone || 'Phone not available'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-5 rounded-[20px] border border-slate-100 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
              <div className="relative">
                <div className="absolute left-[10px] top-6 bottom-6 w-px bg-slate-200" />
                <div className="flex items-start gap-3">
                  <div className="relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </div>
                  <div className="min-w-0 flex-1 pb-5">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Pickup</p>
                    <p className="mt-1 line-clamp-2 text-[14px] font-black leading-snug text-slate-950">{pickupAddress}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-orange/5">
                    <MapPin size={13} className="text-primary-orange/50" fill="currentColor" strokeWidth={0} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">Drop</p>
                    <p className="mt-1 line-clamp-2 text-[14px] font-black leading-snug text-slate-950">{dropAddress}</p>
                  </div>
                </div>
              </div>
            </div>

            {isPreviewMode ? (
              onPreviewCancel ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={onClose || onDecline}
                    disabled={isPreviewCancelling}
                    className="flex h-[58px] items-center justify-center rounded-[18px] border border-slate-200 bg-white px-5 text-[12px] font-black uppercase tracking-[0.14em] text-slate-500 shadow-sm transition-all active:scale-95 disabled:opacity-60"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (canPreviewCancel) {
                        onPreviewCancel(data);
                      }
                    }}
                    disabled={isPreviewCancelling || !canPreviewCancel}
                    className="flex h-[58px] items-center justify-center rounded-[18px] bg-rose-500 px-5 text-[12px] font-black uppercase tracking-[0.14em] text-white shadow-[0_14px_30px_rgba(244,63,94,0.28)] transition-all active:scale-95 disabled:opacity-60"
                  >
                    {isPreviewCancelling ? 'Cancelling...' : canPreviewCancel ? 'Cancel ride' : previewCancelDisabledLabel}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onClose || onDecline}
                  className="flex h-[58px] w-full items-center justify-center rounded-[18px] bg-slate-900 px-5 text-[13px] font-black uppercase tracking-[0.16em] text-white shadow-[0_14px_30px_rgba(15,23,42,0.2)] transition-all active:scale-95"
                >
                  Close details
                </button>
              )
            ) : (
              <>
                <div className="grid grid-cols-[86px_1fr] gap-3 items-end">
                  <button
                    type="button"
                    onClick={onDecline}
                    disabled={isAccepting}
                    className="flex h-[58px] items-center justify-center rounded-[18px] border border-slate-200 bg-white text-slate-500 shadow-sm transition-all active:scale-95 disabled:opacity-60"
                  >
                    <X size={24} />
                  </button>
                  {isBidding ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {bidOptions.slice(0, 6).map((bidValue) => (
                          <button
                            key={bidValue}
                            type="button"
                            onClick={() => onSubmitBid?.(bidValue)}
                            disabled={isAccepting}
                            className="rounded-[14px] border border-primary-orange/20 bg-primary-orange/5 px-2 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-accent-orange disabled:opacity-60"
                          >
                            Rs {bidValue}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSubmitBid?.(bidBaseFare)}
                        disabled={isAccepting}
                        className={`flex h-[58px] w-full items-center justify-center rounded-[18px] ${accentClass} px-5 text-[13px] font-black uppercase tracking-[0.16em] ${isParcel || isIntercity ? 'text-slate-950' : 'text-white'} shadow-[0_14px_30px_rgba(37,99,235,0.28)] transition-all active:scale-95 disabled:opacity-70`}
                      >
                        {isAccepting ? 'Submitting...' : 'Send Bid'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAccept(data)}
                      disabled={isAccepting}
                      className={`flex h-[58px] items-center justify-center rounded-[18px] ${accentClass} px-5 text-[13px] font-black uppercase tracking-[0.16em] ${isParcel || isIntercity ? 'text-slate-950' : 'text-white'} shadow-[0_14px_30px_rgba(37,99,235,0.28)] transition-all active:scale-95 disabled:opacity-70`}
                    >
                      {isAccepting ? 'Accepting...' : 'Accept ride'}
                    </button>
                  )}
                </div>

                <p className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-400">
                  <Clock size={12} />
                  Request auto-declines when the timer ends.
                </p>
              </>
            )}

            {isPreviewMode && onPreviewCancel && previewCancelHelpText ? (
              <p className="mt-3 text-center text-[10px] font-bold text-slate-400">
                {previewCancelHelpText}
              </p>
            ) : null}
          </div>
        </Motion.div>
      </Motion.div>
    </AnimatePresence>
  );
};

export default IncomingRideRequest;
