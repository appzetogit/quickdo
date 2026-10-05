const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const Worker = require('../../models/Worker');
const { validationResult } = require('express-validator');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../../utils/constants');
const { DEFAULT_SERVICE_PAYOUT_PCT } = require('../../utils/commission');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { effectiveCashLimit } = require('../../utils/cashLimit');
const { createNotification } = require('../notificationControllers/notificationController');
const { sendNotificationToUser, sendNotificationToVendor, sendNotificationToWorker } = require('../../services/firebaseAdmin');

/**
 * Get vendor bookings with filters
 */
const getVendorBookings = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { status, q, page = 1, limit = 20 } = req.query;

    // ── Get vendor categories from req.user (set in auth middleware) ──
    let vendorCategories = req.user.categories || req.user.service || [];
    if (!vendorCategories.length) {
      const Vendor = require('../../models/Vendor');
      const v = await Vendor.findById(vendorId, 'service').lean();
      vendorCategories = v?.service || [];
    }

    const vId = new mongoose.Types.ObjectId(vendorId);

    // ── Build Base Query ──
    // This Or condition ensures vendors see their own jobs OR relevant unassigned alerts
    const query = {
      $or: [
        { vendorId: vId, status: { $ne: BOOKING_STATUS.AWAITING_PAYMENT } },
        {
          vendorId: null,
          status: { $in: [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING] },
          serviceCategory: { $in: vendorCategories },
          'potentialVendors.vendorId': vId // Only show jobs where THIS vendor is within range
        }
      ]
    };

    // ── Apply Status Group Filters ──
    if (status && status !== 'all') {
      if (status === 'in_progress') {
        query.status = {
          $in: [
            BOOKING_STATUS.ACCEPTED,
            BOOKING_STATUS.ASSIGNED,
            BOOKING_STATUS.CONFIRMED,
            BOOKING_STATUS.JOURNEY_STARTED,
            BOOKING_STATUS.VISITED,
            BOOKING_STATUS.IN_PROGRESS,
            BOOKING_STATUS.WORK_DONE,
            'started', 'reached', 'on_the_way' // Supporting minor variants if they exist
          ]
        };
      } else if (status === 'completed') {
        query.status = {
          $in: [
            BOOKING_STATUS.COMPLETED,
            'worker_paid', 'settlement_pending', 'paid', 'closed'
          ]
        };
      } else if (status === 'assigned') {
        query.status = { $in: [BOOKING_STATUS.ASSIGNED, 'worker_accepted'] };
      } else {
        query.status = status;
      }
    }

    // ── Apply Search Filter (Simple regex on serviceName or bookingNumber) ──
    if (q) {
      query.$and = [
        {
          $or: [
            { serviceName: { $regex: q, $options: 'i' } },
            { bookingNumber: { $regex: q, $options: 'i' } }
          ]
        }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ── Single DB round-trip: list + total via $facet ──
    const [result] = await Booking.aggregate([
      { $match: query },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: parseInt(limit) },
            {
              $project: {
                _id: 1,
                bookingNumber: 1,
                status: 1,
                paymentMethod: 1,
                finalAmount: 1,
                scheduledDate: 1,
                scheduledTime: 1,
                serviceName: 1,
                serviceCategory: 1,
                categoryIcon: 1,
                createdAt: 1,
                'address.addressLine1': 1,
                'address.city': 1,
                userId: 1,
                workerId: 1,
                serviceId: 1,
                acceptedAt: 1,
                assignedAt: 1,
                brandName: 1,
                brandIcon: 1,
                expiresAt: 1
              }
            }
          ],
          total: [{ $count: 'n' }]
        }
      }
    ]);

    const bookings = result.data || [];
    const total = result.total?.[0]?.n || 0;

    // ── Populate only required fields ──
    await Booking.populate(bookings, [
      { path: 'userId', select: 'name phone', options: { lean: true } },
      { path: 'workerId', select: 'name', options: { lean: true } },
      {
        path: 'serviceId',
        select: 'title iconUrl categoryId',
        populate: { path: 'categoryId', select: 'title' },
        options: { lean: true }
      }
    ]);

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings. Please try again.'
    });
  }
};


/**
 * Get booking details by ID
 */
const getBookingById = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    const booking = await Booking.findOne({
      _id: id,
      $or: [
        { vendorId },
        { vendorId: null, status: { $in: ['requested', 'searching'] } }
      ]
    })
      .populate('userId', 'name phone email profilePhoto')
      .populate('vendorId', 'name businessName phone email')
      .populate('serviceId', 'title description iconUrl images')
      .populate('categoryId', 'title slug')
      .populate('workerId', 'name phone rating totalJobs completedJobs');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking. Please try again.'
    });
  }
};

/**
 * Accept booking
 */
