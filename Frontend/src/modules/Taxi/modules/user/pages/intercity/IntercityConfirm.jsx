import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Calendar, CheckCircle2, Clock, LoaderCircle, Navigation, AlertTriangle, ShieldCheck } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';

const generateIntercityBookingId = () =>
  'IC-' + Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, '0');

const generateSearchNonce = () =>
  `intercity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const IntercityConfirm = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const state = useMemo(() => location.state || {}, [location.state]);
  const [status, setStatus] = useState('saving');
  const [error, setError] = useState('');
  const requestStartedRef = useRef(false);
  
  const isScheduled = state.rideMode === 'schedule' && Boolean(state.scheduledAt);
  const isBiddingRide = String(state.bookingMode || '').trim().toLowerCase() === 'bidding';

  useEffect(() => {
    if (!state.pickup || !state.drop || !state.vehicle) {
      navigate(`${routePrefix}/intercity`, { replace: true });
      return;
    }

    if (!isScheduled || isBiddingRide) {
      const bookingId = state.bookingId || generateIntercityBookingId();
      navigate(`${routePrefix}/ride/searching`, {
        replace: true,
        state: {
          ...state,
          bookingId,
          searchNonce: state.searchNonce || generateSearchNonce(),
          vehicleTypeId: state.vehicleTypeId || state.vehicle?.vehicleTypeId || '',
          vehicleIconType: state.vehicleIconType || state.vehicle?.iconType || state.vehicle?.name || 'car',
          vehicleIconUrl: state.vehicleIconUrl || state.vehicle?.vehicleIconUrl || state.vehicle?.icon || '',
          paymentMethod: state.paymentMethod || 'Cash',
          serviceType: 'intercity',
          transport_type: 'intercity',
          bookingMode: isBiddingRide ? 'bidding' : (state.bookingMode || 'normal'),
          bidStepAmount: Number(state.bidStepAmount || 10),
          userMaxBidFare: Number(state.userMaxBidFare || state.fare || 0),
          intercity: {
            bookingId,
            fromCity: state.fromCity || '',
            toCity: state.toCity || '',
            tripType: state.tripType || 'One Way',
            travelDate: state.date || 'Ride Now',
            passengers: state.passengers || 1,
            distance: Number(state.distance || 0),
            vehicleName: state.vehicle?.name || state.vehicle?.id || 'Intercity Cab',
            packageId: state.vehicle?.packageId || '',
            packageTypeName: state.vehicle?.packageTypeName || 'Intercity',
          },
        },
      });
      return;
    }

    if (requestStartedRef.current) return;
    requestStartedRef.current = true;

    const bookingId = state.bookingId || generateIntercityBookingId();

    (async () => {
      try {
        await api.post('/rides', {
          pickup: state.pickupCoords,
          drop: state.dropCoords,
          pickupAddress: state.pickup,
          dropAddress: state.drop,
          fare: Number(state.fare || 0),
          vehicleTypeId: state.vehicleTypeId || state.vehicle?.vehicleTypeId || '',
          vehicleTypeIds: state.vehicleTypeId || state.vehicle?.vehicleTypeId ? [state.vehicleTypeId || state.vehicle?.vehicleTypeId] : [],
          vehicleIconType: state.vehicleIconType || state.vehicle?.iconType || state.vehicle?.name || 'car',
          vehicleIconUrl: state.vehicleIconUrl || state.vehicle?.vehicleIconUrl || state.vehicle?.icon || '',
          paymentMethod: state.paymentMethod || 'Cash',
          serviceType: 'intercity',
          transport_type: 'intercity',
          bookingMode: state.bookingMode || 'normal',
          userMaxBidFare: Number(state.userMaxBidFare || state.fare || 0),
          bidStepAmount: Number(state.bidStepAmount || 10),
          scheduledAt: state.scheduledAt,
          intercity: {
            bookingId,
            fromCity: state.fromCity || '',
            toCity: state.toCity || '',
            tripType: state.tripType || 'One Way',
            travelDate: state.travelDate || state.date || '',
            passengers: state.passengers || 1,
            distance: Number(state.distance || 0),
            vehicleName: state.vehicle?.name || state.vehicle?.id || 'Intercity Cab',
          },
        });
        setStatus('scheduled');
      } catch (requestError) {
        setStatus('error');
        setError(requestError?.message || 'Could not schedule this intercity ride.');
      }
    })();
  }, [isScheduled, navigate, routePrefix, state]);

  const formattedSchedule = useMemo(() => {
    if (!state.scheduledAt) return '';
    const parsed = new Date(state.scheduledAt);
    if (Number.isNaN(parsed.getTime())) return state.scheduledAt;
    return parsed.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }, [state.scheduledAt]);

  return (
    <div className="min-h-screen max-w-lg mx-auto flex flex-col items-center justify-center bg-[#FAFBFF] px-6 relative overflow-hidden font-sans">
      
      {/* Decorative Background */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-blue-600 rounded-b-[64px]" />
      <div className="absolute top-10 left-10 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute top-20 right-10 w-32 h-32 bg-indigo-500/20 rounded-full blur-3xl" />

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="w-full relative z-10 bg-white rounded-[32px] shadow-2xl p-8 text-center border border-slate-100"
      >
        <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-[24px] mb-6 shadow-lg ${
          status === 'scheduled' ? 'bg-emerald-50 text-emerald-600 shadow-emerald-500/20 border-2 border-emerald-100' :
          status === 'error' ? 'bg-rose-50 text-rose-600 shadow-rose-500/20 border-2 border-rose-100' : 
          'bg-blue-50 text-blue-600 shadow-blue-500/20 border-2 border-blue-100'
        }`}>
          {status === 'scheduled' ? <CheckCircle2 size={36} strokeWidth={3} /> : 
           status === 'error' ? <AlertTriangle size={36} strokeWidth={3} /> :
           <Navigation size={36} strokeWidth={3} className="animate-pulse" />}
        </div>

        <h1 className="text-[24px] font-black text-slate-900 leading-tight">
          {status === 'scheduled' ? 'Ride Scheduled!' : status === 'error' ? 'Scheduling failed' : 'Securing your ride...'}
        </h1>
        
        <p className="mt-3 text-[14px] font-bold text-slate-500">
          {status === 'scheduled'
            ? 'Your booking is confirmed. We will assign a driver and notify you before the scheduled time.'
            : status === 'error'
              ? error
              : 'Saving your intercity booking and preparing automatic driver notification.'}
        </p>

        <div className="mt-8 rounded-[24px] bg-slate-50 border border-slate-100 p-5 text-left relative overflow-hidden">
          <ShieldCheck size={80} className="absolute -right-4 -bottom-4 text-slate-200/50" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-slate-400 mb-2">
              <Calendar size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">Scheduled For</span>
            </div>
            <p className="text-[18px] font-black text-slate-900">{formattedSchedule || state.date || 'Scheduled'}</p>
            
            <div className="mt-5 pt-4 border-t border-slate-200">
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <Navigation size={14} />
                <span className="text-[11px] font-black uppercase tracking-widest">Route Details</span>
              </div>
              <p className="text-[14px] font-bold text-slate-900">{state.fromCity} → {state.toCity}</p>
            </div>
          </div>
        </div>

        {status === 'saving' && (
          <div className="mt-8 flex items-center justify-center gap-3 text-[12px] font-black uppercase tracking-[0.2em] text-blue-600">
            <LoaderCircle size={20} className="animate-spin" strokeWidth={3} />
            Please wait
          </div>
        )}

        {status !== 'saving' && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate(routePrefix || '/')}
            className="mt-8 h-14 w-full rounded-2xl bg-slate-900 text-[15px] font-black uppercase tracking-wider text-white shadow-xl shadow-slate-900/20 active:scale-95 transition-all"
          >
            {status === 'error' ? 'Try Again' : 'Done'}
          </motion.button>
        )}
      </motion.div>
    </div>
  );
};

export default IntercityConfirm;
