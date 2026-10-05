import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { 
  ArrowLeft, MapPin, Navigation, ChevronRight, LoaderCircle, AlertTriangle, X, Check, ShieldCheck, MapPinned,
  User, Phone, FileText, CreditCard, Banknote, Wallet
} from 'lucide-react';
import { GoogleMap, Autocomplete } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import api from '../../../../shared/api/axiosInstance';
import { useSettings } from '../../../../shared/context/SettingsContext';

const CITY_CENTERS = {
  Indore: { lat: 22.7196, lng: 75.8577 },
  Bhopal: { lat: 23.2599, lng: 77.4126 },
  Ujjain: { lat: 23.1765, lng: 75.7885 },
  Jabalpur: { lat: 23.1815, lng: 79.9864 },
  Ratlam: { lat: 23.3315, lng: 75.0367 },
  Dewas: { lat: 22.9676, lng: 76.0534 },
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Delhi: { lat: 28.6139, lng: 77.209 },
  Pune: { lat: 18.5204, lng: 73.8567 },
};

const getCityCenter = (city) => CITY_CENTERS[city] || INDIA_CENTER;
const getCityCoords = (city) => {
  const center = getCityCenter(city);
  return [center.lng, center.lat];
};
const unwrapApiPayload = (response) => response?.data?.data || response?.data || response || {};

const generateIntercityBookingId = () =>
  'IC-' + Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, '0');

