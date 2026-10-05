import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  LoaderCircle,
  MapPin,
  Search,
  Sparkles,
  Clock,
  Navigation,
  X,
  History,
  TrendingUp,
  ShieldCheck,
  Star,
  Info,
  MapPinned,
  Check,
  AlertTriangle,
  Minus
} from 'lucide-react';
import { userService } from '../../services/userService';
import { Autocomplete, GoogleMap, MarkerF, DirectionsRenderer } from '@react-google-maps/api';
import { useAppGoogleMapsLoader, HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER } from '../../../admin/utils/googleMaps';

const normalizeSearchValue = (value) => String(value || '').trim().toLowerCase();

const serializePackageForFlow = (pkg = {}) => ({
  id: pkg.id || '',
  serviceLocationId: pkg.serviceLocationId || '',
  serviceLocationName: pkg.serviceLocationName || '',
  packageTypeId: pkg.packageTypeId || '',
  packageTypeName: pkg.packageTypeName || '',
  destination: pkg.destination || '',
  availability: pkg.availability || 'available',
  vehicles: Array.isArray(pkg.vehicles)
    ? pkg.vehicles.map((vehicle, index) => ({
        id: vehicle.id || `${pkg.id || 'pkg'}:${vehicle.vehicleTypeId || index}`,
        vehicleTypeId: vehicle.vehicleTypeId || '',
        vehicleName: vehicle.vehicleName || 'Vehicle',
        capacity: Number(vehicle.capacity || 0),
        icon: vehicle.icon || '',
        iconType: vehicle.iconType || vehicle.vehicleName || 'car',
        dispatchType: String(vehicle.dispatchType || 'normal').trim().toLowerCase(),
        supportsBidding: ['bidding', 'both'].includes(String(vehicle.dispatchType || 'normal').trim().toLowerCase()),
        basePrice: Number(vehicle.basePrice || 0),
        freeDistance: Number(vehicle.freeDistance || 0),
        distancePrice: Number(vehicle.distancePrice || 0),
        freeTime: Number(vehicle.freeTime || 0),
        timePrice: Number(vehicle.timePrice || 0),
        serviceTax: Number(vehicle.serviceTax || 0),
        cancellationFee: Number(vehicle.cancellationFee || 0),
      }))
    : [],
});

