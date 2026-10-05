import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CarFront, Loader2, Radio, Search, ShieldAlert, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import AdminPageHeader from '../../components/ui/AdminPageHeader';
import { socketService } from '../../../../shared/api/socket';
import { adminService } from '../../services/adminService';

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

const mapTrackingResults = (response) => {
  const payload = response?.data?.data || response?.data || {};
  return {
    results: Array.isArray(payload?.results) ? payload.results : [],
    stats: payload?.stats || {
      total: 0,
      live: 0,
      locationOff: 0,
      outsideZone: 0,
      alerts: 0,
    },
  };
};

const RentalTracking = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    live: 0,
    locationOff: 0,
    outsideZone: 0,
    alerts: 0,
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await adminService.getRentalTrackingDashboard();
        const nextState = mapTrackingResults(response);
        if (!mounted) {
          return;
        }
        setItems(nextState.results);
        setStats(nextState.stats);
      } catch (error) {
        if (mounted) {
          toast.error(error?.message || 'Could not load rental tracking dashboard.');
        }
      } finally {
        if (mounted && !silent) {
          setLoading(false);
        }
      }
    };

    load();
    const intervalId = window.setInterval(() => load({ silent: true }), 60000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const socket = socketService.connect({ role: 'admin' });
    if (!socket) {
      return undefined;
    }

    const upsertItem = (nextItem) => {
      if (!nextItem?.id) {
        return;
      }

      setItems((current) => {
        const currentItems = Array.isArray(current) ? current : [];
        const nextItems = [...currentItems];
        const existingIndex = nextItems.findIndex((item) => String(item?.id) === String(nextItem.id));

        if (existingIndex >= 0) {
          nextItems[existingIndex] = nextItem;
        } else {
          nextItems.unshift(nextItem);
        }

        return nextItems;
      });
    };

    const handleTrackingUpdate = (payload) => {
      upsertItem(payload);
    };

    const handleTrackingAlert = (payload) => {
      upsertItem(payload);
      const userName = payload?.user?.name || 'Customer';
      const bookingReference = payload?.bookingReference || 'Rental booking';
      toast((payload?.rentalTracking?.alerts || [])[0]?.message || `${userName} triggered a rental tracking alert on ${bookingReference}.`);
    };

    socketService.on('rental:tracking:updated', handleTrackingUpdate);
    socketService.on('rental:tracking:alert', handleTrackingAlert);

    return () => {
      socketService.off('rental:tracking:updated', handleTrackingUpdate);
      socketService.off('rental:tracking:alert', handleTrackingAlert);
    };
  }, []);

  const derivedStats = useMemo(() => {
    if (items.length === 0) {
      return stats;
    }

    return items.reduce(
      (summary, item) => {
        summary.total += 1;

        const trackingStatus = String(item?.rentalTracking?.trackingStatus || '').toLowerCase();
        const zoneStatus = String(item?.rentalTracking?.zoneStatus || '').toLowerCase();
        const hasAlert = Array.isArray(item?.rentalTracking?.alerts) && item.rentalTracking.alerts.length > 0;

        if (trackingStatus === 'active') {
          summary.live += 1;
        }
        if (trackingStatus === 'location_off' || trackingStatus === 'tracking_stopped') {
          summary.locationOff += 1;
        }
        if (zoneStatus === 'outside') {
          summary.outsideZone += 1;
        }
        if (hasAlert) {
          summary.alerts += 1;
        }

        return summary;
      },
      { total: 0, live: 0, locationOff: 0, outsideZone: 0, alerts: 0 },
    );
  }, [items, stats]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) =>
      [
        item?.bookingReference,
        item?.user?.name,
        item?.user?.phone,
        item?.vehicle?.name,
        item?.serviceLocation?.name,
        item?.rentalTracking?.trackingStatus,
        item?.rentalTracking?.zoneStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [items, searchTerm]);

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-6 lg:p-8">
      <AdminPageHeader
        module="Pricing"
        page="Rental Tracking"
        title="Track Vehicles"
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Total</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{derivedStats.total}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Active</p>
          <p className="mt-2 text-2xl font-black text-emerald-600">{derivedStats.live}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Location Off</p>
          <p className="mt-2 text-2xl font-black text-amber-600">{derivedStats.locationOff}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Outside Zone</p>
          <p className="mt-2 text-2xl font-black text-rose-600">{derivedStats.outsideZone}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Alerts</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{derivedStats.alerts}</p>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Rental Tracking Queue</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Open a rental to view its live location stream, zone status, and customer tracking details.
            </p>
          </div>
          <div className="relative w-full max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search booking, customer, vehicle, status"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-300 focus:bg-white"
            />
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <Loader2 size={30} className="animate-spin text-slate-400" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center">
              <CarFront size={34} className="mx-auto text-slate-300" />
              <h2 className="mt-4 text-xl font-black text-slate-900">No tracked rentals found</h2>
              <p className="mt-2 text-sm font-medium text-slate-500">
                Tracking items will appear here after a rental booking is assigned and starts sending location updates.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Booking</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Customer</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Vehicle</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Tracking</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Zone</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Last Ping</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Alerts</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const tracking = item?.rentalTracking || {};
                    const activeAlerts = Array.isArray(tracking.alerts) ? tracking.alerts : [];

                    return (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-4">
                          <p className="text-sm font-black text-slate-900">{item.bookingReference || 'Rental booking'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.serviceLocation?.name || 'Rental hub'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">{item.user?.name || 'Customer'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.user?.phone || 'No phone'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">{item.vehicle?.name || 'Assigned Vehicle'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.vehicle?.category || 'Rental'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${statusTone[tracking.trackingStatus] || statusTone.inactive}`}>
                            {tracking.trackingStatus === 'active' ? <Radio size={12} /> : <WifiOff size={12} />}
                            {tracking.trackingStatus || 'inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-1">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${zoneTone[tracking.zoneStatus] || zoneTone.unknown}`}>
                              <ShieldAlert size={12} />
                              {tracking.zoneStatus || 'unknown'}
                            </span>
                            <p className="text-xs font-semibold text-slate-400">{tracking.matchedZoneName || tracking.hubName || 'Rental zone'}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-black text-slate-900">{formatMinutesAgo(tracking.lastLocationAt)}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{formatDateTime(tracking.lastLocationAt)}</p>
                        </td>
                        <td className="px-4 py-4">
                          {activeAlerts.length > 0 ? (
                            <div className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-rose-700">
                              <AlertTriangle size={12} />
                              {activeAlerts.length} active
                            </div>
                          ) : (
                            <span className="text-xs font-semibold text-emerald-600">Clear</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => navigate(`/taxi/admin/pricing/rental-tracking/${item.id}`, { state: { item } })}
                            className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition hover:bg-black"
                          >
                            Track
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RentalTracking;
