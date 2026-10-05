import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Download, 
  ChevronRight, 
  Calendar,
  Layers,
  ArrowUpRight,
  TrendingUp,
  MapPin,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import { motion } from 'framer-motion';
import { adminService } from '../../services/adminService';
import { triggerFileDownload } from '../../../../shared/utils/downloadHelper';

const FleetFinanceReport = () => {
  const [filters, setFilters] = useState({
    fleet_id: '',
    trip_status: 'completed',
    date_option: '',
    file_format: ''
  });

  const [fleets, setFleets] = useState([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalFleetRevenue: 0, activeFleets: 0, performance: 0 });

  useEffect(() => {
    const fetchFleetMeta = async () => {
      try {
        const [locationsRes, statsRes] = await Promise.all([
          adminService.getServiceLocations(),
          adminService.getDashboardData()
        ]);

        if (locationsRes.success) {
          setFleets(locationsRes.data?.results || locationsRes.data || []);
        }
        
        if (statsRes.success) {
          setStats({
            totalFleetRevenue: statsRes.data?.total_fleet_earnings || 0,
            activeFleets: locationsRes.data?.length || 0,
            performance: statsRes.data?.performance_index || 94.8
          });
        }
      } catch (err) {
        console.error('Error fetching fleet report data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchFleetMeta();
  }, []);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await adminService.downloadFleetFinanceReport(filters);

      const success = triggerFileDownload(response, `fleet_finance_${Date.now()}`, filters.file_format);
      if (success) {
        alert('Fleet Finance report downloaded successfully!');
      } else {
        throw new Error('Download trigger failure');
      }
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to generate report. Please select a Fleet/Location and Date Option.');
    } finally {
      setIsDownloading(false);
    }
  };

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const isFormValid = filters.fleet_id && filters.date_option && filters.file_format;

  return (
    <div className="min-h-screen bg-[#F8F9FA] p-4 md:p-8 font-sans text-gray-950">
      {/* Breadcrumbs & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight uppercase mb-2">Fleet Finance Report</h1>
          <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <span className="hover:text-primary cursor-pointer transition-colors">fleet_report</span>
            <ChevronRight size={12} strokeWidth={4} />
            <span className="text-primary italic border-b-2 border-primary/20">Fleet Finance Report</span>
          </div>
        </div>
      </div>

      {/* Filter Card */}
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[40px] border border-gray-100 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.05)] overflow-hidden"
      >
        <div className="p-8 md:p-14">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
            {/* Fleet Id (Service Locations) */}
            <div className="space-y-4">
              <label className="text-[12px] font-black text-gray-400 uppercase tracking-widest pl-1">
                Fleet Id <span className="text-red-500">*</span>
              </label>
              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors">
                  <Layers size={18} />
                </div>
                <select 
                  value={filters.fleet_id}
                  onChange={(e) => updateFilter('fleet_id', e.target.value)}
                  className="w-full pl-16 pr-8 py-4.5 bg-gray-50 border-2 border-transparent focus:border-primary/10 focus:bg-white rounded-2xl text-[14px] font-bold text-gray-950 outline-none transition-all appearance-none cursor-pointer"
                >
                  <option value="">Select</option>
                  {fleets.map(f => (
                    <option key={f._id} value={f._id}>{f.name}</option>
                  ))}
                </select>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-gray-300">
                  <ChevronRight size={18} className="rotate-90" />
                </div>
              </div>
            </div>

            {/* Trip Status (Radio Buttons) */}
            <div className="space-y-4">
              <label className="text-[12px] font-black text-gray-400 uppercase tracking-widest pl-1">
                Trip Status
              </label>
              <div className="flex items-center gap-10 py-3.5 px-1">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input 
                      type="radio" 
                      name="trip_status" 
                      value="completed" 
                      checked={filters.trip_status === 'completed'}
                      onChange={(e) => updateFilter('trip_status', e.target.value)}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 rounded-full border-2 border-gray-200 peer-checked:border-primary peer-checked:shadow-[0_0_0_4px_rgba(255,107,0,0.1)] transition-all"></div>
                    <div className="absolute w-2.5 h-2.5 rounded-full bg-primary scale-0 peer-checked:scale-100 transition-transform"></div>
                  </div>
                  <span className="text-[14px] font-bold text-gray-700 group-hover:text-primary transition-colors">Completed</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input 
                      type="radio" 
                      name="trip_status" 
                      value="cancelled" 
                      checked={filters.trip_status === 'cancelled'}
                      onChange={(e) => updateFilter('trip_status', e.target.value)}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 rounded-full border-2 border-gray-200 peer-checked:border-primary peer-checked:shadow-[0_0_0_4px_rgba(255,107,0,0.1)] transition-all"></div>
                    <div className="absolute w-2.5 h-2.5 rounded-full bg-primary scale-0 peer-checked:scale-100 transition-transform"></div>
                  </div>
                  <span className="text-[14px] font-bold text-gray-700 group-hover:text-primary transition-colors">Cancelled</span>
                </label>
              </div>
            </div>

            {/* Date Option */}
            <div className="space-y-4">
              <label className="text-[12px] font-black text-gray-400 uppercase tracking-widest pl-1">
                Date Option <span className="text-red-500">*</span>
              </label>
              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors">
                  <Calendar size={18} />
                </div>
                <select 
                  value={filters.date_option}
                  onChange={(e) => updateFilter('date_option', e.target.value)}
                  className="w-full pl-16 pr-8 py-4.5 bg-gray-50 border-2 border-transparent focus:border-primary/10 focus:bg-white rounded-2xl text-[14px] font-bold text-gray-950 outline-none transition-all appearance-none cursor-pointer"
                >
                  <option value="">Select</option>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last_7_days">Last 7 Days</option>
                  <option value="this_month">This Month</option>
                  <option value="last_month">Last Month</option>
                  <option value="this_year">This Year</option>
                </select>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-gray-300">
                  <ChevronRight size={18} className="rotate-90" />
                </div>
              </div>
            </div>

            {/* File Format */}
            <div className="space-y-4">
              <label className="text-[12px] font-black text-gray-400 uppercase tracking-widest pl-1">
                File Format <span className="text-red-500">*</span>
              </label>
              <div className="relative group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors">
                  <FileText size={18} />
                </div>
                <select 
                  value={filters.file_format}
                  onChange={(e) => updateFilter('file_format', e.target.value)}
                  className="w-full pl-16 pr-8 py-4.5 bg-gray-50 border-2 border-transparent focus:border-primary/10 focus:bg-white rounded-2xl text-[14px] font-bold text-gray-950 outline-none transition-all appearance-none cursor-pointer"
                >
                  <option value="">Select File Format</option>
                  <option value="csv">CSV Spreadsheet</option>
                  <option value="xlsx">Excel File</option>
                  <option value="pdf">PDF Report</option>
                </select>
                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-gray-300">
                  <ChevronRight size={18} className="rotate-90" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-12 border-t border-gray-50 mt-10">
            <button 
              onClick={handleDownload}
              disabled={!isFormValid || isDownloading}
              className={`flex items-center gap-4 px-14 py-5 rounded-[24px] font-black text-[14px] uppercase tracking-widest transition-all duration-500 ${
                (!isFormValid || isDownloading)
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed grayscale'
                : 'bg-primary text-white shadow-[0_25px_50px_-12px_rgba(255,107,0,0.25)] hover:scale-[1.03] active:scale-[0.97] hover:shadow-[0_30px_60px_-12px_rgba(255,107,0,0.35)]'
              }`}
            >
              {isDownloading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <Download size={20} strokeWidth={3} />
              )}
              {isDownloading ? 'DOWNLOADING...' : 'Download'}
            </button>
          </div>
        </div>
      </motion.div>

      {/* Fleet Stats Overview */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex flex-col justify-between group">
           <div>
              <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                 <MapPin size={24} />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Fleet Deployment</p>
              <p className="text-3xl font-black text-gray-900">{loading ? '...' : stats.activeFleets} Cities</p>
           </div>
           <div className="mt-6 pt-6 border-t border-gray-50 flex items-center justify-between">
              <span className="text-[12px] font-bold text-gray-400">Total Markets</span>
              <CheckCircle2 size={16} className="text-emerald-500" />
           </div>
        </div>

        <div className="bg-gray-950 p-8 rounded-[40px] shadow-2xl flex flex-col justify-between group relative overflow-hidden">
           <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-125 transition-transform duration-700">
              <TrendingUp size={120} className="text-white" />
           </div>
           <div>
              <div className="w-12 h-12 bg-white/10 text-white rounded-2xl flex items-center justify-center mb-6">
                 <ArrowUpRight size={24} />
              </div>
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Fleet Revenue</p>
              <p className="text-3xl font-black text-white">₹{loading ? '...' : stats.totalFleetRevenue.toLocaleString()}</p>
           </div>
           <div className="mt-6 flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-black rounded uppercase tracking-tighter shadow-lg shadow-emerald-500/30">+12%</span>
              <span className="text-[11px] font-bold text-gray-500 whitespace-nowrap">vs Previous Quarter</span>
           </div>
        </div>

        <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm flex flex-col justify-between group">
           <div>
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-amber-500 group-hover:text-white transition-all">
                 <Clock size={24} />
              </div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Performance Index</p>
              <p className="text-3xl font-black text-gray-900">{loading ? '...' : stats.performance}%</p>
           </div>
           <div className="mt-6 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className={`h-1 flex-1 rounded-full ${i <= 4 ? 'bg-amber-400' : 'bg-gray-100'}`}></div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
};

export default FleetFinanceReport;
