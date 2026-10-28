import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { formatCurrency } from '../../utils/adminHelpers';

const TopServices = ({ bookings = [], periodLabel = 'Top Services' }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const topServices = useMemo(() => {
    const map = new Map();
    bookings.forEach((b) => {
      const name = b.serviceType || 'Unknown Service';
      const prev = map.get(name) || { name, bookings: 0, revenue: 0, completed: 0 };
      prev.bookings += 1;
      if ((b.status || '').toUpperCase() === 'COMPLETED') {
        prev.revenue += Number(b.price || 0);
        prev.completed += 1;
      }
      map.set(name, prev);
    });
    return Array.from(map.values()).sort((a, b) => b.bookings - a.bookings);
  }, [bookings]);

  const totalPages = Math.ceil(topServices.length / itemsPerPage) || 1;
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return topServices.slice(start, start + itemsPerPage);
  }, [topServices, currentPage]);

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
      <h3 className="text-lg font-bold text-gray-800 mb-6">{periodLabel}</h3>
      <div className="space-y-4">
        {paginated.map((svc, index) => {
          const globalIndex = (currentPage - 1) * itemsPerPage + index;
          return (
            <motion.div
              key={svc.name}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.07 }}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold flex-shrink-0">
                  {globalIndex + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-800 truncate">{svc.name}</h4>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-sm text-gray-600">{svc.bookings} bookings</span>
                    <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">
                      {svc.completed} completed
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-4">
                <p className="font-bold text-gray-800">{formatCurrency(svc.revenue)}</p>
                <p className="text-xs text-gray-500">Revenue (completed)</p>
              </div>
            </motion.div>
          );
        })}
        {topServices.length === 0 && <p className="text-gray-500 text-sm">No data found.</p>}
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

export default TopServices;



