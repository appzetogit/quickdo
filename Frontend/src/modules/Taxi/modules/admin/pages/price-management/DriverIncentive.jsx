import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import api from '../../../../shared/api/axiosInstance';
import { BACKEND_ORIGIN } from '../../../../shared/api/runtimeConfig';
import toast from 'react-hot-toast';

/*
 * Same shared ladder engine Food/Quick/Medical already use
 * (Backend/src/core/incentives/), scoped here by vehicle type as well as
 * zone -- an e-rickshaw and a cab earn at different rates for the same ride
 * count. Mounted under /platform/settings, not /taxi/..., so this instance's
 * baseURL (always taxi-scoped -- see runtimeConfig.js) can't be used as-is;
 * requests below build the absolute URL off BACKEND_ORIGIN the same way this
 * panel's own token-refresh call already does (see axiosInstance.js).
 */
const SEGMENT = 'taxiAndPorter';
const incentiveRulesUrl = (suffix = '') => `${BACKEND_ORIGIN}/api/v1/platform/settings/incentive-rules${suffix}`;

/*
 * The request interceptor picks a token by matching `config.url` against
 * path patterns like /^\/admin(\/|$)/ -- all written for a relative path,
 * so they never match the absolute URL incentiveRulesUrl() builds. Passed
 * explicitly here rather than relying on the interceptor's last-resort
 * "nothing else matched" fallback, which happens to also land on the admin
 * token today but isn't written with this call in mind.
 */
