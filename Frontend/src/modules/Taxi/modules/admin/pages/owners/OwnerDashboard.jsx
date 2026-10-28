import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, 
  Car, 
  UserCheck, 
  Clock, 
  IndianRupee, 
  Wallet, 
  CreditCard, 
  FileText, 
  TrendingUp,
  ChevronRight,
  Monitor,
  AlertTriangle
} from 'lucide-react';
import { motion } from 'framer-motion';
import AdminPageHeader from '../../components/ui/AdminPageHeader';
import { adminService } from '../../services/adminService';

const StatCard = ({ icon: Icon, label, value, color, onViewAll }) => (
  <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
    <div className="flex items-center gap-4">
      <div className={`w-12 h-12 ${color.bg} ${color.text} rounded-lg flex items-center justify-center`}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-black text-gray-900 mt-0.5">{value}</p>
      </div>
    </div>
    <button 
      onClick={onViewAll}
      className="text-[10px] font-bold text-indigo-600 hover:underline uppercase tracking-tighter"
    >
      View All
    </button>
  </div>
);

const FinanceCard = ({ icon: Icon, label, value, color }) => (
  <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-black text-gray-900 mt-1">₹ {value}</p>
    </div>
    <div className={`w-10 h-10 ${color.bg} ${color.text} rounded-lg flex items-center justify-center`}>
      <Icon size={20} />
    </div>
  </div>
);

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const [data, setData] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const resData = await adminService.getOwnerDashboard();
        
        if (resData && resData.success) {
          setData(resData.data || resData);
        } else {
          setError(resData?.message || 'Failed to fetch dashboard');
        }
      } catch (err) {
        const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
        setError(errMsg || 'Network error');
      } finally {
        setIsLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-10 h-10 border-4 border-gray-100 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest leading-none">Fetching Owner Insights...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
          <AlertTriangle size={24} />
        </div>
        <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Dashboard Error</h3>
        <p className="text-xs font-semibold text-rose-600 max-w-xs">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all active:scale-95"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const stats = [
    { icon: Users, label: 'Registered Owners', value: data?.total_owners || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' }, path: '/taxi/admin/owners' },
    { icon: UserCheck, label: 'Approved Owners', value: data?.approved_owners || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' }, path: '/taxi/admin/owners' },
    { icon: Clock, label: 'Owner Awaiting Review', value: data?.pending_owners || 0, color: { bg: 'bg-red-50', text: 'text-red-500' }, path: '/taxi/admin/owners' },
    // { icon: Car, label: 'Registered Fleets', value: data?.total_fleets || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' }, path: '/taxi/admin/owners/fleet' },
    // { icon: Monitor, label: 'Approved Fleets', value: data?.approved_fleets || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' }, path: '/taxi/admin/owners/fleet' },
    // { icon: Car, label: 'Fleets Awaiting Review', value: data?.pending_fleets || 0, color: { bg: 'bg-red-50', text: 'text-red-500' }, path: '/taxi/admin/owners/fleet' },
    { icon: Monitor, label: 'Registered Drivers', value: data?.total_drivers || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' }, path: '/taxi/admin/drivers' },
    { icon: UserCheck, label: 'Approved Drivers', value: data?.approved_drivers || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' }, path: '/taxi/admin/drivers' },
    { icon: Clock, label: 'Drivers Awaiting Review', value: data?.pending_drivers || 0, color: { bg: 'bg-red-50', text: 'text-red-500' }, path: '/taxi/admin/drivers/pending' },
  ];

  const finances = [
    { icon: FileText, label: 'Today Earnings', value: data?.today_earnings || 0, color: { bg: 'bg-sky-50', text: 'text-sky-500' } },
    { icon: Monitor, label: 'By Cash', value: data?.today_cash || 0, color: { bg: 'bg-emerald-50', text: 'text-emerald-500' } },
    { icon: Wallet, label: 'By Wallet', value: data?.today_wallet || 0, color: { bg: 'bg-amber-50', text: 'text-amber-500' } },
    { icon: CreditCard, label: 'By Card/Online', value: data?.today_online || 0, color: { bg: 'bg-red-50', text: 'text-red-500' } },
    { icon: FileText, label: 'Admin Commission', value: data?.admin_commission || 0, color: { bg: 'bg-slate-50', text: 'text-slate-500' } },
    { icon: Monitor, label: 'Drivers Earnings', value: data?.driver_earnings || 0, color: { bg: 'bg-gray-50', text: 'text-gray-500' } },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 lg:p-8">
        <AdminPageHeader module="Owner Management" page="Owner Dashboard" title="Owner Dashboard" />

        {/* Stats Grid */}
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stats.map((stat, i) => (
              <StatCard 
                key={i} 
                {...stat} 
                onViewAll={() => navigate(stat.path)}
              />
            ))}
          </div>

          {/* Charts & Finance Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Today Trips Chart Placeholder */}
            <div className="lg:col-span-1 bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col">
               <p className="text-[12px] font-bold text-gray-900 uppercase tracking-widest mb-10">Today Trips</p>
               <div className="flex-1 flex flex-col items-center justify-center relative min-h-[250px]">
                  <div className="w-48 h-48 border-[12px] border-gray-50 rounded-full flex flex-col items-center justify-center">
                     <p className="text-3xl font-black text-gray-200">0</p>
                     <p className="text-[10px] font-bold text-gray-400 uppercase">Total Rides</p>
                  </div>
                  <div className="mt-8 w-full space-y-3">
                     <div className="flex items-center justify-between px-4">
                        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-indigo-600"></div><span className="text-[11px] font-bold text-gray-500">Completed Rides</span></div>
                        <span className="text-[11px] font-black text-gray-900">0</span>
                     </div>
                     <div className="flex items-center justify-between px-4">
                        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500"></div><span className="text-[11px] font-bold text-gray-500">Cancelled Rides</span></div>
                        <span className="text-[11px] font-black text-gray-900">0</span>
                     </div>
                     <div className="flex items-center justify-between px-4">
                        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-sky-500"></div><span className="text-[11px] font-bold text-gray-500">Scheduled Rides</span></div>
                        <span className="text-[11px] font-black text-gray-900">0</span>
                     </div>
                  </div>
               </div>
            </div>

            {/* Finance Stats */}
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
               {finances.map((fin, i) => (
                 <FinanceCard key={i} {...fin} />
               ))}
            </div>
          </div>

          {/* Bottom row: Earnings Overview & Overall Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             {/* More Finance Grid */}
             <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <FinanceCard icon={TrendingUp} label="Overall Earnings" value={data?.overall_earnings || 0} color={{ bg: 'bg-red-50', text: 'text-red-500' }} />
                <FinanceCard icon={Monitor} label="By Cash" value={data?.overall_cash || 0} color={{ bg: 'bg-amber-50', text: 'text-amber-500' }} />
                <FinanceCard icon={Wallet} label="By Wallet" value={data?.overall_wallet || 0} color={{ bg: 'bg-emerald-50', text: 'text-emerald-500' }} />
                <FinanceCard icon={CreditCard} label="By Card/Online" value={data?.overall_online || 0} color={{ bg: 'bg-sky-50', text: 'text-sky-500' }} />
                <FinanceCard icon={FileText} label="Admin Commission" value={data?.overall_admin_comm || 0} color={{ bg: 'bg-gray-50', text: 'text-gray-500' }} />
                <FinanceCard icon={FileText} label="Owner Earnings" value={data?.overall_owner_earnings || 0} color={{ bg: 'bg-slate-50', text: 'text-slate-500' }} />
             </div>

             {/* Chart Placeholder */}
             <div className="lg:col-span-1 bg-white p-6 rounded-xl border border-gray-100 shadow-sm">
                <p className="text-[12px] font-bold text-gray-900 uppercase tracking-widest mb-6">Overall Earnings</p>
                <div className="h-48 flex items-end justify-between gap-2 px-2 relative border-b-2 border-gray-100">
                   <div className="flex-1 bg-emerald-500/10 h-0.5 rounded-t-sx transition-all"></div>
                   <div className="flex-1 bg-emerald-500/10 h-0.5 rounded-t-sx transition-all"></div>
                   <div className="flex-1 bg-emerald-500/10 h-0.5 rounded-t-sx transition-all"></div>
                   
                   {/* Values axis */}
                   <div className="absolute left-[-20px] top-0 bottom-0 flex flex-col justify-between text-[8px] font-bold text-gray-300">
                      <span>2</span><span>1.6</span><span>1.2</span><span>0.8</span><span>0.4</span><span>0</span>
                   </div>
                </div>
                <div className="flex justify-between mt-4 px-2">
                   <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">January</span>
                   <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">February</span>
                   <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">March</span>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OwnerDashboard;

