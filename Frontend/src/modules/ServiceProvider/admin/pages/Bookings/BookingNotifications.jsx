import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiCheck, FiX, FiInfo, FiTrash2 } from 'react-icons/fi';

const BookingNotifications = () => {
  const [filter, setFilter] = useState('All Types');
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      title: 'New Booking Received',
      message: 'Booking #ORD-001 has been placed by John Doe',
      time: 'Dec 31, 2025, 06:35 PM',
      bookingId: 'ORD-001',
      type: 'new_booking',
      unread: true,
    },
    {
      id: 2,
      title: 'Booking Cancelled',
      message: 'Booking #ORD-002 has been cancelled by customer',
      time: 'Dec 31, 2025, 05:35 PM',
      bookingId: 'ORD-002',
      type: 'cancelled',
      unread: true,
    },
    {
      id: 3,
      title: 'Payment Failed',
      message: 'Payment for Booking #ORD-003 has failed',
      time: 'Dec 31, 2025, 04:35 PM',
      bookingId: 'ORD-003',
      type: 'payment_failed',
      unread: false,
    }
  ]);

  const unreadCount = notifications.filter(n => n.unread).length;

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, unread: false })));
  };

  const deleteNotification = (id) => {
    setNotifications(notifications.filter(n => n.id !== id));
  };

  const markAsRead = (id) => {
    setNotifications(notifications.map(n => n.id === id ? { ...n, unread: false } : n));
  };

  const getIcon = (type) => {
    switch (type) {
      case 'new_booking': return <FiBell className="text-blue-500 w-5 h-5" />;
      case 'cancelled': return <FiBell className="text-red-500 w-5 h-5" />; // Using generic bell for now, or X
      case 'payment_failed': return <FiBell className="text-yellow-500 w-5 h-5" />;
      default: return <FiInfo className="text-gray-500 w-5 h-5" />;
    }
  };

  const getBgColor = (type) => {
    switch (type) {
      case 'new_booking': return 'bg-blue-50';
      case 'cancelled': return 'bg-red-50';
      case 'payment_failed': return 'bg-yellow-50';
      default: return 'bg-gray-50';
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Controls Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 focus:outline-none focus:border-blue-500 cursor-pointer min-w-[150px]"
          >
            <option>All Types</option>
            <option value="new_booking">New Bookings</option>
            <option value="cancelled">Cancelled</option>
            <option value="payment_failed">Payment Issues</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold px-3 py-1.5 rounded-md">
              {unreadCount} unread
            </span>
          )}
          <button
            onClick={markAllRead}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            Mark All Read
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
        <AnimatePresence>
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No notifications</div>
          ) : (
            notifications.map((notification) => (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`p-4 flex items-center justify-between hover:bg-gray-50 transition-colors group ${notification.unread ? 'bg-blue-50/10' : ''}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getBgColor(notification.type)}`}>
                    {getIcon(notification.type)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{notification.title}</h3>
                    <p className="text-sm text-gray-500">{notification.message}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-400">{notification.time}</span>
                      <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{notification.bookingId}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                  {notification.unread && (
                    <button title="Mark as read" onClick={() => (notification.title)} className="p-2 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors relative">
                      <div className="w-2 h-2 bg-blue-500 rounded-full absolute top-1 right-1" />
                      <FiCheck className="w-4 h-4" /> {/* Simple check icon logic implies read */}
                    </button>
                  )}
                  <button
                    onClick={() => deleteNotification(notification.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                  >
                    <FiX className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default BookingNotifications;

