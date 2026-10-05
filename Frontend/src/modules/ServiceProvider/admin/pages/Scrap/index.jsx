import React, { useState, useEffect } from 'react';
import { FiTrash2, FiSearch, FiFilter } from 'react-icons/fi';
import api from '@sp/services/api';
import { toast } from 'react-hot-toast';

const AdminScrapPage = () => {
  const [scraps, setScraps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchScrap();
  }, []);

  const fetchScrap = async () => {
    try {
      setLoading(true);
      const res = await api.get('/scrap/all');
      if (res.data.success) {
        setScraps(res.data.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch scrap items');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (id) => {
    if (!window.confirm('Are you sure you want to confirm this pickup?')) return;
    try {
      const res = await api.put(`/scrap/${id}/accept`);
      if (res.data.success) {
        toast.success(res.data.message || 'Pickup confirmed');
        fetchScrap();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to confirm pickup');
    }
  };

  const handleComplete = async (id) => {
    if (!window.confirm('Mark this transaction as completed?')) return;
    try {
      const res = await api.put(`/scrap/${id}/complete`);
      if (res.data.success) {
        toast.success('Transaction marked as completed');
        fetchScrap();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to complete transaction');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this scrap item?')) return;
    try {
      const res = await api.delete(`/scrap/${id}`);
      if (res.data.success) {
        toast.success('Scrap deleted successfully');
        fetchScrap();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete scrap');
    }
  };

  const filteredScraps = scraps.filter(item => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Filters */}
        <div className="p-3 border-b border-gray-100 flex gap-2 overflow-x-auto bg-gray-50/50">
          {['all', 'pending', 'accepted', 'completed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${filter === f ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50/50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Item</th>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Vendor</th>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan="7" className="px-4 py-8 text-center text-xs text-gray-500 font-medium">Loading items...</td></tr>
              ) : filteredScraps.length === 0 ? (
                <tr><td colSpan="7" className="px-4 py-8 text-center text-xs text-gray-500 font-medium">No items found</td></tr>
              ) : (
                filteredScraps.map((item) => (
                  <tr key={item._id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.images && item.images[0] && (
                          <img src={item.images[0]} alt="" className="w-8 h-8 rounded object-cover border border-gray-100" />
                        )}
                        <div>
                          <p className="text-xs font-bold text-gray-900">{item.title}</p>
                          <p className="text-[10px] text-gray-500">{item.category} • {item.quantity} • ₹{item.expectedPrice || 0}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-bold text-gray-900">{item.userId?.name}</p>
                      <p className="text-[10px] text-gray-500">{item.userId?.phone}</p>
                    </td>
                    <td className="px-4 py-3">
                      {item.vendorId ? (
                        <div>
                          <p className="text-xs font-bold text-gray-900">{item.vendorId?.name}</p>
                          <p className="text-[10px] text-gray-500">{item.vendorId?.phone}</p>
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-[9px] font-bold rounded-full uppercase tracking-wider
                        ${item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : ''}
                        ${item.status === 'accepted' ? 'bg-green-100 text-green-700' : ''}
                        ${item.status === 'completed' ? 'bg-gray-100 text-gray-700' : ''}
                      `}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[10px] text-gray-500 font-medium max-w-[150px] line-clamp-2">
                        {item.address?.addressLine1}, {item.address?.city}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-gray-500 font-medium">
                      {new Date(item.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {item.status === 'pending' && (
                          <button
                            onClick={() => handleAccept(item._id)}
                            className="px-2 py-1 bg-blue-600 text-white text-[9px] font-bold rounded uppercase tracking-wider hover:bg-blue-700 transition-colors"
                          >
                            Confirm Pickup / Buy
                          </button>
                        )}
                        {item.status === 'accepted' && (
                          <button
                            onClick={() => handleComplete(item._id)}
                            className="px-2 py-1 bg-green-600 text-white text-[9px] font-bold rounded uppercase tracking-wider hover:bg-green-700 transition-colors"
                          >
                            Complete Pickup
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(item._id)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                          title="Delete Scrap"
                        >
                          <FiTrash2 className="w-3.5 h-3.5" />
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
    </div>
  );
};

export default AdminScrapPage;

