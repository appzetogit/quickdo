import api from '@sp/services/api';

const BASE_URL = '/admin/cities';

export const cityService = {
  // Get all cities (admin view)
  getAll: async () => {
    const response = await api.get(BASE_URL);
    return response.data;
  },

  // Get active cities (public view - if needed for switcher)
  getActive: async () => {
    const response = await api.get('/cities/public');
    return response.data;
  },

  // Get single city
  getById: async (id) => {
    const response = await api.get(`${BASE_URL}/${id}`);
    return response.data;
  },

  // Create city
  create: async (data) => {
    const response = await api.post(BASE_URL, data);
    return response.data;
  },

  // Update city
  update: async (id, data) => {
    const response = await api.put(`${BASE_URL}/${id}`, data);
    return response.data;
  },

  // Delete city
  delete: async (id) => {
    const response = await api.delete(`${BASE_URL}/${id}`);
    return response.data;
  },

  // Toggle status
  toggleStatus: async (id) => {
    const response = await api.patch(`${BASE_URL}/${id}/status`);
    return response.data;
  }
};

