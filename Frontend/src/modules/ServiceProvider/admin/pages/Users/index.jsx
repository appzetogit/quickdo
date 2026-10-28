import React from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiUsers, FiShoppingBag, FiActivity, FiDollarSign } from 'react-icons/fi';

// Import sub-components
// Import sub-components
import AllUsers from './AllUsers';
import UserBookings from './UserBookings';
import UserAnalytics from './UserAnalytics';

const Users = () => {
  const location = useLocation();

  const navTabs = [
    { name: 'All Users', path: '/admin/users/all', icon: FiUsers },
    { name: 'User Bookings', path: '/admin/users/bookings', icon: FiShoppingBag },
    { name: 'User Analytics', path: '/admin/users/analytics', icon: FiActivity },
  ];

  const getPageTitle = () => {
    const currentTab = navTabs.find(tab => location.pathname === tab.path);
    return currentTab ? currentTab.name : 'User Management';
  };

  return (
    <div className="space-y-6">
      {/* Content Area */}
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Routes>
          <Route path="/" element={<Navigate to="all" replace />} />
          <Route path="all" element={<AllUsers />} />
          <Route path="bookings" element={<UserBookings />} />
          <Route path="analytics" element={<UserAnalytics />} />
          <Route path="*" element={<Navigate to="all" replace />} />
        </Routes>
      </motion.div>
    </div>
  );
};

export default Users;

