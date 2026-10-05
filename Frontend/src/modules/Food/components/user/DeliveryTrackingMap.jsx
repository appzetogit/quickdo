import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  GoogleMap, 
  useJsApiLoader, 
  Marker, 
  OverlayView, 
  DirectionsService, 
  DirectionsRenderer,
  Polyline
} from '@react-google-maps/api';
import io from 'socket.io-client';
import { API_BASE_URL } from '@food/api/config';
import bikeLogo from '@food/assets/bikelogo.png';
import k9Logo from '@food/assets/k9-logo.jpg';
import { subscribeOrderTracking } from '@food/realtimeTracking';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Navigation, Info, Circle } from 'lucide-react';
import { env } from "@/config/runtimeEnv";

const LIBRARIES = ['geometry', 'places'];

const RIDER_BIKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="28" fill="white" stroke="#ff8100" stroke-width="4" />
  <g transform="translate(15, 15) scale(1.2)">
    <path d="M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65l-2.13 1.52c-.31.22-.5.57-.5.95V13h-4.4a2 2 0 00-1.92 1.45L6 20H2v2h4.5c1.07 0 1.97-.85 1.97-1.97V20l.4-1.2h3.13l.4 1.2c.4 1.2 1.5 2 2.77 2h.3c1.07 0 1.97-.85 1.97-1.97V20l-.4-1.2H14.1l-.33-1H18v-2h-2.17l-.67-2H18c1.1 0 2-.9 2-2V7h-1zM7 18h-.5C5.67 18 5 17.33 5 16.5S5.67 15 6.5 15H7v3zm8.5 0h-.5V15h.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" fill="#ff8100" />
  </g>
