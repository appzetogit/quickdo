import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MapPin, X, Plus, Minus, Check, Map as MapIcon, LoaderCircle, Navigation, AlertTriangle, ChevronRight } from 'lucide-react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import { useAppGoogleMapsLoader, INDIA_CENTER, HAS_VALID_GOOGLE_MAPS_KEY } from '../../../admin/utils/googleMaps';
import api from '../../../../shared/api/axiosInstance';
import { getSavedLocation, getSavedLocationCoords, saveLocation } from '../../services/locationStore';

const DEFAULT_COORDS = [75.8577, 22.7196];
const sanitizeLocationInput = (value) => String(value || '').replace(/^\s+/g, '').replace(/\s{2,}/g, ' ');

const unwrapResults = (response) => {
  const payload = response?.data?.data || response?.data || response;
  return payload?.results || payload?.zones || (Array.isArray(payload) ? payload : []);
};

const getZoneServiceLocationId = (zone) =>
  zone?.service_location_id?._id
  || zone?.service_location_id?.id
  || zone?.service_location_id
  || zone?.service_location?._id
  || zone?.service_location?.id
  || zone?.service_location
  || '';

const isZoneActive = (zone) => zone?.active !== false && Number(zone?.status ?? 1) !== 0;

const toZonePoint = (point) => {
  if (Array.isArray(point) && point.length >= 2) {
    const [lng, lat] = point;
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      return { lat: Number(lat), lng: Number(lng) };
    }
  }

  if (point && typeof point === 'object') {
    const lat = Number(point.lat ?? point.latitude);
    const lng = Number(point.lng ?? point.longitude ?? point.lon);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  return null;
};

const normalizeZonePath = (zone) => {
  const source = Array.isArray(zone?.coordinates?.[0]) && Array.isArray(zone?.coordinates?.[0]?.[0])
    ? zone.coordinates[0]
    : zone?.coordinates;

  if (!Array.isArray(source)) {
    return [];
  }

  return source.map(toZonePoint).filter(Boolean);
};

const getBoundsFromPaths = (paths) => {
  if (!paths.length) {
    return null;
  }

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  paths.forEach((path) => {
    path.forEach((point) => {
      north = Math.max(north, point.lat);
      south = Math.min(south, point.lat);
      east = Math.max(east, point.lng);
      west = Math.min(west, point.lng);
    });
  });

  if (![north, south, east, west].every(Number.isFinite)) {
    return null;
  }

  return { north, south, east, west };
};

