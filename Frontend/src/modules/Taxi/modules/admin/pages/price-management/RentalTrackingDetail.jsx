import React, { useEffect, useMemo, useState } from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import {
  AlertTriangle,
  Clock3,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Radio,
  ShieldAlert,
  User2,
  WifiOff,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import AdminPageHeader from '../../components/ui/AdminPageHeader';
import { socketService } from '../../../../shared/api/socket';
import { adminService } from '../../services/adminService';
import {
  HAS_VALID_GOOGLE_MAPS_KEY,
  INDIA_CENTER,
  useAppGoogleMapsLoader,
} from '../../utils/googleMaps';

const mapContainerStyle = { width: '100%', height: '100%' };

const statusTone = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  location_off: 'bg-amber-50 text-amber-700 border-amber-100',
  tracking_stopped: 'bg-rose-50 text-rose-700 border-rose-100',
  inactive: 'bg-slate-100 text-slate-600 border-slate-200',
};

const zoneTone = {
  inside: 'bg-sky-50 text-sky-700 border-sky-100',
  outside: 'bg-rose-50 text-rose-700 border-rose-100',
  unknown: 'bg-slate-100 text-slate-600 border-slate-200',
};

const formatDateTime = (value) => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return 'Not available';
  }

  return parsed.toLocaleString();
};

const formatMinutesAgo = (value) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(parsed)) {
    return 'No ping';
  }

  const diffMs = Math.max(0, Date.now() - parsed);
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes <= 0) {
    return 'Just now';
  }
  if (diffMinutes === 1) {
    return '1 min ago';
  }
  return `${diffMinutes} mins ago`;
};

