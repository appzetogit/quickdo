import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Fuel, Shield, ChevronRight, Star, Info, Car, Search, X } from 'lucide-react';
import { userService } from '../../services/userService';

const DURATION_TABS = ['Hourly', 'Half-Day', 'Daily'];
const RENTAL_SELECTED_VEHICLE_STORAGE_KEY = 'selectedRentalVehicleDetail';
const RENTAL_PAGE_SIZE = 10;

const infoBanner = {
  Hourly: 'Short rentals for quick city use.',
  'Half-Day': 'Mid-length rentals for errands and local trips.',
  Daily: 'Full-day rentals for flexible travel and extended usage.',
};

const durationSuffix = { Hourly: '/hr', 'Half-Day': '/6hr', Daily: '/day' };

const gradientPairs = [
  ['#FFF7ED', '#FFFFFF'],
  ['#F0FDF4', '#FFFFFF'],
  ['#EFF6FF', '#FFFFFF'],
  ['#FDF4FF', '#FFFFFF'],
  ['#FEF2F2', '#FFFFFF'],
];

const normalizeSearchValue = (value = '') => String(value || '').trim().toLowerCase();

const findPricingBucket = (pricing = [], minHours, maxHours = Infinity) =>
  pricing.find(
    (item) =>
      Number(item.durationHours || 0) >= minHours &&
      Number(item.durationHours || 0) <= maxHours &&
      item.active !== false,
  );

const normalizeRentalVehicle = (item = {}, index = 0) => {
  const [gradientFrom, gradientTo] = gradientPairs[index % gradientPairs.length];
  const pricing = Array.isArray(item.pricing) ? item.pricing : [];
  const hourly = findPricingBucket(pricing, 1, 5) || pricing[0] || null;
  const halfDay = findPricingBucket(pricing, 6, 12) || hourly || pricing[0] || null;
  const daily = findPricingBucket(pricing, 24, Infinity) || pricing[pricing.length - 1] || halfDay || hourly;
  const capacity = Number(item.capacity || 0);
  const luggageCapacity = Number(item.luggageCapacity || 0);
  const isBike = String(item.vehicleCategory || '').toLowerCase() === 'bike';

  const featureSet = new Set(Array.isArray(item.amenities) ? item.amenities.filter(Boolean) : []);
  if (capacity > 0) featureSet.add(`${capacity} seat${capacity === 1 ? '' : 's'}`);
  if (luggageCapacity > 0) featureSet.add(`${luggageCapacity} bag${luggageCapacity === 1 ? '' : 's'} space`);
  if (!featureSet.size) {
    featureSet.add(isBike ? 'Helmet included' : 'Comfort ride');
  }

  const prices = {
    Hourly: Number(hourly?.price || 0),
    'Half-Day': Number(halfDay?.price || 0),
    Daily: Number(daily?.price || 0),
  };

  const kmLimit = {
    Hourly: `${Number(hourly?.includedKm || 0)} km`,
    'Half-Day': `${Number(halfDay?.includedKm || 0)} km`,
    Daily: `${Number(daily?.includedKm || 0)} km`,
  };

  const sortedPackages = [...pricing].sort(
    (a, b) => Number(a.durationHours || 0) - Number(b.durationHours || 0),
  );
  const mostExpensive = sortedPackages.reduce(
    (best, current) =>
      Number(current.price || 0) > Number(best?.price || 0) ? current : best,
    sortedPackages[0] || null,
  );
  const cheapest = sortedPackages.reduce(
    (best, current) =>
      Number(current.price || 0) < Number(best?.price || 0) ? current : best,
    sortedPackages[0] || null,
  );

  let tag = `${item.vehicleCategory || 'Rental'} Ready`;
  let tagColor = 'text-blue-600';
  let tagBg = 'bg-blue-50 border-blue-100';

  if (mostExpensive && String(mostExpensive.id) === String(daily?.id)) {
    tag = 'Premium';
    tagColor = 'text-purple-600';
    tagBg = 'bg-purple-50 border-purple-100';
  } else if (cheapest && String(cheapest.id) === String(hourly?.id)) {
    tag = 'Best Value';
    tagColor = 'text-emerald-600';
    tagBg = 'bg-emerald-50 border-emerald-100';
  } else if (isBike) {
    tag = 'Most Popular';
    tagColor = 'text-primary-orange/50';
    tagBg = 'bg-primary-orange/5 border-primary-orange/10';
  }

  const gallery = [
    item.coverImage,
    item.image,
    ...(Array.isArray(item.galleryImages) ? item.galleryImages : []),
    ...(Array.isArray(item.gallery) ? item.gallery : []),
    item.map_icon,
  ].filter((value, currentIndex, array) => value && array.indexOf(value) === currentIndex);

  return {
    id: item.id || item._id,
    name: item.name || 'Rental Vehicle',
    tag,
    tagColor,
    tagBg,
    image: item.image || '',
    rating: '4.8',
    fuel: isBike ? 'Self-drive · License required' : 'Self-drive · Clean and sanitized',
    prices,
    kmLimit,
    features: Array.from(featureSet).slice(0, 4),
    gradientFrom,
    gradientTo,
    rawPricing: pricing,
    gallery,
    blueprint: item.blueprint || { lowerDeck: [], upperDeck: [] },
    amenities: Array.isArray(item.amenities) ? item.amenities.filter(Boolean) : [],
    shortDescription: item.short_description || '',
    description: item.description || '',
    luggageCapacity,
    capacity,
    vehicleCategory: item.vehicleCategory || 'Vehicle',
    advancePayment: {
      enabled: Boolean(item.advancePayment?.enabled),
      paymentMode: 'fixed',
      amount: Number(item.advancePayment?.amount || 0),
      label: item.advancePayment?.label || 'Advance booking payment',
      notes: item.advancePayment?.notes || '',
    },
  };
};

