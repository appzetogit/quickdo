import api from './api';

const adminWorkerService = {
  /**
   * Get all workers with optional filters
   */
  getAllWorkers: async (params = {}) => {
    const response = await api.get('/admin/workers', { params });
    return response.data;
  },

  /**
   * Get specific worker details
   */
  getWorkerDetails: async (id) => {
    const response = await api.get(`/admin/workers/${id}`);
    return response.data;
  },

  /**
   * Approve worker registration
   */
  approveWorker: async (id) => {
    const response = await api.post(`/admin/workers/${id}/approve`);
    return response.data;
  },

  /**
   * Reject worker registration
   */
  rejectWorker: async (id, reason) => {
    const response = await api.post(`/admin/workers/${id}/reject`, { reason });
    return response.data;
  },

  /**
   * Suspend worker
   */
  suspendWorker: async (id) => {
    const response = await api.post(`/admin/workers/${id}/suspend`);
    return response.data;
  },

  /**
   * Toggle worker active status
   */
  toggleStatus: async (id, isActive) => {
    const response = await api.patch(`/admin/workers/${id}/status`, { isActive });
    return response.data;
  },

  /**
   * Delete worker
   */
  deleteWorker: async (id) => {
    const response = await api.delete(`/admin/workers/${id}`);
    return response.data;
  },

  /**
   * Get jobs for a specific worker
   */
  getWorkerJobs: async (id, params = {}) => {
    const response = await api.get(`/admin/workers/${id}/jobs`, { params });
    return response.data;
  },

  /**
   * Get all worker jobs (across all workers)
   */
  getAllJobs: async (params = {}) => {
    const response = await api.get('/admin/workers/jobs', { params });
    return response.data;
  },

  /**
   * Get worker earnings and payment history
   */
  getWorkerEarnings: async (id) => {
    const response = await api.get(`/admin/workers/${id}/earnings`);
    return response.data;
  },

  /**
   * Record a payment to a worker
   */
  payWorker: async (id, paymentData) => {
    const response = await api.post(`/admin/workers/${id}/pay`, paymentData);
    return response.data;
  },

  /**
   * Get worker analytics/stats
   */
  getWorkerAnalytics: async (params = {}) => {
    const response = await api.get('/admin/reports/workers', { params });
    return response.data;
  },

  /**
   * Get worker payments summary
   */
  getWorkerPayments: async (params = {}) => {
    const response = await api.get('/admin/workers/payments', { params });
    return response.data;
  }
};

export default adminWorkerService;

