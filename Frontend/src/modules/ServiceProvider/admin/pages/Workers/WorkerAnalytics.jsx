import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiActivity, FiUsers, FiCheckCircle, FiStar, FiLoader } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { toast } from 'react-hot-toast';
import CardShell from '../UserCategories/components/CardShell';
import adminReportService from '@sp/services/adminReportService';

const WorkerAnalytics = () => {
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
      console.error('Worker analytics error:', error);
      toast.error('Failed to load worker analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <FiLoader className="w-10 h-10 text-primary-600 animate-spin" />
      </div>
    );
  }

  const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#2874F0', '#6366F1'];

  return (
    <div className="space-y-4">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <CardShell className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-[10px] font-medium uppercase tracking-wider">Total Active Workers</p>
              <h3 className="text-xl font-bold mt-0.5">
                {data?.availabilityDistribution?.reduce((acc, curr) => acc + curr.count, 0) || 0}
              </h3>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <FiUsers size={18} />
            </div>
          </div>
        </CardShell>

        <CardShell className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-[10px] font-medium uppercase tracking-wider">Jobs Completed</p>
              <h3 className="text-xl font-bold mt-0.5">
                {data?.topWorkers?.reduce((acc, curr) => acc + curr.completedJobs, 0) || 0}
              </h3>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <FiCheckCircle size={18} />
            </div>
          </div>
        </CardShell>

        <CardShell className="bg-gradient-to-br from-amber-500 to-amber-600 text-white border-none p-3.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-amber-100 text-[10px] font-medium uppercase tracking-wider">Average Rating</p>
              <h3 className="text-xl font-bold mt-0.5">4.8</h3>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <FiStar size={18} />
            </div>
          </div>
        </CardShell>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Workers Chart */}
        <CardShell className="bg-white p-3.5" title="Top Performing Workers" icon={FiActivity}>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.topWorkers} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 9 }} width={70} />
                <Tooltip />
                <Bar dataKey="completedJobs" name="Jobs Completed" fill="#10B981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        {/* Availability Pie Chart */}
        {/* <CardShell className="bg-white p-3.5" title="Worker Status Distribution" icon={FiUsers}>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.availabilityDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={5}
                  dataKey="count"
                  nameKey={(entry) => entry._id ? 'Available' : 'Unavailable'}
                >
                  {data?.availabilityDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={30} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardShell> */}
      </div>
    </div>
  );
};

export default WorkerAnalytics;

