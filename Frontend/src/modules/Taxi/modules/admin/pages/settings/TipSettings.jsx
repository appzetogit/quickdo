import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  Save, 
  Loader2,
  Heart,
  ArrowLeft,
  Star,
  User
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

const SectionCard = ({ title, children, noPadding = false }) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-8 h-full flex flex-col">
    {title && (
      <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/30">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-tight">{title}</h3>
      </div>
    )}
    <div className={`${noPadding ? '' : 'p-8'} flex-grow`}>
      {children}
    </div>
  </div>
);

const TipSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/general-settings/tip');
      setSettings(res.data?.settings || res.settings || {});
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load tip configurations');
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
      await api.patch('/admin/general-settings/tip', { settings });
      toast.success('Tip settings saved successfully!');
    } catch (err) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10 font-sans">
      
      {/* Header Block */}
      <div className="mb-10 flex items-center justify-between">
        <h1 className="text-[15px] font-black text-gray-800 uppercase tracking-widest">TIP SETTINGS</h1>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
           <span>Tip Settings</span>
           <ChevronRight size={12} strokeWidth={3} />
           <span className="text-gray-600">Tip Settings</span>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto space-y-8">
        
        {/* Toggle Row */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-8 py-6 flex items-center justify-between">
           <span className="text-sm font-semibold text-gray-700">Enable Driver Tips Feature</span>
           <button
             onClick={() => setSettings(s => ({ ...s, enable_tips: s.enable_tips === "1" ? "0" : "1" }))}
             className={`w-14 h-7 rounded-full relative transition-all duration-300 ${
               settings.enable_tips === "1" ? 'bg-[#405189]' : 'bg-gray-300'
             }`}
           >
             <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all duration-300 ${settings.enable_tips === "1" ? 'right-1' : 'left-1'}`} />
           </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch pb-32">
           
           {/* Form Section */}
           <div className="h-full">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
                 <div className="p-10 flex-grow">
                    <div className="space-y-4">
                       <label className="text-xs font-semibold text-gray-600 block">Minimum tip amount <span className="text-red-500">*</span></label>
                       <input 
                         type="text" 
                         value={settings.min_tip_amount || '10'} 
                         onChange={(e) => setSettings(s => ({ ...s, min_tip_amount: e.target.value }))}
                         placeholder="10"
                         className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
                       />
                    </div>
                 </div>
                 <div className="px-10 py-6 border-t border-gray-50 bg-white flex justify-end">
                    <button 
                      onClick={handleUpdate}
                      disabled={saving}
                      className="bg-[#405189] text-white px-8 py-2 rounded-lg text-sm font-semibold hover:bg-[#344475] transition-all flex items-center gap-2 shadow-sm"
                    >
                      {saving ? <Loader2 size={16} className="animate-spin" /> : "Save"}
                    </button>
                 </div>
              </div>
           </div>

           {/* Mobile Preview Block */}
           <SectionCard title="Mobile View">
              <div className="flex justify-center py-4 bg-gray-50/50 rounded-xl">
                  {/* Mobile Mockup Structure */}
                  <div className="w-[300px] bg-white rounded-[40px] shadow-2xl border-[6px] border-[#313131] h-[600px] overflow-hidden flex flex-col relative">
                      {/* App Header */}
                      <div className="bg-[#313131] p-4 flex items-center justify-center relative">
                          <span className="text-white text-[10px] font-semibold">Trip Summary</span>
                      </div>

                      <div className="flex-grow bg-[#F3F5F7] p-4 relative flex flex-col">
                          {/* Driver Info */}
                          <div className="flex items-center gap-3 mb-6 bg-white/40 p-3 rounded-xl">
                              <div className="w-10 h-10 rounded-full bg-rose-400 flex items-center justify-center text-white overflow-hidden shadow-md">
                                 <User size={20} />
                              </div>
                              <div className="flex flex-col">
                                 <span className="text-[10px] font-bold text-gray-800 uppercase">555</span>
                                 <div className="flex items-center gap-0.5 text-amber-500">
                                    <Star size={8} fill="currentColor" />
                                    <span className="text-[8px] font-bold">1</span>
                                 </div>
                                 <span className="text-[7px] text-gray-400">REQ_176414456467</span>
                              </div>
                          </div>

                          {/* Dimmed Background Overlay */}
                          <div className="absolute inset-0 bg-black/30 z-10 p-4 flex flex-col justify-center">
                              {/* Tip Modal */}
                              <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-4 border border-gray-100 animate-in fade-in zoom-in duration-300">
                                 <div className="text-center space-y-1">
                                    <h4 className="text-[11px] font-black text-gray-800 uppercase">Trip Fare $550</h4>
                                    <p className="text-[10px] text-gray-500">Show appreciation with a tip!</p>
                                 </div>

                                 <div className="flex items-center gap-2 border border-gray-200 bg-white rounded-lg px-3 py-2">
                                    <span className="text-gray-400 text-sm">$</span>
                                    <span className="text-gray-800 text-sm font-bold">10</span>
                                 </div>

                                 <div className="flex justify-between gap-2.5">
                                     {['$10', '$20', '$30'].map(val => (
                                        <div key={val} className="flex-1 py-1.5 border border-gray-100 rounded-lg text-center text-[10px] font-bold text-gray-600 bg-white shadow-sm">{val}</div>
                                     ))}
                                 </div>

                                 <div className="flex gap-2 pt-2">
                                    <button className="flex-1 border border-[#2B3B93] text-[#2B3B93] font-bold py-2 rounded-xl text-[10px] uppercase">Cancel</button>
                                    <button className="flex-1 bg-[#2B3B93] text-white font-bold py-2 rounded-xl text-[10px] uppercase shadow-lg shadow-blue-100">Add Tip</button>
                                 </div>
                              </div>
                          </div>
                          
                          {/* Simulated Trip Details Underneath */}
                          <div className="space-y-4 opacity-40 select-none">
                             <div className="h-2 w-full bg-gray-200 rounded"></div>
                             <div className="h-2 w-3/4 bg-gray-200 rounded"></div>
                             <div className="h-2 w-full bg-gray-200 rounded"></div>
                          </div>
                      </div>
                      
                      {/* Home Indicator */}
                      <div className="bg-white py-4 flex flex-col items-center border-t border-gray-50">
                         <div className="flex justify-between w-full px-12 mb-2">
                            <div className="w-4 h-4 text-gray-300"><ArrowLeft size={16} /></div>
                            <div className="w-4 h-4 rounded-lg border-2 border-gray-300"></div>
                            <div className="w-4 h-4 text-gray-300 font-bold text-[10px] flex items-center justify-center">|||</div>
                         </div>
                         <div className="w-20 h-1 bg-gray-300 rounded-full"></div>
                      </div>
                  </div>
              </div>
           </SectionCard>

        </div>
      </div>
    </div>
  );
};

export default TipSettings;
