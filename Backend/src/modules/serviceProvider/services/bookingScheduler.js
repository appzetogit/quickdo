/**
 * Booking Scheduler Service — Optimized
 * Handles Wave-Based Vendor Alerting
 *
 * Wave Logic:
 * - Wave 1: First 3 closest vendors (alerted immediately on booking creation)
 * - Wave 2: Next 3 vendors (after 15s if no accept)
 * - Wave 3: Next 4 vendors (after another 15s)
 * - Wave 4+: All remaining vendors
 *
 * OPTIMIZATIONS:
 * - All active bookings processed in PARALLEL (Promise.all, not serial for-loop)
 * - Circuit breaker: if no searching bookings exist, extend check interval to 30s
 * - Single Vendor.find per wave instead of per booking
 */

const Booking = require('../models/Booking');
const Vendor = require('../models/Vendor');
const { BOOKING_STATUS } = require('../utils/constants');
const { createNotification } = require('../controllers/notificationControllers/notificationController');

const Settings = require('../models/Settings');

// Wave configuration
let WAVE_CONFIG = {
  1: { count: 3, duration: 60000 },
  2: { count: 3, duration: 60000 },
  3: { count: 4, duration: 60000 },
  4: { count: Infinity, duration: 0 }
};

let MAX_SEARCH_TIME_MS = 5 * 60 * 1000; // 5 mins fallback

const ACTIVE_INTERVAL_MS = 5000;  // Poll every 5s when bookings exist
const IDLE_INTERVAL_MS = 30000;   // Poll every 30s when no active bookings (circuit breaker)

// Calculate vendor index range for a wave
const getVendorRange = (wave) => {
  let start = 0;
  for (let i = 1; i < wave; i++) {
    start += WAVE_CONFIG[i]?.count || 0;
  }
  const config = WAVE_CONFIG[wave] || WAVE_CONFIG[4];
  const end = config.count === Infinity ? Infinity : start + config.count;
  return { start, end };
};

class BookingScheduler {
  constructor(io) {
    this.io = io;
    this.intervalId = null;
    this.isRunning = false;
    this.isIdle = false; // Circuit breaker state
  }

  start() {
    if (this.isRunning) {
      console.log('[BookingScheduler] Already running.');
      return;
    }
    this.isRunning = true;
    console.log('[BookingScheduler] Started — active interval: 5s, idle interval: 30s');
    this.scheduleNext(ACTIVE_INTERVAL_MS);
  }