const IntercityHome = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromCity, setFromCity] = useState('');
  const [rideMode, setRideMode] = useState('now');
  
  const [travelDate, setTravelDate] = useState(new Date().toISOString().split('T')[0]);
  const [travelTime, setTravelTime] = useState('');
  const [returnDate, setReturnDate] = useState(''); // New for Round Trip
  const [returnTime, setReturnTime] = useState('');
  
  const [tripType, setTripType] = useState('One Way');
  const [isSearchingCabs, setIsSearchingCabs] = useState(false);
  
  // Map Picker State
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Directions state for drawing route
  const [directions, setDirections] = useState(null);

  const mapInstanceRef = useRef(null);
  const lastCenterRef = useRef(INDIA_CENTER);
  
  // Bottom Sheet State
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  useEffect(() => {
    const loadPackages = async () => {
      try {
        setLoading(true);
        const response = await userService.getIntercityPackages();
        const results = Array.isArray(response?.results) ? response.results : [];
        setPackages(results);
        
        if (results.length > 0 && !fromCity && results[0]?.serviceLocationName) {
          setFromCity(results[0].serviceLocationName);
        }
      } catch (err) {
        setError('Could not load intercity packages');
      } finally {
        setLoading(false);
      }
    };
    loadPackages();
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMapCenter(coords);
          setPickupCoords([coords.lng, coords.lat]);
          reverseGeocode(coords);
        },
        null,
        { enableHighAccuracy: true }
      );
    }
  }, [isLoaded]);

  const reverseGeocode = (coords) => {
    if (!window.google?.maps?.Geocoder) return;
    setIsGeocoding(true);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: coords }, (results, status) => {
      setIsGeocoding(false);
      if (status === 'OK' && results?.[0]) {
        const address = results[0].formatted_address;
        setPickupAddress(address);
        
        const cityObj = results[0].address_components.find(c => 
          c.types.includes('locality') || c.types.includes('administrative_area_level_2')
        );
        if (cityObj) {
          const cityName = cityObj.long_name;
          const matched = packages.find(p => p.serviceLocationName.toLowerCase() === cityName.toLowerCase());
          if (matched) {
            setFromCity(matched.serviceLocationName);
          }
        }
      }
    });
  };

  const calculateRoute = (destinationName) => {
    if (!window.google?.maps?.DirectionsService || !pickupCoords) return;
    
    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: pickupCoords[1], lng: pickupCoords[0] },
        destination: `${destinationName}, India`,
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          setDirections(result);
        } else {
          setDirections(null);
        }
      }
    );
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
    reverseGeocode({ lat, lng });
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

  const filteredPackages = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);
    if (query) {
      return packages.filter((pkg) =>
        normalizeSearchValue(pkg.destination).includes(query) ||
        normalizeSearchValue(pkg.packageTypeName).includes(query) ||
        normalizeSearchValue(pkg.serviceLocationName).includes(query)
      );
    }
    if (fromCity) {
      const cityNormalized = normalizeSearchValue(fromCity);
      const zoneMatches = packages.filter(pkg => 
        normalizeSearchValue(pkg.serviceLocationName) === cityNormalized
      );
      if (zoneMatches.length > 0) return zoneMatches;
    }
    return packages;
  }, [packages, searchQuery, fromCity]);

  const handlePackageSelect = (pkg, customDestination = null) => {
    setIsSearchingCabs(true);
    setTimeout(() => {
      const flowPackage = serializePackageForFlow(pkg);
      const effectiveFromCity = flowPackage.serviceLocationName || fromCity || 'Pickup City';
      const effectiveToCity = customDestination || flowPackage.destination;

      navigate(`${routePrefix}/intercity/vehicle`, {
        state: {
          fromCity: effectiveFromCity,
          toCity: effectiveToCity,
          tripType,
          rideMode,
          date: rideMode === 'now' ? 'Ride Now' : (travelTime ? `${travelDate} at ${travelTime}` : travelDate),
          returnDate: tripType === 'Round Trip' ? (returnTime ? `${returnDate} at ${returnTime}` : returnDate) : null,
          selectedPackages: [flowPackage],
          pickupAddress,
          pickupCoords
        }
      });
      setIsSearchingCabs(false);
    }, 1200); // Simulate network load
  };

  const handleSearchCabs = () => {
    if (!searchQuery) return;
    
    // Check if we have an "Anywhere" package or "India (All)" zone
    const genericPackage = packages.find(p => p.destination === 'Anywhere' || p.serviceLocationName === 'India (All)');
    
    if (genericPackage) {
      calculateRoute(searchQuery);
      handlePackageSelect(genericPackage, searchQuery);
    } else if (packages.length > 0) {
      // Fallback to first available package
      calculateRoute(searchQuery);
      handlePackageSelect(packages[0], searchQuery);
    } else {
      // Ultimate fallback if backend returns empty array
      calculateRoute(searchQuery);
      handlePackageSelect({
        id: 'mock-package',
        serviceLocationName: 'India',
        destination: 'Anywhere',
        availability: 'available',
        vehicles: [
          {
            id: 'mock-vehicle-1',
            vehicleTypeId: 'mock-vehicle-1',
            vehicleName: 'Sedan',
            capacity: 4,
            iconType: 'sedan',
            dispatchType: 'bidding',
            basePrice: 500,
            freeDistance: 10,
            distancePrice: 15,
            freeTime: 0,
            timePrice: 0,
            serviceTax: 5,
            cancellationFee: 0,
          },
          {
            id: 'mock-vehicle-2',
            vehicleTypeId: 'mock-vehicle-2',
            vehicleName: 'SUV',
            capacity: 6,
            iconType: 'suv',
            dispatchType: 'bidding',
            basePrice: 800,
            freeDistance: 10,
            distancePrice: 20,
            freeTime: 0,
            timePrice: 0,
            serviceTax: 5,
            cancellationFee: 0,
          }
        ]
      }, searchQuery);
    }
  };

  const [autocompleteDrop, setAutocompleteDrop] = useState(null);
  const handleDropPlaceChanged = () => {
    if (autocompleteDrop) {
      const place = autocompleteDrop.getPlace();
      if (place && place.formatted_address) {
        setSearchQuery(place.formatted_address);
      }
    }
  };

  const [autocompletePickup, setAutocompletePickup] = useState(null);
  const handlePickupPlaceChanged = () => {
    if (autocompletePickup) {
      const place = autocompletePickup.getPlace();
      if (place && place.formatted_address) {
        setPickupAddress(place.formatted_address);
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          setPickupCoords([lng, lat]);
          setMapCenter({ lat, lng });
          if (mapInstanceRef.current) {
            mapInstanceRef.current.panTo({ lat, lng });
            mapInstanceRef.current.setZoom(17);
          }
        }
      }
    }
  };


  return (
    <div className="h-screen w-full bg-slate-100 relative overflow-hidden flex flex-col font-sans max-w-lg mx-auto shadow-2xl">
      {/* Background Map */}
      <div className="absolute inset-0 z-0">
        {HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={mapCenter}
            zoom={14}
            onLoad={(map) => (mapInstanceRef.current = map)}
            onIdle={handleMapIdle}
            onDragStart={() => setIsDragging(true)}
            options={{
              disableDefaultUI: true,
              clickableIcons: false,
              gestureHandling: 'greedy',
              styles: [
                { featureType: 'poi', stylers: [{ visibility: 'off' }] },
                { featureType: 'transit', stylers: [{ visibility: 'off' }] },
              ],
            }}
          >
            {directions && (
              <DirectionsRenderer
                directions={directions}
                options={{
                  polylineOptions: { strokeColor: '#2563EB', strokeWeight: 4 },
                  suppressMarkers: true,
                }}
              />
            )}
          </GoogleMap>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-slate-200">
            <MapPinned size={40} className="text-slate-400" />
          </div>
        )}

        {/* Center Pin Overlay (Only when not routing) */}
        {!directions && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 flex flex-col items-center">
            <motion.div animate={isDragging || isGeocoding ? { y: -15 } : { y: 0 }} transition={{ type: 'spring' }}>
              <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center shadow-xl border-[3px] border-white">
                <div className="w-3 h-3 bg-white rounded-full" />
              </div>
              <div className="w-1 h-6 bg-slate-900 mx-auto" />
            </motion.div>
          </div>
        )}
      </div>

      {/* Floating Header */}
      <header className="absolute top-0 left-0 right-0 z-30 px-5 pt-10 pb-4 bg-gradient-to-b from-black/50 to-transparent pointer-events-none flex items-center justify-between">
        <button 
          onClick={() => navigate(routePrefix || '/')} 
          className="w-11 h-11 rounded-full bg-white/90 backdrop-blur-md shadow-lg flex items-center justify-center pointer-events-auto active:scale-95 transition-all"
        >
          <ArrowLeft size={22} className="text-slate-900" strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-white/90 backdrop-blur-md rounded-full shadow-lg pointer-events-auto">
          <ShieldCheck size={16} className="text-blue-600" />
          <span className="text-[12px] font-black uppercase tracking-wider text-slate-800">Intercity</span>
        </div>
      </header>

      <button
        onClick={handleUseCurrentLocation}
        className="absolute top-28 right-5 w-11 h-11 bg-white rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all z-20"
      >
        {isLocating ? <LoaderCircle size={20} className="animate-spin text-blue-600" /> : <Navigation size={20} className="text-slate-700" />}
      </button>

      {/* Bottom Sheet UI */}
      <motion.div 
        className="absolute bottom-0 left-0 right-0 z-40 bg-white rounded-t-[32px] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] flex flex-col"
        animate={{ height: isSheetExpanded ? '85vh' : 'auto' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      >
        {/* Drag Handle */}
        <div 
          className="w-full pt-4 pb-2 flex justify-center cursor-pointer"
          onClick={() => setIsSheetExpanded(!isSheetExpanded)}
        >
          <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
        </div>

        <div className="px-6 pb-6 flex-1 overflow-y-auto hide-scrollbar">
          
          <h2 className="text-[24px] font-black text-slate-900 mb-5 leading-tight">
            Plan your <span className="text-blue-600">outstation</span> trip
          </h2>

          {/* Trip Type Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-[16px] mb-5">
            {['One Way', 'Round Trip'].map(type => (
              <button
                key={type}
                onClick={() => {
                  setTripType(type);
                  if (type === 'Round Trip') setRideMode('schedule');
                }}
                className={`flex-1 py-2.5 rounded-[12px] text-[14px] font-bold transition-all ${
                  tripType === type ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Location Inputs */}
          <div className="relative mb-5 bg-slate-50 rounded-[24px] p-4 border border-slate-100">
            {/* Connection Line */}
            <div className="absolute left-8 top-10 bottom-10 w-0.5 bg-slate-200" />
            
            {/* Pickup */}
            <div className="relative flex items-center gap-4 mb-4">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 z-10">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
              </div>
              <div className="flex-1 min-w-0 relative">
                <p className="text-[11px] font-black uppercase text-slate-400 mb-0.5 tracking-wider">Pickup</p>
                {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY ? (
                  <Autocomplete
                    onLoad={setAutocompletePickup}
                    onPlaceChanged={handlePickupPlaceChanged}
                    options={{ componentRestrictions: { country: 'in' } }}
                  >
                    <input
                      type="text"
                      placeholder="Search pickup location..."
                      value={pickupAddress}
                      onChange={(e) => setPickupAddress(e.target.value)}
                      onFocus={() => setIsSheetExpanded(true)}
                      className="w-full bg-transparent text-[15px] font-bold text-slate-900 outline-none placeholder:text-slate-300 truncate"
                    />
                  </Autocomplete>
                ) : (
                  <input
                    type="text"
                    placeholder="Search pickup location..."
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    onFocus={() => setIsSheetExpanded(true)}
                    className="w-full bg-transparent text-[15px] font-bold text-slate-900 outline-none placeholder:text-slate-300 truncate"
                  />
                )}
                {pickupAddress && (
                  <button onClick={() => setPickupAddress('')} className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-slate-400 z-20">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="w-full h-[1px] bg-slate-200 mb-4 pl-12" />

            {/* Destination */}
            <div className="relative flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0 z-10">
                <div className="w-2.5 h-2.5 bg-slate-900" />
              </div>
              <div className="flex-1 min-w-0 relative">
                <p className="text-[11px] font-black uppercase text-slate-400 mb-0.5 tracking-wider">Destination</p>
                {isLoaded && HAS_VALID_GOOGLE_MAPS_KEY ? (
                  <Autocomplete
                    onLoad={setAutocompleteDrop}
                    onPlaceChanged={handleDropPlaceChanged}
                    options={{ componentRestrictions: { country: 'in' } }}
                  >
                    <input
                      type="text"
                      placeholder="Search any city in India..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (!isSheetExpanded) setIsSheetExpanded(true);
                      }}
                      onFocus={() => setIsSheetExpanded(true)}
                      className="w-full bg-transparent text-[16px] font-bold text-slate-900 outline-none placeholder:text-slate-300"
                    />
                  </Autocomplete>
                ) : (
                  <input
                    type="text"
                    placeholder="Search any city in India..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (!isSheetExpanded) setIsSheetExpanded(true);
                    }}
                    onFocus={() => setIsSheetExpanded(true)}
                    className="w-full bg-transparent text-[16px] font-bold text-slate-900 outline-none placeholder:text-slate-300"
                  />
                )}
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setDirections(null); }} className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-slate-400 z-20">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Date & Time Selectors */}
          <div className="flex gap-3 mb-6">
            <div className="flex-1">
              <p className="text-[11px] font-black uppercase text-slate-400 mb-1.5 tracking-wider ml-1">Departure</p>
              <div className="relative">
                <Calendar size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  value={travelDate}
                  onChange={(e) => {
                    const selected = e.target.value;
                    setTravelDate(selected);
                    const today = new Date().toISOString().split('T')[0];
                    if (selected !== today || tripType === 'Round Trip') {
                      setRideMode('schedule');
                    } else {
                      setRideMode('now');
                    }
                  }}
                  className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-[14px] font-bold text-slate-900 outline-none focus:border-blue-200"
                />
              </div>
            </div>
            
            <AnimatePresence>
              {tripType === 'Round Trip' && (
                <motion.div 
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: '50%' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="overflow-hidden"
                >
                  <p className="text-[11px] font-black uppercase text-slate-400 mb-1.5 tracking-wider ml-1">Return</p>
                  <div className="relative">
                    <Calendar size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="date"
                      min={travelDate}
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-[14px] font-bold text-slate-900 outline-none focus:border-blue-200"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Time Selectors (Only if Scheduled or Round Trip) */}
          <AnimatePresence>
            {rideMode === 'schedule' && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex gap-3 mb-6 overflow-hidden"
              >
                <div className="flex-1">
                  <p className="text-[11px] font-black uppercase text-slate-400 mb-1.5 tracking-wider ml-1">Departure Time</p>
                  <div className="relative">
                    <Clock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="time"
                      value={travelTime}
                      onChange={(e) => setTravelTime(e.target.value)}
                      className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-[14px] font-bold text-slate-900 outline-none focus:border-blue-200"
                    />
                  </div>
                </div>
                
                {tripType === 'Round Trip' && (
                  <div className="flex-1">
                    <p className="text-[11px] font-black uppercase text-slate-400 mb-1.5 tracking-wider ml-1">Return Time</p>
                    <div className="relative">
                      <Clock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="time"
                        value={returnTime}
                        onChange={(e) => setReturnTime(e.target.value)}
                        className="w-full h-12 pl-11 pr-4 bg-slate-50 border border-slate-100 rounded-2xl text-[14px] font-bold text-slate-900 outline-none focus:border-blue-200"
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search Button */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleSearchCabs}
              disabled={!searchQuery || isSearchingCabs || loading}
              className="w-full h-14 bg-blue-600 rounded-[20px] text-white font-black text-[15px] uppercase tracking-widest shadow-xl shadow-blue-500/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:bg-slate-300 disabled:shadow-none transition-all"
            >
              {isSearchingCabs ? (
                <>
                  <LoaderCircle size={20} className="animate-spin" />
                  Searching Cabs...
                </>
              ) : (
                <>
                  <Search size={20} strokeWidth={3} />
                  Search Cabs
                </>
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default IntercityHome;
