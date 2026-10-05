import api from '@sp/services/api';

export const getSettings = async () => {
  try {
    const response = await api.get('/admin/settings');
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const updateSettings = async (settingsData) => {
  try {
    const response = await api.put('/admin/settings', settingsData);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const updateAdminProfile = async (profileData) => {
  try {
    const response = await api.put('/admin/auth/profile', profileData);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const getAdminProfile = async () => {
  try {
    const response = await api.get('/admin/auth/profile');
    return response.data;
  } catch (error) {
    throw error;
  }
};

// Admin Management (Super Admin only)
export const getAllAdmins = async () => {
  try {
    const response = await api.get('/admin/admins');
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const createAdmin = async (adminData) => {
  try {
    const response = await api.post('/admin/admins', adminData);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const deleteAdmin = async (id) => {
  try {
    const response = await api.delete(`/admin/admins/${id}`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const updateAdminDetails = async (id, data) => {
  try {
    const response = await api.put(`/admin/admins/${id}`, data);
    return response.data;
  } catch (error) {
    throw error;
  }
};

export const toggleAdminStatus = async (id) => {
  try {
    const response = await api.patch(`/admin/admins/${id}/status`);
    return response.data;
  } catch (error) {
    throw error;
  }
};

