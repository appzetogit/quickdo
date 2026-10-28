import api from './api';

export const getDashboardStats = async (params) => {
  try {
    const response = await api.get('/admin/dashboard/stats', { params });
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const getRevenueAnalytics = async (params) => {
  try {
    const response = await api.get('/admin/dashboard/revenue', { params });
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const getBookingTrends = async (days = 30) => {
  try {
    const response = await api.get('/admin/dashboard/bookings/trends', { params: { days } });
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const getUserGrowthMetrics = async (days = 30) => {
  try {
    const response = await api.get('/admin/dashboard/users/growth', { params: { days } });
    return response.data;
  } catch (error) {
    throw error;
  }
};

