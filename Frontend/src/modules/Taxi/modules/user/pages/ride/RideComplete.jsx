import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Banknote, CheckCircle2, ChevronRight, CreditCard, MessageSquare, Receipt, Share2, Star, Wallet } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import { userAuthService } from '../../services/authService';
import { clearCurrentRide, getCurrentRide } from '../../services/currentRideService';
import { useSettings } from '../../../../shared/context/SettingsContext';

const TIP_OPTIONS = [0, 20, 50, 100];
const PAYMENT_OPTIONS = [
  { id: 'cash', label: 'COD / Cash', sub: 'Pay driver directly', Icon: Banknote },
  { id: 'online', label: 'Online', sub: 'UPI, cards or Razorpay', Icon: CreditCard },
  { id: 'wallet', label: 'Wallet', sub: 'Use in-app wallet balance', Icon: Wallet },
];
const ONLINE_PAYMENT_OPTIONS = [
  { id: 'upi', label: 'UPI', sub: 'PhonePe, GPay or Paytm' },
  { id: 'card', label: 'Card', sub: 'Debit or credit card' },
  { id: 'netbanking', label: 'Netbanking', sub: 'Choose your bank in checkout' },
];
const PAID_COLLECTION_STATUSES = new Set(['paid', 'captured', 'completed']);

const normalizePaymentChoice = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('wallet')) return 'wallet';
  if (normalized.includes('cash') || normalized.includes('cod')) return 'cash';
  return 'online';
};

const getInitials = (name = '') =>
  String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'DR';

const isLikelyVehiclePhoto = (value = '') => /^(https?:|data:image\/|blob:|\/uploads\/|\/images\/)/i.test(String(value || '').trim());
const isCollectionPaid = (collection = null) =>
  Boolean(collection?.paidAt) || PAID_COLLECTION_STATUSES.has(String(collection?.status || '').trim().toLowerCase());

const getVehicleIcon = (serviceType = 'ride', driver = {}) => {
  const customIcon = String(driver.vehicleIconUrl || driver.map_icon || driver.icon || '').trim();
  if (customIcon) return customIcon;

  return null;
};

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

