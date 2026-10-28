const Notification = require('../../models/Notification');
const { validationResult } = require('express-validator');
const { sendNotificationToUser, sendNotificationToVendor, sendNotificationToWorker } = require('../../services/firebaseAdmin');

/**
 * Create notification (internal use)
 */
const createNotification = async ({
  userId = null,
  vendorId = null,
  workerId = null,
  adminId = null,
  type,
  title,
  message,
  relatedId = null,
  relatedType = null,
  data = {},
  skipPush = false,
  pushData = {},
  priority = null
}) => {
  try {
    // ── DEDUP CHECK: Redis-first (< 1ms), DB fallback ──────────────────────
    let isDuplicate = false;
    const { getRedis, isRedisConnected } = require('../../services/redisService');

    // Build a deterministic dedup key from the notification fingerprint
    const dedupTarget = userId || vendorId || workerId || adminId || 'unknown';
    const dedupKey = `notif:dedup:${type}:${String(relatedId || '')}:${String(dedupTarget)}`;

    if (isRedisConnected()) {
      // Redis NX (set-if-not-exists) with 5s TTL — atomic, zero extra reads
      const set = await getRedis().set(dedupKey, '1', 'EX', 5, 'NX');
      isDuplicate = set === null; // null means key already existed
    } else {
      // Fallback: DB query (original behaviour when Redis is down)
      const duplicateQuery = {
        type,
        title,
        createdAt: { $gt: new Date(Date.now() - 5000) }
      };
      if (userId) duplicateQuery.userId = userId;
      if (vendorId) duplicateQuery.vendorId = vendorId;
      if (workerId) duplicateQuery.workerId = workerId;
      if (adminId) duplicateQuery.adminId = adminId;
      if (relatedId) duplicateQuery.relatedId = relatedId;

      const existing = await Notification.findOne(duplicateQuery);
      isDuplicate = !!existing;
      if (isDuplicate) return existing;
    }

    if (isDuplicate) {
      console.log(`[Notification] Dedup hit (Redis): ${type} for ${relatedId}`);
      return null;
    }

    const notification = await Notification.create({
      userId,
      vendorId,
      workerId,
      adminId,
      type,
      title,
      message,
      relatedId,
      relatedType,
      data
    });

    // Mirror into the shared platform inbox so this shows up in the cross-vertical
    // feed. Never throws -- a mirror failure must not fail a delivered notification.
    const { mirrorNotification } = require('../../utils/mirrorNotification');
    await mirrorNotification(notification);

    // Check Socket Connectivity to prevent Duplicate Notifications (Push + Socket)
    let io = null;
    let room = null;
    let isOnline = false;

    try {
      const { getIO } = require('../../sockets');
      io = getIO();

      if (userId) room = `user_${userId.toString()}`;
      else if (vendorId) room = `vendor_${vendorId.toString()}`;
      else if (workerId) room = `worker_${workerId.toString()}`;
      else if (adminId) room = `admin_${adminId.toString()}`;

      if (io && room) {
        // Check if user is actively connected to the room.
        // getIO() now returns a Namespace (io.of('/sp')), where the adapter lives at
        // `.adapter`. On a root Server it lives at `.sockets.adapter`. Read both, or
        // this silently reports everyone as offline and the emit below never fires.
        const rooms = io.adapter?.rooms || io.sockets?.adapter?.rooms;
        const roomSize = rooms?.get(room)?.size || 0;
        isOnline = roomSize > 0;
      }
    } catch (e) {
      console.log('Socket check failed:', e.message);
    }

    // DECISION: We will now ALWAYS send Push Notifications for better reliability,
    // even if the user is online via Socket.io. 
    // The Service Worker (v1.0.3) already handles deduplication.

    if (isOnline && io && room) {
      console.log(`[Notification] User ${room} is ONLINE. Sending Socket event.`);
      io.to(room).emit('notification', notification);
    } else {
      console.log(`[Notification] User ${room} is OFFLINE. Sending Push Notification.`);
      // Socket emit useless here, but safe to ignore
    }

    // Send Push Notification (If not skipped)
    if (!skipPush) {
      // Prepare payload
      // Use explicit pushData if provided, otherwise merge generic data
      const payload = {
        title: title,
        body: message,
        priority: priority || pushData.priority || 'high',
        data: {
          ...data,
          ...pushData,
          type: pushData.type || type, // Allow overriding type for push specifically
          relatedId: relatedId ? String(relatedId) : '',
          relatedType: relatedType ? String(relatedType) : '',
          notificationId: String(notification._id)
        }
      };

      // If dataOnly flag is explicitly set in pushData, pass it through
      if (pushData.dataOnly !== undefined) {
        payload.dataOnly = pushData.dataOnly; // Correctly passes both true AND false
      }

      // Send to target
      try {
        if (userId) await sendNotificationToUser(userId, payload);
        if (vendorId) await sendNotificationToVendor(vendorId, payload);
        if (workerId) await sendNotificationToWorker(workerId, payload);
        if (adminId) {
          const { sendNotificationToAdmin } = require('../../services/firebaseAdmin');
          await sendNotificationToAdmin(adminId, payload);
        }
      } catch (pushError) {
        console.error('Auto-push notification failed:', pushError);
        // Do not fail the function, notification is saved in DB
      }
    }
    // Socket emission handled above in "isOnline" block for clarity, 
    // but technically if we wanted to emit even if offline (for when they reconnect? No, socket doesn't buffer like that usually)
    // we could keep it here. But logic above is cleaner: Online -> Socket, Offline -> Push.

    return notification;
  } catch (error) {
    console.error('Create notification error:', error);
    return null;
  }
};

