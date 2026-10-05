import React, { useState, useEffect } from 'react';
import {
   Plus,
   Search,
   MapPin,
   Car,
   ChevronRight,
   Trash2,
   Edit2,
   Save,
   ArrowLeft,
   Loader2,
   CreditCard,
   User,
   Zap,
   Truck,
   Layers,
   ShieldCheck,
   Activity,
   DollarSign,
   Tag,
   Clock,
   ChevronLeft,
   Gift,
   Settings,
   Filter,
   Cone,
   Info,
   ChevronDown,
   Globe,
   Eye,
   Menu
} from 'lucide-react';
import { motion, AnimatePresence } from "framer-motion";
import { API_BASE_URL } from '../../../../shared/api/runtimeConfig';
import { useNavigate, useParams } from 'react-router-dom';
import { useTaxiTransportTypes } from '../../../../shared/hooks/useTaxiTransportTypes';

const inputClass = "w-full border border-gray-200 rounded-md px-4 py-3 text-sm text-gray-800 bg-white focus:border-indigo-500 transition-all outline-none";
const labelClass = "block text-[13px] font-semibold text-gray-700 mb-2.5";
const paymentTypeOptions = [
   { value: 'cash', label: 'Cash' },
   { value: 'online', label: 'Online' },
   { value: 'wallet', label: 'Wallet' },
];

const ALL_ZONES_OPTION = '__ALL_ZONES__';

const getEntityId = (value) => {
   if (!value) return '';
   if (typeof value === 'string') return value;
   return String(value._id || value.id || '');
};

const normalizePaymentTypes = (value) => {
   const items = Array.isArray(value)
      ? value
      : typeof value === 'string'
         ? value.split(',')
         : [];

   const normalized = items
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);

   return Array.from(new Set(normalized)).filter((item) => paymentTypeOptions.some((option) => option.value === item));
};

const normalizeTransportType = (value = '') => {
   const normalized = String(value || '').trim().toLowerCase();
   if (normalized === 'delivery') return 'delivery';
   if (normalized === 'pooling') return 'pooling';
   if (normalized === 'both' || normalized === 'all') return 'both';
   return normalized === 'taxi' ? 'taxi' : '';
};

const togglePaymentType = (currentValue, targetValue) => {
   const currentItems = normalizePaymentTypes(currentValue);

   if (currentItems.includes(targetValue)) {
      return currentItems.filter((item) => item !== targetValue);
   }

   return [...currentItems, targetValue];
};

const StatusToggle = ({ active, onToggle }) => (
   <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`w-11 h-6 rounded-full transition-colors relative flex items-center ${active ? 'bg-[#00BFA5]' : 'bg-gray-200'}`}
   >
      <div className={`absolute w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${active ? 'translate-x-[22px]' : 'translate-x-1'}`} />
   </button>
);

const initialFormState = {
   zone_id: '',
   transport_type: '',
   vehicle_type: '',
   payment_type: ['cash'],
   admin_commision_type: '1',
   admin_commision: '',
   admin_commission_type_from_driver: '1',
   admin_commission_from_driver: '',
   admin_commission_type_for_owner: '1',
   admin_commission_for_owner: '',
   service_tax: '',
   order_number: '',
   base_price: '',
   base_distance: '',
   price_per_distance: '',
   time_price: '',
   waiting_charge: '',
   ride_surge_amount: '',
   free_waiting_before: '',
   free_waiting_after: '',
   enable_airport_ride: false,
   support_airport_fee: '',
   airport_surge: '',
   enable_outstation_ride: false,
   outstation_base_price: '',
   outstation_base_distance: '',
   outstation_price_per_distance: '',
   outstation_time_price: '',
   enable_ride_sharing: false,
   enable_shared_ride: 0,
   price_per_seat: '',
   shared_price_per_distance: '',
   shared_cancel_fee: '',
   user_cancellation_fee: '',
   user_cancellation_fee_type: 'percentage',
   driver_cancellation_fee: '',
   driver_cancellation_fee_type: 'percentage',
   cancellation_fee_goes_to: 'admin',
   enable_cancellation_charge: true,
   free_cancellation_time: 2,
   fixed_cancellation_charge: 0,
   percentage_cancellation_charge: 0,
   charge_after_driver_accepted: true,
   charge_after_driver_reached_pickup: true,
   charge_after_otp: false,
   max_cancellation_fee: 0,
   enable_cancellation_reasons: true,
   cancellation_policy_message: '',
   status: 'active',
   active: 1
};