</svg>`;

const RESTAURANT_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const CUSTOMER_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const debugLog = (...args) => console.log('[DeliveryTrackingMap]', ...args);

const DeliveryTrackingMap = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  order = null,
  onEtaUpdate = null
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  const [directions, setDirections] = useState(null);
  const [baselineDirections, setBaselineDirections] = useState(null);
  const [lastDirectionsAt, setLastDirectionsAt] = useState(0);
  const [currentEta, setCurrentEta] = useState(null);
  const [cloudPolyline, setCloudPolyline] = useState(null);
  const [smoothLocation, setSmoothLocation] = useState(null);
  const [lineOffset, setLineOffset] = useState(0);
  const socketRef = useRef(null);
  const interpStateRef = useRef({ lastPos: null, nextPos: null, startTime: 0 });

  // Animated polyline flow offset
  useEffect(() => {
    let count = 0;
    const interval = setInterval(() => {
      count = (count + 1) % 100;
      setLineOffset(count);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: env('VITE_GOOGLE_MAPS_API_KEY'),
    libraries: LIBRARIES,
  });

  const trackingIds = useMemo(() => {
    const ids = [orderId, ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : [])]
      .map(id => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [orderId, orderTrackingIds]);

  const backendUrl = useMemo(() => {
    return (API_BASE_URL || '').replace(/\/api\/v1\/?$/i, '').replace(/\/api\/?$/i, '');
  }, []);

  // 1. Initial State from Order Payload
  useEffect(() => {
    const loc = order?.deliveryState?.currentLocation;
    if (loc && !riderLocation) {
      const lat = typeof loc.lat === 'number' ? loc.lat : (Array.isArray(loc.coordinates) ? Number(loc.coordinates[1]) : null);
      const lng = typeof loc.lng === 'number' ? loc.lng : (Array.isArray(loc.coordinates) ? Number(loc.coordinates[0]) : null);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setRiderLocation({ lat, lng, heading: loc.bearing || loc.heading || 0 });
      }
    }
  }, [order, riderLocation]);

  // 2. Core Data Sync (Socket + Firebase)
  useEffect(() => {
    if (!trackingIds.length) return;

    // A. FIREBASE FALLBACK
    const unsubs = trackingIds.map(id => subscribeOrderTracking(id, (data) => {
      const lat = Number(data?.lat ?? data?.boy_lat);
      const lng = Number(data?.lng ?? data?.boy_lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setRiderLocation(prev => ({
          lat,
          lng,
          heading: Number(data?.heading ?? data?.bearing ?? prev?.heading ?? 0)
        }));
      }

      // Sync Cloud Polyline and ETA to eliminate Directions API usage on user side
      if (data?.polyline) {
        debugLog('?? Received Cloud Polyline for live path');
        setCloudPolyline(data.polyline);
      }
      if (data?.eta) {
        debugLog('?? Received real-time ETA:', data.eta);
        setCurrentEta(data.eta);
        if (onEtaUpdate) onEtaUpdate(data.eta);
      }
    }));

    // B. SOCKET.IO REALTIME
    const token = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken') || '';
    socketRef.current = io(backendUrl, {
      transports: ['websocket'],
      auth: { token }
    });

    socketRef.current.on('connect', () => {
      trackingIds.forEach(id => socketRef.current.emit('join-tracking', id));
    });

    socketRef.current.on('location-update', (data) => {
      // Ensure data belongs to one of our tracked orders
      const matchedId = trackingIds.find(id => String(id) === String(data.orderId));
      if (data && matchedId && typeof data.lat === 'number') {
        const nextPos = {
          lat: data.lat,
          lng: data.lng,
          heading: data.heading || data.bearing || 0
        };
        
        // Trigger Smooth Interpolation
        interpStateRef.current = {
           lastPos: smoothLocation || riderLocation || nextPos,
           nextPos: nextPos,
           startTime: Date.now()
        };
        
        setRiderLocation(nextPos);
      }
    });

    return () => {
      unsubs.forEach(u => u?.());
      socketRef.current?.disconnect();
    };
  }, [trackingIds, backendUrl, smoothLocation, riderLocation]);

  // 3. Smooth Animation Loop (60 FPS Glide)
  useEffect(() => {
    let frame;
    const update = () => {
      const { lastPos, nextPos, startTime } = interpStateRef.current;
      if (lastPos && nextPos) {
        const duration = 5000; // Expected update interval (match rider app throttle)
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Linear Interpolation (LERP)
        const lat = lastPos.lat + (nextPos.lat - lastPos.lat) * progress;
        const lng = lastPos.lng + (nextPos.lng - lastPos.lng) * progress;
        
        // Heading interpolation (shortest path)
        let lastHead = lastPos.heading || 0;
        let nextHead = nextPos.heading || 0;
        if (Math.abs(nextHead - lastHead) > 180) {
          if (nextHead > lastHead) lastHead += 360;
          else nextHead += 360;
        }
        const heading = lastHead + (nextHead - lastHead) * progress;

        setSmoothLocation({ lat, lng, heading: heading % 360 });
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Use smooth location for sync if available
  const displayRiderLocation = smoothLocation || riderLocation;

  const tripStatus = order?.status || order?.orderStatus || 'pending';
  const isOrderPickedUp = ['picked_up', 'out_for_delivery', 'delivered'].includes(tripStatus.toLowerCase());

  // 2. Pro Camera: Intelligent Frame Management (Throttled)
  const lastCameraUpdateRef = useRef({ time: 0, status: null });
  
  useEffect(() => {
    if (!map || !restaurantCoords || !customerCoords || !isLoaded) return;
    
    const now = Date.now();
    const statusChanged = lastCameraUpdateRef.current.status !== isOrderPickedUp;
    const timeSinceLastUpdate = now - lastCameraUpdateRef.current.time;

    // Only fitBounds if status changed OR every 15 seconds to avoid flickering
    if (!statusChanged && timeSinceLastUpdate < 15000) return;

    lastCameraUpdateRef.current = { time: now, status: isOrderPickedUp };

    const bounds = new window.google.maps.LatLngBounds();
    
    if (isOrderPickedUp) {
      if (riderLocation) bounds.extend(riderLocation);
      bounds.extend(customerCoords);
    } else {
      if (riderLocation) bounds.extend(riderLocation);
      bounds.extend(restaurantCoords);
    }

    map.fitBounds(bounds, { 
      top: 100, 
      bottom: 120, 
      left: 60, 
      right: 60 
    });
    
    debugLog(`[Camera] Focusing on ${isOrderPickedUp ? 'Delivery' : 'Pickup'} leg`);
  }, [map, riderLocation, restaurantCoords, customerCoords, isOrderPickedUp, isLoaded]);

  // 3. Helper to format absolute or relative image URLs
  const getImageUrl = useCallback((img) => {
    if (!img) return null;
    if (typeof img === 'string') {
      if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('data:')) {
        return img;
      }
      return `${backendUrl}${img.startsWith('/') ? '' : '/'}${img}`;
    }
    if (img.url) {
      if (img.url.startsWith('http://') || img.url.startsWith('https://') || img.url.startsWith('data:')) {
        return img.url;
      }
      return `${backendUrl}${img.url.startsWith('/') ? '' : '/'}${img.url}`;
    }
    return null;
  }, [backendUrl]);

  // Directions Management using JS Service to avoid infinite loops and re-render hammering
  useEffect(() => {
    if (!isLoaded || !riderLocation || cloudPolyline) return;
    const dest = isOrderPickedUp ? customerCoords : restaurantCoords;
    if (!dest) return;

    const now = Date.now();
    if (now - lastDirectionsAt < 15000 && directions) return;

    try {
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin: riderLocation,
          destination: dest,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === 'OK' && result) {
            setDirections(result);
            setLastDirectionsAt(Date.now());
            const durationText = result?.routes?.[0]?.legs?.[0]?.duration?.text;
            if (durationText) {
              setCurrentEta(durationText);
              if (onEtaUpdate) onEtaUpdate(durationText);
            }
          }
        }
      );
    } catch (err) {
      console.error('[DeliveryTrackingMap] Directions query failed:', err);
    }
  }, [isLoaded, riderLocation?.lat, riderLocation?.lng, isOrderPickedUp, restaurantCoords, customerCoords, cloudPolyline, lastDirectionsAt, directions, onEtaUpdate]);

  const activeRoutePath = useMemo(() => {
    if (cloudPolyline && window.google?.maps?.geometry?.encoding) {
      try {
        return window.google.maps.geometry.encoding.decodePath(
          typeof cloudPolyline === 'string' ? cloudPolyline : (cloudPolyline.points || '')
        );
      } catch (e) {
        console.error('[DeliveryTrackingMap] Failed to decode cloud polyline:', e);
      }
    }
    if (directions?.routes?.[0]?.overview_path) {
      return directions.routes[0].overview_path;
    }
    return null;
  }, [cloudPolyline, directions]);

  const resolvedRestaurantLogo = useMemo(() => {
    const rawLogo = order?.restaurantLogo || order?.restaurantImage || order?.restaurantId?.logo || order?.restaurantId?.profileImage || order?.restaurant?.logo || order?.restaurant?.profileImage;
    return getImageUrl(rawLogo) || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`;
  }, [order, getImageUrl]);

  const resolvedCustomerImage = useMemo(() => {
    const rawImg = order?.customerImage || order?.userId?.profileImage || order?.userId?.avatar || order?.user?.profileImage || order?.user?.avatar;
    return getImageUrl(rawImg) || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`;
  }, [order, getImageUrl]);

  const center = useMemo(() => {
    // Highly stable center: use restaurant or customer as anchor, not the moving rider
    if (isOrderPickedUp) return customerCoords || { lat: 0, lng: 0 };
    return restaurantCoords || { lat: 0, lng: 0 };
  }, [isOrderPickedUp, restaurantCoords, customerCoords]);

  const zoom = useMemo(() => 15, []);

  // 4. Baseline Directions Management
  useEffect(() => {
    if (!isLoaded || !restaurantCoords || !customerCoords || baselineDirections) return;
    
    // Prevent multiple concurrent fetches
    if (baselineDirections === 'FETCHING') return;
    
    setBaselineDirections('FETCHING');

    try {
      const ds = new window.google.maps.DirectionsService();
      ds.route(
        {
          origin: restaurantCoords,
          destination: customerCoords,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === 'OK' && result) {
            setBaselineDirections(result);
          } else {
            console.error('[DeliveryTrackingMap] Baseline Directions failed:', status);
            setBaselineDirections({ failed: true });
          }
        }
      );
    } catch (err) {
      console.error('[DeliveryTrackingMap] Baseline directions query failed:', err);
      setBaselineDirections({ failed: true });
    }
  }, [isLoaded, restaurantCoords, customerCoords, baselineDirections]);

  const baselineDirectionsServiceOptions = useMemo(() => {
    if (!restaurantCoords || !customerCoords) return null;
    return {
      origin: restaurantCoords,
      destination: customerCoords,
      travelMode: 'DRIVING'
    };
  }, [restaurantCoords?.lat, restaurantCoords?.lng, customerCoords?.lat, customerCoords?.lng]);

  const mapReady = isLoaded || !!window?.google?.maps;

  if (!mapReady) return <div className="w-full h-full bg-gray-100 animate-pulse" />;

  return (
    <div className="relative w-full h-full overflow-hidden rounded-2xl shadow-inner border border-gray-100">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={zoom}
        onLoad={setMap}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          scaleControl: true,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] }
          ]
        }}
      >
        {/* 1. PERSISTENT BASELINE (Full journey: Restaurant -> Customer) */}
        {baselineDirections && !baselineDirections.failed && baselineDirections !== 'FETCHING' && (
          <Polyline
            path={baselineDirections.routes[0].overview_path}
            options={{
              strokeColor: '#94a3b8', 
              strokeOpacity: 0, // Dotted
              strokeWeight: 4,
              zIndex: 5,
              icons: [{
                icon: { 
                  path: 'M 0,-1 0,1', 
                  strokeOpacity: 0.5, 
                  scale: 3, 
                  strokeWeight: 4,
                  strokeColor: '#64748b'
                },
                offset: '0',
                repeat: '15px'
              }]
            }}
          />
        )}

        {/* 2. LIVE RIDER LEG (Rider -> Target destination) */}
        {/* Old single Polyline commented out:
        {activeRoutePath && (
          <Polyline
            path={activeRoutePath}
            options={{
              strokeColor: isOrderPickedUp ? '#3b82f6' : '#FF6B35', // Premium colors: high contrast blue/orange
              strokeWeight: 6,
              strokeOpacity: 0.9,
              zIndex: 10
            }}
          />
        )}
        */}
        {/* Glowing backdrop polyline */}
        {activeRoutePath && (
          <Polyline
            path={activeRoutePath}
            options={{
              strokeColor: isOrderPickedUp ? '#3b82f6' : '#FF6B35',
              strokeWeight: 10,
              strokeOpacity: 0.25,
              zIndex: 9
            }}
          />
        )}
        {/* Main active polyline with flowing chevrons */}
        {activeRoutePath && (
          <Polyline
            path={activeRoutePath}
            options={{
              strokeColor: isOrderPickedUp ? '#2563eb' : '#ff8100',
              strokeWeight: 6,
              strokeOpacity: 1,
              zIndex: 10,
              icons: [{
                icon: {
                  path: window.google?.maps?.SymbolPath?.FORWARD_CLOSED_ARROW,
                  scale: 2.5,
                  strokeColor: '#ffffff',
                  fillColor: '#ffffff',
                  fillOpacity: 1,
                  strokeWeight: 1,
                },
                offset: `${lineOffset}%`,
                repeat: '60px'
              }]
            }}
          />
        )}

        {/* RESTAURANT PIN (OVERLAY VIEW FOR CUSTOM STYLE) */}
        <OverlayView
          position={restaurantCoords}
          mapPaneName={OverlayView.MARKER_LAYER}
        >
          <div className="relative -translate-x-1/2 -translate-y-full mb-1 group">
             {/* Pulsing ring if this is the active destination */}
             {!isOrderPickedUp && (
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                 <motion.div 
                   animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                   transition={{ duration: 2, repeat: Infinity }}
                   className="w-16 h-16 rounded-full border-4 border-primary-orange/50"
                 />
               </div>
             )}
             <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-primary-orange/50 overflow-hidden group-hover:scale-110 transition-transform">
                <img 
                  src={resolvedRestaurantLogo}
                  alt="Restaurant"
                  className="w-full h-full object-contain rounded-full bg-gray-50"
                  onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`; }}
                />
             </div>
             {/* Pin Tip */}
             <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-primary-orange/50 clip-triangle rotate-180 -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
          </div>
        </OverlayView>

        {/* CUSTOMER PIN (OVERLAY VIEW FOR CUSTOM STYLE) */}
        <OverlayView
          position={customerCoords}
          mapPaneName={OverlayView.MARKER_LAYER}
        >
          <div className="relative -translate-x-1/2 -translate-y-full mb-1 group">
             {/* Pulsing ring if this is the active destination */}
             {isOrderPickedUp && (
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                 <motion.div 
                   animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                   transition={{ duration: 2, repeat: Infinity }}
                   className="w-16 h-16 rounded-full border-4 border-green-500/50"
                 />
               </div>
             )}
             <div className="relative w-11 h-11 rounded-full p-1 bg-white shadow-xl border-2 border-green-500 overflow-hidden group-hover:scale-110 transition-transform">
                <img 
                  src={resolvedCustomerImage}
                  alt="Me"
                  className="w-full h-full object-contain rounded-full bg-gray-50"
                  onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`; }}
                />
             </div>
             {/* Pin Tip */}
             <div className="absolute top-[100%] left-1/2 -translate-x-1/2 w-3 h-3 bg-green-500 clip-triangle rotate-180 -mt-1 shadow-sm" style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }} />
          </div>
        </OverlayView>

        {/* PRO RIDER (OVERLAY VIEW FOR SMOOTH ROTATION / GLIDE) */}
        {displayRiderLocation && (
          <OverlayView
            position={displayRiderLocation}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            {/* Old rider marker code commented out:
            <div 
              style={{
                transform: `translate(-50%, -50%) rotate(${displayRiderLocation.heading || 0}deg)`,
                transition: 'all 0.1s linear', // Micro-damping for heading
              }}
              className="relative w-16 h-16"
            >
              <img 
                src="/MapRider.png" 
                alt="Rider" 
                className="w-full h-full object-contain drop-shadow-2xl"
                onError={(e) => {
                  e.target.src = bikeLogo;
                }}
              />
            </div>
            */}
            
            {/* Zomato-style brand themed rider marker with K9 logo and animated pulsing aura */}
            <div className="relative -translate-x-1/2 -translate-y-1/2 group">
              {/* Pulsing glow aura around rider */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <motion.div 
                  animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0.2, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-14 h-14 rounded-full bg-amber-500/30 border border-amber-500/50"
                />
              </div>
              
              {/* Main Circular Ring containing K9 brand logo */}
              <div className="relative w-11 h-11 rounded-full bg-white shadow-xl border-[3px] border-amber-500 flex items-center justify-center overflow-hidden">
                <img 
                  src={k9Logo}
                  alt="Quick Drop"
                  className="w-full h-full object-cover"
                />
              </div>
              
              {/* Bike / Delivery Badge */}
              <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-amber-600 border-2 border-white shadow-md flex items-center justify-center">
                <img 
                  src={bikeLogo} 
                  alt="Bike" 
                  className="w-4 h-4 object-contain invert brightness-0" 
                />
              </div>
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      {/* 4. LIVE ARRIVAL BADGE (Pro Orange) */}
      <AnimatePresence>
        {riderLocation && currentEta && (
          <motion.div 
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="absolute top-4 left-4 z-[150] pointer-events-none"
          >
            <div className="bg-primary-orange/50/95 backdrop-blur-xl rounded-2xl p-3 shadow-[0_10px_30px_rgba(249,115,22,0.4)] border border-primary-orange/80/50 flex flex-col min-w-[90px] group overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent pointer-events-none" />
              <div className="flex flex-col z-10">
                <span className="text-[9px] text-white/80 font-black uppercase tracking-[0.2em] mb-0.5">Arrival</span>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-white leading-none tracking-tighter">
                    {currentEta}
                  </span>
                  <div className="flex items-center gap-1.5 opacity-80">
                     <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                     <Navigation className="w-3 h-3 text-white rotate-45" />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DeliveryTrackingMap;
