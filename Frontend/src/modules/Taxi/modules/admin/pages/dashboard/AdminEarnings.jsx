import React from 'react';
import {
  BarChart3,
  CalendarDays,
  Car,
  ChevronDown,
  IndianRupee,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react';
import { adminService } from '../../services/adminService';

const RIDER_TYPES = [
  { value: '', label: 'All rider types' },
  { value: 'ride', label: 'Ride' },
  { value: 'parcel', label: 'Parcel' },
  { value: 'intercity', label: 'Intercity' },
];

const PAYMENT_TYPES = [
  { value: '', label: 'All payments' },
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
];

const emptyFilters = {
  from: '',
  to: '',
  zone: '',
  vehicle: '',
  riderType: '',
  paymentMethod: '',
  search: '',
};

const currency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '--';

  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatFilterDate = (value) => {
  if (!value) return 'Select date';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Select date';

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const unwrapResults = (payload, key = 'results') => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  if (Array.isArray(payload?.data?.data?.[key])) return payload.data.data[key];
  return [];
};

const getOptionLabel = (item) => item?.name || item?.type_name || item?.service_location_name || item?.title || 'Option';
const getOptionValue = (item) => String(item?._id || item?.id || getOptionLabel(item));

const StatCard = ({ icon: Icon, label, value, helper, tone = 'emerald' }) => {
  const toneClasses = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-3 text-2xl font-black tracking-tight text-slate-950">{value}</p>
          {helper ? <p className="mt-2 text-xs font-semibold text-slate-500">{helper}</p> : null}
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${toneClasses[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
};

const BreakdownPanel = ({ title, icon: Icon, rows, emptyText }) => {
  const max = Math.max(...rows.map((row) => Number(row.adminCommission || 0)), 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">Commission split</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Icon size={18} />
        </div>
      </div>

      {rows.length ? (
        <div className="space-y-4">
          {rows.slice(0, 5).map((row) => {
            const percent = max ? Math.max(6, (Number(row.adminCommission || 0) / max) * 100) : 0;

            return (
              <div key={row.key || row.label}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-bold text-slate-800">{row.label}</span>
                  <span className="shrink-0 text-sm font-black text-slate-950">{currency(row.adminCommission)}</span>
                </div>
                <div className="h-2 rounded bg-slate-100">
                  <div className="h-2 rounded bg-emerald-500" style={{ width: `${percent}%` }} />
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-400">
                  {row.trips} trips · gross {currency(row.grossFare)}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-400">
          {emptyText}
        </div>
      )}
    </div>
  );
};

const DatePickerField = ({ label, value, onChange }) => {
  const inputRef = React.useRef(null);

  const openPicker = () => {
    if (typeof inputRef.current?.showPicker === 'function') {
      inputRef.current.showPicker();
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.click();
  };

  return (
    <label className="space-y-1">
      <span className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">
        <CalendarDays size={13} /> {label}
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={openPicker}
          className="flex h-10 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-emerald-400"
        >
          <span>{formatFilterDate(value)}</span>
          <ChevronDown size={15} className="text-slate-400" />
        </button>
        <input
          ref={inputRef}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pointer-events-none absolute inset-0 opacity-0"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </label>
  );
};

const AdminEarnings = () => {
  const [filters, setFilters] = React.useState(emptyFilters);
  const [limit, setLimit] = React.useState(10);
  const [page, setPage] = React.useState(1);
  const [zones, setZones] = React.useState([]);
  const [vehicles, setVehicles] = React.useState([]);
  const [data, setData] = React.useState({
    summary: {},
    breakdowns: { zones: [], vehicles: [], riderTypes: [] },
    results: [],
    paginator: { current_page: 1, last_page: 1, total: 0 },
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = React.useCallback(() => {
    setPage(1);
    setFilters(emptyFilters);
  }, []);

  const loadOptions = React.useCallback(async () => {
    try {
      const [zoneRes, vehicleRes] = await Promise.all([
        adminService.getZones(),
        adminService.getVehicleTypes(),
      ]);

      setZones(unwrapResults(zoneRes?.data || zoneRes));
      setVehicles(unwrapResults(vehicleRes?.data || vehicleRes));
    } catch (err) {
      console.error('Failed to load admin earning filters:', err);
    }
  }, []);

  const loadEarnings = React.useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await adminService.getAdminEarnings({
        ...filters,
        page,
        limit,
      });
      const payload = response?.data || response || {};

      setData({
        summary: payload.summary || {},
        breakdowns: payload.breakdowns || { zones: [], vehicles: [], riderTypes: [] },
        results: Array.isArray(payload.results) ? payload.results : [],
        paginator: payload.paginator || { current_page: 1, last_page: 1, total: 0 },
      });
    } catch (err) {
      setError(err?.message || 'Failed to load admin earnings');
      setData({
        summary: {},
        breakdowns: { zones: [], vehicles: [], riderTypes: [] },
        results: [],
        paginator: { current_page: 1, last_page: 1, total: 0 },
      });
    } finally {
      setLoading(false);
    }
  }, [filters, page, limit]);

  React.useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  React.useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  const summary = data.summary || {};
  const paginator = data.paginator || {};
  const hasActiveFilters = Object.values(filters).some((value) => String(value || '').trim() !== '');

  return (
    <div className="min-h-screen bg-[#f7fafc] p-4 text-slate-950 lg:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-600">Admin finance</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Admin Earnings</h1>
          <p className="mt-2 max-w-2xl text-sm font-medium text-slate-500">
            Track every commission hit from completed rides with zone, vehicle, rider type, and payment filters.
          </p>
        </div>
        <button
          type="button"
          onClick={loadEarnings}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={IndianRupee} label="Admin commission" value={currency(summary.adminCommission)} helper={`${summary.totalTrips || 0} completed transactions`} />
        <StatCard icon={Wallet} label="Gross ride fare" value={currency(summary.grossFare)} helper="Total fare before split" tone="cyan" />
        <StatCard icon={ShieldCheck} label="Average commission" value={currency(summary.averageCommission)} helper="Per completed transaction" tone="amber" />
        <StatCard icon={TrendingUp} label="Driver earnings" value={currency(summary.driverEarnings)} helper={`Cash commission ${currency(summary.byCash)}`} tone="rose" />
      </div>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          <DatePickerField label="From" value={filters.from} onChange={(value) => updateFilter('from', value)} />

          <DatePickerField label="To" value={filters.to} onChange={(value) => updateFilter('to', value)} />

          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Zone</span>
            <select value={filters.zone} onChange={(event) => updateFilter('zone', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-emerald-400">
              <option value="">All zones</option>
              {zones.map((zone) => (
                <option key={getOptionValue(zone)} value={getOptionValue(zone)}>{getOptionLabel(zone)}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Vehicle</span>
            <select value={filters.vehicle} onChange={(event) => updateFilter('vehicle', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-emerald-400">
              <option value="">All vehicles</option>
              {vehicles.map((vehicle) => (
                <option key={getOptionValue(vehicle)} value={getOptionValue(vehicle)}>{getOptionLabel(vehicle)}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Rider type</span>
            <select value={filters.riderType} onChange={(event) => updateFilter('riderType', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-emerald-400">
              {RIDER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Payment</span>
            <select value={filters.paymentMethod} onChange={(event) => updateFilter('paymentMethod', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-emerald-400">
              {PAYMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Search</span>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Trip, rider, driver" className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm font-semibold outline-none focus:border-emerald-400" />
            </div>
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear Filter
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <BreakdownPanel title="Zone performance" icon={BarChart3} rows={data.breakdowns.zones || []} emptyText="No zone earnings found." />
        <BreakdownPanel title="Vehicle performance" icon={Car} rows={data.breakdowns.vehicles || []} emptyText="No vehicle earnings found." />
        <BreakdownPanel title="Rider type performance" icon={UserRound} rows={data.breakdowns.riderTypes || []} emptyText="No rider type earnings found." />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Transaction history</p>
            <p className="mt-1 text-sm font-semibold text-slate-600">{paginator.total || 0} commission entries</p>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            Show
            <select value={limit} onChange={(event) => { setPage(1); setLimit(Number(event.target.value)); }} className="h-9 rounded-lg border border-slate-200 bg-white px-2 font-bold outline-none">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
            entries
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left">
            <thead>
              <tr className="bg-slate-50 text-[12px] font-black uppercase tracking-wider text-slate-500">
                <th className="px-5 py-4">Request</th>
                <th className="px-5 py-4">Completed</th>
                <th className="px-5 py-4">Rider</th>
                <th className="px-5 py-4">Driver</th>
                <th className="px-5 py-4">Zone</th>
                <th className="px-5 py-4">Vehicle</th>
                <th className="px-5 py-4">Type</th>
                <th className="px-5 py-4">Payment</th>
                <th className="px-5 py-4 text-right">Gross</th>
                <th className="px-5 py-4 text-right">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <Loader2 className="mx-auto animate-spin text-slate-300" size={34} />
                  </td>
                </tr>
              ) : data.results.length ? (
                data.results.map((row) => (
                  <tr key={row.id} className="text-sm font-semibold text-slate-650 hover:bg-slate-50">
                    <td className="px-5 py-4 font-black text-slate-950">{row.requestId}</td>
                    <td className="px-5 py-4 text-slate-500">{formatDate(row.completedAt)}</td>
                    <td className="px-5 py-4">
                      <p className="font-bold text-slate-900">{row.userName}</p>
                      <p className="text-xs text-slate-400">{row.userPhone || '--'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-bold text-slate-900">{row.driverName}</p>
                      <p className="text-xs text-slate-400">{row.driverPhone || '--'}</p>
                    </td>
                    <td className="px-5 py-4">{row.zoneName}</td>
                    <td className="px-5 py-4">{row.vehicleName}</td>
                    <td className="px-5 py-4">
                      <span className="rounded bg-cyan-50 px-2 py-1 text-xs font-black uppercase text-cyan-700">{row.riderType}</span>
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-black uppercase text-slate-700">{row.paymentMethod}</span>
                    </td>
                    <td className="px-5 py-4 text-right font-black text-slate-900">{currency(row.grossFare)}</td>
                    <td className="px-5 py-4 text-right font-black text-emerald-700">{currency(row.adminCommission)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-sm font-bold text-slate-400">
                    No admin earning transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col justify-between gap-3 border-t border-slate-100 p-4 md:flex-row md:items-center">
          <p className="text-sm font-semibold text-slate-500">
            Page {paginator.current_page || page} of {paginator.last_page || 1}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <button type="button" disabled={page >= (paginator.last_page || 1)} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminEarnings;
