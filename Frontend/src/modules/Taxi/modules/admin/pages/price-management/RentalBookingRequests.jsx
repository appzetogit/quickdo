import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Eye,
  Loader2,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  User2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/60';

const statusClasses = {
  pending: 'bg-amber-50 text-amber-700 border-amber-100',
  confirmed: 'bg-sky-50 text-sky-700 border-sky-100',
  assigned: 'bg-violet-50 text-violet-700 border-violet-100',
  end_requested: 'bg-primary-orange/5 text-accent-orange/90 border-primary-orange/10',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-100',
};

const bookingStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'end_requested', label: 'End Requested' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const paymentStatusClasses = {
  pending: 'bg-amber-50 text-amber-700 border-amber-100',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  not_required: 'bg-slate-100 text-slate-600 border-slate-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-100',
};

const formatDateTime = (value) => {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return 'Not set';
  return parsed.toLocaleString();
};

const formatAmount = (value) => `Rs.${Number(value || 0)}`;

const toRentalRequestList = (response) => {
  const candidates = [
    response?.data?.data?.results,
    response?.data?.results,
    response?.results,
    response?.data?.data,
    response?.data,
  ];

  const firstArray = candidates.find((candidate) => Array.isArray(candidate));
  return Array.isArray(firstArray) ? firstArray : [];
};

