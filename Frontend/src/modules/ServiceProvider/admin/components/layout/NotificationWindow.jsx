import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiCheck, FiX, FiChevronRight } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

// NotificationWindow now controlled by parent (AdminHeader)
const NotificationWindow = ({
  isOpen,
  onClose,
  position = 'right',
  notifications = [],
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete
}) => {
  const navigate = useNavigate();
  const windowRef = useRef(null);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (windowRef.current && !windowRef.current.contains(event.target)) {
        if (!event.target.closest('[data-notification-button]')) {
          onClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleNotificationClick = (notification) => {
    if (!notification.isRead && onMarkAsRead) {
      onMarkAsRead(notification._id);
    }
    if (notification.relatedId && notification.relatedType === 'booking') {
      // Navigate to booking details if possible, or just bookings list
      // For now, if we have bookingId in data, use it.
      const bookingId = notification.relatedId || notification.bookingId;
      if (bookingId) {
        navigate(`/admin/sp/bookings`);
      }
    }

    if (notification.relatedType === 'scrap') {
      navigate('/admin/sp/scrap');
    }
    onClose();
  };

  const positionClasses = {
    right: 'right-0',
    left: 'left-0',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 z-[9999] lg:hidden"
          />

          <motion.div
            ref={windowRef}
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`fixed lg:absolute ${positionClasses[position]} top-[calc(4rem-40px)] lg:top-full lg:-mt-[38px] right-[11px] lg:-right-[5px] z-[10000] w-[calc(100vw-2rem)] sm:w-96 max-w-md bg-white rounded-xl shadow-2xl border border-gray-200 max-h-[calc(100vh-8rem)] flex flex-col overflow-hidden`}
            style={{ willChange: 'transform' }}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-800">Notifications</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={onMarkAllAsRead}
                    className="text-xs font-semibold text-primary-600 hover:text-primary-700 px-2 py-1 rounded-lg hover:bg-primary-50 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <FiX className="text-lg" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-admin">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <FiBell className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="font-semibold">No notifications</p>
                  <p className="text-sm mt-1">You're all caught up.</p>
                </div>
              ) : (
                <div className="p-2">
                  {notifications.map((n) => (
                    <div
                      key={n._id}
                      className={`p-3 rounded-xl border mb-2 cursor-pointer transition-colors ${n.isRead ? 'bg-white border-gray-200' : 'bg-primary-50 border-primary-300'
                        }`}
                      onClick={() => handleNotificationClick(n)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <FiBell className="text-gray-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-800 text-sm">{n.title}</p>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{n.message}</p>
                          <p className="text-[11px] text-gray-400 mt-2">{new Date(n.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {!n.isRead && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onMarkAsRead && onMarkAsRead(n._id);
                              }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-green-600"
                              title="Mark as read"
                            >
                              <FiCheck />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete && onDelete(n._id);
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-red-600"
                            title="Delete"
                          >
                            <FiX />
                          </button>
                        </div>
                        <FiChevronRight className="text-gray-300 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default NotificationWindow;



