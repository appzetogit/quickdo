import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { filterByDateRange, getDateRange, formatDate } from '../../utils/adminHelpers';

const BookingsBarChart = ({ data, period = 'month' }) => {
  const filteredData = useMemo(() => {
    const range = getDateRange(period);
    const filtered = filterByDateRange(data, range.start, range.end);
    const daysToShow = period === 'week' ? 7 : 7;
    return filtered.slice(-daysToShow).map((item) => ({
      ...item,
      dateLabel: formatDate(item.date, { month: 'short', day: 'numeric' }),
    }));
  }, [data, period]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
          <p className="text-sm font-semibold text-gray-800 mb-2">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              <span className="font-medium">{entry.name}:</span> {entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-extrabold text-gray-800">Booking Volume</h3>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Daily bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />
          <span className="text-xs text-gray-600">Bookings</span>
        </div>
      </div>

      <div className="w-full overflow-x-auto scrollbar-admin">
        <ResponsiveContainer width="100%" height={250} minHeight={200}>
          <BarChart data={filteredData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorBookingsAdmin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.85} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.85} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              stroke="#6b7280"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis
              stroke="#6b7280"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="orders" fill="url(#colorBookingsAdmin)" radius={[8, 8, 0, 0]} name="Bookings" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default BookingsBarChart;



