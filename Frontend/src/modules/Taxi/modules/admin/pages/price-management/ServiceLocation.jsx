import React, { useEffect, useMemo, useState } from 'react';
import { 
  ArrowLeft, 
  Edit2, 
  Globe2, 
  Loader2, 
  Plus, 
  Save, 
  Search, 
  Trash2, 
  ChevronRight, 
  Globe, 
  Tag, 
  MapPin, 
  Clock, 
  DollarSign,
  Activity,
  Info,
  ChevronLeft,
  ChevronDown
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import countryMetadata from '../../constants/countries.json';

import { describeApiError } from '../../../../shared/utils/apiError';
const DEFAULT_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles'
];

const ADMIN_LANGUAGE_OPTIONS = ['English', 'Hindi', 'Arabic', 'French', 'Spanish'];

const defaultFormData = {
  name: '',
  country: '',
  currency_code: '',
  currency_symbol: '',
  timezone: ''
};

const inputClass = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-800 bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 outline-none transition-all placeholder:text-gray-300";
const labelClass = "block text-xs font-bold text-gray-500 mb-2";

const ServiceLocation = ({ mode }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isCreate = mode === 'create';
  const isEdit = mode === 'edit';
  const isList = !isCreate && !isEdit;

  const [locations, setLocations] = useState([]);
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeLangTab, setActiveLangTab] = useState('English');
  const [formData, setFormData] = useState(defaultFormData);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [locationsRes, countriesRes] = await Promise.allSettled([
        adminService.getServiceLocations(),
        adminService.getCountries()
      ]);

      const nextLocations = locationsRes.status === 'fulfilled' ? (Array.isArray(locationsRes.value?.data) ? locationsRes.value.data : (locationsRes.value?.data?.results || locationsRes.value?.results || [])) : [];
      const nextCountries = countriesRes.status === 'fulfilled' ? (Array.isArray(countriesRes.value?.data?.results) ? countriesRes.value.data.results : (Array.isArray(countriesRes.value?.data) ? countriesRes.value.data : (countriesRes.value?.results || []))) : [];

      setLocations(Array.isArray(nextLocations) ? nextLocations : []);
      setCountries(Array.isArray(nextCountries) ? nextCountries : []);
      
      if (isEdit && id) {
        const item = nextLocations.find(l => String(l._id || l.id) === String(id));
        if (item) {
          const matchedCountry = nextCountries.find(c => (c._id || c.id) === item.country || c.name === item.country || c.name === item.country?.name);
          setFormData({
            name: item.name || item.service_location_name || '',
            country: matchedCountry?._id || matchedCountry?.id || '',
            currency_code: item.currency_code || '',
            currency_symbol: item.currency_symbol || '',
            timezone: item.timezone || ''
          });
        }
      } else if (isCreate) {
        if (Array.isArray(nextCountries) && nextCountries.length > 0) {
          const defaultCountry = nextCountries.find(c => c.name?.toLowerCase() === 'india') || nextCountries[0];
          setFormData(p => ({ ...p, country: defaultCountry?._id || defaultCountry?.id || '' }));
        }
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (formData.country && countries.length > 0) {
      // 1. Try to find in the dynamic API data (highest priority)
      let matched = countries.find(c => String(c._id || c.id) === String(formData.country));
      
      // 2. If dynamic data is missing currency info, fallback to our local master metadata
      if (!matched?.currency_code) {
        const countryName = matched?.name || '';
        matched = countryMetadata.find(c => c.name === countryName || c.code === matched?.code);
      }

      if (matched?.currency_code) {
        setFormData(prev => ({
          ...prev,
          currency_code: prev.currency_code || matched.currency_code,
          currency_symbol: prev.currency_symbol || matched.currency_symbol
        }));
      }
    }
  }, [formData.country, countries]);

  useEffect(() => { fetchData(); }, [mode, id]);

  const filteredLocations = useMemo(() => {
    const q = searchTerm.toLowerCase();
    if (!Array.isArray(locations)) return [];
    return locations.filter(l => {
      const countryName = typeof l.country === 'object' ? l.country?.name : l.country;
      return [l.name, l.service_location_name, countryName].some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [locations, searchTerm]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!formData.name || !formData.country) return alert("Required fields missing");
    setSaving(true);
    try {
      const selectedCountry = countries.find(c => (c._id || c.id) === formData.country);
      const payload = {
        ...formData,
        currency_code: formData.currency_code.toUpperCase(),
        country: selectedCountry?.name || formData.country,
        currency_name: formData.currency_code.toUpperCase()
      };

      const res = isEdit ? await adminService.updateServiceLocation(id, payload) : await adminService.createServiceLocation(payload);
      if (res?.success) {
        navigate('/taxi/admin/pricing/service-location');
      } else {
        alert(res?.message || "Operation failed");
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred while saving.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId) => {
    if (!window.confirm("Delete this service area?")) return;
    try {
      const res = await adminService.deleteServiceLocation(itemId);
      if (res?.success) fetchData();
    } catch (err) {
      console.error('Delete service area error:', err);
      alert(describeApiError(err, 'Could not delete that service area.'));
    }
  };

  if (isList) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8 animate-in fade-in duration-500 font-sans">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2 font-medium uppercase tracking-widest">
              <span>Pricing</span>
              <ChevronRight size={12} />
              <span className="text-gray-700">Service Locations</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Active Service Areas</h1>
                <p className="text-xs text-gray-500 mt-1 font-medium">Manage localized settings including currency, timezone, and regional clusters.</p>
              </div>
              <button 
                onClick={() => navigate('/taxi/admin/pricing/service-location/add')}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-md active:scale-95"
              >
                <Plus size={18} /> Add Location
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: 'Market Jurisdictions', value: Array.isArray(locations) ? [...new Set(locations.map(l => typeof l.country === 'object' ? l.country?.name : l.country))].filter(Boolean).length : 0, icon: Globe, color: 'indigo' },
              { label: 'Operational Hubs', value: Array.isArray(locations) ? locations.length : 0, icon: MapPin, color: 'emerald' },
              { label: 'Active Currencies', value: Array.isArray(locations) ? [...new Set(locations.map(l => l.currency_code))].filter(Boolean).length : 0, icon: DollarSign, color: 'blue' }
            ].map((stat, i) => (
              <div key={i} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 group hover:border-indigo-100 transition-colors">
                <div className={`w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100 shadow-sm group-hover:scale-110 transition-transform`}>
                  <stat.icon size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{stat.label}</p>
                  <h3 className="text-2xl font-black text-gray-900 mt-1">{stat.value}</h3>
                </div>
              </div>
            ))}
          </div>

          {/* List Table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="p-4 bg-gray-50/50 border-b border-gray-100">
              <div className="relative w-full max-w-sm">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search locations..." 
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all font-medium"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                 <div className="flex flex-col items-center justify-center py-24 gap-3">
                    <Loader2 className="animate-spin text-indigo-600" size={32} />
                    <p className="text-[10px] uppercase font-black text-gray-400 tracking-widest">Validating Market Access</p>
                 </div>
              ) : filteredLocations.length > 0 ? (
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50/50 border-b border-gray-100 text-[10px] uppercase font-bold text-gray-400 tracking-widest">
                      <th className="px-6 py-4">Sector Name</th>
                      <th className="px-6 py-4">Jurisdiction</th>
                      <th className="px-6 py-4 text-center">Settlement</th>
                      <th className="px-6 py-4">Temporal Zone</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredLocations.map(l => (
                      <tr key={l._id || l.id} className="hover:bg-gray-50/20 transition-colors group">
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100 shadow-sm group-hover:rotate-6 transition-transform"><MapPin size={18} /></div>
                              <span className="text-sm font-bold text-gray-900 leading-tight">{l.name || l.service_location_name}</span>
                           </div>
                        </td>
                        <td className="px-6 py-4">
                           <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">{typeof l.country === 'object' ? l.country?.name : l.country || '-'}</span>
                        </td>
                        <td className="px-6 py-4 text-center">
                           <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-100 rounded-lg">
                              <span className="text-[10px] font-black text-indigo-600">{l.currency_code}</span>
                              <span className="text-xs font-bold text-gray-400">{l.currency_symbol}</span>
                           </div>
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                              <Clock size={12} className="text-indigo-300" /> {l.timezone}
                           </div>
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                           <div className="flex items-center justify-end gap-2">
                             <button onClick={() => navigate(`/taxi/admin/pricing/service-location/edit/${l._id || l.id}`)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all shadow-sm"><Edit2 size={16} /></button>
                             <button onClick={() => handleDelete(l._id || l.id)} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all shadow-sm"><Trash2 size={16} /></button>
                           </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="py-24 text-center">
                  <div className="w-16 h-16 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-center text-gray-200 mx-auto mb-4 tracking-tighter"><Globe size={32} /></div>
                  <h3 className="text-sm font-bold text-gray-900 mb-1">No Hubs Discovered</h3>
                  <p className="text-xs text-gray-400 max-w-xs mx-auto">Initialize service locations to define your operational footprint.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 animate-in fade-in duration-500 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header - Matching Image */}
        <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-black text-gray-900 uppercase tracking-tight">{isCreate ? 'CREATE' : 'EDIT'}</h1>
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              <span>Service Location</span>
              <ChevronRight size={12} className="text-gray-300" />
              <span className="text-gray-900">{isCreate ? 'Create' : 'Edit'}</span>
            </div>
        </div>

        {/* Form Card - Matching Image */}
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-xl shadow-gray-200/20 overflow-hidden p-10">
           {/* Language Tabs */}
           <div className="flex items-center gap-8 border-b border-gray-100 mb-10">
              {ADMIN_LANGUAGE_OPTIONS.map(lang => (
                <button 
                  key={lang}
                  onClick={() => setActiveLangTab(lang)}
                  className={`pb-4 text-[13px] font-bold transition-all relative ${activeLangTab === lang ? 'text-emerald-500' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {lang}
                  {activeLangTab === lang && (
                    <motion.div layoutId="lang-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
                  )}
                </button>
              ))}
           </div>

           <form onSubmit={handleSave} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                 <div className="md:col-span-1 space-y-2">
                    <label className={labelClass}>Name <span className="text-rose-400">*</span></label>
                    <input 
                       value={formData.name}
                       onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                       placeholder={`Enter Name in ${activeLangTab}`} 
                       className={inputClass} 
                       required
                    />
                 </div>

                 <div className="md:col-span-1 border-0" />

                 <div className="space-y-2">
                    <label className={labelClass}>Select Country <span className="text-rose-400">*</span></label>
                    <div className="relative">
                      <select 
                         value={formData.country} 
                         onChange={(e) => setFormData(p => ({ ...p, country: e.target.value }))} 
                         className={inputClass + " appearance-none cursor-pointer"}
                         required
                      >
                         <option value="">Choose Country</option>
                         {countries.map(c => <option key={c._id || c.id} value={c._id || c.id}>{c.name}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className={labelClass}>Currency Code <span className="text-rose-400">*</span></label>
                    <input 
                       value={formData.currency_code} 
                       onChange={(e) => setFormData(p => ({ ...p, currency_code: e.target.value.toUpperCase() }))} 
                       placeholder="Enter Currency Code" 
                       className={inputClass} 
                       required
                    />
                 </div>

                 <div className="space-y-2">
                    <label className={labelClass}>Currency Symbol <span className="text-rose-400">*</span></label>
                    <input 
                       value={formData.currency_symbol} 
                       onChange={(e) => setFormData(p => ({ ...p, currency_symbol: e.target.value }))} 
                       placeholder="Enter Currency Symbol" 
                       className={inputClass} 
                       required
                    />
                 </div>

                 <div className="space-y-2">
                    <label className={labelClass}>Select Timezone <span className="text-rose-400">*</span></label>
                    <div className="relative">
                      <select 
                         value={formData.timezone} 
                         onChange={(e) => setFormData(p => ({ ...p, timezone: e.target.value }))} 
                         className={inputClass + " appearance-none cursor-pointer"}
                         required
                      >
                         <option value="">Choose Timezone</option>
                         {DEFAULT_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                 </div>
              </div>

              <div className="pt-10 flex justify-end">
                 <button 
                    type="submit" disabled={saving}
                    className="px-10 py-3 bg-[#38467F] text-white rounded-lg text-sm font-bold hover:bg-[#2D3866] transition-all shadow-lg active:scale-95 flex items-center gap-2"
                 >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : null}
                    {isEdit ? 'Update' : 'Save'}
                 </button>
              </div>
           </form>
        </div>
      </div>
    </div>
  );
};

export default ServiceLocation;
