import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { playNotificationSound, isSoundEnabled, playAlertRing } from '../utils/notificationSound';

const SwipeableNotification = ({ t, data, onClick }) => {
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-200, 0, 200], [0, 1, 0]);

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      style={{ x, opacity }}
      onDragEnd={(e, { offset, velocity }) => {
        const swipe = Math.abs(offset.x) * velocity.x;
        if (Math.abs(offset.x) > 80) { // Threshold
          toast.dismiss(t.id);
        }
      }}
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{
        opacity: t.visible ? 1 : 0,
        y: t.visible ? 0 : -20,
        scale: t.visible ? 1 : 0.95
      }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      whileTap={{ scale: 0.98 }}
      className="max-w-md w-full bg-white/95 backdrop-blur-sm shadow-2xl rounded-2xl pointer-events-auto flex ring-1 ring-gray-900/5 cursor-pointer dark:bg-gray-800 dark:ring-gray-700"
      onClick={onClick}
    >
      <div className="flex-1 w-0 p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0 pt-0.5">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md">
              <span className="text-lg">🔔</span>
            </div>
          </div>
          <div className="ml-3 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {data.title}
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
              {data.message}
            </p>
          </div>
        </div>
      </div>
      <div className="flex border-l border-gray-200 dark:border-gray-700">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="w-full border border-transparent rounded-none rounded-r-2xl p-4 flex items-center justify-center text-sm font-medium text-gray-400 hover:text-gray-500 focus:outline-none"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
};

const SocketContext = createContext(null);

/**
 * Origin + namespace for the service-provider socket.
 *
 * Two things changed when this module moved into master:
 *  - the API base is now VITE_SP_API_BASE_URL (food and taxi own VITE_API_BASE_URL,
 *    and set it to `<origin>/api/v1`, which this file's `/api$` strip would miss);
 *  - SP no longer owns the Socket.IO server. It is a NAMESPACE on master's single
 *    io instance, so the client has to connect to `<origin>/sp` -- connecting to the
 *    origin alone lands on master's default namespace and silently receives nothing.
 */
const SP_SOCKET_NAMESPACE = '/sp';

const resolveSocketUrl = () => {
  const base = import.meta.env.VITE_SP_API_BASE_URL || '/api/v1/sp';
  let origin;
  try {
    // Absolute base -> take its origin. Relative base -> same origin as the page.
    origin = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000').origin;
  } catch {
    origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000';
  }
  return `${origin}${SP_SOCKET_NAMESPACE}`;
};

