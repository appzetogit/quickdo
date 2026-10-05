import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

const PaymentBreakdownPieChart = ({ bookings = [] }) => {
  const data = useMemo(() => {
    let paid = 0;
    let pending = 0;
    bookings.forEach((b) => {
      // Payment is relevant after work done
      const isWorkDoneStage = ['WORK_DONE', 'FINAL_SETTLEMENT', 'COMPLETED'].includes((b.status || '').toUpperCase());
      if (!isWorkDoneStage) return;
      if ((b.workerPaymentStatus || '').toUpperCase() === 'PAID') paid += 1;
      else pending += 1;
    });
    return [
      { name: 'Paid to Worker', value: paid },
      { name: 'Pending Worker Payment', value: pending },
    ];
  }, [bookings]);

  const colors = ['#10B981', '#F59E0B'];

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
      transition={{ delay: 0.05 }}
      className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-200"
    >
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-extrabold text-gray-800">Worker Payment</h3>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Paid vs pending (after work done)</p>
      </div>

      <div className="w-full h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
              {data.map((entry, idx) => (
                <Cell key={entry.name} fill={colors[idx % colors.length]} />
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

export default PaymentBreakdownPieChart;



