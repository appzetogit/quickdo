const Booking = require('../../models/Booking');
const BookingRequest = require('../../models/BookingRequest');
const { validationResult } = require('express-validator');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../../utils/constants');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { effectiveCashLimit } = require('../../utils/cashLimit');

/**
 * Get assigned jobs for worker
 */
const getAssignedJobs = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { status, page = 1, limit = 10 } = req.query;

    // Build query
    const query = { workerId };
    if (status) {
      query.status = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get bookings
    const bookings = await Booking.find(query)
      .populate('userId', 'name phone email')
      .sort({ scheduledDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count
    const total = await Booking.countDocuments(query);

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
    console.error('Get assigned jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs. Please try again.'
    });
  }
};

/**
 * Get pending booking requests for worker (not yet accepted)
 */
const getPendingRequests = async (req, res) => {
  try {
    const workerId = req.user.id;
    
    // Find all pending requests for this worker
    const requests = await BookingRequest.find({ workerId, status: 'PENDING' })
      .populate({
        path: 'bookingId',
        populate: [
          { path: 'userId', select: 'name phone email' },
          { path: 'serviceId', select: 'title description iconUrl' }
        ]
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter out requests where booking might be null or already accepted by someone else
    const pendingBookings = requests
      .filter(req => req.bookingId && (req.bookingId.status === 'requested' || req.bookingId.status === 'searching'))
      .map(req => {
        // Return booking object enriched with request info
        return {
          ...req.bookingId,
          requestId: req._id,
          distance: req.distance,
          expiresAt: req.expiresAt
        };
      });

    res.status(200).json({
      success: true,
      data: pendingBookings
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending requests'
    });
  }
};

/**
 * Get job details by ID
 */
const getJobById = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { id } = req.params;

    const booking = await Booking.findById(id)
      .populate('userId', 'name phone email')
      .populate('vendorId', 'name businessName phone email address')
      .populate('serviceId', 'title description iconUrl images')
      .populate('categoryId', 'title slug');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    /*
     * Refused only when ANOTHER worker was assigned, so every unassigned booking --
     * all open requests and vendor self-jobs -- was readable by every worker, with the
     * customer's name, phone, email and address. Now: the assigned worker, or a worker
     * the booking was actually offered to; before acceptance, without the customer's
     * phone and email.
     */
    const isAssigned = booking.workerId && booking.workerId.toString() === workerId;
    const wasOffered = !booking.workerId && [...(booking.potentialWorkers || []), ...(booking.notifiedWorkers || [])]
      // potentialWorkers entries are { workerId, distance } subdocuments with their own _id;
      // notifiedWorkers are plain ids.
      .some((w) => String(w?.workerId || w) === workerId);

    if (!isAssigned && !wasOffered) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this job'
      });
    }

    let data = booking;
    if (!isAssigned) {
      data = booking.toObject();
      if (data.userId && typeof data.userId === 'object') {
        data.userId = { _id: data.userId._id, name: data.userId.name };
      }
    }

    res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job. Please try again.'
    });
  }
};

/**
 * Update job status
 */
