import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronRight, 
  Save, 
  Loader2,
  Bus,
  ArrowUpRight,
  Sliders,
  Sun,
  Moon
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';
import { useSettings } from '../../../../shared/context/SettingsContext';

const SectionHeader = ({ title }) => (
  <div className="bg-slate-50 dark:bg-slate-800/50 border-l-4 border-indigo-600 p-2.5 mb-4 rounded-r-lg shadow-sm">
    <h3 className="text-[12px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">{title}</h3>
  </div>
);

const ToggleField = ({ label, name, value, onChange }) => {
  const isChecked = value === "1" || value === 1 || value === true;
  return (
    <div className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700/50 rounded-lg hover:shadow-sm transition-all group">
      <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-300 capitalize leading-snug pr-2">
        {label.replace(/_/g, ' ')}
      </span>
      <button
        onClick={() => onChange(name, isChecked ? "0" : "1")}
        className={`w-11 h-6 rounded-full relative transition-all duration-300 ${
          isChecked ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <div className={`w-4 h-4 bg-white dark:bg-slate-800 rounded-full absolute top-1 transition-all duration-300 ${isChecked ? 'right-1' : 'left-1'}`} />
      </button>
    </div>
  );
};

const InputField = ({ label, name, value, onChange, placeholder, type = "text", helpText }) => (
  <div className="space-y-1.5 w-full">
    <label className="text-[12px] font-bold text-slate-600 dark:text-slate-300 block ml-0.5">
      {label} {helpText && <span className="text-red-500">*</span>}
    </label>
    <input
      type={type}
      name={name}
      value={value || ''}
      onChange={(e) => onChange(name, e.target.value)}
      placeholder={placeholder}
      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-[13px] text-slate-700 dark:text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all outline-none"
    />
    {helpText && <p className="text-[10px] text-slate-400 mt-1">{helpText}</p>}
  </div>
);

const THEME_PRESETS = [
  { name: 'Sunset Flame (Default)', primary: '#a43c12', accent: '#ff7f50' },
  { name: 'Forest Emerald', primary: '#059669', accent: '#10b981' },
  { name: 'Royal Velvet', primary: '#6b21a8', accent: '#8b5cf6' },
  { name: 'Midnight Sapphire', primary: '#1e3a8a', accent: '#3b82f6' },
  { name: 'Charcoal Steel', primary: '#334155', accent: '#64748b' }
];

const CustomizationSettings = () => {
  const navigate = useNavigate();
  const { refreshSettings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});
  const [transportRideSettings, setTransportRideSettings] = useState({});
  const [countries, setCountries] = useState([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [settingsRes, countriesRes, transportRideRes] = await Promise.all([
        api.get('/admin/general-settings/customize'),
        api.get('/admin/countries?active=1'),
        api.get('/admin/general-settings/transport-ride')
      ]);
      
      setSettings(settingsRes.data?.settings || {});
      setCountries(countriesRes.data?.results || []);
      setTransportRideSettings(transportRideRes.data?.settings || {});
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load system parameters');
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
      await Promise.all([
        api.patch('/admin/general-settings/customize', { settings }),
        api.patch('/admin/general-settings/transport-ride', {
          settings: {
            ...transportRideSettings,
            enable_bus_service: transportRideSettings.enable_bus_service === "1" ? "1" : "0",
          },
        }),
      ]);
      toast.success('Customization settings updated successfully!', {
         style: { background: '#1e293b', color: '#fff' }
      });
      refreshSettings();
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

  const handleTransportRideChange = (name, value) => {
    setTransportRideSettings(prev => ({ ...prev, [name]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin" />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading UI parameters...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] dark:bg-slate-900 pb-12">
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4 animate-in fade-in duration-700">
        
        {/* Breadcrumb Area */}
        <div className="flex items-center justify-between mb-2">
           <div></div>
           <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-400">
             <span>Customization Settings</span>
             <ChevronRight size={14} />
             <span className="text-indigo-600 dark:text-indigo-400">Customization Settings</span>
           </div>
        </div>

        {/* Global Theme Management */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden p-5 mb-6">
           <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 pb-4 mb-5">
             <div className="flex items-center gap-2">
               <Sliders size={18} className="text-accent-orange" />
               <h2 className="text-sm font-black text-slate-800 dark:text-slate-100">Settings & Theme Customization</h2>
             </div>
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Dynamic Styles</span>
           </div>

           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             {/* Theme Presets */}
             <div className="space-y-3">
               <h3 className="text-[12px] font-bold text-slate-600 dark:text-slate-300">Theme Presets</h3>
               <div className="space-y-2">
                 {THEME_PRESETS.map((preset) => (
                   <div 
                     key={preset.name}
                     onClick={() => {
                       handleChange('primary_color', preset.primary);
                       handleChange('accent_color', preset.accent);
                     }}
                     className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                       settings.primary_color === preset.primary 
                         ? 'border-primary-orange/50 bg-primary-orange/5/50 shadow-sm' 
                         : 'border-slate-100 dark:border-slate-700/50 hover:border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                     }`}
                   >
                     <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{preset.name}</span>
                     <div className="flex gap-1.5">
                       <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: preset.primary }} />
                       <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: preset.accent }} />
                     </div>
                   </div>
                 ))}
               </div>
             </div>

             {/* Advanced Custom Colors */}
             <div className="space-y-3">
               <h3 className="text-[12px] font-bold text-slate-600 dark:text-slate-300">Advanced Custom Colors</h3>
               <div className="space-y-3">
                 <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50/50">
                   <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Primary Color</span>
                   <div className="flex items-center gap-2">
                     <span className="text-[12px] font-mono text-slate-500 dark:text-slate-400">{settings.primary_color || '#a43c12'}</span>
                     <input 
                       type="color" 
                       value={settings.primary_color || '#a43c12'}
                       onChange={(e) => handleChange('primary_color', e.target.value)}
                       className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                     />
                   </div>
                 </div>
                 <div className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50/50">
                   <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Accent Color</span>
                   <div className="flex items-center gap-2">
                     <span className="text-[12px] font-mono text-slate-500 dark:text-slate-400">{settings.accent_color || '#ff7f50'}</span>
                     <input 
                       type="color" 
                       value={settings.accent_color || '#ff7f50'}
                       onChange={(e) => handleChange('accent_color', e.target.value)}
                       className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                     />
                   </div>
                 </div>
               </div>
             </div>

             {/* Dark / Light Interface */}
             <div className="space-y-3">
               <h3 className="text-[12px] font-bold text-slate-600 dark:text-slate-300">Dark / Light Interface</h3>
               <div className="flex gap-3">
                 <button 
                   onClick={() => handleChange('theme_mode', 'light')}
                   className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                     (!settings.theme_mode || settings.theme_mode === 'light')
                       ? 'border-primary-orange/20 bg-primary-orange/5/50 text-accent-orange/90 font-bold shadow-sm'
                       : 'border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800/50 font-semibold'
                   }`}
                 >
                   <Sun size={16} className={(!settings.theme_mode || settings.theme_mode === 'light') ? 'text-primary-orange/50' : 'text-slate-400'} />
                   Light Mode
                 </button>
                 <button 
                   onClick={() => handleChange('theme_mode', 'dark')}
                   className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${
                     settings.theme_mode === 'dark'
                       ? 'border-indigo-200 bg-indigo-50/50 text-indigo-700 font-bold shadow-sm'
                       : 'border-slate-100 dark:border-slate-700/50 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:bg-slate-800/50 font-semibold'
                   }`}
                 >
                   <Moon size={16} className={settings.theme_mode === 'dark' ? 'text-indigo-500' : 'text-slate-400'} />
                   Dark Mode
                 </button>
               </div>
               <p className="text-[10px] text-slate-400 mt-4 leading-relaxed">
                 *Colors will update layout indicators, active tags, and hover triggers dynamically via CSS root parameters.
               </p>
             </div>
           </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden p-5">
           <SectionHeader title="General Settings" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-8">
              <div className="md:col-span-1">
                 <label className="text-[12px] font-bold text-slate-600 dark:text-slate-300 block mb-1.5 ml-0.5">Default Country Code</label>
                 <select 
                  value={settings.default_country_code || 'IN'} 
                  onChange={(e) => handleChange('default_country_code', e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 px-3 text-[13px] text-slate-700 dark:text-slate-200 focus:border-indigo-500 transition-all outline-none appearance-none"
                 >
                    {countries.length > 0 ? (
                      countries.map(c => (
                        <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                      ))
                    ) : (
                      <option value="IN">India (IN)</option>
                    )}
                 </select>

              </div>
              <ToggleField label="Show WAZE Map Navigation on Driver App" name="enable_waze_navigation" value={settings.enable_waze_navigation} onChange={handleChange} />
              <ToggleField label="Show Wallet Feature On Mobile App User" name="show_wallet_feature_on_mobile_app" value={settings.show_wallet_feature_on_mobile_app} onChange={handleChange} />
              <ToggleField label="Show Wallet Feature On Mobile App Driver" name="show_wallet_feature_for_driver" value={settings.show_wallet_feature_for_driver} onChange={handleChange} />
              <ToggleField label="Show Wallet Feature On Mobile App Owner" name="show_wallet_feature_for_owner" value={settings.show_wallet_feature_for_owner} onChange={handleChange} />
              <ToggleField label="Show Instant Ride Feature on Mobile App" name="show_instant_ride_feature_on_mobile_app" value={settings.show_instant_ride_feature_on_mobile_app} onChange={handleChange} />
              <ToggleField label="Show Wallet Money Transfer Feature On Mobile App For User" name="enable_wallet_transfer_user" value={settings.enable_wallet_transfer_user} onChange={handleChange} />
              <ToggleField label="Show Wallet Money Transfer Feature On Mobile App For Driver" name="enable_wallet_transfer_driver" value={settings.enable_wallet_transfer_driver} onChange={handleChange} />
              <ToggleField label="Show Wallet Money Transfer Feature On Mobile App For Owner" name="enable_wallet_transfer_owner" value={settings.enable_wallet_transfer_owner} onChange={handleChange} />
              <ToggleField label="Enable Outstation Round Trip Feature" name="enable_outstation_round_trip" value={settings.enable_outstation_round_trip} onChange={handleChange} />
              <ToggleField label="Show Incentive Feature" name="show_incentive_feature_for_driver" value={settings.show_incentive_feature_for_driver} onChange={handleChange} />
              <ToggleField label="Enable Driver Loyalty Feature" name="enable_driver_loyalty" value={settings.enable_driver_loyalty} onChange={handleChange} />
              <ToggleField label="Enable Country Restrict on Map" name="enable_country_restrict_on_map" value={settings.enable_country_restrict_on_map} onChange={handleChange} />
              <ToggleField label="Show Owner Module Feature on Mobile App" name="enable_owner_module" value={settings.enable_owner_module} onChange={handleChange} />
              <ToggleField label="Show Ride OTP Feature" name="show_ride_otp" value={settings.show_ride_otp} onChange={handleChange} />
              <ToggleField label="Show Delivery Ride Otp On Loading Feature" name="enable_delivery_otp_load" value={settings.enable_delivery_otp_load} onChange={handleChange} />
              <ToggleField label="Show Delivery Ride Otp On Unloading Feature" name="enable_delivery_otp_unload" value={settings.enable_delivery_otp_unload} onChange={handleChange} />
              <ToggleField label="Show Ride Without Destination" name="show_ride_without_destination" value={settings.show_ride_without_destination} onChange={handleChange} />
              <ToggleField label="Enable Web Booking Feature" name="enable_web_booking_feature" value={settings.enable_web_booking_feature} onChange={handleChange} />
              <ToggleField label="Enable Sub Vehicle Feature" name="enable_sub_vehicle_feature" value={settings.enable_sub_vehicle_feature} onChange={handleChange} />
              <ToggleField label="Enable Landing Website" name="enable_landing_site" value={settings.enable_landing_site} onChange={handleChange} />
              <ToggleField label="Enable Additional Charges Feature" name="enable_additional_charge_feature" value={settings.enable_additional_charge_feature} onChange={handleChange} />
              <ToggleField label="Enable Driver Disapprove When Updating Feature" name="enable_driver_disapprove_on_update" value={settings.enable_driver_disapprove_on_update} onChange={handleChange} />
              <ToggleField label="Enable Support Ticket Feature" name="enable_support_ticket_feature" value={settings.enable_support_ticket_feature} onChange={handleChange} />
              <ToggleField label="Enable Map Appearance Edit on Mobile App" name="enable_map_appearance_change_on_mobile_app" value={settings.enable_map_appearance_change_on_mobile_app} onChange={handleChange} />
              <ToggleField label="Enable Multiple Ride Feature" name="enable_multiple_ride_feature" value={settings.enable_multiple_ride_feature} onChange={handleChange} />
              <ToggleField label="Enable Maximum Distance Feature" name="enable_max_dist_feature" value={settings.enable_max_dist_feature} onChange={handleChange} />
              <ToggleField label="Enable Fixed Fare" name="enable_fixed_fare" value={settings.enable_fixed_fare} onChange={handleChange} />
           </div>

           <SectionHeader title="Transport Ride Settings" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-8">
              <ToggleField label="Enable Shipment Load Feature" name="enable_shipment_load_feature" value={settings.enable_shipment_load_feature} onChange={handleChange} />
              <ToggleField label="Enable Shipment Unload Feature" name="enable_shipment_unload_feature" value={settings.enable_shipment_unload_feature} onChange={handleChange} />
              <ToggleField label="Enable Digital Signature" name="enable_digital_signature" value={settings.enable_digital_signature} onChange={handleChange} />
              <ToggleField label="Set The ETA price (without Waiting Charge) on completion of ride" name="enable_eta_price_on_complete" value={settings.enable_eta_price_on_complete} onChange={handleChange} />
           </div>

           <SectionHeader title="Bus Service" />
           <div className="mb-8 rounded-2xl border border-rose-100 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-900/20 p-5">
             <div className="flex items-start justify-between gap-4">
               <div className="flex gap-3">
                 <div className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-800 text-rose-500 dark:text-rose-400 border border-rose-100 dark:border-rose-900/50 flex items-center justify-center shadow-sm">
                   <Bus size={20} />
                 </div>
                 <div>
                   <p className="text-[13px] font-black text-slate-800 dark:text-slate-100">Enable Bus Service</p>
                   <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                     Show the Bus option in the user app and enable route search, seat booking, and Razorpay payment flow.
                   </p>
                 </div>
               </div>
               <button
                 onClick={() => handleTransportRideChange('enable_bus_service', transportRideSettings.enable_bus_service === "1" ? "0" : "1")}
                 className={`w-11 h-6 rounded-full relative transition-all duration-300 shrink-0 ${
                   transportRideSettings.enable_bus_service === "1" ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'
                 }`}
               >
                 <div className={`w-4 h-4 bg-white dark:bg-slate-800 rounded-full absolute top-1 transition-all duration-300 ${transportRideSettings.enable_bus_service === "1" ? 'right-1' : 'left-1'}`} />
               </button>
             </div>

             <button
               type="button"
               onClick={() => navigate('/taxi/admin/bus-service')}
               className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white dark:bg-slate-800 px-4 py-2.5 text-[12px] font-black text-slate-700 dark:text-slate-200 border border-rose-100 dark:border-rose-900/50 shadow-sm hover:border-rose-200 dark:border-rose-800/50 hover:text-rose-600 dark:text-rose-400 transition-all"
             >
               Manage Bus Services <ArrowUpRight size={14} />
             </button>
           </div>

           <SectionHeader title="Chain Ride settings" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-8 items-start">
              <ToggleField label="Enable Secondary Ride For Driver While On Trip" name="enable_secondary_ride" value={settings.enable_secondary_ride} onChange={handleChange} />
              <InputField 
                label="Maximum distance for Secondary Ride (KM)" 
                name="max_dist_secondary_ride" 
                value={settings.max_dist_secondary_ride || '2'} 
                onChange={handleChange} 
                type="number"
                helpText="Numeric value only"
              />
           </div>

           <SectionHeader title="My Route Booking Settings" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mb-8 items-start">
              <ToggleField label="Enable My Route Booking Feature" name="enable_my_route_booking_feature" value={settings.enable_my_route_booking_feature} onChange={handleChange} />
              <InputField 
                label="Daily Route Booking Limit" 
                name="how_many_times_a_driver_can_enable_the_my_route_booking_per_day" 
                value={settings.how_many_times_a_driver_can_enable_the_my_route_booking_per_day || '1'} 
                onChange={handleChange} 
                type="number"
                helpText="Numeric value only"
              />
           </div>

           <SectionHeader title="User Sign-in" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mb-8">
              <ToggleField label="Enable User Email Login" name="user_email_login" value={settings.user_email_login} onChange={handleChange} />
              <div className="hidden md:block"></div>
              <ToggleField label="Enable Email OTP" name="user_email_otp" value={settings.user_email_otp} onChange={handleChange} />
              <ToggleField label="Enable Email Password" name="user_email_password" value={settings.user_email_password} onChange={handleChange} />
              <ToggleField label="Enable User Mobile Login" name="user_mobile_login" value={settings.user_mobile_login} onChange={handleChange} />
              <div className="hidden md:block"></div>
              <ToggleField label="Enable Mobile OTP" name="user_mobile_otp" value={settings.user_mobile_otp} onChange={handleChange} />
              <ToggleField label="Enable Mobile Password" name="user_mobile_password" value={settings.user_mobile_password} onChange={handleChange} />
           </div>

           <SectionHeader title="Driver Sign-in" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mb-8">
              <ToggleField label="Enable Driver Email Login" name="driver_email_login" value={settings.driver_email_login} onChange={handleChange} />
              <div className="hidden md:block"></div>
              <ToggleField label="Enable Email OTP" name="driver_email_otp" value={settings.driver_email_otp} onChange={handleChange} />
              <ToggleField label="Enable Email Password" name="driver_email_password" value={settings.driver_email_password} onChange={handleChange} />
              <ToggleField label="Enable Driver Mobile Login" name="driver_mobile_login" value={settings.driver_mobile_login} onChange={handleChange} />
              <div className="hidden md:block"></div>
              <ToggleField label="Enable Mobile OTP" name="driver_mobile_otp" value={settings.driver_mobile_otp} onChange={handleChange} />
              <ToggleField label="Enable Mobile Password" name="driver_mobile_password" value={settings.driver_mobile_password} onChange={handleChange} />
           </div>

           <SectionHeader title="Owner Sign-in" />
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mb-4">
              <ToggleField label="Enable Owner Email Login" name="owner_email_login" value={settings.owner_email_login} onChange={handleChange} />
              <div className="hidden md:block"></div>
              <ToggleField label="Enable Email OTP" name="owner_email_otp" value={settings.owner_email_otp} onChange={handleChange} />
              <ToggleField label="Enable Email Password" name="owner_email_password" value={settings.owner_email_password} onChange={handleChange} />
              <ToggleField label="Enable Owner Mobile Login" name="owner_mobile_login" value={settings.owner_mobile_login} onChange={handleChange} />
              <div className="hidden md:block"></div>
              <ToggleField label="Enable Mobile OTP" name="owner_mobile_otp" value={settings.owner_mobile_otp} onChange={handleChange} />
              <ToggleField label="Enable Mobile Password" name="owner_mobile_password" value={settings.owner_mobile_password} onChange={handleChange} />
           </div>

           <div className="mt-8 flex justify-end pt-6 border-t border-slate-100 dark:border-slate-700/50">
              <button 
                onClick={handleUpdate}
                disabled={saving}
                className="bg-indigo-600 dark:bg-indigo-500 text-white px-10 py-3 rounded-lg text-[14px] font-black shadow-lg flex items-center justify-center gap-2 hover:bg-indigo-700 dark:hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {saving ? "Saving Changes..." : "Save Customization Settings"}
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default CustomizationSettings;
