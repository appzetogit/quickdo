import React, { useEffect, useMemo, useState } from 'react';
import { GoogleMap, MarkerF } from '@react-google-maps/api';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  History,
  LifeBuoy,
  MapPin,
  MoreHorizontal,
  PhoneCall,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { socketService } from '../../../../shared/api/socket';
import { adminService } from '../../services/adminService';
import { HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER, useAppGoogleMapsLoader } from '../../utils/googleMaps';

const mapContainerStyle = { width: '100%', height: '100%' };

const formatRelativeTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Just now';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatDateTime = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';

  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getParticipantTitle = (alert) =>
  alert?.sourceApp === 'driver'
    ? alert?.driverName || 'Driver'
    : alert?.riderName || 'Rider';

const getDriverLabel = (alert) => alert?.driverName || 'Unassigned driver';
const getRiderLabel = (alert) => alert?.riderName || 'User';

const getMapCenter = (alert) =>
  Number.isFinite(Number(alert?.location?.lat)) && Number.isFinite(Number(alert?.location?.lng))
    ? { lat: Number(alert.location.lat), lng: Number(alert.location.lng) }
    : INDIA_CENTER;

const SOSCard = ({ alert, isActive, onClick }) => (
  <div
    onClick={onClick}
    className={`p-4 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden ${
      isActive ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 hover:border-red-100'
    }`}
  >
    {isActive ? <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-red-600" /> : null}

    <div className="flex justify-between items-start mb-2 gap-3">
      <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
        Live SOS
      </span>
      <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
        <Clock size={12} /> {formatRelativeTime(alert?.createdAt)}
      </div>
    </div>

    <h4 className="text-[14px] font-black text-gray-900 tracking-tight leading-none mb-1">
      {getParticipantTitle(alert)}
    </h4>
    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mb-3">
      {alert?.tripCode || alert?.rideId || 'GENERAL-SOS'}
    </p>

    <div className="space-y-1 border-t border-gray-50 pt-3">
      <p className="text-[12px] font-bold text-gray-700">{getDriverLabel(alert)}</p>
      <p className="text-[10px] font-medium text-gray-400 uppercase">
        {alert?.vehicleLabel || alert?.serviceType || 'Unknown vehicle'}
      </p>
      <p className="text-[10px] font-bold text-gray-400 truncate">
        {alert?.locationLabel || alert?.pickupAddress || 'Location unavailable'}
      </p>
    </div>
  </div>
);

const SafetyCenter = () => {
  const { isLoaded, loadError } = useAppGoogleMapsLoader();
  const [alerts, setAlerts] = useState([]);
  const [selectedAlertId, setSelectedAlertId] = useState('');
  const [checklist, setChecklist] = useState({
    pcall: false,
    dcall: false,
    police: false,
    nearby: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState(false);
  const [logDraft, setLogDraft] = useState('');

  const selectedAlert = useMemo(
    () => alerts.find((entry) => entry.id === selectedAlertId) || alerts[0] || null,
    [alerts, selectedAlertId],
  );

  const loadAlerts = async () => {
    setIsLoading(true);
    try {
      const response = await adminService.getSafetyAlerts({ status: 'active', limit: 50 });
      const results = response?.data?.data?.results || response?.data?.results || [];
      setAlerts(results);
      setSelectedAlertId((current) => current || results[0]?.id || '');
    } catch (error) {
      console.error('Failed to load safety alerts:', error);
      toast.error(error?.message || 'Unable to load safety alerts');
      setAlerts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  useEffect(() => {
    const handleNewAlert = (payload = {}) => {
      setAlerts((current) => [payload, ...current.filter((item) => item.id !== payload.id)]);
      setSelectedAlertId((current) => current || payload.id || '');
      toast.error(`${getParticipantTitle(payload)} triggered SOS`, { duration: 4500 });
    };

    const handleUpdatedAlert = (payload = {}) => {
      setAlerts((current) =>
        current
          .map((item) => (item.id === payload.id ? payload : item))
          .filter((item) => String(item.status || '').toLowerCase() !== 'resolved'),
      );
      setSelectedAlertId((current) => (current === payload.id ? '' : current));
    };

    socketService.on('new_sos', handleNewAlert);
    socketService.on('safety:alert:new', handleNewAlert);
    socketService.on('safety:alert:updated', handleUpdatedAlert);

    return () => {
      socketService.off('new_sos', handleNewAlert);
      socketService.off('safety:alert:new', handleNewAlert);
      socketService.off('safety:alert:updated', handleUpdatedAlert);
    };
  }, []);

  useEffect(() => {
    if (!selectedAlertId && alerts.length > 0) {
      setSelectedAlertId(alerts[0].id);
    }
  }, [alerts, selectedAlertId]);

  const handleResolve = async () => {
    if (!selectedAlert?.id) return;

    setIsResolving(true);
    try {
      await adminService.resolveSafetyAlert(selectedAlert.id, logDraft.trim());
      setAlerts((current) => current.filter((item) => item.id !== selectedAlert.id));
      setSelectedAlertId('');
      setLogDraft('');
      toast.success('Incident marked as resolved');
    } catch (error) {
      console.error('Failed to resolve safety alert:', error);
      toast.error(error?.message || 'Unable to resolve incident');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-6 bg-white rounded-[32px] border border-gray-100 shadow-sm p-6 m-2 md:m-4 lg:m-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="w-80 shrink-0 flex flex-col space-y-6 overflow-y-auto no-scrollbar pb-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-red-600 flex items-center gap-3">
            <ShieldAlert size={28} strokeWidth={2.5} className="animate-bounce" /> Safety Center
          </h1>
          <p className="text-gray-400 font-bold text-[11px] mt-1 uppercase tracking-widest leading-none">
            Real-time Emergency Monitoring
          </p>
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between px-1 mb-4">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
              <Radio size={14} className="text-red-500" /> Active Alerts ({alerts.length})
            </span>
            <button onClick={loadAlerts} className="text-[10px] font-bold text-primary uppercase">
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-5 text-[12px] font-bold text-gray-400">
              Loading live safety alerts...
            </div>
          ) : null}

          {!isLoading && alerts.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-5 text-[12px] font-bold text-gray-400">
              No active SOS incidents right now.
            </div>
          ) : null}

          {alerts.map((alert) => (
            <SOSCard
              key={alert.id}
              alert={alert}
              isActive={selectedAlert?.id === alert.id}
              onClick={() => setSelectedAlertId(alert.id)}
            />
          ))}
        </div>

        <div className="bg-gray-900 rounded-2xl p-4 text-white">
          <div className="flex items-center gap-3 mb-3">
            <LifeBuoy size={18} className="text-primary" />
            <h5 className="text-[12px] font-black uppercase tracking-widest">SOP Support</h5>
          </div>
          <p className="text-[10px] font-bold text-gray-400 leading-relaxed uppercase">
            Response time must be below <span className="text-white">60 Seconds</span>. Verify the rider and driver first, then escalate to local authorities if contact is lost.
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto no-scrollbar pr-2">
        {selectedAlert ? (
          <>
            <div className="bg-white border-2 border-red-100 rounded-3xl p-6 flex items-center justify-between gap-6 shadow-xl shadow-red-50">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 border-4 border-red-50 relative">
                  <ShieldAlert size={32} />
                  <div className="absolute -top-1 -right-1 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] font-black tracking-tighter">
                    RED
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight leading-none mb-2">
                    {getParticipantTitle(selectedAlert)} raised SOS
                  </h2>
                  <p className="text-[13px] font-bold text-gray-500 flex items-center gap-2">
                    <MapPin size={16} className="text-red-500" />
                    Last Known Location: {selectedAlert.locationLabel || selectedAlert.pickupAddress || 'Location unavailable'}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => window.open('tel:100', '_self')}
                  className="bg-red-600 text-white px-8 py-3 rounded-2xl text-[14px] font-black hover:bg-red-700 transition-all shadow-xl shadow-red-200 flex items-center gap-2"
                >
                  <PhoneCall size={18} strokeWidth={2.5} /> DIAL POLICE (100)
                </button>
                <button
                  onClick={handleResolve}
                  disabled={isResolving}
                  className="bg-white border-2 border-gray-100 text-gray-900 px-6 py-3 rounded-2xl text-[14px] font-black hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-60"
                >
                  <CheckCircle2 size={18} /> {isResolving ? 'RESOLVING...' : 'RESOLVE INCIDENT'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-6">
                <div className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm">
                  <h4 className="text-[12px] font-black text-gray-400 tracking-widest uppercase mb-8 flex items-center justify-between">
                    Distress Context <MoreHorizontal size={16} />
                  </h4>

                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        {selectedAlert.sourceApp === 'driver' ? 'Driver SOS' : 'User SOS'}
                      </p>
                      <p className="mt-2 text-[16px] font-black text-gray-900">{getParticipantTitle(selectedAlert)}</p>
                      <p className="mt-1 text-[12px] font-bold text-gray-500">
                        {selectedAlert.sourceApp === 'driver' ? selectedAlert.driverPhone || '--' : selectedAlert.riderPhone || '--'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Counterpart</p>
                      <p className="mt-2 text-[16px] font-black text-gray-900">
                        {selectedAlert.sourceApp === 'driver' ? getRiderLabel(selectedAlert) : getDriverLabel(selectedAlert)}
                      </p>
                      <p className="mt-1 text-[12px] font-bold text-gray-500">
                        {selectedAlert.sourceApp === 'driver' ? selectedAlert.riderPhone || '--' : selectedAlert.driverPhone || '--'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-6 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center text-[13px] font-bold">
                      <span className="text-gray-400">Service:</span>
                      <span className="text-gray-900 uppercase">{selectedAlert.serviceType || 'general'}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px] font-bold">
                      <span className="text-gray-400">Trip/Alert ID:</span>
                      <span className="text-gray-900">{selectedAlert.tripCode || selectedAlert.id}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px] font-bold">
                      <span className="text-gray-400">Vehicle:</span>
                      <span className="text-gray-900">{selectedAlert.vehicleLabel || '--'}</span>
                    </div>
                    <div className="pt-2 text-[12px] font-bold text-gray-600">
                      <div>{selectedAlert.pickupAddress || 'Pickup unavailable'}</div>
                      <div className="mt-1 text-gray-400">{selectedAlert.dropAddress || 'Drop unavailable'}</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm">
                  <h4 className="text-[12px] font-black text-gray-900 tracking-widest uppercase mb-6 flex items-center gap-2">
                    <AlertCircle size={18} className="text-blue-500" /> Dispatch SOP Checklist
                  </h4>
                  <div className="space-y-4">
                    {[
                      { id: 'pcall', label: `Call ${selectedAlert.sourceApp === 'driver' ? 'driver' : 'rider'} to verify status` },
                      { id: 'dcall', label: `Call ${selectedAlert.sourceApp === 'driver' ? 'rider' : 'driver'} to confirm situation` },
                      { id: 'police', label: 'Notify nearest police hub' },
                      { id: 'nearby', label: 'Dispatch nearby driver partners / responders' },
                    ].map((step) => (
                      <div key={step.id} className="flex items-center gap-4">
                        <input
                          type="checkbox"
                          checked={checklist[step.id]}
                          onChange={() => setChecklist((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}
                          className="w-5 h-5 rounded-md border-gray-200 text-primary focus:ring-primary/20"
                        />
                        <span className={`text-[13px] font-bold ${checklist[step.id] ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white h-[320px] rounded-[32px] border border-gray-100 shadow-sm overflow-hidden relative">
                  {loadError ? (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-slate-50">
                      <div>
                        <p className="text-[12px] font-black text-rose-600 uppercase tracking-widest">Map unavailable</p>
                        <p className="text-sm text-gray-500 mt-2">Google Maps could not be loaded for Safety Center.</p>
                      </div>
                    </div>
                  ) : HAS_VALID_GOOGLE_MAPS_KEY && isLoaded ? (
                    <GoogleMap
                      mapContainerStyle={mapContainerStyle}
                      center={getMapCenter(selectedAlert)}
                      zoom={15}
                      options={{
                        streetViewControl: false,
                        mapTypeControl: false,
                        fullscreenControl: true,
                      }}
                    >
                      {selectedAlert?.location ? (
                        <MarkerF
                          position={getMapCenter(selectedAlert)}
                          title={`${getParticipantTitle(selectedAlert)} distress location`}
                          icon={{
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 10,
                            fillColor: '#DC2626',
                            fillOpacity: 1,
                            strokeColor: '#ffffff',
                            strokeWeight: 3,
                          }}
                        />
                      ) : null}
                    </GoogleMap>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-[linear-gradient(135deg,#fee2e2_0%,#fff1f2_100%)]">
                      <div>
                        <p className="text-[12px] font-black text-red-600 uppercase tracking-widest">Add Google Maps key</p>
                        <p className="text-sm text-gray-500 mt-2">Safety Center will show the live incident map after `VITE_GOOGLE_MAPS_API_KEY` is set.</p>
                      </div>
                    </div>
                  )}

                  <div className="absolute top-4 right-4 flex flex-col gap-2">
                    <button className="bg-white/90 backdrop-blur-md p-2 rounded-xl shadow-lg border border-white text-gray-500 hover:text-black transition-all">
                      <MoreHorizontal size={18} />
                    </button>
                    <button className="bg-white/90 backdrop-blur-md p-2 rounded-xl shadow-lg border border-white text-primary hover:scale-105 transition-all">
                      <MapPin size={18} />
                    </button>
                  </div>
                </div>

                <div className="bg-[#0F172A] rounded-[32px] p-8 text-white h-[calc(100%-344px)] flex flex-col">
                  <h4 className="text-[12px] font-black text-gray-500 tracking-widest uppercase mb-6 flex items-center justify-between">
                    Live Incident Log <History size={16} />
                  </h4>
                  <div className="flex-1 space-y-5 overflow-y-auto no-scrollbar">
                    {[
                      {
                        createdAt: selectedAlert.createdAt,
                        message: `SOS alert triggered by ${selectedAlert.sourceApp} app.`,
                      },
                      ...(Array.isArray(selectedAlert.logs) ? selectedAlert.logs : []),
                    ].map((log, index) => (
                      <div key={`${log.createdAt || 'log'}-${index}`} className="flex gap-4 group">
                        <span className="text-[11px] font-black text-gray-600 whitespace-nowrap mt-0.5">
                          {formatDateTime(log.createdAt)}
                        </span>
                        <p className="text-[13px] font-bold text-gray-300 tracking-tight leading-snug uppercase tracking-tighter">
                          {log.message}
                          {index === 0 ? <span className="inline-block w-2 h-2 bg-red-600 rounded-full animate-pulse ml-2" /> : null}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 relative">
                    <input
                      type="text"
                      value={logDraft}
                      onChange={(event) => setLogDraft(event.target.value)}
                      placeholder="Add resolution note..."
                      className="w-full bg-white/5 border border-white/5 rounded-2xl py-3 px-4 text-sm font-medium focus:ring-1 focus:ring-white/20 transition-all"
                    />
                    <button
                      onClick={handleResolve}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 bg-white rounded-lg text-black hover:bg-white/90"
                    >
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center flex-col text-center space-y-4">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-300">
              <ShieldAlert size={40} />
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight">No Active Incidents</h3>
              <p className="text-gray-400 font-bold text-[12px] uppercase">
                The safety center will show live SOS alerts from user and driver apps here
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SafetyCenter;