const acceptBooking = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    // ATOMIC UPDATE: Check status and vendorId in query to prevent race conditions
    // Only accept if status is REQUESTED/SEARCHING and NO vendor is assigned yet
    const updatedBooking = await Booking.findOneAndUpdate(
      {
        _id: id,
        status: { $in: [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING] },
        vendorId: null // Crucial: Ensures another request didn't just take it
      },
      {
        $set: {
          vendorId: vendorId,
          acceptedAt: new Date(),
          // Check payment method for optimized status update logic
          status: BOOKING_STATUS.CONFIRMED // Default to confirmed
        }
      },
      { new: true } // Return updated doc
    );

    if (!updatedBooking) {
      // If update failed, check why (likely already taken)
      const existing = await Booking.findById(id);
      if (existing && existing.vendorId) {
        return res.status(409).json({ // 409 Conflict
          success: false,
          message: 'Sorry, this job has already been accepted by another vendor.'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Booking is no longer available.'
      });
    }

    // Booking successfully accepted by THIS vendor
    const booking = updatedBooking;

    // Update vendor availability to ON_JOB
    const Vendor = require('../../models/Vendor');
    await Vendor.findByIdAndUpdate(vendorId, { availability: 'ON_JOB' });

    // Update BookingRequest statuses
    const BookingRequest = require('../../models/BookingRequest');

    // Mark this vendor's request as ACCEPTED
    await BookingRequest.findOneAndUpdate(
      { bookingId: id, vendorId },
      { status: 'ACCEPTED', respondedAt: new Date() }
    );

    // Mark all other vendors' requests as EXPIRED/CANCELLED
    await BookingRequest.updateMany(
      { bookingId: id, vendorId: { $ne: vendorId } },
      { status: 'EXPIRED', respondedAt: new Date() }
    );

    // Check payment status correction (if needed, though we set CONFIRMED above)
    if (booking.paymentMethod === 'plan_benefit' && booking.paymentStatus === PAYMENT_STATUS.SUCCESS) {
      // already good
    }

    // NOTIFY OTHER VENDORS to remove this job
    // Use the stored notifiedVendors list
    const io = req.app.get('io');
    if (io && booking.notifiedVendors && booking.notifiedVendors.length > 0) {
      console.log(`[AcceptBooking] Notifying ${booking.notifiedVendors.length} other vendors that job ${booking._id} was taken`);
      booking.notifiedVendors.forEach(otherVendorId => {
        // Skip the current vendor
        if (otherVendorId.toString() !== vendorId.toString()) {
          const room = `vendor_${otherVendorId.toString()}`;
          console.log(`[AcceptBooking] Emitting booking_taken to room: ${room}`);
          io.to(room).emit('booking_taken', {
            bookingId: booking._id.toString(), // Ensure string for frontend comparison
            message: 'This job has been accepted by someone else.'
          });
        }
      });
    } else {
      console.log('[AcceptBooking] No other vendors to notify or io not available');
    }

    // Emit real-time updates to USER
    if (io) {
      const message = 'Vendor has accepted your request. Your booking is confirmed!';

      io.to(`user_${booking.userId}`).emit('booking_accepted', {
        bookingId: booking._id,
        bookingNumber: booking.bookingNumber,
        vendor: {
          id: vendorId,
          name: req.user.name,
          businessName: req.user.businessName
        },
        message
      });

      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: booking.status,
        message: 'Vendor has accepted your request'
      });
    }

    // Send notification to user
    const notificationMessage = `Your booking ${booking.bookingNumber} is confirmed! ${req.user.businessName || req.user.name} will arrive at scheduled time.`;

    await createNotification({
      userId: booking.userId,
      type: 'booking_accepted',
      title: 'Booking Confirmed!',
      message: notificationMessage,
      relatedId: booking._id,
      relatedType: 'booking',
      pushData: {
        type: 'booking_accepted',
        bookingId: booking._id.toString(),
        link: `/user/booking/${booking._id}`
        // dataOnly: true // Ensure user sees this
      }
    });

    // Send Push Notification to user (handled by createNotification)

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      data: booking
    });
  } catch (error) {
    console.error('Accept booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept booking. Please try again.'
    });
  }
};

/**
 * Reject booking
 * IMPORTANT: This only marks the vendor's rejection, NOT the booking itself.
 * Booking stays SEARCHING so other vendors can accept.
 */
const rejectBooking = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { id } = req.params;
    const { reason } = req.body;

    // Find booking
    const booking = await Booking.findOne({
      _id: id,
      $or: [
        { notifiedVendors: vendorId },
        { vendorId: null, status: { $in: [BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING] } }
      ]
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or not available for rejection'
      });
    }

    const validStatuses = [BOOKING_STATUS.PENDING, BOOKING_STATUS.REQUESTED, BOOKING_STATUS.SEARCHING];
    if (!validStatuses.includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject booking with status: ${booking.status}`
      });
    }

    // Update BookingRequest for this vendor
    const BookingRequest = require('../../models/BookingRequest');
    await BookingRequest.findOneAndUpdate(
      { bookingId: id, vendorId },
      {
        status: 'REJECTED',
        respondedAt: new Date(),
        rejectReason: reason || 'Rejected by vendor'
      }
    );

    // Remove vendor from notifiedVendors (they've responded)
    booking.notifiedVendors = booking.notifiedVendors.filter(
      v => v.toString() !== vendorId.toString()
    );

    // Remove from potentialVendors too
    booking.potentialVendors = booking.potentialVendors.filter(
      v => v.vendorId?.toString() !== vendorId.toString()
    );

    // Check if ALL vendors have rejected
    const pendingRequests = await BookingRequest.countDocuments({
      bookingId: id,
      status: { $in: ['PENDING', 'VIEWED'] }
    });

    const remainingPotential = booking.potentialVendors.length;

    if (pendingRequests === 0 && remainingPotential === 0) {
      // No vendors left - mark booking as rejected/failed
      booking.status = BOOKING_STATUS.REJECTED;
      booking.cancelledAt = new Date();
      booking.cancelledBy = 'system';
      booking.cancellationReason = 'No vendors available';

      // Notify user that no vendors are available
      await createNotification({
        userId: booking.userId,
        type: 'booking_rejected',
        title: 'No Vendors Available',
        message: `Sorry, no vendors are available for booking ${booking.bookingNumber}. Please try again later.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: {
          type: 'booking_rejected',
          bookingId: booking._id.toString(),
          link: `/user/booking/${booking._id}`
        }
      });
    }
    // Otherwise, booking stays SEARCHING for other vendors

    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      data: { bookingId: id }
    });
  } catch (error) {
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject booking. Please try again.'
    });
  }
};

