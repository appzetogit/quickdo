import React, { useEffect, useMemo, useState } from 'react';
import { Bus, Percent, Receipt, RefreshCcw, Save, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getAdminBuses, upsertAdminBus } from '../../services/busService';

const inputClass =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-400/5';

const BusCommissionManager = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [search, setSearch] = useState('');
  const [buses, setBuses] = useState([]);
  const [drafts, setDrafts] = useState({});

  const loadBuses = async () => {
    setLoading(true);
    try {
      const results = await getAdminBuses();
      setBuses(results);
      setDrafts(
        results.reduce((accumulator, bus) => {
          accumulator[bus.id] = {
            adminCommissionPercentage: String(bus.adminCommissionPercentage ?? '0'),
            serviceTaxPercentage: String(bus.serviceTaxPercentage ?? '0'),
          };
          return accumulator;
        }, {}),
      );
    } catch (error) {
      toast.error(error?.message || 'Failed to load buses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBuses();
  }, []);

  const filteredBuses = useMemo(() => {
    const query = String(search || '').trim().toLowerCase();
    if (!query) {
      return buses;
    }

    return buses.filter((bus) =>
      [
        bus.busName,
        bus.operatorName,
        bus.serviceNumber,
        bus.registrationNumber,
        bus.route?.routeName,
        bus.route?.originCity,
        bus.route?.destinationCity,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [buses, search]);

  const updateDraft = (busId, field, value) => {
    setDrafts((current) => ({
      ...current,
      [busId]: {
        ...(current[busId] || {}),
        [field]: value,
      },
    }));
  };

  const handleSave = async (bus) => {
    const draft = drafts[bus.id] || {};
    setSavingId(bus.id);

    try {
      const payload = {
        ...bus,
        adminCommissionPercentage: Math.min(100, Math.max(0, Number(draft.adminCommissionPercentage || 0))),
        serviceTaxPercentage: Math.min(100, Math.max(0, Number(draft.serviceTaxPercentage || 0))),
      };

      const updated = await upsertAdminBus(payload);
      setBuses((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDrafts((current) => ({
        ...current,
        [updated.id]: {
          adminCommissionPercentage: String(updated.adminCommissionPercentage ?? '0'),
          serviceTaxPercentage: String(updated.serviceTaxPercentage ?? '0'),
        },
      }));
      toast.success(`Updated ${updated.busName || 'bus'} pricing settings`);
    } catch (error) {
      toast.error(error?.message || 'Failed to save bus commission settings');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
              <Percent size={14} />
              Bus Commission
            </div>
            <h1 className="mt-3 text-3xl font-black text-slate-900">Bus Commission & Service Tax</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Manage individual commission and service tax percentages for every bus service.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-[280px]">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className={`${inputClass} pl-11`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search bus, operator, route, or registration"
              />
            </div>
            <button
              type="button"
              onClick={() => navigate('/taxi/admin/bus-service')}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Bus size={16} />
              Open Fleet Manager
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[32px] border border-slate-100 bg-white shadow-sm">
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_140px_200px_200px_150px] gap-4 bg-slate-100 px-6 py-5 text-sm font-black text-slate-700">
            <p>Bus</p>
            <p>Route</p>
            <p>Seat Fare</p>
            <p>Commission %</p>
            <p>Service Tax %</p>
            <p>Action</p>
          </div>

          {loading ? (
            <div className="bg-white px-6 py-10 text-center text-sm font-bold text-slate-400">Loading bus commission settings...</div>
          ) : filteredBuses.length === 0 ? (
            <div className="bg-white px-6 py-10 text-center text-sm font-bold text-slate-400">No buses found.</div>
          ) : (
            <div className="divide-y divide-slate-100 bg-white">
              {filteredBuses.map((bus) => {
                const draft = drafts[bus.id] || {};
                const isSaving = savingId === bus.id;

                return (
                  <div
                    key={bus.id}
                    className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_140px_200px_200px_150px] gap-4 px-6 py-5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-slate-900">{bus.busName || 'Untitled Bus'}</p>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-500">{bus.operatorName || 'Operator not set'}</p>
                      <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        {bus.serviceNumber || 'No service number'} | {bus.registrationNumber || 'No registration'}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">
                        {bus.route?.originCity || 'Origin'} to {bus.route?.destinationCity || 'Destination'}
                      </p>
                      <p className="mt-1 truncate text-xs font-semibold text-slate-500">{bus.route?.routeName || 'Route not set'}</p>
                    </div>

                    <div>
                      <p className="text-base font-black text-slate-900">Rs {bus.seatPrice || 0}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{bus.fareCurrency || 'INR'}</p>
                    </div>

                    <div>
                      <div className="relative">
                        <Percent size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          className={`${inputClass} pl-10`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={draft.adminCommissionPercentage ?? '0'}
                          onChange={(event) => updateDraft(bus.id, 'adminCommissionPercentage', event.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="relative">
                        <Receipt size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          className={`${inputClass} pl-10`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={draft.serviceTaxPercentage ?? '0'}
                          onChange={(event) => updateDraft(bus.id, 'serviceTaxPercentage', event.target.value)}
                        />
                      </div>
                    </div>

                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => handleSave(bus)}
                        disabled={isSaving}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusCommissionManager;
