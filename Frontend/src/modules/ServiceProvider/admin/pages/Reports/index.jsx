import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiTrendingUp,
  FiDollarSign,
  FiUsers,
  FiShoppingBag,
  FiDownload,
  FiPieChart,
  FiBarChart2,
  FiArrowRight,
  FiActivity,
  FiBriefcase
} from 'react-icons/fi';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { toast } from 'react-hot-toast';
import dashboardService from '../../services/dashboardService';
import CardShell from '../UserCategories/components/CardShell';

// Import sub-report components
import RevenueReport from './RevenueReport';
import BookingReport from './BookingReport';
import VendorReport from './VendorReport';
import WorkerReport from './WorkerReport';

const ReportsOverview = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [revenueData, setRevenueData] = useState([]);
  const [bookingTrends, setBookingTrends] = useState([]);
  const [growthData, setGrowthData] = useState([]);
  const [period, setPeriod] = useState('monthly');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsRes, revenueRes, trendsRes, growthRes] = await Promise.all([
        dashboardService.getStats(),
        dashboardService.getRevenue({ period }),
        dashboardService.getBookingTrends({ days: 30 }),
        dashboardService.getGrowthMetrics({ days: 30 })
      ]);

      if (statsRes.success) setStats(statsRes.data.stats);
      if (revenueRes.success) setRevenueData(revenueRes.data.revenueData);
      if (trendsRes.success) setBookingTrends(trendsRes.data.trends);
      if (growthRes.success) {
        const merged = growthRes.data.userGrowth.map(ug => {
          const vg = growthRes.data.vendorGrowth.find(v => v._id === ug._id);
          return {
            date: ug._id,
            users: ug.count,
            vendors: vg ? vg.count : 0
          };
        });
        setGrowthData(merged);
      }
    } catch (error) {
      console.error('Fetch reports error:', error);
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period]);

  const kpis = [
    {
      title: 'Total Revenue',
      value: `₹${stats?.totalRevenue?.toLocaleString() || 0}`,
      icon: FiDollarSign,
      color: 'text-green-600',
      bg: 'bg-green-50',
      link: '/admin/reports/revenue'
    },
    {
      title: 'Platform Comm.',
      value: `₹${stats?.platformCommission?.toLocaleString() || 0}`,
      icon: FiTrendingUp,
      color: 'text-primary-600',
      bg: 'bg-primary-50',
      link: '/admin/reports/revenue'
    },
    {
      title: 'Total Bookings',
      value: stats?.totalBookings || 0,
      icon: FiShoppingBag,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      link: '/admin/reports/bookings'
    },
    {
      title: 'Active Users',
      value: stats?.totalUsers || 0,
      icon: FiUsers,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      link: '/admin/reports/workers' // Just as an example link
    }
  ];

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link to="/admin/sp/reports/bookings" className="group">
          <CardShell className="bg-gradient-to-br from-primary-600 to-primary-700 text-white border-none hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-primary-100 font-bold uppercase tracking-wider text-[10px]">Analyze Performance</p>
                <h3 className="text-lg font-black mt-0.5">Booking Reports</h3>
              </div>
              <div className="bg-white/20 p-2.5 rounded-xl">
                <FiShoppingBag size={20} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold">
              View Details <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
            </div>
          </CardShell>
        </Link>

        <Link to="/admin/sp/reports/vendors" className="group">
          <CardShell className="bg-gradient-to-br from-amber-500 to-amber-600 text-white border-none hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-amber-100 font-bold uppercase tracking-wider text-[10px]">Partner Insights</p>
                <h3 className="text-lg font-black mt-0.5">Vendor Reports</h3>
              </div>
              <div className="bg-white/20 p-2.5 rounded-xl">
                <FiBriefcase size={20} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold">
              View Details <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
            </div>
          </CardShell>
        </Link>

        <Link to="/admin/sp/reports/workers" className="group">
          <CardShell className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-none hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-indigo-100 font-bold uppercase tracking-wider text-[10px]">Force Analytics</p>
                <h3 className="text-lg font-black mt-0.5">Worker Reports</h3>
              </div>
              <div className="bg-white/20 p-2.5 rounded-xl">
                <FiUsers size={20} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs font-bold">
              View Details <FiArrowRight className="group-hover:translate-x-1 transition-transform" />
            </div>
          </CardShell>
        </Link>
      </div>

      {/* Overview Filters */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-slate-800 uppercase tracking-tight">Overview Statistics</h2>
        <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 flex">
          {['daily', 'weekly', 'monthly'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${period === p
                ? 'bg-primary-600 text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi, index) => (
          <Link key={index} to={kpi.link}>
            <CardShell className="bg-white hover:shadow-lg transition-shadow cursor-pointer h-full p-4">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-xl ${kpi.bg} ${kpi.color}`}>
                  <kpi.icon size={22} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{kpi.title}</p>
                  <p className="text-xl font-black text-slate-900 mt-0.5">{kpi.value}</p>
                </div>
              </div>
            </CardShell>
          </Link>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CardShell className="bg-white border-slate-200 p-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-6">
            <FiDollarSign className="text-primary-600" />
            Revenue Trends
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2874F0" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#2874F0" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }} tickFormatter={(val) => `₹${val}`} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} itemStyle={{ fontWeight: 700 }} />
                <Area type="monotone" dataKey="revenue" stroke="#2874F0" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        <CardShell className="bg-white border-slate-200 p-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-6">
            <FiShoppingBag className="text-amber-600" />
            Booking Status
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bookingTrends}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="_id" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px' }} />
                <Bar dataKey="completed" name="Completed" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelled" name="Cancelled" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="count" name="Total" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardShell>

        <CardShell className="bg-white border-gray-200 lg:col-span-2 p-4">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2 mb-6">
            <FiUsers className="text-primary-600" />
            Growth Metrics (Last 30 Days)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={growthData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px' }} />
                <Area type="monotone" dataKey="users" name="New Users" stroke="#4F46E5" fill="#4F46E5" fillOpacity={0.1} strokeWidth={3} />
                <Area type="monotone" dataKey="vendors" name="New Vendors" stroke="#EC4899" fill="#EC4899" fillOpacity={0.1} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardShell>
      </div>
    </div>
  );
};

const Reports = () => {
  const location = useLocation();
  const currentPath = location.pathname.split('/').pop();

  const getPageTitle = () => {
    switch (currentPath) {
      case 'revenue': return 'Revenue Report';
      case 'bookings': return 'Booking Report';
      case 'vendors': return 'Vendor Report';
      case 'workers': return 'Worker Report';
      default: return 'Analytics & Reports';
    }
  };

  const navTabs = [
    { name: 'Overview', path: '/admin/reports', icon: FiActivity, exact: true },
    { name: 'Revenue', path: '/admin/reports/revenue', icon: FiDollarSign },
    { name: 'Bookings', path: '/admin/reports/bookings', icon: FiShoppingBag },
    { name: 'Vendors', path: '/admin/reports/vendors', icon: FiUsers },
    { name: 'Workers', path: '/admin/reports/workers', icon: FiBriefcase },
  ];

  const isTabActive = (tab) => {
    if (tab.exact) return location.pathname === tab.path;
    return location.pathname === tab.path;
  };

  return (
    <div className="space-y-4">
      <Routes>
        <Route index element={<ReportsOverview />} />
        <Route path="revenue" element={<RevenueReport />} />
        <Route path="bookings" element={<BookingReport />} />
        <Route path="vendors" element={<VendorReport />} />
        <Route path="workers" element={<WorkerReport />} />
      </Routes>
    </div>
  );
};

export default Reports;