  scheduleNext(intervalMs) {
    if (this.intervalId) clearTimeout(this.intervalId);
    this.intervalId = setTimeout(async () => {
      const hadWork = await this.processWaves();
      // Adaptive interval: if idle, slow down; if active, stay fast
      this.scheduleNext(hadWork ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log('[BookingScheduler] Stopped.');
    }
  }

  /**
   * Process all active searching bookings in PARALLEL.
   * @returns {boolean} true if any booking was processed, false if idle
   */
  async processWaves() {
    try {
      const BookingRequest = require('../models/BookingRequest');

      // --- REFRESH SETTINGS ---
      try {
        const globalSettings = await Settings.findOne({ type: 'global' }).lean();
        if (globalSettings) {
          const waveDur = (globalSettings.waveDuration || 60) * 1000;
          WAVE_CONFIG = {
            1: { count: 3, duration: waveDur },
            2: { count: 3, duration: waveDur },
            3: { count: 4, duration: waveDur },
            4: { count: Infinity, duration: 0 }
          };
          MAX_SEARCH_TIME_MS = (globalSettings.maxSearchTime || 5) * 60 * 1000;
        }
      } catch (sErr) {
        console.error('[BookingScheduler] Settings fetch error:', sErr);
      }

      const activeBookings = await Booking.find(
        {
          status: { $in: [BOOKING_STATUS.SEARCHING, BOOKING_STATUS.CONFIRMED] },
          vendorId: null,
          workerId: null,
          waveStartedAt: { $ne: null },
          $or: [
            { potentialVendors: { $exists: true, $not: { $size: 0 } } },
            { potentialWorkers: { $exists: true, $not: { $size: 0 } } }
          ]
        },
        '_id currentWave waveStartedAt potentialVendors potentialWorkers notifiedVendors notifiedWorkers bookingNumber createdAt userId expiresAt bookingModel'
      ).lean();

      if (activeBookings.length === 0) {
        return false; // Idle — caller will use longer interval
      }


      const now = Date.now();

      // --- PARALLEL PROCESSING ---
      await Promise.all(
        activeBookings.map(async (booking) => {
          try {
            const bookingModel = booking.bookingModel || 'vendor';
            const currentWave = booking.currentWave || 1;
            const waveConfig = WAVE_CONFIG[currentWave] || WAVE_CONFIG[4];
            const startTime = new Date(booking.createdAt || booking.waveStartedAt).getTime();
            const totalElapsed = now - startTime;

            // --- PERSISTENCE: Save expiresAt to DB if missing ---
            if (!booking.expiresAt) {
              const expiresAtDate = new Date(startTime + MAX_SEARCH_TIME_MS);
              await Booking.findByIdAndUpdate(booking._id, { $set: { expiresAt: expiresAtDate } });
            }

            // --- EXPIRY CHECK ---
            if (totalElapsed > MAX_SEARCH_TIME_MS) {
              console.log(`[BookingScheduler] ${booking.bookingNumber}: Search timed out. Cancelling.`);

              // Cancel + refund in one transaction; see services/bookingExpiry.js for
              // why the refund that used to live here had never run.
              const { expireTimedOutBooking } = require('./bookingExpiry');
              const expired = await expireTimedOutBooking(booking._id, { bookingModel });
              if (!expired.cancelled) {
                // A partner accepted, or another tick/instance got there first.
                return;
              }
              if (expired.refundAmount > 0) {
                console.log(`[BookingScheduler] ${booking.bookingNumber}: refunded ₹${expired.refundAmount} to wallet.`);
              }

              // Notify User
              if (this.io) {
                this.io.to(`user_${booking.userId}`).emit('booking_search_failed', {
                  bookingId: booking._id,
                  message: `No ${bookingModel}s available at the moment. Please try again later.`
                });
              }

              // Remove from all notified partners
              const notifiedList = bookingModel === 'worker' ? booking.notifiedWorkers : booking.notifiedVendors;
              if (notifiedList && notifiedList.length > 0) {
                notifiedList.forEach(pId => {
                  this.io.to(`${bookingModel}_${pId}`).emit('removePartnerBooking', { id: booking._id });
                });
              }

              return;
            }

            const waveElapsed = now - new Date(booking.waveStartedAt).getTime();
            if (waveConfig.duration === 0 || waveElapsed < waveConfig.duration) return;

            const nextWave = currentWave + 1;
            const { start, end } = getVendorRange(nextWave);

            // Get partners to notify in this wave
            const potentialPartners = bookingModel === 'worker' ? booking.potentialWorkers : booking.potentialVendors;
            let partnersToNotify = potentialPartners.slice(
              start,
              end === Infinity ? undefined : end
            );

            if (partnersToNotify.length === 0) {
              console.log(`[BookingScheduler] Booking ${booking.bookingNumber}: No ${bookingModel}s left in Wave ${nextWave}`);
              return;
            }

            // Filter to only online+available partners
            const partnerIds = partnersToNotify.map(p => p.vendorId || p.workerId);
            const PartnerModel = bookingModel === 'worker' ? require('../models/Worker') : require('../models/Vendor');

            const onlinePartners = await PartnerModel.find(
              {
                _id: { $in: partnerIds },
                isOnline: true,
                ...(bookingModel === 'vendor' ? { availability: { $in: ['AVAILABLE', 'BUSY'] } } : {})
              },
              '_id'
            ).lean();

            const onlineSet = new Set(onlinePartners.map(p => p._id.toString()));
            partnersToNotify = partnersToNotify.filter(p => onlineSet.has((p.vendorId || p.workerId).toString()));

            // Advance wave in DB
            const notifyIds = partnersToNotify.map(p => p.vendorId || p.workerId);
            const notifiedField = bookingModel === 'worker' ? 'notifiedWorkers' : 'notifiedVendors';

            await Booking.findByIdAndUpdate(booking._id, {
              $set: { currentWave: nextWave, waveStartedAt: new Date() },
              $addToSet: { [notifiedField]: { $each: notifyIds } }
            });

            if (partnersToNotify.length === 0) {
              console.log(`[BookingScheduler] Booking ${booking.bookingNumber}: Wave ${nextWave} all offline, advancing quietly`);
              return;
            }

            console.log(`[BookingScheduler] ${booking.bookingNumber}: Wave ${nextWave} → notifying ${partnersToNotify.length} ${bookingModel}s`);

            // Insert BookingRequest records + send notifications
            const bookingRequests = partnersToNotify.map(p => ({
              bookingId: booking._id,
              vendorId: bookingModel === 'vendor' ? p.vendorId : null,
              workerId: bookingModel === 'worker' ? p.workerId : null,
              status: 'PENDING',
              createdAt: booking.createdAt || new Date(),
              distance: p.distance || null,
              sentAt: new Date(),
              expiresAt: new Date(Date.now() + 60 * 60 * 1000)
            }));

            await Promise.all([
              BookingRequest.insertMany(bookingRequests, { ordered: false }).catch(err => {
                if (err.code !== 11000) console.error('[BookingScheduler] BookingRequest insert error:', err);
              }),
              this.notifyPartners(booking, partnersToNotify, bookingModel)
            ]);

          } catch (bookingErr) {
            console.error(`[BookingScheduler] Error processing booking ${booking._id}:`, bookingErr);
          }
        })
      );

      return true;
    } catch (error) {
      console.error('[BookingScheduler] Error processing waves:', error);
      return false;
    }
  }

  async notifyPartners(booking, partners, bookingModel) {
    try {
      const populatedBooking = await Booking.findById(booking._id)
        .populate('serviceId', 'title')
        .populate('userId', 'name phone')
        .lean();

      if (!populatedBooking) return;

      const serviceName = populatedBooking.serviceId?.title || populatedBooking.serviceName;
      const customerName = populatedBooking.userId?.name || 'Customer';

      await Promise.all(
        partners.map(async (p) => {
          const partnerId = p.vendorId || p.workerId;
          const partnerRoom = `${bookingModel}_${partnerId}`;

          if (this.io) {
            this.io.to(partnerRoom).emit('new_booking_request', {
              bookingId: booking._id,
              serviceName,
              customerName,
              customerPhone: populatedBooking.userId?.phone,
              scheduledDate: populatedBooking.scheduledDate,
              scheduledTime: populatedBooking.scheduledTime,
              price: populatedBooking.finalAmount,
              address: populatedBooking.address,
              distance: p.distance,
              serviceCategory: populatedBooking.serviceCategory,
              brandName: populatedBooking.brandName,
              brandIcon: populatedBooking.brandIcon,
              categoryIcon: populatedBooking.categoryIcon,
              createdAt: populatedBooking.createdAt,
              expiresAt: new Date(new Date(populatedBooking.createdAt).getTime() + MAX_SEARCH_TIME_MS).toISOString(),
              playSound: true,
              message: `New booking request within ${p.distance?.toFixed(1) || '?'}km!`
            });
          }

          await createNotification({
            ...(bookingModel === 'worker' ? { workerId: partnerId } : { vendorId: partnerId }),
            type: 'booking_request',
            title: 'New Booking Request 🔔',
            message: `New service request for ${serviceName} from ${customerName}`,
            relatedId: booking._id,
            relatedType: 'booking',
            priority: 'high',
            data: {
              bookingId: booking._id,
              serviceName,
              customerName,
              customerPhone: populatedBooking.userId?.phone,
              scheduledDate: populatedBooking.scheduledDate,
              scheduledTime: populatedBooking.scheduledTime,
              location: populatedBooking.address,
              price: populatedBooking.finalAmount,
              distance: p.distance
            },
            pushData: {
              type: 'new_booking',
              priority: 'high',
              dataOnly: false,
              link: `/${bookingModel}/bookings/${booking._id}`
            }
          });
        })
      );

      console.log(`[BookingScheduler] Notified ${partners.length} ${bookingModel}s for booking ${booking.bookingNumber}`);
    } catch (error) {
      console.error('[BookingScheduler] Error notifying partners:', error);
    }
  }
}

// Singleton instance
let schedulerInstance = null;

const initializeScheduler = (io) => {
  if (!schedulerInstance) {
    schedulerInstance = new BookingScheduler(io);
    schedulerInstance.start();
  }
  return schedulerInstance;
};

const getScheduler = () => schedulerInstance;

module.exports = { BookingScheduler, initializeScheduler, getScheduler };
