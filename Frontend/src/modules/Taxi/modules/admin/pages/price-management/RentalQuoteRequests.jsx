import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock3,
  IndianRupee,
  Luggage,
  Mail,
  MapPin,
  Phone,
  User2,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/60';

const statusClasses = {
  pending: 'bg-amber-50 text-amber-700',
  reviewing: 'bg-sky-50 text-sky-700',
  quoted: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
};

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : 'Not set');

const normalizeArray = (payload) =>
  payload?.data?.data?.results ||
  payload?.data?.results ||
  payload?.results ||
  [];

const RentalQuoteRequests = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const response = await adminService.getRentalQuoteRequests();
        if (!mounted) return;
        setItems(normalizeArray(response));
      } catch (error) {
        if (mounted) {
          toast.error(error?.message || 'Could not load rental quote requests.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const counts = useMemo(
    () => ({
      open: items.filter((item) => ['pending', 'reviewing'].includes(String(item.status || '').toLowerCase())).length,
      quoted: items.filter((item) => String(item.status || '').toLowerCase() === 'quoted').length,
    }),
    [items],
  );

  const updateLocal = (id, patch) => {
    setItems((current) =>
      current.map((item) => (String(item.id || item._id) === String(id) ? { ...item, ...patch } : item)),
    );
  };

  const saveRequest = async (item) => {
    const id = String(item.id || item._id);
    setSavingId(id);

    try {
      const updated = await adminService.updateRentalQuoteRequest(id, {
        status: item.status,
        adminQuotedAmount: Number(item.adminQuotedAmount || 0),
        adminNote: item.adminNote || '',
      });
      const payload = updated?.data?.data || updated?.data || updated;
      updateLocal(id, payload);
      toast.success(item.status === 'quoted' ? 'Quote shared successfully' : 'Quote request updated');
    } catch (error) {
      toast.error(error?.message || 'Could not update rental quote request.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rental Quote Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review custom quote requirements, update quote amount, and reply with admin notes.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Open</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{counts.open}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Quoted</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{counts.quoted}</p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-400">
            Loading rental quote requests...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-400">
            No rental quote requests found.
          </div>
        ) : (
          items.map((item) => {
            const id = String(item.id || item._id);
            const status = String(item.status || 'pending').toLowerCase();
            const statusClass = statusClasses[status] || statusClasses.pending;

            return (
              <div key={id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-black text-slate-900">{item.vehicleName || 'Rental Vehicle'}</h2>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClass}`}>
                        {status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {item.vehicleCategory || item.vehicleTypeId?.vehicleCategory || 'Vehicle'}
                    </p>
                    <p className="mt-1 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      Request ID: {id}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Quoted Amount</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">
                      Rs {Number(item.adminQuotedAmount || 0).toFixed(0)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><User2 size={14} /><span className="text-xs font-bold uppercase tracking-wide">Customer</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{item.userId?.name || item.contactName || 'Unknown user'}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><Phone size={14} /><span className="text-xs font-bold uppercase tracking-wide">Phone</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{item.userId?.phone || item.contactPhone || 'No phone'}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><Mail size={14} /><span className="text-xs font-bold uppercase tracking-wide">Email</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{item.userId?.email || item.contactEmail || 'No email'}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><Clock3 size={14} /><span className="text-xs font-bold uppercase tracking-wide">Requested Hours</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{Number(item.requestedHours || 0) > 0 ? `${item.requestedHours} hr` : 'Not specified'}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><Users size={14} /><span className="text-xs font-bold uppercase tracking-wide">Seats Needed</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{Number(item.seatsNeeded || 0) > 0 ? item.seatsNeeded : 'Not specified'}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><Luggage size={14} /><span className="text-xs font-bold uppercase tracking-wide">Bags Needed</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{Number(item.luggageNeeded || 0)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><CalendarDays size={14} /><span className="text-xs font-bold uppercase tracking-wide">Pickup Time</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{formatDateTime(item.pickupDateTime)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-500"><CalendarDays size={14} /><span className="text-xs font-bold uppercase tracking-wide">Return Time</span></div>
                    <p className="mt-2 text-sm font-black text-slate-900">{formatDateTime(item.returnDateTime)}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 lg:col-span-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Quote Details</p>
                    <div className="mt-3 space-y-3 text-sm font-semibold text-slate-700">
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                        <div>
                          <p className="font-black text-slate-900">Pickup</p>
                          <p>{item.pickupLocation || 'Not shared yet'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                        <div>
                          <p className="font-black text-slate-900">Drop</p>
                          <p>{item.dropLocation || 'Not shared yet'}</p>
                        </div>
                      </div>
                      <div>
                        <p className="font-black text-slate-900">Special Requirements</p>
                        <p className="mt-1 text-slate-600">{item.specialRequirements || 'No extra requirement added.'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <select
                      value={item.status}
                      onChange={(event) => updateLocal(id, { status: event.target.value })}
                      className={inputClass}
                    >
                      <option value="pending">Pending</option>
                      <option value="reviewing">Reviewing</option>
                      <option value="quoted">Quoted</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    <div className="relative">
                      <IndianRupee size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        min="0"
                        value={item.adminQuotedAmount || ''}
                        onChange={(event) => updateLocal(id, { adminQuotedAmount: event.target.value })}
                        className={`${inputClass} pl-10`}
                        placeholder="Enter quoted amount"
                      />
                    </div>
                    <textarea
                      rows="5"
                      value={item.adminNote || ''}
                      onChange={(event) => updateLocal(id, { adminNote: event.target.value })}
                      className={inputClass}
                      placeholder="Add quote note, rejection reason, or any review details"
                    />
                    <button
                      type="button"
                      onClick={() => saveRequest(item)}
                      disabled={savingId === id}
                      className="w-full rounded-xl bg-[#2e3c78] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#24305f] disabled:opacity-60"
                    >
                      {savingId === id ? 'Saving...' : 'Save Quote Request'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RentalQuoteRequests;
