import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FiUser, FiBriefcase, FiUsers, FiShoppingBag, FiDollarSign, FiActivity } from 'react-icons/fi';
import RevenueLineChart from '../../components/dashboard/RevenueLineChart';
import BookingsBarChart from '../../components/dashboard/BookingsBarChart';
import BookingStatusPieChart from '../../components/dashboard/BookingStatusPieChart';
import PaymentBreakdownPieChart from '../../components/dashboard/PaymentBreakdownPieChart';
import RevenueVsBookingsChart from '../../components/dashboard/RevenueVsBookingsChart';
import TimePeriodFilter from '../../components/dashboard/TimePeriodFilter';
import { formatCurrency } from '../../utils/adminHelpers';
import CustomerGrowthAreaChart from '../../components/dashboard/CustomerGrowthAreaChart';
import TopServices from '../../components/dashboard/TopServices';
import RecentBookings from '../../components/dashboard/RecentBookings';
import { getDashboardStats, getRevenueAnalytics } from '@sp/services/adminDashboardService';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [period, setPeriod] = useState(() => {
    return localStorage.getItem('adminDashboardPeriod') || 'month';
  });
  const [customDates, setCustomDates] = useState(() => {
    const saved = localStorage.getItem('adminDashboardCustomDates');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
      end: new Date().toISOString().split('T')[0]
    };
  });

  useEffect(() => {
    localStorage.setItem('adminDashboardPeriod', period);
  }, [period]);

  useEffect(() => {
    localStorage.setItem('adminDashboardCustomDates', JSON.stringify(customDates));
  }, [customDates]);
  const [revenueData, setRevenueData] = useState([]);
  const [recentBookingsList, setRecentBookingsList] = useState([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalVendors: 0,
    totalWorkers: 0,
    activeBookings: 0,
    completedBookings: 0,
    totalRevenue: 0,
    todayRevenue: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Calculate Period Dates
        let apiPeriod = 'monthly';
        let startDate = new Date();
        let endDate = new Date().toISOString();

        if (period === 'year') {
          apiPeriod = 'monthly';
          startDate.setFullYear(startDate.getFullYear() - 1);
        } else if (period === 'week') {
          apiPeriod = 'daily';
          startDate.setDate(startDate.getDate() - 7);
        } else if (period === 'month') {
          apiPeriod = 'daily';
          startDate.setDate(startDate.getDate() - 30);
        } else if (period === 'custom') {
          apiPeriod = 'daily';
          startDate = new Date(customDates.start);
          const customEndDate = new Date(customDates.end);
          customEndDate.setHours(23, 59, 59, 999);
          endDate = customEndDate.toISOString();
        } else if (period === 'today') {
          apiPeriod = 'daily';
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
        } else {
          apiPeriod = 'daily';
          startDate.setDate(startDate.getDate() - 1);
        }

        const startIso = startDate.toISOString();

        // 2. Fetch Stats & Recent Bookings (Filtered)
        const statsRes = await getDashboardStats({
          startDate: startIso,
          endDate
        });
        
        if (statsRes.success) {
          const s = statsRes.data.stats;
          setStats({
            totalUsers: s.totalUsers,
            totalVendors: s.totalVendors,
            totalWorkers: s.totalWorkers,
            activeBookings: s.pendingBookings,
            completedBookings: s.completedBookings,
            totalRevenue: s.totalRevenue,
            bookingRevenue: s.bookingRevenue,
            workerSubscriptionRevenue: s.workerSubscriptionRevenue,
            todayRevenue: 0,
          });
          setRecentBookingsList(statsRes.data.recentBookings || []);
        }

        // 3. Fetch Revenue Analytics based on Period
        const revRes = await getRevenueAnalytics({
          period: apiPeriod,
          startDate: startIso,
          endDate
        });

        if (revRes.success) {
          const mapped = revRes.data.revenueData.map(item => ({
            date: item._id,
            revenue: item.revenue,
            orders: item.bookings
          }));
          mapped.sort((a, b) => new Date(a.date) - new Date(b.date));
          setRevenueData(mapped);
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      }
    };

    fetchData();
  }, [period, customDates.start, customDates.end]);

  const handleExportCsv = () => {
    try {
      const rows = revenueData.map((r) => ({
        date: r.date,
        bookings: r.orders,
        revenue: r.revenue,
      }));

      const headers = ['date', 'bookings', 'revenue'];
      const csv = [
        headers.join(','),
        ...rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `admin_dashboard_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('CSV export failed', e);
      alert('Export failed.');
    }
  };

  const onViewBooking = (booking) => {
    if (booking?._id || booking?.id) navigate(`/admin/bookings/${booking._id || booking.id}`);
  };

  const statsCards = [
    {
      title: period === 'month' ? 'Gross Monthly Revenue' : period === 'year' ? 'Gross Yearly Revenue' : period === 'today' ? 'Gross Today\'s Revenue' : period === 'week' ? 'Gross Weekly Revenue' : 'Gross Revenue',
      value: formatCurrency(stats.totalRevenue || 0),
      change: 0,
      icon: FiDollarSign,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-green-500 to-emerald-600',
      cardBg: 'bg-gradient-to-br from-green-50 to-emerald-50',
      iconBg: 'bg-white/20',
      link: '/admin/reports/revenue'
    },
    {
      title: 'Worker Plan Revenue',
      value: formatCurrency(stats.workerSubscriptionRevenue || 0),
      change: 0,
      icon: FiDollarSign,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-purple-500 to-fuchsia-600',
      cardBg: 'bg-gradient-to-br from-purple-50 to-fuchsia-50',
      iconBg: 'bg-white/20',
      link: '/admin/workers/analytics'
    },
    {
      title: 'Pending Bookings',
      value: (stats.activeBookings || 0).toLocaleString(),
      change: 0,
      icon: FiShoppingBag,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-blue-500 to-indigo-600',
      cardBg: 'bg-gradient-to-br from-blue-50 to-indigo-50',
      iconBg: 'bg-white/20',
      link: '/admin/reports/bookings'
    },
    {
      title: 'Completed Bookings',
      value: (stats.completedBookings || 0).toLocaleString(),
      change: 0,
      icon: FiActivity,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-purple-500 to-violet-600',
      cardBg: 'bg-gradient-to-br from-purple-50 to-violet-50',
      iconBg: 'bg-white/20',
      link: '/admin/reports/bookings'
    },
    {
      title: 'New Users',
      value: (stats.totalUsers || 0).toLocaleString(),
      change: 0,
      icon: FiUser,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-orange-500 to-amber-600',
      cardBg: 'bg-gradient-to-br from-orange-50 to-amber-50',
      iconBg: 'bg-white/20',
      link: '/admin/users/analytics'
    },
    {
      title: 'New Vendors',
      value: (stats.totalVendors || 0).toLocaleString(),
      change: 0,
      icon: FiBriefcase,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-teal-500 to-cyan-600',
      cardBg: 'bg-gradient-to-br from-teal-50 to-cyan-50',
      iconBg: 'bg-white/20',
      link: '/admin/vendors/analytics'
    },
    {
      title: 'New Workers',
      value: (stats.totalWorkers || 0).toLocaleString(),
      change: 0,
      icon: FiUsers,
      color: 'text-white',
      bgColor: 'bg-gradient-to-br from-rose-500 to-pink-600',
      cardBg: 'bg-gradient-to-br from-rose-50 to-pink-50',
      iconBg: 'bg-white/20',
      link: '/admin/workers/analytics'
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="flex flex-col gap-3">
        <div className="w-full">
          <TimePeriodFilter
            selectedPeriod={period}
            onPeriodChange={setPeriod}
            onExport={handleExportCsv}
            customDates={customDates}
            onCustomDateChange={setCustomDates}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statsCards.map((card, index) => {
          const Icon = card.icon;
          const isPositive = (card.change || 0) >= 0;

          return (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
              className={`${card.cardBg} rounded-xl p-3 sm:p-4 shadow-sm border border-transparent transition-all duration-300 relative overflow-hidden group`}
            >
              <div className={`absolute top-0 right-0 w-24 h-24 ${card.bgColor} opacity-10 rounded-full -mr-12 -mt-12 group-hover:scale-110 transition-transform`} />

              <div className="flex items-center justify-between mb-2 sm:mb-3 relative z-10">
                <div className={`${card.bgColor} ${card.iconBg} p-1.5 sm:p-2 rounded-lg shadow-sm`}>
                  <Icon className={`${card.color} text-base sm:text-lg`} />
                </div>
                {card.change !== 0 && (
                  <div
                    className={`text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded-full ${isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                  >
                    {isPositive ? '+' : ''}
                    {Math.abs(card.change || 0)}%
                  </div>
                )}
              </div>

              <div className="relative z-10">
                <h3 className="text-gray-600 text-[10px] sm:text-xs font-medium mb-0.5">{card.title}</h3>
                <p className="text-gray-800 text-lg sm:text-xl font-bold">{card.value}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueLineChart data={revenueData} period={period} />
        <BookingsBarChart data={revenueData} period={period} />
      </div> */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BookingStatusPieChart bookings={recentBookingsList} />
        <PaymentBreakdownPieChart bookings={recentBookingsList} />
      </div>

      {/* <div className="grid grid-cols-1 gap-4">
        <RevenueVsBookingsChart data={revenueData} period={period} />
      </div> */}

      {/* <div className="grid grid-cols-1 gap-4">
        <CustomerGrowthAreaChart timelineData={revenueData} bookings={recentBookingsList} period={period} />
      </div> */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopServices
          bookings={recentBookingsList}
          periodLabel="Top Booked Services (Recent)"
        />
        <RecentBookings bookings={recentBookingsList} onViewBooking={onViewBooking} />
      </div>
    </motion.div>
  );
};

export default AdminDashboard;


