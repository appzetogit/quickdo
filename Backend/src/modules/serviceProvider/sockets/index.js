// Service-Provider socket handlers.
//
// This used to own a Socket.IO server of its own (`new Server(httpServer)`). Inside
// master there is exactly ONE io instance, created in src/config/socket.js, and a
// second one on the same HTTP server would fight it for the /socket.io path.
//
// So we attach to a NAMESPACE instead. Everything below -- auth, rooms, events --
// is unchanged; it just runs on io.of('/sp'). Rooms are namespace-scoped, so SP's
// `user_<id>` cannot collide with food's `user:<id>`.
//
// CORS and transports are inherited from the root server, so the origin list that
// used to live here now belongs in isOriginAllowed() in src/config/env.js.
//
// Clients connect with:  io(BASE_URL + '/sp', { auth: { token } })

let io = null;

const configureSPSocketServer = (rootIo) => {
  if (!rootIo) {
    console.warn('[SP Socket] no root io provided; SP realtime is disabled');
    return null;
  }
  if (io) {
    return io; // already attached
  }

  io = rootIo.of('/sp');

  // Authentication middleware for Socket.io
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify token using the same method as HTTP middleware
      const { verifyAccessToken } = require('../utils/tokenService');
      const decoded = verifyAccessToken(token);

      let userId = decoded.userId;

      // Same bridge as the REST middleware. A super-app customer connects with
      // a MASTER-issued token, whose userId names a `users` document. Without
      // this the socket joins `user_<masterId>` while every server emit targets
      // `user_<spUserId>` -- the customer would appear connected and silently
      // receive no booking_accepted / booking_updated / live_location_update.
      // See utils/identityBridge.js.
      if (decoded.role === 'USER') {
        const SPUser = require('../models/User');
        const known = await SPUser.exists({ _id: userId }).catch(() => null);
        if (!known) {
          const { resolveSharedCustomer } = require('../utils/identityBridge');
          const bridged = await resolveSharedCustomer(userId);
          if (!bridged) {
            return next(new Error('Authentication error: unknown customer'));
          }
          userId = bridged._id.toString();
        }
      }

      socket.userId = userId;
      socket.userRole = decoded.role;

      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (User: ${socket.userId}, Role: ${socket.userRole})`);

    // Join user-specific room for notifications
    if (socket.userRole === 'USER') {
      socket.join(`user_${socket.userId.toString()}`);
    } else if (socket.userRole === 'VENDOR') {
      socket.join(`vendor_${socket.userId.toString()}`);
      // Update vendor online status
      updateVendorOnlineStatus(socket.userId, true, socket.id);
    } else if (socket.userRole === 'WORKER') {
      socket.join(`worker_${socket.userId.toString()}`);
      // Update worker online status
      updateWorkerOnlineStatus(socket.userId, true, socket.id);
    } else if (socket.userRole === 'ADMIN') {
      socket.join(`admin_${socket.userId.toString()}`);
    }

    // Explicit Room Join Events (Fallback/Frontend Initiated)
    socket.on('join_vendor_room', (vendorId) => {
      // Security check: ensure the socket user actually IS this vendor
      if (socket.userRole === 'VENDOR' && socket.userId.toString() === vendorId.toString()) {
        socket.join(`vendor_${vendorId.toString()}`);
        console.log(`Socket ${socket.id} explicitly joined room vendor_${vendorId}`);
      }
    });

    socket.on('join_user_room', (userId) => {
      // Ensure strings for comparison
      if (socket.userRole === 'USER' && socket.userId.toString() === userId.toString()) {
        socket.join(`user_${userId.toString()}`);
        console.log(`Socket ${socket.id} explicitly joined room user_${userId}`);
      }
    });

    socket.on('join_worker_room', (workerId) => {
      if (socket.userRole === 'WORKER' && socket.userId === workerId) {
        socket.join(`worker_${workerId}`);
        console.log(`Socket ${socket.id} explicitly joined room worker_${workerId}`);
      }
    });

    // Live Tracking Events
    socket.on('join_tracking', async (bookingId) => {
      // Only parties to this booking may watch its live location
      try {
        const Booking = require('../models/Booking');
        const booking = await Booking.findById(bookingId)
          .select('userId vendorId workerId')
          .lean();

        if (!booking) return;

        const isParty =
          (socket.userRole === 'USER' && booking.userId?.toString() === socket.userId.toString()) ||
          (socket.userRole === 'VENDOR' && booking.vendorId?.toString() === socket.userId.toString()) ||
          (socket.userRole === 'WORKER' && booking.workerId?.toString() === socket.userId.toString()) ||
          socket.userRole === 'ADMIN';

        if (!isParty) {
          console.warn(`[Socket] BLOCKED tracking join: ${socket.userRole} ${socket.userId} -> booking ${bookingId}`);
          return;
        }
      } catch (error) {
        console.error('[Socket] join_tracking authorization failed:', error);
        return;
      }

      socket.join(`booking_${bookingId}`);
      console.log(`User ${socket.userId} joined tracking for booking_${bookingId}`);

      // Disconnect Recovery: Send last known location from Redis
      try {
        const { getLiveLocation } = require('../services/redisService');
        const cachedLocation = await getLiveLocation(bookingId);
        if (cachedLocation) {
          socket.emit('live_location_update', cachedLocation);
          console.log(`[Socket] Sent cached location to user for booking ${bookingId}`);
        }
      } catch (error) {
        console.error('[Socket] Error fetching cached location:', error);
      }
    });

    // Vendor acknowledges receiving booking alert
    socket.on('booking_alert_received', async (data) => {
      try {
        const BookingRequest = require('../models/BookingRequest');
        await BookingRequest.findOneAndUpdate(
          { bookingId: data.bookingId, vendorId: socket.userId },
          { status: 'VIEWED', viewedAt: new Date(), socketDelivered: true }
        );
        console.log(`[Socket] Vendor ${socket.userId} viewed booking ${data.bookingId}`);
      } catch (error) {
        console.error('[Socket] Error updating booking request:', error);
      }
    });

    // Worker/Vendor sets availability
    socket.on('set_availability', async (data) => {
      try {
        const Vendor = require('../models/Vendor');
        const Worker = require('../models/Worker');

        if (socket.userRole === 'VENDOR') {
          await Vendor.findByIdAndUpdate(socket.userId, {
            availability: data.status // 'AVAILABLE', 'BUSY', etc.
          });
        } else if (socket.userRole === 'WORKER') {
          await Worker.findByIdAndUpdate(socket.userId, {
            status: data.status // 'ONLINE', 'BUSY', etc.
          });
        }
        console.log(`[Socket] ${socket.userRole} ${socket.userId} set availability to ${data.status}`);
      } catch (error) {
        console.error('[Socket] Error setting availability:', error);
      }
    });

    // Rate limiting map for location updates
    const locationUpdateTimestamps = new Map();

    socket.on('update_location', async (data) => {
      // data: { bookingId, lat, lng, heading }
      const lat = parseFloat(data.lat);
      const lng = parseFloat(data.lng);
      const heading = parseFloat(data.heading) || 0;

      if (isNaN(lat) || isNaN(lng)) return;

      // Rate limiting: max 1 update per 2 seconds per booking
      const rateLimitKey = `${socket.userId}:${data.bookingId}`;
      const lastUpdate = locationUpdateTimestamps.get(rateLimitKey) || 0;
      const now = Date.now();
      if (now - lastUpdate < 2000) {
        return; // Skip this update, too frequent
      }
      locationUpdateTimestamps.set(rateLimitKey, now);

      const locationPayload = {
        lat,
        lng,
        heading,
        role: socket.userRole
      };

      // DEBUG: Log the broadcast
      console.log(`[Socket] 📍 Broadcasting location to booking_${data.bookingId}:`, { lat: lat.toFixed(6), lng: lng.toFixed(6), heading });

      // 1. Broadcast to everyone in the booking room (User is listening)
      socket.to(`booking_${data.bookingId}`).emit('live_location_update', locationPayload);

      // 2. Cache in Redis with TTL for disconnect recovery
      try {
        const { setLiveLocation, setVendorLocation } = require('../services/redisService');
        await setLiveLocation(data.bookingId, locationPayload, 30); // 30 second TTL

        // Also update vendor geo cache
        if (socket.userRole === 'VENDOR') {
          await setVendorLocation(socket.userId, lat, lng);
        }
      } catch (error) {
        console.error('[Socket] Error caching live location:', error);
      }

      // 3. Save latest location to Database (for initial tracking load)
      try {
        const Vendor = require('../models/Vendor');
        const Worker = require('../models/Worker');

        const updateData = {
          location: {
            lat,
            lng,
            heading,
            updatedAt: new Date()
          },
          geoLocation: {
            type: 'Point',
            coordinates: [lng, lat]
          }
        };

        if (socket.userRole === 'VENDOR') {
          await Vendor.findByIdAndUpdate(socket.userId, updateData);
        } else if (socket.userRole === 'WORKER') {
          await Worker.findByIdAndUpdate(socket.userId, updateData);
        }
      } catch (error) {
        console.error('Error saving live location:', error);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      // Update online status
      if (socket.userRole === 'VENDOR') {
        updateVendorOnlineStatus(socket.userId, false, null);
      } else if (socket.userRole === 'WORKER') {
        updateWorkerOnlineStatus(socket.userId, false, null);
      }
    });
  });

  console.log('[SP Socket] handlers attached to namespace /sp');
  return io;
};

// Helper function to update vendor online status
const updateVendorOnlineStatus = async (vendorId, isOnline, socketId) => {
  try {
    const Vendor = require('../models/Vendor');
    const { setVendorOnline, setVendorAvailability } = require('../services/redisService');

    const updateData = {
      isOnline,
      currentSocketId: socketId
    };

    if (isOnline) {
      updateData.availability = 'AVAILABLE';
    } else {
      updateData.lastSeenAt = new Date();
      updateData.availability = 'OFFLINE';
    }

    // Update MongoDB
    await Vendor.findByIdAndUpdate(vendorId, updateData);

    // Update Redis cache (fast lookup)
    await setVendorOnline(vendorId, isOnline);
    await setVendorAvailability(vendorId, updateData.availability);

    console.log(`[Socket] Vendor ${vendorId} is now ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
  } catch (error) {
    console.error('[Socket] Error updating vendor online status:', error);
  }
};

// Helper function to update worker online status
const updateWorkerOnlineStatus = async (workerId, isOnline, socketId) => {
  try {
    const Worker = require('../models/Worker');

    const updateData = {
      isOnline: isOnline,
      // currentSocketId: socketId // Add to model if needed
    };

    if (!isOnline) {
      updateData.lastSeenAt = new Date();
    }

    // Update MongoDB
    await Worker.findByIdAndUpdate(workerId, updateData);

    console.log(`[Socket] Worker ${workerId} is now ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
  } catch (error) {
    console.error('[Socket] Error updating worker online status:', error);
  }
};

// Returns the /sp NAMESPACE, not the root server. `.to()`, `.in()` and `.emit()`
// behave identically; the difference is `.adapter` (namespace) vs `.sockets.adapter`
// (root server) -- see notificationController.
const getIO = () => {
  if (!io) {
    throw new Error('SP Socket.io namespace not initialised (configureSPSocketServer was never called)');
  }
  return io;
};

// Safe variant for emit sites that should degrade quietly rather than throw when
// realtime is unavailable (e.g. a script or a test booting without sockets).
const tryGetIO = () => io;

module.exports = { configureSPSocketServer, getIO, tryGetIO };

