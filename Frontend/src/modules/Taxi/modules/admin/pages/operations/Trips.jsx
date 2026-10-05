import React from 'react';
import { Filter, Search, Loader2, ChevronRight, Menu, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { adminService } from '../../services/adminService';

const STATUS_STYLES = {
  CANCELLED: 'bg-primary-orange/50 text-white',
  COMPLETED: 'bg-teal-500 text-white',
  UPCOMING: 'bg-amber-400 text-white',
  ONGOING: 'bg-blue-500 text-white',
  ACCEPTED: 'bg-emerald-500 text-white',
};

const PAYMENT_STYLES = {
  CASH: 'bg-primary-orange/50 text-white',
  CARD: 'bg-red-500 text-white',
  WALLET: 'bg-teal-500 text-white',
};

const TAB_SET = ['All', 'Completed', 'Cancelled', 'Upcoming', 'On Trip'];

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizeTab = (tab) => {
  if (tab === 'On Trip') return 'ongoing';
  return tab.toLowerCase();
};

const normalizeRow = (row = {}) => ({
  id: String(row._id || row.id || row.requestId || Math.random()),
  requestId: row.requestId || row.request_id || row.ride_request_id || '--',
  date: row.date || row.createdAt || row.created_at || row.trip_date || row.updatedAt,
  userName: row.userName || row.user_name || row.customer_name || row.user?.name || '--',
  driverName: row.driverName || row.driver_name || row.driver?.name || '--',
  transportType: row.transportType || row.transport_type || row.service_type || row.module || '--',
  tripStatus: String(row.tripStatus || row.trip_status || row.status || '').toUpperCase(),
  paymentOption: String(row.paymentOption || row.payment_option || row.payment_method || 'CASH').toUpperCase(),
  raw: row,
});

const Trips = () => {
  const [activeTab, setActiveTab] = React.useState('All');
  const [search, setSearch] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [expandedRow, setExpandedRow] = React.useState(null);
  const [deletingId, setDeletingId] = React.useState(null);

  const loadRows = React.useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminService.getRideRequests({
        limit,
        tab: normalizeTab(activeTab),
        search,
      });
      const payload = response?.data?.data || response?.data || response || {};
      const results = Array.isArray(payload?.results) ? payload.results : [];
      setRows(results.map(normalizeRow));
    } catch (err) {
      setRows([]);
      setError(err?.message || 'Failed to load trip requests');
    } finally {
      setLoading(false);
    }
  }, [activeTab, limit, search]);


  // A ride still searching or on its way is cancelled first; the ride record is
  // kept for earnings and reports, it just leaves this list.
  const deleteTrip = async (row) => {
    const live = ['UPCOMING', 'ACCEPTED', 'ONGOING', 'SEARCHING'].includes(String(row.tripStatus || '').toUpperCase());
    const question = live
      ? `Trip ${row.requestId} is still active. Cancel it and delete it from the list?`
      : `Delete trip ${row.requestId} from the list?`;
    if (!window.confirm(question)) return;
    setDeletingId(row.id);
    try {
      await adminService.deleteTripRequest(row.id);
      setRows((current) => current.filter((r) => r.id !== row.id));
    } catch (err) {
      window.alert(err?.response?.data?.message || err?.message || 'Could not delete this trip');
    } finally {
      setDeletingId(null);
    }
  };
  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between px-4 py-2 bg-white rounded-t-xl">
          <h1 className="text-[20px] font-black tracking-tight text-slate-800 uppercase">RIDE REQUESTS</h1>
          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
            <span>Operations</span>
            <ChevronRight size={14} className="text-slate-300" />
            <span className="text-slate-500">Ride Requests</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm relative">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-6 py-6 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 text-[14px] font-medium text-slate-500">
              <span>show</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="h-9 w-16 border border-slate-200 rounded-md bg-white px-2 text-[13px] outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span>entries</span>
            </div>

            <div className="flex flex-1 justify-center items-center gap-8 flex-wrap">
              {TAB_SET.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative py-1 text-[15px] font-bold transition-all ${activeTab === tab ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                    }`}
                >
                  {tab}
                  {activeTab === tab && (
                    <motion.div layoutId="trip-tab" className="absolute -bottom-3 left-0 right-0 h-0.5 bg-indigo-600" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search trips"
                  className="h-10 w-52 rounded-full border border-slate-200 bg-white pl-9 pr-4 text-[13px] outline-none focus:border-slate-300"
                />
              </div>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-[#f46b45] text-white rounded-lg text-[13px] font-bold shadow-sm">
                <Filter size={16} /> Filters
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  {['Request Id', 'Date', 'User Name', 'Driver Name', 'Transport Type', 'Trip Status', 'Payment Option', 'Action'].map((heading) => (
                    <th key={heading} className="px-6 py-4 text-[13px] font-bold text-slate-900 border-b border-slate-100">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center">
                      <Loader2 className="animate-spin text-slate-300 mx-auto" size={32} />
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-[14px] font-medium text-red-500">
                      {error}
                    </td>
                  </tr>
                ) : rows.length > 0 ? (
                  rows.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`cursor-pointer transition-colors ${expandedRow === row.id ? 'bg-slate-50' : 'hover:bg-slate-50/30'}`}
                        onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                      >
                        <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">
                          <div className="flex items-center gap-2">
                            <ChevronRight
                              size={16}
                              className={`text-slate-400 transition-transform ${expandedRow === row.id ? 'rotate-90' : ''}`}
                            />
                            {row.requestId}
                          </div>
                        </td>
                        <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{formatDate(row.date)}</td>
                        <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.userName}</td>
                        <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.driverName}</td>
                        <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.transportType}</td>
                        <td className="px-6 py-5">
                          <span className={`inline-block px-3 py-1 text-[10px] font-bold rounded uppercase ${STATUS_STYLES[row.tripStatus] || 'bg-slate-200 text-slate-700'}`}>
                            {row.tripStatus || 'UNKNOWN'}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <span className={`inline-block px-3 py-1 text-[10px] font-bold rounded uppercase ${PAYMENT_STYLES[row.paymentOption] || 'bg-primary-orange/50 text-white'}`}>
                            {row.paymentOption}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <button
                            type="button"
                            title="Delete trip"
                            aria-label={`Delete trip ${row.requestId}`}
                            disabled={deletingId === row.id}
                            className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTrip(row);
                            }}
                          >
                            {deletingId === row.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                          </button>
                        </td>
                      </tr>
                      {expandedRow === row.id && (
                        <tr>
                          <td colSpan={8} className="px-0 py-0 border-b border-slate-100">
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="bg-slate-50/50 p-6 border-t border-slate-100"
                            >
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                <div className="space-y-4">
                                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">Trip Locations</h3>
                                  <div className="space-y-3">
                                    <div className="flex items-start gap-3">
                                      <div className="mt-1 w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                      <div>
                                        <p className="text-[12px] font-bold text-slate-700">Pickup</p>
                                        <p className="text-[13px] text-slate-600">{row.raw?.pickupLabel || '--'}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-start gap-3">
                                      <div className="mt-1 w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                                      <div>
                                        <p className="text-[12px] font-bold text-slate-700">Drop-off</p>
                                        <p className="text-[13px] text-slate-600">{row.raw?.dropLabel || '--'}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-4">
                                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">Fare Breakdown</h3>
                                  <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
                                    <div className="flex justify-between items-center text-[13px] text-slate-600">
                                      <span>Base Fare</span>
                                      <span className="font-bold">₹{(row.raw?.baseFare || 0).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[13px] text-slate-600">
                                      <span>Wait Time Charge</span>
                                      <span className="font-bold text-amber-500">₹{(row.raw?.waitingChargeAmount || 0).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[13px] text-slate-600">
                                      <span>Time Charge</span>
                                      <span className="font-bold">₹{(row.raw?.timeChargeAmount || 0).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[13px] text-slate-600">
                                      <span>Distance Charge</span>
                                      <span className="font-bold">₹{(row.raw?.distanceChargeAmount || 0).toFixed(2)}</span>
                                    </div>
                                    {row.raw?.recovered_cancellation_due > 0 && (
                                      <div className="flex justify-between items-center text-[13px] text-red-500">
                                        <span>Previous Cancellation Due</span>
                                        <span className="font-bold">₹{Number(row.raw.recovered_cancellation_due).toFixed(2)}</span>
                                      </div>
                                    )}
                                    <div className="pt-2 mt-2 border-t border-slate-100 flex justify-between items-center text-[15px] font-black text-slate-900">
                                      <span>Total Payable</span>
                                      <span>₹{(Number(row.raw?.fare || 0) + Number(row.raw?.recovered_cancellation_due || 0)).toFixed(2)}</span>
                                    </div>
                                  </div>
                                </div>
                                {row.tripStatus === 'CANCELLED' && (
                                  <div className="space-y-4">
                                    <h3 className="text-[11px] font-black uppercase tracking-wider text-rose-500">Cancellation Details</h3>
                                    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2 text-[13px] text-slate-600">
                                      <div className="flex justify-between items-center">
                                        <span>Cancelled By</span>
                                        <span className="font-bold text-slate-800 capitalize">{row.raw?.cancelled_by || 'User'}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span>Reason</span>
                                        <span className="font-bold text-slate-800">{row.raw?.cancellation_reason || 'N/A'}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span>Cancellation Time</span>
                                        <span className="font-bold text-slate-800">{formatDate(row.raw?.cancellation_time || row.date)}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span>Status at Cancellation</span>
                                        <span className="font-bold text-slate-800">{row.raw?.liveStatus || row.raw?.rideStatus || 'N/A'}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span>Free Cancellation?</span>
                                        <span className="font-bold text-slate-800">{Number(row.raw?.cancellation_charge || 0) === 0 ? 'Yes' : 'No'}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span>Cancellation Fee</span>
                                        <span className="font-bold text-red-500">₹{(row.raw?.cancellation_charge || 0).toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between items-center">
                                        <span>Status</span>
                                        <span className={`font-bold ${row.raw?.cancellation_status === 'recovered' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                          {row.raw?.cancellation_status === 'recovered' ? 'Recovered' : 'Pending'}
                                        </span>
                                      </div>
                                      {row.raw?.cancellation_status === 'recovered' && (
                                        <>
                                          <div className="flex justify-between items-center">
                                            <span>Recovery Ride ID</span>
                                            <span className="font-bold text-indigo-600">{row.raw?.recovered_in_ride ? `REQ_${String(row.raw?.recovered_in_ride).slice(-12).toUpperCase()}` : 'N/A'}</span>
                                          </div>
                                          <div className="flex justify-between items-center">
                                            <span>Recovery Time</span>
                                            <span className="font-bold text-slate-800">{formatDate(row.raw?.recovered_at)}</span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-[14px] font-medium text-slate-400">
                      No ride requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <button className="fixed bottom-10 right-10 w-14 h-14 bg-[#00BFA5] text-white rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform z-50">
            <Menu size={24} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Trips;
