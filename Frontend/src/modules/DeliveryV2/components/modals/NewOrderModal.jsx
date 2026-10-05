import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, MapPin, FastForward, Clock, Phone, ChefHat, ChevronDown } from 'lucide-react';
import { ActionSlider } from '@/modules/DeliveryV2/components/ui/ActionSlider';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { getHaversineDistance, calculateETA } from '@/modules/DeliveryV2/utils/geo';

/**
 * NewOrderModal - Ported to Original 1:1 Theme with Slider Accept.
 * Matches the K9 Rides Partner style Green Header + White Card.
 */
export const NewOrderModal = ({ order, onAccept, onReject, onMinimize }) => {
  const { riderLocation } = useDeliveryStore();
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (timeLeft <= 0) {
      onReject();
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, onReject]);

  const { distanceKm, etaMins } = useMemo(() => {
    if (!order) return { distanceKm: null, etaMins: null };

    // A. Use provided data if available (Direct distance from socket)
    const rawDist = order.pickupDistanceKm || order.distanceKm;
    const rawEta = order.estimatedTime || order.duration || order.eta;
    
    if (rawDist != null) {
      return { 
        distanceKm: Number(rawDist).toFixed(1), 
        etaMins: rawEta && rawEta > 0 ? Math.ceil(rawEta) : Math.ceil((rawDist * 1000) / 416) + 5
      };
    }

    // B. Calculate from locations (Local calculation fallback)
    const rest = order.restaurantLocation || order.restaurantId?.location || {};
    const resLat = parseFloat(order.restaurant_lat || order.restaurantLat || rest.latitude || rest.lat);
    const resLng = parseFloat(order.restaurant_lng || order.restaurantLng || rest.longitude || rest.lng);

    if (riderLocation && !isNaN(resLat) && !isNaN(resLng)) {
      const distM = getHaversineDistance(
        riderLocation.lat, riderLocation.lng,
        resLat, resLng
      );
      const km = distM / 1000;
      // Assume 25km/h avg for initial estimate (roughly 416m/min)
      const mins = Math.ceil(distM / 416) + (order.prepTime || 5);
      
      return { 
        distanceKm: km.toFixed(1), 
        etaMins: mins 
      };
    }

    return { distanceKm: '??', etaMins: order.prepTime || 15 };
  }, [order, riderLocation]);

  if (!order) return null;

  const earnings = order.earnings || order.riderEarning || (order.orderAmount ? order.orderAmount * 0.1 : 0);
  const restaurantName = order.restaurantName || order.restaurant_name || (order.restaurantId?.name) || 'Restaurant';
  const restaurantAddress = order.restaurantAddress || order.restaurant_address || (order.restaurantId?.location?.address) || 'Address not available';
  const restaurantPhone =
    order.restaurantPhone ||
    order.restaurant_phone ||
    order.restaurantId?.phone ||
    order.restaurantId?.ownerPhone ||
    '';
  const deliveryAddress = order?.deliveryAddress || {};
  
  const customerName =
    order.customerName ||
    order.deliveryAddress?.fullName ||
    order.deliveryAddress?.name ||
    order.userId?.name ||
    order.userName ||
    '';

  const customerPhone =
    order.customerPhone ||
    order.userPhone ||
    order.deliveryAddress?.phone ||
    order.userId?.phone ||
    order.user?.phone ||
    '';

  const telLink = useMemo(() => {
    if (!customerPhone) return '';
    const clean = String(customerPhone).replace(/\D/g, '');
    if (clean.length === 10) return `tel:+91${clean}`;
    return customerPhone.startsWith('+') ? `tel:${customerPhone}` : `tel:+${clean}`;
  }, [customerPhone]);

  const geoCoords =
    Array.isArray(deliveryAddress?.location?.coordinates) &&
    deliveryAddress.location.coordinates.length >= 2
      ? {
          lng: deliveryAddress.location.coordinates[0],
          lat: deliveryAddress.location.coordinates[1],
        }
      : null;

  const customerLocation = order.customerLocation || order.deliveryLocation || geoCoords || null;

  const addressPartsFromSchema = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const customerAddress =
    order.customerAddress ||
    order.customer_address ||
    (addressPartsFromSchema.length ? addressPartsFromSchema.join(', ') : '') ||
    (customerLocation?.lat != null && customerLocation?.lng != null
      ? `Lat ${Number(customerLocation.lat).toFixed(5)}, Lng ${Number(customerLocation.lng).toFixed(5)}`
      : 'Location not available');

  const mapsLink =
    customerLocation?.lat != null && customerLocation?.lng != null
      ? `https://www.google.com/maps?q=${encodeURIComponent(
          `${customerLocation.lat},${customerLocation.lng}`,
        )}`
      : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-end justify-center"
    >
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="w-full max-w-lg bg-white rounded-t-[3.5rem] shadow-[0_-25px_80px_rgba(0,0,0,0.5)] flex flex-col max-h-[85vh] relative overflow-hidden"
      >
        {/* Handle / Minimize */}
        <div className="w-full flex justify-center py-3 bg-white relative z-20">
          <button 
            onClick={onMinimize} 
            className="w-12 h-1.5 bg-gray-200 rounded-full hover:bg-gray-300 transition-colors active:scale-95"
            aria-label="Minimize"
          />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* Header Ribbon (Compact Premium) */}
          <div className="bg-linear-to-br from-emerald-500 via-green-500 to-emerald-600 px-6 py-5 flex justify-between items-center text-white">
            <div>
              <p className="text-white/80 text-[10px] font-black uppercase tracking-[0.2em] mb-1">New Order Request</p>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold opacity-80">₹</span>
                <h2 className="text-4xl font-black tracking-tighter">{Number(earnings || 0).toFixed(2)}</h2>
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-2 text-white flex flex-col items-center min-w-[80px]">
              <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Expires</span>
              <span className="font-black text-2xl tabular-nums leading-none">{timeLeft}s</span>
            </div>
          </div>

          <div className="px-6 py-4 space-y-5">
            {/* Direct Summary Metrics (Horizontal Compact Row) */}
            <div className="flex gap-2">
               <div className="flex-1 p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-3">
                 <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-emerald-500">
                    <Clock className="w-5 h-5" />
                 </div>
                 <div className="flex flex-col">
                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">EST. Time</span>
                    <span className="text-sm font-black text-gray-900 tracking-tight leading-none">{etaMins} MINS</span>
                 </div>
               </div>
               <div className="flex-1 p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-3">
                 <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-blue-500">
                    <MapPin className="w-5 h-5" />
                 </div>
                 <div className="flex flex-col">
                    <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Distance</span>
                    <span className="text-sm font-black text-gray-900 tracking-tight leading-none">{distanceKm} KM</span>
                 </div>
               </div>
            </div>

            {/* Delivery Locations (Tighter Timeline) */}
            <div className="bg-gray-50/50 rounded-3xl p-5 border border-gray-100/50">
              <div className="flex gap-4 relative">
                <div className="flex flex-col items-center py-1">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/20" />
                  <div className="flex-1 w-0.5 border-l-2 border-dashed border-gray-200 my-1" />
                  <div className="w-3 h-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/20" />
                </div>
                
                <div className="flex-1 space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-emerald-600 mb-0.5">Restaurant Pickup</h4>
                      {restaurantPhone && (
                        <button
                          onClick={() => (window.location.href = `tel:${restaurantPhone}`)}
                          className="shrink-0 w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 hover:bg-emerald-100 transition-colors active:scale-90"
                          aria-label="Call restaurant"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <h3 className="text-gray-950 font-black text-lg leading-tight mb-0.5 line-clamp-1">{restaurantName}</h3>
                    <p className="text-gray-500 text-[11px] font-bold line-clamp-1">{restaurantAddress}</p>
                  </div>

                  <div className="pt-1">
                    <div className="flex items-center justify-between">
                       <h4 className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-600 mb-0.5">Customer Drop</h4>
                       <div className="flex items-center gap-2">
                         {mapsLink && (
                           <a href={mapsLink} target="_blank" rel="noreferrer" className="text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors">
                             Open Map
                           </a>
                         )}
                         {customerPhone && (
                           <button
                             onClick={() => {
                               if (telLink) {
                                 window.location.href = telLink;
                               }
                             }}
                             className="shrink-0 w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 hover:bg-blue-100 transition-colors active:scale-90"
                             aria-label="Call customer"
                           >
                             <Phone className="w-4 h-4" />
                           </button>
                         )}
                       </div>
                    </div>
                    <h3 className="text-gray-950 font-black text-lg leading-tight mb-0.5">Delivery Location</h3>
                    <p className="text-gray-500 text-[11px] font-bold line-clamp-1">{customerAddress}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Area (Fixed / Non-Scrolling Footer) */}
        <div className="px-6 pb-8 pt-2 space-y-4 bg-white">
          <ActionSlider 
            label="Slide to Accept" 
            onConfirm={() => onAccept(order)} 
            color="bg-emerald-600"
            successLabel="Order Accepted ✓"
          />

          <button 
            onClick={onReject}
            className="w-full text-gray-400 font-black text-[11px] uppercase tracking-[0.2em] hover:text-red-500 transition-colors active:scale-95 py-2"
          >
            Pass this task
          </button>
        </div>
      </motion.div>
    </motion.div>

  );
};