const updateJobStatus = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const workerId = req.user.id;
    const { id } = req.params;
    const { status, finalSettlementStatus, workerPaymentStatus } = req.body;

    const booking = await Booking.findOne({ _id: id, workerId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Validate status transition if status is changing
    if (status && status !== booking.status) {
      const validTransitions = {
        [BOOKING_STATUS.ASSIGNED]: [BOOKING_STATUS.VISITED, BOOKING_STATUS.IN_PROGRESS],
        [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.ASSIGNED, BOOKING_STATUS.IN_PROGRESS],
        [BOOKING_STATUS.VISITED]: [BOOKING_STATUS.WORK_DONE, BOOKING_STATUS.COMPLETED],
        [BOOKING_STATUS.IN_PROGRESS]: [BOOKING_STATUS.WORK_DONE, BOOKING_STATUS.COMPLETED],
        [BOOKING_STATUS.WORK_DONE]: [BOOKING_STATUS.COMPLETED],
        [BOOKING_STATUS.JOURNEY_STARTED]: [BOOKING_STATUS.VISITED, BOOKING_STATUS.IN_PROGRESS]
      };

      if (!validTransitions[booking.status]?.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status transition from ${booking.status} to ${status}`
        });
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


      // Update booking status
      booking.status = status;

      if (status === BOOKING_STATUS.IN_PROGRESS && !booking.startedAt) {
        booking.startedAt = new Date();
      }

      if (status === BOOKING_STATUS.VISITED && !booking.startedAt) {
        booking.startedAt = new Date();
      }

      if (status === BOOKING_STATUS.COMPLETED) {
        booking.completedAt = new Date();
      }

      // Emit socket event for real-time update to user
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${booking.userId}`).emit('booking_updated', {
          bookingId: booking._id,
          status: booking.status,
          message: `Job status updated to ${booking.status}`
        });
      }

      // Add Push Notification for User
      const { createNotification } = require('../notificationControllers/notificationController');

      if (status === BOOKING_STATUS.IN_PROGRESS) {
        await createNotification({
          userId: booking.userId,
          type: 'work_started',
          title: 'Work In Progress',
          message: 'Professional has started working on your service.',
          relatedId: booking._id,
          relatedType: 'booking',
          priority: 'high',
          pushData: { type: 'in_progress', bookingId: booking._id.toString(), link: `/user/booking/${booking._id}` }
        });
      }

    }

    // A worker's own payout and the platform settlement are not the worker's
    // to set: these came straight from the request, so a worker could mark
    // themselves paid. They are set by the vendor and the admin payout flows.
    void finalSettlementStatus;
    void workerPaymentStatus;

    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Job status updated successfully',
      data: booking
    });
  } catch (error) {
    console.error('Update job status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job status. Please try again.'
    });
  }
};

/**
 * Mark job as started (Journey Started)
 */
const startJob = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { id } = req.params;

    const booking = await Booking.findOne({ _id: id, workerId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (booking.status !== BOOKING_STATUS.ASSIGNED && booking.status !== BOOKING_STATUS.CONFIRMED && booking.status !== BOOKING_STATUS.ACCEPTED) {
      return res.status(400).json({
        success: false,
        message: `Cannot start journey with status: ${booking.status}`
      });
    }

    // Generate Visit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Update booking
    booking.status = BOOKING_STATUS.JOURNEY_STARTED;
    booking.journeyStartedAt = new Date();
    booking.visitOtp = otp; // In production, hash this!

    await booking.save();

    // Notify user with OTP
    const { createNotification } = require('../notificationControllers/notificationController');
    await createNotification({
      userId: booking.userId,
      type: 'worker_started',
      title: 'Worker Started Journey',
      message: `Worker is on the way! specific OTP for site visit verification is: ${otp}. Please share this with worker upon arrival.`,
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

    // Notify vendor
    await createNotification({
      vendorId: booking.vendorId,
      type: 'worker_started',
      title: 'Worker Started Journey',
      message: `Your worker has started the journey for booking ${booking.bookingNumber}.`,
      relatedId: booking._id,
      relatedType: 'booking',
      pushData: {
        type: 'journey_started',
        bookingId: booking._id.toString(),
        link: `/vendor/bookings/${booking._id}`
      }
    });

    // Explicitly emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: BOOKING_STATUS.JOURNEY_STARTED,
        visitOtp: otp
      });

      // Socket notification removed - createNotification already handles this
    }

    res.status(200).json({
      success: true,
      message: 'Journey started, OTP sent to user',
      data: booking
    });
  } catch (error) {
    console.error('Start job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start job. Please try again.'
    });
  }
};

/**
 * Worker Reached Location
 * Notify user to share OTP
 */
const workerReachedLocation = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { id } = req.params;

    // Need visitOtp to resend it
    const booking = await Booking.findOne({ _id: id, workerId }).select('+visitOtp');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Job not found' });
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
      title: 'Professional has Reached!',
      message: `Professional has reached your location. Please share this OTP: ${otp}`,
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

    res.status(200).json({ success: true, message: 'User notified that professional reached' });
  } catch (error) {
    console.error('Worker reached location error:', error);
    res.status(500).json({ success: false, message: 'Failed to notify user' });
  }
};

/**
 * Verify Site Visit with OTP
 */