/**
 * Assign worker to booking
 */
const assignWorker = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { id } = req.params;
    const { workerId } = req.body;

    const booking = await Booking.findOne({ _id: id, vendorId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Handle "Assign to Self"
    if (workerId === 'SELF') {
      booking.workerId = null; // null means vendor itself
      booking.assignedAt = new Date();

      if (booking.status === BOOKING_STATUS.CONFIRMED || booking.status === BOOKING_STATUS.ACCEPTED) {
        booking.status = BOOKING_STATUS.ASSIGNED;
      }

      await booking.save();

      // Notify User
      await createNotification({
        userId: booking.userId,
        type: 'worker_assigned',
        title: 'Service Provider Assigned',
        message: `Vendor ${req.user.businessName || req.user.name} will handle your booking ${booking.bookingNumber} personally.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: {
          type: 'worker_assigned',
          bookingId: booking._id.toString(),
          link: `/user/booking/${booking._id}`
        }
      });

      // Emit socket event for real-time UI refresh
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${booking.userId}`).emit('booking_updated', {
          bookingId: booking._id,
          status: booking.status,
          message: 'Professional assigned to your booking'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Assigned to yourself successfully',
        data: booking
      });
    }

    // Verify worker belongs to vendor
    const worker = await Worker.findOne({ _id: workerId, vendorId });
    if (!worker) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found or does not belong to your vendor account'
      });
    }

    // Check if worker is active
    const validStatuses = ['active', 'ONLINE', 'ACTIVE'];
    if (!validStatuses.includes(worker.status)) {
      return res.status(400).json({
        success: false,
        message: `Worker is not active (Status: ${worker.status})`
      });
    }

    // Update booking
    booking.workerId = workerId;
    booking.assignedAt = new Date();

    // Set status to ASSIGNED immediately. 
    // If worker rejects, respondToJob logic reverts it to CONFIRMED.
    booking.status = BOOKING_STATUS.ASSIGNED;

    booking.workerResponse = 'PENDING';
    booking.workerAcceptedAt = undefined;

    await booking.save();

    // Send notification to user
    await createNotification({
      userId: booking.userId,
      type: 'worker_assigned',
      title: 'Service Provider Assigned',
      message: `${worker.name} has been assigned to your booking. Check app for details.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high', // Ensure high priority delivery
      pushData: {
        type: 'worker_assigned',
        bookingId: booking._id.toString(),
        link: `/user/booking/${booking._id}`
        // dataOnly: false // Explicitly false
      }
    });

    // Send notification to worker
    await createNotification({
      workerId,
      type: 'booking_created',
      title: 'New Job Assigned',
      message: `You have been assigned to booking ${booking.bookingNumber}.`,
      relatedId: booking._id,
      relatedType: 'booking',
      pushData: {
        type: 'job_assigned',
        bookingId: booking._id.toString(),
        link: `/worker/job/${booking._id}`
      }
    });

    // Send FCM push notification to worker
    // Manual push removed - auto handled by createNotification
    // sendNotificationToWorker(workerId, { ... });

    const io = req.app.get('io');
    if (io) {
      io.to(`worker_${workerId}`).emit('new_job_assigned', {
        bookingId: booking._id,
        serviceName: booking.serviceId?.title || booking.serviceName || 'Service',
        customerName: booking.userId?.name || 'Customer',
        customerPhone: booking.userId?.phone,
        address: booking.address,
        price: booking.finalAmount,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
      });

      // Notify User in real-time
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: booking.status,
        message: 'Professional assigned to your booking'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Worker assigned successfully',
      data: booking
    });
  } catch (error) {
    console.error('Assign worker error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign worker. Please try again.'
    });
  }
};

/**
 * Update booking status
 */
const updateBookingStatus = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { id } = req.params;
    const { status, workerPaymentStatus, finalSettlementStatus } = req.body;

    const booking = await Booking.findOne({ _id: id, vendorId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Validate status transition if status is changing
    if (status && status !== booking.status) {
      const validTransitions = {
        [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED],
        [BOOKING_STATUS.AWAITING_PAYMENT]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.REJECTED],
        [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.ASSIGNED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED],
        [BOOKING_STATUS.ASSIGNED]: [BOOKING_STATUS.VISITED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED],
        [BOOKING_STATUS.VISITED]: [BOOKING_STATUS.WORK_DONE, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.CANCELLED],
        [BOOKING_STATUS.IN_PROGRESS]: [BOOKING_STATUS.WORK_DONE, BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED],
        [BOOKING_STATUS.WORK_DONE]: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CANCELLED]
      };

      if (!validTransitions[booking.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${booking.status} to ${status}`
        });
      }

      // Update booking status
      booking.status = status;

      if (status === BOOKING_STATUS.IN_PROGRESS && !booking.startedAt) {
        booking.startedAt = new Date();
      }

      if (status === BOOKING_STATUS.WORK_DONE && !booking.completedAt) {
        // Work done timestamp? Maybe reuse/add field? For now leave it.
      }

      // Completed means paid. A worker or vendor could jump straight to
      // COMPLETED without the customer's payment code or any collection, and a
      // completed booking cannot be cancelled -- so a prepaid customer lost any
      // way to a refund. Completion needs the money settled first.
      if (status === BOOKING_STATUS.COMPLETED) {
        const pay = String(booking.paymentStatus || '').toLowerCase();
        const settled = booking.cashCollected === true
          || ['success', 'collected_by_vendor', 'plan_covered'].includes(pay);
        if (!settled) {
          return res.status(400).json({
            success: false,
            message: 'Collect the payment (or verify the customer\'s payment code) before completing the job.'
          });
        }
      }
      if (status === BOOKING_STATUS.COMPLETED) {
        booking.completedAt = new Date();
      }
    }

    // Update other fields
    if (workerPaymentStatus) {
      booking.workerPaymentStatus = workerPaymentStatus;
      if (workerPaymentStatus === 'PAID' || workerPaymentStatus === 'SUCCESS') {
        booking.isWorkerPaid = true;
        booking.workerPaidAt = booking.workerPaidAt || new Date();
      }
    }
    // The platform's settlement with the vendor is the admin's to record, not the vendor's.
    void finalSettlementStatus;

    await booking.save();

    // Send notification
    if (status === BOOKING_STATUS.COMPLETED) {
      await createNotification({
        userId: booking.userId,
        type: 'booking_completed',
        title: 'Booking Completed',
        message: `Your booking ${booking.bookingNumber} has been completed. Please rate your experience.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: {
          type: 'booking_completed',
          bookingId: booking._id.toString(),
          link: `/user/booking/${booking._id}`
        }
      });

      // Send FCM push notification to user
      // Manual push removed - auto handled by createNotification
      // sendNotificationToUser(booking.userId, { ... });

      // SEND INVOICE EMAILS
      try {
        const { sendBookingCompletionEmails } = require('../../services/emailService');
        const fullBooking = await Booking.findById(booking._id)
          .populate('userId')
          .populate('vendorId')
          .populate('serviceId');

        sendBookingCompletionEmails(fullBooking).catch(err => console.error(err));
      } catch (emailErr) {
        console.error('Failed to send completion emails:', emailErr);
      }
    }

    // Emit socket event for real-time UI refresh
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: booking.status,
        message: `Booking status updated to ${booking.status}`
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: booking
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update booking status. Please try again.'
    });
  }
};

/**
 * Add vendor notes to booking
 */
const addVendorNotes = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const vendorId = req.user.id;
    const { id } = req.params;
    const { notes } = req.body;

    const booking = await Booking.findOne({ _id: id, vendorId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update booking
    booking.vendorNotes = notes;

    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Notes added successfully',
      data: booking
    });
  } catch (error) {
    console.error('Add vendor notes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add notes. Please try again.'
    });
  }
};

/**
 * Start Self Job (Vendor performing job)
 */
const startSelfJob = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    const booking = await Booking.findOne({ _id: id, vendorId });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Ensure no worker is assigned (or self-assigned flag?) implementation assumes workerId null means unassigned or self?
    // User says: "if vendor didn't assignes to worker and do himself"
    // Usually means workerId is null.
    if (booking.workerId) {
      return res.status(400).json({ success: false, message: 'Worker is assigned to this booking. You cannot start it yourself unless you unassign worker.' });
    }

    if (booking.status !== BOOKING_STATUS.CONFIRMED && booking.status !== BOOKING_STATUS.ASSIGNED) {
      // Allow ASSIGNED if we consider "Self Assigned" as a state? 
      // If workerId is null, status usually CONFIRMED.
      // But lets allow generic flow.
    }

    // Status Check
    const allowed = [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.ASSIGNED, BOOKING_STATUS.AWAITING_PAYMENT];
    if (!allowed.includes(booking.status) && booking.status !== BOOKING_STATUS.ACCEPTED) { // flexible
      // check strict
    }

    // Generate Visit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Update booking
    booking.status = BOOKING_STATUS.JOURNEY_STARTED;
    booking.journeyStartedAt = new Date();
    booking.visitOtp = otp;
    booking.assignedAt = new Date(); // Implicitly assigned to self now

    await booking.save();

    // Notify user
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      userId: booking.userId,
      type: 'worker_started',
      title: 'Vendor Started Journey',
      message: `Vendor is on the way! OTP for verification: ${otp}.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'journey_started',
        bookingId: booking._id.toString(),
        visitOtp: otp,
        link: `/user/booking/${booking._id}`
      }
    });

    // Send FCM push notification to user
    // Manual push removed - auto handled by createNotification
    // sendNotificationToUser(booking.userId, { ... });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: BOOKING_STATUS.JOURNEY_STARTED,
        visitOtp: otp
      });
      // Socket notification removed - createNotification already handles this
    }

    res.status(200).json({ success: true, message: 'Journey started, OTP sent', data: booking });
  } catch (error) {
    console.error('Start self job error:', error);
    res.status(500).json({ success: false, message: 'Failed to start job' });
  }
};