const RentalBookingRequests = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      try {
        const response = await adminService.getRentalBookingRequests();
        const results = toRentalRequestList(response);
        if (mounted) setItems(results);
      } catch (error) {
        if (mounted) toast.error(error?.message || 'Could not load rental requests.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [itemsPerPage, searchTerm]);

  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const pendingCount = useMemo(() => safeItems.filter((item) => item?.status === 'pending').length, [safeItems]);
  const paidCount = useMemo(() => safeItems.filter((item) => item?.paymentStatus === 'paid').length, [safeItems]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return safeItems;

    return safeItems.filter((item) =>
      [
        item?.bookingReference,
        item?.vehicleName,
        item?.vehicleCategory,
        item?.selectedPackage?.label,
        item?.userId?.name,
        item?.contactName,
        item?.userId?.phone,
        item?.contactPhone,
        item?.serviceLocation?.name,
        item?.status,
        item?.paymentStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [safeItems, searchTerm]);

  const totalEntries = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / itemsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return filteredItems.slice(start, start + itemsPerPage);
  }, [filteredItems, itemsPerPage, safePage]);
  const showingFrom = totalEntries === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const showingTo = totalEntries === 0 ? 0 : showingFrom + paginatedItems.length - 1;

  const selectedRequest = useMemo(
    () => safeItems.find((item) => String(item?.id || item?._id) === String(selectedId)) || null,
    [safeItems, selectedId],
  );

  const updateLocal = (id, patch) => {
    setItems((current) =>
      (Array.isArray(current) ? current : []).map((item) =>
        String(item?.id || item?._id) === String(id) ? { ...item, ...patch } : item,
      ),
    );
  };

  const saveRequest = async () => {
    if (!selectedRequest) return;

    const id = String(selectedRequest.id || selectedRequest._id);
    setSavingId(id);
    try {
      const updated = await adminService.updateRentalBookingRequest(id, {
        status: selectedRequest.status,
        adminNote: selectedRequest.adminNote || '',
      });
      const payload = updated?.data?.data || updated?.data || updated;
      updateLocal(id, payload);
      toast.success('Rental request updated');
    } catch (error) {
      toast.error(error?.message || 'Could not update rental request.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rental Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            Minimal booking queue for rental requests. Open any row to inspect the full request details.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Pending</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{pendingCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Paid</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{paidCount}</p>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by booking ref, customer, vehicle, status"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-300 focus:bg-white"
            />
          </div>

          <div className="flex items-center gap-3 text-sm font-semibold text-slate-500">
            <span>Rows per page</span>
            <select
              value={itemsPerPage}
              onChange={(event) => setItemsPerPage(Math.max(1, Number(event.target.value) || 10))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 outline-none"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
            </select>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" size={30} />
            </div>
          ) : paginatedItems.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/60 px-8 py-14 text-center">
              <h3 className="text-lg font-black text-slate-900">No Rental Requests</h3>
              <p className="mt-2 text-sm font-medium text-slate-500">
                No requests match the current search or no booking has been created yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Booking Ref</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Customer</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Vehicle</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Pickup</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Location</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Advance</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Status</th>
                    <th className="px-4 py-3 text-[11px] font-black uppercase tracking-widest text-slate-400 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => {
                    const id = String(item.id || item._id);
                    return (
                      <tr key={id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-4">
                          <p className="text-sm font-black text-slate-900">{item.bookingReference || 'Not generated'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{formatDateTime(item.createdAt)}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">{item.userId?.name || item.contactName || 'Unknown user'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.userId?.phone || item.contactPhone || 'No phone'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">{item.vehicleName || 'Rental vehicle'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.selectedPackage?.label || item.vehicleCategory || 'Rental'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">{formatDateTime(item.pickupDateTime)}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{Number(item.requestedHours || 0)} hrs</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-bold text-slate-800">{item.serviceLocation?.name || 'Not selected'}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.serviceLocation?.city || item.serviceLocation?.address || '-'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-black text-slate-900">{formatAmount(item.payableNow)}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-400">{item.paymentMethodLabel || item.paymentMethod || 'Pending method'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col gap-2">
                            <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${statusClasses[item.status] || statusClasses.pending}`}>
                              {item.status}
                            </span>
                            <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${paymentStatusClasses[item.paymentStatus] || paymentStatusClasses.pending}`}>
                              {item.paymentStatus}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setSelectedId(id)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Eye size={15} />
                              View Details
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t border-slate-100 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-sm font-semibold text-slate-500">
            Showing {showingFrom} to {showingTo} of {totalEntries} requests
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage === 1}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <span className="text-sm font-black text-slate-800">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage === totalPages}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {selectedRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="relative max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Rental Request Details</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">{selectedRequest.bookingReference || 'Rental booking'}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {selectedRequest.vehicleName || 'Rental vehicle'} · {selectedRequest.selectedPackage?.label || selectedRequest.vehicleCategory || 'Rental'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId('')}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-6 py-6">
              <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-500">
                        <User2 size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Customer</span>
                      </div>
                      <p className="mt-3 text-sm font-black text-slate-900">{selectedRequest.userId?.name || selectedRequest.contactName || 'Unknown user'}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{selectedRequest.userId?.email || selectedRequest.contactEmail || 'No email'}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{selectedRequest.userId?.phone || selectedRequest.contactPhone || 'No phone'}</p>
                    </div>

                    <div className="rounded-2xl bg-slate-50 px-4 py-4">
                      <div className="flex items-center gap-2 text-slate-500">
                        <CreditCard size={15} />
                        <span className="text-xs font-bold uppercase tracking-wide">Payment</span>
                      </div>
                      <p className="mt-3 text-sm font-black text-slate-900">{selectedRequest.paymentMethodLabel || selectedRequest.paymentMethod || 'Not selected'}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {selectedRequest.advancePaymentLabel || 'Advance booking payment'} · {formatAmount(selectedRequest.payment?.amount || selectedRequest.payableNow)}
                      </p>
                      {selectedRequest.payment?.paymentId ? (
                        <p className="mt-1 break-all text-xs font-semibold text-slate-400">Payment ID: {selectedRequest.payment.paymentId}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Trip Snapshot</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <div className="flex items-center gap-2 text-slate-500">
                          <CalendarDays size={15} />
                          <span className="text-xs font-bold uppercase tracking-wide">Pickup</span>
                        </div>
                        <p className="mt-3 text-sm font-black text-slate-900">{formatDateTime(selectedRequest.pickupDateTime)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <div className="flex items-center gap-2 text-slate-500">
                          <Clock3 size={15} />
                          <span className="text-xs font-bold uppercase tracking-wide">Return</span>
                        </div>
                        <p className="mt-3 text-sm font-black text-slate-900">{formatDateTime(selectedRequest.returnDateTime)}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-400">{Number(selectedRequest.requestedHours || 0)} hours requested</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-4 md:col-span-2">
                        <div className="flex items-center gap-2 text-slate-500">
                          <MapPin size={15} />
                          <span className="text-xs font-bold uppercase tracking-wide">Service Location</span>
                        </div>
                        <p className="mt-3 text-sm font-black text-slate-900">{selectedRequest.serviceLocation?.name || 'Not selected'}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">
                          {selectedRequest.serviceLocation?.address || selectedRequest.serviceLocation?.city || 'No address added'}
                        </p>
                        {selectedRequest.serviceLocation?.distanceKm !== null && selectedRequest.serviceLocation?.distanceKm !== undefined ? (
                          <p className="mt-1 text-xs font-semibold text-slate-400">
                            Approx. {Number(selectedRequest.serviceLocation.distanceKm).toFixed(1)} km from rider
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Booking Summary</p>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Vehicle</p>
                        <p className="mt-3 text-sm font-black text-slate-900">{selectedRequest.vehicleName || 'Rental vehicle'}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">{selectedRequest.vehicleCategory || 'Rental'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Package</p>
                        <p className="mt-3 text-sm font-black text-slate-900">{selectedRequest.selectedPackage?.label || 'Standard rental'}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">
                          {formatAmount(selectedRequest.selectedPackage?.price)} · {Number(selectedRequest.selectedPackage?.durationHours || 0)} hours
                        </p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Advance Now</p>
                        <p className="mt-3 text-lg font-black text-slate-900">{formatAmount(selectedRequest.payableNow)}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 px-4 py-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Rental Total</p>
                        <p className="mt-3 text-lg font-black text-slate-900">{formatAmount(selectedRequest.totalCost)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Request Status</p>
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">Booking Status</label>
                        <select
                          value={selectedRequest.status}
                          onChange={(event) => updateLocal(selectedRequest.id || selectedRequest._id, { status: event.target.value })}
                          className={inputClass}
                        >
                          {bookingStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${statusClasses[selectedRequest.status] || statusClasses.pending}`}>
                          {selectedRequest.status}
                        </span>
                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${paymentStatusClasses[selectedRequest.paymentStatus] || paymentStatusClasses.pending}`}>
                          {selectedRequest.paymentStatus}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Admin Notes</p>
                    <textarea
                      rows="8"
                      value={selectedRequest.adminNote || ''}
                      onChange={(event) => updateLocal(selectedRequest.id || selectedRequest._id, { adminNote: event.target.value })}
                      className={`${inputClass} mt-4`}
                      placeholder="Add internal handling notes for this rental request"
                    />
                    <button
                      type="button"
                      onClick={saveRequest}
                      disabled={savingId === String(selectedRequest.id || selectedRequest._id)}
                      className="mt-4 w-full rounded-xl bg-[#2e3c78] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#24305f] disabled:opacity-60"
                    >
                      {savingId === String(selectedRequest.id || selectedRequest._id) ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Quick Meta</p>
                    <div className="mt-4 space-y-3 text-sm font-semibold text-slate-500">
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-slate-400" />
                        <span>{selectedRequest.userId?.phone || selectedRequest.contactPhone || 'No phone'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={14} className="text-slate-400" />
                        <span>{selectedRequest.kycCompleted ? 'KYC submitted in booking flow' : 'KYC not confirmed'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarDays size={14} className="text-slate-400" />
                        <span>Created: {formatDateTime(selectedRequest.createdAt)}</span>
                      </div>
                      {selectedRequest.reviewedAt ? (
                        <div className="flex items-center gap-2">
                          <Clock3 size={14} className="text-slate-400" />
                          <span>Reviewed: {formatDateTime(selectedRequest.reviewedAt)}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default RentalBookingRequests;
