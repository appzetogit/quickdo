import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Car,
  CircleAlert,
  Clock,
  CreditCard,
  History,
  IndianRupee,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { adminService } from '../../services/adminService';
import { BACKEND_LABEL } from '../../../../shared/api/runtimeConfig';

const currency = (value) => Number(value || 0).toFixed(2);
const DASHBOARD_REFRESH_INTERVAL_MS = 20000;

const TopStatCard = ({ label, value, trend, icon: Icon, accentClass, iconClass, isLoading, onClick, clickable = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!clickable}
    className={`w-full overflow-hidden rounded-[24px] border border-gray-100 bg-white p-5 text-left shadow-sm ${
      clickable ? 'cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md' : 'cursor-default'
    }`}
  >
    {isLoading ? (
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-1/2 rounded bg-gray-100" />
        <div className="h-8 w-3/4 rounded bg-gray-100" />
      </div>
    ) : (
      <>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase leading-none tracking-wider text-gray-400">{label}</p>
            <h4 className="text-2xl font-semibold leading-none tracking-tight text-gray-950">{value}</h4>
          </div>
          {trend !== undefined ? (
            <div className={`flex items-center gap-1 text-[10px] font-semibold ${trend > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {trend > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {Math.abs(trend)}%
            </div>
          ) : null}
        </div>
        <div className="flex justify-end">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${accentClass} ${iconClass}`}>
            <Icon size={18} strokeWidth={2.5} />
          </div>
        </div>
      </>
    )}
  </button>
);

const MiniStat = ({ label, value, icon: Icon, accentClass, iconClass, isLoading }) => (
  <div className="flex min-h-[64px] cursor-default items-center justify-between rounded-[20px] border border-gray-100 bg-gray-50/50 p-4 transition-all hover:bg-white">
    {isLoading ? (
      <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
    ) : (
      <>
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase leading-none tracking-wider text-gray-400">{label}</p>
          <p className="text-[15px] font-semibold leading-none tracking-tight text-gray-950">Rs {value}</p>
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${accentClass} ${iconClass}`}>
          <Icon size={14} strokeWidth={2.5} />
        </div>
      </>
    )}
  </div>
);

const SimpleDonut = ({ data, colors }) => {
  const total = data.reduce((sum, value) => sum + Number(value || 0), 0);
  let cumulative = 0;

  return (
    <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90 transform">
        {data.map((rawValue, index) => {
          const value = Number(rawValue || 0);
          const percent = total > 0 ? (value / total) * 100 : 0;
          const offset = total > 0 ? (cumulative / total) * 100 : 0;
          cumulative += value;

          return (
            <circle
              key={colors[index] || index}
              cx="18"
              cy="18"
              r="15.915"
              fill="transparent"
              stroke={colors[index]}
              strokeWidth="4"
              strokeDasharray={`${percent} ${100 - percent}`}
              strokeDashoffset={-offset}
              className="transition-all duration-1000 ease-out"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total</p>
        <p className="text-xl font-bold leading-none tracking-tight text-gray-950">{total}</p>
      </div>
    </div>
  );
};

const SimpleBarChart = ({ data, color = '#10B981' }) => {
  const values = data.map((item) => Number(item?.total || 0));
  const maxValue = Math.max(...values, 0);

  return (
    <div className="flex h-48 w-full items-end justify-between gap-3 px-4">
      {data.map((item) => {
        const heightPercent = maxValue > 0 ? (Number(item?.total || 0) / maxValue) * 100 : 0;

        return (
          <div key={item.label} className="group flex flex-1 flex-col items-center gap-2">
            <div className="relative flex h-full w-full items-end overflow-hidden rounded-lg bg-gray-50">
              <div
                style={{ height: `${heightPercent}%`, backgroundColor: color }}
                className="w-full rounded-t-sm transition-all duration-500 group-hover:opacity-90"
                title={`${item.label}: ${item.total}`}
              />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
};

const EarningsLineChart = ({ points }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const safePoints = Array.isArray(points) && points.length ? points : [];
  const maxValue = Math.max(...safePoints.map((item) => Number(item?.amount || 0)), 0);

  const chartPoints = safePoints.map((item, index) => {
    const x = safePoints.length === 1 ? 200 : (index / (safePoints.length - 1)) * 400;
    const y = maxValue > 0 ? 90 - (Number(item?.amount || 0) / maxValue) * 60 : 90;
    return { ...item, x, y };
  });

  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const areaPath = chartPoints.length
    ? `${linePath} L ${chartPoints[chartPoints.length - 1].x} 100 L ${chartPoints[0].x} 100 Z`
    : '';

  return (
    <div className="relative mt-auto h-48 w-full">
      {hoveredPoint ? (
        <div className="absolute left-0 top-0 z-10 rounded-xl border border-emerald-100 bg-white/95 px-3 py-2 text-[11px] font-bold text-slate-700 shadow-lg">
          <p className="uppercase tracking-wider text-slate-400">{hoveredPoint.label}</p>
          <p>Rs {currency(hoveredPoint.amount)}</p>
        </div>
      ) : null}

      <svg viewBox="0 0 400 100" className="h-full w-full">
        <defs>
          <linearGradient id="dashboardLineFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#27AE60" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#27AE60" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#dashboardLineFill)" />
        <path d={linePath} fill="transparent" stroke="#27AE60" strokeWidth="3" />
        {chartPoints.map((point) => (
          <circle
            key={point.label}
            cx={point.x}
            cy={point.y}
            r="4.5"
            fill="#27AE60"
            className="cursor-pointer"
            onMouseEnter={() => setHoveredPoint(point)}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        ))}
      </svg>
      <div className="mt-4 flex items-center justify-between px-2">
        {safePoints.map((point) => (
          <span key={point.label} className="text-[9px] font-semibold uppercase tracking-wider text-gray-400">
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
};

const MainDashboard = () => {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchDashboardData = async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        const response = await adminService.getDashboardData();
        const data = response?.data || response;
        if (!isMounted) {
          return;
        }

        setDashboard(data || {});
        setDashboardError('');
        setLastUpdatedAt(new Date());
      } catch (err) {
        console.error('Dashboard Fetch Error:', err);
        if (!isMounted) {
          return;
        }

        setDashboardError(`Dashboard data is unavailable right now. Start the backend on ${BACKEND_LABEL} to load live metrics.`);
      } finally {
        if (!isMounted) {
          return;
        }

        setIsLoading(false);
        setIsRefreshing(false);
      }
    };

    fetchDashboardData();

    const intervalId = window.setInterval(() => {
      fetchDashboardData({ silent: true });
    }, DASHBOARD_REFRESH_INTERVAL_MS);

    const handleWindowFocus = () => {
      fetchDashboardData({ silent: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchDashboardData({ silent: true });
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const todayTrips = dashboard?.todayTrips || {};
  const overallTrips = dashboard?.overallTrips || {};
  const todayEarnings = dashboard?.todayEarnings || {};
  const overallEarnings = dashboard?.overallEarnings || {};
  const cancelChart = dashboard?.cancelChart || {};
  const notifiedSos = dashboard?.notifiedSos || {};

  const todayTripSeries = useMemo(
    () => [todayTrips.completed || 0, todayTrips.cancelled || 0, todayTrips.scheduled || 0],
    [todayTrips.cancelled, todayTrips.completed, todayTrips.scheduled],
  );
  const overallTripSeries = useMemo(
    () => [overallTrips.completed || 0, overallTrips.cancelled || 0, overallTrips.scheduled || 0],
    [overallTrips.cancelled, overallTrips.completed, overallTrips.scheduled],
  );
  const earningsChartPoints = useMemo(() => overallEarnings.chart || [], [overallEarnings.chart]);
  const cancelChartPoints = useMemo(() => cancelChart.chart || [], [cancelChart.chart]);

  return (
    <div className="min-h-screen -m-8 space-y-8 bg-[#f8fbff] p-8 font-sans text-gray-950 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold uppercase leading-none tracking-tight text-gray-900">Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdatedAt ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Updated {lastUpdatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          ) : null}
          {isRefreshing ? (
            <div className="flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live Refresh
            </div>
          ) : null}
        </div>
      </div>

      {dashboardError ? (
        <div className="flex items-start gap-3 rounded-[24px] border border-amber-200 bg-amber-50 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <CircleAlert size={18} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">Backend Offline</p>
            <p className="mt-1 text-sm font-semibold text-amber-900">{dashboardError}</p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <TopStatCard
          label="Drivers Registered"
          value={dashboard?.totalDrivers?.total || 0}
          icon={UserPlus}
          accentClass="border-emerald-100 bg-emerald-50"
          iconClass="text-emerald-500"
          isLoading={isLoading}
          clickable
          onClick={() => navigate('/taxi/admin/drivers')}
        />
        <TopStatCard
          label="Approved Drivers"
          value={dashboard?.totalDrivers?.approved || 0}
          icon={ShieldCheck}
          accentClass="border-blue-100 bg-blue-50"
          iconClass="text-blue-500"
          isLoading={isLoading}
          clickable
          onClick={() => navigate('/taxi/admin/drivers')}
        />
        <TopStatCard
          label="Waiting Approval"
          value={dashboard?.totalDrivers?.declined || 0}
          icon={Clock}
          accentClass="border-amber-100 bg-amber-50"
          iconClass="text-amber-500"
          isLoading={isLoading}
          clickable
          onClick={() => navigate('/taxi/admin/drivers/pending')}
        />
        <TopStatCard
          label="Users Registered"
          value={dashboard?.totalUsers || 0}
          icon={Users}
          accentClass="border-indigo-100 bg-indigo-50"
          iconClass="text-indigo-500"
          isLoading={isLoading}
          clickable
          onClick={() => navigate('/taxi/admin/users')}
        />
      </div>

      <button
        type="button"
        onClick={() => navigate('/taxi/admin/safety')}
        className="w-full overflow-hidden rounded-[28px] border border-gray-100 bg-white p-8 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      >
        <h3 className="mb-4 text-left text-[14px] font-semibold uppercase tracking-wider text-gray-400">Notified SOS</h3>
        <div className="flex flex-col items-center py-6">
          <div className="relative mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-blue-50/50">
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-blue-200 animate-[spin_10s_linear_infinite]" />
            <div className="relative z-10 rounded-2xl border border-blue-50 bg-white p-4 shadow-xl">
              <div className="relative">
                <History size={32} className="text-blue-500" />
                <Search size={16} className="absolute -bottom-1 -right-1 rounded-full border border-gray-100 bg-white p-0.5 font-semibold text-gray-950" />
              </div>
            </div>
          </div>
          <p className="text-[34px] font-black leading-none tracking-tight text-gray-950">
            {isLoading ? '--' : notifiedSos.total || 0}
          </p>
          <p className="mt-2 text-[16px] font-semibold uppercase tracking-tight text-gray-950">
            {Number(notifiedSos.total || 0) > 0 ? 'Pending safety/support alerts' : 'No active alerts'}
          </p>
          <p className="mt-2 text-[12px] font-semibold text-gray-500">
            Assigned: {notifiedSos.assigned || 0} | Closed: {notifiedSos.closed || 0}
          </p>
        </div>
      </button>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col rounded-[32px] border border-gray-100 bg-white p-8 shadow-sm">
          <h3 className="mb-10 text-[14px] font-semibold uppercase tracking-wider text-gray-400">Today Trips</h3>
          <div className="flex flex-1 flex-col items-center gap-10 md:flex-row">
            <div className="flex-1">
              <SimpleDonut data={todayTripSeries} colors={['#3B4687', '#EB5757', '#2D9CDB']} />
            </div>
            <div className="min-w-[180px] space-y-4">
              {[
                { label: 'Completed Rides', color: '#3B4687', value: todayTrips.completed || 0 },
                { label: 'Cancelled Rides', color: '#EB5757', value: todayTrips.cancelled || 0 },
                { label: 'Scheduled Rides', color: '#2D9CDB', value: todayTrips.scheduled || 0 },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
                    <span className="text-[12px] font-semibold uppercase leading-none tracking-tight text-gray-600">{item.label}</span>
                  </div>
                  <span className="text-[14px] font-black text-gray-950">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid h-full grid-cols-2 gap-4">
          <MiniStat label="Today Earnings" value={currency(todayEarnings.total)} icon={IndianRupee} accentClass="border-blue-200/50 bg-blue-200/20" iconClass="text-blue-600" isLoading={isLoading} />
          <MiniStat label="By Cash" value={currency(todayEarnings.by_cash)} icon={Wallet} accentClass="border-emerald-200/50 bg-emerald-200/20" iconClass="text-emerald-600" isLoading={isLoading} />
          <MiniStat label="By Wallet" value={currency(todayEarnings.by_wallet)} icon={Wallet} accentClass="border-amber-200/50 bg-amber-200/20" iconClass="text-amber-600" isLoading={isLoading} />
          <MiniStat label="By Card/Online" value={currency(todayEarnings.by_card)} icon={CreditCard} accentClass="border-rose-200/50 bg-rose-200/20" iconClass="text-rose-600" isLoading={isLoading} />
          <MiniStat label="Admin Commission" value={currency(todayEarnings.admin_commission)} icon={ShieldCheck} accentClass="border-indigo-200/50 bg-indigo-200/20" iconClass="text-indigo-600" isLoading={isLoading} />
          <MiniStat label="Drivers Earnings" value={currency(todayEarnings.driver_earnings)} icon={UserCheck} accentClass="border-gray-200/70 bg-gray-200/30" iconClass="text-gray-700" isLoading={isLoading} />
        </div>
      </div>

      <div className="w-full rounded-[32px] border border-gray-100 bg-white p-8 shadow-sm">
        <h3 className="mb-10 text-[14px] font-semibold uppercase tracking-wider text-gray-400">Overall Trips</h3>
        <div className="flex flex-col items-center gap-10 md:flex-row">
          <div className="flex w-full justify-center md:w-auto md:flex-1">
            <SimpleDonut data={overallTripSeries} colors={['#2D9CDB', '#EB5757', '#27AE60']} />
          </div>
          <div className="min-w-[180px] space-y-4 md:pr-10">
            {[
              { label: 'Completed Rides', color: '#2D9CDB', value: overallTrips.completed || 0 },
              { label: 'Cancelled Rides', color: '#EB5757', value: overallTrips.cancelled || 0 },
              { label: 'Scheduled Rides', color: '#27AE60', value: overallTrips.scheduled || 0 },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span className="text-[12px] font-semibold uppercase leading-none tracking-tight text-gray-600">{item.label}</span>
                </div>
                <span className="text-[14px] font-black text-gray-950">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col rounded-[32px] border border-gray-100 bg-white p-8 shadow-sm">
          <h3 className="mb-10 text-[14px] font-semibold uppercase tracking-wider text-gray-400">Overall Earnings</h3>
          <EarningsLineChart points={earningsChartPoints} />
        </div>

        <div className="grid h-full grid-cols-2 gap-4">
          <MiniStat label="Overall Earnings" value={currency(overallEarnings.total)} icon={IndianRupee} accentClass="border-rose-200/50 bg-rose-200/20" iconClass="text-rose-600" isLoading={isLoading} />
          <MiniStat label="By Cash" value={currency(overallEarnings.by_cash)} icon={Wallet} accentClass="border-amber-200/50 bg-amber-200/20" iconClass="text-amber-600" isLoading={isLoading} />
          <MiniStat label="By Wallet" value={currency(overallEarnings.by_wallet)} icon={Wallet} accentClass="border-emerald-200/50 bg-emerald-200/20" iconClass="text-emerald-600" isLoading={isLoading} />
          <MiniStat label="By Card/Online" value={currency(overallEarnings.by_card)} icon={CreditCard} accentClass="border-blue-200/50 bg-blue-200/20" iconClass="text-blue-600" isLoading={isLoading} />
          <MiniStat label="Admin Commission" value={currency(overallEarnings.admin_commission)} icon={ShieldCheck} accentClass="border-indigo-200/50 bg-indigo-200/20" iconClass="text-indigo-600" isLoading={isLoading} />
          <MiniStat label="Drivers Earnings" value={currency(overallEarnings.driver_earnings)} icon={UserCheck} accentClass="border-gray-200/70 bg-gray-200/30" iconClass="text-gray-700" isLoading={isLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex flex-col rounded-[32px] border border-gray-100 bg-white p-8 shadow-sm">
          <h3 className="mb-10 text-[14px] font-semibold uppercase tracking-wider text-gray-400">Cancellation Chart</h3>
          <div className="h-48 w-full mt-auto">
            <SimpleBarChart data={cancelChartPoints} color="#10B981" />
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {[
              { label: 'Cancelled Due to No Drivers', color: '#3F51B5' },
              { label: 'Cancelled By Users', color: '#FFB300' },
              { label: 'Cancelled By Drivers', color: '#009688' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[9px] font-semibold uppercase tracking-tight text-gray-400">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid h-full grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => navigate('/taxi/admin/trips')}
            className="flex w-full items-center justify-between rounded-[28px] border border-gray-50 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase leading-none tracking-wider text-gray-400">Total Request Cancelled</p>
              <p className="text-2xl font-semibold leading-none tracking-tight text-gray-950">{cancelChart.total || 0}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
              <Bell size={18} />
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/taxi/admin/trips')}
            className="flex w-full items-center justify-between rounded-[28px] border border-gray-50 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase leading-none tracking-widest text-gray-400">Cancelled By Users</p>
              <p className="text-2xl font-semibold leading-none tracking-tight text-gray-950">{cancelChart.byUser || 0}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-500">
              <CircleAlert size={18} />
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/taxi/admin/drivers')}
            className="flex w-full items-center justify-between rounded-[28px] border border-gray-50 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase leading-none tracking-widest text-gray-400">Cancelled By Drivers</p>
              <p className="text-2xl font-semibold leading-none tracking-tight text-gray-950">{cancelChart.byDriver || 0}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-500">
              <Car size={18} />
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/taxi/admin/ongoing')}
            className="flex w-full items-center justify-between rounded-[28px] border border-gray-50 bg-white p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase leading-none tracking-wider text-gray-400">Cancelled By No Driver</p>
              <p className="text-2xl font-semibold leading-none tracking-tight text-gray-950">{cancelChart.noDriver || 0}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-50 text-cyan-500">
              <UserPlus size={18} />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default MainDashboard;