/**
 * Vendor Reached Location
 * Notify user to share OTP
 */
const vendorReachedLocation = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    // Need visitOtp to resend it
    const booking = await Booking.findOne({ _id: id, vendorId }).select('+visitOtp');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.status !== BOOKING_STATUS.JOURNEY_STARTED) {
      return res.status(400).json({ success: false, message: 'Journey not started yet' });
    }

    const otp = booking.visitOtp;

    // Notify user
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      userId: booking.userId,
      type: 'vendor_reached',
      title: 'Vendor has Reached!',
      message: `Vendor has reached your location. Please share this OTP: ${otp}`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'vendor_reached',
        bookingId: booking._id.toString(),
        visitOtp: otp,
        link: `/user/booking/${booking._id}`
      }
    });

    // Socket notification removed - createNotification already handles this

    res.status(200).json({ success: true, message: 'User notified that vendor reached' });
  } catch (error) {
    console.error('Vendor reached location error:', error);
    res.status(500).json({ success: false, message: 'Failed to notify user' });
  }
};

/**
 * Verify Self Visit
 */
const verifySelfVisit = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const { otp, location } = req.body;

    const booking = await Booking.findOne({ _id: id, vendorId }).select('+visitOtp');

    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.status !== BOOKING_STATUS.JOURNEY_STARTED) return res.status(400).json({ success: false, message: 'Journey not started' });
    if (booking.visitOtp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });

    booking.status = BOOKING_STATUS.VISITED;
    booking.visitedAt = new Date();
    booking.startedAt = new Date();
    booking.visitOtp = undefined;
    if (location) {
      booking.visitLocation = { ...location, verifiedAt: new Date() };
    }

    await booking.save();

    // Notify user
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      userId: booking.userId,
      type: 'visit_verified',
      title: 'Visit Verified',
      message: `The professional has arrived and verified the visit. Service is now in progress.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high', // Ensure high priority
      pushData: {
        type: 'visit_verified',
        bookingId: booking._id.toString(),
        link: `/user/booking/${booking._id}`
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: BOOKING_STATUS.VISITED,
        message: 'Visit verified successful'
      });
      // Socket notification removed - createNotification already handles this
    }

    res.status(200).json({ success: true, message: 'Visit verified', data: booking });
  } catch (error) {
    console.error('Verify self visit error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify visit' });
  }
};

/**
 * Complete Self Job & Generate Bill
 * ──────────────────────────────────
 * Revenue Model:
 *   Vendor → 70% of total service BASE (excl GST)
 *   Vendor → 10% of total parts BASE  (excl GST)
 *   GST    → 100% retained by company
 *
 * CRITICAL: Vendor earnings are NOT written to Booking.
 *           VendorBill is the single source of truth.
 *           Earnings are only credited to wallet AFTER payment.
 */
const completeSelfJob = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const { workPhotos, workDoneDetails, billDetails } = req.body;

    const booking = await Booking.findOne({ _id: id, vendorId });
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    // Status guard
    if (booking.status !== BOOKING_STATUS.VISITED && booking.status !== BOOKING_STATUS.IN_PROGRESS) {
      return res.status(400).json({ success: false, message: 'Cannot complete from current status' });
    }

    // Prevent duplicate bills
    const VendorBill = require('../../models/VendorBill');
    const existingBill = await VendorBill.findOne({ bookingId: booking._id });
    if (existingBill) {
      return res.status(400).json({ success: false, message: 'Bill already generated for this booking' });
    }

    // ── Fetch Settings (frozen snapshot for this bill) ──
    const Settings = require('../../models/Settings');
    const settings = await Settings.findOne({ type: 'global' });
    const serviceSplitPct = settings?.servicePayoutPercentage ?? DEFAULT_SERVICE_PAYOUT_PCT;
    const partsSplitPct = settings?.partsPayoutPercentage ?? 10;
    const serviceGstPct = settings?.serviceGstPercentage ?? 18;
    const partsGstPct = settings?.partsGstPercentage ?? 18;

    // ═══════════════════════════════════════════
    // STEP 1: BUILD LINE ITEMS
    // ═══════════════════════════════════════════

    // -- Original booking service (from basePrice) --
    const originalBase = Number(booking.basePrice) || 0;
    const originalGST = parseFloat(((originalBase * serviceGstPct) / 100).toFixed(2));

    // -- Vendor-added services --
    const billServices = (billDetails?.services || []).map(svc => {
      const price = Number(svc.price) || 0;
      const qty = Number(svc.quantity) || 1;
      const base = price * qty;
      const gst = parseFloat(((base * serviceGstPct) / 100).toFixed(2));
      return {
        catalogId: svc.catalogId || undefined,
        name: svc.name || 'Service',
        price,
        gstPercentage: serviceGstPct,
        quantity: qty,
        gstAmount: gst,
        total: parseFloat((base + gst).toFixed(2)),
        isOriginal: false
      };
    });

    // -- Parts --
    const billParts = (billDetails?.parts || []).map(part => {
      const price = Number(part.price) || 0;
      const qty = Number(part.quantity) || 1;
      const pGstPct = (part.gstPercentage != null) ? Number(part.gstPercentage) : partsGstPct;
      const base = price * qty;
      const gst = parseFloat(((base * pGstPct) / 100).toFixed(2));
      return {
        catalogId: part.catalogId || undefined,
        name: part.name || 'Part',
        price,
        gstPercentage: pGstPct,
        quantity: qty,
        gstAmount: gst,
        total: parseFloat((base + gst).toFixed(2))
      };
    });

    // ═══════════════════════════════════════════
    // STEP 2: CALCULATE BASE TOTALS
    // ═══════════════════════════════════════════

    const vendorServiceBase = billServices.reduce((s, sv) => s + (sv.price * sv.quantity), 0);
    const totalServiceBase = parseFloat((originalBase + vendorServiceBase).toFixed(2));
    const totalPartsBase = parseFloat(billParts.reduce((s, p) => s + (p.price * p.quantity), 0).toFixed(2));

    // ═══════════════════════════════════════════
    // STEP 3: CALCULATE GST TOTALS
    // ═══════════════════════════════════════════

    const vendorServiceGST = parseFloat(billServices.reduce((s, sv) => s + sv.gstAmount, 0).toFixed(2));
    const partsGST = parseFloat(billParts.reduce((s, p) => s + p.gstAmount, 0).toFixed(2));
    const totalGST = parseFloat((originalGST + vendorServiceGST + partsGST).toFixed(2));

    // ═══════════════════════════════════════════
    // STEP 4: FINAL BILL (what user pays)
    // ═══════════════════════════════════════════

    const visitingCharges = Number(booking.visitingCharges) || 0;
    const grandTotal = parseFloat((totalServiceBase + totalPartsBase + totalGST + visitingCharges).toFixed(2));

    // ═══════════════════════════════════════════
    // STEP 5: REVENUE SPLIT (internal only)
    // ═══════════════════════════════════════════
    // Vendor % is applied ONLY on base — never on GST

    const vendorServiceEarning = parseFloat(((totalServiceBase * serviceSplitPct) / 100).toFixed(2));
    const vendorPartsEarning = parseFloat(((totalPartsBase * partsSplitPct) / 100).toFixed(2));
    const vendorTotalEarning = parseFloat((vendorServiceEarning + vendorPartsEarning).toFixed(2));
    const companyRevenue = parseFloat((grandTotal - vendorTotalEarning).toFixed(2));

    // ═══════════════════════════════════════════
    // STEP 6: PERSIST BILL
    // ═══════════════════════════════════════════

    // Include original service as line item for completeness
    const allServices = [
      {
        name: booking.serviceName || 'Original Service',
        price: originalBase,
        gstPercentage: serviceGstPct,
        quantity: 1,
        gstAmount: originalGST,
        total: parseFloat((originalBase + originalGST).toFixed(2)),
        isOriginal: true
      },
      ...billServices
    ];

    const bill = await VendorBill.create({
      bookingId: booking._id,
      vendorId,

      // Line items
      services: allServices,
      parts: billParts,

      // Base totals
      originalServiceBase: originalBase,
      vendorServiceBase,
      totalServiceBase,
      totalPartsBase,
      visitingCharges,

      // GST totals
      originalGST,
      vendorServiceGST,
      partsGST,
      totalGST,

      // Bill total
      grandTotal,

      // Payout config snapshot
      payoutConfig: {
        serviceSplitPercentage: serviceSplitPct,
        partsSplitPercentage: partsSplitPct,
        serviceGstPercentage: serviceGstPct,
        partsGstPercentage: partsGstPct
      },

      // Revenue split
      vendorServiceEarning,
      vendorPartsEarning,
      vendorTotalEarning,
      companyRevenue,

      status: 'generated',
      generatedAt: new Date()
    });

    // ═══════════════════════════════════════════
    // STEP 7: UPDATE BOOKING (no earnings!)
    // ═══════════════════════════════════════════

    booking.status = BOOKING_STATUS.WORK_DONE;
    booking.finalAmount = grandTotal;
    booking.userPayableAmount = grandTotal; // Ensure consistency
    booking.vendorBillId = bill._id;

    // Reuse existing Payment OTP for cash collection or generate new one
    const payOtp = booking.paymentOtp || Math.floor(1000 + Math.random() * 9000).toString();
    booking.paymentOtp = payOtp;

    if (workPhotos) booking.workPhotos = workPhotos;

    // Store bill summary in workDoneDetails for frontend display
    booking.workDoneDetails = {
      ...(typeof workDoneDetails === 'object' ? workDoneDetails : {}),
      billId: bill._id.toString(),
      items: [
        ...allServices.map(s => ({ title: s.name, qty: s.quantity, price: s.total })),
        ...billParts.map(p => ({ title: p.name, qty: p.quantity, price: p.total }))
      ]
    };
    booking.markModified('workDoneDetails');

    await booking.save();

    // ── Notify user ──
    const { createNotification } = require('../notificationControllers/notificationController');
    
    // 1. Notify user that work is completed
    await createNotification({
      userId: booking.userId,
      type: 'work_completed',
      title: 'Work Completed',
      message: `Work finished! Your bill is being prepared.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'work_completed',
        bookingId: booking._id.toString(),
        link: `/user/booking/${booking._id}`
      }
    });

    // 2. Notify user with Final Bill and OTP (The missing piece)
    await createNotification({
      userId: booking.userId,
      type: 'work_done',
      title: 'Billing Ready',
      message: `Bill Generated: ₹${grandTotal}. Your verification OTP is ${payOtp}. Please share this with the professional to complete.`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high',
      pushData: {
        type: 'work_done',
        bookingId: booking._id.toString(),
        paymentOtp: payOtp,
        link: `/user/booking/${booking._id}`
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: BOOKING_STATUS.WORK_DONE,
        finalAmount: grandTotal
      });
    }

    // Response: bill totals only, NO vendor earnings exposed
    res.status(200).json({
      success: true,
      message: 'Work done, bill generated',
      data: {
        booking,
        bill: {
          id: bill._id,
          grandTotal,
          totalGST,
          totalServiceBase,
          totalPartsBase
        }
      }
    });
  } catch (error) {
    console.error('Complete self job error:', error);
    res.status(500).json({ success: false, message: 'Failed to complete job' });
  }
};