const verifyVisit = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { id } = req.params;
    const { otp, location } = req.body;

    // Use query to select visitOtp which is usually hidden
    const booking = await Booking.findOne({ _id: id, workerId }).select('+visitOtp');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (booking.status !== BOOKING_STATUS.JOURNEY_STARTED) {
      return res.status(400).json({ success: false, message: 'Worker has not started journey yet' });
    }

    if (booking.visitOtp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // Update status
    booking.status = BOOKING_STATUS.VISITED;
    booking.visitedAt = new Date();
    booking.startedAt = new Date(); // Legacy compatibility
    booking.visitOtp = undefined; // Clear OTP
    if (location) {
      booking.visitLocation = {
        ...location,
        verifiedAt: new Date()
      };
    }

    await booking.save();

    // Notify user
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

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: booking.status,
        message: 'Visit verified successful'
      });
      // Socket notification removed - createNotification already handles this
    }

    res.status(200).json({
      success: true,
      message: 'Site visit verified successfully',
      data: booking
    });
  } catch (error) {
    console.error('Verify visit error:', error);
    res.status(500).json({ success: false, message: 'Failed to verifying visit' });
  }
};

/**
 * Mark job as completed (Work Done) & Generate Payment OTP
 */
const completeJob = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { id } = req.params;
    const { workPhotos, workDoneDetails } = req.body;

    const booking = await Booking.findOne({ _id: id, workerId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (booking.status !== BOOKING_STATUS.VISITED && booking.status !== BOOKING_STATUS.IN_PROGRESS) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete job with status: ${booking.status}`
      });
    }

    // Update booking
    booking.status = BOOKING_STATUS.WORK_DONE;

    // Reuse existing Payment OTP or generate new one
    const payOtp = booking.paymentOtp || Math.floor(1000 + Math.random() * 9000).toString();
    booking.paymentOtp = payOtp;

    if (workPhotos && Array.isArray(workPhotos)) {
      booking.workPhotos = workPhotos;
    }
    if (workDoneDetails) {
      booking.workDoneDetails = workDoneDetails;
    }

    await booking.save();

    // Notify user
    const { createNotification } = require('../notificationControllers/notificationController');

    // Run notifications in parallel to avoid sequential blocking
    await Promise.all([
      // 1. Notify user that work is completed and billing is being prepared
      createNotification({
        userId: booking.userId,
        type: 'work_completed',
        title: 'Work Completed',
        message: `Work finished!  Please wait for the bill expert is preparing !`,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high',
        pushData: {
          type: 'work_completed',
          bookingId: booking._id.toString(),
          link: `/user/booking/${booking._id}`
        }
      }),

      // 2. Notify user with Final Bill and OTP
      createNotification({
        userId: booking.userId,
        type: 'work_done',
        title: 'Billing Ready',
        message: `Bill Generated: ₹${booking.finalAmount}. Your verification OTP is ${payOtp}. Please verify and share OTP to complete.`,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high',
        pushData: {
          type: 'work_done',
          bookingId: booking._id.toString(),
          paymentOtp: payOtp,
          link: `/user/booking/${booking._id}`
        }
      }),

      // 3. Notify vendor
      createNotification({
        vendorId: booking.vendorId,
        type: 'worker_completed',
        title: 'Work Done',
        message: `Your worker has marked work as done for booking ${booking.bookingNumber}.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: {
          type: 'worker_completed',
          bookingId: booking._id.toString(),
          link: `/vendor/bookings/${booking._id}`
        }
      })
    ]);

    // Explicitly emit socket event to ensure user gets real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${booking.userId}`).emit('booking_updated', {
        bookingId: booking._id,
        status: BOOKING_STATUS.WORK_DONE
      });

      // Socket notification removed - createNotification already handles this
    }

    res.status(200).json({
      success: true,
      message: 'Work done marked, OTP sent to user',
      data: booking
    });
  } catch (error) {
    console.error('Complete job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete job. Please try again.'
    });
  }
};

/**
 * Collect Cash & Complete Booking
 * Uses VendorBill as the single source of truth for earnings.
 */
