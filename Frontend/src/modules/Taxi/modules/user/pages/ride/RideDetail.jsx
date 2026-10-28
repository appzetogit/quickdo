import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Bike, HelpCircle, Repeat, Share2, Star, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../../../shared/api/axiosInstance';
import { useSettings } from '../../../../shared/context/SettingsContext';
import { generateInvoicePDF } from '../../utils/generateInvoicePDF';
import { GOOGLE_MAPS_API_KEY, useAppGoogleMapsLoader } from '../../../admin/utils/googleMaps';
import { GoogleMap, MarkerF, PolylineF } from '@react-google-maps/api';
import { InvoiceTemplate } from '../../components/InvoiceTemplate';

const unwrap = (response) => response?.data || response;

const formatLongDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Trip details';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const pickFirstString = (...values) => {
  for (const value of values) {
    const normalized = String(value || '').trim();

    if (normalized) {
      return normalized;
    }
  }

  return '';
};

const coordLabel = (location, fallback) => {
  const [lng, lat] = location?.coordinates || [];
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }

  return fallback;
};

const RideDetail = () => {
  const { settings, activeLogo } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const appLogo = activeLogo || settings.general?.logo || settings.customization?.logo || '';
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [shareToast, setShareToast] = useState(false);
  const [ride, setRide] = useState(location.state?.ride || null);
  const [loading, setLoading] = useState(!location.state?.ride);
  const [error, setError] = useState('');
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';
  const invoiceRef = useRef(null);
  const { isLoaded } = useAppGoogleMapsLoader();

  useEffect(() => {
    if (ride || !id) return undefined;

    let active = true;

    const loadRide = async () => {
      try {
        const response = await api.get(`/rides/${id}`);
        const payload = unwrap(response);
        if (active) setRide(payload);
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Could not load trip details.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRide();

    return () => {
      active = false;
    };
  }, [id, ride]);

  const details = useMemo(() => {
    const driver = ride?.driver || ride?.driverId || {};
    const timeSource = ride?.completedAt || ride?.startedAt || ride?.acceptedAt || ride?.createdAt || ride?.updatedAt;
    const status = String(ride?.status || ride?.liveStatus || 'trip').toLowerCase();
    const rideCode = String(ride?.rideId || ride?._id || ride?.id || id || 'ride');
    
    const baseFare = Number(
      ride?.baseFare ??
      (ride?.fare ? (ride.fare - (ride.waitingChargeAmount || 0) - (ride.timeChargeAmount || 0) - (ride.distanceChargeAmount || 0) - (ride.additionalCharge || 0) - (ride.adminExtraCharge?.amount || 0)) : null) ??
      0
    );

    const waitingChargeAmount = Number(ride?.waitingChargeAmount || 0);
    const distanceChargeAmount = Number(ride?.distanceChargeAmount || 0);
    const timeChargeAmount = Number(ride?.timeChargeAmount || 0);
    const additionalCharge = Number(ride?.additionalCharge || 0);
    const adminExtraChargeAmount = Number(ride?.adminExtraCharge?.amount || 0);
    const promoDiscountAmount = Number(ride?.promo?.discount_amount || 0);
    
    // Total should match the fare the user actually paid
    const totalPaid = Math.ceil(baseFare + waitingChargeAmount + distanceChargeAmount + timeChargeAmount + additionalCharge + adminExtraChargeAmount - promoDiscountAmount);

    return {
      pickup: pickFirstString(
        ride?.pickupAddress,
        ride?.pickup?.address,
        ride?.pickup?.name,
      ) || coordLabel(ride?.pickupLocation || ride?.pickup, 'Pickup location'),
      drop: pickFirstString(
        ride?.dropAddress,
        ride?.drop?.address,
        ride?.drop?.name,
        ride?.destinationAddress,
      ) || coordLabel(ride?.dropLocation || ride?.drop, 'Drop location'),
      fare: totalPaid,
      baseFare,
      waitingChargeAmount,
      distanceChargeAmount,
      timeChargeAmount,
      additionalCharge,
      adminExtraChargeAmount,
      promoDiscountAmount,
      promoCode: ride?.promo?.code || '',
      timeSource,
      startTime: ride?.startedAt || ride?.acceptedAt || timeSource,
      endTime: ride?.completedAt || timeSource,
      statusLabel: status.charAt(0).toUpperCase() + status.slice(1),
      driverName: driver.name || 'Captain',
      rating: driver.rating || '4.9',
      plate: driver.vehicleNumber || 'Assigned',
      vehicle: driver.vehicleType || ride?.vehicleIconType || 'Taxi',
      paymentMethod: String(
        ride?.paymentMethod ||
        ride?.payment_method ||
        ride?.paymentType ||
        ride?.payment_type ||
        'cash',
      ).trim().toLowerCase() === 'cash' ? 'Cash' : 'Online',
      rideCode,
      shortRideCode: rideCode.length > 14 ? `${rideCode.slice(0, 6)}...${rideCode.slice(-4)}` : rideCode,
      distance: ride?.distance ? `${Number(ride.distance).toFixed(2)} kms` : '--',
      duration: ride?.duration ? `${Number(ride.duration).toFixed(0)} mins` : '--',
    };
  }, [ride]);

  const [imageError, setImageError] = useState(false);

  const mapImageUrl = useMemo(() => {
    const pCoords = ride?.pickupLocation?.coordinates || ride?.pickup?.coordinates || [];
    const dCoords = ride?.dropLocation?.coordinates || ride?.drop?.coordinates || [];
    if (pCoords.length === 2 && dCoords.length === 2 && GOOGLE_MAPS_API_KEY && !imageError) {
      const [pLng, pLat] = pCoords;
      const [dLng, dLat] = dCoords;
      return `https://maps.googleapis.com/maps/api/staticmap?size=600x300&markers=color:green|label:P|${pLat},${pLng}&markers=color:red|label:D|${dLat},${dLng}&path=color:0x0000ff80|weight:4|${pLat},${pLng}|${dLat},${dLng}&key=${GOOGLE_MAPS_API_KEY}`;
    }
    return '/MapRider.png';
  }, [ride, imageError]);

  const [pdfMapImageUrl, setPdfMapImageUrl] = useState('/MapRider.png');

  useEffect(() => {
    let isMounted = true;
    const pCoords = ride?.pickupLocation?.coordinates || ride?.pickup?.coordinates || [];
    const dCoords = ride?.dropLocation?.coordinates || ride?.drop?.coordinates || [];
    
    if (pCoords.length === 2 && dCoords.length === 2 && GOOGLE_MAPS_API_KEY) {
      const [pLng, pLat] = pCoords;
      const [dLng, dLat] = dCoords;
      const url = `https://maps.googleapis.com/maps/api/staticmap?size=600x300&markers=color:green|label:P|${pLat},${pLng}&markers=color:red|label:D|${dLat},${dLng}&path=color:0x0000ff80|weight:4|${pLat},${pLng}|${dLat},${dLng}&key=${GOOGLE_MAPS_API_KEY}`;
      
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (isMounted) setPdfMapImageUrl(url);
      };
      img.src = url;
    }
    return () => { isMounted = false; };
  }, [ride]);

  const handleDownloadInvoice = async () => {
    const toastId = toast.loading('Generating invoice...');
    try {
      if (!invoiceRef || !invoiceRef.current) {
        throw new Error('Invoice template is not mounted');
      }

      try {
        const interactiveMap = document.getElementById('interactive-map');
        if (interactiveMap) {
          const html2canvas = (await import('html2canvas')).default;
          const mapCanvas = await html2canvas(interactiveMap, { 
            useCORS: true, 
            logging: false,
            allowTaint: true,
            backgroundColor: '#f9fafb',
            ignoreElements: (element) => {
              if (typeof element.className === 'string' && (element.className.includes('gmnoprint') || element.className.includes('gm-style-cc') || element.tagName.toLowerCase() === 'svg')) {
                return true;
              }
              const computedStyle = window.getComputedStyle(element);
              if (computedStyle.color.includes('oklch') || computedStyle.backgroundColor.includes('oklch') || computedStyle.borderColor.includes('oklch')) {
                return true;
              }
              return false;
            }
          });
          const mapDataUrl = mapCanvas.toDataURL('image/jpeg', 0.9);
          const templateImg = invoiceRef.current.querySelector('img[alt="Map View"]');
          if (templateImg) {
            templateImg.src = mapDataUrl;
            // Remove crossOrigin since it's a data URL now, preventing cloneNode recursion crash
            templateImg.removeAttribute('crossOrigin');
          }
        }
      } catch (e) {
        console.warn('Failed to capture interactive map, falling back to static/placeholder map', e);
      }

      await generateInvoicePDF({ details, ride, appName, invoiceRef });
      toast.success('Invoice downloaded successfully', { id: toastId });
    } catch (err) {
      console.error('Invoice generation error:', err);
      toast.error('Failed to generate invoice', { id: toastId });
    }
  };

  const handleShare = async () => {
    const text = `My ${appName} trip #${details.shortRideCode} - ${details.pickup} to ${details.drop} | Rs ${details.fare}.00`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${appName} Trip`,
          text,
          url: window.location.href,
        });
        return;
      } catch (_error) {
        return;
      }
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard?.writeText(text).then(() => {
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2500);
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] max-w-lg mx-auto flex flex-col font-sans relative">
      <AnimatePresence>
        {shareToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-5 py-3 rounded-2xl text-sm font-black shadow-2xl whitespace-nowrap"
          >
            Trip details copied
          </motion.div>
        )}
      </AnimatePresence>

      <header className="bg-white p-5 flex items-start justify-between gap-3 border-b border-gray-50 shadow-sm sticky top-0 z-20">
        <div className="flex min-w-0 items-start gap-4">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 active:scale-95 transition-all">
            <ArrowLeft size={24} className="text-gray-900" strokeWidth={3} />
          </button>
          <div className="min-w-0">
            <h1
              className="truncate text-[17px] font-black text-gray-900 leading-none"
              title={`Trip ID: #${details.rideCode}`}
            >
              Trip ID: #{details.shortRideCode}
            </h1>
            <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-widest text-gray-400">
              {details.statusLabel}: {formatLongDate(details.timeSource)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={handleDownloadInvoice} className="shrink-0 active:scale-90 transition-all p-2 rounded-full bg-gray-50 border border-gray-100 shadow-sm" title="Download Invoice">
            <Download size={18} className="text-gray-900 transition-colors" />
          </button>
          <button onClick={handleShare} className="shrink-0 active:scale-90 transition-all p-2 rounded-full bg-gray-50 border border-gray-100 shadow-sm" title="Share Ride Details">
            <Share2 size={18} className="text-gray-900 transition-colors" />
          </button>
        </div>
      </header>

      <div className="flex-1 p-5 space-y-8 overflow-y-auto no-scrollbar">
        {loading && (
          <div className="rounded-[24px] border border-gray-50 bg-white p-5 text-center text-[13px] font-black text-gray-500 shadow-sm">
            Loading trip details...
          </div>
        )}

        {error && (
          <div className="rounded-[24px] border border-red-100 bg-red-50 p-5 text-center text-[13px] font-black text-red-600 shadow-sm">
            {error}
          </div>
        )}

        <div id="interactive-map" className="h-40 bg-gray-100 rounded-[32px] overflow-hidden relative shadow-sm">
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={{ width: '100%', height: '100%' }}
              center={{ 
                lat: Number(ride?.pickupLocation?.coordinates?.[1] || ride?.pickup?.coordinates?.[1] || 22), 
                lng: Number(ride?.pickupLocation?.coordinates?.[0] || ride?.pickup?.coordinates?.[0] || 75) 
              }}
              zoom={13}
              options={{ disableDefaultUI: true, gestureHandling: 'greedy' }}
            >
              {(ride?.pickupLocation?.coordinates || ride?.pickup?.coordinates) && (
                <MarkerF 
                  position={{ 
                    lat: Number(ride?.pickupLocation?.coordinates?.[1] || ride?.pickup?.coordinates?.[1]), 
                    lng: Number(ride?.pickupLocation?.coordinates?.[0] || ride?.pickup?.coordinates?.[0]) 
                  }} 
                  label="P" 
                />
              )}
              {(ride?.dropLocation?.coordinates || ride?.drop?.coordinates) && (
                <MarkerF 
                  position={{ 
                    lat: Number(ride?.dropLocation?.coordinates?.[1] || ride?.drop?.coordinates?.[1]), 
                    lng: Number(ride?.dropLocation?.coordinates?.[0] || ride?.drop?.coordinates?.[0]) 
                  }} 
                  label="D" 
                />
              )}
              {(ride?.pickupLocation?.coordinates || ride?.pickup?.coordinates) && (ride?.dropLocation?.coordinates || ride?.drop?.coordinates) && (
                <PolylineF
                  path={[
                    { 
                      lat: Number(ride?.pickupLocation?.coordinates?.[1] || ride?.pickup?.coordinates?.[1]), 
                      lng: Number(ride?.pickupLocation?.coordinates?.[0] || ride?.pickup?.coordinates?.[0]) 
                    },
                    { 
                      lat: Number(ride?.dropLocation?.coordinates?.[1] || ride?.drop?.coordinates?.[1]), 
                      lng: Number(ride?.dropLocation?.coordinates?.[0] || ride?.drop?.coordinates?.[0]) 
                    }
                  ]}
                  options={{ strokeColor: '#0000FF', strokeWeight: 4, strokeOpacity: 0.5 }}
                />
              )}
            </GoogleMap>
          ) : (
            <img 
              src={mapImageUrl} 
              className="w-full h-full object-cover opacity-80" 
              alt="Map View" 
              crossOrigin="anonymous"
              onError={() => {
                if (!imageError) setImageError(true);
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-white/80 to-transparent" />
        </div>

        <div className="relative pl-8 space-y-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 border-l-2 border-dashed border-gray-100" />

          <div className="relative">
            <div className="absolute -left-9 top-0.5 w-4 h-4 rounded-full border-2 border-green-500 bg-white shadow-sm flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
            </div>
            <h4 className="text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">Pickup</h4>
            <p className="text-[15px] font-black text-gray-800 leading-tight">{details.pickup}</p>
            <span className="text-[11px] font-bold text-gray-400 block mt-1">{formatTime(details.startTime)}</span>
          </div>

          <div className="relative">
            <div className="absolute -left-9 top-0.5 w-4 h-4 rounded-full border-2 border-primary-orange/50 bg-white shadow-sm flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-primary-orange/50 rounded-full" />
            </div>
            <h4 className="text-[12px] font-black text-gray-400 uppercase tracking-widest mb-1">Drop</h4>
            <p className="text-[15px] font-black text-gray-800 leading-tight">{details.drop}</p>
            <span className="text-[11px] font-bold text-gray-400 block mt-1">{formatTime(details.endTime)}</span>
          </div>
        </div>

        <div className="bg-white rounded-[32px] p-6 border border-gray-50 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-50">
            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-900 shadow-sm border border-gray-100">
              <Bike size={22} />
            </div>
            <div>
              <h3 className="text-[15px] font-black text-gray-900">{details.vehicle} Ride</h3>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Payment by {details.paymentMethod}</p>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {details.statusLabel === 'Cancelled' ? (
              <>
                <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                  <span>Cancellation Fee</span>
                  <span className="text-red-500">Rs {Number(ride?.cancellation_charge || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                  <span>Reason</span>
                  <span className="text-gray-900">{ride?.cancellation_reason || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                  <span>Fee Payment Status</span>
                  <span className={ride?.cancellation_status === 'recovered' ? 'text-emerald-600' : 'text-amber-600 font-semibold'}>
                    {ride?.cancellation_status === 'recovered' ? 'Recovered' : 'Pending'}
                  </span>
                </div>
                {ride?.cancellation_status === 'recovered' && (
                  <div className="flex justify-between items-center text-[11px] font-bold text-gray-400">
                    <span>Recovered in trip</span>
                    <span>#{String(ride?.recovered_in_ride || '').slice(-6).toUpperCase()}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-[16px] font-black text-gray-900 border-t border-gray-50 pt-3">
                  <span>Total Charges</span>
                  <span>Rs {Number(ride?.cancellation_charge || 0).toFixed(2)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                  <span>Base Fare</span>
                  <span className="text-gray-900">Rs {details.baseFare.toFixed(2)}</span>
                </div>
                {details.waitingChargeAmount > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                    <span>Wait time charge</span>
                    <span className="text-gray-900">Rs {details.waitingChargeAmount.toFixed(2)}</span>
                  </div>
                )}
                {details.timeChargeAmount > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                    <span>Ride time charge</span>
                    <span className="text-gray-900">Rs {details.timeChargeAmount.toFixed(2)}</span>
                  </div>
                )}
                {details.distanceChargeAmount > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                    <span>Extra distance charge</span>
                    <span className="text-gray-900">Rs {details.distanceChargeAmount.toFixed(2)}</span>
                  </div>
                )}
                {details.additionalCharge > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-gray-500">
                    <span>Additional charge</span>
                    <span className="text-gray-900">Rs {details.additionalCharge.toFixed(2)}</span>
                  </div>
                )}
                {details.adminExtraChargeAmount > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-amber-700">
                    <span>Extra charge ({ride?.adminExtraCharge?.reason || 'Admin extra'})</span>
                    <span className="text-amber-700">Rs {details.adminExtraChargeAmount.toFixed(2)}</span>
                  </div>
                )}
                {details.promoDiscountAmount > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-emerald-600">
                    <span>Promo ({details.promoCode}) Applied</span>
                    <span>-Rs {details.promoDiscountAmount.toFixed(2)}</span>
                  </div>
                )}
                {ride?.recovered_cancellation_due > 0 && (
                  <div className="flex justify-between items-center text-[13px] font-bold text-red-500">
                    <span>Previous Cancellation Due</span>
                    <span>Rs {Number(ride.recovered_cancellation_due).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-[16px] font-black text-gray-900 border-t border-gray-50 pt-3">
                  <span>Total Paid</span>
                  <span>Rs {(details.fare + Number(ride?.recovered_cancellation_due || 0)).toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between p-5 bg-primary-orange/5/50 rounded-[28px] border border-primary-orange/5">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-white rounded-2xl p-0.5 overflow-hidden border border-primary-orange/10">
              <img
                src={`https://ui-avatars.com/api/?name=${String(details.driverName).replace(' ', '+')}&background=f0f0f0&color=000`}
                className="w-full h-full rounded-[14px]"
                alt={details.driverName}
              />
            </div>
            <div>
              <h4 className="text-[14px] font-black text-gray-900">{details.driverName}</h4>
              <div className="flex items-center gap-1 text-[11px] font-black text-accent-orange">
                <Star size={12} className="fill-orange-600" />
                <span>{details.rating} - {details.plate}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(`${routePrefix}/support`)}
            className="bg-white px-4 py-2 rounded-full text-[12px] font-black text-gray-900 border border-primary-orange/10 active:scale-95 transition-all"
          >
            Support
          </button>
        </div>
      </div>

      <div className="p-6 border-t border-gray-50 flex gap-4 bg-white pb-10">
        <button
          type="button"
          onClick={() => navigate(`${routePrefix}/ride/select-location`, {
            state: {
              pickup: details.pickup,
              drop: details.drop,
              pickupCoords: ride?.pickupLocation?.coordinates || ride?.pickup?.coordinates || null,
              dropCoords: ride?.dropLocation?.coordinates || ride?.drop?.coordinates || null,
            },
          })}
          className="flex-[2] bg-[#1C2833] text-white py-5 rounded-[24px] text-[14px] font-black uppercase tracking-widest shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all"
        >
          <Repeat size={18} />
          <span>Rebook Ride</span>
        </button>
        <button
          type="button"
          onClick={() => navigate(`${routePrefix}/support`)}
          className="flex-1 bg-gray-50 text-gray-900 py-5 rounded-[24px] text-[14px] font-black uppercase tracking-widest border border-gray-100 flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <HelpCircle size={18} />
          <span>Help</span>
        </button>
      </div>
      <InvoiceTemplate ref={invoiceRef} details={details} ride={ride} appName={appName} appLogo={appLogo} mapImageUrl={pdfMapImageUrl} isLoaded={isLoaded} />
    </div>
  );
};

export default RideDetail;
