import React, { useState, useEffect } from 'react';
import { 
  Users, 
  ArrowUpRight, 
  ChevronRight,
  TrendingUp,
  Activity,
  ArrowRight,
  UserCheck,
  Zap,
  IndianRupee,
  MoreVertical,
  Loader2
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';
import { useSettings } from '../../../../shared/context/SettingsContext';

const StatCard = ({ title, value, change, icon: Icon, color }) => (
  <div className="bg-white rounded-lg p-6 border border-gray-100 shadow-sm flex flex-col justify-between h-full group hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between">
      <div className="flex flex-col">
        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1">{title}</p>
        <h3 className="text-2xl font-black text-gray-900 leading-none">{value}</h3>
      </div>
      <div className={`p-2 rounded-lg bg-gray-50 text-gray-400 group-hover:text-indigo-600 transition-colors`}>
        <Icon size={20} />
      </div>
    </div>
    <div className="mt-4 flex items-center gap-1.5">
       <div className="flex items-center gap-0.5 text-emerald-500 font-bold text-[12px]">
          <ArrowUpRight size={14} /> 
          <span>{change}%</span>
       </div>
    </div>
  </div>
);

const ChartContainer = ({ title, children, fullWidth }) => (
  <div className={`bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden flex flex-col ${fullWidth ? 'col-span-12' : 'col-span-12 lg:col-span-6'}`}>
    <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
      <h3 className="text-[12px] font-black text-gray-900 uppercase tracking-widest">
        {title}
      </h3>
    </div>
    <div className="p-8 flex-1 min-h-[300px]">
      {children}
    </div>
  </div>
);

const PieChartMock = ({ color1, color2, label1, label2, val1, val2 }) => {
  const total = (val1 + val2) || 1;
  const p1 = (val1 / total) * 100;
  
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="relative w-48 h-48 rounded-full flex items-center justify-center border-[20px] border-gray-50 overflow-hidden">
         <div 
           className="absolute inset-0 rounded-full border-[20px]" 
           style={{ 
             borderColor: color1, 
             clipPath: `polygon(50% 50%, 50% 0%, ${p1 > 50 ? '100% 0%, 100% 100%, 0% 100%, 0% 0%,' : ''} ${50 + 50 * Math.sin(2 * Math.PI * (p1/100))}% ${50 - 50 * Math.cos(2 * Math.PI * (p1/100))}%)` 
           }} 
         />
         <div className="text-center z-10">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label1}</p>
            <p className="text-2xl font-black text-gray-900 mt-1">{val1 || 0}</p>
         </div>
      </div>
      <div className="mt-8 flex items-center gap-6">
         <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full`} style={{ backgroundColor: color1 }}></div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{label1}</span>
         </div>
         <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full`} style={{ backgroundColor: color2 }}></div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{label2}</span>
         </div>
      </div>
    </div>
  );
};

const LineChartMock = ({ color, data }) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const maxVal = Math.max(...data, 2) || 2;

  return (
    <div className="w-full h-full flex flex-col justify-between">
      <div className="flex-1 flex items-end justify-between gap-1 relative pt-4">
         {/* Grid Lines */}
         <div className="absolute inset-x-0 top-0 h-px bg-gray-50"></div>
         <div className="absolute inset-x-0 bottom-0 h-px bg-gray-100"></div>
         <div className="absolute inset-x-0 top-1/2 h-px bg-gray-50"></div>
         
         {/* Bars representing line points for simplicity/cleanliness */}
         {data.map((val, i) => (
            <div key={i} className="flex-1 flex flex-col items-center group relative h-full justify-end">
               <div 
                 className="w-1 bg-gray-100 absolute inset-y-0 left-1/2 -translate-x-1/2 z-0 opacity-0 group-hover:opacity-100 transition-opacity"
               ></div>
               <div 
                 className="w-full rounded-t-sm transition-all duration-700 relative z-10"
                 style={{ 
                   height: `${(val / maxVal) * 100}%`,
                   backgroundColor: val > 0 ? color : '#F3F4F6',
                   minHeight: val > 0 ? '4px' : '2px'
                 }}
               ></div>
            </div>
         ))}
      </div>
      <div className="flex items-center justify-between mt-6 px-1">
         {months.map(m => (
           <span key={m} className="text-[9px] font-bold text-gray-400 uppercase">{m}</span>
         ))}
      </div>
    </div>
  );
};