const SOCKET_URL = resolveSocketUrl();

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Determine user type based on path
  const getUserType = (path) => {
    if (path.startsWith('/vendor')) return 'vendor';
    if (path.startsWith('/worker')) return 'worker';
    if (path.startsWith('/admin')) return 'admin';
    if (path.startsWith('/user')) return 'user';
    return null;
  };

  const userType = getUserType(location.pathname);

  let currentTokenKey = 'accessToken';
  switch (userType) {
    case 'vendor':
      currentTokenKey = 'vendorAccessToken';
      break;
    case 'worker':
      currentTokenKey = 'workerAccessToken';
      break;
    case 'admin':
      currentTokenKey = 'adminAccessToken';
      break;
    case 'user':
    default:
      currentTokenKey = 'accessToken';
      break;
  }

  const currentToken = localStorage.getItem(currentTokenKey);

  useEffect(() => {
    if (!userType) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    // If no token, we don't connect
    if (!currentToken) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
      return;
    }

    // Reuse existing socket if userType hasn't changed (effectively) is handled by React deps
    // But basic useEffect will re-run if dependencies change.
    // userType changes -> re-run.

    // Disconnect previous if any
    if (socket) {
      // Optimization: if we are already connected with same token/auth, maybe don't reconnect?
      // But determining that is hard. Simpler to reconnect.
      socket.disconnect();
    }

    // Use HTTP URL for socket.io client - it handles WS upgrade automatically
    const socketBaseUrl = SOCKET_URL;

    const newSocket = io(socketBaseUrl, {
      auth: {
        token: currentToken
      },
      transports: ['polling', 'websocket'], // Try polling first for reliability
      path: '/socket.io/',
      secure: true,
      rejectUnauthorized: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true
    });

    setSocket(newSocket);

    newSocket.on('connect', () => {
      // console.log(`✅ ${userType?.toUpperCase()} App Socket connected`);
      // console.log(`[DEBUG] userType: ${userType}, hasToken: ${!!currentToken}`);
      
      // FCM token registration and foreground handler are set up once in App.jsx
      // Do NOT call them here to avoid duplicate handlers on every socket reconnect


      // If vendor, join vendor-specific room just in case backend expects it
      if (userType === 'vendor') {
        const vendorData = JSON.parse(localStorage.getItem('vendorData') || '{}');
        const vendorId = vendorData.id || vendorData._id;
        if (vendorId) {
          newSocket.emit('join_vendor_room', vendorId);
        }
      }

      if (userType === 'worker') {
        const workerData = JSON.parse(localStorage.getItem('workerData') || '{}');
        const workerId = workerData.id || workerData._id;
        if (workerId) {
          newSocket.emit('join_worker_room', workerId);
        }
      }
    });

    newSocket.on('disconnect', () => {
      // console.log(`❌ ${userType.toUpperCase()} App Socket disconnected`);
    });

    // Listen for generic notifications
    newSocket.on('notification', (data) => {
      if (isSoundEnabled(userType)) {
        playNotificationSound();
      }

      // Show custom toast for all notifications
      toast.custom((t) => (
        <SwipeableNotification
          t={t}
          data={data}
          onClick={() => {
            toast.dismiss(t.id);
            // Optional: navigate based on relatedId
            if (data.relatedId) {
              if (userType === 'vendor') navigate(`/vendor/booking/${data.relatedId}`);
              else if (userType === 'worker') navigate(`/worker/job/${data.relatedId}`);
              else navigate(`/user/booking/${data.relatedId}`);
            }
          }}
        />
      ), {
        duration: 3000,
        position: 'top-right'
      });

      // Dispatch update events to refresh UI components
      if (userType === 'worker') window.dispatchEvent(new Event('workerJobsUpdated'));
      if (userType === 'vendor') {
        window.dispatchEvent(new Event('vendorJobsUpdated'));
        window.dispatchEvent(new Event('vendorNotificationsUpdated'));
        window.dispatchEvent(new Event('vendorStatsUpdated'));
      }
      if (userType === 'user') {
        window.dispatchEvent(new Event('userBookingsUpdated'));
      }
    });

    // Listen for real-time booking updates
    newSocket.on('booking_updated', (data) => {
      // console.log('Booking Updated:', data);
      if (userType === 'user') window.dispatchEvent(new Event('userBookingsUpdated'));
      if (userType === 'vendor') window.dispatchEvent(new Event('vendorJobsUpdated'));
      if (userType === 'worker') window.dispatchEvent(new Event('workerJobsUpdated'));
    });

    // Listen for special Vendor Booking Requests
    if (userType === 'vendor') {
      newSocket.on('new_booking_request', (data) => {
        // console.log('🚨 New Booking Request Alert:', data);

        // Play urgent alert ring
        playAlertRing();

        // Save to localStorage for the Alert screen and Dashboard to read
        // Note: Even though we are moving to backend, keeping this for immediate UI responsiveness before potential refresh lag
        const newJob = {
          id: data.bookingId,
          serviceType: data.serviceName,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          location: {
            address: data.address?.addressLine1 || 'Location shared',
            distance: data.distance ? `${data.distance.toFixed(1)} km` : 'Near you'
          },
          price: data.price,
          vendorEarnings: data.vendorEarnings,
          serviceCategory: data.serviceCategory,
          brandName: data.brandName,
          brandIcon: data.brandIcon,
          categoryIcon: data.categoryIcon,
          scheduledDate: data.scheduledDate,
          scheduledTime: data.scheduledTime,
          timeSlot: {
            date: new Date(data.scheduledDate).toLocaleDateString(),
            time: data.scheduledTime
          },
          status: 'requested',
          createdAt: data.createdAt || new Date().toISOString(),
          expiresAt: data.expiresAt
        };

        const pendingJobs = JSON.parse(localStorage.getItem('vendorPendingJobs') || '[]');
        if (!pendingJobs.find(job => job.id === newJob.id)) {
          pendingJobs.unshift(newJob);
          localStorage.setItem('vendorPendingJobs', JSON.stringify(pendingJobs));

          // Update stats
          const stats = JSON.parse(localStorage.getItem('vendorStats') || '{}');
          stats.pendingAlerts = (stats.pendingAlerts || 0) + 1;
          localStorage.setItem('vendorStats', JSON.stringify(stats));
        }

        // Notify app components to refresh
        window.dispatchEvent(new Event('vendorJobsUpdated'));
        window.dispatchEvent(new Event('vendorStatsUpdated'));
        window.dispatchEvent(new Event('vendorNotificationsUpdated'));

        // Always show the global alert instead of navigating
        const event = new CustomEvent('showDashboardBookingAlert', { detail: newJob });
        window.dispatchEvent(event);
      });

      // Listen for booking_taken - when another vendor accepts a job
      newSocket.on('booking_taken', (data) => {
        // console.log('⚡ Booking taken by another vendor:', data);
        const takenBookingId = String(data.bookingId);

        // Remove from localStorage
        const pendingJobs = JSON.parse(localStorage.getItem('vendorPendingJobs') || '[]');
        const updatedPending = pendingJobs.filter(job => {
          const jobId = String(job.id || job._id);
          return jobId !== takenBookingId;
        });
        localStorage.setItem('vendorPendingJobs', JSON.stringify(updatedPending));

        // Update stats
        const stats = JSON.parse(localStorage.getItem('vendorStats') || '{}');
        if (stats.pendingAlerts > 0) {
          stats.pendingAlerts = Math.max(0, (stats.pendingAlerts || 0) - 1);
          localStorage.setItem('vendorStats', JSON.stringify(stats));
        }

        // Show toast notification
        toast.error(data.message || 'Job taken by another vendor', { icon: '⚡' });

        // Dispatch specific remove event for instant UI update
        window.dispatchEvent(new CustomEvent('removeVendorBooking', { detail: { id: takenBookingId } }));

        // Notify app components to refresh
        window.dispatchEvent(new Event('vendorJobsUpdated'));
        window.dispatchEvent(new Event('vendorStatsUpdated'));
      });

      // Listen for removeVendorBooking - generic removal (timeout, cancellation, etc.)
      newSocket.on('removeVendorBooking', (data) => {
        const bookingId = String(data.bookingId || data.id);

        // Remove from localStorage
        const pendingJobs = JSON.parse(localStorage.getItem('vendorPendingJobs') || '[]');
        const updatedPending = pendingJobs.filter(job => String(job.id || job._id) !== bookingId);
        localStorage.setItem('vendorPendingJobs', JSON.stringify(updatedPending));

        // Update stats
        const stats = JSON.parse(localStorage.getItem('vendorStats') || '{}');
        if (stats.pendingAlerts > 0) {
          stats.pendingAlerts = Math.max(0, (stats.pendingAlerts || 0) - 1);
          localStorage.setItem('vendorStats', JSON.stringify(stats));
        }

        // Dispatch specific remove event for instant UI update
        window.dispatchEvent(new CustomEvent('removeVendorBooking', { detail: { id: bookingId } }));
        window.dispatchEvent(new Event('vendorJobsUpdated'));
        window.dispatchEvent(new Event('vendorStatsUpdated'));
      });
    }

    // Listen for special Worker Job Assignments
    if (userType === 'worker') {
      newSocket.on('new_job_assigned', (data) => {
        // Play urgent alert ring
        playAlertRing();

        const newJob = {
          id: data.bookingId,
          _id: data.bookingId,
          serviceType: data.serviceName || 'Service',
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          location: {
            address: data.address?.addressLine1 || 'Location shared',
          },
          price: data.price,
          scheduledDate: data.scheduledDate,
          scheduledTime: data.scheduledTime,
          timeSlot: {
            date: new Date(data.scheduledDate).toLocaleDateString(),
            time: data.scheduledTime
          },
          status: 'ASSIGNED',
          createdAt: new Date().toISOString()
        };

        const pendingJobs = JSON.parse(localStorage.getItem('workerPendingJobs') || '[]');
        if (!pendingJobs.find(job => String(job.id || job._id) === String(newJob.id))) {
          pendingJobs.unshift(newJob);
          localStorage.setItem('workerPendingJobs', JSON.stringify(pendingJobs));
        }

        // Notify app components to refresh
        window.dispatchEvent(new Event('workerJobsUpdated'));

        // Always show the global alert 
        const event = new CustomEvent('showWorkerJobAlert', { detail: newJob });
        window.dispatchEvent(event);
      });

      // Listen for direct booking requests (Worker Mode)
      newSocket.on('new_booking_request', (data) => {
        // Play urgent alert ring
        playAlertRing();

        const newJob = {
          id: data.bookingId,
          _id: data.bookingId,
          serviceType: data.serviceName || 'Service',
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          location: {
            address: data.address?.addressLine1 || 'Location shared',
            distance: data.distance ? `${data.distance.toFixed(1)} km` : 'Near you'
          },
          price: data.price,
          serviceCategory: data.serviceCategory,
          brandName: data.brandName,
          brandIcon: data.brandIcon,
          categoryIcon: data.categoryIcon,
          scheduledDate: data.scheduledDate,
          scheduledTime: data.scheduledTime,
          timeSlot: {
            date: new Date(data.scheduledDate).toLocaleDateString(),
            time: data.scheduledTime
          },
          status: 'requested',
          createdAt: data.createdAt || new Date().toISOString(),
          expiresAt: data.expiresAt
        };

        // Save to localStorage for persistence
        const pendingJobs = JSON.parse(localStorage.getItem('workerPendingJobs') || '[]');
        if (!pendingJobs.find(job => String(job.id || job._id) === String(newJob.id))) {
          pendingJobs.unshift(newJob);
          localStorage.setItem('workerPendingJobs', JSON.stringify(pendingJobs));
        }

        // Notify app components to refresh
        window.dispatchEvent(new Event('workerJobsUpdated'));

        // Show the alert modal
        const event = new CustomEvent('showWorkerJobAlert', { 
          detail: {
            ...newJob,
            service: newJob.serviceType, // Alias for older components
            amount: newJob.price
          } 
        });
        window.dispatchEvent(event);
      });

      // Listen for removeWorkerBooking - generic removal (timeout, cancellation, etc.)
      newSocket.on('removeWorkerBooking', (data) => {
        const bookingId = String(data.bookingId || data.id);

        // Remove from localStorage
        const pendingJobs = JSON.parse(localStorage.getItem('workerPendingJobs') || '[]');
        const updatedPending = pendingJobs.filter(job => String(job.id || job._id) !== bookingId);
        localStorage.setItem('workerPendingJobs', JSON.stringify(updatedPending));

        // Dispatch specific remove event for instant UI update (closes alert)
        window.dispatchEvent(new CustomEvent('removeWorkerJobAlert', { detail: { id: bookingId } }));
        window.dispatchEvent(new Event('workerJobsUpdated'));
      });
    }

    return () => {
      newSocket.disconnect();
    };
  }, [userType, currentToken]); // Re-run if userType or currentToken changes

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);

