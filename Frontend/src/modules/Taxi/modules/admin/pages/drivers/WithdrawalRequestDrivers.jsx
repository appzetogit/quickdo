import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Eye, FileSearch, Search } from 'lucide-react';
import { adminService } from '../../services/adminService';

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN');
};

const WithdrawalRequestDrivers = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState('pending');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [paginator, setPaginator] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchRows = async ({
    nextPage = page,
    nextLimit = itemsPerPage,
    nextSearch = searchTerm,
    nextStatus = status,
  } = {}) => {
    setLoading(true);
    try {
      const response = await adminService.getDriverWithdrawalSummaries({
        page: nextPage,
        limit: nextLimit,
        search: nextSearch,
        status: nextStatus,
      });
      
      const results = response?.data?.results || response?.results || [];
      const paginator = response?.data?.paginator || response?.paginator || null;
      
      setRows(results);
      setPaginator(paginator);
    } catch (error) {
      console.error('Failed to load withdrawal requests:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm, nextStatus: status });
    setPage(1);
  }, [itemsPerPage, status]);

  useEffect(() => {
    const id = setTimeout(() => {
      fetchRows({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm, nextStatus: status });
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    fetchRows({ nextPage: page, nextLimit: itemsPerPage, nextSearch: searchTerm, nextStatus: status });
  }, [page]);

  const totalPages = useMemo(() => Math.max(1, Number(paginator?.last_page || 1)), [paginator]);
  const safePage = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);
  const totalEntries = useMemo(() => Number(paginator?.total || 0), [paginator]);
  const perPage = useMemo(() => Number(paginator?.per_page || itemsPerPage), [paginator, itemsPerPage]);
  const startIndex = useMemo(() => (safePage - 1) * perPage, [safePage, perPage]);
  const showingFrom = totalEntries === 0 ? 0 : startIndex + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(startIndex + rows.length, totalEntries);

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8 font-sans text-gray-900">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Driver Wallet</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Withdrawal Request Drivers</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Withdrawal Request Drivers</h1>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Show</span>
            <select
              value={itemsPerPage}
              onChange={(event) => setItemsPerPage(Number(event.target.value) || 10)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
            >
              {[10, 25, 50, 100].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
            <span>entries</span>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full md:w-40 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
            >
              <option value="pending">Pending</option>
              <option value="completed">Approved</option>
              <option value="cancelled">Rejected</option>
              <option value="all">All</option>
            </select>
            
            <div className="relative w-full md:w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search..."
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="text-xs font-semibold text-gray-500">
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Mobile Number</th>
                <th className="px-6 py-4">Requested Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-sm text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <FileSearch size={44} strokeWidth={1.5} />
                      <p className="text-sm font-medium">No Data Found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((item) => (
                  <tr key={item.driver_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {formatDateTime(item.last_request_at)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      {item.driver?.name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {item.driver?.mobile || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      Rs {Number(item.pending_amount || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                        item.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                        item.status === 'cancelled' ? 'bg-rose-50 text-rose-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {item.status === 'completed' ? 'Approved' : item.status === 'cancelled' ? 'Rejected' : 'Requested'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/taxi/admin/drivers/wallet/withdrawals/${item.driver_id}${
                              item.latest_request_id ? `?requestId=${item.latest_request_id}` : ''
                            }`,
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                      >
                        <Eye size={16} />
                        View details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-gray-500">
          <div>
            Showing {showingFrom} to {showingTo} of {totalEntries} entries
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm">{safePage}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WithdrawalRequestDrivers;

