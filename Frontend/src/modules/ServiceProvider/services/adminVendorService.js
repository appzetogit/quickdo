import api from './api';

const adminVendorService = {
  /**
   * Get all vendors with optional filters
   */
  getAllVendors: async (params = {}) => {
    const response = await api.get('/admin/vendors', { params });
    return response.data;
  },

  /**
   * Get specific vendor details
   */
  getVendorDetails: async (id) => {
    const response = await api.get(`/admin/vendors/${id}`);
    return response.data;
  },

  /**
   * Approve vendor registration
   */
  approveVendor: async (id) => {
    const response = await api.post(`/admin/vendors/${id}/approve`);
    return response.data;
  },

  /**
   * Reject vendor registration
   */
  rejectVendor: async (id, reason) => {
    const response = await api.post(`/admin/vendors/${id}/reject`, { reason });
    return response.data;
  },

  /**
   * Suspend vendor
   */
  suspendVendor: async (id) => {
    const response = await api.post(`/admin/vendors/${id}/suspend`);
    return response.data;
  },

  /**
   * Toggle vendor active status
   */
  toggleStatus: async (id, isActive) => {
    const response = await api.patch(`/admin/vendors/${id}/status`, { isActive });
    return response.data;
  },

  /**
   * Delete vendor
   */
  deleteVendor: async (id) => {
    const response = await api.delete(`/admin/vendors/${id}`);
    return response.data;
  },

  /**
   * Get bookings for a specific vendor
   */
  getVendorBookings: async (id, params = {}) => {
    const response = await api.get(`/admin/vendors/${id}/bookings`, { params });
    return response.data;
  },

  /**
   * Get all vendor bookings (across all vendors)
   */
  getAllBookings: async (params = {}) => {
    const response = await api.get('/admin/vendors/bookings', { params });
    return response.data;
  },

  /**
   * Get vendor earnings and analytics
   */
  getVendorEarnings: async (id, params = {}) => {
    const response = await api.get(`/admin/vendors/${id}/earnings`, { params });
    return response.data;
  },

  /**
   * Get vendor payments summary
   */
  getVendorPayments: async (params = {}) => {
    const response = await api.get('/admin/vendors/payments', { params });
    return response.data;
  },

  /**
   * Get vendor report/analytics (reusing report endpoint if needed, or separate)
   */
  getVendorAnalytics: async (params = {}) => {
    const response = await api.get('/admin/reports/vendors', { params });
    return response.data;
  }
};

export default adminVendorService;

