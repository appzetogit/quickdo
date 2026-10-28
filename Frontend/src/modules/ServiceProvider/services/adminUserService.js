import api from './api';

export const adminUserService = {
  // Get all users with pagination and filtering
  getAllUsers: async (params) => {
    try {
      const response = await api.get('/admin/users', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch users' };
    }
  },

  // Get all user bookings
  getAllUserBookings: async (params) => {
    try {
      const response = await api.get('/admin/users/bookings', { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch user bookings' };
    }
  },

  // Get user details
  getUserDetails: async (id) => {
    try {
      const response = await api.get(`/admin/users/${id}`);
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch user details' };
    }
  },

  // Block/Unblock user
  toggleUserStatus: async (id, isActive) => {
    try {
      const response = await api.put(`/admin/users/${id}/status`, { isActive });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to update user status' };
    }
  },

  // Delete user
  deleteUser: async (id) => {
    try {
      const response = await api.delete(`/admin/users/${id}`);
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to delete user' };
    }
  },

  // Get user bookings
  getUserBookings: async (id, params) => {
    try {
      const response = await api.get(`/admin/users/${id}/bookings`, { params });
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch user bookings' };
    }
  },

  // Get user wallet transactions
  getUserWalletTransactions: async (id) => {
    try {
      const response = await api.get(`/admin/users/${id}/wallet`);
      return response.data;
    } catch (error) {
      throw error.response?.data || { message: 'Failed to fetch wallet transactions' };
    }
  }
};

