import api from '../../../shared/api/axiosInstance';
import { getLocalDriverToken } from './registrationService';

const withDriverAuth = (config = {}) => {
  const token = getLocalDriverToken();

  if (!token) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
};

export const getBusDriverSeatLayout = ({ scheduleId, date }) =>
  api.get(
    '/drivers/bus/seats',
    withDriverAuth({
      params: { scheduleId, date },
    }),
  );

export const getBusDriverBookings = ({ scheduleId, date, status } = {}) =>
  api.get(
    '/drivers/bus/bookings',
    withDriverAuth({
      params: { scheduleId, date, status },
    }),
  );

export const createBusDriverReservation = (payload) =>
  api.post('/drivers/bus/reservations', payload, withDriverAuth());

export const updateBusDriverSchedules = (payload) =>
  api.patch('/drivers/bus/schedules', payload, withDriverAuth());