/**
 * Collect Self Cash
 * ─────────────────
 * Called after user confirms OTP for cash payment.
 *
 * Wallet logic:
 *   dues     += grandTotal          (vendor physically holds this cash)
 *   earnings += vendorTotalEarning  (vendor's rightful share)
 *   Net owed to platform = dues − earnings
 *
 * VendorBill is the ONLY source of truth for earnings.
 */
const collectSelfCash = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const { otp } = req.body;

    const VendorBill = require('../../models/VendorBill');
    const Vendor = require('../../models/Vendor');
    const Transaction = require('../../models/Transaction');

    // Booking completion, bill settlement, vendor wallet and two ledger rows all
    // commit together. Read inside the callback so a retry gets fresh documents.
    const outcome = await withTransaction(async (session) => {
      const booking = await Booking.findOne({ _id: id, vendorId }).select('+paymentOtp').session(session);
      if (!booking) abort({ notFound: true });
      if (booking.status !== BOOKING_STATUS.WORK_DONE) abort({ notDone: true });
      if (booking.paymentOtp !== otp) abort({ badOtp: true });

      // ── Fetch the VendorBill (single source of truth) ──
      const bill = await VendorBill.findOne({ bookingId: booking._id }).session(session);
      if (!bill) abort({ noBill: true });

      const grandTotal = Number(bill.grandTotal) || 0;
      const vendorEarning = Number(bill.vendorTotalEarning) || 0;

      // ── Update Booking status ──
      booking.status = BOOKING_STATUS.COMPLETED;
      booking.paymentMethod = 'cash collected'; // Standardized label
      booking.paymentStatus = PAYMENT_STATUS.COLLECTED_BY_VENDOR;
      booking.cashCollected = true;
      booking.cashCollectedBy = 'vendor';
      booking.cashCollectorId = vendorId;
      booking.cashCollectedAt = new Date();
      booking.completedAt = new Date();
      booking.paymentOtp = undefined;
      await booking.save({ session });

      // ── Update VendorBill status ──
      bill.status = 'paid';
      bill.paidAt = new Date();
      await bill.save({ session });

      // ── Update Vendor Wallet (Atomic with $inc) ──
      const vendorDoc = await Vendor.findById(vendorId).select('wallet').session(session);

      if (vendorDoc) {
        const currentDues = (vendorDoc.wallet.dues || 0) + grandTotal;
        const cashLimit = (await effectiveCashLimit(vendorDoc)).limit;
        // Net owed = dues − earnings (vendor keeps their share from cash)
        const netOwed = currentDues - ((vendorDoc.wallet.earnings || 0) + vendorEarning);
        const isBlocked = netOwed > cashLimit;

        const updateQuery = {
          $inc: {
            'wallet.dues': grandTotal,
            'wallet.earnings': vendorEarning,
            'wallet.totalCashCollected': grandTotal
          }
        };

        if (isBlocked) {
          updateQuery.$set = {
            'wallet.isBlocked': true,
            'wallet.blockedAt': new Date(),
            'wallet.blockReason': `Cash limit exceeded. Net owed: ₹${netOwed.toFixed(2)}, Limit: ₹${cashLimit}`
          };
        }

        await Vendor.findByIdAndUpdate(vendorId, updateQuery, { session });

        // ── Create Transaction Records ──
        // Transaction 1: Cash Collected (Platform is owed this amount)
        await Transaction.create([{
          vendorId,
          bookingId: booking._id,
          type: 'cash_collected',
          amount: grandTotal,
          status: 'completed',
          paymentMethod: 'cash collected', // Standardized label
          description: `Cash ₹${grandTotal} collected for booking #${booking.bookingNumber}. Dues increased.`,
          metadata: {
            type: 'dues_increase',
            collectedBy: 'vendor',
            billId: bill._id.toString(),
            grandTotal,
            vendorEarning,
            companyRevenue: bill.companyRevenue
          }
        }], { session });

        // Transaction 2: Earnings Credit (Vendor's rightful share)
        if (vendorEarning > 0) {
          await Transaction.create([{
            vendorId,
            bookingId: booking._id,
            type: 'earnings_credit',
            amount: vendorEarning,
            status: 'completed',
            paymentMethod: 'wallet',
            description: `Earnings ₹${vendorEarning} credited for booking #${booking.bookingNumber}`,
            metadata: {
              type: 'earnings_increase',
              billId: bill._id.toString(),
              serviceEarning: bill.vendorServiceEarning,
              partsEarning: bill.vendorPartsEarning
            }
          }], { session });
        }
      }

      return { booking, bill, grandTotal, vendorEarning };
    });

    if (outcome.notFound) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (outcome.notDone) return res.status(400).json({ success: false, message: 'Work not done yet' });
    if (outcome.badOtp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (outcome.noBill) return res.status(500).json({ success: false, message: 'Bill not found — cannot process payment' });

    const { booking, grandTotal } = outcome;

    // ── Notify user ──
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      userId: booking.userId,
      type: 'payment_received',
      title: 'Payment Received (Cash)',
      message: `Payment of ₹${grandTotal} received in cash for booking ${booking.bookingNumber}. Job Completed. Thanks!`,
      relatedId: booking._id,
      relatedType: 'booking',
      priority: 'high'
    });

    res.status(200).json({ success: true, message: 'Cash collected, job completed', data: booking });
  } catch (error) {
    console.error('Collect self cash error:', error);
    res.status(500).json({ success: false, message: 'Failed to process cash payment' });
  }
};