const adminAuthHeaders = () => {
  const token = localStorage.getItem('admin_accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** One row → one tier. "From" is derived, not asked for: row 1 covers
 *  1..minRides, row 2 covers (row 1's minRides + 1)..minRides, and so on --
 *  the same ladder shape Food's own incentive screen builds, just entered as
 *  a single running threshold per row instead of a from/to pair. */
function tiersFromRows(rows) {
  const tiers = [];
  let from = 1;
  for (const row of rows) {
    const to = Number(row.min_rides);
    const amount = Number(row.amount);
    if (!Number.isFinite(to) || to < from) {
      throw new Error('Each row\'s "minimum rides" must be higher than the one before it');
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Each row needs a non-negative incentive amount');
    }
    tiers.push({ fromOrders: from, toOrders: Math.round(to), rewardAmount: Math.round(amount * 100) / 100 });
    from = to + 1;
  }
  return tiers;
}

/** The inverse, for loading a saved rule back into rows this screen edits. */
function rowsFromTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return [{ min_rides: '0', amount: '0' }];
  return tiers.map((t) => ({ min_rides: String(t.toOrders), amount: String(t.rewardAmount) }));
}

const idOf = (v) => (v && typeof v === 'object' ? String(v._id || v.id || '') : v ? String(v) : '');

const DriverIncentive = () => {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('daily');
  const [rowsByWindow, setRowsByWindow] = useState({
    daily: [{ min_rides: '0', amount: '0' }],
    weekly: [{ min_rides: '0', amount: '0' }],
  });
  const [details, setDetails] = useState({ zone_name: '', vehicle_type: '', zoneId: '', vehicleTypeId: '' });

  const rows = rowsByWindow[activeTab];
  const setRows = (next) => setRowsByWindow((prev) => ({ ...prev, [activeTab]: next }));

  const load = useCallback(async () => {
    try {
      setLoading(true);
      // axiosInstance interceptor already returns response.data
      const res = await api.get('/admin/types/set-prices');
      const items = res.results || res.data?.results || res.data || [];
      const target = items.find((i) => String(i.id || i._id) === String(id));

      const zoneId = idOf(target?.zone_id);
      const vehicleTypeId = idOf(target?.vehicle_type);
      setDetails({
        zone_name: target?.zone_id?.name || target?.zone_name || 'Global',
        vehicle_type: target?.vehicle_type?.name || target?.vehicle_type_name || 'Vehicle',
        zoneId,
        vehicleTypeId,
      });

      // Both windows' existing ladders for this exact (zone, vehicle type),
      // if any -- an admin editing Weekly must not see Daily's numbers, and
      // switching tabs must not silently drop whichever window they'd
      // already typed into.
      const rulesRes = await api.get(incentiveRulesUrl(), { headers: adminAuthHeaders() });
      const active = rulesRes?.data?.active || rulesRes?.data?.data?.active || [];
      const matches = (windowType) =>
        active.find(
          (r) =>
            r.segment === SEGMENT &&
            r.windowType === windowType &&
            idOf(r.zoneId) === zoneId &&
            idOf(r.vehicleTypeId) === vehicleTypeId,
        );
      const daily = matches('daily');
      const weekly = matches('weekly');
      setRowsByWindow({
        daily: rowsFromTiers(daily?.tiers),
        weekly: rowsFromTiers(weekly?.tiers),
      });
    } catch (err) {
      console.error('Fetch incentive details failed:', err);
      toast.error('Could not load this vehicle type\'s incentive settings');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const addRow = () => {
    setRows([...rows, { min_rides: '0', amount: '0' }]);
  };

  const removeRow = (index) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index, field, value) => {
    const next = [...rows];
    next[index] = { ...next[index], [field]: value };
    setRows(next);
  };

  const handleSubmit = async () => {
    let tiers;
    try {
      tiers = tiersFromRows(rows);
    } catch (err) {
      toast.error(err.message);
      return;
    }
    if (tiers.length === 0) {
      toast.error('Add at least one row');
      return;
    }

    setSaving(true);
    try {
      await api.put(
        incentiveRulesUrl(),
        {
          segment: SEGMENT,
          tiers,
          zoneId: details.zoneId || null,
          zoneName: details.zone_name,
          vehicleTypeId: details.vehicleTypeId || null,
          vehicleTypeName: details.vehicle_type,
          windowType: activeTab,
        },
        { headers: adminAuthHeaders() },
      );
      toast.success(`${activeTab === 'daily' ? 'Daily' : 'Weekly'} incentive saved`);
      await load();
    } catch (err) {
      toast.error(err?.message || 'Could not save the incentive');
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
    <div className="min-h-screen bg-[#F8F9FD] p-6 lg:p-10 font-sans">

      {/* Header Block */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-10">
        <h1 className="text-[13px] font-black text-gray-800 uppercase tracking-widest">INCENTIVE</h1>
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
          <span>Incentive</span>
          <ChevronRight size={12} strokeWidth={3} />
          <span className="text-gray-600">Incentive</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <div className="bg-white border-2 border-dashed border-indigo-100 rounded-xl p-6 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-indigo-100 bg-indigo-50/50 px-3 py-1 rounded-full uppercase mb-2">Zone</span>
          <span className="text-sm font-bold text-gray-700">{details.zone_name}</span>
        </div>
        <div className="bg-white border-2 border-dashed border-indigo-100 rounded-xl p-6 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-black text-indigo-100 bg-indigo-50/50 px-3 py-1 rounded-full uppercase mb-2">Vehicle Type</span>
          <span className="text-sm font-bold text-gray-700">{details.vehicle_type}</span>
        </div>
      </div>

      {/* Tabs & Content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden min-h-[400px] flex flex-col">
        <div className="flex border-b border-gray-100 h-16">
          <button
            onClick={() => setActiveTab('daily')}
            className={`flex-1 flex items-center justify-center text-[12px] font-black uppercase tracking-widest transition-all relative ${activeTab === 'daily' ? 'text-[#00BFA5]' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Daily
            {activeTab === 'daily' && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#00BFA5]" />}
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`flex-1 flex items-center justify-center text-[12px] font-black uppercase tracking-widest transition-all relative ${activeTab === 'weekly' ? 'text-[#00BFA5]' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Weekly
            {activeTab === 'weekly' && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#00BFA5]" />}
          </button>
        </div>

        <div className="p-8 space-y-8 flex-grow">
          <div className="flex justify-end">
            <button onClick={addRow} className="bg-[#405189] text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md hover:bg-[#344475] transition-all flex items-center gap-2">
              <Plus size={14} /> Add
            </button>
          </div>

          <div className="space-y-6">
            {rows.map((row, idx) => (
              <div key={idx} className="flex flex-col md:flex-row items-end gap-6 animate-in slide-in-from-left-4 duration-300">
                <div className="flex-1 space-y-2 w-full">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">
                    Minimum {activeTab === 'weekly' ? 'Rides This Week' : 'Ride'} Should Complete
                  </label>
                  <input
                    type="number"
                    value={row.min_rides}
                    onChange={(e) => updateRow(idx, 'min_rides', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 focus:border-indigo-500 outline-none"
                  />
                </div>
                <div className="flex-1 space-y-2 w-full">
                  <label className="text-[10px] font-bold text-gray-400 uppercase">Incentive Amount</label>
                  <input
                    type="number"
                    value={row.amount}
                    onChange={(e) => updateRow(idx, 'amount', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm font-bold text-gray-700 focus:border-indigo-500 outline-none"
                  />
                </div>
                <button
                  onClick={() => removeRow(idx)}
                  className="p-2.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors mb-0.5"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-8 border-t border-gray-50 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[#405189] text-white px-10 py-2.5 rounded-lg text-sm font-bold shadow-xl hover:bg-[#344475] transition-all active:scale-95 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DriverIncentive;
