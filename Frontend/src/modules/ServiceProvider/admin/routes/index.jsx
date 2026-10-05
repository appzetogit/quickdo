import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from '../components/layout/AdminLayout';

// NOTE vs the standalone app:
//   - the /login route is gone. Master's /admin/login is the single door for all
//     three services, and the token it mints is accepted by the SP backend (the
//     `admins` collection and the JWT secret are shared).
//   - ProtectedRoute/PublicRoute are gone for the same reason: master's AdminRouter
//     already wraps this whole subtree in its own ProtectedRoute + AdminLayout.
//   - paths are relative; this router is mounted at /admin/sp/* by master.

const Dashboard = lazy(() => import('../pages/Dashboard'));
const Settings = lazy(() => import('../pages/Settings'));
const UserCategories = lazy(() => import('../pages/UserCategories'));
const Users = lazy(() => import('../pages/Users'));
const Vendors = lazy(() => import('../pages/Vendors'));
const Workers = lazy(() => import('../pages/Workers'));
const Bookings = lazy(() => import('../pages/Bookings'));
const BookingTracking = lazy(() => import('../pages/Bookings/Tracking'));
const BookingNotifications = lazy(() => import('../pages/Bookings/BookingNotifications'));
const Payments = lazy(() => import('../pages/Payments'));
const Reports = lazy(() => import('../pages/Reports'));
const Notifications = lazy(() => import('../pages/Notifications'));
const Plans = lazy(() => import('../pages/Plans/Plans'));
const WorkerPlans = lazy(() => import('../pages/Plans/WorkerPlans'));
const LegalSettings = lazy(() => import('../pages/LegalSettings'));
const Scrap = lazy(() => import('../pages/Scrap'));
const Settlements = lazy(() => import('../pages/Settlements'));
const Reviews = lazy(() => import('../pages/Reviews'));
const Cities = lazy(() => import('../pages/Cities'));

import LogoLoader from '@sp/components/common/LogoLoader';

const LoadingFallback = () => <LogoLoader />;

const ServiceProviderAdminRoutes = () => (
  <Suspense fallback={<LoadingFallback />}>
    <Routes>
      <Route path="/" element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="users/*" element={<Users />} />
        <Route path="vendors/*" element={<Vendors />} />
        <Route path="workers/*" element={<Workers />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="bookings/tracking" element={<BookingTracking />} />
        <Route path="bookings/notifications" element={<BookingNotifications />} />
        <Route path="user-categories/*" element={<UserCategories />} />
        <Route path="payments/*" element={<Payments />} />
        <Route path="reports/*" element={<Reports />} />
        <Route path="notifications/*" element={<Notifications />} />
        <Route path="cities" element={<Cities />} />
        <Route path="scrap" element={<Scrap />} />
        <Route path="plans" element={<Plans />} />
        <Route path="worker-plans" element={<WorkerPlans />} />
        <Route path="legal/terms" element={<LegalSettings type="terms" />} />
        <Route path="legal/privacy" element={<LegalSettings type="privacy" />} />
        <Route path="legal/support" element={<LegalSettings type="support" />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="settlements/*" element={<Settlements />} />
        <Route path="settings/*" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/sp/dashboard" replace />} />
    </Routes>
  </Suspense>
);

export default ServiceProviderAdminRoutes;
