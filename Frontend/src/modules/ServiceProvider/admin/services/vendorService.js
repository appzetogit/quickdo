import api from '@sp/services/api';

/**
 * Admin Vendor Service
 * Handles all admin vendor management API calls
 */

/**
 * Get all vendors with filters and pagination
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Vendors data
 */
export const getAllVendors = async (params = {}) => {
  try {
    const queryParams = new URLSearchParams();
    if (params.search) queryParams.append('search', params.search);
    if (params.approvalStatus) queryParams.append('approvalStatus', params.approvalStatus);
    if (params.isActive !== undefined) queryParams.append('isActive', params.isActive);
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);

    const response = await api.get(`/admin/vendors?${queryParams.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching vendors:', error);
    throw error;
  }
};

/**
 * Get vendor details by ID
 * @param {string} id - Vendor ID
 * @returns {Promise<Object>} Vendor details
 */
export const getVendorDetails = async (id) => {
  try {
    const response = await api.get(`/admin/vendors/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching vendor details:', error);
    throw error;
  }
};

/**
 * Approve vendor registration
 * @param {string} id - Vendor ID
 * @returns {Promise<Object>} Approval result
 */
export const approveVendor = async (id) => {
  try {
    const response = await api.post(`/admin/vendors/${id}/approve`);
    return response.data;
  } catch (error) {
    console.error('Error approving vendor:', error);
    throw error;
  }
};

/**
 * Reject vendor registration
 * @param {string} id - Vendor ID
 * @param {string} reason - Rejection reason (optional)
 * @returns {Promise<Object>} Rejection result
 */
export const rejectVendor = async (id, reason = '') => {
  try {
    const response = await api.post(`/admin/vendors/${id}/reject`, { reason });
    return response.data;
  } catch (error) {
    console.error('Error rejecting vendor:', error);
    throw error;
  }
};

/**
 * Suspend vendor
 * @param {string} id - Vendor ID
 * @returns {Promise<Object>} Suspension result
 */
export const suspendVendor = async (id) => {
  try {
    const response = await api.post(`/admin/vendors/${id}/suspend`);
    return response.data;
  } catch (error) {
    console.error('Error suspending vendor:', error);
    throw error;
  }
};

/**
 * Get vendor bookings
 * @param {string} id - Vendor ID
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Vendor bookings
 */
export const getVendorBookings = async (id, params = {}) => {
  try {
    const queryParams = new URLSearchParams();
    if (params.status) queryParams.append('status', params.status);
    if (params.page) queryParams.append('page', params.page);
    if (params.limit) queryParams.append('limit', params.limit);

    const response = await api.get(`/admin/vendors/${id}/bookings?${queryParams.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching vendor bookings:', error);
    throw error;
  }
};

/**
 * Get vendor earnings
 * @param {string} id - Vendor ID
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Vendor earnings
 */
export const getVendorEarnings = async (id, params = {}) => {
  try {
    const queryParams = new URLSearchParams();
    if (params.startDate) queryParams.append('startDate', params.startDate);
    if (params.endDate) queryParams.append('endDate', params.endDate);

    const response = await api.get(`/admin/vendors/${id}/earnings?${queryParams.toString()}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching vendor earnings:', error);
    throw error;
  }
};

export default {
  getAllVendors,
  getVendorDetails,
  approveVendor,
  rejectVendor,
  suspendVendor,
  getVendorBookings,
  getVendorEarnings
};