/**
 * Get user notifications
 */
const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { isRead, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { userId };
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get notifications
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ userId, isRead: false });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get user notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications. Please try again.'
    });
  }
};

/**
 * Get vendor notifications
 */
const getVendorNotifications = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { isRead, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { vendorId };
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get notifications
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ vendorId, isRead: false });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications. Please try again.'
    });
  }
};

/**
 * Get worker notifications
 */
const getWorkerNotifications = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { isRead, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { workerId };
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get notifications
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ workerId, isRead: false });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get worker notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications. Please try again.'
    });
  }
};

/**
 * Get admin notifications
 */
const getAdminNotifications = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { isRead, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { adminId };
    if (isRead !== undefined) {
      query.isRead = isRead === 'true';
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get notifications
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ adminId, isRead: false });

    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get admin notifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch notifications. Please try again.',
      ...(process.env.NODE_ENV === 'development' && { error: error.message, stack: error.stack })
    });
  }
};

/**
 * The owner field to filter a caller's notifications by.
 *
 * Uses the role from the verified token (req.userRole). req.user.role is the
 * account document's own field: absent on some accounts and lowercase on others,
 * and every miss used to drop the owner filter -- any caller could mark read or
 * delete anyone's notification, and mark-all-read touched the whole platform.
 * Returns null for an unknown role so callers refuse rather than go unfiltered.
 */
const ownerFilter = (req) => {
  const role = String(req.userRole || req.user?.role || '').trim().toUpperCase();
  const id = req.user?.id;
  if (!id) return null;
  if (role === 'USER') return { userId: id };
  if (role === 'VENDOR') return { vendorId: id };
  if (role === 'WORKER') return { workerId: id };
  if (['ADMIN', 'SUPER_ADMIN', 'SUPERADMIN'].includes(role)) return { adminId: id };
  return null;
};

const invalidRole = (res) => res.status(403).json({ success: false, message: 'Invalid user role' });

/**
 * Mark notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const owner = ownerFilter(req);
    if (!owner) return invalidRole(res);
    const query = { _id: id, ...owner };

    const notification = await Notification.findOne(query);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read. Please try again.'
    });
  }
};

/**
 * Mark all notifications as read
 */
const markAllAsRead = async (req, res) => {
  try {
    const owner = ownerFilter(req);
    if (!owner) return invalidRole(res);
    const query = { isRead: false, ...owner };

    await Notification.updateMany(query, {
      isRead: true,
      readAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read. Please try again.'
    });
  }
};

/**
 * Delete notification
 */
const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const owner = ownerFilter(req);
    if (!owner) return invalidRole(res);
    const query = { _id: id, ...owner };

    const notification = await Notification.findOneAndDelete(query);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification. Please try again.'
    });
  }
};

/**
 * Delete all notifications for the current user
 */
const deleteAllNotifications = async (req, res) => {
  try {
    // Only the caller's own notifications.
    const owner = ownerFilter(req);
    if (!owner) return invalidRole(res);
    const query = { ...owner };

    const result = await Notification.deleteMany(query);

    res.status(200).json({
      success: true,
      message: 'All notifications deleted successfully',
      count: result.deletedCount
    });
  } catch (error) {
    console.error('Delete all notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete all notifications. Please try again.'
    });
  }
};

module.exports = {
  createNotification,
  getUserNotifications,
  getVendorNotifications,
  getWorkerNotifications,
  getAdminNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications
};