const collectCash = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { id } = req.params;
    const { otp } = req.body;

    const VendorBill = require('../../models/VendorBill');
    const Worker = require('../../models/Worker');
    const Vendor = require('../../models/Vendor');
    const Transaction = require('../../models/Transaction');

    // Booking + bill + wallet + ledger rows commit as one unit. Documents are read
    // inside the callback so a retry after a write conflict works on fresh state.
    const outcome = await withTransaction(async (session) => {
      const booking = await Booking.findOne({ _id: id, workerId }).select('+paymentOtp').session(session);

      if (!booking) abort({ notFound: true });
      if (booking.status !== BOOKING_STATUS.WORK_DONE) abort({ notDone: true });
      if (booking.paymentOtp !== otp) abort({ badOtp: true });

      // Fetch VendorBill (single source of truth)
      const bill = await VendorBill.findOne({ bookingId: booking._id }).session(session);
      if (!bill) abort({ noBill: true });

      const grandTotal = Number(bill.grandTotal) || 0;
      const vendorEarning = Number(bill.vendorTotalEarning) || 0;

      // Update Booking Status
      booking.status = BOOKING_STATUS.COMPLETED;
      booking.paymentMethod = 'cash collected'; // Standardized label
      booking.paymentStatus = PAYMENT_STATUS.COLLECTED_BY_VENDOR;
      booking.cashCollected = true;
      booking.cashCollectedBy = 'worker';
      booking.cashCollectorId = workerId;
      booking.cashCollectedAt = new Date();
      booking.completedAt = new Date();
      booking.paymentOtp = undefined;
      await booking.save({ session });

      // Mark bill as paid
      bill.status = 'paid';
      bill.paidAt = new Date();
      await bill.save({ session });

      // Update Wallet based on Booking Model
      if (booking.bookingModel === 'worker') {
        // In Direct Worker Model, Worker keeps 100% of cash — tracked for reporting.
        // No 'balance' update for cash because worker ALREADY has the cash.
        const workerDoc = await Worker.findByIdAndUpdate(
          workerId,
          {
            $inc: {
              'wallet.totalCashCollected': grandTotal,
              'wallet.earnings': grandTotal
            }
          },
          { new: true, session }
        );

        if (workerDoc) {
          await Transaction.create([{
            workerId,
            bookingId: booking._id,
            type: 'cash_collected',
            amount: grandTotal,
            status: 'completed',
            paymentMethod: 'cash collected',
            description: `Cash ₹${grandTotal} collected for booking #${booking.bookingNumber}`,
            metadata: {
              type: 'cash_reporting',
              billId: bill._id.toString(),
              grandTotal
            }
          }], { session });
        }
      } else if (booking.vendorId) {
        // Legacy Vendor Logic (already exists)
        const vendorDoc = await Vendor.findById(booking.vendorId).select('wallet').session(session);
        if (vendorDoc) {
          const currentDues = (vendorDoc.wallet.dues || 0) + grandTotal;
          const cashLimit = (await effectiveCashLimit(vendorDoc)).limit;
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

          await Vendor.findByIdAndUpdate(booking.vendorId, updateQuery, { session });

          // Create Transactions
          await Transaction.create([{
            vendorId: booking.vendorId,
            bookingId: booking._id,
            workerId,
            type: 'cash_collected',
            amount: grandTotal,
            status: 'completed',
            paymentMethod: 'cash collected',
            description: `Cash ₹${grandTotal} collected by worker for booking #${booking.bookingNumber}`,
            metadata: {
              type: 'dues_increase',
              collectedBy: 'worker',
              billId: bill._id.toString(),
              grandTotal,
              vendorEarning,
              companyRevenue: bill.companyRevenue
            }
          }], { session });

          if (vendorEarning > 0) {
            await Transaction.create([{
              vendorId: booking.vendorId,
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
      }

      return { booking, bill, grandTotal, vendorEarning };
    });

    if (outcome.notFound) return res.status(404).json({ success: false, message: 'Job not found' });
    if (outcome.notDone) return res.status(400).json({ success: false, message: 'Work is not marked as done yet' });
    if (outcome.badOtp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (outcome.noBill) return res.status(500).json({ success: false, message: 'Bill not found — cannot process payment' });

    const { booking, grandTotal } = outcome;

    // Notify User
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

    res.status(200).json({
      success: true,
      message: 'Cash collected and job completed',
      data: booking
    });

  } catch (error) {
    console.error('Collect cash error:', error);
    res.status(500).json({ success: false, message: 'Failed to collect cash' });
  }
};

/**
 * Add worker notes to booking
 */
const addWorkerNotes = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const workerId = req.user.id;
    const { id } = req.params;
    const { notes } = req.body;

    const booking = await Booking.findOne({ _id: id, workerId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Update booking
    booking.workerNotes = notes;

    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Notes added successfully',
      data: booking
    });
  } catch (error) {
    console.error('Add worker notes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add notes. Please try again.'
    });
  }
};
/**
 * Respond to job (Accept/Reject)
 */
const respondToJob = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const workerId = req.user.id;

  console.log(`[WorkerAction] respondToJob - ID: ${id}, Status: ${status}, Worker: ${workerId}`);

  try {
    // Find the booking by ID
    // In Direct Worker Model, workerId might not be set yet on the Booking itself
    const booking = await Booking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Check if job is already taken by someone else
    if (booking.workerId && booking.workerId.toString() !== workerId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'This job has already been accepted by another professional.'
      });
    }

    // Security: Check if this worker was actually notified/requested for this booking
    // Optional but recommended for production
    const BookingRequest = require('../../models/BookingRequest');
    const request = await BookingRequest.findOne({ bookingId: id, workerId });
    if (!request && !booking.workerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to respond to this job.'
      });
    }

    // Idempotency check: If already in desired state, return success without re-notifying
    if (status === 'ACCEPTED' && booking.workerResponse === 'ACCEPTED') {
      return res.status(200).json({ success: true, message: 'Job already accepted', data: booking });
    }

    if (status === 'REJECTED' && booking.workerResponse === 'REJECTED') {
      return res.status(200).json({ success: true, message: 'Job already rejected', data: booking });
    }

    if (status === 'ACCEPTED') {
      booking.status = BOOKING_STATUS.ASSIGNED;
      booking.workerId = workerId; // Assign the worker
      booking.bookingModel = 'worker'; // Ensure model is set
      booking.workerAcceptedAt = new Date();
      booking.workerResponse = 'ACCEPTED';

      const { createNotification } = require('../notificationControllers/notificationController');

      // Notify Vendor
      await createNotification({
        vendorId: booking.vendorId,
        type: 'job_accepted',
        title: 'Worker Accepted Job',
        message: `Worker has accepted job ${booking.bookingNumber}`,
        relatedId: booking._id,
        relatedType: 'booking'
      });

      // Fetch worker details for personalized notification
      const Worker = require('../../models/Worker');
      const worker = await Worker.findById(workerId).select('name phone profilePhoto rating');

      // Notify User
      await createNotification({
        userId: booking.userId,
        type: 'worker_accepted',
        title: 'Professional Confirmed!',
        message: `${worker?.name || 'A professional'} has accepted your booking and is preparing for the job.`,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high',
        pushData: { type: 'worker_accepted', bookingId: booking._id.toString(), link: `/user/booking/${booking._id}` }
      });

      // --- SOCKET EMISSION ---
      // Notify user via socket so the searching modal closes
      const io = req.app.get('io');
      if (io && worker) {
        io.to(`user_${booking.userId}`).emit('booking_accepted', {
          bookingId: booking._id,
          worker: {
            id: worker._id,
            name: worker.name,
            phone: worker.phone,
            profilePhoto: worker.profilePhoto,
            rating: worker.rating
          }
        });
      }

      // Notify worker for confirmation
      await createNotification({
        workerId: workerId,
        type: 'job_accepted',
        title: 'Job Confirmed!',
        message: `You have successfully accepted booking #${booking.bookingNumber}. Scheduled for ${new Date(booking.scheduledDate).toLocaleDateString()} at ${booking.scheduledTime}.`,
        relatedId: booking._id,
        relatedType: 'booking',
        priority: 'high',
        pushData: { type: 'job_accepted', bookingId: booking._id.toString(), link: `/worker/job/${booking._id}` }
      });


    } else if (status === 'REJECTED') {
      booking.workerId = null;
      booking.status = BOOKING_STATUS.CONFIRMED; // Revert to unassigned state

      const { createNotification } = require('../notificationControllers/notificationController');
      await createNotification({
        vendorId: booking.vendorId,
        type: 'job_rejected',
        title: 'Worker Declined Job',
        message: `Worker declined job ${booking.bookingNumber}`,
        relatedId: booking._id,
        relatedType: 'booking'
      });
    }

    await booking.save();
    res.status(200).json({ success: true, message: `Job ${status.toLowerCase()}`, data: booking });

  } catch (error) {
    console.error('Respond job error:', error);
    res.status(500).json({ success: false, message: 'Failed to respond to job' });
  }
};

module.exports = {
  getAssignedJobs,
  getPendingRequests,
  getJobById,
  updateJobStatus,
  startJob,
  completeJob,
  addWorkerNotes,
  verifyVisit,
  workerReachedLocation,
  collectCash,
  respondToJob
};