const generateSearchNonce = () =>
  `intercity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const IntercityDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const state = location.state || {};
  const { fromCity, toCity, vehicle } = state;

  const [pickup, setPickup] = useState(state.pickupAddress || '');
  const [drop, setDrop] = useState('');
  const [pickupCoords, setPickupCoords] = useState(state.pickupCoords || null);
  const [dropCoords, setDropCoords] = useState(null);
  
  // Traveller Details State
  const [travellerName, setTravellerName] = useState('');
  const [travellerPhone, setTravellerPhone] = useState('');
  const [travellerNotes, setTravellerNotes] = useState('');
  
  // Payment State
  const [paymentMethod, setPaymentMethod] = useState('Cash');

  const [showMapPicker, setShowMapPicker] = useState(false);
  const [activeMapField, setActiveMapField] = useState('pickup');
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [pickedAddress, setPickedAddress] = useState('Move the map to choose a location');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const mapInstanceRef = useRef(null);
  const lastCenterRef = useRef(INDIA_CENTER);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  const [autocompletePickup, setAutocompletePickup] = useState(null);
  const [autocompleteDrop, setAutocompleteDrop] = useState(null);
  const [liveDriverCount, setLiveDriverCount] = useState(0);
  const [isFetchingDrivers, setIsFetchingDrivers] = useState(false);
  const [driverFetchError, setDriverFetchError] = useState('');
  const [isProceeding, setIsProceeding] = useState(false);
  
  const { settings } = useSettings();
  const bidRideSettings = settings?.bidRide || {};
  const baseFare = Number(vehicle?.calculatedFare || vehicle?.price || vehicle?.baseFare || 0);

  const shouldUseDriverBidding = Boolean(vehicle?.supportsBidding);
  const selectedBidStepAmount = Number(bidRideSettings.bidding_amount_increase_or_decrease || vehicle?.bidStepAmount || 10);
  const bidLowPercentage = Math.max(0, Math.min(100, Number(bidRideSettings.user_bidding_low_percentage || 10)));
  const bidHighPercentage = Math.max(0, Math.min(100, Number(bidRideSettings.user_bidding_high_percentage || 20)));

  const selectedBidFloorFare = baseFare + Math.round((baseFare * bidLowPercentage) / 100);
  const selectedBidCeilingMaxFare = baseFare + Math.round((baseFare * bidHighPercentage) / 100);
  
  const selectedBidSteps = Math.max(0, Math.round((selectedBidCeilingMaxFare - selectedBidFloorFare) / selectedBidStepAmount));

  const [showBidModal, setShowBidModal] = useState(false);
  const [bidStepCount, setBidStepCount] = useState(1);

  const selectedBidIncrement = bidStepCount * selectedBidStepAmount;
  const selectedBidCeiling = selectedBidFloorFare + selectedBidIncrement;

  const formatCurrency = (amount) => `₹${Math.round(amount).toLocaleString()}`;

  
  const serviceLocationId = useMemo(
    () => state.serviceLocationId || state.selectedPackages?.[0]?.serviceLocationId || '',
    [state.serviceLocationId, state.selectedPackages]
  );

  const effectivePickupCoords = useMemo(
    () => pickupCoords || state.pickupCoords || getCityCoords(fromCity),
    [fromCity, pickupCoords, state.pickupCoords]
  );

  useEffect(() => {
    if (!fromCity || !vehicle) {
      navigate(`${routePrefix}/intercity`, { replace: true });
    }
  }, [fromCity, navigate, routePrefix, vehicle]);

  useEffect(() => {
    let active = true;

    const loadNearbyDrivers = async () => {
      if (!vehicle?.vehicleTypeId || !Array.isArray(effectivePickupCoords)) {
        if (active) {
          setLiveDriverCount(0);
          setDriverFetchError('');
          setIsFetchingDrivers(false);
        }
        return;
      }

      try {
        if (active) {
          setIsFetchingDrivers(true);
          setDriverFetchError('');
        }

        const response = await api.get('/rides/available-drivers', {
          params: {
            vehicleTypeId: vehicle.vehicleTypeId,
            vehicleIconType: vehicle.iconType || vehicle.name || 'car',
            lng: effectivePickupCoords[0],
            lat: effectivePickupCoords[1],
            service_location_id: serviceLocationId,
            transport_type: 'intercity',
          },
        });

        if (!active) return;
        const availability = unwrapApiPayload(response);
        setLiveDriverCount(Number(availability?.totalDrivers || 0));
      } catch (error) {
        if (!active) return;
        setLiveDriverCount(0);
        setDriverFetchError(error?.message || 'Could not fetch live driver availability.');
      } finally {
        if (active) setIsFetchingDrivers(false);
      }
    };

    loadNearbyDrivers();
    return () => { active = false; };
  }, [effectivePickupCoords, serviceLocationId, vehicle]);

  if (!fromCity || !vehicle) return null;

  const handleContinue = async () => {
    if (!pickup.trim() || !drop.trim() || !travellerName || !travellerPhone) {
      alert("Please fill in all mandatory details.");
      return;
    }

    if (shouldUseDriverBidding && !showBidModal) {
      setShowBidModal(true);
      return;
    }

    const nextPickupCoords = pickupCoords || getCityCoords(fromCity);
    const nextDropCoords = dropCoords || getCityCoords(toCity);
    const bookingId = state.bookingId || generateIntercityBookingId();
    let availabilitySnapshot = {
      totalDrivers: liveDriverCount,
      fetchedAt: new Date().toISOString(),
    };

    if (vehicle?.vehicleTypeId && Array.isArray(nextPickupCoords)) {
      try {
        setIsProceeding(true);
        setDriverFetchError('');
        const response = await api.get('/rides/available-drivers', {
          params: {
            vehicleTypeId: vehicle.vehicleTypeId,
            vehicleIconType: vehicle.iconType || vehicle.name || 'car',
            lng: nextPickupCoords[0],
            lat: nextPickupCoords[1],
            service_location_id: serviceLocationId,
            transport_type: 'intercity',
          },
        });
        const availability = unwrapApiPayload(response);
        availabilitySnapshot = {
          ...availability,
          totalDrivers: Number(availability?.totalDrivers || 0),
          fetchedAt: new Date().toISOString(),
        };
        setLiveDriverCount(Number(availability?.totalDrivers || 0));
      } catch (error) {
        setDriverFetchError(error?.message || 'Could not fetch live driver availability.');
      } finally {
        setIsProceeding(false);
      }
    }

    const nextState = {
      ...state,
      bookingId,
      pickup,
      drop,
      pickupCoords: nextPickupCoords,
      dropCoords: nextDropCoords,
      searchNonce: generateSearchNonce(),
      vehicleTypeId: vehicle.vehicleTypeId || '',
      vehicleIconType: vehicle.iconType || vehicle.name || 'car',
      vehicleIconUrl: vehicle.vehicleIconUrl || vehicle.icon || '',
      paymentMethod,
      travellerName,
      travellerPhone,
      travellerNotes,
      serviceType: 'intercity',
      transport_type: 'intercity',
      bookingMode: shouldUseDriverBidding ? 'bidding' : (state.bookingMode || 'normal'),
      pricingNegotiationMode: shouldUseDriverBidding ? 'driver_bid' : 'none',
      bidStepAmount: selectedBidStepAmount,
      bidIncrement: shouldUseDriverBidding ? selectedBidIncrement : 0,
      userMaxBidFare: shouldUseDriverBidding ? selectedBidCeiling : baseFare,
      intercity: {
        bookingId,
        fromCity,
        toCity,
        tripType: state.tripType || 'One Way',
        travelDate: state.date || 'Ride Now',
        passengers: state.passengers || 1,
        distance: Number(state.distance || 0),
        vehicleName: vehicle.name || vehicle.id || 'Intercity Cab',
        packageId: vehicle.packageId || '',
        packageTypeName: vehicle.packageTypeName || 'Intercity',
      },
      driverAvailability: availabilitySnapshot,
    };

    if (state.rideMode === 'schedule' && state.scheduledAt) {
      navigate(`${routePrefix}/intercity/confirm`, {
        state: nextState,
      });
      return;
    }

    navigate(`${routePrefix}/ride/searching`, {
      state: {
        ...nextState,
      }
    });
  };

  const handlePickupPlaceChanged = () => {
    if (autocompletePickup) {
      const place = autocompletePickup.getPlace();
      if (place && place.formatted_address) {
        setPickup(place.formatted_address);
        if (place.geometry) {
          setPickupCoords([place.geometry.location.lng(), place.geometry.location.lat()]);
        }
      }
    }
  };

  const handleDropPlaceChanged = () => {
    if (autocompleteDrop) {
      const place = autocompleteDrop.getPlace();
      if (place && place.formatted_address) {
        setDrop(place.formatted_address);
        if (place.geometry) {
          setDropCoords([place.geometry.location.lng(), place.geometry.location.lat()]);
        }
      }
    }
  };

  const openMapPicker = (field) => {
    const savedCoords = field === 'pickup' ? pickupCoords : dropCoords;
    const savedAddress = field === 'pickup' ? pickup : drop;
    const cityCenter = getCityCenter(field === 'pickup' ? fromCity : toCity);
    const center = Array.isArray(savedCoords)
      ? { lat: savedCoords[1], lng: savedCoords[0] }
      : cityCenter;

    setActiveMapField(field);
    setMapCenter(center);
    lastCenterRef.current = center;
    setPickedAddress(savedAddress || (field === 'pickup' ? `${fromCity} location` : toCity));
    setShowMapPicker(true);
  };

  const handleMapIdle = () => {
    if (!mapInstanceRef.current || !window.google?.maps?.Geocoder) return;

    const center = mapInstanceRef.current.getCenter();
    const lat = center.lat();
    const lng = center.lng();
    const diff = Math.abs(lat - lastCenterRef.current.lat) + Math.abs(lng - lastCenterRef.current.lng);

    if (diff < 0.00001) {
      setIsDragging(false);
      return;
    }

    lastCenterRef.current = { lat, lng };
    setIsDragging(false);
    setIsGeocoding(true);

    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      setIsGeocoding(false);
      if (status === 'OK' && results?.[0]) {
        setPickedAddress(results[0].formatted_address);
        return;
      }
      setPickedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const nextCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo(nextCenter);
          mapInstanceRef.current.setZoom(17);
        } else {
          setMapCenter(nextCenter);
        }
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true }
    );
  };

  const handleConfirmMapLocation = () => {
    const selectedCoords = [lastCenterRef.current.lng, lastCenterRef.current.lat];
    if (activeMapField === 'pickup') {
      setPickup(pickedAddress);
      setPickupCoords(selectedCoords);
    } else {
      setDrop(pickedAddress);
      setDropCoords(selectedCoords);
    }
    setShowMapPicker(false);
  };

  return (
    <div className="min-h-screen bg-[#FAFBFF] max-w-lg mx-auto font-sans pb-40 relative overflow-x-hidden">
      
      {/* Map Picker Modal */}
      <AnimatePresence>
        {showMapPicker && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed inset-0 z-[100] bg-white flex flex-col max-w-lg mx-auto"
          >
            <div className="absolute top-0 left-0 right-0 z-20 px-6 pt-12 pb-6 bg-gradient-to-b from-white via-white/95 to-transparent">
              <div className="flex items-center gap-3">
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowMapPicker(false)} className="w-10 h-10 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100 active:scale-95 transition-all">
                  <ArrowLeft size={20} className="text-slate-900" strokeWidth={2.5} />
                </motion.button>
                <div className="flex-1 bg-white rounded-[24px] shadow-lg border border-slate-100 px-5 py-4 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 mb-1">
                    {activeMapField === 'pickup' ? `Pickup in ${fromCity}` : `Drop in ${toCity}`}
                  </p>
                  <p className="text-[14px] font-bold text-slate-900 truncate leading-tight">
                    {isGeocoding ? 'Finding exact address...' : pickedAddress}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 relative bg-slate-100">
              {!HAS_VALID_GOOGLE_MAPS_KEY ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 px-6 text-center">
                  <div className="rounded-[32px] bg-white px-8 py-10 shadow-xl border border-slate-100 max-w-[300px]">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <X size={32} className="text-rose-400" />
                    </div>
                    <p className="text-[16px] font-black text-slate-900">Map Key Missing</p>
                  </div>
                </div>
              ) : loadError ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 px-6 text-center">
                   <div className="rounded-[32px] bg-white px-8 py-10 shadow-xl border border-slate-100 max-w-[300px]">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} className="text-rose-400" />
                    </div>
                    <p className="text-[16px] font-black text-slate-900">Map Load Failed</p>
                  </div>
                </div>
              ) : isLoaded ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={mapCenter}
                  zoom={15}
                  onLoad={(map) => (mapInstanceRef.current = map)}
                  onIdle={handleMapIdle}
                  onDragStart={() => setIsDragging(true)}
                  options={{ disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy' }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-50">
                  <LoaderCircle size={44} className="animate-spin text-blue-300" />
                </div>
              )}

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[100%] pointer-events-none z-10">
                <motion.div animate={isDragging || isGeocoding ? { y: -15 } : { y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }} className="flex flex-col items-center">
                  <div className="w-12 h-12 bg-blue-600 rounded-[18px] flex items-center justify-center shadow-2xl border-4 border-white">
                    <MapPinned size={20} className="text-white" />
                  </div>
                  <div className="w-1 h-6 bg-blue-600 -mt-2 shadow-2xl" />
                </motion.div>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-2 bg-black/20 rounded-full blur-md" />
              </div>
            </div>

            <div className="px-6 pt-6 pb-12 bg-white border-t border-slate-50 space-y-5">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirmMapLocation}
                disabled={isGeocoding}
                className="w-full h-16 bg-blue-600 rounded-[22px] text-white font-black text-[16px] uppercase tracking-widest shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-40"
              >
                <Check size={20} strokeWidth={3} />
                Confirm Location
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main UI Header */}
      <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-slate-100 bg-white/95 px-6 pb-4 pt-10 backdrop-blur-md">
        <motion.button 
          whileTap={{ scale: 0.9 }}
          onClick={() => navigate(-1)} 
          className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-slate-900" strokeWidth={2.5} />
        </motion.button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] font-black text-slate-900 leading-none">Trip Details</h1>
          <p className="text-[12px] font-bold text-slate-400 mt-1 uppercase tracking-widest truncate">{fromCity} → {toCity}</p>
        </div>
      </header>

      <div className="px-5 pt-6 space-y-6">
        
        {/* Locations Card */}
        <section className="bg-white rounded-[24px] p-5 shadow-sm border border-slate-100 relative">
          <h3 className="text-[14px] font-black uppercase tracking-widest text-slate-400 mb-5 ml-1">Exact Locations</h3>
          <div className="absolute left-[39px] top-[74px] bottom-[44px] w-[2px] bg-slate-100 border-l border-dashed border-slate-200" />
          
          <div className="relative mb-8 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-blue-50 border-2 border-blue-100 flex items-center justify-center shrink-0 z-10">
              <div className="w-2.5 h-2.5 bg-blue-500 rounded-full" />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-1 block">Pickup in {fromCity}</label>
              <div className="relative">
                {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY ? (
                  <Autocomplete onLoad={setAutocompletePickup} onPlaceChanged={handlePickupPlaceChanged} options={{ componentRestrictions: { country: 'in' } }}>
                    <input type="text" placeholder="Building, street, etc." value={pickup} onChange={e => { setPickup(e.target.value); setPickupCoords(null); }} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-[14px] font-bold text-slate-900 focus:outline-none focus:border-blue-300" />
                  </Autocomplete>
                ) : (
                  <input type="text" placeholder="Building, street, etc." value={pickup} onChange={e => { setPickup(e.target.value); setPickupCoords(null); }} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-[14px] font-bold text-slate-900 focus:outline-none focus:border-blue-300" />
                )}
                <MapPinned size={18} onClick={() => openMapPicker('pickup')} className="absolute right-4 top-1/2 -translate-y-1/2 text-blue-500 cursor-pointer" />
              </div>
            </div>
          </div>

          <div className="relative flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center shrink-0 z-10">
              <div className="w-2.5 h-2.5 bg-slate-800" />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-1 block">Drop in {toCity}</label>
              <div className="relative">
                {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY ? (
                  <Autocomplete onLoad={setAutocompleteDrop} onPlaceChanged={handleDropPlaceChanged} options={{ componentRestrictions: { country: 'in' } }}>
                    <input type="text" placeholder="Station, mall, hotel..." value={drop} onChange={e => { setDrop(e.target.value); setDropCoords(null); }} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-[14px] font-bold text-slate-900 focus:outline-none focus:border-blue-300" />
                  </Autocomplete>
                ) : (
                  <input type="text" placeholder="Station, mall, hotel..." value={drop} onChange={e => { setDrop(e.target.value); setDropCoords(null); }} className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-[14px] font-bold text-slate-900 focus:outline-none focus:border-blue-300" />
                )}
                <MapPinned size={18} onClick={() => openMapPicker('drop')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 cursor-pointer" />
              </div>
            </div>
          </div>
        </section>

        {/* Traveller Details Card */}
        <section className="bg-white rounded-[24px] p-5 shadow-sm border border-slate-100">
          <h3 className="text-[14px] font-black uppercase tracking-widest text-slate-400 mb-5 ml-1">Traveller Details</h3>
          <div className="space-y-4">
            <div className="relative">
              <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Full Name" 
                value={travellerName} 
                onChange={(e) => setTravellerName(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-[15px] font-bold text-slate-900 focus:outline-none focus:border-blue-300 transition-all"
              />
            </div>
            <div className="relative">
              <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="tel" 
                placeholder="Mobile Number" 
                value={travellerPhone} 
                onChange={(e) => setTravellerPhone(e.target.value)}
                className="w-full h-14 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-[15px] font-bold text-slate-900 focus:outline-none focus:border-blue-300 transition-all"
              />
            </div>
            <div className="relative">
              <FileText size={18} className="absolute left-4 top-4 text-slate-400" />
              <textarea 
                placeholder="Pickup notes for driver (Optional)" 
                value={travellerNotes} 
                onChange={(e) => setTravellerNotes(e.target.value)}
                className="w-full min-h-[100px] pl-12 pr-4 pt-4 pb-4 bg-slate-50 border border-slate-200 rounded-xl text-[15px] font-bold text-slate-900 focus:outline-none focus:border-blue-300 transition-all resize-none"
              />
            </div>
          </div>
        </section>

        {/* Payment Method Card */}
        <section className="bg-white rounded-[24px] p-5 shadow-sm border border-slate-100">
          <h3 className="text-[14px] font-black uppercase tracking-widest text-slate-400 mb-5 ml-1">Payment Method</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: 'Cash', icon: Banknote, label: 'Cash' },
              { id: 'Online', icon: CreditCard, label: 'Online / UPI' },
              { id: 'Wallet', icon: Wallet, label: 'Wallet' }
            ].map(method => {
              const active = paymentMethod === method.id;
              const Icon = method.icon;
              return (
                <div 
                  key={method.id}
                  onClick={() => setPaymentMethod(method.id)}
                  className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                    active ? 'border-blue-600 bg-blue-50/50 text-blue-600' : 'border-slate-100 bg-white text-slate-500 hover:border-blue-200'
                  }`}
                >
                  <Icon size={24} className="mb-2" />
                  <span className="text-[13px] font-black tracking-wider uppercase">{method.label}</span>
                </div>
              );
            })}
          </div>
        </section>

      </div>

      {/* Book CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg px-6 pb-8 pt-4 bg-white border-t border-slate-100 z-40 rounded-t-[32px] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleContinue}
          disabled={isProceeding}
          className="w-full h-16 bg-blue-600 text-white rounded-[22px] text-[16px] font-black uppercase tracking-[0.1em] flex items-center justify-center gap-3 shadow-xl shadow-blue-500/20 active:scale-95 transition-all"
        >
          {isProceeding ? (
            <>
              <LoaderCircle size={20} className="animate-spin" strokeWidth={3} />
              Securing Booking...
            </>
          ) : (
            <>
              Confirm Booking <ChevronRight size={20} strokeWidth={3} />
            </>
          )}
        </motion.button>
      </div>
      <AnimatePresence>
        {showBidModal && shouldUseDriverBidding && (
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
                Drivers can send offers up to this amount for {vehicle?.name}.
              </p>

              <div className="mt-5 rounded-[20px] border border-blue-600/10 bg-blue-50/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-500/50">Bid Range</p>
                    <p className="mt-1 text-[13px] font-bold text-slate-900">Adjust the fare ceiling inside the configured bidding range.</p>
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
                  className="mt-4 h-2 w-full cursor-pointer accent-blue-600"
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
                  onClick={handleContinue}
                  disabled={isProceeding}
                  className="flex-1 rounded-[18px] bg-emerald-600 px-4 py-3 text-[13px] font-black uppercase tracking-[0.14em] text-white shadow-[0_12px_28px_-4px_rgba(5,150,105,0.4)] disabled:opacity-50"
                >
                  {isProceeding ? <LoaderCircle className="w-5 h-5 animate-spin mx-auto" /> : 'Confirm Bid'}
                </button>
              </div>
            </motion.div>
          </React.Fragment>
        )}
      </AnimatePresence>

    </div>
  );
};

export default IntercityDetails;
