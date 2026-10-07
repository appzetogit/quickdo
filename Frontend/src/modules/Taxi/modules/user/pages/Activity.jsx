import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BottomNavbar from '../components/BottomNavbar';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityTabs from '../components/activity/ActivityTabs';
import ActivityCard from '../components/activity/ActivityCard';
import ActivityPager from '../components/activity/ActivityPager';
import {
  ActivityEmptyState,
  ActivityErrorState,
  ActivityLoadingState,
  ActivitySupportState,
} from '../components/activity/ActivityStates';
import api from '../../../shared/api/axiosInstance';
import { normalizeRide, PAGE_SIZE, TABS } from '../components/activity/activityHelpers';

const AGGREGATE_FETCH_LIMIT = 60;

const getPayload = (response) => response?.data?.data || response?.data || response || {};

const buildLocalPagination = (items, page) => {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;

  return {
    results: items.slice(startIndex, startIndex + PAGE_SIZE),
    pagination: {
      page: safePage,
      limit: PAGE_SIZE,
      total,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
    },
  };
};

const sortLatestFirst = (items = []) => [...items].sort((left, right) => Number(right.sortTimestamp || 0) - Number(left.sortTimestamp || 0));

const getRideCategoryForTab = (tab) => {
  if (tab === 'Rides') return 'rides';
  if (tab === 'Parcels') return 'parcels';
  if (tab === 'Outstation') return 'outstation';
  if (tab === 'Scheduled') return 'scheduled';
  return '';
};

const getHelperText = (tab) => {
  if (tab === 'Support') return 'Tickets and help requests';
  if (tab === 'Outstation') return 'Long-distance trips and outstation deliveries';
  if (tab === 'Scheduled') return 'Bookings reserved for a later pickup time';
  return 'Your recent trips, deliveries, and bookings';
};

const Activity = () => {
  const [activeTab, setActiveTab] = useState('All');
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const routePrefix = location.pathname.startsWith('/taxi/user') ? '/taxi/user' : '';

  useEffect(() => {
    let active = true;

    const loadActivities = async () => {
      setLoading(true);
      setError('');

      try {
        if (activeTab === 'Support') {
          if (!active) return;
          setActivities([]);
          setPagination({
            page: 1,
            limit: PAGE_SIZE,
            total: 0,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          });
          return;
        }

        let nextActivities = [];
        let nextPagination = null;

        if (activeTab === 'All') {
          const ridesResponse = await api.get('/rides', {
            params: {
              limit: AGGREGATE_FETCH_LIMIT,
              page: 1,
            },
          });

          const ridePayload = getPayload(ridesResponse);
          const rides = Array.isArray(ridePayload?.results) ? ridePayload.results : [];
          const merged = sortLatestFirst(rides.map(normalizeRide).filter((item) => item.id));
          const localPage = buildLocalPagination(merged, currentPage);
          nextActivities = localPage.results;
          nextPagination = localPage.pagination;
        } else {
          const response = await api.get('/rides', {
            params: {
              limit: PAGE_SIZE,
              page: currentPage,
              category: getRideCategoryForTab(activeTab),
            },
          });
          const payload = getPayload(response);
          const rides = Array.isArray(payload?.results) ? payload.results : [];
          nextActivities = rides.map(normalizeRide).filter((ride) => ride.id);
          nextPagination = payload?.pagination || null;
        }

        if (!active) {
          return;
        }

        setActivities(nextActivities);
        setPagination(nextPagination || {
          page: currentPage,
          limit: PAGE_SIZE,
          total: nextActivities.length,
          totalPages: Math.max(1, Math.ceil(nextActivities.length / PAGE_SIZE)),
          hasNextPage: false,
          hasPrevPage: currentPage > 1,
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError?.message || 'Could not load your ride history.');
        setActivities([]);
        setPagination({
          page: 1,
          limit: PAGE_SIZE,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        });
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadActivities();

    return () => {
      active = false;
    };
  }, [activeTab, currentPage, reloadKey]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  const handleItemClick = (item) => {
    if (item.type === 'parcel') {
      navigate(`${routePrefix}/parcel/detail/${item.id}`);
    } else {
      navigate(`${routePrefix}/ride/detail/${item.id}`, { state: { ride: item.ride } });
    }
  };
  const helperText = useMemo(() => getHelperText(activeTab), [activeTab]);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-slate-50 font-sans pb-28">
      <ActivityHeader helperText={helperText} onBack={() => navigate(-1)} />
      <ActivityTabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="flex-1 px-4 py-4">
        {activeTab === 'Support' ? (
          <ActivitySupportState onContact={() => navigate('/support')} />
        ) : loading ? (
          <ActivityLoadingState />
        ) : error ? (
          <ActivityErrorState error={error} onRetry={() => setReloadKey((current) => current + 1)} />
        ) : activities.length === 0 ? (
          <ActivityEmptyState activeTab={activeTab} />
        ) : (
          <div className="space-y-3 pb-2">
            {activities.map((activity) => (
              <ActivityCard key={activity.id} {...activity} onClick={() => handleItemClick(activity)} />
            ))}
            <ActivityPager
              pagination={pagination}
              onPrevious={() => setCurrentPage((page) => Math.max(1, page - 1))}
              onNext={() => setCurrentPage((page) => Math.min(pagination.totalPages, page + 1))}
            />
          </div>
        )}
      </div>

      <BottomNavbar />
    </div>
  );
};

export default Activity;
