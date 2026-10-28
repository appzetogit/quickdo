import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ChevronRight, 
  Save, 
  Loader2,
  Upload,
  Trash2,
  Image as ImageIcon,
  Globe,
  Settings,
  Car,
  UtensilsCrossed,
  Truck
} from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';
import { useSettings } from '../../../../shared/context/SettingsContext';
import apiClient from '../../../../../../services/api/axios';

const SectionHeader = ({ title }) => (
  <div className="bg-slate-50 dark:bg-slate-800/50 border-l-4 border-indigo-600 p-2.5 mb-4 rounded-r-lg shadow-sm">
    <h3 className="text-[12px] font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wide">{title}</h3>
  </div>
);

const MODULE_METADATA = {
  landing: {
    label: 'Landing Website',
    description: 'Branding for the master home page and informational sections.',
    icon: Globe,
    colorClass: 'text-sky-500 bg-sky-50 dark:bg-sky-950/30',
    logos: [
      { key: 'landing', label: 'Landing Page Logo', description: 'Main logo shown on the landing website header/footer.' },
      { key: 'landing_user', label: 'User Portal Logo', description: 'Logo for the main customer web portal and landing page users.' }
    ]
  },
  admin: {
    label: 'Admin Control Panels',
    description: 'Branding for the global administration interface sidebars.',
    icon: Settings,
    colorClass: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/30',
    logos: [
      { key: 'admin', label: 'Admin Dashboard Logo', description: 'Logo shown on admin control panels.' }
    ]
  },
  taxi: {
    label: 'Taxi / Rides App',
    description: 'Branding for cab booking, taxi tracking, and driver portals.',
    icon: Car,
    colorClass: 'text-amber-500 bg-amber-50 dark:bg-amber-950/30',
    logos: [
      { key: 'taxi', label: 'Taxi Passenger Logo', description: 'Logo shown to passengers booking taxi rides.' },
      { key: 'taxi_driver', label: 'Taxi Driver Logo', description: 'Logo shown to taxi drivers in driver-specific screens.' }
    ]
  },
  food: {
    label: 'Food Delivery App',
    description: 'Branding for restaurant order tracking, user carts, and checkout.',
    icon: UtensilsCrossed,
    colorClass: 'text-rose-500 bg-rose-50 dark:bg-rose-950/30',
    logos: [
      { key: 'food', label: 'Restaurant App Logo', description: 'Logo shown to customers.' },
      { key: 'food_restaurant', label: 'Restaurant Owner Logo', description: 'Logo shown on restaurant owner dashboards.' },
      { key: 'food_delivery_partner', label: 'Food Delivery Partner Logo', description: 'Logo shown on delivery partner portals.' }
    ]
  },
  delivery: {
    label: 'Delivery Logistics App',
    description: 'Branding for parcel cargo onboarding and delivery agent portals.',
    icon: Truck,
    colorClass: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30',
    logos: [
      { key: 'delivery', label: 'Logistics Client Logo', description: 'Logo shown to customers sending/tracking shipments.' },
      { key: 'delivery_partner', label: 'Logistics Partner Logo', description: 'Logo shown to cargo/delivery agents.' }
    ]
  }
};

