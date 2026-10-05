import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiStar, FiTrendingUp, FiUserCheck } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { toast } from 'react-hot-toast';
import adminReportService from '@sp/services/adminReportService';
import CardShell from '../UserCategories/components/CardShell';

const WorkerReport = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await adminReportService.getWorkerReport();
      if (res.success) {
        setData(res.data);
      }
    } catch (error) {
      console.error('Worker report error:', error);
      toast.error('Failed to load worker report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#2874F0', '#6366F1'];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Workers by Bookings */}
        <CardShell className="bg-white p-4">
          <h3 className="text-base font-bold mb-4 flex items-center gap-2">
            <FiTrendingUp className="text-primary-600" />
            Top 10 Workers by Bookings
          </h3>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.topWorkers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="fullName" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} width={100} />
                <Tooltip />
                <Bar dataKey="totalBookings" name="Bookings" fill="#2874F0" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        <div className="space-y-6">
          {/* Status Distribution */}
          <CardShell className="bg-white p-4">
            <h3 className="text-base font-bold mb-4 flex items-center gap-2">
              <FiUserCheck className="text-amber-600" />
              Worker Approval Status
            </h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data?.statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="_id"
                  >
                    {data?.statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardShell>

          {/* Average Rating Distribution */}
          <CardShell className="bg-white p-4">
            <h3 className="text-base font-bold mb-4 flex items-center gap-2">
              <FiStar className="text-indigo-600" />
              Average Rating Overview
            </h3>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.ratingDistribution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11 }} />
                  <Tooltip cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="count" fill="#6366F1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardShell>
        </div>
      </div>
    </div>
  );
};

export default WorkerReport;

