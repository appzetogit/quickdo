import api from '@sp/services/api';

/**
 * Admin Dashboard & Reports Service
 */
const dashboardService = {
  /**
   * Get dashboard summary stats
   */
  getStats: async () => {
    const response = await api.get('/admin/dashboard/stats');
    return response.data;
  },

  /**
   * Get revenue analytics
   * @param {Object} params - period (daily, weekly, monthly), startDate, endDate
   */
  getRevenue: async (params = {}) => {
    const response = await api.get('/admin/dashboard/revenue', { params });
    return response.data;
  },

  /**
   * Get booking trends
   * @param {Object} params - days
   */
  getBookingTrends: async (params = {}) => {
    const response = await api.get('/admin/dashboard/bookings/trends', { params });
    return response.data;
  },

  /**
   * Get user and vendor growth metrics
   * @param {Object} params - days
   */
  getGrowthMetrics: async (params = {}) => {
    const response = await api.get('/admin/dashboard/users/growth', { params });
    return response.data;
  }
};

export default dashboardService;

