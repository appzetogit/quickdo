import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ChevronRight, Loader2, Pencil, X, ShieldCheck } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

/*
 * Ride insurance plans a rider can add when booking, for all vehicles or the
 * chosen ones (and optionally only some zones). The premium is priced by the
 * server when the ride is booked, charged only if the ride completes, and kept
 * out of the driver's commission and earnings. "Insured rides" lists what was
 * sold and collected, per plan, for the insurer.
 */
const inputClass = 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors';
const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';
const ENDPOINT = '/admin/types/ride-insurance';

const emptyForm = () => ({
  id: null,
  name: '',
  description: '',
  provider: '',
  terms_url: '',
  cover_amount: '',
  premium_type: 'flat',
  premium_value: '',
  all_vehicles: true,
  vehicle_type_ids: [],
  zone_ids: [],
  sort_order: 0,
  active: true,
});

const listFrom = (res) => res?.data?.results || res?.results || res?.data || [];
const errorText = (err) => err?.response?.data?.message || err?.data?.message || err?.message || 'Something went wrong';
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const toggleIn = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300'}`}
  >
    {children}
  </button>
);

const premiumLabel = (plan) => (plan.premium_type === 'percent' ? `${plan.premium_value}% of fare` : rupees(plan.premium_value));

const PlansTab = ({ plans, zones, vehicles, reload }) => {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const zoneName = useMemo(() => Object.fromEntries(zones.map((z) => [String(z.id || z._id), z.name])), [zones]);
  const vehicleName = useMemo(() => Object.fromEntries(vehicles.map((v) => [String(v._id || v.id), v.name])), [vehicles]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, premium_value: Number(form.premium_value), cover_amount: Number(form.cover_amount || 0) };
      if (form.id) await api.patch(`${ENDPOINT}/${form.id}`, body);
      else await api.post(ENDPOINT, body);
      toast.success(form.id ? 'Plan updated' : 'Plan added');
      setForm(null);
      await reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan) => {
    try {
      await api.patch(`${ENDPOINT}/${plan.id}`, { ...plan, active: !plan.active });
      await reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (plan) => {
    if (!window.confirm(`Delete plan "${plan.name}"? Rides already insured keep their cover.`)) return;
    try {
      await api.delete(`${ENDPOINT}/${plan.id}`);
      toast.success('Plan deleted');
      await reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <button onClick={() => setForm(emptyForm())} className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-indigo-700 flex items-center gap-2">
          <Plus size={16} /> Add Plan
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        {plans.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck className="mx-auto text-gray-300 mb-3" size={32} />
            <p className="text-sm font-bold text-gray-400">No insurance plans yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Premium</th>
                <th className="text-left px-4 py-3">Cover</th>
                <th className="text-left px-4 py-3">Vehicles</th>
                <th className="text-left px-4 py-3">Zones</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plans.map((plan) => (
                <tr key={plan.id} className={plan.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-800">{plan.name}</div>
                    {plan.provider && <div className="text-xs text-gray-400">{plan.provider}</div>}
                  </td>
                  <td className="px-4 py-3 font-bold text-indigo-600 whitespace-nowrap">{premiumLabel(plan)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{plan.cover_amount ? rupees(plan.cover_amount) : '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{plan.all_vehicles ? 'All vehicles' : plan.vehicle_type_ids.map((v) => vehicleName[v] || 'Unknown').join(', ')}</td>
                  <td className="px-4 py-3 text-gray-600">{plan.all_zones ? 'All zones' : plan.zone_ids.map((z) => zoneName[z] || 'Unknown').join(', ')}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleActive(plan)}
                      className={`w-10 h-5 rounded-full relative transition-colors ${plan.active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      aria-label={plan.active ? 'Switch off' : 'Switch on'}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${plan.active ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <button onClick={() => setForm({ ...emptyForm(), ...plan, premium_value: String(plan.premium_value), cover_amount: String(plan.cover_amount || '') })} className="p-2 text-gray-400 hover:text-indigo-600" aria-label="Edit"><Pencil size={16} /></button>
                    <button onClick={() => remove(plan)} className="p-2 text-gray-400 hover:text-rose-600" aria-label="Delete"><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={save} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest">{form.id ? 'Edit' : 'New'} Insurance Plan</h2>
              <button type="button" onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Plan name <span className="text-rose-500">*</span></label>
                  <input required className={inputClass} placeholder="Accident cover" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Insurer (optional)</label>
                  <input className={inputClass} placeholder="e.g. ACKO" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
                </div>
              </div>
              <div>
                <label className={labelClass}>What it covers (shown to the rider)</label>
                <textarea rows={2} className={inputClass} placeholder="Accidental injury and hospitalisation during the ride" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Premium <span className="text-rose-500">*</span></label>
                <div className="flex gap-2 mb-2">
                  <Chip active={form.premium_type === 'flat'} onClick={() => setForm({ ...form, premium_type: 'flat' })}>Flat ₹ per ride</Chip>
                  <Chip active={form.premium_type === 'percent'} onClick={() => setForm({ ...form, premium_type: 'percent' })}>% of fare</Chip>
                </div>
                <input type="number" min="0.5" step="0.5" max={form.premium_type === 'percent' ? 50 : undefined} required className={inputClass}
                  placeholder={form.premium_type === 'percent' ? 'e.g. 2 (%)' : 'e.g. 5 (₹)'}
                  value={form.premium_value} onChange={(e) => setForm({ ...form, premium_value: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Cover amount (₹)</label>
                  <input type="number" min="0" className={inputClass} placeholder="100000" value={form.cover_amount} onChange={(e) => setForm({ ...form, cover_amount: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Order in app</label>
                  <input type="number" className={inputClass} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Terms link (optional)</label>
                <input type="url" className={inputClass} placeholder="https://..." value={form.terms_url} onChange={(e) => setForm({ ...form, terms_url: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Vehicles</label>
                <div className="flex gap-2 mb-2">
                  <Chip active={form.all_vehicles} onClick={() => setForm({ ...form, all_vehicles: true })}>All vehicles</Chip>
                  <Chip active={!form.all_vehicles} onClick={() => setForm({ ...form, all_vehicles: false })}>Selected vehicles</Chip>
                </div>
                {!form.all_vehicles && (
                  <div className="flex flex-wrap gap-2">
                    {vehicles.map((v) => {
                      const vid = String(v._id || v.id);
                      return <Chip key={vid} active={form.vehicle_type_ids.includes(vid)} onClick={() => setForm({ ...form, vehicle_type_ids: toggleIn(form.vehicle_type_ids, vid) })}>{v.name}</Chip>;
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className={labelClass}>Zones (none selected = all zones)</label>
                <div className="flex flex-wrap gap-2">
                  {zones.map((z) => {
                    const zid = String(z.id || z._id);
                    return <Chip key={zid} active={form.zone_ids.includes(zid)} onClick={() => setForm({ ...form, zone_ids: toggleIn(form.zone_ids, zid) })}>{z.name}</Chip>;
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <button type="button" onClick={() => setForm(null)} className="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
                {saving && <Loader2 size={14} className="animate-spin" />} Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

const InsuredRidesTab = ({ plans }) => {
  const [filters, setFilters] = useState({ from: '', to: '', planId: '' });
  const [data, setData] = useState({ rides: [], totals: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
        if (params.to) params.to = `${params.to}T23:59:59`;
        const res = await api.get(`${ENDPOINT}/rides`, { params });
        setData(res?.data || res || { rides: [], totals: [] });
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [filters]);

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="date" className={`${inputClass} w-44`} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" className={`${inputClass} w-44`} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <select className={`${inputClass} w-52`} value={filters.planId} onChange={(e) => setFilters({ ...filters, planId: e.target.value })}>
          <option value="">All plans</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        {(data.totals || []).map((t) => (
          <div key={t.plan_id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t.name}</div>
            <div className="text-2xl font-black text-gray-900 mt-1">{rupees(t.premium_collected)}</div>
            <div className="text-xs text-gray-500 mt-1">{t.completed} completed of {t.insured} insured</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
        ) : data.rides.length === 0 ? (
          <p className="py-12 text-center text-sm font-bold text-gray-400">No insured rides</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Booked</th>
                <th className="text-left px-4 py-3">Rider</th>
                <th className="text-left px-4 py-3">Driver</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Cover</th>
                <th className="text-left px-4 py-3">Premium</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rides.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-gray-700">{r.rider?.name}<div className="text-xs text-gray-400">{r.rider?.phone}</div></td>
                  <td className="px-4 py-3 text-gray-700">{r.driver?.name || '—'}<div className="text-xs text-gray-400">{r.driver?.phone}</div></td>
                  <td className="px-4 py-3 text-gray-700">{r.plan}</td>
                  <td className="px-4 py-3 text-gray-600">{r.cover_amount ? rupees(r.cover_amount) : '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-bold text-gray-800">{rupees(r.premium)}</span>
                    <div className="text-xs text-gray-400">{r.premium_charged ? 'charged' : 'not charged'}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

const RideInsurance = () => {
  const [tab, setTab] = useState('plans');
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [zones, setZones] = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const loadPlans = async () => setPlans(listFrom(await api.get(ENDPOINT)));

  useEffect(() => {
    (async () => {
      try {
        const [zoneRes, vehicleRes] = await Promise.all([
          api.get('/admin/zones'),
          api.get('/admin/types/vehicle-types/list'),
        ]);
        setZones(listFrom(zoneRes));
        setVehicles(listFrom(vehicleRes));
        await loadPlans();
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8 font-sans">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Price Management</span>
          <ChevronRight size={12} />
          <span className="text-gray-700 font-semibold tracking-tight uppercase">Ride Insurance</span>
        </div>
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">RIDE INSURANCE</h1>
        <p className="text-xs text-gray-500 mt-1">
          Plans riders can add when booking. Charged only if the ride completes; never part of the driver&apos;s commission or earnings.
        </p>
      </div>

      <div className="flex gap-2 mb-5">
        <Chip active={tab === 'plans'} onClick={() => setTab('plans')}>Plans</Chip>
        <Chip active={tab === 'rides'} onClick={() => setTab('rides')}>Insured rides</Chip>
      </div>

      {tab === 'plans'
        ? <PlansTab plans={plans} zones={zones} vehicles={vehicles} reload={loadPlans} />
        : <InsuredRidesTab plans={plans} />}
    </div>
  );
};

export default RideInsurance;
