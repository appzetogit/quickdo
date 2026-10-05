import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, Calendar, ChevronRight, Clock, Info, MapPin, 
  Users, Briefcase, Snowflake, Navigation, CheckCircle2,
  AlertTriangle, Receipt
} from 'lucide-react';
import { useSettings } from '../../../../shared/context/SettingsContext';

const pad = (value) => String(value).padStart(2, '0');

const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
};

const formatDateTimeInputValue = (date) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getTomorrowLocalDateTime = () => {
  const next = new Date(Date.now() + 60 * 60 * 1000);
  return formatDateTimeInputValue(next);
};

const DEFAULT_BID_STEP_AMOUNT = 10;
const DEFAULT_BID_HEADROOM_PERCENT = 20;

const toConfiguredPositiveInteger = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
};

const clampPercentage = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, numeric));
};

const alignBidAmountToStep = ({ baseFare, amount, stepAmount }) => {
  const safeBaseFare = Math.max(0, Math.round(Number(baseFare || 0)));
  const safeStepAmount = toConfiguredPositiveInteger(stepAmount, DEFAULT_BID_STEP_AMOUNT);
  const safeAmount = Math.max(safeBaseFare, Math.round(Number(amount || 0)));
  const delta = safeAmount - safeBaseFare;

  if (delta === 0) return safeBaseFare;
  return safeBaseFare + (Math.ceil(delta / safeStepAmount) * safeStepAmount);
};

const getTodayLocalDate = () => formatDateInputValue(new Date());

const getMaxAdvanceDate = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return formatDateInputValue(nextWeek);
};

const getMaxAdvanceDateTime = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return formatDateTimeInputValue(nextWeek);
};

const getVehicleIcon = (type = {}) => {
  const customIcon = String(type.icon || '').trim();
  if (customIcon) return customIcon;
  const iconValue = String(type.iconType || type.vehicleName || '').toLowerCase();
  if (iconValue.includes('bike')) return '/1_Bike.png';
  if (iconValue.includes('auto')) return '/2_AutoRickshaw.png';
  return '/4_Taxi.png';
};

const normalizeVehicleEntry = (pkg, vehicle, index) => ({
  id: vehicle.id || `${pkg.id}:${vehicle.vehicleTypeId || index}`,
  packageId: pkg.id,
  packageTypeName: pkg.packageTypeName || 'Intercity',
  destination: pkg.destination || '',
  vehicleTypeId: vehicle.vehicleTypeId || '',
  name: vehicle.vehicleName || 'Vehicle',
  desc: `${pkg.packageTypeName || 'Intercity'} · ${pkg.destination || 'Destination'}`,
  seats: Number(vehicle.capacity || 4) || 4,
  icon: getVehicleIcon(vehicle),
  vehicleIconUrl: getVehicleIcon(vehicle),
  iconType: vehicle.iconType || vehicle.vehicleName || 'car',
  dispatchType: String(vehicle.dispatchType || 'normal').trim().toLowerCase(),
  supportsBidding: ['bidding', 'both'].includes(String(vehicle.dispatchType || 'normal').trim().toLowerCase()),
  baseFare: Number(vehicle.basePrice || 0),
  freeDistance: Number(vehicle.freeDistance || 0),
  pricePerKm: Number(vehicle.distancePrice || 0),
  freeTime: Number(vehicle.freeTime || 0),
  timePrice: Number(vehicle.timePrice || 0),
  serviceTax: Number(vehicle.serviceTax || 0),
  cancellationFee: Number(vehicle.cancellationFee || 0),
});

const calculateFare = (vehicle, tripType) => {
  const baseFare = Number(vehicle.baseFare || 0);
  return tripType === 'Round Trip' ? Math.round(baseFare * 1.8) : Math.round(baseFare);
};

