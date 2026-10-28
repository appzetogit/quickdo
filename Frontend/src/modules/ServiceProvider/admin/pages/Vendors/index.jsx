import React from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiUsers,
  FiBriefcase,
  FiActivity,
  FiDollarSign,
  FiChevronRight
} from 'react-icons/fi';

// Import sub-components
// Import sub-components
import AllVendors from './AllVendors';
import VendorBookings from './VendorBookings';
import VendorAnalytics from './VendorAnalytics';

const Vendors = () => {
  const location = useLocation();

  const navTabs = [
    { name: 'All Vendors', path: '/admin/vendors/all', icon: FiUsers },
    { name: 'Vendor Bookings', path: '/admin/vendors/bookings', icon: FiBriefcase },
    { name: 'Vendor Analytics', path: '/admin/vendors/analytics', icon: FiActivity },
  ];

  const getPageTitle = () => {
    const currentTab = navTabs.find(tab => location.pathname === tab.path);
    return currentTab ? currentTab.name : 'Vendor Management';
  };

  return (
    <div className="space-y-6">
      {/* Page Content */}
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Routes>
          <Route path="/" element={<Navigate to="all" replace />} />
          <Route path="all" element={<AllVendors />} />
          <Route path="bookings" element={<VendorBookings />} />
          <Route path="analytics" element={<VendorAnalytics />} />
        </Routes>
      </motion.div>
    </div>
  );
};

export default Vendors;

