import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronRight, Search, UserX, CheckCircle2, XCircle } from 'lucide-react';
import { adminService } from '../../services/adminService';

const DriverDeleteRequests = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [drivers, setDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchDeleteRequests = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await adminService.getDriverDeleteRequests();
      if (response?.success) {
        setDrivers(response?.data?.results || []);
      } else {
        setError(response?.message || 'Unable to load driver delete requests');
      }
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load driver delete requests');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDeleteRequests();
  }, []);

  const handleApprove = async (id) => {
    if (!window.confirm('Approve this driver account deletion request?')) return;
    setIsSubmitting(true);

    try {
      const response = await adminService.approveDriverDeleteRequest(id);
      if (response?.success) {
        fetchDeleteRequests();
      } else {
        alert(response?.message || 'Failed to approve delete request');
      }
    } catch (requestError) {
      alert(requestError?.message || 'Failed to approve delete request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (id) => {
    if (!window.confirm('Reject this driver account deletion request?')) return;
    setIsSubmitting(true);

    try {
      const response = await adminService.rejectDriverDeleteRequest(id);
      if (response?.success) {
        fetchDeleteRequests();
      } else {
        alert(response?.message || 'Failed to reject delete request');
      }
    } catch (requestError) {
      alert(requestError?.message || 'Failed to reject delete request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredDrivers = drivers.filter((item) => {
    const name = String(item.name || '').toLowerCase();
    const mobile = String(item.mobile || item.phone || '');
    const reason = String(item.deletionRequest?.reason || '').toLowerCase();
    const needle = searchTerm.toLowerCase();
    return name.includes(needle) || mobile.includes(searchTerm) || reason.includes(needle);
  });

  const formatDate = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-12 h-12 border-4 border-gray-100 border-t-black rounded-full animate-spin"></div>
        <p className="text-[12px] font-black text-gray-400 uppercase tracking-widest">Loading delete requests...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-1 animate-in fade-in duration-700 font-sans text-gray-950">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2 leading-none uppercase tracking-tighter">Delete Request Drivers</h1>
          <div className="flex items-center gap-2 text-[13px] font-bold text-gray-400">
            <span className="text-gray-950 uppercase tracking-widest leading-none">Driver Management</span>
            <ChevronRight size={14} />
            <span className="uppercase tracking-widest leading-none">Delete Requests</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-600">
          {error}
        </div>
      ) : null}

      <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-[13px] font-black uppercase tracking-widest text-gray-400">
            Total Requests: {drivers.length}
          </div>

          <div className="relative w-full md:w-96 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-rose-500 transition-colors" size={18} />
            <input
              type="text"
              placeholder="Search requests..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-[20px] text-[13px] font-bold focus:bg-white focus:border-rose-100 outline-none transition-all shadow-inner"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden min-h-[420px]">
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                <th className="px-8 py-6">Driver</th>
                <th className="px-6 py-6">Mobile</th>
                <th className="px-6 py-6">Reason</th>
                <th className="px-6 py-6">Requested At</th>
                <th className="px-8 py-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredDrivers.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-8 py-24 text-center opacity-40">
                    <div className="flex flex-col items-center gap-4 text-center">
                      <UserX size={64} strokeWidth={1} />
                      <p className="text-[14px] font-black uppercase tracking-widest text-gray-950">No Driver Delete Requests Found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredDrivers.map((item) => (
                  <tr key={item._id} className="group hover:bg-rose-50/10 transition-all duration-300">
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gray-950 text-white flex items-center justify-center font-black text-[12px] shadow-lg">
                          {(item.name || 'D')[0]}
                        </div>
                        <div>
                          <p className="text-[14px] font-black text-gray-950 tracking-tight leading-none uppercase">{item.name || 'Unknown'}</p>
                          <p className="text-[11px] font-bold text-gray-400 mt-1">{item.email || 'No email'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-6 text-[14px] font-bold text-gray-950">{item.mobile || item.phone || 'N/A'}</td>
                    <td className="px-6 py-6 text-[12px] font-semibold text-gray-500 max-w-[260px]">{item.deletionRequest?.reason || 'N/A'}</td>
                    <td className="px-6 py-6 text-[12px] font-bold text-gray-400">{formatDate(item.deletionRequest?.requestedAt)}</td>
                    <td className="px-8 py-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          disabled={isSubmitting}
                          onClick={() => handleApprove(item._id)}
                          className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all shadow-sm flex items-center gap-2 border border-emerald-100 disabled:opacity-50"
                        >
                          <CheckCircle2 size={14} /> Approve
                        </button>
                        <button
                          disabled={isSubmitting}
                          onClick={() => handleReject(item._id)}
                          className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-sm flex items-center gap-2 border border-rose-100 disabled:opacity-50"
                        >
                          <XCircle size={14} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-8 bg-gray-50/20 border-t border-gray-50 flex items-center justify-between text-[11px] font-black text-gray-400 uppercase tracking-widest">
          <p>Pending Queue: {filteredDrivers.length} requests</p>
          <button
            type="button"
            onClick={() => navigate('/taxi/admin/drivers')}
            className="px-4 py-2 border border-gray-100 rounded-xl hover:text-gray-950 transition-all font-black text-gray-400"
          >
            Back To Drivers
          </button>
        </div>
      </div>

      <div className="bg-rose-950 rounded-[40px] p-8 text-white relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 p-8 opacity-10 -rotate-12 translate-x-4">
          <AlertCircle size={100} strokeWidth={1} />
        </div>
        <div className="relative z-10 max-w-2xl">
          <h4 className="text-[14px] font-black uppercase tracking-[0.15em] mb-3 text-rose-400">Deletion Review Protocol</h4>
          <p className="text-[12px] font-bold text-rose-200/80 leading-relaxed italic">
            "Approving a request deactivates the driver account and removes it from active ride operations. Rejecting keeps the driver account active and unchanged."
          </p>
        </div>
      </div>
    </div>
  );
};

export default DriverDeleteRequests;