const RideComplete = () => {
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const navigate = useNavigate();
  const location = useLocation();
  const storedRide = useMemo(() => getCurrentRide(), []);
  const state = useMemo(() => location.state || storedRide || {}, [location.state, storedRide]);

  const [rating, setRating] = useState(() => Number(state.feedback?.rating || 0));
  const [comment, setComment] = useState(() => state.feedback?.comment || '');
  const [selectedTip, setSelectedTip] = useState(() => Number(state.feedback?.tipAmount || 0));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(Boolean(state.feedback?.submittedAt));
  const [step, setStep] = useState(() => {
    if (state.feedback?.submittedAt) {
      if (Number(state.feedback?.rating || 0) === 0) return 'rating';
      return 'success';
    }
    return 'payment';
  });
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [showSubmittedOverlay, setShowSubmittedOverlay] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [error, setError] = useState('');
  const [vehicleImageBroken, setVehicleImageBroken] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(() => normalizePaymentChoice(state.paymentMethod || 'Cash'));
  const [selectedOnlineMethod, setSelectedOnlineMethod] = useState('upi');
  const [walletSnapshot, setWalletSnapshot] = useState({ balance: 0, currency: 'INR' });
  const [walletLoading, setWalletLoading] = useState(false);
  const [paymentCollection, setPaymentCollection] = useState(() => state.driverPaymentCollection || null);
  const [rideLiveStatus, setRideLiveStatus] = useState(() => String(state.liveStatus || state.status || '').toLowerCase());
  const [tipSettings, setTipSettings] = useState({
    enable_tips: '1',
    min_tip_amount: '10',
  });

  const routeHome = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '/';
  const rideId = state.rideId || '';

  const [rideDetails, setRideDetails] = useState({
    fare: Number(state.fare || 22),
    baseFare: Number(
      state?.baseFare ??
      (state?.fare ? (state.fare - (state.waitingChargeAmount || 0) - (state.timeChargeAmount || 0) - (state.distanceChargeAmount || 0) - (state.additionalCharge || 0)) : null) ??
      0
    ),
    waitingChargeAmount: Number(state?.waitingChargeAmount || 0),
    distanceChargeAmount: Number(state?.distanceChargeAmount || 0),
    timeChargeAmount: Number(state?.timeChargeAmount || 0),
    additionalCharge: Number(state?.additionalCharge || 0),
    adminExtraCharge: state?.adminExtraCharge || null,
    cancellationCharge: Number(state?.recovered_cancellation_due || state?.cancellationCharge || 0),
    paymentMethod: state.paymentMethod || 'Cash',
    pickup: state.pickup || 'Pickup',
    drop: state.drop || 'Drop',
    driver: state.driver || {
      name: 'Captain',
      rating: '4.9',
      vehicle: (String(state.serviceType || state.type || 'ride').toLowerCase() === 'parcel') ? 'Delivery' : 'Taxi',
      plate: 'Assigned',
      profileImage: '',
      vehicleImage: '',
    },
    promo: state.promo || null
  });

  const fare = rideDetails.fare;
  const rawBaseFare = rideDetails.baseFare;
  const waitingChargeAmount = rideDetails.waitingChargeAmount;
  const distanceChargeAmount = rideDetails.distanceChargeAmount;
  const timeChargeAmount = rideDetails.timeChargeAmount;
  const additionalCharge = rideDetails.additionalCharge;
  const adminExtraChargeAmount = Number(rideDetails.adminExtraCharge?.amount || 0);
  const cancellationCharge = rideDetails.cancellationCharge;
  
  const promoDiscountAmount = Number(rideDetails.promo?.discount_amount || 0);
  const promoCode = rideDetails.promo?.code || '';
  
  // Merge cancellation charge into base fare so it's not shown separately to the user
  const baseFare = Math.ceil(rawBaseFare + cancellationCharge);
  
  const totalBill = Math.ceil(baseFare + waitingChargeAmount + distanceChargeAmount + timeChargeAmount + additionalCharge + adminExtraChargeAmount - promoDiscountAmount + Number(selectedTip || 0));
  const paymentMethod = rideDetails.paymentMethod;
  const paymentMethodLabel = PAYMENT_OPTIONS.find((option) => option.id === selectedPaymentMethod)?.label || paymentMethod;
  const pickup = rideDetails.pickup;
  const drop = rideDetails.drop;
  const serviceType = String(state.serviceType || state.type || 'ride').toLowerCase();
  const driver = rideDetails.driver;

  const driverImage = driver.profileImage || '';
  const vehicleLabel = driver.vehicle || driver.vehicleType || (serviceType === 'parcel' ? 'Delivery' : 'Taxi');
  const hasVehiclePhoto = isLikelyVehiclePhoto(driver.vehicleImage) && !vehicleImageBroken;
  const vehicleVisual = hasVehiclePhoto ? driver.vehicleImage : getVehicleIcon(serviceType, {
    ...driver,
    vehicleIconUrl: driver.vehicleIconUrl || state.vehicleIconUrl || state.vehicle?.vehicleIconUrl || state.vehicle?.icon || '',
  });
  const rideBaseBill = Math.ceil(baseFare + waitingChargeAmount + distanceChargeAmount + timeChargeAmount + additionalCharge + adminExtraChargeAmount - promoDiscountAmount);
  const fareDueNow = isCollectionPaid(paymentCollection) ? 0 : rideBaseBill;
  const payableNow = fareDueNow + Number(selectedTip || 0);
  const isRideFinalized = ['completed', 'delivered'].includes(rideLiveStatus) || Boolean(state.feedback?.submittedAt);
  const tipsEnabled = String(tipSettings.enable_tips || '1') === '1';
  const minimumTipAmount = Number(tipSettings.min_tip_amount || 0);
  const availableTipOptions = useMemo(() => {
    if (!tipsEnabled) {
      return [0];
    }

    const nextOptions = [...new Set([0, minimumTipAmount, ...TIP_OPTIONS].filter((amount) => Number.isFinite(amount) && amount >= 0))]
      .sort((left, right) => left - right);

    return nextOptions;
  }, [minimumTipAmount, tipsEnabled]);
  const rideDate = new Date(state.completedAt || state.arrivedAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const rideTime = new Date(state.completedAt || state.arrivedAt || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  useEffect(() => {
    // We keep the ride state for the review screen to allow refreshes
  }, []);

  useEffect(() => {
    const fetchTipSettings = async () => {
      try {
        const response = await api.get('/rides/app-settings/tip');
        const nextSettings = response?.data?.settings || response?.settings || {};
        setTipSettings((current) => ({
          ...current,
          ...nextSettings,
        }));
      } catch (tipError) {
        console.error('Failed to load tip settings:', tipError);
      }
    };

    fetchTipSettings();
  }, []);

  useEffect(() => {
    let active = true;

    const hydrateCompletedRide = async () => {
      if (!rideId) return;

      try {
        const response = await api.get(`/rides/${rideId}`);
        const payload = response?.data?.data || response?.data || response || {};
        console.log("RIDE_COMPLETE_PAYLOAD:", JSON.stringify(payload, null, 2));
        const feedback = payload?.feedback || null;
        const nextLiveStatus = String(payload?.liveStatus || payload?.status || '').toLowerCase();

        if (active) {
          setPaymentCollection(payload?.driverPaymentCollection || null);
          setRideLiveStatus(nextLiveStatus);
          const waitAmt = Number(payload.waitingChargeAmount ?? state.waitingChargeAmount ?? 0);
          const distAmt = Number(payload.distanceChargeAmount ?? state.distanceChargeAmount ?? 0);
          const timeAmt = Number(payload.timeChargeAmount ?? state.timeChargeAmount ?? 0);
          const addAmt = Number(payload.additionalCharge ?? state.additionalCharge ?? 0);
          const resolvedBase = Number(
            payload.baseFare ??
            (payload.fare ? (payload.fare - waitAmt - distAmt - timeAmt - addAmt - Number(payload.recovered_cancellation_due || 0) - Number(payload.adminExtraCharge?.amount || 0)) : null) ??
            state.baseFare ??
            (state.fare ? (state.fare - waitAmt - distAmt - timeAmt - addAmt - Number(state.recovered_cancellation_due || 0) - Number(state.adminExtraCharge?.amount || state.adminExtraChargeAmount || 0)) : null) ??
            0
          );

          setRideDetails({
            fare: Number(payload.fare ?? state.fare ?? 22),
            baseFare: resolvedBase,
            waitingChargeAmount: waitAmt,
            distanceChargeAmount: distAmt,
            timeChargeAmount: timeAmt,
            additionalCharge: addAmt,
            adminExtraCharge: payload.adminExtraCharge ?? state.adminExtraCharge ?? null,
            cancellationCharge: Number(payload.recovered_cancellation_due ?? state.recovered_cancellation_due ?? state.cancellationCharge ?? 0),
            paymentMethod: payload.paymentMethod || state.paymentMethod || 'Cash',
            pickup: payload.pickupAddress || state.pickup || 'Pickup',
            drop: payload.dropAddress || state.drop || 'Drop',
            driver: payload.driver || state.driver || null,
            promo: payload.promo ?? state.promo ?? null,
          });
        }

        if (!active || !feedback || !feedback.submittedAt) {
          return;
        }

        setRating(Number(feedback.rating || 0));
        setComment(feedback.comment || '');
        setSelectedTip(Number(feedback.tipAmount || 0));
        setIsSubmitted(Boolean(feedback.submittedAt));
        if (Number(feedback.rating || 0) === 0) {
          setStep('rating');
        } else {
          setStep('success');
        }
      } catch (rideError) {
        console.error('Failed to refresh completed ride receipt:', rideError);
      }
    };

    hydrateCompletedRide();
    const refreshTimer = window.setInterval(() => {
      hydrateCompletedRide();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [rideId]);

  useEffect(() => {
    setVehicleImageBroken(false);
  }, [driver.vehicleImage]);

  useEffect(() => {
    let active = true;

    const loadWalletSnapshot = async () => {
      if (selectedPaymentMethod !== 'wallet') {
        return;
      }

      try {
        setWalletLoading(true);
        const response = await userAuthService.getWallet();
        const wallet = response?.data?.wallet || response?.wallet || response?.data || response || {};

        if (!active) {
          return;
        }

        setWalletSnapshot({
          balance: Number(wallet.balance || 0),
          currency: wallet.currency || 'INR',
        });
      } catch (walletError) {
        if (!active) {
          return;
        }

        setWalletSnapshot((current) => ({
          ...current,
          balance: Number(current.balance || 0),
        }));
      } finally {
        if (active) {
          setWalletLoading(false);
        }
      }
    };

    loadWalletSnapshot();

    return () => {
      active = false;
    };
  }, [selectedPaymentMethod]);

  useEffect(() => {
    if (!tipsEnabled && selectedTip !== 0) {
      setSelectedTip(0);
      return;
    }

    if (
      tipsEnabled &&
      Number.isFinite(minimumTipAmount) &&
      minimumTipAmount > 0 &&
      selectedTip > 0 &&
      selectedTip < minimumTipAmount
    ) {
      setSelectedTip(minimumTipAmount);
    }
  }, [minimumTipAmount, selectedTip, tipsEnabled]);

  useEffect(() => {
    if (!rideId && !isSubmitted) {
      navigate(routeHome, { replace: true });
    }
  }, [isSubmitted, navigate, rideId, routeHome]);

  const handleShare = async () => {
    const text = `${appName} Receipt\n${rideDate} ${rideTime}\nDriver: ${driver.name}\nFrom: ${pickup}\nTo: ${drop}\nTotal: Rs ${totalBill}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: `${appName} Receipt`, text });
        return;
      } catch (_error) {
        return;
      }
    }

    navigator.clipboard?.writeText(text).then(() => {
      setShareToast(true);
      window.setTimeout(() => setShareToast(false), 2200);
    });
  };

  const submitFeedback = async () => {
    if (!rideId) {
      navigate(routeHome, { replace: true });
      return;
    }

    if (step === 'rating' && rating < 1) {
      setError('Please rate your driver before finishing.');
      return;
    }

    if (!isRideFinalized) {
      setError('Waiting for the driver to finish the trip. You can rate as soon as the ride is finalized.');
      return;
    }

    if (!tipsEnabled && Number(selectedTip || 0) > 0) {
      setError('Tips are currently disabled.');
      return;
    }

    if (tipsEnabled && Number(selectedTip || 0) > 0 && minimumTipAmount > 0 && Number(selectedTip || 0) < minimumTipAmount) {
      setError(`Minimum tip amount is Rs ${minimumTipAmount}.`);
      return;
    }

    if (selectedPaymentMethod === 'wallet' && Number(payableNow || 0) > Number(walletSnapshot.balance || 0)) {
      setError('Wallet balance is too low for this payment amount.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      if (step === 'rating') {
        if (!rating || rating === 0) {
           setError('Please provide a rating before submitting.');
           return;
        }
        const response = await api.patch(`/rides/${rideId}/feedback`, {
          rating,
          comment,
        });
        
        const payload = response?.data?.data || response?.data || response;
        if (payload?.feedback?.submittedAt) {
          setIsSubmitted(true);
          setStep('success');
          setShowSubmittedOverlay(true);
          clearCurrentRide();
          setTimeout(() => {
            navigate(routeHome, { replace: true });
          }, 2500);
        }
        return;
      }

      let response;
      const effectivePaymentMethod = selectedPaymentMethod;

      if (Number(payableNow || 0) > 0 && effectivePaymentMethod === 'online') {
        const scriptLoaded = await loadRazorpayScript();
        if (!scriptLoaded) {
          throw new Error('Razorpay SDK failed to load');
        }

        const orderResponse = await api.post(`/rides/${rideId}/complete-payment/razorpay/order`, {
          rating: 0,
          comment: '',
          tipAmount: selectedTip || 0,
        });
        const orderPayload = orderResponse?.data?.data || orderResponse?.data || orderResponse || {};

        if (!orderPayload.keyId || !orderPayload.orderId) {
          throw new Error('Unable to start ride payment');
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
            name: appName,
            description: `Ride payment for ${driver.name || 'driver'}`,
            order_id: order.orderId,
            prefill: {
              name: userInfo?.name || '',
              email: userInfo?.email || '',
              contact: userInfo?.phone ? `+91${userInfo.phone}` : '',
            },
            modal: {
              ondismiss: () => reject(new Error('Ride payment was cancelled')),
            },
            handler: async (paymentResponse) => {
              try {
                const verifyResponse = await api.post(`/rides/${rideId}/complete-payment/razorpay/verify`, {
                  ...paymentResponse,
                  rating: 0,
                  comment: '',
                  tipAmount: selectedTip || 0,
                });
                resolve(verifyResponse);
              } catch (verifyError) {
                reject(new Error(verifyError?.message || 'Ride payment verification failed'));
              }
            },
            theme: {
              color: '#0f172a',
            },
          };

          const rzp = new window.Razorpay(options);

          rzp.on('payment.failed', (event) => {
            reject(new Error(event?.error?.description || event?.error?.reason || 'Ride payment failed'));
          });

          rzp.open();
        });
      } else if (Number(payableNow || 0) > 0 && effectivePaymentMethod === 'wallet') {
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

      const payload = response?.data?.data || response?.data || response;
      if (payload?.driverPaymentCollection) {
        setPaymentCollection(payload.driverPaymentCollection);
      }
      
      setShowPaymentSuccess(true);
      setTimeout(() => {
        setShowPaymentSuccess(false);
        setStep('rating');
      }, 1500);
    } catch (submitError) {
      console.error('[Payment Error]:', submitError);
      const backendMessage = submitError?.response?.data?.message || submitError?.message;
      
      // If the payment/feedback was already submitted, treat it as a success!
      if (submitError?.response?.status === 409 || (backendMessage && backendMessage.toLowerCase().includes('already submitted'))) {
        if (step === 'rating') {
          setIsSubmitted(true);
          setStep('success');
          setShowSubmittedOverlay(true);
          clearCurrentRide();
          setTimeout(() => {
            navigate(routeHome, { replace: true });
          }, 2500);
        } else {
          setShowPaymentSuccess(true);
          setTimeout(() => {
            setShowPaymentSuccess(false);
            setStep('rating');
          }, 1500);
        }
        return;
      }

      const finalError = backendMessage || 'Could not process request right now.';
      setError(finalError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] max-w-lg mx-auto relative overflow-hidden">
      <AnimatePresence>
        {shareToast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-[14px] bg-[#0F766E] px-5 py-3 text-[12px] font-black text-white shadow-xl"
          >
            Receipt copied
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSubmittedOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 max-w-lg mx-auto"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 shadow-[0_10px_25px_rgba(16,185,129,0.28)]">
              <CheckCircle2 size={30} className="text-white" />
            </div>
            <p className="text-[20px] font-black text-[#0F766E]">Thanks for rating your driver</p>
            <p className="text-[13px] font-bold text-slate-500">Your feedback has been saved successfully.</p>
            <button
              type="button"
              onClick={() => navigate(routeHome, { replace: true })}
              className="mt-2 rounded-[16px] bg-[#0F766E] px-6 py-3 text-[13px] font-black text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]"
            >
              Continue
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="px-4 pb-8 pt-10 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 shadow-[0_8px_20px_rgba(16,185,129,0.28)]">
            <CheckCircle2 size={24} className="text-white" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
              {isRideFinalized
                ? (serviceType === 'parcel' ? 'Delivery Completed' : 'Ride Completed')
                : (serviceType === 'parcel' ? 'Reached Destination' : 'Reached Destination')}
            </p>
            <h1 className="text-[22px] font-black text-[#0F766E]">
              {isRideFinalized
                ? (serviceType === 'parcel' ? 'Package delivered' : 'You have arrived')
                : (serviceType === 'parcel' ? 'Package reached destination' : 'Driver reached destination')}
            </h1>
          </div>
        </div>

        {!isRideFinalized ? (
          <div className="rounded-[18px] border border-amber-100 bg-amber-50/90 px-4 py-3 text-center shadow-[0_8px_20px_rgba(245,158,11,0.08)]">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Finalizing trip</p>
            <p className="mt-1 text-[12px] font-bold text-amber-900">
              The driver has marked destination arrival. This page will unlock rating and payment as soon as the trip is finalized.
            </p>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-[22px] border border-white/80 bg-white/95 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between bg-[#0F766E] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/10">
                <Receipt size={14} className="text-primary-orange/40" />
              </div>
              <div>
                <p className="text-[13px] font-black text-white">Trip Receipt</p>
                <p className="text-[10px] font-bold text-slate-400">{rideDate} · {rideTime}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black text-white"
            >
              <Share2 size={12} />
              Share
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="flex items-center gap-3 rounded-[18px] border border-slate-100 bg-slate-50/80 p-3">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[16px] border border-slate-100 bg-slate-100">
                {driverImage ? (
                  <img src={driverImage} alt={driver.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#0F766E] text-[18px] font-black text-white">
                    {getInitials(driver.name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-black text-[#0F766E]">{driver.name}</p>
                <p className="truncate text-[11px] font-bold text-slate-500">
                  {driver.vehicleNumber || driver.plate || 'Assigned'} · {vehicleLabel}
                </p>
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-yellow-50 px-2 py-0.5 text-[10px] font-black text-slate-800">
                  <Star size={10} className="fill-yellow-500 text-yellow-500" />
                  {driver.rating || '4.9'}
                </div>
              </div>
              <div className="h-14 w-16 shrink-0 overflow-hidden rounded-[12px] border border-slate-100 bg-white">
                {vehicleVisual && (
                  <img
                    src={vehicleVisual}
                    alt={vehicleLabel}
                    className={`h-full w-full ${hasVehiclePhoto ? 'object-contain bg-white' : 'object-cover'}`}
                    onError={() => setVehicleImageBroken(true)}
                  />
                )}
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
                    <p className="truncate text-[13px] font-black text-[#0F766E]">{pickup}</p>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Pickup</p>
                  </div>
                  <div>
                    <p className="truncate text-[13px] font-black text-[#0F766E]">{drop}</p>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Drop</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-slate-100 bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500">Base fare</span>
                <span className="text-[13px] font-black text-[#0F766E]">Rs {baseFare.toFixed(2)}</span>
              </div>
              {waitingChargeAmount > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-500">Wait time charge</span>
                  <span className="text-[13px] font-black text-[#0F766E]">Rs {waitingChargeAmount.toFixed(2)}</span>
                </div>
              )}
              {timeChargeAmount > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-500">Ride time charge</span>
                  <span className="text-[13px] font-black text-[#0F766E]">Rs {timeChargeAmount.toFixed(2)}</span>
                </div>
              )}
              {distanceChargeAmount > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-500">Extra distance charge</span>
                  <span className="text-[13px] font-black text-[#0F766E]">Rs {distanceChargeAmount.toFixed(2)}</span>
                </div>
              )}
              {additionalCharge > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-slate-500">Additional charge</span>
                  <span className="text-[13px] font-black text-[#0F766E]">Rs {additionalCharge.toFixed(2)}</span>
                </div>
              )}
              {adminExtraChargeAmount > 0 && (
                <div className="mt-2 flex items-center justify-between text-amber-700 font-bold">
                  <span>Extra charge ({rideDetails.adminExtraCharge?.reason || 'Admin extra'})</span>
                  <span>Rs {adminExtraChargeAmount.toFixed(2)}</span>
                </div>
              )}
              {promoDiscountAmount > 0 && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold text-emerald-600">Promo ({promoCode}) Applied</span>
                  <span className="text-[13px] font-black text-emerald-600">-Rs {promoDiscountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-500">Tip</span>
                <span className="text-[13px] font-black text-[#0F766E]">Rs {Number(selectedTip || 0).toFixed(2)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-[15px] font-black text-[#0F766E]">Total</span>
                <span className="text-[18px] font-black text-[#0F766E]">Rs {totalBill.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {step === 'payment' && (
          <div className="rounded-[20px] border border-white/80 bg-white/95 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
            <>
              <p className="text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
                {tipsEnabled ? 'Tip your driver' : 'Driver tips disabled'}
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
                      setError('');
                    }}
                    disabled={!tipsEnabled && amount > 0}
                    className={`rounded-full border px-4 py-2 text-[11px] font-black transition-all ${selectedTip === amount
                      ? 'border-primary-orange/50 bg-primary-orange/50 text-white shadow-[0_8px_18px_rgba(249,115,22,0.24)]'
                      : 'border-slate-100 bg-slate-50 text-slate-600'
                      } ${!tipsEnabled && amount > 0 ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {amount === 0 ? 'No tip' : `Rs ${amount}`}
                  </button>
                ))}
              </div>

              {/* Payment Method Selector for Outstanding Balance / Tip */}
              {payableNow > 0 && !isSubmitted && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-center text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-3">
                    Select Payment Method
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
                            setError('');
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
            </>
            
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
        <div className="rounded-[22px] border border-white/80 bg-white/95 px-5 py-6 text-center shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
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
          
          <p className="text-[18px] font-black tracking-tight text-[#0F766E]">Rate your experience</p>
          <p className="mt-1.5 text-[12px] font-bold text-slate-400">
            How was your trip with <span className="text-slate-700">{driver.name?.split(' ')[0] || 'your driver'}</span>?
          </p>
          
          <div className="mt-6 flex justify-center gap-2.5">
            {[1, 2, 3, 4, 5].map((value) => {
              let activeColor = 'bg-primary-orange/50 shadow-[0_10px_20px_rgba(249,115,22,0.24)]';
              let starColor = 'fill-white text-white';
              if (rating > 0) {
                if (rating <= 2) {
                  activeColor = 'bg-rose-500 shadow-[0_10px_20px_rgba(225,29,72,0.24)] border-rose-600';
                } else if (rating === 3) {
                  activeColor = 'bg-amber-500 shadow-[0_10px_20px_rgba(245,158,11,0.24)] border-amber-600';
                } else {
                  activeColor = 'bg-emerald-500 shadow-[0_10px_20px_rgba(10,185,129,0.24)] border-emerald-600';
                }
              }

              return (
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  key={value}
                  type="button"
                  onClick={() => {
                    if (step !== 'success') {
                      setRating(value);
                      setError('');
                    }
                  }}
                  disabled={step === 'success'}
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-300 border ${
                    rating >= value ? activeColor : 'bg-slate-50 border-slate-100 hover:bg-slate-100 hover:border-slate-200'
                  } ${step === 'success' ? 'cursor-default' : ''}`}
                >
                  <Star size={22} className={`${rating >= value ? starColor : 'text-slate-300'} transition-colors duration-300`} />
                </motion.button>
              );
            })}
          </div>

          <div className="mt-3 h-6 flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait">
              {rating > 0 && (
                <motion.div
                  key={rating}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`text-[13px] font-black tracking-wide uppercase ${
                    rating <= 2 ? 'text-rose-600' : rating === 3 ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                >
                  {rating === 1 && 'Terrible 😞'}
                  {rating === 2 && 'Bad 😕'}
                  {rating === 3 && 'Okay 😐'}
                  {rating === 4 && 'Good 🙂'}
                  {rating === 5 && 'Excellent 🤩'}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-5 rounded-[18px] border border-slate-100 bg-slate-50/50 p-1">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              <MessageSquare size={14} />
              Add a note
            </div>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              maxLength={500}
              disabled={step === 'success'}
              placeholder="Tell us about the trip"
              className="w-full resize-none rounded-[12px] border border-slate-100 bg-white px-3 py-2 text-[13px] font-bold text-[#0F766E] outline-none placeholder:text-slate-300"
            />
          </div>
        </div>
        )}

          {error ? <p className="mt-3 text-[12px] font-black text-red-500">{error}</p> : null}

          <button
            type="button"
            onClick={submitFeedback}
            disabled={isSubmitting || step === 'success' || !isRideFinalized}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#0F766E] py-3.5 text-[14px] font-black text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] disabled:opacity-60"
          >
            {isSubmitting
              ? 'Processing...'
              : step === 'success'
                ? 'Feedback already saved'
                : !isRideFinalized
                  ? 'Waiting for driver to finalize trip'
                  : step === 'payment'
                    ? (payableNow > 0 ? `Pay Rs ${payableNow.toFixed(2)}` : 'Continue to Rating')
                    : 'Submit Rating'}
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            onClick={() => {
              clearCurrentRide();
              navigate(routeHome, { replace: true });
            }}
            className="mt-3 text-[12px] font-black text-slate-500"
          >
            Skip and go home
          </button>
        </div>
      </div>
  );
};

export default RideComplete;
