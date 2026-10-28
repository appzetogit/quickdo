import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import PaymentOverview from './PaymentOverview';
import WorkerPayments from './WorkerPayments';
import VendorPayments from './VendorPayments';
import UserPayments from './UserPayments';
import PaymentReports from './PaymentReports';
import AdminRevenue from './AdminRevenue';

const Payments = () => {
  return (
    <div className="space-y-6">
      {/* Content */}
      <div className="min-h-[400px]">
        <Routes>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<PaymentOverview />} />
          <Route path="users" element={<UserPayments />} />
          <Route path="workers" element={<WorkerPayments />} />
          <Route path="vendors" element={<VendorPayments />} />
          <Route path="revenue" element={<AdminRevenue />} />
          <Route path="reports" element={<PaymentReports />} />
          <Route path="*" element={<Navigate to="overview" replace />} />
        </Routes>
      </div>
    </div>
  );
};

export default Payments;
