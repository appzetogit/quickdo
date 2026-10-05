import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ChevronRight, Loader2, Pencil, X, Zap } from 'lucide-react';
import api from '../../../../shared/api/axiosInstance';
import toast from 'react-hot-toast';

/*
 * Time-slot surge, zone-wise: in the chosen zones, on the chosen days, between
 * two times, rides cost a percentage more -- for all vehicles or the chosen
 * ones. A day can hold as many slots as needed; overlapping slots for the same
 * zone and vehicle are refused by the server. While a slot runs it replaces the
 * zone's flat surge from Set Price. Times are India time (IST).
 */
const inputClass = 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors';
const labelClass = 'block text-xs font-semibold text-gray-500 mb-1.5';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ENDPOINT = '/admin/types/surge-slots';

const emptyForm = () => ({
  id: null,
  name: '',
  zone_ids: [],
  all_vehicles: true,
  vehicle_type_ids: [],
  days: [1, 2, 3, 4, 5],
  start_time: '08:00',
  end_time: '11:00',
  percent: '',
  active: true,
});

const listFrom = (res) => res?.data?.results || res?.results || res?.data || [];
const errorText = (err) => err?.response?.data?.message || err?.data?.message || err?.message || 'Something went wrong';

const formatTime = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
};

const formatDays = (days = []) => {
  const sorted = [...days].sort();
  if (sorted.length === 7) return 'Every day';
  if (sorted.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (sorted.join() === '0,6') return 'Weekends';
  return sorted.map((d) => DAYS[d]).join(', ');
};

const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${active ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300'}`}
  >
    {children}
  </button>
);

const toggleIn = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

const SurgePricing = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slots, setSlots] = useState([]);
  const [zones, setZones] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [zoneFilter, setZoneFilter] = useState('');
  const [form, setForm] = useState(null);

  const zoneName = useMemo(() => Object.fromEntries(zones.map((z) => [String(z.id || z._id), z.name])), [zones]);
  const vehicleName = useMemo(() => Object.fromEntries(vehicles.map((v) => [String(v._id || v.id), v.name])), [vehicles]);

  const loadSlots = async () => setSlots(listFrom(await api.get(ENDPOINT)));

  useEffect(() => {
    (async () => {
      try {
        const [zoneRes, vehicleRes] = await Promise.all([
          api.get('/admin/zones'),
          api.get('/admin/types/vehicle-types/list'),
        ]);
        setZones(listFrom(zoneRes));
        setVehicles(listFrom(vehicleRes));
        await loadSlots();
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visibleSlots = zoneFilter ? slots.filter((s) => s.zone_ids.includes(zoneFilter)) : slots;

  const openNew = () => setForm({ ...emptyForm(), zone_ids: zoneFilter ? [zoneFilter] : [] });
  const openEdit = (slot) => setForm({
    ...emptyForm(),
    ...slot,
    percent: String(slot.percent),
  });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, percent: Number(form.percent) };
      if (form.id) await api.patch(`${ENDPOINT}/${form.id}`, body);
      else await api.post(ENDPOINT, body);
      toast.success(form.id ? 'Surge slot updated' : 'Surge slot added');
      setForm(null);
      await loadSlots();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (slot) => {
    try {
      await api.patch(`${ENDPOINT}/${slot.id}`, { ...slot, active: !slot.active });
      await loadSlots();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const remove = async (slot) => {
    if (!window.confirm(`Delete surge slot "${slot.name || `${slot.start_time}–${slot.end_time}`}"?`)) return;
    try {
      await api.delete(`${ENDPOINT}/${slot.id}`);
      toast.success('Surge slot deleted');
      await loadSlots();
    } catch (err) {
      toast.error(errorText(err));
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8 font-sans">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Price Management</span>
          <ChevronRight size={12} />
          <span className="text-gray-700 font-semibold tracking-tight uppercase">Surge Time Slots</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">SURGE TIME SLOTS</h1>
            <p className="text-xs text-gray-500 mt-1">
              Extra % on the ride fare during set hours, per zone. While a slot runs it replaces the zone&apos;s flat surge. Times are IST.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className={`${inputClass} w-48`} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
              <option value="">All zones</option>
              {zones.map((z) => <option key={z.id || z._id} value={String(z.id || z._id)}>{z.name}</option>)}
            </select>
            <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-md hover:bg-indigo-700 flex items-center gap-2 whitespace-nowrap">
              <Plus size={16} /> Add Slot
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        {visibleSlots.length === 0 ? (
          <div className="py-16 text-center">
            <Zap className="mx-auto text-gray-300 mb-3" size={32} />
            <p className="text-sm font-bold text-gray-400">No surge slots yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Slot</th>
                <th className="text-left px-4 py-3">Zones</th>
                <th className="text-left px-4 py-3">Days</th>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Surge</th>
                <th className="text-left px-4 py-3">Vehicles</th>
                <th className="text-left px-4 py-3">Active</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleSlots.map((slot) => (
                <tr key={slot.id} className={slot.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-semibold text-gray-800">{slot.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{slot.zone_ids.map((z) => zoneName[z] || 'Unknown').join(', ')}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDays(slot.days)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                    {slot.end_time <= slot.start_time && <span className="ml-1 text-[10px] text-amber-600 font-bold">(next day)</span>}
                  </td>
                  <td className="px-4 py-3 font-bold text-indigo-600">+{slot.percent}%</td>
                  <td className="px-4 py-3 text-gray-600">
                    {slot.all_vehicles ? 'All vehicles' : slot.vehicle_type_ids.map((v) => vehicleName[v] || 'Unknown').join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleActive(slot)}
                      className={`w-10 h-5 rounded-full relative transition-colors ${slot.active ? 'bg-emerald-500' : 'bg-gray-300'}`}
                      aria-label={slot.active ? 'Switch off' : 'Switch on'}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${slot.active ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <button onClick={() => openEdit(slot)} className="p-2 text-gray-400 hover:text-indigo-600" aria-label="Edit"><Pencil size={16} /></button>
                    <button onClick={() => remove(slot)} className="p-2 text-gray-400 hover:text-rose-600" aria-label="Delete"><Trash2 size={16} /></button>
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
              <h2 className="text-sm font-black text-gray-800 uppercase tracking-widest">{form.id ? 'Edit' : 'New'} Surge Slot</h2>
              <button type="button" onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className={labelClass}>Name (optional)</label>
                <input className={inputClass} placeholder="e.g. Morning peak" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div>
                <label className={labelClass}>Zones <span className="text-rose-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {zones.map((z) => {
                    const id = String(z.id || z._id);
                    return <Chip key={id} active={form.zone_ids.includes(id)} onClick={() => setForm({ ...form, zone_ids: toggleIn(form.zone_ids, id) })}>{z.name}</Chip>;
                  })}
                </div>
              </div>

              <div>
                <label className={labelClass}>Days <span className="text-rose-500">*</span></label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d, i) => (
                    <Chip key={d} active={form.days.includes(i)} onClick={() => setForm({ ...form, days: toggleIn(form.days, i) })}>{d}</Chip>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Start (IST)</label>
                  <input type="time" required className={inputClass} value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>End (IST)</label>
                  <input type="time" required className={inputClass} value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Surge %</label>
                  <input type="number" min="1" max="300" step="0.5" required className={inputClass} placeholder="20" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
                </div>
              </div>
              {form.end_time && form.start_time && form.end_time < form.start_time && (
                <p className="text-xs text-amber-600 -mt-3">Ends the next day (runs past midnight).</p>
              )}

              <div>
                <label className={labelClass}>Vehicles</label>
                <div className="flex gap-2 mb-2">
                  <Chip active={form.all_vehicles} onClick={() => setForm({ ...form, all_vehicles: true })}>All vehicles</Chip>
                  <Chip active={!form.all_vehicles} onClick={() => setForm({ ...form, all_vehicles: false })}>Selected vehicles</Chip>
                </div>
                {!form.all_vehicles && (
                  <div className="flex flex-wrap gap-2">
                    {vehicles.map((v) => {
                      const id = String(v._id || v.id);
                      return <Chip key={id} active={form.vehicle_type_ids.includes(id)} onClick={() => setForm({ ...form, vehicle_type_ids: toggleIn(form.vehicle_type_ids, id) })}>{v.name}</Chip>;
                    })}
                  </div>
                )}
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
    </div>
  );
};

export default SurgePricing;