const calculateDefaultBidCeiling = (fare, stepAmount = DEFAULT_BID_STEP_AMOUNT, headroomPercent = DEFAULT_BID_HEADROOM_PERCENT) => {
  const safeFare = Math.max(0, Number(fare || 0));
  const raisedFare = safeFare * (1 + (clampPercentage(headroomPercent, DEFAULT_BID_HEADROOM_PERCENT) / 100));
  return alignBidAmountToStep({ baseFare: safeFare, amount: raisedFare, stepAmount });
};

const getDisplayDate = (rideMode, travelDate) => (rideMode === 'schedule' ? travelDate : 'Ride Now');

const IntercityVehicle = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useSettings();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const {
    fromCity,
    toCity,
    tripType: initialTripType,
    date: initialDate,
    rideMode: initialRideMode,
    selectedPackages = [],
    pickupAddress = '',
    pickupCoords = null,
  } = location.state || {};

  const [tripType, setTripType] = useState(initialTripType || 'One Way');
  const [rideMode, setRideMode] = useState(initialRideMode || 'now');
  const [travelDate, setTravelDate] = useState(
    initialRideMode === 'schedule' && initialDate && initialDate !== 'Ride Now'
      ? initialDate
      : new Date().toISOString().split('T')[0]
  );
  const [scheduledAt, setScheduledAt] = useState(
    initialRideMode === 'schedule' && location.state?.scheduledAt
      ? String(location.state.scheduledAt).slice(0, 16)
      : getTomorrowLocalDateTime()
  );
  const [passengers, setPassengers] = useState(1);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  
  // Fare Breakdown Modal State
  const [showFareBreakdown, setShowFareBreakdown] = useState(false);

  const travelDateInputRef = useRef(null);
  const scheduledAtInputRef = useRef(null);
  const minTravelDate = useMemo(() => getTodayLocalDate(), []);
  const maxTravelDate = useMemo(() => getMaxAdvanceDate(), []);
  const minScheduledAt = useMemo(() => getTomorrowLocalDateTime(), []);
  const maxScheduledAt = useMemo(() => getMaxAdvanceDateTime(), []);

  const vehicles = useMemo(
    () =>
      selectedPackages.flatMap((pkg) =>
        (Array.isArray(pkg.vehicles) ? pkg.vehicles : []).map((vehicle, index) =>
          normalizeVehicleEntry(pkg, vehicle, index)
        )
      ),
    [selectedPackages]
  );

  useEffect(() => {
    if (!selectedVehicleId && vehicles.length) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [selectedVehicleId, vehicles]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || vehicles[0] || null,
    [selectedVehicleId, vehicles]
  );

  useEffect(() => {
    if (!fromCity || !toCity) {
      navigate(`${routePrefix}/intercity`, { replace: true });
    }
  }, [fromCity, navigate, routePrefix, toCity]);

  useEffect(() => {
    if (!selectedVehicle) return;
    setPassengers((current) => Math.min(Math.max(current, 1), selectedVehicle.seats));
  }, [selectedVehicle]);

  useEffect(() => {
    if (travelDate < minTravelDate) {
      setTravelDate(minTravelDate);
      return;
    }
    if (travelDate > maxTravelDate) {
      setTravelDate(maxTravelDate);
    }
  }, [maxTravelDate, minTravelDate, travelDate]);

  useEffect(() => {
    if (!scheduledAt) return;
    if (scheduledAt < minScheduledAt) {
      setScheduledAt(minScheduledAt);
      return;
    }
    if (scheduledAt > maxScheduledAt) {
      setScheduledAt(maxScheduledAt);
    }
  }, [maxScheduledAt, minScheduledAt, scheduledAt]);

  if (!fromCity || !toCity) return null;

  const finalFare = selectedVehicle ? calculateFare(selectedVehicle, tripType) : 0;
  const configuredBidStepAmount = toConfiguredPositiveInteger(
    settings?.bidRide?.bidding_amount_increase_or_decrease,
    DEFAULT_BID_STEP_AMOUNT,
  );
  const configuredBidHighPercentage = clampPercentage(
    settings?.bidRide?.user_bidding_high_percentage,
    DEFAULT_BID_HEADROOM_PERCENT,
  );

  const openPicker = (inputRef) => {
    if (typeof inputRef.current?.showPicker === 'function') {
      inputRef.current.showPicker();
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.click();
  };

  const handleContinue = () => {
    if (!selectedVehicle) return;

    if (rideMode === 'schedule') {
      const parsedSchedule = new Date(scheduledAt);
      if (!scheduledAt || Number.isNaN(parsedSchedule.getTime())) {
        setScheduleError('Choose a valid schedule date and time.');
        return;
      }
      if (!travelDate || travelDate < minTravelDate) {
        setScheduleError('Travel date cannot be earlier than today.');
        return;
      }
      if (travelDate > maxTravelDate) {
        setScheduleError('Advance booking is available for up to 7 days only.');
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

    navigate(`${routePrefix}/intercity/details`, {
      state: {
        fromCity,
        toCity,
        tripType,
        rideMode,
        date: getDisplayDate(rideMode, travelDate),
        travelDate,
        scheduledAt: rideMode === 'schedule' ? new Date(scheduledAt).toISOString() : null,
        selectedPackages,
        pickupAddress,
        pickupCoords,
        distance: 0,
        vehicle: selectedVehicle,
        passengers,
        fare: finalFare,
        baseFare: finalFare,
        bookingMode: selectedVehicle.supportsBidding ? 'bidding' : 'normal',
        bidStepAmount: configuredBidStepAmount,
        userMaxBidFare: selectedVehicle.supportsBidding
          ? calculateDefaultBidCeiling(finalFare, configuredBidStepAmount, configuredBidHighPercentage)
          : finalFare,
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 max-w-lg mx-auto pb-32 font-sans relative">
      
      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md px-5 pt-10 pb-4 shadow-sm">
        <div className="flex items-center gap-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-900 transition-colors hover:bg-slate-200"
          >
            <ArrowLeft size={20} strokeWidth={2.5} />
          </motion.button>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-black text-slate-900 leading-tight">Select Vehicle</h1>
            <p className="text-[12px] font-bold text-slate-400 uppercase tracking-widest truncate">
              {fromCity} to {toCity}
            </p>
          </div>
        </div>
      </div>

      <div className="px-5 py-6 space-y-6">
        
        {/* Vehicles List */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[14px] font-black uppercase tracking-widest text-slate-400 ml-1">Available Rides</h3>
          </div>

          {vehicles.length === 0 ? (
            <div className="rounded-[32px] border-2 border-dashed border-slate-200 bg-white px-6 py-12 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                <Info size={28} />
              </div>
              <p className="text-[18px] font-black text-slate-900">No vehicles available</p>
              <p className="mt-1 text-[14px] font-bold text-slate-400">Try another destination or package.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {vehicles.map((vehicle) => {
                const vehicleFare = calculateFare(vehicle, tripType);
                const isActive = selectedVehicleId === vehicle.id;

                return (
                  <motion.button
                    type="button"
                    key={vehicle.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setSelectedVehicleId(vehicle.id);
                      if (passengers > vehicle.seats) {
                        setPassengers(vehicle.seats);
                      }
                    }}
                    className={`w-full rounded-[24px] p-5 text-left transition-all border-2 relative overflow-hidden ${
                      isActive
                        ? 'border-blue-600 bg-blue-50/30 shadow-lg shadow-blue-600/10'
                        : 'border-transparent bg-white shadow-sm hover:border-slate-200'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute top-0 right-0 p-3">
                        <CheckCircle2 size={24} className="text-blue-600" />
                      </div>
                    )}
                    <div className="flex items-start gap-4">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-slate-50 border border-slate-100 relative">
                        <img src={vehicle.icon} alt={vehicle.name} className="w-[120%] h-[120%] object-contain scale-110 drop-shadow-xl" draggable={false} />
                      </div>
                      <div className="min-w-0 flex-1 pt-1">
                        <h4 className="truncate text-[18px] font-black text-slate-900">{vehicle.name}</h4>
                        
                        {/* Vehicle Tags */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                            <Users size={12} /> {vehicle.seats} Seats
                          </span>
                          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                            <Briefcase size={12} /> {Math.floor(vehicle.seats / 2)} Bags
                          </span>
                          <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                            <Snowflake size={12} /> AC
                          </span>
                          {vehicle.supportsBidding && (
                            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">
                              <Receipt size={12} /> Bidding
                            </span>
                          )}
                        </div>
                        
                        <div className="mt-3 flex items-end justify-between">
                          <div>
                            <p className="text-[20px] font-black text-slate-900">₹{vehicleFare.toLocaleString()}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Estimated Fare</p>
                          </div>
                          {isActive && (
                            <div 
                              onClick={(e) => { e.stopPropagation(); setShowFareBreakdown(true); }}
                              className="text-[12px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1 bg-blue-50 px-2.5 py-1.5 rounded-lg active:scale-95 transition-all"
                            >
                              <Info size={14} /> Breakdown
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </section>
        
        {/* Trip Settings */}
        <section className="rounded-[24px] bg-white p-5 shadow-sm border border-slate-100">
          <h3 className="text-[14px] font-black uppercase tracking-widest text-slate-400 mb-4">Trip Settings</h3>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {['One Way', 'Round Trip'].map((type) => {
              const active = tripType === type;
              return (
                <button
                  type="button"
                  key={type}
                  onClick={() => setTripType(type)}
                  className={`rounded-xl py-3 text-[14px] font-bold transition-all ${
                    active
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => setRideMode('now')}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold transition-all ${
                rideMode === 'now'
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Clock size={16} /> Ride now
            </button>
            <button
              type="button"
              onClick={() => setRideMode('schedule')}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold transition-all ${
                rideMode === 'schedule'
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              <Calendar size={16} /> Schedule
            </button>
          </div>

          <AnimatePresence>
            {rideMode === 'schedule' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 overflow-hidden mb-5">
                <div>
                  <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-400">Travel date</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => openPicker(travelDateInputRef)}
                      className="flex h-12 w-full items-center justify-between rounded-xl bg-slate-50 px-4 text-[14px] font-bold text-slate-900 border border-slate-100"
                    >
                      <span>{travelDate || 'Select date'}</span>
                      <Calendar size={18} className="text-slate-400" />
                    </button>
                    <input
                      ref={travelDateInputRef}
                      type="date"
                      min={minTravelDate}
                      max={maxTravelDate}
                      value={travelDate}
                      onChange={(e) => { setTravelDate(e.target.value); setScheduleError(''); }}
                      className="pointer-events-none absolute inset-0 opacity-0"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-400">Pickup time</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => openPicker(scheduledAtInputRef)}
                      className="flex h-12 w-full items-center justify-between rounded-xl bg-slate-50 px-4 text-[14px] font-bold text-slate-900 border border-slate-100"
                    >
                      <span>{scheduledAt ? scheduledAt.replace('T', ' ') : 'Select time'}</span>
                      <Clock size={18} className="text-slate-400" />
                    </button>
                    <input
                      ref={scheduledAtInputRef}
                      type="datetime-local"
                      min={minScheduledAt}
                      max={maxScheduledAt}
                      value={scheduledAt}
                      onChange={(e) => { setScheduledAt(e.target.value); setScheduleError(''); }}
                      className="pointer-events-none absolute inset-0 opacity-0"
                    />
                  </div>
                </div>

                {scheduleError ? (
                  <p className="flex items-center gap-1.5 text-[12px] font-bold text-rose-500 bg-rose-50 p-3 rounded-lg"><AlertTriangle size={14}/> {scheduleError}</p>
                ) : (
                  <p className="text-[11px] font-bold text-slate-400 bg-slate-50 p-3 rounded-lg">Drivers will be notified automatically around this scheduled time.</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
                <Users size={18} className="text-slate-500" />
              </div>
              <div>
                <p className="text-[14px] font-black text-slate-900">Passengers</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Up to {selectedVehicle?.seats || 1} seats</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPassengers((c) => Math.max(1, c - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-slate-200 text-[16px] font-bold shadow-sm"
              >
                -
              </button>
              <span className="w-4 text-center text-[16px] font-black text-slate-900">{passengers}</span>
              <button
                type="button"
                onClick={() => setPassengers((c) => Math.min(selectedVehicle?.seats || 1, c + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-slate-200 text-[16px] font-bold shadow-sm"
              >
                +
              </button>
            </div>
          </div>
        </section>

      </div>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-0 left-1/2 w-full max-w-lg -translate-x-1/2 bg-white px-5 pt-4 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] rounded-t-[32px] z-30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">{tripType} · {getDisplayDate(rideMode, travelDate)}</p>
            <p className="text-[28px] leading-none font-black text-slate-900">₹{finalFare.toLocaleString()}</p>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={handleContinue}
            disabled={!selectedVehicle}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-[20px] bg-blue-600 px-6 text-[16px] font-black uppercase tracking-wider text-white shadow-xl shadow-blue-600/30 disabled:opacity-50"
          >
            Review Trip
            <ChevronRight size={20} strokeWidth={3} />
          </motion.button>
        </div>
      </div>

      {/* Fare Breakdown Modal */}
      <AnimatePresence>
        {showFareBreakdown && selectedVehicle && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm"
          >
            <div className="absolute inset-0" onClick={() => setShowFareBreakdown(false)} />
            <motion.div 
              initial={{ y: '100%' }} 
              animate={{ y: 0 }} 
              exit={{ y: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative bg-white rounded-t-[32px] w-full max-w-lg mx-auto overflow-hidden pb-10"
            >
              <div className="p-6">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6" />
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-[22px] font-black text-slate-900 flex items-center gap-2">
                    <Receipt className="text-blue-600" /> Fare Breakdown
                  </h2>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl">
                    <div>
                      <p className="text-[15px] font-black text-slate-900">Base Fare</p>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">Includes {selectedVehicle.freeDistance} km</p>
                    </div>
                    <p className="text-[16px] font-black text-slate-900">₹{selectedVehicle.baseFare}</p>
                  </div>
                  
                  <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl">
                    <div>
                      <p className="text-[15px] font-black text-slate-900">Extra Distance</p>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">After {selectedVehicle.freeDistance} km</p>
                    </div>
                    <p className="text-[16px] font-black text-slate-900">₹{selectedVehicle.pricePerKm}/km</p>
                  </div>

                  <div className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl">
                    <div>
                      <p className="text-[15px] font-black text-slate-900">Service Tax</p>
                    </div>
                    <p className="text-[16px] font-black text-slate-900">{selectedVehicle.serviceTax}%</p>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t-2 border-dashed border-slate-200 flex justify-between items-center">
                  <p className="text-[18px] font-black text-slate-900">Total Estimate</p>
                  <p className="text-[28px] font-black text-blue-600">₹{finalFare.toLocaleString()}</p>
                </div>

                <p className="text-[11px] font-bold text-slate-400 text-center mt-6 bg-slate-50 p-3 rounded-xl">
                  Final fare may vary depending on actual tolls, parking charges, or route changes.
                </p>

                <button 
                  onClick={() => setShowFareBreakdown(false)}
                  className="w-full mt-6 h-14 bg-slate-900 text-white rounded-2xl font-black text-[15px] uppercase tracking-wider"
                >
                  Got It
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default IntercityVehicle;
