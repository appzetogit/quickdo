import api from './api';

const adminReportService = {
  // Get Booking Report
  getBookingReport: async (params) => {
    try {
      const response = await api.get('/admin/reports/bookings', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch booking report' };
    }
  },

  // Get Vendor Report
  getVendorReport: async (params) => {
    try {
      const response = await api.get('/admin/reports/vendors', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch vendor report' };
    }
  },

  // Get Worker Report
  getWorkerReport: async (params) => {
    try {
      const response = await api.get('/admin/reports/workers', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch worker report' };
    }
  },

  // Get Customer/User Report
  getCustomerReport: async (params) => {
    try {
      const response = await api.get('/admin/reports/customers', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch customer report' };
    }
  },

  // Get Revenue Report
  getRevenueReport: async (params) => {
    try {
      const response = await api.get('/admin/reports/revenue', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch revenue report' };
    }
  }
};

export default adminReportService;

