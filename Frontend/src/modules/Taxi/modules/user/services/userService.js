import api from '../../../shared/api/axiosInstance';

export const userService = {
  getAppModules: async () => {
    const response = await api.get('/users/app-modules');
    return response;
  },
  getIntercityPackages: async () => {
    const response = await api.get('/users/intercity-packages');
    return response;
  },
  getServiceLocations: async () => {
    const response = await api.get('/users/service-locations');
    return response;
  },
  getAvailablePromos: async (params) => {
    const response = await api.get('/promos/available', { params });
    return response;
  },
  validatePromo: async (payload) => {
    const response = await api.post('/promos/validate', payload);
    return response;
  },
};