const formatDistance = (value) => {
  const distance = Number(value);
  if (!Number.isFinite(distance)) {
    return 'Distance unavailable';
  }

  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(2)} km from hub`;
  }

  return `${distance.toFixed(0)} m from hub`;
};

const findTrackingItem = async (id) => {
  const response = await adminService.getRentalTrackingDashboard();
  const payload = response?.data?.data || response?.data || {};
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.find((item) => String(item?.id) === String(id)) || null;
};

const RentalTrackingDetail = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const seededItem = location.state?.item || null;
  const [item, setItem] = useState(seededItem);
  const [loading, setLoading] = useState(!seededItem);
  const { isLoaded, loadError } = useAppGoogleMapsLoader();

  useEffect(() => {
    let mounted = true;

    if (seededItem && String(seededItem?.id) === String(id)) {
      return undefined;
    }

    const load = async () => {
      setLoading(true);
      try {
        const nextItem = await findTrackingItem(id);
        if (!mounted) {
          return;
        }

        if (!nextItem) {
          toast.error('Tracked rental was not found.');
          navigate('/taxi/admin/pricing/rental-tracking', { replace: true });
          return;
        }

        setItem(nextItem);
      } catch (error) {
        if (mounted) {
          toast.error(error?.message || 'Could not load rental tracking details.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [id, navigate, seededItem]);

  useEffect(() => {
    const socket = socketService.connect({ role: 'admin' });
    if (!socket) {
      return undefined;
    }

    const handleTrackingUpdate = (payload) => {
      if (String(payload?.id) === String(id)) {
        setItem(payload);
      }
    };

    const handleTrackingAlert = (payload) => {
      if (String(payload?.id) !== String(id)) {
        return;
      }

      setItem(payload);
      toast((payload?.rentalTracking?.alerts || [])[0]?.message || 'Rental tracking alert triggered.');
    };

    socketService.on('rental:tracking:updated', handleTrackingUpdate);
    socketService.on('rental:tracking:alert', handleTrackingAlert);

    return () => {
      socketService.off('rental:tracking:updated', handleTrackingUpdate);
      socketService.off('rental:tracking:alert', handleTrackingAlert);
    };
  }, [id]);

  const tracking = item?.rentalTracking || {};
  const hasLiveLocation =
    Number.isFinite(Number(tracking?.currentLocation?.lat)) &&
    Number.isFinite(Number(tracking?.currentLocation?.lng));

  const mapCenter = useMemo(() => {
    if (hasLiveLocation) {
      return {
        lat: Number(tracking.currentLocation.lat),
        lng: Number(tracking.currentLocation.lng),
      };
    }

    const hubLat = Number(item?.serviceLocation?.latitude);
    const hubLng = Number(item?.serviceLocation?.longitude);
    if (Number.isFinite(hubLat) && Number.isFinite(hubLng)) {
      return { lat: hubLat, lng: hubLng };
    }

    return INDIA_CENTER;
  }, [hasLiveLocation, item?.serviceLocation?.latitude, item?.serviceLocation?.longitude, tracking.currentLocation]);

  const mapHref = hasLiveLocation
    ? `https://www.google.com/maps?q=${tracking.currentLocation.lat},${tracking.currentLocation.lng}`
    : '';

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-6 lg:p-8">
      <AdminPageHeader
        module="Pricing"
        page="Rental Tracking"
        title={item?.bookingReference || 'Track Vehicle'}
        backto="/taxi/admin/pricing/rental-tracking"
      />

      {loading ? (
        <div className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <Loader2 size={30} className="animate-spin text-slate-400" />
        </div>
      ) : !item ? (
        <div className="rounded-[28px] border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Tracking item not found</h2>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Live Vehicle Tracking</p>
                  <h2 className="mt-1 text-xl font-black text-slate-900">{item.bookingReference || 'Rental booking'}</h2>
                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    {item.user?.name || 'Customer'} riding {item.vehicle?.name || 'Assigned Vehicle'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusTone[tracking.trackingStatus] || statusTone.inactive}`}>
                    {tracking.trackingStatus === 'active' ? <Radio size={12} /> : <WifiOff size={12} />}
                    {tracking.trackingStatus || 'inactive'}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${zoneTone[tracking.zoneStatus] || zoneTone.unknown}`}>
                    <ShieldAlert size={12} />
                    {tracking.zoneStatus || 'unknown'}
                  </span>
                </div>
              </div>

              <div className="h-[420px] overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
                {!HAS_VALID_GOOGLE_MAPS_KEY ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <MapPin size={34} className="text-slate-300" />
                    <p className="text-lg font-black text-slate-900">Map key not configured</p>
                    <p className="max-w-md text-sm font-medium text-slate-500">
                      The live coordinates are still available below. Add `VITE_GOOGLE_MAPS_API_KEY` to render the map on this page.
                    </p>
                  </div>
                ) : loadError ? (
                  <div className="flex h-full items-center justify-center text-sm font-semibold text-rose-500">
                    Map failed to load.
                  </div>
                ) : isLoaded ? (
                  <GoogleMap
                    mapContainerStyle={mapContainerStyle}
                    center={mapCenter}
                    zoom={hasLiveLocation ? 15 : 12}
                    options={{
                      streetViewControl: false,
                      mapTypeControl: false,
                      fullscreenControl: false,
                    }}
                  >
                    {hasLiveLocation ? (
                      <MarkerF
                        position={{
                          lat: Number(tracking.currentLocation.lat),
                          lng: Number(tracking.currentLocation.lng),
                        }}
                      />
                    ) : null}
                  </GoogleMap>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 size={26} className="animate-spin text-slate-400" />
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Current Coordinates</p>
                  <p className="mt-2 text-sm font-black text-slate-900">
                    {hasLiveLocation
                      ? `${Number(tracking.currentLocation.lat).toFixed(6)}, ${Number(tracking.currentLocation.lng).toFixed(6)}`
                      : 'Waiting for location'}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Last Ping</p>
                  <p className="mt-2 text-sm font-black text-slate-900">{formatMinutesAgo(tracking.lastLocationAt)}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Hub Distance</p>
                  <p className="mt-2 text-sm font-black text-slate-900">{formatDistance(tracking.distanceFromHubMeters)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-black text-slate-900">Rental Details</h3>
              <div className="mt-4 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-100 p-2 text-slate-500"><User2 size={16} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Customer</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{item.user?.name || 'Customer'}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{item.user?.phone || 'No phone number'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-100 p-2 text-slate-500"><Navigation size={16} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Vehicle</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{item.vehicle?.name || 'Assigned Vehicle'}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{item.vehicle?.category || 'Rental'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-100 p-2 text-slate-500"><MapPin size={16} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Service Location</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{item.serviceLocation?.name || 'Rental hub'}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{item.serviceLocation?.address || item.serviceLocation?.city || 'No address'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-slate-100 p-2 text-slate-500"><Clock3 size={16} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Assigned At</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{formatDateTime(item.assignedAt)}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Status: {item.status || 'assigned'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-black text-slate-900">Tracking Metrics</h3>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Accuracy</p>
                  <p className="mt-2 text-sm font-black text-slate-900">
                    {Number.isFinite(Number(tracking.accuracyMeters)) ? `${Number(tracking.accuracyMeters).toFixed(0)} m` : 'N/A'}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Speed</p>
                  <p className="mt-2 text-sm font-black text-slate-900">
                    {Number.isFinite(Number(tracking.speed)) ? `${Number(tracking.speed).toFixed(1)} m/s` : 'N/A'}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Heading</p>
                  <p className="mt-2 text-sm font-black text-slate-900">
                    {Number.isFinite(Number(tracking.heading)) ? `${Number(tracking.heading).toFixed(0)} deg` : 'N/A'}
                  </p>
                </div>
                {mapHref ? (
                  <a
                    href={mapHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-white"
                  >
                    <MapPin size={14} />
                    Open External Map
                  </a>
                ) : null}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-rose-500" />
                <h3 className="text-lg font-black text-slate-900">Active Alerts</h3>
              </div>
              {Array.isArray(tracking.alerts) && tracking.alerts.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {tracking.alerts.map((alert) => (
                    <div key={`${item.id}-${alert.code}`} className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-700">{String(alert.code || '').replace(/_/g, ' ')}</p>
                      <p className="mt-1 text-sm font-semibold text-rose-900">{alert.message || 'Tracking alert triggered'}</p>
                      <p className="mt-1 text-xs font-semibold text-rose-500">{formatDateTime(alert.updatedAt || alert.createdAt)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm font-semibold text-emerald-600">No active alerts on this rental right now.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RentalTrackingDetail;
