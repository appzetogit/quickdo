import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const COLORS = {
  ACCEPTED: '#3B82F6',
  ASSIGNED: '#F59E0B',
  VISITED: '#06B6D4',
  WORK_DONE: '#10B981',
  FINAL_SETTLEMENT: '#8B5CF6',
  COMPLETED: '#22C55E',
  CANCELLED: '#EF4444',
  CANCELED: '#EF4444',
  REJECTED: '#EF4444',
  OTHER: '#6B7280',
};

const normalizeStatus = (s) => {
  const v = (s || 'OTHER').toString().toUpperCase();
  if (v === 'CANCELED' || v === 'CANCELLED' || v === 'CANCEL') return 'CANCELLED';
  return v;
};

const BookingStatusPieChart = ({ bookings = [] }) => {
  const data = useMemo(() => {
    const map = new Map();
    bookings.forEach((b) => {
      const key = normalizeStatus(b.status);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [bookings]);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0];
    return (
      <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
        <p className="text-sm font-semibold text-gray-800">{p.name}</p>
        <p className="text-sm text-gray-600 mt-1">
          <span className="font-semibold">{p.value}</span> bookings
        </p>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200"
    >
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-extrabold text-gray-800">Booking Status</h3>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Status distribution</p>
      </div>

      <div className="w-full h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name] || COLORS.OTHER} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend verticalAlign="bottom" height={36} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default BookingStatusPieChart;



