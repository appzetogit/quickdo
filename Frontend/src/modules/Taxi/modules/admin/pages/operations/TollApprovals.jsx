import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';
import { socketService } from '../../../../shared/api/socket';

/**
 * Tolls drivers paid during trips (SOW plan §4.3).
 *
 * A toll within the per-ride auto-approve limit (Transport Ride Settings) is
 * approved on the spot; the rest wait here. An approved toll is added to the
 * rider's fare as its own line when the ride completes. Approved after the
 * ride was settled, the platform pays it to the driver instead -- the rider
 * has already paid.
 */
const STATUS_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : '-');

const TollApprovals = () => {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [paginator, setPaginator] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await adminService.getRideTolls({ status, page });
      const data = response?.data?.data || response?.data || {};
      setRows(Array.isArray(data.results) ? data.results : []);
      setPaginator(data.paginator || { current_page: 1, last_page: 1, total: 0 });
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to load tolls');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  // A new pending toll from a driver refreshes the queue.
  useEffect(() => {
    const onPending = () => {
      if (status === 'pending' || status === 'all') load();
    };
    socketService.on('taxi:toll:pending', onPending);
    return () => socketService.off('taxi:toll:pending', onPending);
  }, [load, status]);

  const decide = async (row, decision) => {
    const note = decision === 'reject' ? (window.prompt('Reason for rejecting (optional)') ?? null) : '';
    if (note === null) return;
    setBusyId(row.toll.id);
    try {
      const response = await adminService.reviewRideToll(row.rideId, row.toll.id, decision, note);
      const data = response?.data?.data || response?.data || {};
      toast.success(
        decision === 'approve'
          ? (data.settledToDriver ? 'Approved. The ride was already settled, so the driver was paid the toll.' : 'Approved. It will be added to the fare.')
          : 'Rejected.',
      );
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Could not save the decision');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9] p-4 md:p-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Toll Approvals</h1>
          <p className="text-sm text-slate-500">Tolls drivers paid during trips, with their receipts.</p>
        </div>

        <div className="flex gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setStatus(tab.id); setPage(1); }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${status === tab.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-slate-400"><Loader2 className="animate-spin" /></div>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">No tolls here.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Paid at</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Trip</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.toll.id}>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(row.toll.at)}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{row.driver?.name || '-'}</p>
                      <p className="text-xs text-slate-500">{row.driver?.vehicleNumber || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p className="max-w-[260px] truncate">{row.pickupAddress} → {row.dropAddress}</p>
                      <p className="text-slate-400">{row.rideStatus}{row.completedAt ? ` · ${formatDateTime(row.completedAt)}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900">Rs {Number(row.toll.amount || 0)}</td>
                    <td className="px-4 py-3">
                      {row.toll.receiptPhotoUrl ? (
                        <a href={row.toll.receiptPhotoUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline">View</a>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-semibold capitalize">{row.toll.status}</span>
                      {row.toll.autoApproved && <span className="ml-1 text-slate-400">(auto)</span>}
                      {row.toll.settledAfterCompletion && <p className="text-slate-400">paid to driver</p>}
                      {row.toll.note && <p className="text-slate-400">{row.toll.note}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {row.toll.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busyId === row.toll.id}
                            onClick={() => decide(row, 'approve')}
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            <Check size={14} /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={busyId === row.toll.id}
                            onClick={() => decide(row, 'reject')}
                            className="flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 disabled:opacity-50"
                          >
                            <X size={14} /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {paginator.last_page > 1 && (
          <div className="flex items-center justify-end gap-3 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">Previous</button>
            <span className="text-slate-500">Page {paginator.current_page} of {paginator.last_page}</span>
            <button type="button" disabled={page >= paginator.last_page} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TollApprovals;
