import React from 'react';
import { Filter, MoreVertical, Search, Loader2, ChevronRight, Menu, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { adminService } from '../../services/adminService';

const STATUS_STYLES = {
  ACCEPTED: 'bg-[#10B981] text-white', // Emerald/Green from image
  UPCOMING: 'bg-[#F59E0B] text-white', // Amber from image
  ONGOING: 'bg-[#3B82F6] text-white', 
};

const PAYMENT_STYLES = {
  CASH: 'bg-[#F97316] text-white', // Orange from image
  CARD: 'bg-red-500 text-white',
  WALLET: 'bg-teal-500 text-white',
};

const TAB_SET = ['All', 'Accepted', 'Upcoming', 'Ongoing'];

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
};

const Ongoing = () => {
  const [activeTab, setActiveTab] = React.useState('All');
  const [search, setSearch] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const loadRows = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminService.getOngoingRides({
        limit,
        tab: activeTab.toLowerCase(),
        search,
      });
      const data = response?.data?.data || response?.data || response;
      setRows(data?.results || []);
    } catch (err) {
      setError(err?.message || 'Failed to load ongoing rides');
    } finally {
      setLoading(false);
    }
  }, [activeTab, limit, search]);

  React.useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleDelete = async (ride) => {
    const confirmed = window.confirm(`Delete ride ${ride.requestId}? This will remove it for both rider and driver.`);
    if (!confirmed) return;
    try {
      await adminService.deleteOngoingRide(ride.id);
      setRows((prev) => prev.filter((row) => row.id !== ride.id));
    } catch (err) {
      window.alert(err?.message || 'Failed to delete ride');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <div className="p-4 space-y-4">
        {/* Header Block exactly as image */}
        <div className="flex items-center justify-between px-4 py-2 bg-white rounded-t-xl">
           <h1 className="text-[20px] font-black tracking-tight text-slate-800 uppercase">ONGOING REQUESTS</h1>
           <div className="flex items-center gap-2 text-[12px] font-medium text-slate-400">
              <span>Ongoing Requests</span>
              <ChevronRight size={14} className="text-slate-300" />
              <span className="text-slate-500">Ongoing Requests</span>
           </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm relative">
          {/* Top Controls Area */}
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

            <div className="flex flex-1 justify-center items-center gap-8">
              {TAB_SET.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative py-1 text-[15px] font-bold transition-all ${
                    activeTab === tab ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab}
                  {activeTab === tab && (
                    <motion.div layoutId="ongoing-tab" className="absolute -bottom-3 left-0 right-0 h-0.5 bg-indigo-600" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button className="w-10 h-10 border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:bg-gray-50">
                <Search size={18} />
              </button>
              <button className="flex items-center gap-2 px-5 py-2.5 bg-[#f46b45] text-white rounded-lg text-[13px] font-bold shadow-sm">
                <Filter size={16} /> Filters
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  {['Request Id', 'Date', 'User Name', 'Driver Name', 'Transport Type', 'Trip Status', 'Payment Option', 'Action'].map((h) => (
                    <th key={h} className="px-6 py-4 text-[13px] font-bold text-slate-900 border-b border-slate-100">
                      {h}
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
                ) : rows.length > 0 ? (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/30">
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.requestId}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{formatDate(row.date)}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.userName}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.driverName || '----'}</td>
                      <td className="px-6 py-5 text-[14px] text-slate-600 font-medium">{row.transportType}</td>
                      <td className="px-6 py-5">
                        <span className={`inline-block px-3 py-1 text-[10px] font-bold rounded uppercase ${STATUS_STYLES[row.tripStatus] || 'bg-slate-200 text-slate-700'}`}>
                          {row.tripStatus}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`inline-block px-3 py-1 text-[10px] font-bold rounded uppercase ${PAYMENT_STYLES[row.paymentOption] || 'bg-primary-orange/50 text-white'}`}>
                          {row.paymentOption || 'CASH'}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                         <div className="flex items-center gap-3">
                           <button onClick={() => handleDelete(row)} className="text-rose-400 hover:text-rose-600">
                             <Trash2 size={16} />
                           </button>
                           <button className="text-slate-400 hover:text-slate-800">
                             <MoreVertical size={18} />
                           </button>
                         </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-20 text-center text-[14px] font-medium text-slate-400">
                      No Ongoing Requests Found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Floating Action Button from image */}
          <button className="fixed bottom-10 right-10 w-14 h-14 bg-[#00BFA5] text-white rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform z-50">
            <Menu size={24} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Ongoing;
