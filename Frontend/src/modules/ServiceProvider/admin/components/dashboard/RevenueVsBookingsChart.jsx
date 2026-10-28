import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { filterByDateRange, getDateRange, formatDate, formatCurrency } from '../../utils/adminHelpers';

const RevenueVsBookingsChart = ({ data, period = 'month' }) => {
  const filteredData = useMemo(() => {
    const range = getDateRange(period);
    const filtered = filterByDateRange(data, range.start, range.end);
    const limit = period === 'week' ? 7 : period === 'month' ? 14 : 30;
    return filtered.slice(-limit).map((item) => ({
      ...item,
      dateLabel: formatDate(item.date, { month: 'short', day: 'numeric' }),
    }));
  }, [data, period]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const revenue = payload.find((p) => p.dataKey === 'revenue')?.value ?? 0;
    const orders = payload.find((p) => p.dataKey === 'orders')?.value ?? 0;
    return (
      <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
        <p className="text-sm font-semibold text-gray-800 mb-2">{label}</p>
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Revenue:</span> {formatCurrency(revenue)}
        </p>
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Bookings:</span> {orders}
        </p>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200"
    >
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-extrabold text-gray-800">Revenue vs Bookings</h3>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Compare revenue and booking count</p>
      </div>

      <div className="w-full overflow-x-auto scrollbar-admin">
        <ResponsiveContainer width="100%" height={260} minHeight={200}>
          <ComposedChart data={filteredData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
              yAxisId="left"
              stroke="#6b7280"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
              width={50}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="#6b7280"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={35}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar yAxisId="right" dataKey="orders" fill="#10b981" radius={[8, 8, 0, 0]} />
            <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default RevenueVsBookingsChart;



