import { useContext } from 'react';
import { useSocket } from '../context/SocketContext';

/**
 * Universal hook for app-wide notifications
 * Now uses the global SocketContext to ensure stable connections across route changes.
 * 
 * @param {string} userType - Deprecated (handled by global context based on route)
 * @returns {Socket} - The active socket instance
 */
export const useAppNotifications = (userType) => {
  const socket = useSocket();
  return socket;
};

export default useAppNotifications;