const BikeRentalHome = () => {
  const [selectedDuration, setSelectedDuration] = useState('Hourly');
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const navigate = useNavigate();

  const openVehicleDetail = (vehicle) => {
    const payload = {
      vehicle,
      duration: selectedDuration,
    };

    try {
      window.sessionStorage.setItem(RENTAL_SELECTED_VEHICLE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures and continue with navigation state.
    }

    navigate('/rental/vehicle', { state: payload });
  };

  useEffect(() => {
    let mounted = true;

    const loadVehicles = async () => {
      setLoading(true);
      setErrorMessage('');
      try {
        const response = await userService.getRentalVehicles();
        const results = response?.data?.results || response?.results || [];

        if (!mounted) return;

        setVehicles(
          results
            .map((item, index) => normalizeRentalVehicle(item, index))
            .filter((item) => Object.values(item.prices).some((price) => Number(price) > 0)),
        );
      } catch (error) {
        if (mounted) {
          setErrorMessage(error?.message || 'Could not load rental vehicles.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadVehicles();
    return () => {
      mounted = false;
    };
  }, []);

  const availableCountLabel = useMemo(() => {
    const bikes = vehicles.filter(
      (item) => String(item.vehicleCategory || '').toLowerCase() === 'bike',
    ).length;

    if (bikes === vehicles.length && vehicles.length > 0) {
      return `${vehicles.length} bikes`;
    }

    return `${vehicles.length} vehicles`;
  }, [vehicles]);

  const rentalSuggestions = useMemo(() => {
    const seen = new Set();
    const suggestions = [];

    vehicles.forEach((vehicle) => {
      [vehicle.name, vehicle.vehicleCategory, ...(vehicle.amenities || []), ...(vehicle.features || [])]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .forEach((item) => {
          const key = item.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            suggestions.push(item);
          }
        });
    });

    return suggestions;
  }, [vehicles]);

  const visibleSuggestions = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);

    if (!query) {
      return rentalSuggestions.slice(0, 6);
    }

    return rentalSuggestions
      .filter((item) => normalizeSearchValue(item).includes(query))
      .slice(0, 6);
  }, [rentalSuggestions, searchQuery]);

  const filteredVehicles = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);

    if (!query) {
      return vehicles;
    }

    return vehicles.filter((vehicle) => {
      const haystack = [
        vehicle.name,
        vehicle.vehicleCategory,
        vehicle.shortDescription,
        vehicle.description,
        vehicle.fuel,
        ...(vehicle.amenities || []),
        ...(vehicle.features || []),
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [searchQuery, vehicles]);

  const filteredCountLabel = `${filteredVehicles.length} result${filteredVehicles.length === 1 ? '' : 's'}`;
  const totalPages = Math.max(1, Math.ceil(filteredVehicles.length / RENTAL_PAGE_SIZE));
  const paginatedVehicles = useMemo(() => {
    const startIndex = (currentPage - 1) * RENTAL_PAGE_SIZE;
    return filteredVehicles.slice(startIndex, startIndex + RENTAL_PAGE_SIZE);
  }, [currentPage, filteredVehicles]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage((previousPage) => Math.min(previousPage, totalPages));
  }, [totalPages]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans relative overflow-hidden pb-12">
      <div className="absolute -top-16 right-[-40px] h-44 w-44 rounded-full bg-primary-orange/10/60 blur-3xl pointer-events-none" />
      <div className="absolute bottom-28 right-[-40px] h-40 w-40 rounded-full bg-blue-100/60 blur-3xl pointer-events-none" />

      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="bg-white/90 backdrop-blur-md px-5 pt-10 pb-4 sticky top-0 z-20 border-b border-white/80 shadow-[0_4px_20px_rgba(15,23,42,0.05)]"
      >
        <div className="flex items-center gap-3 mb-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-[12px] border border-white/80 bg-white/90 flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.07)] shrink-0"
          >
            <ArrowLeft size={18} className="text-slate-900" strokeWidth={2.5} />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-slate-400">Self-drive · No driver needed</p>
            <h1 className="text-[19px] font-black tracking-tight text-slate-900 leading-tight">Rental Vehicles</h1>
          </div>
          <div className="rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-[10px] font-black text-slate-600 shadow-sm shrink-0">
            {availableCountLabel}
          </div>
        </div>

        <div className="flex gap-1.5 bg-slate-100/80 p-1.5 rounded-[16px]">
          {DURATION_TABS.map((tab) => (
            <motion.button
              key={tab}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedDuration(tab)}
              className={`flex-1 py-2 rounded-[12px] text-[11px] font-black uppercase tracking-widest transition-all ${
                selectedDuration === tab
                  ? 'bg-white text-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.08)]'
                  : 'text-slate-400'
              }`}
            >
              {tab}
            </motion.button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-3 rounded-[16px] border border-slate-200 bg-white px-4 py-3 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
            <Search size={16} className="text-slate-400 shrink-0" strokeWidth={2.6} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search rental vehicle, category, seats or amenity"
              className="w-full bg-transparent text-[13px] font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400 shrink-0"
              >
                <X size={14} strokeWidth={2.8} />
              </button>
            ) : null}
          </div>

          {visibleSuggestions.length ? (
            <div className="flex flex-wrap gap-2">
              {visibleSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setSearchQuery(suggestion)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 shadow-sm"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </motion.header>

      <div className="px-5 pt-4 space-y-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedDuration}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.22 }}
            className="flex items-center gap-3 rounded-[16px] border border-white/80 bg-white/90 px-4 py-3 shadow-[0_4px_14px_rgba(15,23,42,0.05)]"
          >
            <div className="w-7 h-7 rounded-[10px] bg-blue-50 flex items-center justify-center shrink-0">
              <Info size={14} className="text-blue-500" strokeWidth={2.5} />
            </div>
            <p className="text-[12px] font-black text-slate-700">{infoBanner[selectedDuration]}</p>
          </motion.div>
        </AnimatePresence>

        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">Available Rentals</p>
          <div className="mt-0.5 flex items-end justify-between gap-3">
            <h2 className="text-[16px] font-black tracking-tight text-slate-900">Choose your ride</h2>
            {searchQuery ? (
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{filteredCountLabel}</span>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="rounded-[24px] border border-white/80 bg-white/90 p-5 text-[13px] font-bold text-slate-400 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            Loading rental vehicles...
          </div>
        ) : errorMessage ? (
          <div className="rounded-[24px] border border-rose-100 bg-rose-50/90 p-5 text-[13px] font-bold text-rose-500 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            {errorMessage}
          </div>
        ) : vehicles.length === 0 ? (
          <div className="rounded-[24px] border border-white/80 bg-white/90 p-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[16px] bg-slate-100 text-slate-400">
              <Car size={22} />
            </div>
            <p className="mt-4 text-[15px] font-black text-slate-900">No rental vehicles available</p>
            <p className="mt-1 text-[12px] font-bold text-slate-400">Admin has not published any active rental vehicles yet.</p>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="rounded-[24px] border border-white/80 bg-white/90 p-6 text-center shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[16px] bg-slate-100 text-slate-400">
              <Search size={22} />
            </div>
            <p className="mt-4 text-[15px] font-black text-slate-900">No rentals matched your search</p>
            <p className="mt-1 text-[12px] font-bold text-slate-400">Try another vehicle name, category, or amenity.</p>
          </div>
        ) : (
          paginatedVehicles.map((v, idx) => (
            <motion.div
              key={v.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, delay: idx * 0.07, ease: 'easeOut' }}
              className="rounded-[24px] border border-white/80 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden"
            >
              <div
                className="px-4 pt-3.5 pb-3 flex items-center justify-between"
                style={{ background: `linear-gradient(135deg, ${v.gradientFrom} 0%, ${v.gradientTo} 100%)` }}
              >
                <div className="flex-1 min-w-0 pr-2 space-y-1">
                  <span className={`inline-block text-[9px] font-black px-2 py-0.5 rounded-full border ${v.tagBg} ${v.tagColor}`}>
                    {v.tag}
                  </span>
                  <h3 className="text-[15px] font-black text-slate-900 leading-tight tracking-tight">{v.name}</h3>
                  {v.shortDescription ? (
                    <p className="text-[10px] font-bold text-slate-500">{v.shortDescription}</p>
                  ) : null}
                  <div className="flex items-center gap-1">
                    <Star size={10} className="text-yellow-500 fill-yellow-400" />
                    <span className="text-[11px] font-black text-slate-700">{v.rating}</span>
                    <span className="text-[10px] font-bold text-slate-400">· {v.kmLimit[selectedDuration]} limit</span>
                  </div>
                </div>
                {v.image ? (
                  <img src={v.image} alt={v.name} className="h-20 w-24 object-contain drop-shadow-lg shrink-0 -mt-2 -mb-2" />
                ) : (
                  <div className="flex h-20 w-24 items-center justify-center rounded-[20px] bg-white/60 text-slate-300 shadow-sm shrink-0">
                    <Car size={28} />
                  </div>
                )}
              </div>

              <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-slate-50">
                <div className="flex flex-wrap gap-1">
                  {v.features.map((feature) => (
                    <span key={feature} className="text-[9px] font-black bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full border border-slate-100">
                      {feature}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <Fuel size={11} className="text-slate-300 shrink-0" />
                  <span className="text-[11px] font-bold text-slate-400">{v.fuel}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] block">Price</span>
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-[22px] font-black text-slate-900 tracking-tighter leading-none">₹{v.prices[selectedDuration]}</span>
                      <span className="text-[11px] font-bold text-slate-400 ml-0.5">{durationSuffix[selectedDuration]}</span>
                    </div>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => openVehicleDetail(v)}
                    className="bg-slate-900 text-white px-4 py-2.5 rounded-[12px] text-[11px] font-black uppercase tracking-widest flex items-center gap-1 shadow-[0_6px_16px_rgba(15,23,42,0.18)] active:bg-black transition-all"
                  >
                    Book Now <ChevronRight size={13} strokeWidth={3} className="opacity-60" />
                  </motion.button>
                </div>
              </div>
            </motion.div>
          ))
        )}

        {!loading && !errorMessage && filteredVehicles.length > RENTAL_PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3 rounded-[20px] border border-white/80 bg-white/90 px-4 py-3.5 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600 disabled:opacity-40"
            >
              Previous
            </button>
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Page</p>
              <p className="mt-1 text-[13px] font-black text-slate-900">{currentPage} / {totalPages}</p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
              className="rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-3 rounded-[16px] border border-white/80 bg-white/90 px-4 py-3.5 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
          <div className="w-8 h-8 rounded-[10px] bg-slate-50 flex items-center justify-center shrink-0">
            <Shield size={15} className="text-slate-400" strokeWidth={2} />
          </div>
          <p className="text-[11px] font-bold text-slate-400 leading-relaxed">
            All rental vehicles shown here come from the admin catalog. Valid driving license and verification are required before pickup.
          </p>
        </div>
      </div>
    </div>
  );
};

export default BikeRentalHome;
