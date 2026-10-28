import api from '@sp/services/api';

export const getPlans = async () => {
  try {
    const response = await api.get('/admin/plans');
    return response.data;
  } catch (error) {
    console.error('Error fetching plans:', error);
    throw error;
  }
};

export const createPlan = async (planData) => {
  try {
    const response = await api.post('/admin/plans', planData);
    return response.data;
  } catch (error) {
    console.error('Error creating plan:', error);
    throw error;
  }
};

export const updatePlan = async (id, planData) => {
  try {
    const response = await api.put(`/admin/plans/${id}`, planData);
    return response.data;
  } catch (error) {
    console.error('Error updating plan:', error);
    throw error;
  }
};

export const deletePlan = async (id) => {
  try {
    const response = await api.delete(`/admin/plans/${id}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting plan:', error);
    throw error;
  }
};

export default {
  getPlans,
  createPlan,
  updatePlan,
  deletePlan
};