/**
 * Pay Worker (Manual Settlement)
 */
const payWorker = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;

    const booking = await Booking.findOne({ _id: id, vendorId });

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (!booking.workerId) {
      return res.status(400).json({ success: false, message: 'No worker assigned to this booking' });
    }

    if (booking.isWorkerPaid) {
      return res.status(400).json({ success: false, message: 'Worker already paid' });
    }

    // Update booking payment status
    booking.isWorkerPaid = true;
    booking.workerPaymentStatus = 'SUCCESS';
    booking.workerPaidAt = new Date();

    await booking.save();

    // Notify Worker
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      workerId: booking.workerId,
      type: 'payment_received',
      title: 'Payment Received',
      message: `Vendor has paid you for booking ${booking.bookingNumber}.`,
      relatedId: booking._id,
      relatedType: 'booking'
    });

    // Send High Priority Push Notification to Worker
    const worker = await Worker.findById(booking.workerId);
    if (worker) {
      const fcmTokens = [
        ...(worker.fcmTokens || []),
        ...(worker.fcmTokenMobile || [])
      ];

      if (fcmTokens.length > 0) {
        const { sendPushNotification } = require('../../services/firebaseAdmin');
        await sendPushNotification(fcmTokens, {
          title: 'Payment Received! 💰',
          body: `Vendor has released your payment for booking #${booking.bookingNumber}. check wallet for details.`,
          data: {
            type: 'payment_received',
            bookingId: booking._id.toString(),
            url: '/worker/wallet'
          },
          highPriority: true
        });
      }
    }

    // Notify Vendor
    await createNotification({
      vendorId: vendorId,
      type: 'payment_success',
      title: 'Worker Paid',
      message: `You have successfully marked worker payment for booking ${booking.bookingNumber}.`,
      relatedId: booking._id,
      relatedType: 'booking'
    });

    res.status(200).json({
      success: true,
      message: 'Worker payment marked successfully',
      data: booking
    });

  } catch (error) {
    console.error('Pay worker error:', error);
    res.status(500).json({ success: false, message: 'Failed to process worker payment' });
  }
};