const ReferralDashboard = () => {
  const { settings } = useSettings();
  const appName = settings.general?.app_name || 'App';
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await adminService.getReferralDashboard();
        if (res.data) {
          setData(res.data);
        }
      } catch (err) {
        console.error("Dashboard fetch error:", err);
        toast.error('Failed to load dashboard data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/10">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin text-indigo-600" size={32} />
          <span className="text-sm text-gray-500 font-medium">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  // Monthly data defaults
  const emptyMonthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 font-sans text-gray-900 pb-20">
      {/* BREADCRUMB & TITLE */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-[11px] font-black tracking-[0.2em] text-gray-950 uppercase">REFERRAL DASHBOARD</h1>
        <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400">
           <span>Referral Dashboard</span>
           <ChevronRight size={12} />
           <span className="text-gray-950">Referral Dashboard</span>
        </div>
      </div>

      {/* TOP CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="TOTAL DRIVERS" 
          value={data?.total_drivers || "0"} 
          change="0" 
          icon={Users} 
        />
        <StatCard 
          title="TOTAL USERS" 
          value={data?.total_users || "0"} 
          change="0" 
          icon={UserCheck} 
        />
        <StatCard 
          title="ACTIVE REFERRALS" 
          value={data?.active_referrals || "0"} 
          change="0" 
          icon={Zap} 
        />
        <StatCard 
          title="REFERRAL EARNING" 
          value={data?.referral_earning ? `₹ ${data.referral_earning}` : "₹ 0"} 
          change="0" 
          icon={IndianRupee} 
        />
      </div>

      {/* USER REFERRALS SECTION */}
      <div className="space-y-6 mt-10">
         <div className="bg-white border border-gray-100 px-6 py-4 rounded-lg shadow-sm">
            <h2 className="text-[12px] font-black text-gray-900 uppercase tracking-widest">User Referrals Overview</h2>
         </div>
         <div className="grid grid-cols-12 gap-6">
            <ChartContainer title="User Referrals Overview">
               <PieChartMock 
                 color1="#2563EB" 
                 color2="#FBBF24" 
                 label1="Normal User" 
                 label2="Referral User" 
                 val1={data?.user_referrals?.normal_user || 0}
                 val2={data?.user_referrals?.referral_user || 0}
               />
            </ChartContainer>
            <ChartContainer title="User Referrals Overview">
               <LineChartMock 
                 color="#059669" 
                 data={data?.user_referrals?.monthly || emptyMonthly} 
               />
            </ChartContainer>
         </div>
      </div>

      {/* DRIVER REFERRALS SECTION */}
      <div className="space-y-6 mt-10">
         <div className="bg-white border border-gray-100 px-6 py-4 rounded-lg shadow-sm">
            <h2 className="text-[12px] font-black text-gray-900 uppercase tracking-widest">Driver Referrals Overview</h2>
         </div>
         <div className="grid grid-cols-12 gap-6">
            <ChartContainer title="Driver Referrals Overview">
               <PieChartMock 
                 color1="#7C3AED" 
                 color2="#10B981" 
                 label1="Normal Driver" 
                 label2="Referral Driver" 
                 val1={data?.driver_referrals?.normal_driver || 0}
                 val2={data?.driver_referrals?.referral_driver || 0}
               />
            </ChartContainer>
            <ChartContainer title="Driver Referrals Overview">
               <LineChartMock 
                 color="#0EA5E9" 
                 data={data?.driver_referrals?.monthly || emptyMonthly} 
               />
            </ChartContainer>
         </div>
      </div>

      {/* FOOTER */}
      <footer className="mt-20 flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100 pt-6">
         <div>2026 © {appName}.</div>
         <div>Design & Develop by {appName}</div>
         <div>App version 2.3</div>
      </footer>
    </div>
  );
};

export default ReferralDashboard;

