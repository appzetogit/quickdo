import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FiEye } from 'react-icons/fi';
import { formatCurrency } from '../../utils/adminHelpers';

const statusBadge = (status) => {
  const s = (status || 'OTHER').toUpperCase();
  const map = {
    ACCEPTED: 'bg-blue-100 text-blue-700',
    ASSIGNED: 'bg-yellow-100 text-yellow-700',
    VISITED: 'bg-cyan-100 text-cyan-700',
    WORK_DONE: 'bg-emerald-100 text-emerald-700',
    FINAL_SETTLEMENT: 'bg-purple-100 text-purple-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
    CANCELED: 'bg-red-100 text-red-700',
    REJECTED: 'bg-red-100 text-red-700',
  };
  return map[s] || 'bg-gray-100 text-gray-700';
};

const RecentBookings = ({ bookings = [], onViewBooking }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const sorted = useMemo(() => {
    const copy = [...bookings];
    copy.sort((a, b) => {
      const da = new Date(a.createdAt || a.acceptedAt || a.assignedAt || a.visitedAt || a.completedAt || 0).getTime();
      const db = new Date(b.createdAt || b.acceptedAt || b.assignedAt || b.visitedAt || b.completedAt || 0).getTime();
      return db - da;
    });
    return copy;
  }, [bookings]);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sorted.slice(start, start + itemsPerPage);
  }, [sorted, currentPage]);

  const totalPages = Math.ceil(sorted.length / itemsPerPage) || 1;

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <h3 className="text-lg font-bold text-gray-800 mb-6">Recent Bookings</h3>
      <div className="space-y-4">
        {paginated.map((b, index) => (
          <motion.div
            key={b.id || index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06 }}
            className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h4 className="font-semibold text-gray-800 truncate">{b.id}</h4>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusBadge(b.status)}`}>
                  {(b.status || 'OTHER').toString().replace('_', ' ')}
                </span>
              </div>
              <p className="text-sm text-gray-600 truncate">{b.user?.name || 'Customer'}</p>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(b.createdAt || b.acceptedAt || b.assignedAt || b.visitedAt || b.completedAt || Date.now()).toLocaleString()} •{' '}
                {b.serviceType || 'Service'}
              </p>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0 ml-4">
              <div className="text-right">
                <p className="font-bold text-gray-800">{formatCurrency(b.price || 0)}</p>
              </div>
              {/* {onViewBooking && (
                <button
                  onClick={() => onViewBooking(b)}
                  className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  <FiEye className="text-gray-600" />
                </button>
              )} */}
            </div>
          </motion.div>
        ))}
        {sorted.length === 0 && <p className="text-gray-500 text-sm">No bookings found.</p>}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold"
          >
            Prev
          </button>
          <p className="text-sm text-gray-600">
            Page <span className="font-semibold">{currentPage}</span> / {totalPages}
          </p>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default RecentBookings;



