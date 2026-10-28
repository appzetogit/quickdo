import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, ShieldCheck, CreditCard, Wallet, Smartphone } from 'lucide-react';
import { userService } from '../../services/userService';
import { userAuthService } from '../../services/authService';

const PAYMENT_METHODS = [
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
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

const buildRentalBookingPayload = ({
  state,
  vehicle,
  payableNow,
  advancePaymentLabel,
  paymentStatus,
  paymentMethod,
  paymentMethodLabel,
  payment,
  bookingReference,
}) => ({
  bookingReference,
  vehicleTypeId: vehicle.id || vehicle._id,
  pickupDateTime: state.pickup,
  returnDateTime: state.returnTime,
  totalCost: Number(state.totalCost || 0),
  payableNow: Number(payableNow || 0),
  advancePaymentLabel,
  paymentStatus,
  paymentMethod,
  paymentMethodLabel,
  payment,
  kycCompleted: true,
  kycDocuments: state.rentalKyc?.documents || null,
  selectedPackage: state.selectedPackage
    ? {
        id: state.selectedPackage.id || state.selectedPackage._id || '',
        label: state.selectedPackage.label || '',
        durationHours: Number(state.selectedPackage.durationHours || 0),
        price: Number(state.selectedPackage.price || 0),
      }
    : null,
  serviceLocation: state.serviceLocation
    ? {
        id: state.serviceLocation.id || state.serviceLocation._id || '',
        name: state.serviceLocation.name || '',
        address: state.serviceLocation.address || '',
        city: state.serviceLocation.city || state.serviceLocation.country || '',
        latitude: state.serviceLocation.latitude,
        longitude: state.serviceLocation.longitude,
        distanceKm: state.serviceLocation.distanceKm,
      }
    : null,
});

const RentalDeposit = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state || {};
  const [vehicleSnapshot, setVehicleSnapshot] = useState(state.vehicle || null);

  useEffect(() => {
    setVehicleSnapshot(state.vehicle || null);
  }, [state.vehicle]);

  useEffect(() => {
    let mounted = true;

    const refreshVehicle = async () => {
      const vehicleId = state.vehicle?.id;
      if (!vehicleId) return;

      try {
        const response = await userService.getRentalVehicles();
        const results = response?.data?.results || response?.results || [];
        const latestVehicle = results.find(
          (item) => String(item.id || item._id) === String(vehicleId),
        );

        if (mounted && latestVehicle) {
          setVehicleSnapshot((current) => ({
            ...(current || {}),
            ...latestVehicle,
          }));
        }
      } catch {
        // Keep the booking flow usable even if the refresh fails.
      }
    };

    refreshVehicle();

    return () => {
      mounted = false;
    };
  }, [state.vehicle?.id]);

  const { totalCost, selectedPackage, serviceLocation } = state;
  const vehicle = vehicleSnapshot || {};
  const advancePayment = vehicle.advancePayment || {};
  const payableNow = useMemo(
    () => (advancePayment.enabled ? Number(advancePayment.amount || 0) : 0),
    [advancePayment.amount, advancePayment.enabled],
  );
  const advancePaymentLabel = advancePayment.label || 'Advance booking payment';
  const bookingReference = useMemo(
    () => state.bookingReference || `RNT-${Date.now().toString(36).slice(-6).toUpperCase()}`,
    [state.bookingReference],
  );
  const [method, setMethod] = useState('upi');
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadWallet = async () => {
      setWalletLoading(true);
      try {
        const response = await userAuthService.getWallet();
        const data = response?.data || response || {};
        if (mounted) {
          setWalletBalance(Number(data.balance || 0));
        }
      } catch {
        if (mounted) {
          setWalletBalance(0);
        }
      } finally {
        if (mounted) {
          setWalletLoading(false);
        }
      }
    };

    loadWallet();

    return () => {
      mounted = false;
    };
  }, []);

  if (!vehicleSnapshot) {
    navigate('/rental');
    return null;
  }

  const submitBookingRequest = async ({
    paymentStatus,
    paymentMethod,
    paymentMethodLabel,
    payment,
    bookingReference,
  }) => {
    const response = await userService.createRentalBookingRequest(
      buildRentalBookingPayload({
        state,
        vehicle,
        payableNow,
        advancePaymentLabel,
        paymentStatus,
        paymentMethod,
        paymentMethodLabel,
        payment,
        bookingReference,
      }),
    );

    return response?.data || response || {};
  };

  const handlePay = async () => {
    if (paying) return;

    setPaymentError('');

    if (payableNow <= 0) {
      try {
        const bookingRequest = await submitBookingRequest({
          paymentStatus: 'not_required',
          paymentMethod: method,
          paymentMethodLabel: PAYMENT_METHODS.find((item) => item.id === method)?.label || 'Online',
          payment: {
            provider: 'manual',
            status: 'not_required',
            amount: 0,
            currency: 'INR',
          },
          bookingReference,
        });

        navigate('/rental/confirmed', {
          state: {
            ...state,
            vehicle,
            deposit: payableNow,
            paymentMethod: method,
            paymentStatus: 'not_required',
            bookingReference: bookingRequest.bookingReference || '',
            bookingRequest,
          },
        });
      } catch (error) {
        setPaymentError(error?.message || 'Unable to save rental booking');
      }
      return;
    }

    setPaying(true);

    try {
      if (method === 'wallet') {
        if (Number(walletBalance || 0) < payableNow) {
          throw new Error('Not enough wallet balance for this advance payment');
        }

        const walletResponse = await userService.payRentalAdvanceWithWallet({
          amount: payableNow,
          bookingReference,
          vehicleId: vehicle.id || vehicle._id,
          vehicleName: vehicle.name,
        });
        const payment = walletResponse?.data || walletResponse || {};
        const bookingRequest = await submitBookingRequest({
          paymentStatus: 'paid',
          paymentMethod: 'wallet',
          paymentMethodLabel: 'Wallet',
          payment,
          bookingReference,
        });
        setWalletBalance(Number(payment.balance || 0));
        navigate('/rental/confirmed', {
          replace: true,
          state: {
            ...state,
            vehicle,
            deposit: payableNow,
            paymentMethod: 'wallet',
            paymentMethodLabel: 'Wallet',
            paymentStatus: 'paid',
            payment,
            bookingReference: bookingRequest.bookingReference || bookingReference,
            bookingRequest,
          },
        });
        return;
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error('Razorpay SDK failed to load');
      }

      const orderResponse = await userService.createRentalAdvanceOrder({
        amount: payableNow,
        vehicleId: vehicle.id || vehicle._id,
        vehicleName: vehicle.name,
        pickup: state.pickup,
        returnTime: state.returnTime,
      });
      const order = orderResponse?.data || orderResponse || {};

      if (!order.keyId || !order.orderId) {
        throw new Error('Unable to start rental payment');
      }

      let userInfo = {};
      try {
        userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
      } catch {
        userInfo = {};
      }

      const methodLabel = PAYMENT_METHODS.find((item) => item.id === method)?.label || 'Online';
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency || 'INR',
        name: vehicle.name || 'Rental Booking',
        description: `${advancePaymentLabel} - ${methodLabel}`,
        order_id: order.orderId,
        prefill: {
          name: userInfo?.name || '',
          email: userInfo?.email || '',
          contact: userInfo?.phone || '',
        },
        modal: {
          ondismiss: () => {
            setPaying(false);
          },
        },
        theme: {
          color: '#0F172A',
        },
        handler: async (response) => {
          try {
            const verifyResponse = await userService.verifyRentalAdvancePayment(response);
            const payment = verifyResponse?.data || verifyResponse || {};
            const bookingRequest = await submitBookingRequest({
              paymentStatus: 'paid',
              paymentMethod: method,
              paymentMethodLabel: methodLabel,
              payment,
              bookingReference: order.bookingReference || '',
            });
            navigate('/rental/confirmed', {
              replace: true,
              state: {
                ...state,
                vehicle,
                deposit: payableNow,
                paymentMethod: method,
                paymentMethodLabel: methodLabel,
                paymentStatus: 'paid',
                payment,
                bookingReference: bookingRequest.bookingReference || order.bookingReference || bookingReference,
                bookingRequest,
              },
            });
          } catch (verifyError) {
            setPaymentError(verifyError?.message || 'Payment completed but the rental booking could not be saved');
            setPaying(false);
          }
        },
      });

      rzp.on('payment.failed', (event) => {
        const message = event?.error?.description || event?.error?.reason || 'Payment failed';
        setPaymentError(message);
        setPaying(false);
      });

      rzp.open();
    } catch (error) {
      setPaymentError(error?.message || 'Unable to continue with payment');
      setPaying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans pb-28 relative overflow-hidden">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-primary-orange/10/60 blur-3xl pointer-events-none" />

      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]"
      >
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.07)] shrink-0"
          >
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">
              Step 5 of 5 - Advance Payment
            </p>
            <h1 className="text-[18px] font-black tracking-tight text-slate-900 leading-tight">
              Pay Now
            </h1>
          </div>
        </div>
      </motion.header>

      <div className="px-5 pt-5 space-y-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-5 py-4 space-y-3"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            Booking Summary
          </p>
          <div className="flex items-center gap-3">
            <img src={vehicle.image} alt={vehicle.name} className="h-14 w-16 object-contain drop-shadow-md shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-black text-slate-900 leading-tight">{vehicle.name}</p>
              <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                {selectedPackage?.label || state.duration} - {state.pickup?.slice(0, 16).replace('T', ' ')}
              </p>
              {serviceLocation?.name ? (
                <p className="text-[11px] font-bold text-slate-400 mt-0.5">
                  Pickup: {serviceLocation.name}
                </p>
              ) : null}
            </div>
          </div>
          <div className="border-t border-slate-50 pt-3 space-y-1.5">
            <div className="flex justify-between text-[12px] font-bold text-slate-500">
              <span>Rental cost</span>
              <span>Rs.{totalCost}</span>
            </div>
            <div className="flex justify-between text-[12px] font-bold text-slate-500">
              <span>
                {advancePaymentLabel}
              </span>
              <span>Rs.{payableNow}</span>
            </div>
            <div className="flex justify-between text-[14px] font-black text-slate-900 pt-1 border-t border-slate-50">
              <span>Total now</span>
              <span>Rs.{payableNow}</span>
            </div>
            <p className="text-[10px] font-bold text-slate-400">
              Rental cost Rs.{totalCost} is paid at pickup.
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex items-start gap-3 rounded-[16px] border border-white/80 bg-white/90 px-4 py-3.5 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
        >
          <div className="w-8 h-8 rounded-[10px] bg-emerald-50 flex items-center justify-center shrink-0">
            <ShieldCheck size={15} className="text-emerald-500" strokeWidth={2} />
          </div>
          <p className="text-[12px] font-bold text-slate-500 leading-relaxed">
            You are paying Rs.{payableNow} right now as the booking advance. The remaining rental cost is paid at pickup.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-[20px] border border-white/80 bg-white/90 shadow-[0_4px_14px_rgba(15,23,42,0.05)] px-5 py-4 space-y-3"
        >
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
            Payment Method
          </p>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setMethod(id)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-[14px] border transition-all ${
                  method === id
                    ? 'border-primary-orange/20 bg-primary-orange/5 shadow-[0_4px_12px_rgba(249,115,22,0.12)]'
                    : 'border-slate-100 bg-slate-50'
                }`}
              >
                <Icon size={18} className={method === id ? 'text-primary-orange/50' : 'text-slate-400'} strokeWidth={2} />
                <span className={`text-[11px] font-black ${method === id ? 'text-slate-900' : 'text-slate-400'}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
          {method === 'wallet' ? (
            <div className="rounded-[14px] border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700">
              {walletLoading
                ? 'Loading wallet balance...'
                : `Wallet balance: Rs.${Number(walletBalance || 0).toFixed(2)}`}
            </div>
          ) : null}
          {paymentError ? (
            <div className="rounded-[14px] border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-500">
              {paymentError}
            </div>
          ) : null}
        </motion.div>
      </div>

      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-5 pb-6 pt-3 bg-gradient-to-t from-[#EEF2F7] via-[#F3F4F6]/95 to-transparent pointer-events-none z-30">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handlePay}
          disabled={paying || (method === 'wallet' && !walletLoading && Number(walletBalance || 0) < payableNow)}
          className="pointer-events-auto w-full bg-slate-900 py-4 rounded-[18px] text-[15px] font-black text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)] flex items-center justify-center gap-2"
        >
          {paying ? (
            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              {method === 'wallet' ? <Wallet size={16} strokeWidth={2.5} /> : <CreditCard size={16} strokeWidth={2.5} />} Confirm & Pay Rs.{payableNow}
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
};

export default RentalDeposit;
