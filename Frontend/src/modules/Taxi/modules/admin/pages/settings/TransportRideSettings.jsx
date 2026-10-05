import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, 
  Save, 
  Loader2,
  ChevronUp,
  Info
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

const InputField = ({ label, name, value, onChange, placeholder, type = "text", helpLink }) => (
  <div className="space-y-1.5 w-full">
    <div className="flex items-center justify-between">
       <label className="text-[13px] font-bold text-slate-700 block ml-0.5">
         {label}
       </label>
       {helpLink && (
         <button className="text-emerald-500 text-[11px] font-bold hover:underline flex items-center gap-1">
            How It Works <Info size={12} />
         </button>
       )}
    </div>
    <input
      type={type}
      name={name}
      value={value || ''}
      onChange={(e) => onChange(name, e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
    />
  </div>
);

const TransportRideSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/general-settings/transport-ride');
      setSettings(res.data?.settings || res.settings || {});
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load transport parameters');
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
      await api.patch('/admin/general-settings/transport-ride', { settings });
      toast.success('Transport settings updated successfully!');
    } catch (err) {
      console.error('Update error:', err);
      toast.error('Failed to save changes');
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
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest italic tracking-wider">Syncing Transport Engine...</p>
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
             <span>Transport Ride Settings</span>
             <ChevronRight size={14} />
             <span className="text-indigo-600">Transport Ride Settings</span>
           </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 pb-12">
           <div className="mb-8 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-5 py-4">
             <p className="text-sm font-semibold text-slate-700">Regular ride search behavior is controlled from this page.</p>
             <p className="mt-1 text-xs text-slate-500">
               Search radius, driver response window, total regular ride search time, and dispatch mode all feed the live dispatch flow.
             </p>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
              {/* Left Column */}
              <div className="space-y-8">
                 <div className="space-y-1.5">
                    <label className="text-[13px] font-bold text-slate-700 block ml-0.5">Trip Dispatch Type</label>
                    <select 
                     value={settings.trip_dispatch_type || '1'} 
                     onChange={(e) => handleChange('trip_dispatch_type', e.target.value)}
                     className="w-full bg-white border border-slate-200 rounded-lg py-3 px-4 text-[14px] text-slate-700 focus:border-indigo-500 transition-all outline-none appearance-none"
                    >
                       <option value="1">One By One</option>
                       <option value="2">Broadcast</option>
                    </select>
                 </div>

                 <InputField 
                    label="Maximum Waiting Time For User to Accept/Reject Bidding Ride in Seconds" 
                    name="maximum_time_for_accept_reject_bidding_ride" 
                    value={settings.maximum_time_for_accept_reject_bidding_ride} 
                    onChange={handleChange} 
                    type="number" 
                 />

                 <InputField 
                    label="Maximum Time For Accept/Reject drivers for Bidding Ride In Seconds" 
                    name="maximum_time_for_find_drivers_for_bitting_ride" 
                    value={settings.maximum_time_for_find_drivers_for_bitting_ride} 
                    onChange={handleChange} 
                    type="number" 
                 />

                 <InputField 
                    label="Maximum Time For Find Drivers For Regular Ride" 
                    name="maximum_time_for_find_drivers_for_regular_ride" 
                    value={settings.maximum_time_for_find_drivers_for_regular_ride} 
                    onChange={handleChange} 
                    type="number" 
                 />

                 <InputField 
                    label="Trip Accept/Reject Duration For Driver in Seconds" 
                    name="trip_accept_reject_duration_for_driver" 
                    value={settings.trip_accept_reject_duration_for_driver} 
                    onChange={handleChange} 
                    type="number" 
                 />

                 <InputField 
                    label="Bidding Ride Maximum Distance" 
                    name="bidding_ride_maximum_distance" 
                    value={settings.bidding_ride_maximum_distance} 
                    onChange={handleChange} 
                    type="number" 
                 />
              </div>

              {/* Right Column */}
              <div className="space-y-8">
                 <InputField 
                    label="Driver Search Radius in Kilometer" 
                    name="driver_search_radius" 
                    value={settings.driver_search_radius} 
                    onChange={handleChange} 
                    type="number" 
                 />

                 <InputField 
                    label="User Can Schedule a Ride After X Minutes" 
                    name="user_can_make_a_ride_after_x_miniutes" 
                    value={settings.user_can_make_a_ride_after_x_miniutes} 
                    onChange={handleChange} 
                    type="number" 
                 />

                 <InputField 
                    label="Minimum Time For Find drivers for Schedule Ride in Hours" 
                    name="minimum_time_for_search_drivers_for_schedule_ride" 
                    value={settings.minimum_time_for_search_drivers_for_schedule_ride} 
                    onChange={handleChange} 
                    type="number" 
                    helpLink
                 />

                 <InputField 
                    label="Enter the minimum time (in minutes) for the driver to automatically start the trip..." 
                    name="minimum_time_for_starting_trip_drivers_for_schedule_ride" 
                    value={settings.minimum_time_for_starting_trip_drivers_for_schedule_ride} 
                    onChange={handleChange} 
                    type="number" 
                    helpLink
                 />

               <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-xl mt-12">
                   <span className="text-[14px] font-bold text-slate-700">Can Round the Bill Values?</span>
                   <button
                     onClick={() => handleChange('can_round_the_bill_values', settings.can_round_the_bill_values === "1" ? "0" : "1")}
                     className={`w-11 h-6 rounded-full relative transition-all duration-300 ${
                       settings.can_round_the_bill_values === "1" ? 'bg-indigo-600' : 'bg-slate-300'
                     }`}
                   >
                     <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all duration-300 ${settings.can_round_the_bill_values === "1" ? 'right-1' : 'left-1'}`} />
                   </button>
                 </div>

              </div>
           </div>

           <div className="mt-12 flex justify-end">
              <button 
                onClick={handleUpdate}
                disabled={saving}
                className="bg-[#405189] text-white px-8 py-3 rounded-lg text-[13px] font-bold shadow-xl flex items-center gap-3 hover:bg-[#344475] active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                Update
              </button>
           </div>
        </div>
      </div>

      {/* Floating Scroll Top */}
      <button
         onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
         className="fixed bottom-10 right-10 bg-primary-orange/50 text-white w-12 h-12 rounded-xl flex items-center justify-center shadow-2xl hover:bg-accent-orange transition-all z-50 hover:-translate-y-2 active:translate-y-0"
      >
         <ChevronUp size={24} />
      </button>
    </div>
  );
};

export default TransportRideSettings;
