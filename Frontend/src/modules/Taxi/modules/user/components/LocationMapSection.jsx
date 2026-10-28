import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LoaderCircle, Navigation } from 'lucide-react';
import { GoogleMap } from '@react-google-maps/api';
import { HAS_VALID_GOOGLE_MAPS_KEY, useAppGoogleMapsLoader } from '../../admin/utils/googleMaps';
import { getSavedLocation, saveLocation } from '../services/locationStore';
const DEFAULT_CENTER = { lat: 17.385, lon: 78.4867 };
const DEFAULT_ZOOM = 16;
const MAP_CONTAINER_STYLE = { width: '100%', height: '100%' };
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const areCentersNearlyEqual = (first, second, threshold = 0.00001) => (
  Math.abs(Number(first?.lat ?? 0) - Number(second?.lat ?? 0)) < threshold &&
  Math.abs(Number(first?.lon ?? 0) - Number(second?.lon ?? 0)) < threshold
);

const LocationMapSection = () => {
  const [coords, setCoords] = useState(null);
  const [centerCoords, setCenterCoords] = useState(DEFAULT_CENTER);
  const [status, setStatus] = useState('idle');
  const [isDragging, setIsDragging] = useState(false);
  const [map, setMap] = useState(null);
  const isDraggingRef = useRef(false);
  const requestedLocationRef = useRef(false);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  const persistCoords = (next) => {
    setCoords(next);
    setCenterCoords(next);
    setStatus('ready');
    saveLocation({
      ...next,
      updatedAt: Date.now(),
    });
  };

  const persistAddress = (address) => {
    saveLocation({ address: String(address || '').trim() });
  };

  useEffect(() => {
    const saved = getSavedLocation();
    if (typeof saved?.lat === 'number' && typeof saved?.lon === 'number') {
      persistCoords({ lat: saved.lat, lon: saved.lon });
    }

    const shouldRefreshCurrentLocation =
      !saved
      || typeof saved?.lat !== 'number'
      || typeof saved?.lon !== 'number'
      || !saved?.updatedAt
      || (Date.now() - saved.updatedAt) > AUTO_REFRESH_INTERVAL_MS;

    if (shouldRefreshCurrentLocation && !requestedLocationRef.current) {
      requestedLocationRef.current = true;
      requestLocation();
    }
  }, []);

  useEffect(() => {
    if (coords && map) {
      map.panTo({ lat: coords.lat, lng: coords.lon });
      map.setZoom(DEFAULT_ZOOM);
    }
  }, [coords, map]);

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setStatus('error');
      return;
    }

    setStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };

        persistCoords(next);
        if (map) {
          map.panTo({ lat: next.lat, lng: next.lon });
          map.setZoom(DEFAULT_ZOOM);
        }

        if (window.google?.maps?.Geocoder) {
          const geocoder = new window.google.maps.Geocoder();
          geocoder.geocode({ location: { lat: next.lat, lng: next.lon } }, (results, geocodeStatus) => {
            if (geocodeStatus === 'OK' && results?.[0]?.formatted_address) {
              try {
                persistAddress(results[0].formatted_address);
              } catch {
                // ignore
              }
            }
          });
        }
      },
      (error) => {
        if (error?.code === 1) {
          setStatus('denied');
          return;
        }
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const helperText = (() => {
    if (status === 'loading') return 'Pinning your current location...';
    if (status === 'denied') return 'Location permission denied. Tap to try again.';
    if (status === 'error') return 'Unable to fetch location. Tap to retry.';
    if (isDragging) return 'Move the map to set the pin.';
    if (status === 'ready') return 'Drag the map to fine-tune. Tap Update to refresh GPS.';
    return 'Pin your current location, then adjust by dragging.';
  })();

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
      className="px-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.26em] text-slate-400">Map</p>
          <h3 className="mt-0.5 flex items-baseline gap-1 text-[16px] font-black tracking-tight text-white">
            <span className="truncate">Pin your location</span>
            <span className="inline-flex" aria-hidden="true">
              {[0, 1, 2].map((dot) => (
                <motion.span
                  key={dot}
                  className="inline-block"
                  animate={{ opacity: [0.25, 1, 0.25] }}
                  transition={{
                    duration: 1.05,
                    delay: dot * 0.18,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                >
                  .
                </motion.span>
              ))}
            </span>
          </h3>
          <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">{helperText}</p>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={requestLocation}
          className="inline-flex items-center gap-2.5 rounded-full border border-white/60 bg-white/95 px-3 py-2 text-[11px] font-black text-slate-800 shadow-[0_8px_16px_-4px_rgba(15,23,42,0.1)] transition-all active:shadow-inner"
        >
          <div className="relative">
            <Navigation 
              size={14} 
              strokeWidth={2.8} 
              className={`transition-colors ${status === 'loading' ? 'animate-pulse text-emerald-600' : 'text-slate-400'}`} 
            />
            {coords && (
              <motion.span
                layoutId="active-dot"
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                animate={{ scale: [1, 1.25, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
          </div>
          <span className="uppercase tracking-wider">{coords ? 'Update' : 'Pin'}</span>
        </motion.button>
      </div>

      <div className="relative mt-3 rounded-[20px] bg-[linear-gradient(135deg,rgba(16,185,129,0.40)_0%,rgba(56,189,248,0.22)_50%,rgba(251,146,60,0.16)_100%)] p-[1px] shadow-[0_0_0_1px_rgba(16,185,129,0.10),0_10px_22px_rgba(15,23,42,0.06)]">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-[20px] blur-xl"
          animate={{ opacity: [0.14, 0.26, 0.14] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            background:
              'linear-gradient(135deg, rgba(16,185,129,0.22) 0%, rgba(56,189,248,0.14) 52%, rgba(251,146,60,0.10) 100%)',
          }}
        />

        <div className="relative z-10 overflow-hidden rounded-[19px] border border-white/70 bg-white/85">
          <div className="relative h-[170px] w-full">
            {!HAS_VALID_GOOGLE_MAPS_KEY && (
              <div className="flex h-full w-full items-center justify-center px-5 text-center">
                <div>
                  <p className="text-[12px] font-black text-white">Google Maps key missing</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">Add `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`.</p>
                </div>
              </div>
            )}

            {HAS_VALID_GOOGLE_MAPS_KEY && loadError && (
              <div className="flex h-full w-full items-center justify-center px-5 text-center">
                <div>
                  <p className="text-[12px] font-black text-white">Map failed to load</p>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">Check your Google Maps browser key restrictions.</p>
                </div>
              </div>
            )}

            {HAS_VALID_GOOGLE_MAPS_KEY && !loadError && !isLoaded && (
              <div className="flex h-full w-full items-center justify-center">
                <div className="flex items-center gap-2 rounded-[16px] bg-white/90 px-4 py-3 shadow-sm">
                  <LoaderCircle size={18} className="animate-spin text-slate-400" />
                  <span className="text-[12px] font-black text-slate-300">Loading map</span>
                </div>
              </div>
            )}

            {HAS_VALID_GOOGLE_MAPS_KEY && !loadError && isLoaded && (
              <GoogleMap
                mapContainerStyle={MAP_CONTAINER_STYLE}
                center={{ lat: centerCoords.lat, lng: centerCoords.lon }}
                zoom={DEFAULT_ZOOM}

                onLoad={(nextMap) => setMap(nextMap)}
                onUnmount={() => setMap(null)}
                onDragStart={() => {
                  isDraggingRef.current = true;
                  setIsDragging(true);
                }}
                onDragEnd={() => {
                  isDraggingRef.current = false;
                  setIsDragging(false);
                  if (!map) {
                    return;
                  }

                  const center = map.getCenter();
                  if (!center) {
                    return;
                  }

                  persistCoords({ lat: center.lat(), lon: center.lng() });
                  if (window.google?.maps?.Geocoder) {
                    const geocoder = new window.google.maps.Geocoder();
                    geocoder.geocode(
                      { location: { lat: center.lat(), lng: center.lng() } },
                      (results, geocodeStatus) => {
                        if (geocodeStatus === 'OK' && results?.[0]?.formatted_address) {
                          persistAddress(results[0].formatted_address);
                        }
                      },
                    );
                  }
                }}
                onIdle={() => {
                  if (!map) {
                    return;
                  }

                  const center = map.getCenter();
                  if (!center) {
                    return;
                  }

                  const next = { lat: center.lat(), lon: center.lng() };

                  if (areCentersNearlyEqual(centerCoords, next)) {
                    return;
                  }

                  setCenterCoords(next);

                  if (!isDraggingRef.current && status === 'ready') {
                    saveLocation(next);
                  }
                }}
                options={{
                  disableDefaultUI: true,
                  zoomControl: true,
                  clickableIcons: false,
                  streetViewControl: false,
                  fullscreenControl: false,
                  mapTypeControl: false,
                  gestureHandling: 'greedy',
                }}
              />
            )}

            {/* The Pinpoint */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2">
              {/* Point Shadow - anchored at the map center */}
              <motion.div
                initial={false}
                animate={{
                  scale: isDragging ? [1, 1.22, 1.15] : 1,
                  opacity: isDragging ? 0.28 : 0.55,
                  y: isDragging ? 7 : 0,
                }}
                className="absolute left-1/2 top-0 h-[3px] w-3.5 -translate-x-1/2 rounded-[100%] bg-slate-900/30 blur-[1.5px]"
              />

              {/* Pin Body */}
              <motion.div
                initial={false}
                animate={{
                  y: isDragging ? -31 : -2,
                  scale: isDragging ? 1.04 : 1,
                }}
                transition={{
                  type: 'spring',
                  stiffness: isDragging ? 450 : 350,
                  damping: 25,
                }}
                className="relative flex flex-col items-center -translate-y-full"
              >
                <div className="relative h-[42px] w-[28px] drop-shadow-[0_10px_18px_rgba(15,23,42,0.2)]">
                  <svg
                    viewBox="0 0 32 48"
                    className="h-full w-full overflow-visible"
                    aria-hidden="true"
                  >
                    <path
                      d="M16 2C9.1 2 4 7.21 4 13.88c0 9.54 8.58 18.76 11.13 28.42.18.69.58 1.7.87 2.7.29-1 .69-2.01.87-2.7C19.42 32.64 28 23.42 28 13.88 28 7.21 22.9 2 16 2Z"
                      fill="white"
                      stroke="#10b981"
                      strokeWidth="2.4"
                      strokeLinejoin="round"
                    />
                    <circle cx="16" cy="14" r="6.5" fill="#10b981" />
                    <circle cx="16" cy="14" r="2.4" fill="white" fillOpacity="0.95" />
                  </svg>
                </div>
              </motion.div>
            </div>

            {!coords && status !== 'loading' && (
              <button
                type="button"
                onClick={requestLocation}
                className="absolute bottom-2 left-2 z-20 rounded-full border border-white/80 bg-white/90 px-3 py-2 text-[11px] font-black text-slate-300 shadow-sm active:scale-[0.99]"
              >
                Use my location
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
};

export default LocationMapSection;