const SetPrices = ({ mode }) => {
   const navigate = useNavigate();
   const { id } = useParams();
   const isCreateOrEdit = mode === 'create' || mode === 'edit';
   const view = isCreateOrEdit ? 'create' : 'list';
   const editingId = id || null;

   const [prizes, setPrizes] = useState([]);
   const [prizesFull, setPrizesFull] = useState([]);
   const [loading, setLoading] = useState(true);
   const [saving, setSaving] = useState(false);
   const [searchTerm, setSearchTerm] = useState('');

   const [zones, setZones] = useState([]);
   const [vehicleTypes, setVehicleTypes] = useState([]);
   const { transportTypes } = useTaxiTransportTypes();
   const transportTypeOptions = React.useMemo(() => {
      const normalized = new Map();

      (Array.isArray(transportTypes) ? transportTypes : []).forEach((item) => {
         const value = normalizeTransportType(item?.name || item?.transport_type || item?.id || '');
         if (!value) return;

         normalized.set(value, {
            id: item?.id || item?._id || value,
            name: value,
            display_name: value === 'both'
               ? 'Both'
               : (item?.display_name || item?.label || value.charAt(0).toUpperCase() + value.slice(1)),
         });
      });

      if (!normalized.has('taxi')) {
         normalized.set('taxi', { id: 'taxi', name: 'taxi', display_name: 'Taxi' });
      }

      if (!normalized.has('delivery')) {
         normalized.set('delivery', { id: 'delivery', name: 'delivery', display_name: 'Delivery' });
      }

      if (!normalized.has('both')) {
         normalized.set('both', { id: 'both', name: 'both', display_name: 'Both' });
      }

      return Array.from(normalized.values()).filter(t => t.name !== 'pooling');
   }, [transportTypes]);

   const [formData, setFormData] = useState(initialFormState);

   const baseUrl = `${API_BASE_URL}/admin`;
   const token = (localStorage.getItem('admin_accessToken') || localStorage.getItem('adminToken'));

   useEffect(() => {
      fetchInitialData();
   }, [id]);

   useEffect(() => {
      if (mode === 'edit' && id && prizesFull.length > 0) {
         const pData = prizesFull.find(d => (String(d._id || '') === String(id) || String(d.id || '') === String(id)));
         if (pData) {
            setFormData({
               ...initialFormState,
               ...pData,
               zone_id: pData.zone_id?._id || pData.zone_id || '',
               transport_type: normalizeTransportType(pData.transport_type),
               vehicle_type: pData.vehicle_type?._id || pData.vehicle_type || '',
               admin_commision: pData.admin_commision ?? pData.customer_commission ?? '',
               admin_commision_type: String(pData.admin_commision_type ?? 1),
               admin_commission_from_driver: pData.admin_commission_from_driver ?? pData.driver_commission ?? '',
               admin_commission_type_from_driver: String(pData.admin_commission_type_from_driver ?? 1),
               admin_commission_for_owner: pData.admin_commission_for_owner ?? 0,
               admin_commission_type_for_owner: String(pData.admin_commission_type_for_owner ?? 1),
               order_number: pData.order_number ?? pData.eta_sequence ?? '',
               ride_surge_amount: pData.ride_surge_amount ?? '',
               payment_type: normalizePaymentTypes(pData.payment_type).length ? normalizePaymentTypes(pData.payment_type) : ['cash'],
               user_cancellation_fee_type: pData.user_cancellation_fee_type || 'percentage',
               driver_cancellation_fee_type: pData.driver_cancellation_fee_type || 'percentage',
               enable_cancellation_charge: pData.enable_cancellation_charge ?? true,
               free_cancellation_time: pData.free_cancellation_time ?? 2,
               fixed_cancellation_charge: pData.fixed_cancellation_charge ?? 0,
               percentage_cancellation_charge: pData.percentage_cancellation_charge ?? 0,
               charge_after_driver_accepted: pData.charge_after_driver_accepted ?? true,
               charge_after_driver_reached_pickup: pData.charge_after_driver_reached_pickup ?? true,
               charge_after_otp: pData.charge_after_otp ?? false,
               max_cancellation_fee: pData.max_cancellation_fee ?? 0,
               enable_cancellation_reasons: pData.enable_cancellation_reasons ?? true,
               cancellation_policy_message: pData.cancellation_policy_message ?? '',
            });
         }
      } else if (mode === 'create') {
         setFormData({ ...initialFormState });
      }
   }, [mode, id, prizesFull]);

   const fetchInitialData = async () => {
      setLoading(true);
      try {
         const auth = { 'Authorization': `Bearer ${token}` };
         const [prizesRes, zonesRes, vehiclesRes] = await Promise.all([
            fetch(`${baseUrl}/types/set-prices?scope=ride`, { headers: auth }),
            fetch(`${baseUrl}/zones`, { headers: auth }),
            fetch(`${baseUrl}/types/vehicle-types`, { headers: auth })
         ]);

         const [prizesData, zonesData, vehiclesData] = await Promise.all([
            prizesRes.json(), zonesRes.json(), vehiclesRes.json()
         ]);

         if (prizesData.success) {
            const items = prizesData.results || prizesData.data?.results || [];
            const fullItems = prizesData.paginator?.data || items || [];
            setPrizes(items);
            setPrizesFull(fullItems);
         }

         const zItems = zonesData.results || zonesData.data?.zones || JSON.parse(JSON.stringify(zonesData.data?.results || []));
         setZones(Array.isArray(zItems) ? zItems : []);

         const vItems = vehiclesData.results || vehiclesData.data?.vehicle_types || JSON.parse(JSON.stringify(vehiclesData.data?.results || []));
         setVehicleTypes(Array.isArray(vItems) ? vItems : []);

      } catch (error) {
         console.error("Fetch Data Error:", error);
      } finally {
         setLoading(false);
      }
   };

   const handleSave = async (e) => {
      if (e) e.preventDefault();
      setSaving(true);
      try {
         const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
         const basePayload = {
            ...formData,
            enable_ride_sharing: false,
            enable_shared_ride: 0,
            price_per_seat: 0,
            shared_price_per_distance: 0,
            shared_cancel_fee: 0,
            pricing_scope: 'ride',
            transport_type: normalizeTransportType(formData.transport_type),
            payment_type: normalizePaymentTypes(formData.payment_type).length ? normalizePaymentTypes(formData.payment_type) : ['cash'],
            ride_surge_amount: Number(formData.ride_surge_amount || 0),
         };

         if (!editingId && formData.zone_id === ALL_ZONES_OPTION) {
            const availableZones = (Array.isArray(zones) ? zones : []).filter((zone) => getEntityId(zone));
            if (!availableZones.length) {
               alert('No zones available to apply this pricing rule.');
               return;
            }

            for (const zone of availableZones) {
               const zoneId = getEntityId(zone);
               const serviceLocationId = getEntityId(zone.service_location_id || zone.service_location || zone.serviceLocationId);
               const res = await fetch(`${baseUrl}/types/set-prices`, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify({
                     ...basePayload,
                     zone_id: zoneId,
                     service_location_id: serviceLocationId || undefined,
                  })
               });
               const data = await res.json();
               if (!data.success) {
                  throw new Error(data.message || `Failed to save pricing for zone ${zone.name || zoneId}`);
               }
            }

            navigate('/taxi/admin/pricing/set-price');
            fetchInitialData();
            return;
         }

         const method = editingId ? 'PATCH' : 'POST';
         const url = editingId ? `${baseUrl}/types/set-prices/${editingId}` : `${baseUrl}/types/set-prices`;
         const selectedZone = (Array.isArray(zones) ? zones : []).find((zone) => getEntityId(zone) === String(formData.zone_id || ''));
         const serviceLocationId = getEntityId(
            selectedZone?.service_location_id
            || selectedZone?.service_location
            || selectedZone?.serviceLocationId
            || formData.service_location_id
         );

         const res = await fetch(url, {
            method,
            headers,
            body: JSON.stringify({
               ...basePayload,
               service_location_id: serviceLocationId || formData.service_location_id || undefined,
            })
         });
         const data = await res.json();
         if (data.success) {
            navigate('/taxi/admin/pricing/set-price');
            fetchInitialData();
         } else {
            alert(data.message || "Failed to save");
         }
      } catch (error) {
         console.error(error);
         alert(error?.message || 'Failed to save');
      } finally { setSaving(false); }
   };

   const filteredPrizes = prizes.filter(p => {
      const q = searchTerm.toLowerCase();
      return (p.zone_name || '').toLowerCase().includes(q) || (p.vehicle_type_name || '').toLowerCase().includes(q);
   });

   return (
      <div className="min-h-screen bg-[#F8F9FD] flex flex-col font-sans">
         <AnimatePresence mode="wait">
            {view === 'list' ? (
               <motion.div
                  key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="p-6 lg:p-8 space-y-4"
               >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-6">
                     <h1 className="text-sm font-bold text-[#1E293B] uppercase tracking-[0.15em]">SET PRICES</h1>
                     <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium tracking-tight">
                        <span className="hover:text-slate-600 transition-colors cursor-pointer" onClick={() => fetchInitialData()}>Set Prices</span>
                        <ChevronRight size={10} className="text-slate-300" />
                        <span className="text-slate-800 font-bold">Listing</span>
                     </div>
                  </div>

                  <div className="bg-white rounded-md border border-gray-100 shadow-sm overflow-hidden">
                     <div className="p-5 flex items-center justify-between border-b border-gray-50 bg-white px-8">
                        <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
                           <span>show</span>
                           <div className="relative">
                              <select className="appearance-none bg-white border border-gray-200 rounded px-4 py-1.5 pr-8 focus:outline-none focus:border-indigo-500 cursor-pointer text-slate-700 font-bold text-[13px]">
                                 <option>10</option>
                              </select>
                              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                           </div>
                           <span>entries</span>
                        </div>
                        <div className="flex items-center gap-3">
                           <button onClick={() => fetchInitialData()} className={`w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-full text-slate-400 hover:text-indigo-600 transition-all shadow-sm ${loading ? 'animate-spin' : ''}`}>
                              {loading ? <Loader2 size={18} /> : <Search size={18} />}
                           </button>
                           <button className="flex items-center gap-2 px-6 py-2 bg-[#F37048] text-white rounded text-sm font-bold shadow-sm">
                              <Filter size={16} /> Filters
                           </button>
                           <button onClick={() => navigate('/taxi/admin/pricing/set-price/create')} className="flex items-center gap-2 px-6 py-2 bg-[#44516F] text-white rounded text-sm font-bold shadow-sm">
                              <Plus size={18} /> Add Set Price
                           </button>
                        </div>
                     </div>

                     <div className="overflow-x-auto">
                        <table className="w-full text-left">
                           <thead className="bg-[#FBFCFF]">
                              <tr className="border-b border-gray-100 text-[11px] text-slate-800 uppercase font-black tracking-[0.1em]">
                                 <th className="px-8 py-5">Zone</th>
                                 <th className="px-8 py-5">Transport Type</th>
                                 <th className="px-8 py-5">Vehicle Type</th>
                                 <th className="px-8 py-5">Status</th>
                                 <th className="px-8 py-5 text-right pr-12">Action</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-50">
                              {loading && prizes.length === 0 ? (
                                 <tr><td colSpan="5" className="py-24 text-center text-slate-300 font-bold uppercase tracking-widest text-xs animate-pulse">Syncing Price Matrix...</td></tr>
                              ) : filteredPrizes.length === 0 ? (
                                 <tr><td colSpan="5" className="py-24 text-center text-slate-400 italic">No price rules configured.</td></tr>
                              ) : (
                                 filteredPrizes.map((prize) => (
                                    <tr key={prize.id || prize._id} className="hover:bg-slate-50/50 transition-colors">
                                       <td className="px-8 py-6 text-sm font-semibold text-slate-700">{prize.zone_name || 'India'}</td>
                                       <td className="px-8 py-6 text-sm text-slate-600 font-medium">
                                          {prize.transport_type === 'both' ? 'All' : (prize.transport_type === 'taxi' ? 'Ride Hailing' : (prize.transport_type || 'All'))}
                                       </td>
                                       <td className="px-8 py-6 text-sm text-slate-800 font-bold">{prize.vehicle_type_name || 'Premium Car'}</td>
                                       <td className="px-8 py-6">
                                          <StatusToggle active={Number(prize.active) === 1} onToggle={async () => {
                                             try {
                                                await fetch(`${baseUrl}/types/set-prices/${prize.id || prize._id}`, {
                                                   method: 'PATCH',
                                                   headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                                                   body: JSON.stringify({ active: Number(prize.active) === 1 ? 0 : 1 })
                                                });
                                                fetchInitialData();
                                             } catch (e) { }
                                          }} />
                                       </td>
                                       <td className="px-8 py-6 text-right pr-12">
                                          <div className="flex items-center justify-end gap-2">
                                             <button onClick={() => navigate(`/taxi/admin/pricing/set-price/edit/${prize.id || prize._id}`)} className="w-8 h-8 flex items-center justify-center bg-[#FFF7ED] text-[#F97316] rounded transition-colors hover:bg-primary-orange/10"><Edit2 size={14} /></button>
                                             <button
                                                title="set package prices"
                                                onClick={() => navigate('/taxi/admin/pricing/package-pricing')}
                                                className="w-8 h-8 flex items-center justify-center bg-[#F0FDFA] text-[#14B8A6] rounded transition-colors hover:bg-emerald-100"
                                             >
                                                <Gift size={14} />
                                             </button>
                                             <button
                                                title="Surge"
                                                onClick={() => navigate(`/taxi/admin/pricing/set-price/surge/${prize.id || prize._id}`)}
                                                className="w-8 h-8 flex items-center justify-center bg-[#FEF2F2] text-[#EF4444] rounded transition-colors hover:bg-red-100"
                                             >
                                                <Zap size={14} />
                                             </button>
                                             <button
                                                title="driver incentive"
                                                onClick={() => navigate(`/taxi/admin/pricing/set-price/incentive/${prize.id || prize._id}`)}
                                                className="w-8 h-8 flex items-center justify-center bg-[#EEF2FF] text-[#6366F1] rounded transition-colors hover:bg-indigo-100"
                                             >
                                                <Cone size={14} />
                                             </button>
                                          </div>
                                       </td>
                                    </tr>
                                 ))
                              )}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </motion.div>
            ) : (
               <motion.div
                  key="create" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="p-6 lg:p-8 space-y-6"
               >
                  {/* Form Header */}
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-8">
                     <h1 className="text-sm font-bold text-[#1E293B] uppercase tracking-[0.15em]">{mode === 'edit' ? 'EDIT' : 'CREATE'}</h1>
                     <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
                        <span className="hover:text-slate-600 transition-colors cursor-pointer" onClick={() => navigate('/taxi/admin/pricing/set-price')}>Set Prices</span>
                        <ChevronRight size={10} className="text-slate-300" />
                        <span className="text-slate-800 font-bold">{mode === 'edit' ? 'Edit' : 'Create'}</span>
                     </div>
                  </div>

                  <div className="bg-white rounded-md border border-gray-100 shadow-sm p-4 lg:p-10 relative">
                     {loading && mode === 'edit' && (
                        <div className="absolute inset-0 bg-white/80 z-20 flex flex-col items-center justify-center gap-4">
                           <Loader2 className="animate-spin text-indigo-600" size={40} />
                           <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Hydrating Form State...</p>
                        </div>
                     )}

                     <div className="flex justify-end mb-4">
                        <button className="text-[11px] font-bold text-[#00BFA5] underline decoration-dotted underline-offset-4">How It Works</button>
                     </div>

                     <form onSubmit={handleSave} className="space-y-10">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                           {/* Column System */}
                           <div>
                              <label className={labelClass}>Zone <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                 <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.zone_id} onChange={e => setFormData(p => ({ ...p, zone_id: e.target.value }))}>
                                    <option value="">Select Zone</option>
                                    {mode === 'create' && <option value={ALL_ZONES_OPTION}>All Zones</option>}
                                    {zones.map(z => <option key={z._id || z.id} value={z._id || z.id}>{z.name}</option>)}
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Transport Type <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                 <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.transport_type} onChange={e => setFormData(p => ({ ...p, transport_type: e.target.value }))}>
                                    <option value="">Select Transport Type</option>
                                    {transportTypeOptions.map(t => (
                                       <option key={t.id || t._id} value={t.name}>{t.display_name}</option>
                                    ))}
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Vehicle Type <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                 <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.vehicle_type} onChange={e => setFormData(p => ({ ...p, vehicle_type: e.target.value }))}>
                                    <option value="">Select Vehicle Type</option>
                                    {vehicleTypes.map(v => <option key={v._id || v.id} value={v._id || v.id}>{v.name}</option>)}
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Payment Type <span className="text-rose-500">*</span></label>
                              <div className="space-y-3">
                                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {paymentTypeOptions.map((option) => {
                                       const isSelected = normalizePaymentTypes(formData.payment_type).includes(option.value);

                                       return (
                                          <button
                                             key={option.value}
                                             type="button"
                                             onClick={() => setFormData((previous) => ({
                                                ...previous,
                                                payment_type: togglePaymentType(previous.payment_type, option.value),
                                             }))}
                                             className={`rounded-xl border px-4 py-3 text-left transition-all ${isSelected
                                                   ? 'border-emerald-300 bg-emerald-50 shadow-sm'
                                                   : 'border-gray-200 bg-white hover:border-indigo-300'
                                                }`}
                                          >
                                             <div className="flex items-center gap-3">
                                                <div
                                                   className={`flex h-5 w-5 items-center justify-center rounded border text-[11px] font-black ${isSelected
                                                         ? 'border-emerald-500 bg-emerald-500 text-white'
                                                         : 'border-slate-300 bg-white text-transparent'
                                                      }`}
                                                >
                                                   ?
                                                </div>
                                                <div>
                                                   <p className="text-[13px] font-bold text-slate-800">{option.label}</p>
                                                   <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                                      {option.value}
                                                   </p>
                                                </div>
                                             </div>
                                          </button>
                                       );
                                    })}
                                 </div>
                                 <input
                                    type="hidden"
                                    required
                                    value={normalizePaymentTypes(formData.payment_type).join(',')}
                                    onChange={() => { }}
                                 />
                                 <p className="text-[11px] font-medium text-slate-400">Tap as many payment types as you want to allow for this pricing rule.</p>
                                 <div className="flex flex-wrap gap-2">
                                    {normalizePaymentTypes(formData.payment_type).length ? (
                                       normalizePaymentTypes(formData.payment_type).map((type) => (
                                          <span
                                             key={type}
                                             className="rounded-full bg-emerald-50 border border-emerald-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-emerald-700"
                                          >
                                             {paymentTypeOptions.find((option) => option.value === type)?.label || type}
                                          </span>
                                       ))
                                    ) : (
                                       <span className="text-[11px] font-medium text-rose-500">Select at least one payment type.</span>
                                    )}
                                 </div>
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Platform Fee Type <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                 {/* Fixed is 0, not 2. The server's convention is 1 = percentage,
                                     0 = fixed, so the old value of 2 matched neither branch and a
                                     fee saved as "Fixed" could not be read back as fixed. */}
                                 <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.admin_commision_type} onChange={e => setFormData(p => ({ ...p, admin_commision_type: e.target.value }))}>
                                    <option value="">Select Type</option>
                                    <option value="1">Percentage</option>
                                    <option value="0">Fixed</option>
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Platform Fee <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Platform Fee" value={formData.admin_commision} onChange={e => setFormData(p => ({ ...p, admin_commision: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Admin Commission Type From Driver <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                 <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.admin_commission_type_from_driver} onChange={e => setFormData(p => ({ ...p, admin_commission_type_from_driver: e.target.value }))}>
                                    <option value="">Select Type</option>
                                    <option value="1">Percentage</option>
                                    <option value="2">Fixed</option>
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Admin Commission From Driver <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Admin Commission From Driver" value={formData.admin_commission_from_driver} onChange={e => setFormData(p => ({ ...p, admin_commission_from_driver: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Admin Commission Type From Owner <span className="text-rose-500">*</span></label>
                              <div className="relative">
                                 <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.admin_commission_type_for_owner} onChange={e => setFormData(p => ({ ...p, admin_commission_type_for_owner: e.target.value }))}>
                                    <option value="">Select Type</option>
                                    <option value="1">Percentage</option>
                                    <option value="2">Fixed</option>
                                 </select>
                                 <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                              </div>
                           </div>
                           <div>
                              <label className={labelClass}>Admin Commission From Owner <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Admin Commission From Owner" value={formData.admin_commission_for_owner} onChange={e => setFormData(p => ({ ...p, admin_commission_for_owner: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Service Tax (%) <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Service Tax (%)" value={formData.service_tax} onChange={e => setFormData(p => ({ ...p, service_tax: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>ETA Sequence <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Order Number" value={formData.order_number} onChange={e => setFormData(p => ({ ...p, order_number: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Base Price <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Base Price" value={formData.base_price} onChange={e => setFormData(p => ({ ...p, base_price: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Base Distance <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Base Distance" value={formData.base_distance} onChange={e => setFormData(p => ({ ...p, base_distance: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Price Per Distance <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Price Per Distance" value={formData.price_per_distance} onChange={e => setFormData(p => ({ ...p, price_per_distance: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Time Price in Mintue <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Time Price" value={formData.time_price} onChange={e => setFormData(p => ({ ...p, time_price: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Waiting Charge <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Waiting Charge" value={formData.waiting_charge} onChange={e => setFormData(p => ({ ...p, waiting_charge: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Ride Surge Amount <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Enter Ride Surge Amount" value={formData.ride_surge_amount} onChange={e => setFormData(p => ({ ...p, ride_surge_amount: e.target.value }))} />
                           </div>
                           <div>
                              <label className={labelClass}>Free Waiting Time In Minutes Before Start A Ride <span className="text-rose-500">*</span></label>
                              <input type="number" min="0" required className={inputClass} placeholder="Free Waiting Time In Minutes Before Start A Ride" value={formData.free_waiting_before} onChange={e => setFormData(p => ({ ...p, free_waiting_before: e.target.value }))} />
                           </div>

                           <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-12">
                              <div>
                                 <label className={labelClass}>Free Waiting Time In Minutes After Start A Ride <span className="text-rose-500">*</span></label>
                                 <input type="number" min="0" required className={inputClass} placeholder="Free Waiting Time In Minutes After Start A Ride" value={formData.free_waiting_after} onChange={e => setFormData(p => ({ ...p, free_waiting_after: e.target.value }))} />
                              </div>
                           </div>

                           <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-12 pt-4">
                              <div className="flex items-center gap-2 pt-2 ml-1">
                                 <input type="checkbox" className="w-4 h-4 rounded border-gray-300 pointer-events-auto" checked={formData.enable_airport_ride} onChange={e => setFormData(p => ({ ...p, enable_airport_ride: e.target.checked }))} />
                                 <span className="text-[13px] font-semibold text-gray-700">Enable Airport Ride</span>
                              </div>
                           </div>

                           {formData.enable_airport_ride && (
                              <div className="md:col-span-2 space-y-6 pt-6 border-t border-gray-100 mt-4">
                                 <h2 className="text-base font-bold text-[#1E293B] uppercase tracking-wider">Airport Ride</h2>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                    <div>
                                       <label className={labelClass}>Airport Surge Fee <span className="text-rose-500">*</span></label>
                                       <input type="number" min="0" required={formData.enable_airport_ride} className={inputClass} placeholder="Enter Airport Surge Fee" value={formData.airport_surge} onChange={e => setFormData(p => ({ ...p, airport_surge: e.target.value }))} />
                                    </div>
                                    <div>
                                       <label className={labelClass}>Support Airport Fee <span className="text-rose-500">*</span></label>
                                       <input type="number" min="0" required={formData.enable_airport_ride} className={inputClass} placeholder="Enter Support Airport Fee" value={formData.support_airport_fee} onChange={e => setFormData(p => ({ ...p, support_airport_fee: e.target.value }))} />
                                    </div>
                                 </div>
                              </div>
                           )}

                           <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-12">
                              <div className="flex items-center gap-2 pt-2 ml-1">
                                 <input type="checkbox" className="w-4 h-4 rounded border-gray-300 pointer-events-auto" checked={formData.enable_outstation_ride} onChange={e => setFormData(p => ({ ...p, enable_outstation_ride: e.target.checked }))} />
                                 <span className="text-[13px] font-semibold text-gray-700">Enable Outstation Ride</span>
                              </div>
                           </div>

                           {formData.enable_outstation_ride && (
                              <div className="md:col-span-2 space-y-6 pt-6 border-t border-gray-100 mt-4">
                                 <h2 className="text-base font-bold text-[#1E293B] uppercase tracking-wider">Outstation</h2>
                                 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                    <div>
                                       <label className={labelClass}>Base Price <span className="text-rose-500">*</span></label>
                                       <input type="number" min="0" required={formData.enable_outstation_ride} className={inputClass} placeholder="Enter Base Price" value={formData.outstation_base_price} onChange={e => setFormData(p => ({ ...p, outstation_base_price: e.target.value }))} />
                                    </div>
                                    <div>
                                       <label className={labelClass}>Base Distance <span className="text-rose-500">*(Kilometers)</span></label>
                                       <input type="number" min="0" required={formData.enable_outstation_ride} className={inputClass} placeholder="Enter Base Distance" value={formData.outstation_base_distance} onChange={e => setFormData(p => ({ ...p, outstation_base_distance: e.target.value }))} />
                                    </div>
                                    <div>
                                       <label className={labelClass}>Price Per Distance <span className="text-rose-500">*(Kilometers)</span></label>
                                       <input type="number" min="0" required={formData.enable_outstation_ride} className={inputClass} placeholder="Enter Price Per Distance" value={formData.outstation_price_per_distance} onChange={e => setFormData(p => ({ ...p, outstation_price_per_distance: e.target.value }))} />
                                    </div>
                                    <div>
                                       <label className={labelClass}>Time Price in Mintue <span className="text-rose-500">*</span></label>
                                       <input type="number" min="0" required={formData.enable_outstation_ride} className={inputClass} placeholder="Enter Time Price" value={formData.outstation_time_price} onChange={e => setFormData(p => ({ ...p, outstation_time_price: e.target.value }))} />
                                    </div>
                                 </div>
                              </div>
                           )}
                        </div>

                        {/* Section: Cancellation Fee */}
                        <div className="space-y-6 pt-6 border-t border-gray-100">
                           <h2 className="text-base font-bold text-[#1E293B] uppercase tracking-wider">Cancellation Fee Settings</h2>

                           <div className="flex items-center gap-2">
                              <input
                                 type="checkbox"
                                 id="enable_cancellation_charge"
                                 checked={formData.enable_cancellation_charge}
                                 onChange={e => setFormData(p => ({ ...p, enable_cancellation_charge: e.target.checked }))}
                                 className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                              />
                              <label htmlFor="enable_cancellation_charge" className="text-sm font-bold text-[#1E293B] cursor-pointer">
                                 Enable Cancellation Charges
                              </label>
                           </div>

                           {formData.enable_cancellation_charge && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                                 <div>
                                    <label className={labelClass}>Free Cancellation Window (Minutes)</label>
                                    <input
                                       type="number"
                                       min="0"
                                       className={inputClass}
                                       placeholder="e.g. 2"
                                       value={formData.free_cancellation_time}
                                       onChange={e => setFormData(p => ({ ...p, free_cancellation_time: e.target.value }))}
                                    />
                                 </div>


                                 <div>
                                    <label className={labelClass}>Percentage Cancellation Charge (%)</label>
                                    <input
                                       type="number"
                                       min="0"
                                       className={inputClass}
                                       placeholder="e.g. 10 (applied to base fare)"
                                       value={formData.percentage_cancellation_charge}
                                       onChange={e => setFormData(p => ({ ...p, percentage_cancellation_charge: e.target.value }))}
                                    />
                                 </div>

                                 <div>
                                    <label className={labelClass}>Max Cancellation Fee Cap (₹)</label>
                                    <input
                                       type="number"
                                       min="0"
                                       className={inputClass}
                                       placeholder="e.g. 150"
                                       value={formData.max_cancellation_fee}
                                       onChange={e => setFormData(p => ({ ...p, max_cancellation_fee: e.target.value }))}
                                    />
                                 </div>

                                 <div className="md:col-span-2 space-y-4">
                                    <label className={labelClass}>Apply Charge Conditions</label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                       <div className="flex items-center gap-2">
                                          <input
                                             type="checkbox"
                                             id="charge_after_driver_accepted"
                                             checked={formData.charge_after_driver_accepted}
                                             onChange={e => setFormData(p => ({ ...p, charge_after_driver_accepted: e.target.checked }))}
                                             className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                          />
                                          <label htmlFor="charge_after_driver_accepted" className="text-xs font-semibold text-slate-600 cursor-pointer">
                                             Charge after driver accepts
                                          </label>
                                       </div>

                                       <div className="flex items-center gap-2">
                                          <input
                                             type="checkbox"
                                             id="charge_after_driver_reached_pickup"
                                             checked={formData.charge_after_driver_reached_pickup}
                                             onChange={e => setFormData(p => ({ ...p, charge_after_driver_reached_pickup: e.target.checked }))}
                                             className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                          />
                                          <label htmlFor="charge_after_driver_reached_pickup" className="text-xs font-semibold text-slate-600 cursor-pointer">
                                             Charge after driver reaches pickup
                                          </label>
                                       </div>

                                       <div className="flex items-center gap-2">
                                          <input
                                             type="checkbox"
                                             id="charge_after_otp"
                                             checked={formData.charge_after_otp}
                                             onChange={e => setFormData(p => ({ ...p, charge_after_otp: e.target.checked }))}
                                             className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                          />
                                          <label htmlFor="charge_after_otp" className="text-xs font-semibold text-slate-600 cursor-pointer">
                                             Charge after OTP stage
                                          </label>
                                       </div>
                                    </div>
                                 </div>

                                 <div className="flex items-center gap-2 md:col-span-2">
                                    <input
                                       type="checkbox"
                                       id="enable_cancellation_reasons"
                                       checked={formData.enable_cancellation_reasons}
                                       onChange={e => setFormData(p => ({ ...p, enable_cancellation_reasons: e.target.checked }))}
                                       className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                    />
                                    <label htmlFor="enable_cancellation_reasons" className="text-xs font-semibold text-slate-600 cursor-pointer">
                                       Enable cancellation reasons dialog for users
                                    </label>
                                 </div>

                                 <div className="md:col-span-2">
                                    <label className={labelClass}>Cancellation Policy Message (shown to users before cancelling)</label>
                                    <textarea
                                       className={`${inputClass} min-h-[80px] py-2`}
                                       placeholder="e.g. A fee will be charged to compensate the driver if you cancel after 2 minutes."
                                       value={formData.cancellation_policy_message}
                                       onChange={e => setFormData(p => ({ ...p, cancellation_policy_message: e.target.value }))}
                                    />
                                 </div>
                              </div>
                           )}

                           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 pt-4 border-t border-dashed border-gray-100">
                              <div>
                                 <label className={labelClass}>Cancellation Fee Destination <span className="text-rose-500">*</span></label>
                                 <div className="relative">
                                    <select required className={inputClass + " appearance-none cursor-pointer"} value={formData.cancellation_fee_goes_to} onChange={e => setFormData(p => ({ ...p, cancellation_fee_goes_to: e.target.value }))}>
                                       <option value="admin">Admin</option>
                                       <option value="driver">Driver</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                 </div>
                              </div>
                           </div>
                        </div>

                        {/* Footer Action */}
                        <div className="pt-8 flex justify-end">
                           <button type="submit" disabled={saving} className="px-12 py-3.5 bg-[#00BFA5] text-white rounded text-[13px] font-bold shadow-lg hover:opacity-90 transition-all active:scale-95 flex items-center gap-2">
                              {saving && <Loader2 size={16} className="animate-spin" />}
                              {saving ? 'Saving Changes...' : 'Save'}
                           </button>
                        </div>
                     </form>

                     {/* Design Floating Action Button */}
                     <div className="absolute right-8 top-[380px] z-50">
                        <button type="button" className="w-14 h-14 bg-[#00BFA5] text-white rounded-full flex items-center justify-center shadow-2xl hover:rotate-[360deg] transition-all duration-700">
                           <div className="flex flex-col gap-1.5 items-center">
                              <div className="w-6 h-[2.5px] bg-white rounded-full"></div>
                              <div className="w-6 h-[2px] bg-white/70 rounded-full"></div>
                              <div className="w-6 h-[1.5px] bg-white/40 rounded-full"></div>
                           </div>
                        </button>
                     </div>
                  </div>
               </motion.div>
            )}
         </AnimatePresence>
      </div>
   );
};

export default SetPrices;

