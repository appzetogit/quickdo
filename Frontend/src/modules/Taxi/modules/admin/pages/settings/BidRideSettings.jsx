import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  Save, 
  Loader2,
  ChevronUp,
  Info,
  Smartphone,
  CheckCircle2,
  Percent
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

const SectionHeader = ({ title }) => (
  <div className="bg-slate-50 border-l-4 border-indigo-600 p-4 mb-4 rounded-r-lg shadow-sm">
    <h3 className="text-[14px] font-bold text-slate-700 uppercase tracking-wide">{title}</h3>
  </div>
);

const InputField = ({ label, name, value, onChange, placeholder, type = "text", helpLink, prefix }) => (
  <div className="space-y-1.5 w-full">
    <div className="flex items-center justify-between">
       <label className="text-[13px] font-bold text-slate-600 block ml-0.5">
         {label} {helpLink && <span className="text-red-500">*</span>}
       </label>
       {helpLink && (
         <button className="text-emerald-500 text-[11px] font-black hover:underline flex items-center gap-1">
            How It Works <Info size={12} />
         </button>
       )}
    </div>
    <div className="relative group">
       {prefix && (
         <div className="absolute left-0 top-0 bottom-0 w-12 bg-slate-50 border border-slate-200 border-r-0 rounded-l-lg flex items-center justify-center text-slate-400 font-bold group-focus-within:border-indigo-500">
            {prefix}
         </div>
       )}
       <input
         type={type}
         name={name}
         value={value || ''}
         onChange={(e) => onChange(name, e.target.value)}
         placeholder={placeholder}
         className={`w-full bg-white border border-slate-200 rounded-lg py-3 ${prefix ? 'pl-16' : 'px-4'} text-[14px] text-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none`}
       />
    </div>
  </div>
);

const PreviewBox = ({ label }) => (
  <div className="w-full h-full flex items-center justify-center p-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 group overflow-hidden relative">
     <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1 bg-white/80 backdrop-blur-sm rounded-full shadow-sm">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
        <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{label} Preview</span>
     </div>
     <div className="w-[280px] bg-white rounded-[40px] shadow-2xl p-6 border-8 border-slate-900 aspect-[9/16] relative transition-transform group-hover:scale-[1.02] duration-500">
        <div className="w-20 h-1.5 bg-slate-100 rounded-full mx-auto mb-10"></div>
        
        <div className="mb-6">
           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">SUV (BID)</p>
           <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <div className="h-1 bg-slate-100 rounded-full flex-1"></div>
           </div>
           <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary-orange/50"></div>
              <div className="h-1 bg-slate-100 rounded-full flex-1"></div>
           </div>
        </div>

        <div className="bg-slate-50 rounded-2xl p-4 text-center border border-slate-100 mb-6">
           <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-1">Offer Your Fare</h4>
           <p className="text-[9px] text-slate-400 mb-4 italic">Recommended fare: $ 150.00</p>
           <div className="flex items-center justify-between gap-1 mb-8">
              <button className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold">-10</button>
              <div className="flex-1 bg-white border border-slate-200 rounded-xl flex items-center justify-center font-black text-slate-800 py-2.5">150</div>
              <button className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold">+10</button>
           </div>
           <button className="w-full bg-emerald-500 text-white py-3 rounded-xl font-black text-[12px] shadow-lg shadow-emerald-500/30">Create Request</button>
        </div>
        
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
           <div className="w-24 h-1 rounded-full bg-slate-100 italic"></div>
        </div>
     </div>
  </div>
);

const BidRideSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/general-settings/bid-ride');
      setSettings(res.data?.settings || {});
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load bidding parameters');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdate = async () => {
    try {
      setSaving(true);
      await api.patch('/admin/general-settings/bid-ride', { settings });
      toast.success('Bidding logic updated!', {
        icon: <CheckCircle2 className="text-emerald-500" />,
        style: { background: '#111827', color: '#fff' }
      });
    } catch (err) {
      console.error('Update error:', err);
      toast.error('Failed to save bidding parameters');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (name, value) => {
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest italic">Recalibrating Bidding Logic...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      <div className="max-w-[1600px] mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-700 pb-32">
        
        {/* Header Breadcrumb */}
        <div className="flex items-center justify-between mb-2">
           <div></div>
           <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400">
             <span>Pricing Flow Settings</span>
             <ChevronRight size={14} />
             <span className="text-indigo-600">Bid Ride Settings</span>
           </div>
        </div>

        {/* Driver Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
           <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col justify-between">
              <div>
                 <SectionHeader title="Driver" />
                 <div className="space-y-6 mt-6">
                    <InputField 
                       label="Driver Bidding Low Percentage (Least Bid Level)" 
                       name="bidding_low_percentage" 
                       value={settings.bidding_low_percentage} 
                       onChange={handleChange} 
                       type="number" 
                       prefix="%"
                       helpLink
                    />
                    <InputField 
                       label="Driver Bidding High Percentage (Highest Bid Level)" 
                       name="bidding_high_percentage" 
                       value={settings.bidding_high_percentage} 
                       onChange={handleChange} 
                       type="number" 
                       prefix="%"
                       helpLink
                    />
                    <InputField 
                       label="Driver Bid Range From Recommended Price" 
                       name="bidding_amount_increase_or_decrease" 
                       value={settings.bidding_amount_increase_or_decrease} 
                       onChange={handleChange} 
                       type="number" 
                       helpLink
                    />
                 </div>
              </div>
              <div className="mt-12 flex justify-end">
                 <button 
                  onClick={handleUpdate}
                  disabled={saving}
                  className="bg-[#405189] text-white px-8 py-3 rounded-lg text-[13px] font-black shadow-xl flex items-center gap-3 hover:bg-[#344475] active:scale-95 transition-all disabled:opacity-50"
                 >
                   {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                   Update
                 </button>
              </div>
           </div>
           <PreviewBox label="Driver App" />
        </div>

        {/* User Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col justify-between">
              <div>
                 <SectionHeader title="User" />
                 <div className="space-y-6 mt-6">
                    <InputField 
                       label="User Fare Low Percentage (Starting Level)" 
                       name="user_bidding_low_percentage" 
                       value={settings.user_bidding_low_percentage} 
                       onChange={handleChange} 
                       type="number" 
                       prefix="%"
                       helpLink
                    />
                    <InputField 
                       label="User Fare High Percentage (Highest Level)" 
                       name="user_bidding_high_percentage" 
                       value={settings.user_bidding_high_percentage} 
                       onChange={handleChange} 
                       type="number" 
                       prefix="%"
                       helpLink
                    />
                    <InputField 
                       label="User Fare Increase Step From Recommended Price" 
                       name="user_bidding_amount_increase_or_decrease" 
                       value={settings.user_bidding_amount_increase_or_decrease} 
                       onChange={handleChange} 
                       type="number" 
                       helpLink
                    />
                    <InputField 
                       label="Wait Time Before User Can Increase Fare (Minutes)" 
                       name="user_fare_increase_wait_minutes" 
                       value={settings.user_fare_increase_wait_minutes} 
                       onChange={handleChange} 
                       type="number" 
                       helpLink
                    />
                 </div>
              </div>
              <div className="mt-12 flex justify-end">
                 <button 
                  onClick={handleUpdate}
                  disabled={saving}
                  className="bg-[#405189] text-white px-8 py-3 rounded-lg text-[13px] font-black shadow-xl flex items-center gap-3 hover:bg-[#344475] active:scale-95 transition-all disabled:opacity-50"
                 >
                   {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                   Update
                 </button>
              </div>
           </div>
           <PreviewBox label="User App" />
        </div>

      </div>

      <button
         onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
         className="fixed bottom-10 right-10 bg-[#2563EB] text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-2xl hover:bg-blue-600 transition-all z-50 hover:-translate-y-2"
      >
         <ChevronUp size={24} />
      </button>
    </div>
  );
};

export default BidRideSettings;