/**
 * Get vendor ratings and reviews
 */
const getVendorRatings = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch bookings where rating is not null
    const bookings = await Booking.find({ vendorId, rating: { $ne: null } })
      .populate('userId', 'name profilePhoto')
      .populate('serviceId', 'title iconUrl')
      .populate('workerId', 'name profilePhoto')
      .sort({ reviewedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments({ vendorId, rating: { $ne: null } });

    // Calculate average rating
    const stats = await Booking.aggregate([
      { $match: { vendorId: new mongoose.Types.ObjectId(vendorId), rating: { $ne: null } } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          star5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
          star4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
          star3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          star2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
          star1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
        }
      }
    ]);

    res.status(200).json({
      success: true,
      data: bookings,
      stats: stats[0] || { averageRating: 0, totalReviews: 0, star5: 0, star4: 0, star3: 0, star2: 0, star1: 0 },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get vendor ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ratings'
    });
  }
};

/**
 * Get pending booking requests for vendor (for reconnection)
 * Called when vendor app reconnects to fetch any missed alerts
 */
const getPendingBookings = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const BookingRequest = require('../../models/BookingRequest');

    // Get all pending booking requests for this vendor
    const pendingRequests = await BookingRequest.find({
      vendorId,
      status: { $in: ['PENDING', 'VIEWED'] }
    })
      .populate({
        path: 'bookingId',
        match: { status: BOOKING_STATUS.SEARCHING, vendorId: null },
        populate: [
          { path: 'userId', select: 'name phone' },
          {
            path: 'serviceId',
            select: 'title iconUrl categoryId',
            populate: { path: 'categoryId', select: 'title' }
          }
        ]
      })
      .sort({ sentAt: -1 })
      .limit(20);

    // Filter out null bookings (already accepted by others)
    const validRequests = pendingRequests.filter(r => r.bookingId !== null);

    // Format response
    const bookings = validRequests.map(req => ({
      requestId: req._id,
      bookingId: req.bookingId._id,
      bookingNumber: req.bookingId.bookingNumber,
      serviceName: req.bookingId.serviceId?.title || req.bookingId.serviceName,
      customerName: req.bookingId.userId?.name,
      customerPhone: req.bookingId.userId?.phone,
      scheduledDate: req.bookingId.scheduledDate,
      scheduledTime: req.bookingId.scheduledTime,
      address: req.bookingId.address,
      price: req.bookingId.finalAmount,
      distance: req.distance,
      wave: req.wave,
      sentAt: req.sentAt,
      status: req.status,
      serviceCategory: req.bookingId.serviceCategory,
      brandName: req.bookingId.brandName,
      brandIcon: req.bookingId.brandIcon,
      categoryIcon: req.bookingId.categoryIcon,
      createdAt: req.bookingId.createdAt,
      expiresAt: req.bookingId.expiresAt
    }));

    res.status(200).json({
      success: true,
      data: bookings,
      count: bookings.length
    });
  } catch (error) {
    console.error('Get pending bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending bookings'
    });
  }
};

module.exports = {
  getVendorBookings,
  getBookingById,
  acceptBooking,
  rejectBooking,
  assignWorker,
  updateBookingStatus,
  addVendorNotes,
  startSelfJob,
  vendorReachedLocation,
  verifySelfVisit,
  completeSelfJob,
  collectSelfCash,
  payWorker,
  getVendorRatings,
  getPendingBookings
};