const isPointInPolygon = (point, polygon) => {
  if (!point || polygon.length < 3) {
    return false;
  }

  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersects = ((yi > point.lat) !== (yj > point.lat))
      && (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInAnyZone = (point, zonePaths) => {
  if (!zonePaths.length) {
    return true;
  }

  return zonePaths.some((path) => isPointInPolygon(point, path));
};

const SelectLocation = () => {
  const location = useLocation();
  const routeState = location.state || {};
  const searchParams = new URLSearchParams(location.search);
  const rideType = routeState.rideType || searchParams.get('rideType') || 'normal';
  const serviceLocationId = routeState.service_location_id || routeState.serviceLocationId || '';
  const savedLocation = getSavedLocation();
  const savedPickupLabel = String(savedLocation?.address || '').trim();
  const savedPickupCoords = getSavedLocationCoords();
  const [pickup, setPickup] = useState(() => routeState.pickup || savedPickupLabel || '');
  const [drop, setDrop] = useState(() => routeState.drop || '');
  const [pickupCoords, setPickupCoords] = useState(() => routeState.pickupCoords || savedPickupCoords || null);
  const [dropCoords, setDropCoords] = useState(() => routeState.dropCoords || null);
  const [stops, setStops] = useState(() => routeState.stops || []);          // array of stop strings
  const [confirmedPickup, setConfirmedPickup] = useState(() => routeState.pickup || savedPickupLabel || '');
  const [confirmedDrop, setConfirmedDrop] = useState(() => routeState.drop || '');
  const [confirmedStops, setConfirmedStops] = useState(() => routeState.stops || []);
  const [activeInput, setActiveInput] = useState('drop'); // 'pickup' | 'drop' | stopIdx
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [mapCenter, setMapCenter] = useState(INDIA_CENTER);
  const [pickedAddress, setPickedAddress] = useState('Loading address...');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [zonePaths, setZonePaths] = useState([]);
  const [remoteResults, setRemoteResults] = useState([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const [customError, setCustomError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const mapInstanceRef = useRef(null);
  const lastCenterRef = useRef(INDIA_CENTER);
  const geocoderRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);
  const autocompleteSessionTokenRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const latestSearchRef = useRef(0);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const navigate = useNavigate();
  const routePrefix = window.location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';


  const zoneBounds = useMemo(() => getBoundsFromPaths(zonePaths), [zonePaths]);

  useEffect(() => {
    let active = true;

    const loadZones = async () => {
      if (!serviceLocationId) {
        setZonePaths([]);
        return;
      }

      try {
        const response = await api.get('/admin/zones');
        if (!active) {
          return;
        }

        const matchingPaths = unwrapResults(response)
          .filter((zone) => isZoneActive(zone) && String(getZoneServiceLocationId(zone)) === String(serviceLocationId))
          .map(normalizeZonePath)
          .filter((path) => path.length >= 3);

        setZonePaths(matchingPaths);
      } catch {
        if (active) {
          setZonePaths([]);
        }
      }
    };

    loadZones();

    return () => {
      active = false;
    };
  }, [serviceLocationId]);

  useEffect(() => {
    if (!isLoaded || !window.google?.maps?.places?.AutocompleteService) {
      return;
    }

    autocompleteServiceRef.current = autocompleteServiceRef.current || new window.google.maps.places.AutocompleteService();
    placesServiceRef.current = placesServiceRef.current || new window.google.maps.places.PlacesService(document.createElement('div'));
    autocompleteSessionTokenRef.current = autocompleteSessionTokenRef.current
      || new window.google.maps.places.AutocompleteSessionToken();
  }, [isLoaded]);

  const getAutocompleteSessionToken = () => {
    if (!window.google?.maps?.places?.AutocompleteSessionToken) {
      return null;
    }

    if (!autocompleteSessionTokenRef.current) {
      autocompleteSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
    }

    return autocompleteSessionTokenRef.current;
  };

  const resetAutocompleteSessionToken = () => {
    if (!window.google?.maps?.places?.AutocompleteSessionToken) {
      autocompleteSessionTokenRef.current = null;
      return;
    }

    autocompleteSessionTokenRef.current = new window.google.maps.places.AutocompleteSessionToken();
  };

  const getPlacesService = () => {
    if (!window.google?.maps?.places?.PlacesService) {
      return null;
    }

    if (!placesServiceRef.current) {
      placesServiceRef.current = new window.google.maps.places.PlacesService(document.createElement('div'));
    }

    return placesServiceRef.current;
  };

  const getGeocoder = () => {
    if (!window.google?.maps?.Geocoder) {
      return null;
    }

    if (!geocoderRef.current) {
      geocoderRef.current = new window.google.maps.Geocoder();
    }

    return geocoderRef.current;
  };

  const resolveCoords = async (label, fallback = DEFAULT_COORDS) => {
    if (!label || !String(label).trim()) {
      return fallback;
    }

    if (!window.google?.maps?.Geocoder) {
      return fallback;
    }

    const geocoder = getGeocoder();
    if (!geocoder) {
      return fallback;
    }

    return new Promise((resolve) => {
      geocoder.geocode({ address: String(label).trim() }, (results, status) => {
        if (status === 'OK' && results?.[0]?.geometry?.location) {
          const location = results[0].geometry.location;
          resolve([location.lng(), location.lat()]);
          return;
        }

        resolve(fallback);
      });
    });
  };

  const resolvePlaceSelection = async (result) => {
    if (Array.isArray(result?.coords) && result.coords.length === 2) {
      return {
        title: result.title,
        address: result.address || result.title,
        coords: result.coords,
      };
    }

    const geocoder = getGeocoder();
    const placesService = getPlacesService();

    if (result?.placeId && placesService) {
      return new Promise((resolve) => {
        placesService.getDetails(
          {
            placeId: result.placeId,
            sessionToken: getAutocompleteSessionToken(),
            fields: ['formatted_address', 'geometry.location', 'name'],
          },
          (place, status) => {
            const location = place?.geometry?.location;

            if (status === 'OK' && location) {
              resolve({
                title: result.title || place.name || place.formatted_address,
                address: place.formatted_address || result.address || result.title || '',
                coords: [location.lng(), location.lat()],
              });
              return;
            }

            if (geocoder) {
              geocoder.geocode({ placeId: result.placeId }, (results, geocodeStatus) => {
                const geocodedPlace = results?.[0];
                const geocodedLocation = geocodedPlace?.geometry?.location;

                if (geocodeStatus === 'OK' && geocodedLocation) {
                  resolve({
                    title: result.title || geocodedPlace.formatted_address,
                    address: geocodedPlace.formatted_address || result.address || result.title || '',
                    coords: [geocodedLocation.lng(), geocodedLocation.lat()],
                  });
                  return;
                }

                resolve({
                  title: result?.title || '',
                  address: result?.address || result?.title || '',
                  coords: DEFAULT_COORDS,
                });
              });
              return;
            }

            resolve({
              title: result?.title || '',
              address: result?.address || result?.title || '',
              coords: DEFAULT_COORDS,
            });
          },
        );
      });
    }

    if (!geocoder) {
      return {
        title: result?.title || '',
        address: result?.address || result?.title || '',
        coords: await resolveCoords(result?.address || result?.title || ''),
      };
    }

    const coords = await resolveCoords(result?.address || result?.title || '');
    return {
      title: result?.title || '',
      address: result?.address || result?.title || '',
      coords,
    };
  };

  const validateZoneSelection = (coords) => {
    if (!Array.isArray(coords) || coords.length !== 2) {
      return false;
    }

    const [lng, lat] = coords;
    const point = { lat: Number(lat), lng: Number(lng) };

    return isPointInAnyZone(point, zonePaths);
  };

  const getQuery = () => {
    if (activeInput === 'pickup') return pickup;
    if (activeInput === 'drop') return drop;
    if (typeof activeInput === 'number') return stops[activeInput] || '';
    return '';
  };

  const query = getQuery();

  const isQueryUnchanged = useMemo(() => {
    if (activeInput === 'pickup' && query === confirmedPickup) return true;
    if (activeInput === 'drop' && query === confirmedDrop) return true;
    if (typeof activeInput === 'number' && query === confirmedStops[activeInput]) return true;
    return false;
  }, [activeInput, query, confirmedPickup, confirmedDrop, confirmedStops]);

  // Hide keyboard on manual scroll/swipe or outside click
  useEffect(() => {
    const handleManualScroll = () => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      }
    };

    const handleOutsideClick = (e) => {
      if (e.target && e.target.closest && e.target.closest('#location-input-card')) {
        return;
      }
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      }
    };

    window.addEventListener('touchmove', handleManualScroll, { passive: true });
    window.addEventListener('wheel', handleManualScroll, { passive: true });
    document.addEventListener('touchstart', handleOutsideClick, { passive: true });
    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      window.removeEventListener('touchmove', handleManualScroll);
      window.removeEventListener('wheel', handleManualScroll);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!query.trim() || query.trim().length < 3 || !HAS_VALID_GOOGLE_MAPS_KEY || !autocompleteServiceRef.current) {
      setRemoteResults([]);
      setIsSearchingLocations(false);
      return;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const cached = searchCacheRef.current.get(normalizedQuery);
    if (cached) {
      setRemoteResults(cached);
      setIsSearchingLocations(false);
      return;
    }

    const requestId = latestSearchRef.current + 1;
    latestSearchRef.current = requestId;
    setIsSearchingLocations(true);

    const timeoutId = window.setTimeout(() => {
      const request = {
        input: query.trim(),
        componentRestrictions: { country: 'in' },
        sessionToken: getAutocompleteSessionToken(),
      };

      if (zoneBounds) {
        request.bounds = zoneBounds;
      }

      autocompleteServiceRef.current.getPlacePredictions(request, (predictions = [], status) => {
        if (latestSearchRef.current !== requestId) {
          return;
        }

        if (status !== 'OK') {
            console.error('[Google Maps Autocomplete Error]', status, predictions);
        }

        const nextResults = status === 'OK'
          ? predictions.slice(0, 6).map((prediction) => ({
            title: prediction.structured_formatting?.main_text || prediction.description,
            address: prediction.description,
            placeId: prediction.place_id,
          }))
          : [];

        searchCacheRef.current.set(normalizedQuery, nextResults);
        setRemoteResults(nextResults);
        setIsSearchingLocations(false);
      });
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [query, zoneBounds]);

  const POPULAR_LOCATIONS = [
    { title: 'Indore Junction', address: 'Railway Station, Chhoti Gwaltoli, Indore, Madhya Pradesh', coords: [75.8677, 22.7176] },
    { title: 'Devi Ahilya Bai Holkar Airport', address: 'Devi Ahilyabai Holkar Airport, Indore, Madhya Pradesh', coords: [75.8011, 22.7214] },
    { title: 'Vijay Nagar', address: 'Vijay Nagar Square, Indore, Madhya Pradesh', coords: [75.8970, 22.7533] },
    { title: 'Rajwada Palace', address: 'Rajwada, Indore, Madhya Pradesh', coords: [75.8532, 22.7183] },
    { title: 'Bhawarkua Square', address: 'Bhawarkua, Indore, Madhya Pradesh', coords: [75.8690, 22.6953] },
  ];

  const searchResults = useMemo(() => {
    if (query.trim().length === 0 || isQueryUnchanged) {
      return POPULAR_LOCATIONS;
    }

    const merged = [...remoteResults];
    const seen = new Set();

    return merged.filter((result) => {
      const key = `${String(result.title || '').trim().toLowerCase()}|${String(result.address || '').trim().toLowerCase()}`;
      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [remoteResults, query]);

  const showMapToast = () => {
    // Reset map center to pickup or current location before opening
    const startCoord = Array.isArray(pickupCoords) && pickupCoords.length === 2
      ? { lat: pickupCoords[1], lng: pickupCoords[0] }
      : INDIA_CENTER;
    
    setMapCenter(startCoord);
    lastCenterRef.current = startCoord;
    setShowMapPicker(true);
  };

  const handleMapIdle = () => {
    if (!mapInstanceRef.current || !window.google) return;
    const center = mapInstanceRef.current.getCenter();
    const lat = center.lat();
    const lng = center.lng();
    
    // Only update and geocode if the center has actually changed significantly
    const dist = Math.abs(lat - lastCenterRef.current.lat) + Math.abs(lng - lastCenterRef.current.lng);
    if (dist < 0.00001) {
      setIsDragging(false);
      return;
    }
    
    lastCenterRef.current = { lat, lng };
    setIsDragging(false);

    // Reverse Geocode
    setIsGeocoding(true);
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      setIsGeocoding(false);
      if (status === 'OK' && results[0]) {
        setPickedAddress(results[0].formatted_address);
      } else {
        setPickedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    });
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const newCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo(newCoords);
          mapInstanceRef.current.setZoom(17);
        }
      },
      () => {
        setIsLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleConfirmNavigate = async (optionalDrop, optionalDropCoords = null) => {
    const finalDrop = optionalDrop || drop;
    const finalPickup = pickup;
    
    if (!finalDrop || finalDrop.trim().length === 0 || !finalPickup || finalPickup.trim().length === 0) return;

    setCustomError('');
    setIsValidating(true);

    const resolvedPickupCoords = pickupCoords || await resolveCoords(finalPickup);
    const resolvedDropCoords = optionalDropCoords || dropCoords || await resolveCoords(finalDrop);

    try {
      await api.post('/rides/validate-location', {
        pickupCoords: resolvedPickupCoords,
        dropCoords: resolvedDropCoords,
        rideType,
      });
    } catch (err) {
      setIsValidating(false);
      setCustomError(err?.response?.data?.message || 'Service is not available in the selected location.');
      return;
    }

    setIsValidating(false);

    saveLocation({
      address: finalPickup,
      lat: resolvedPickupCoords[1],
      lon: resolvedPickupCoords[0],
    });

    navigate(`${routePrefix}/ride/select-vehicle`, {
      state: {
        pickup: finalPickup,
        drop: finalDrop,
        stops: stops.filter(s => s.trim().length > 0),
        pickupCoords: resolvedPickupCoords,
        dropCoords: resolvedDropCoords,
        service_location_id: serviceLocationId,
        rideType,
        transport_type: rideType === 'outstation' ? 'intercity' : rideType === 'pooling' ? 'pooling' : 'taxi',
        transportType: rideType === 'outstation' ? 'intercity' : rideType === 'pooling' ? 'pooling' : 'taxi',
        intercity: rideType === 'outstation',
      },
    });
  };

  const handleConfirmMapLocation = () => {
    const finalAddress = pickedAddress;
    const selectedCoords = [lastCenterRef.current.lng, lastCenterRef.current.lat];

    if (!validateZoneSelection(selectedCoords)) {
      window.alert('Please pin a location inside the active service zone.');
      return;
    }

    if (activeInput === 'pickup') {
      setPickup(finalAddress);
      setConfirmedPickup(finalAddress);
      setPickupCoords(selectedCoords);
      saveLocation({
        address: finalAddress,
        lat: selectedCoords[1],
        lon: selectedCoords[0],
      });
      setActiveInput('drop');
    } else if (activeInput === 'drop') {
      setDrop(finalAddress);
      setConfirmedDrop(finalAddress);
      setDropCoords(selectedCoords);
      // Auto-navigate if it's the destination
      handleConfirmNavigate(finalAddress, selectedCoords);
    } else if (typeof activeInput === 'number') {
      updateStop(activeInput, finalAddress);
      setConfirmedStops(prev => {
        const next = [...prev];
        next[activeInput] = finalAddress;
        return next;
      });
    }
    setShowMapPicker(false);
  };

  const handleUseCurrentLocationResult = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results, status) => {
          if (status === 'OK' && results[0]) {
            const addr = results[0].formatted_address;
            const coords = [longitude, latitude];
            if (activeInput === 'drop') {
              setDrop(addr);
              setDropCoords(coords);
              handleConfirmNavigate(addr, coords);
            } else {
              handleSelectResult(addr, coords);
            }
          } else {
            const raw = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
            const coords = [longitude, latitude];
            if (activeInput === 'drop') {
              setDrop(raw);
              setDropCoords(coords);
              handleConfirmNavigate(raw, coords);
            } else {
              handleSelectResult(raw, coords);
            }
          }
        });
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true }
    );
  };


  // Add a new empty stop
  const addStop = () => {
    setStops(prev => [...prev, '']);
    setActiveInput(stops.length); // focus the new stop
  };

  // Remove a stop by index
  const removeStop = (idx) => {
    setStops(prev => prev.filter((_, i) => i !== idx));
    setActiveInput('drop');
  };

  // Update a stop value
  const updateStop = (idx, val) => {
    setStops(prev => prev.map((s, i) => i === idx ? val : s));
  };

  // When a suggestion is tapped
  const handleSelectResult = async (result, selectedCoords = null) => {
    const normalizedResult = typeof result === 'string'
      ? { title: result, address: result, coords: selectedCoords }
      : result;
    const resolvedSelection = await resolvePlaceSelection(normalizedResult);
    const finalTitle = resolvedSelection.title || resolvedSelection.address;
    const resolvedCoords = selectedCoords || resolvedSelection.coords;

    if (activeInput === 'pickup') {
      setPickup(finalTitle);
      setConfirmedPickup(finalTitle);
      setPickupCoords(resolvedCoords);
      saveLocation({
        address: finalTitle,
        lat: resolvedCoords[1],
        lon: resolvedCoords[0],
      });
      setActiveInput('drop');
    } else if (activeInput === 'drop') {
      setDrop(finalTitle);
      setConfirmedDrop(finalTitle);
      setDropCoords(resolvedCoords);
      handleConfirmNavigate(finalTitle, resolvedCoords);
    } else if (typeof activeInput === 'number') {
      updateStop(activeInput, finalTitle);
      setConfirmedStops(prev => {
        const next = [...prev];
        next[activeInput] = finalTitle;
        return next;
      });
      // Move to next stop or drop
      if (activeInput < stops.length - 1) {
        setActiveInput(activeInput + 1);
      } else {
        setActiveInput('drop');
      }
    }
  };

  return (
    <div 
      className="min-h-screen bg-[linear-gradient(180deg,#F8FAFC_0%,#F3F4F6_38%,#EEF2F7_100%)] max-w-lg mx-auto font-sans relative overflow-hidden pb-6"
      onClick={(e) => {
        if (e.target.tagName !== 'INPUT' && document.activeElement && document.activeElement.tagName === 'INPUT') {
          document.activeElement.blur();
        }
      }}
    >
      <style>{`
        @keyframes blob { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(50px, -30px) scale(1.2); } }
        @keyframes blob-reverse { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-40px, 40px) scale(1.3); } }
      `}</style>
      <div className="absolute -top-20 right-[-40px] h-48 w-48 rounded-full bg-indigo-400/20 blur-[80px] pointer-events-none animate-[blob_8s_ease-in-out_infinite]" />
      <div className="absolute top-56 left-[-60px] h-56 w-56 rounded-full bg-cyan-400/20 blur-[80px] pointer-events-none animate-[blob-reverse_10s_ease-in-out_infinite]" />
      <div className="absolute bottom-16 right-[-40px] h-44 w-44 rounded-full bg-blue-400/20 blur-[80px] pointer-events-none animate-[blob_12s_ease-in-out_infinite]" />
      <AnimatePresence>
        {showMapPicker && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            className="fixed inset-0 z-[100] bg-white flex flex-col max-w-lg mx-auto"
          >
            {/* Map Header */}
            <div className="absolute top-0 left-0 right-0 z-20 px-5 pt-10 pb-4 bg-gradient-to-b from-white via-white/80 to-transparent">
               <div className="flex items-center gap-3">
                  <button 
                    onClick={() => setShowMapPicker(false)}
                    className="w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border border-slate-100 active:scale-95 transition-all"
                  >
                    <ArrowLeft size={20} className="text-[#111d3a]" strokeWidth={2.5} />
                  </button>
                  <div className="flex-1 bg-white rounded-2xl shadow-lg border border-slate-100 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Select Point</p>
                    <p className="text-[14px] font-semibold text-[#111d3a] truncate leading-tight">
                      {isGeocoding ? 'Locating...' : pickedAddress}
                    </p>
                  </div>
               </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 relative bg-slate-200">
              {!HAS_VALID_GOOGLE_MAPS_KEY ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 px-6 text-center">
                  <div className="rounded-3xl bg-white px-8 py-10 shadow-xl border border-slate-100">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <X size={32} className="text-rose-400" />
                    </div>
                    <p className="text-[16px] font-bold text-[#111d3a]">Config Error</p>
                    <p className="mt-2 text-[13px] font-medium text-slate-500">
                      Google Maps API Key is missing.
                    </p>
                  </div>
                </div>
              ) : loadError ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 px-6 text-center">
                  <div className="rounded-3xl bg-white px-8 py-10 shadow-xl border border-slate-100">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle size={32} className="text-rose-400" />
                    </div>
                    <p className="text-[16px] font-bold text-[#111d3a]">Load Failed</p>
                    <p className="mt-2 text-[13px] font-medium text-slate-500">
                      Map could not be loaded. Please check your browser console or network.
                    </p>
                  </div>
                </div>
              ) : isLoaded ? (
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={mapCenter}
                  zoom={16}
                  onLoad={(map) => (mapInstanceRef.current = map)}
                  onIdle={handleMapIdle}
                  onDragStart={() => setIsDragging(true)}
                  options={{
                    disableDefaultUI: true,
                    clickableIcons: false,
                    gestureHandling: 'greedy',
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-slate-50">
                  <div className="relative">
                    <LoaderCircle size={44} className="animate-spin text-slate-300" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <MapIcon size={18} className="text-slate-200" />
                    </div>
                  </div>
                  <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-slate-400 animate-pulse">Initializing Maps</p>
                </div>
              )}

              {/* Central Pin - Uber Style */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[100%] pointer-events-none z-10">
                <div className="relative">
                  <motion.div 
                    animate={isDragging || isGeocoding ? { y: -12 } : { y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="flex flex-col items-center"
                  >
                    <div className="w-10 h-10 bg-[#2563eb] rounded-2xl flex items-center justify-center shadow-2xl rotate-45 border-2 border-white">
                      <div className="-rotate-45">
                        <MapIcon size={18} className="text-white fill-white/20" />
                      </div>
                    </div>
                    {/* Stick */}
                    <div className="w-1 h-5 bg-[#2563eb] -mt-2 shadow-2xl" />
                  </motion.div>
                  {/* Shadow Dot */}
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-1 bg-black/30 rounded-full blur-sm" />
                </div>
              </div>

              {/* Current Location FAB */}
              <button 
                onClick={handleUseCurrentLocation}
                disabled={isLocating}
                className="absolute bottom-6 right-5 w-12 h-12 bg-white rounded-2xl shadow-xl flex items-center justify-center border border-slate-100 active:scale-90 transition-all z-20"
              >
                {isLocating ? (
                  <LoaderCircle size={20} className="animate-spin text-slate-400" />
                ) : (
                  <Navigation size={20} className="text-[#111d3a] fill-slate-900/10" />
                )}
              </button>
            </div>

            {/* Confirm Actions */}
            <div className="px-5 pt-4 pb-10 bg-white border-t border-slate-50 space-y-4">
              <div className="flex items-center gap-3 py-1 px-1">
                 <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                    <MapPin size={20} className="text-slate-400" />
                 </div>
                 <div className="min-w-0 flex-1">
                    <h4 className="text-[15px] font-bold text-[#111d3a] leading-none">Confirm Spot</h4>
                    <p className="text-[12px] font-medium text-slate-400 mt-1 line-clamp-1">{pickedAddress}</p>
                 </div>
              </div>
              <button
                onClick={handleConfirmMapLocation}
                disabled={isGeocoding}
                className="w-full bg-[#2563eb] py-4 rounded-3xl text-white font-bold text-[15px] shadow-xl shadow-slate-200 flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Check size={18} strokeWidth={3} />
                Confirm Location
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sticky Header & Input Card Wrapper */}
      <div className="sticky top-0 z-30 bg-[#F4F7F6]/95 backdrop-blur-md pb-2 shadow-[0_10px_20px_rgba(15,23,42,0.05)] border-b border-white/30">
        {/* Header */}
        <header className="relative z-30">
          <div className="px-5 py-4 flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 -ml-2 active:scale-95 transition-all rounded-full">
              <ArrowLeft size={22} className="text-[#111d3a]" strokeWidth={3} />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ride</p>
              <h1 className="mt-0.5 text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#111d3a] to-[#2563eb] tracking-tight leading-none truncate">Where to?</h1>
            </div>
          </div>
        </header>

      {/* Input Card */}
      <div className="relative z-10 px-5 pt-4">
        <div 
          id="location-input-card" 
          className="bg-white/90 backdrop-blur-xl rounded-[28px] p-4 shadow-[0_18px_44px_rgba(15,23,42,0.12)] border border-white/90 transition-all hover:shadow-[0_24px_54px_rgba(15,23,42,0.16)]"
          onMouseLeave={() => {
            if (document.activeElement && document.activeElement.tagName === 'INPUT') {
              document.activeElement.blur();
            }
          }}
        >
          <div className="space-y-3">

            {/* Pickup Row */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <div className="w-5 h-5 rounded-full border-2 border-blue-700 bg-white/70 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-700" />
                </div>
              </div>
              <div
                className={`flex-1 flex items-center bg-white/70 border border-white/80 rounded-xl px-3 py-2.5 transition-all ${activeInput === 'pickup' ? 'ring-2 ring-blue-200' : ''}`}
                onClick={() => setActiveInput('pickup')}
              >
                <input
                  type="text"
                  value={pickup}
                  onChange={(e) => setPickup(sanitizeLocationInput(e.target.value))}
                  onFocus={() => setActiveInput('pickup')}
                  placeholder="Your pickup location"
                  className="w-full bg-transparent border-none text-[15px] font-medium text-[#111d3a] focus:outline-none placeholder:text-slate-300"
                />
                {pickup.length > 0 && (
                  <button onClick={() => setPickup('')} className="ml-2 shrink-0">
                    <X size={16} className="text-slate-300 hover:text-slate-600 transition-colors" />
                  </button>
                )}
              </div>
            </div>

            {/* Dotted connector */}
            <div className="ml-[9px] h-2 w-[1.5px] border-l-[1.5px] border-dotted border-slate-300/70" />

            {/* Dynamic Stops */}
            <AnimatePresence>
              {stops.map((stop, idx) => (
                <motion.div
                  key={`stop-${idx}`}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <div className="w-5 h-5 rounded-full border-2 border-sky-500 bg-white/70 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                      </div>
                    </div>
                    <div
                      className={`flex-1 flex items-center rounded-xl px-3 py-2.5 transition-all ${
                        stop.trim().length > 0
                          ? 'bg-white/90 border border-sky-200 shadow-[0_10px_24px_rgba(99,102,241,0.10)]'
                          : 'bg-sky-50/70 border border-sky-100/70'
                      } ${activeInput === idx ? 'ring-2 ring-sky-200' : ''}`}
                      onClick={() => setActiveInput(idx)}
                    >
                      <input
                        type="text"
                        value={stop}
                        autoFocus={activeInput === idx}
                        placeholder={`Stop ${idx + 1} location...`}
                        onFocus={() => setActiveInput(idx)}
                        onChange={(e) => updateStop(idx, sanitizeLocationInput(e.target.value))}
                        className={`w-full bg-transparent border-none text-[15px] font-medium text-[#111d3a] focus:outline-none ${
                          stop.trim().length > 0 ? 'placeholder:text-slate-300' : 'placeholder:text-sky-300'
                        }`}
                      />
                      {stop.length > 0 && (
                        <button onClick={() => updateStop(idx, '')} className="ml-2 shrink-0">
                          <X size={16} className="text-sky-300 hover:text-sky-600 transition-colors" />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => removeStop(idx)}
                      className="w-7 h-7 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 active:scale-95 transition-all"
                    >
                      <Minus size={14} className="text-rose-500" strokeWidth={3} />
                    </button>
                  </div>
                  {/* Connector after each stop */}
                  <div className="ml-[9px] mt-3 h-2 w-[1.5px] border-l-[1.5px] border-dotted border-slate-300/70" />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Drop Row */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <div className="w-5 h-5 rounded-full border-2 border-blue-600 bg-white/70 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                </div>
              </div>
              <div
                className={`flex-1 flex items-center bg-white/70 border border-white/80 rounded-xl px-3 py-2.5 transition-all ${activeInput === 'drop' ? 'ring-2 ring-blue-600/20' : ''}`}
                onClick={() => setActiveInput('drop')}
              >
                <input
                  type="text"
                  value={drop}
                  autoFocus={activeInput === 'drop'}
                  placeholder="Enter drop location..."
                  onFocus={() => setActiveInput('drop')}
                  onChange={(e) => setDrop(sanitizeLocationInput(e.target.value))}
                  className="w-full bg-transparent border-none text-[15px] font-medium text-[#111d3a] focus:outline-none placeholder:text-slate-300"
                />
                {drop.length > 0 && (
                  <button onClick={() => setDrop('')} className="ml-2 shrink-0">
                    <X size={16} className="text-slate-300 hover:text-slate-600 transition-colors" />
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
      </div>

      {/* Action Pills */}
      <div className="relative z-10 flex gap-3 px-5 my-4">
        <motion.button
          onClick={showMapToast}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="flex-1 flex items-center justify-center gap-2 bg-white/90 backdrop-blur-md border border-white/80 rounded-full py-3 shadow-[0_12px_26px_rgba(15,23,42,0.08)] hover:shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-shadow text-[13px] font-bold text-[#111d3a]"
        >
          <MapPin size={16} className="text-[#111d3a]" strokeWidth={2.5} />
          <span>Select on map</span>
        </motion.button>
        <motion.button
          onClick={addStop}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="flex-1 flex items-center justify-center gap-2 rounded-full py-3 shadow-[0_12px_26px_rgba(15,23,42,0.08)] hover:shadow-[0_16px_32px_rgba(15,23,42,0.12)] transition-shadow text-[13px] font-bold bg-white/90 backdrop-blur-md border border-white/80 text-[#4F46E5]"
        >
          <div className="w-4 h-4 rounded bg-[#4F46E5] flex items-center justify-center">
            <Plus size={12} className="text-white" strokeWidth={3} />
          </div>
          <span>Add stop {stops.length > 0 ? `(${stops.length})` : ''}</span>
        </motion.button>
      </div>

      {/* Stop count chips */}
      {stops.length > 0 && (
        <div className="relative z-10 px-5 mb-2">
          <div className="flex gap-2 flex-wrap">
            {stops.map((s, idx) => (
              <div key={idx} className="flex items-center gap-1.5 bg-white/75 backdrop-blur-md border border-white/80 rounded-full px-3 py-1 shadow-sm">
                <div className="w-2 h-2 rounded-full bg-sky-400" />
                <span className="text-[12px] font-bold text-slate-700 truncate max-w-[110px]">
                  {s.trim() || `Stop ${idx + 1}`}
                </span>
                <button onClick={() => removeStop(idx)}>
                  <X size={11} className="text-slate-400 hover:text-slate-700" strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results */}
      <div 
        className="relative z-10 px-5 mb-4 pb-24"
        onTouchMove={() => {
          if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            document.activeElement.blur();
          }
        }}
        onWheel={() => {
          if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            document.activeElement.blur();
          }
        }}
      >
        <h2 className="text-[14px] font-bold text-slate-400 mb-3 ml-1 uppercase tracking-widest">
          {query.trim().length > 0 ? 'Search Results' : 'Popular Locations'}
        </h2>

        {searchResults.length > 0 ? (
          <div className="bg-white/75 backdrop-blur-md rounded-2xl border border-white/80 overflow-hidden shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
            {/* Quick Go to Current Location */}
            <motion.button
              whileTap={{ scale: 0.99 }}
              onClick={handleUseCurrentLocationResult}
              className="w-full text-left flex items-center gap-3 px-4 py-3.5 border-b border-white/70 bg-blue-50/30 hover:bg-blue-50/50 transition-colors group"
            >
               <div className="w-10 h-10 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center justify-center shrink-0">
                  {isLocating ? (
                     <LoaderCircle size={18} className="animate-spin text-blue-500" />
                  ) : (
                     <Navigation size={18} className="text-blue-500 fill-blue-50" />
                  )}
               </div>
               <div className="flex-1">
                  <h4 className="text-[15px] font-bold text-[#111d3a] leading-tight group-hover:text-blue-600 transition-colors">Use Current Location</h4>
                  <p className="text-[12px] text-slate-400 font-medium mt-0.5">Perfect for accurate pickup</p>
               </div>
               <ChevronRight size={16} className="text-slate-300" />
            </motion.button>

            {searchResults.map((result, idx) => (
              <motion.button
                key={idx}
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={() => handleSelectResult(result)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/70 last:border-none hover:bg-white/60 transition-colors"
              >
                <div className="mt-0.5 w-10 h-10 rounded-2xl bg-white/70 border border-white/80 shadow-sm flex items-center justify-center shrink-0 text-slate-500">
                  <MapPin size={18} strokeWidth={2.6} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-[15px] font-semibold text-[#111d3a] leading-tight">{result.title}</h4>
                  <p className="text-[13px] text-slate-500 font-medium mt-1 line-clamp-1">{result.address}</p>
                </div>
              </motion.button>
            ))}
          </div>
        ) : query.trim().length === 0 ? (
          <div className="bg-white/75 backdrop-blur-md rounded-2xl border border-white/80 overflow-hidden shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
            {/* Quick Go to Current Location */}
            <motion.button
              whileTap={{ scale: 0.99 }}
              onClick={handleUseCurrentLocationResult}
              className="w-full text-left flex items-center gap-3 px-4 py-3.5 border-b border-white/70 bg-blue-50/30 hover:bg-blue-50/50 transition-colors group"
            >
               <div className="w-10 h-10 rounded-2xl bg-white border border-blue-100 shadow-sm flex items-center justify-center shrink-0">
                  {isLocating ? (
                     <LoaderCircle size={18} className="animate-spin text-blue-500" />
                  ) : (
                     <Navigation size={18} className="text-blue-500 fill-blue-50" />
                  )}
               </div>
               <div className="flex-1">
                  <h4 className="text-[15px] font-bold text-[#111d3a] leading-tight group-hover:text-blue-600 transition-colors">Use Current Location</h4>
                  <p className="text-[12px] text-slate-400 font-medium mt-0.5">Perfect for accurate pickup</p>
               </div>
               <ChevronRight size={16} className="text-slate-300" />
            </motion.button>

            {[
              { title: 'Airport Indore', address: 'Devi Ahilya Bai Holkar Airport, Indore' },
              { title: 'Indore Junction', address: 'Indore Junction Railway Station, Indore' },
              { title: 'Rajwada Palace', address: 'Rajwada Palace, Indore' },
              { title: 'Bhawarkuan Square', address: 'Bhawarkuan, Indore' }
            ].map((result, idx) => (
              <motion.button
                key={idx}
                type="button"
                whileTap={{ scale: 0.99 }}
                onClick={() => handleSelectResult(result)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/70 last:border-none hover:bg-white/60 transition-colors"
              >
                <div className="mt-0.5 w-10 h-10 rounded-2xl bg-white/70 border border-white/80 shadow-sm flex items-center justify-center shrink-0 text-slate-500">
                  <MapPin size={18} strokeWidth={2.6} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-[15px] font-semibold text-[#111d3a] leading-tight">{result.title}</h4>
                  <p className="text-[13px] text-slate-500 font-medium mt-1 line-clamp-1">{result.address}</p>
                </div>
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-3xl bg-white/80 border border-white/80 shadow-sm flex items-center justify-center mx-auto text-slate-400 text-[22px] font-bold">
              —
            </div>
            <p className="mt-3 text-[15px] font-semibold text-slate-600">
              No results for <span className="text-[#111d3a]">"{query}"</span>
            </p>
            <p className="text-[13px] font-medium text-slate-400 mt-1">Try a different search term</p>
          </div>
        )}
        {query.trim().length >= 3 && (
          <div className="mt-3 px-1">
            <p className="text-[11px] font-bold text-slate-400">
              {isSearchingLocations
                ? 'Searching locations inside your service zone...'
                : zonePaths.length
                  ? 'Showing zone-prioritized results after 3+ characters. Selections outside the zone are blocked.'
                  : 'Showing optimized search results after 3+ characters.'}
            </p>
          </div>
        )}
      </div>

      {/* Persistent Confirm Button */}
      <AnimatePresence>
        {pickup && drop && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-6 left-5 right-5 z-40 flex flex-col gap-2"
          >
            {customError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-2xl flex items-start gap-3 shadow-sm">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p className="text-[13px] font-medium leading-tight">{customError}</p>
              </div>
            )}
            <button
              onClick={() => handleConfirmNavigate()}
              disabled={isValidating}
              className="w-full bg-blue-600 py-4 rounded-3xl text-white font-bold text-[16px] shadow-[0_8px_30px_rgba(5,150,105,0.3)] flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100"
            >
              {isValidating ? (
                <>
                  <LoaderCircle size={18} className="animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  Confirm & Proceed
                  <ChevronRight size={18} strokeWidth={3} className="opacity-60" />
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SelectLocation;
