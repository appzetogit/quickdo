import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatDate, filterByDateRange, getDateRange } from '../../utils/adminHelpers';

const getCustomerKey = (booking) => {
  const phone = booking?.user?.phone;
  const email = booking?.user?.email;
  const name = booking?.user?.name;
  return phone || email || name || null;
};

const CustomerGrowthAreaChart = ({ timelineData = [], bookings = [], period = 'month' }) => {
  const customerData = useMemo(() => {
    const range = getDateRange(period);
    const filteredDays = filterByDateRange(timelineData, range.start, range.end);

    const byDate = new Map();
    bookings.forEach((b) => {
      const createdAt = b.createdAt || b.acceptedAt || b.assignedAt || b.visitedAt || b.workDoneAt || b.completedAt;
      if (!createdAt) return;
      const dateKey = new Date(createdAt).toISOString().slice(0, 10);
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(b);
    });

    const seen = new Set();
    let cumulative = 0;

    return filteredDays.map((d) => {
      const dayBookings = byDate.get(d.date) || [];
      let newCustomers = 0;
      dayBookings.forEach((b) => {
        const k = getCustomerKey(b);
        if (!k) return;
        if (!seen.has(k)) {
          seen.add(k);
          newCustomers += 1;
        }
      });
      cumulative += newCustomers;
      return {
        date: d.date,
        dateLabel: formatDate(d.date, { month: 'short', day: 'numeric' }),
        customers: cumulative,
        newCustomers,
      };
    });
  }, [timelineData, bookings, period]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
        <p className="text-sm font-semibold text-gray-800 mb-2">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            <span className="font-medium">{entry.name}:</span> {Number(entry.value || 0).toLocaleString()}
          </p>
        ))}
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200"
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-3 sm:gap-0">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-gray-800">Customer Growth</h3>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">Unique customers over time</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-gradient-to-r from-pink-500 to-rose-500"></div>
          <span className="text-xs text-gray-600">Customers</span>
        </div>
      </div>

      <div className="w-full overflow-x-auto scrollbar-admin">
        <ResponsiveContainer width="100%" height={250} minHeight={200}>
          <AreaChart data={customerData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCustomersAdmin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
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
              tickFormatter={(v) => `${Math.round(Number(v || 0) / 1000)}k`}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="customers"
              stroke="#ec4899"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorCustomersAdmin)"
              name="Total Customers"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default CustomerGrowthAreaChart;