const LogoSettings = () => {
  const navigate = useNavigate();
  const { refreshSettings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState({});
  const [settings, setSettings] = useState({ logos: {}, favicons: {} });

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/general-settings/customize');
      const customizationData = res.data?.settings || {};
      
      setSettings({
        logos: customizationData.logos || {},
        favicons: customizationData.favicons || {}
      });
    } catch (err) {
      console.error('Fetch error:', err);
      toast.error('Failed to load branding parameters');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleChange = (key, type, value) => {
    setSettings(prev => ({
      ...prev,
      [type === 'logo' ? 'logos' : 'favicons']: {
        ...prev[type === 'logo' ? 'logos' : 'favicons'],
        [key]: value
      }
    }));
  };

  const handleFileUpload = async (e, key, type) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate SVG and standard image formats
    const isValidFormat = file.type === 'image/svg+xml' || file.type.startsWith('image/');
    if (!isValidFormat) {
      toast.error('Invalid file format. Please upload an image or SVG file.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    const uploadKey = `${key}_${type}`;
    setUploading(prev => ({ ...prev, [uploadKey]: true }));

    try {
      const res = await apiClient.post('/uploads/image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      const url = res?.data?.data?.url || res?.data?.url || res?.url;
      if (url) {
        handleChange(key, type, url);
        toast.success(`${type === 'logo' ? 'Logo' : 'Favicon'} updated successfully!`);
      } else {
        toast.error('Upload failed. No URL returned.');
      }
    } catch (err) {
      console.error('Upload error:', err);
      toast.error('Failed to upload file');
    } finally {
      setUploading(prev => ({ ...prev, [uploadKey]: false }));
    }
  };

  const handleUpdate = async () => {
    try {
      setSaving(true);
      // We read the existing customization settings first to avoid overwriting other values
      const res = await api.get('/admin/general-settings/customize');
      const currentCustomization = res.data?.settings || {};

      const updatedCustomization = {
        ...currentCustomization,
        logos: settings.logos,
        favicons: settings.favicons
      };

      await api.patch('/admin/general-settings/customize', { settings: updatedCustomization });
      toast.success('Branding settings updated successfully!', {
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-800/50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-10 h-10 text-indigo-600 dark:text-indigo-400 animate-spin" />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading branding parameters...</p>
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
             <span>Settings</span>
             <ChevronRight size={14} />
             <span className="text-indigo-600 dark:text-indigo-400">Logo Management</span>
           </div>
        </div>

        {/* Global branding dashboard */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden p-5 mb-6">
           <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/50 pb-4 mb-5">
             <div className="flex items-center gap-2">
               <ImageIcon size={18} className="text-indigo-600 dark:text-indigo-400" />
               <h2 className="text-sm font-black text-slate-800 dark:text-slate-100">Branding & Logo Management</h2>
             </div>
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Multitask Setup</span>
           </div>

           <div className="space-y-8">
              {Object.entries(MODULE_METADATA).map(([key, meta]) => {
                const IconComponent = meta.icon;
                const faviconUrl = settings.favicons[key] || '';
                
                return (
                  <div key={key} className="border border-slate-100 dark:border-slate-700 rounded-xl p-5 hover:shadow-md transition-all duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100 dark:border-slate-700/50">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${meta.colorClass}`}>
                          <IconComponent size={20} />
                        </div>
                        <div>
                          <h4 className="text-[14px] font-black text-slate-800 dark:text-slate-200">{meta.label}</h4>
                          <p className="text-[11px] text-slate-400 mt-0.5">{meta.description}</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      {/* Sub-Logos Section */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {meta.logos.map((logoMeta) => {
                          const logoUrl = settings.logos[logoMeta.key] || '';
                          return (
                            <div key={logoMeta.key} className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-4 border border-slate-100 dark:border-slate-700 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200">{logoMeta.label}</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mb-3">{logoMeta.description}</p>
                              </div>

                              <div className="flex items-center gap-4">
                                {/* Logo Preview */}
                                <div className="h-16 w-24 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 flex items-center justify-center overflow-hidden shrink-0">
                                  {logoUrl ? (
                                    <img src={logoUrl} alt={logoMeta.label} className="max-h-full max-w-full object-contain" />
                                  ) : (
                                    <div className="text-center">
                                      <ImageIcon className="w-5 h-5 mx-auto text-slate-300 dark:text-slate-600" />
                                      <span className="text-[9px] text-slate-400 block mt-1">No Logo</span>
                                    </div>
                                  )}
                                </div>

                                {/* Actions */}
                                <div className="flex-1 flex gap-2">
                                  <label className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-indigo-600/30 bg-indigo-50 hover:bg-indigo-100/50 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                                    uploading[`${logoMeta.key}_logo`] ? 'opacity-50 pointer-events-none' : ''
                                  }`}>
                                    {uploading[`${logoMeta.key}_logo`] ? (
                                      <Loader2 size={13} className="animate-spin" />
                                    ) : (
                                      <Upload size={13} />
                                    )}
                                    Upload Logo
                                    <input 
                                      type="file" 
                                      accept="image/svg+xml,image/*" 
                                      onChange={(e) => handleFileUpload(e, logoMeta.key, 'logo')} 
                                      className="hidden" 
                                    />
                                  </label>

                                  {logoUrl && (
                                    <button
                                      type="button"
                                      onClick={() => handleChange(logoMeta.key, 'logo', '')}
                                      className="p-2.5 rounded-lg border border-rose-100 dark:border-rose-900/50 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-all"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Favicon Upload Card */}
                      <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300">Module Favicon</span>
                          <span className="text-[10px] text-slate-400">SVG/ICO, equal dimensions (e.g. 64x64)</span>
                        </div>

                        <div className="flex items-center gap-4">
                          {/* Favicon Preview */}
                          <div className="h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 flex items-center justify-center overflow-hidden shrink-0">
                            {faviconUrl ? (
                              <img src={faviconUrl} alt="Favicon" className="h-8 w-8 object-contain" />
                            ) : (
                              <div className="text-center">
                                <ImageIcon className="w-4 h-4 mx-auto text-slate-300 dark:text-slate-600" />
                                <span className="text-[9px] text-slate-400 block mt-1">No Icon</span>
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex-1 flex gap-2">
                            <label className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg border border-indigo-600/30 bg-indigo-50 hover:bg-indigo-100/50 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-600 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold cursor-pointer transition-all active:scale-95 ${
                              uploading[`${key}_favicon`] ? 'opacity-50 pointer-events-none' : ''
                            }`}>
                              {uploading[`${key}_favicon`] ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Upload size={13} />
                              )}
                              Upload Favicon
                              <input 
                                type="file" 
                                accept="image/svg+xml,image/x-icon,image/png,image/jpeg" 
                                onChange={(e) => handleFileUpload(e, key, 'favicon')} 
                                className="hidden" 
                              />
                            </label>

                            {faviconUrl && (
                              <button
                                type="button"
                                onClick={() => handleChange(key, 'favicon', '')}
                                className="p-2.5 rounded-lg border border-rose-100 dark:border-rose-900/50 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
           </div>

           {/* Save Button */}
           <div className="mt-8 flex justify-end pt-6 border-t border-slate-100 dark:border-slate-700/50">
              <button 
                onClick={handleUpdate}
                disabled={saving}
                className="bg-indigo-600 dark:bg-indigo-500 text-white px-10 py-3 rounded-lg text-[14px] font-black shadow-lg flex items-center justify-center gap-2 hover:bg-indigo-700 dark:hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {saving ? "Saving Changes..." : "Save Branding Settings"}
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default LogoSettings;
