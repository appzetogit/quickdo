const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const Service = require('../../models/UserService');
const Category = require('../../models/Category');
const Cart = require('../../models/Cart');
const User = require('../../models/User');
const Vendor = require('../../models/Vendor');
const Worker = require('../../models/Worker');
const Review = require('../../models/Review');
const { validationResult } = require('express-validator');
const { withTransaction, abort } = require('../../utils/withTransaction');
const { BOOKING_STATUS, PAYMENT_STATUS, PREPAID_PAYMENT_METHODS, refundableAmountOf } = require('../../utils/constants');
const { createNotification } = require('../notificationControllers/notificationController');
const { sendNotificationToUser, sendNotificationToVendor, sendNotificationToWorker } = require('../../services/firebaseAdmin');

/**
 * Create a new booking
 */
const createBooking = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    let {
      serviceId,
      vendorId,
      address,
      scheduledDate,
      scheduledTime,
      timeSlot,
      userNotes,
      paymentMethod,
      amount,
      isPlusAdded,
      bookedItems, // Array of specific items from cart
      visitingCharges: reqVisitingCharges,
      visitationFee: reqVisitationFee, // Backward compatibility
      basePrice: reqBasePrice,
      discount: reqDiscount,
      tax: reqTax,
      promoCode: reqPromoCode,
      promoDiscount: reqPromoDiscount,
      // Metadata from frontend
      serviceCategory: reqServiceCategory,
      categoryIcon: reqCategoryIcon,
      brandName: reqBrandName,
      brandIcon: reqBrandIcon,
      bookingType, // Extract bookingType
      // Consultancy Fields
      isConsultancyRequest,
      requirementText,
      requirementImages
    } = req.body;

    let visitingCharges = reqVisitingCharges ?? reqVisitationFee;

    // Calculate total value from booked items or fallback to base (Move to top)
    let totalServiceValue = 0;
    if (bookedItems && bookedItems.length > 0) {
      totalServiceValue = bookedItems.reduce((sum, item) => {
        const itemPrice = item.card?.price || item.price || 0;
        return sum + (itemPrice * (item.quantity || 1));
      }, 0);
    }
    // Note: Fallback to service.basePrice is done later if totalServiceValue is 0 AND service is loaded.
    // But we need 'service' to define fallback.
    // 'service' is loaded at line 46.
    // So we must calculate it AFTER loading service but BEFORE usage.
    // Usage is at line 98. Service loaded at 46.
    // So distinct placement: AFTER line 52.

    // Handle serviceId if it's an object (from populated cart data)
    if (typeof serviceId === 'object' && serviceId._id) {
      serviceId = serviceId._id;
    }

    // 1. Parallel Fetching: Service and User
    const [service, user] = await Promise.all([
      Service.findById(serviceId).select('title basePrice discountPrice description images iconUrl categoryId category categoryIds').lean(),
      User.findById(userId).select('name phone wallet plans')
    ]);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // 2. Fetch Category if exists
    const categoryId = service.categoryId || service.categoryIds?.[0];
    const category = categoryId ? await Category.findById(categoryId).select('title icon image slug').lean() : null;

    // Calculate total value from booked items or fallback to service base price
    if (totalServiceValue === 0) {
      totalServiceValue = service.basePrice || 500;
    }

    // Check for Pending Penalty
    const pendingPenalty = user.wallet?.penalty || 0;

    // --- MOVE SEARCH UP HERE ---
    // Load Global Settings for Flow Control
    const Settings = require('../../models/Settings');
    const globalSettings = await Settings.findOne({ type: 'global' }).select('searchRadius bookingModel').lean();
    const bookingModel = globalSettings?.bookingModel || 'worker';
    const searchRadius = globalSettings?.searchRadius || 10;

    // Find nearby partners using location service
    const { findNearbyVendors, findNearbyWorkers, geocodeAddress } = require('../../services/locationService');

    // Determine booking location (prioritize frontend coordinates)
    let bookingLocation;
    if (address.lat && address.lng) {
      bookingLocation = { lat: address.lat, lng: address.lng };
      console.log('Using provided coordinates for partner search:', bookingLocation);
    } else {
      bookingLocation = await geocodeAddress(
        `${address.addressLine1}, ${address.city}, ${address.state} ${address.pincode}`
      );
      console.log('Geocoded address for partner search:', bookingLocation);
    }

    let nearbyPartners = [];
    if (bookingModel === 'worker') {
      nearbyPartners = await findNearbyWorkers(
        bookingLocation,
        searchRadius,
        { service: category?.title || (service ? service.category : 'General') }
      );
    } else {
      console.log('[CreateBooking] Legacy Vendor Mode Active. Searching Vendors...');
      const vendorFilters = {
        ...(category ? { service: category.title } : {}),
        checkCashLimit: paymentMethod === 'cash',
        city: address.city
      };
      nearbyPartners = await findNearbyVendors(bookingLocation, searchRadius, vendorFilters);
    }

    // Deduplicate nearbyPartners by _id to prevent duplicate notifications
    const uniquePartnerIds = new Set();
    nearbyPartners = nearbyPartners.filter(partner => {
      const idStr = partner._id.toString();
      if (uniquePartnerIds.has(idStr)) return false;
      uniquePartnerIds.add(idStr);
      return true;
    });

    console.log(`[CreateBooking] Found ${nearbyPartners.length} nearby ${bookingModel}s for booking`);
    // Store in a shared variable for background tasks
    const foundPartners = nearbyPartners;
    // --- END SEARCH BLOCK ---
    // --- END VENDOR SEARCH BLOCK ---

    // Calculate pricing - use amount from frontend if provided, otherwise calculate
    let basePrice, discount, tax, finalAmount;
    let bookingStatus = BOOKING_STATUS.SEARCHING;
    let bookingPaymentStatus = PAYMENT_STATUS.PENDING;

    // -------------------------------------------------------------------------
    // PRICING CALCULATION LOGIC
    // -------------------------------------------------------------------------

    // 1. Determine if we can use Plan Benefits
    let usePlanBenefits = false;
    if (paymentMethod === 'plan_benefit') {
      if (user.plans && user.plans.isActive) {
        if (user.plans.expiry && new Date() > new Date(user.plans.expiry)) {
          // Plan expired - update status and FALLBACK to normal
          console.log(`[CreateBooking] Plan expired for user ${userId}. Falling back to normal booking.`);
          user.plans.isActive = false;
          await user.save();
          paymentMethod = 'pay_at_home'; // Fallback to Pay at Home
        } else {
          usePlanBenefits = true;
        }
      } else {
        // No active plan or invalid status - Fallback
        paymentMethod = 'pay_at_home';
      }
    }

    // 2. Logic Branch: Plan Benefit vs Standard
    if (usePlanBenefits) {
      const Plan = require('../../models/Plan');
      const userPlan = await Plan.findOne({ name: user.plans.name });

      if (!userPlan) {
        // Fallback if data missing (rare)
        usePlanBenefits = false;
        paymentMethod = 'pay_at_home';
      } else {
        // Check Coverage
        const isCategoryCovered = categoryId && userPlan.freeCategories &&
          userPlan.freeCategories.some(cat => String(cat) === String(categoryId));
        const isServiceCovered = serviceId && userPlan.freeServices &&
          userPlan.freeServices.some(svc => String(svc) === String(serviceId));

        if (isCategoryCovered || isServiceCovered) {
          // >>> APPLY FREE PRICING <<<
          basePrice = totalServiceValue > 0 ? totalServiceValue : (service.basePrice || 500);
          discount = basePrice; // Full discount
          tax = 0;
          visitingCharges = 0;
          finalAmount = pendingPenalty; // User only pays penalty

          bookingStatus = BOOKING_STATUS.SEARCHING;
          bookingPaymentStatus = finalAmount > 0 ? PAYMENT_STATUS.PENDING : PAYMENT_STATUS.PLAN_COVERED;
        } else {
          // Not covered -> Fallback
          usePlanBenefits = false;
          paymentMethod = 'pay_at_home';
        }
      }
    }

    // 3. Standard Pricing (Fallback) if NOT using Plan Benefits
    if (!usePlanBenefits) {
      if (amount && amount > 0) {
        // Use amount from frontend logic
        if (reqBasePrice !== undefined && reqTax !== undefined) {
          // Use breakdown provided by frontend
          basePrice = reqBasePrice;
          discount = reqDiscount || 0;
          const currentPromoDiscount = reqPromoDiscount || 0;
          tax = reqTax;
          visitingCharges = (reqVisitingCharges !== undefined) ? reqVisitingCharges : (visitingCharges ?? 49);
          finalAmount = Math.max(0, (basePrice - discount - currentPromoDiscount + tax + visitingCharges) + pendingPenalty);
        } else {
          // Backward compatibility: Reverse calculate
          if (!visitingCharges) visitingCharges = 0;
          basePrice = amount;
          tax = 0;
          discount = 0;
          finalAmount = amount + pendingPenalty;
        }
      } else {
        // Fallback to service pricing (if no amount sent)
        if (!visitingCharges) visitingCharges = 0;
        basePrice = service.basePrice || 500;
        discount = service.discountPrice ? (basePrice - service.discountPrice) : 0;
        tax = 0;
        finalAmount = (basePrice - discount + tax + visitingCharges) + pendingPenalty;
      }
    }

    /*
     * Server price floor. The amount, base, tax, discount and promo above all
     * came from the app, so a request could book a Rs 1000 service for Rs 1 --
     * and the Razorpay order was then created for that figure, so payment
     * verification passed. Promo codes are not checked on the server at all.
     * Whatever the app sends, a paid booking is never charged less than the
     * catalogue price of what is booked plus its GST (visiting charges and any
     * penalty on top), and no component may be negative.
     */
    if (!usePlanBenefits) {
      const nonNegative = (v) => Math.max(0, Number(v) || 0);
      visitingCharges = nonNegative(visitingCharges);
      discount = nonNegative(discount);
      tax = nonNegative(tax);
      const lines = Array.isArray(bookedItems) && bookedItems.length
        ? bookedItems.map((it) => ({
            id: String(it?.serviceId?._id || it?.serviceId || it?.card?.serviceId || service._id),
            qty: Math.max(1, Math.floor(Number(it?.quantity) || 1)),
          }))
        : [{ id: String(service._id), qty: 1 }];
      const ids = [...new Set(lines.map((l) => l.id))].filter((id) => /^[a-f0-9]{24}$/i.test(id));
      const catalogue = ids.length
        ? await Service.find({ _id: { $in: ids } }).select('basePrice gstPercentage').lean()
        : [];
      const priceOf = new Map(catalogue.map((c) => [String(c._id), c]));
      const floor = lines.reduce((sum, l) => {
        const c = priceOf.get(l.id) || service;
        const base = nonNegative(c.basePrice);
        const gst = nonNegative(c.gstPercentage ?? 0);
        return sum + base * l.qty * (1 + gst / 100);
      }, 0);
      const minimum = Math.round((floor + visitingCharges + pendingPenalty) * 100) / 100;
      if (!(finalAmount >= minimum)) {
        console.warn(`[CreateBooking] Client total ${finalAmount} below catalogue minimum ${minimum} for user ${userId}; charging the minimum.`);
        finalAmount = minimum;
      }
    }

    // NOTE: vendor earnings are NOT calculated at booking creation.
    // They are computed ONLY at bill generation (completeSelfJob) and stored in VendorBill.
    // This prevents inconsistency between Booking and VendorBill.
    console.log(`[CreateBooking] Payment=${paymentMethod}, FinalAmount=${finalAmount}, Penalty=${pendingPenalty}`);

    // The pending penalty is cleared together with the booking insert, further down.
    // It used to be zeroed HERE, before the booking existed: if the insert then failed
    // the penalty was gone without being charged, and a penalty a concurrent
    // cancellation added in between was overwritten by the save.

    // Ensure minimum amount for Razorpay (₹1) for paid bookings
    if (finalAmount < 1 && paymentMethod !== 'plan_benefit') {
      finalAmount = 1;
    }

    // Create booking
    const bookingNumber = `BK${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Improve Category Fetching if ID is missing (Fallback to title match)
    let finalCategory = category;
    if (!finalCategory && service.category) {
      // Try finding by name if ID lookup failed
      const Category = require('../../models/Category');
      finalCategory = await Category.findOne({ title: service.category });
    }

    // Map booked items to new schema (sectionTitle -> brandName)
    const formattedBookedItems = (Array.isArray(bookedItems) && bookedItems.length > 0) ? bookedItems.map(item => ({
      brandName: item.brandName || item.sectionTitle || item.brand || '', // Robust fallback
      brandIcon: item.brandIcon || item.sectionIcon || item.icon || null,
      card: item.card || item,
      quantity: item.quantity || 1
    })) : [];

    console.log('[CreateBooking] About to save with formatted items:', JSON.stringify(formattedBookedItems, null, 2));

    // Extract Visual Identity Details
    const categoryIcon = finalCategory?.icon || finalCategory?.image || service.iconUrl || 'https://cdn-icons-png.flaticon.com/512/3500/3500833.png';
    let brandName = null;
    let brandIcon = null;

    if (formattedBookedItems.length > 0) {
      // Try to find a distinct brand name
      const distinctBrands = [...new Set(formattedBookedItems.map(item => item.brandName).filter(Boolean))];
      if (distinctBrands.length > 0) {
        brandName = distinctBrands.join(', ');
      }

      // Try to find brand icon
      brandIcon = formattedBookedItems[0].brandIcon || null;
    }

    const bookingFields = {
      bookingNumber,
      userId,
      vendorId: null, // Will be assigned when vendor accepts
      serviceId,
      categoryId: finalCategory?._id || categoryId,
      serviceName: service.title,
      serviceCategory: reqServiceCategory || finalCategory?.title || service.category || 'General',
      // Visual Identity Fields
      categoryIcon: reqCategoryIcon || categoryIcon,
      brandName: reqBrandName || brandName,
      brandIcon: reqBrandIcon || brandIcon,
      bookingType: bookingType || 'scheduled',
      bookingModel: bookingModel,

      isConsultancyRequest: isConsultancyRequest || false,
      requirementText: requirementText || null,
      requirementImages: requirementImages || [],

      description: service.description,
      serviceImages: service.images || [],
      bookedItems: formattedBookedItems,
      basePrice,
      discount,
      promoCode: reqPromoCode || null,
      promoDiscount: reqPromoDiscount || 0,
      tax,
      visitingCharges,
      finalAmount,
      userPayableAmount: finalAmount,
      address: {
        type: address.type || 'home',
        addressLine1: address.addressLine1,
        addressLine2: address.addressLine2 || '',
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        landmark: address.landmark || '',
        lat: address.lat || null,
        lng: address.lng || null
      },
      scheduledDate: new Date(scheduledDate),
      scheduledTime,
      timeSlot: {
        start: timeSlot.start,
        end: timeSlot.end
      },
      // userNotes: userNotes || null, // Removed
      // isPlusAdded: isPlusAdded || false, // Removed
      paymentMethod: paymentMethod || null,
      status: bookingStatus,
      paymentStatus: bookingPaymentStatus
      // notifiedVendors will be set after wave sorting
    };

    let booking;
    if (pendingPenalty > 0) {
      // The penalty is folded into finalAmount above, so clearing it and creating the
      // booking are one unit. Decrement rather than zero, guarded on the amount being
      // charged: a penalty added since the read survives, and two bookings racing on
      // the same penalty cannot both charge it -- the second is asked to retry and
      // then sees the penalty already paid.
      const created = await withTransaction(async (session) => {
        const cleared = await User.updateOne(
          { _id: userId, 'wallet.penalty': { $gte: pendingPenalty } },
          { $inc: { 'wallet.penalty': -pendingPenalty } },
          { session }
        );
        if (cleared.modifiedCount === 0) abort({ penaltyChanged: true });
        const [doc] = await Booking.create([bookingFields], { session });
        return { booking: doc };
      });
      if (created.penaltyChanged) {
        return res.status(409).json({
          success: false,
          message: 'Your pending cancellation fee changed while booking. Please try again.'
        });
      }
      booking = created.booking;
    } else {
      booking = await Booking.create(bookingFields);
    }

    // --- IMMEDIATE RESPONSE ---
    // Send immediate response to the client. All subsequent operations will run in the background.
    res.status(201).json({
      success: true,
      message: 'Booking created successfully. We are finding vendors for you.',
      data: {
        _id: booking._id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        finalAmount: booking.finalAmount,
        scheduledDate: booking.scheduledDate,
        scheduledTime: booking.scheduledTime,
        address: booking.address,
        serviceName: booking.serviceName,
        categoryIcon: booking.categoryIcon,
        brandName: booking.brandName,
        brandIcon: booking.brandIcon,
      }
    });

    // --- DEFERRED POST-BOOKING OPERATIONS ---
    // All operations below will run non-blocking after the HTTP response has been sent.
    setImmediate(async () => {
      try {
        // Re-fetch user and booking for background tasks to ensure latest state
        const userForBackground = await User.findById(userId);
        const bookingForBackground = await Booking.findById(booking._id)
          .populate('userId', 'name phone email')
          .populate('serviceId', 'title iconUrl')
          .populate('categoryId', 'title slug');
        const serviceForBackground = await Service.findById(serviceId); // Re-fetch service if needed

        if (!userForBackground || !bookingForBackground || !serviceForBackground) {
          console.error('[CreateBooking] Background task failed: User, Booking or Service not found after initial creation.');
          return;
        }

        // If Plus membership was added, update user status
        if (isPlusAdded) {
          const expiryDate = new Date();
          expiryDate.setFullYear(expiryDate.getFullYear() + 1); // 1 year membership
          userForBackground.plans = {
            isActive: true,
            name: 'Plus Membership',
            expiry: expiryDate,
            price: 999 // Or fetch based on constants if needed, hardcoding placeholder or 0
          };
          await userForBackground.save();
          console.log(`User ${userId} upgraded to Plus Membership until ${expiryDate}`);
        }

        // Partners already found above
        // WAVE-BASED ALERTING: Sort by distance and only notify first wave
        const sortedPartners = foundPartners.sort((a, b) => (a.distance || 0) - (b.distance || 0));

        // Wave 1: First 3 partners
        const WAVE_1_COUNT = 3;
        const wave1Partners = sortedPartners.slice(0, WAVE_1_COUNT);

        // Store potential partners in booking
        if (bookingModel === 'worker') {
          bookingForBackground.potentialWorkers = sortedPartners.map(v => ({
            workerId: v._id,
            distance: v.distance || 0
          }));
        } else {
          bookingForBackground.potentialVendors = sortedPartners.map(v => ({
            vendorId: v._id,
            distance: v.distance || 0
          }));
        }

        bookingForBackground.currentWave = 1;
        bookingForBackground.waveStartedAt = new Date();
        bookingForBackground.notifiedPartners = wave1Partners.map(v => v._id);
        await bookingForBackground.save();

        if (wave1Partners.length > 0) {
          console.log(`[CreateBooking] Wave 1: Alerting ${wave1Partners.length} closest ${bookingModel}s (of ${sortedPartners.length} total)`);

          // Create BookingRequest entries for Wave 1 partners
          const BookingRequest = require('../../models/BookingRequest');
          const bookingRequests = wave1Partners.map(partner => ({
            bookingId: bookingForBackground._id,
            vendorId: bookingModel === 'vendor' ? partner._id : null,
            workerId: bookingModel === 'worker' ? partner._id : null,
            status: 'PENDING',
            wave: 1,
            distance: partner.distance || null,
            sentAt: new Date(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000) // Expires in 1 hour
          }));

          try {
            await BookingRequest.insertMany(bookingRequests, { ordered: false });
            console.log(`[CreateBooking] Created ${bookingRequests.length} BookingRequest entries for ${bookingModel}s`);

            // Notify partners about new job
            const { createNotification } = require('../notificationControllers/notificationController');
            for (const partner of wave1Partners) {
              await createNotification({
                vendorId: bookingModel === 'vendor' ? partner._id : null,
                workerId: bookingModel === 'worker' ? partner._id : null,
                type: 'new_job_available',
                title: 'New Job Available!',
                message: `A new ${bookingForBackground.serviceName} job is available near you. Earn ₹${bookingForBackground.finalAmount}!`,
                relatedId: bookingForBackground._id,
                relatedType: 'booking',
                priority: 'high',
                pushData: {
                  type: 'new_job',
                  bookingId: bookingForBackground._id.toString(),
                  link: bookingModel === 'vendor' ? `/vendor/bookings/${bookingForBackground._id}` : `/worker/job/${bookingForBackground._id}`
                }
              });
            }

            // Also notify User that we are finding professionals
            await createNotification({
              userId: bookingForBackground.userId._id,
              type: 'finding_professional',
              title: 'Booking Received!',
              message: `We have received your booking for ${bookingForBackground.serviceName}. Finding the best professional for you...`,
              relatedId: bookingForBackground._id,
              relatedType: 'booking',
              pushData: {
                type: 'booking_confirmed',
                bookingId: bookingForBackground._id.toString(),
                link: `/user/booking/${bookingForBackground._id}`
              }
            });
          } catch (err) {
            if (err.code !== 11000) console.error('[CreateBooking] BookingRequest insert error:', err);
          }
        } else {
          console.warn(`[CreateBooking] NO ${bookingModel.toUpperCase()}S FOUND nearby!`);

          // Emit socket emission for search failure
          const { getIO } = require('../../sockets');
          const io = getIO();
          if (io) {
            io.to(`user_${userId}`).emit('booking_search_failed', {
              bookingId: bookingForBackground._id,
              message: `No ${bookingModel}s found nearby.`
            });
          }

          bookingForBackground.status = BOOKING_STATUS.NO_VENDORS;
          await bookingForBackground.save();
        }

        // Send notifications to Wave 1 partners
        const { getIO } = require('../../sockets');
        const io = getIO();
        const { sendNotificationToWorker } = require('../../services/firebaseAdmin');

        if (io) {
          console.log(`[CreateBooking] Emitting Socket.IO events to ${wave1Partners.length} ${bookingModel}s in Wave 1...`);
          wave1Partners.forEach(async (partner) => {
            const partnerRoom = `${bookingModel}_${partner._id.toString()}`;
            io.to(partnerRoom).emit('new_booking_request', {
              bookingId: bookingForBackground._id,
              serviceName: serviceForBackground.title,
              customerName: userForBackground.name,
              customerPhone: userForBackground.phone,
              scheduledDate: scheduledDate,
              scheduledTime: scheduledTime,
              price: finalAmount,
              address: address,
              distance: partner.distance,
              serviceCategory: bookingForBackground.serviceCategory,
              brandName: bookingForBackground.brandName,
              brandIcon: bookingForBackground.brandIcon,
              categoryIcon: bookingForBackground.categoryIcon,
              createdAt: bookingForBackground.createdAt || new Date(),
              expiresAt: new Date(new Date(bookingForBackground.createdAt || Date.now()).getTime() + (60 * 1000)).toISOString(),
              playSound: true,
              message: `New booking request within ${partner.distance?.toFixed(1) || '?'}km!`
            });
          });
        }

        // 2. Send Firebase/FCM notifications
        try {
          const partnerNotifications = wave1Partners.map(partner =>
            createNotification({
              ...(bookingModel === 'worker' ? { workerId: partner._id } : { vendorId: partner._id }),
              type: 'booking_request',
              title: 'New Booking Request',
              message: `New service request for ${serviceForBackground.title} from ${userForBackground.name}`,
              relatedId: bookingForBackground._id,
              relatedType: 'booking',
              data: {
                bookingId: bookingForBackground._id,
                serviceName: serviceForBackground.title,
                customerName: userForBackground.name,
                customerPhone: userForBackground.phone,
                scheduledDate: scheduledDate,
                scheduledTime: scheduledTime,
                location: address,
                price: finalAmount,
                distance: partner.distance
              },
              pushData: {
                type: 'new_booking',
                bookingId: bookingForBackground._id.toString(),
                dataOnly: true, // Force data-only so SW wakes up and plays LOUD sound
                link: bookingModel === 'worker' ? `/worker/job/${bookingForBackground._id}` : `/vendor/booking/${bookingForBackground._id}`
              }
            })
          );
          await Promise.all(partnerNotifications);
        } catch (notifError) {
          console.error('[CreateBooking] Firebase/Notification Error:', notifError.message);
        }

        // 3. DIRECT FCM BYPASS (GUARANTEED PUSH FOR KILLED WORKER APPS)
        try {
          const { sendNotificationToWorker, sendNotificationToVendor } = require('../../services/firebaseAdmin');
          wave1Partners.forEach(async (partner) => {
            const directPayload = {
              title: "🔥 NEW BOOKING ARRIVED! 🔥",
              body: `A new ${serviceForBackground.title} booking is waiting for you! Tap to accept.`,
              dataOnly: true, // Forces SW to wake up and play loud sound
              data: {
                type: 'new_booking',
                bookingId: bookingForBackground._id.toString(),
                link: bookingModel === 'worker' ? `/worker/job/${bookingForBackground._id}` : `/vendor/booking/${bookingForBackground._id}`
              }
            };
            if (bookingModel === 'worker') {
              await sendNotificationToWorker(partner._id, directPayload);
            } else {
              await sendNotificationToVendor(partner._id, directPayload);
            }
          });
          console.log('[CreateBooking] Direct FCM bypass sent successfully.');
        } catch (directFcmErr) {
          console.error('[CreateBooking] Direct FCM bypass error:', directFcmErr);
        }

        // NOTIFY USER: Send actionable notification so they can track status
        await createNotification({
          userId,
          type: 'booking_requested',
          title: 'Booking Created',
          message: `Your booking ${bookingForBackground.bookingNumber} has been created successfully.`,
          relatedId: bookingForBackground._id,
          relatedType: 'booking',
          pushData: {
            type: 'booking_requested',
            bookingId: bookingForBackground._id.toString(),
            link: `/user/booking/${bookingForBackground._id}`
            // dataOnly: true // Removed to ensure User sees the visual notification
          }
        });
        // Clear cart — single atomic operation
        await Cart.findOneAndUpdate({ userId }, { $set: { items: [] } });
        console.log(`[CreateBooking][bg] Cart cleared for user ${userId}`);

        // Send vendor notification if it was a direct booking (vendorId provided)
        if (vendorId) {
          await createNotification({
            vendorId,
            type: 'booking_created',
            title: 'New Booking Received',
            message: `You have received a new booking ${bookingForBackground.bookingNumber} for ${serviceForBackground.title}.`,
            relatedId: bookingForBackground._id,
            relatedType: 'booking'
          });
        }

        // Send confirmation emails (fire-and-forget — never blocks)
        const vendorObj = vendorId ? await require('../../models/Vendor').findById(vendorId).lean() : null;
        const { sendBookingEmails } = require('../../services/emailService');
        sendBookingEmails(bookingForBackground, userForBackground, vendorObj, serviceForBackground)
          .catch(err => console.error('[CreateBooking][bg] Email error:', err));

      } catch (bgErr) {
        console.error('[CreateBooking][bg] Background task failed:', bgErr);
      }
    });

  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking. Please try again.'
    });
  }
};

/**
 * Get user bookings with filters
 */
const getUserBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Build query
    const query = { userId };
    if (status) {
      if (status.includes(',')) {
        query.status = { $in: status.split(',') };
      } else {
        query.status = status;
      }
    } else {
      // Default: Fetch all, including SEARCHING. Frontend will filter for active.
    }
    if (startDate || endDate) {
      query.scheduledDate = {};
      if (startDate) query.scheduledDate.$gte = new Date(startDate);
      if (endDate) query.scheduledDate.$lte = new Date(endDate);
    }

    // Pagination
    const limitNum = Math.max(1, parseInt(limit) || 10);
    const skip = (Math.max(1, parseInt(page) || 1) - 1) * limitNum;

    // Execute query and count in parallel for performance
    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .select('-serviceImages -workPhotos -requirementImages')
        .populate('vendorId', 'name businessName phone')
        .populate('serviceId', 'title iconUrl')
        .populate('categoryId', 'title slug')
        .populate('workerId', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Booking.countDocuments(query)
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
    console.error('Get user bookings error:', error);
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
    const userId = req.user.id;
    const { id } = req.params;

    const booking = await Booking.findOne({ _id: id, userId })
      .select('+visitOtp +paymentOtp') // Include secure OTPs for the user
      .populate('userId', 'name phone email')
      .populate('vendorId', 'name businessName phone email address profilePhoto')
      .populate('serviceId', 'title description iconUrl images')
      .populate('categoryId', 'title slug')
      .populate('workerId', 'name phone rating totalJobs location profilePhoto')
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Fetch Vendor Bill if exists
    const VendorBill = require('../../models/VendorBill');
    const bill = await VendorBill.findOne({ bookingId: booking._id });

    // Convert to object to attach bill
    const bookingData = booking;
    if (bill) {
      bookingData.bill = bill;
    }

    res.status(200).json({
      success: true,
      data: bookingData
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
 * Cancel booking
 */
const cancelBooking = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const { id } = req.params;
    const { cancellationReason } = req.body;

    const booking = await Booking.findOne({ _id: id, userId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking can be cancelled
    if (booking.status === BOOKING_STATUS.CANCELLED) {
      return res.status(400).json({
        success: false,
        message: 'Booking is already cancelled'
      });
    }

    if (booking.status === BOOKING_STATUS.COMPLETED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed booking'
      });
    }

    // --- REFUND & CANCELLATION FEE LOGIC ---
    let refundAmount = 0;
    let cancellationFee = 0;
    let refundMessage = '';

    // Fetch dynamic cancellation penalty from Settings
    const Settings = require('../../models/Settings');
    let settingsPenalty = 49; // Default
    try {
      const globalSettings = await Settings.findOne({ type: 'global' });
      if (globalSettings && globalSettings.cancellationPenalty !== undefined) {
        settingsPenalty = globalSettings.cancellationPenalty;
      }
    } catch (err) {
      console.error('Error fetching settings for cancellation penalty:', err);
    }

    const hasStartedJourney = !!booking.journeyStartedAt;
    const isPaid = booking.paymentStatus === PAYMENT_STATUS.SUCCESS;
    // Shared list: this copy omitted 'online', which is what a Razorpay-paid booking
    // stores, so those customers were never refunded on cancel.
    const isWalletOrOnline = PREPAID_PAYMENT_METHODS.includes(booking.paymentMethod);
    const isCash = booking.paymentMethod === 'cash';

    if (hasStartedJourney) {
      // SCENARIO: Worker/Vendor already started journey

      const hasReached = !!booking.visitedAt || booking.status === 'visited';

      if (hasReached) {
        // Professional Reached -> Full Visiting Charges
        cancellationFee = booking.visitingCharges ?? 49;
      } else {
        // Before Arrival (Journey Started) -> Dynamic Penalty
        cancellationFee = settingsPenalty;
      }

      if (isPaid && isWalletOrOnline) {
        // User paid upfront -> Refund (Total - Fee)
        // Capped at what was actually paid: finalAmount becomes the BILL total once
        // billed, so refunding it returned more than the customer ever paid.
        refundAmount = Math.max(0, refundableAmountOf(booking) - cancellationFee);
        refundMessage = `Booking cancelled after ${hasReached ? 'professional arrival' : 'journey start'}. Refund of ₹${refundAmount} initiated (Cancellation Fee: ₹${cancellationFee} deducted).`;
      } else {
        // User hasn't paid (e.g. COD or pending) -> Add Penalty to Wallet for Next Booking
        refundAmount = 0;
        refundMessage = `Booking cancelled after ${hasReached ? 'professional arrival' : 'journey start'}. A cancellation fee of ₹${cancellationFee} has been added to your account and will be charged on your next booking.`;

        // We will add this to user.wallet.penalty below
      }
    } else {
      // SCENARIO: Cancelled before journey start
      // Policy: Full Refund
      cancellationFee = 0;

      if (isPaid && isWalletOrOnline) {
        refundAmount = refundableAmountOf(booking);
        refundMessage = `Booking cancelled successfully. Full refund of ₹${refundAmount} initiated to your wallet.`;
      } else {
        refundAmount = 0;
        refundMessage = 'Booking cancelled successfully.';
      }
    }

    const previousStatus = booking.status;

    // The refund credit, its ledger row and the cancellation itself are one unit:
    // committing the wallet credit without the cancellation would let the same
    // booking be cancelled (and refunded) again.
    //
    // Writes use updateOne/$inc rather than doc.save() on purpose — withTransaction()
    // retries on write conflicts, and these documents were loaded before the
    // callback, so a re-run would find them "clean" and silently skip the save.
    const cancelOutcome = await withTransaction(async (session) => {
      const cancelFields = {
        status: BOOKING_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: 'user',
        cancellationReason: cancellationReason || 'Cancelled by user'
      };
      if (refundAmount > 0) {
        cancelFields.paymentStatus = PAYMENT_STATUS.REFUNDED;
        cancelFields.refundedAmount = refundAmount;
      }

      const claim = await Booking.updateOne(
        { _id: booking._id, status: { $ne: BOOKING_STATUS.CANCELLED } },
        { $set: cancelFields },
        { session }
      );

      if (claim.modifiedCount === 0) abort({ alreadyCancelled: true });

      // Update User Wallet
      if (refundAmount > 0 || (cancellationFee > 0 && !isPaid)) {
        const User = require('../../models/User');
        const Transaction = require('../../models/Transaction');

        const walletInc = {};
        // 1. Process Refund
        if (refundAmount > 0) walletInc['wallet.balance'] = refundAmount;
        // 2. Process Cancellation Fee (Add to Penalty Bucket if Unpaid).
        //    No debit transaction here — no money has left yet; the actual charge
        //    happens when the next booking is created.
        if (cancellationFee > 0 && !isPaid) walletInc['wallet.penalty'] = cancellationFee;

        const updatedUser = await User.findByIdAndUpdate(
          userId,
          { $inc: walletInc },
          { new: true, session }
        );

        if (!updatedUser) abort({ userMissing: true });

        if (refundAmount > 0) {
          await Transaction.create([{
            userId: updatedUser._id,
            type: 'refund',
            amount: refundAmount,
            status: 'completed',
            paymentMethod: 'wallet',
            description: `Refund for booking #${booking.bookingNumber}`,
            bookingId: booking._id,
            balanceAfter: updatedUser.wallet.balance
          }], { session });
        }

        if (cancellationFee > 0 && !isPaid) {
          console.log(`[CancelBooking] Added penalty of ₹${cancellationFee} to user ${userId}. Total Penalty: ${updatedUser.wallet.penalty}`);
        }
      }

      return { ok: true };
    });

    if (cancelOutcome.alreadyCancelled) {
      return res.status(400).json({ success: false, message: 'Booking is already cancelled' });
    }
    if (cancelOutcome.userMissing) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Mirror the committed state onto the in-memory doc for the response/sockets below
    booking.status = BOOKING_STATUS.CANCELLED;
    booking.cancelledAt = new Date();
    booking.cancelledBy = 'user';
    booking.cancellationReason = cancellationReason || 'Cancelled by user';
    if (refundAmount > 0) booking.paymentStatus = PAYMENT_STATUS.REFUNDED;

    // Send cancellation sockets to pending partners if booking was in SEARCHING state
    if (previousStatus === BOOKING_STATUS.SEARCHING || previousStatus === 'REQUESTED') {
      try {
        const BookingRequest = require('../../models/BookingRequest');
        const pendingRequests = await BookingRequest.find({ bookingId: booking._id, status: 'PENDING' });
        
        const { getIO } = require('../../sockets');
        const io = getIO();
        const { createNotification } = require('../notificationControllers/notificationController');
        
        if (pendingRequests.length > 0) {
          pendingRequests.forEach(async req => {
            // 1. Socket (for online workers)
            if (io) {
              if (req.vendorId) {
                io.to(`vendor_${req.vendorId}`).emit('removeVendorBooking', { bookingId: booking._id, message: 'Customer cancelled the booking' });
              }
              if (req.workerId) {
                io.to(`worker_${req.workerId}`).emit('removeWorkerBooking', { bookingId: booking._id, message: 'Customer cancelled the booking' });
              }
            }

            // 2. FCM Push (for workers with killed/background app)
            try {
              if (req.workerId) {
                await createNotification({
                  workerId: req.workerId,
                  type: 'booking_cancelled',
                  title: 'Booking Cancelled',
                  message: `A booking request you received has been cancelled by the customer.`,
                  relatedId: booking._id,
                  relatedType: 'booking',
                  pushData: {
                    type: 'booking_cancelled',
                    bookingId: booking._id.toString(),
                    link: `/worker/dashboard`
                  }
                });
              }
              if (req.vendorId) {
                await createNotification({
                  vendorId: req.vendorId,
                  type: 'booking_cancelled',
                  title: 'Booking Cancelled',
                  message: `A booking request you received has been cancelled by the customer.`,
                  relatedId: booking._id,
                  relatedType: 'booking',
                  pushData: {
                    type: 'booking_cancelled',
                    bookingId: booking._id.toString(),
                    link: `/vendor/dashboard`
                  }
                });
              }
            } catch (fcmErr) {
              console.error('[CancelBooking] FCM push to pending partner failed:', fcmErr.message);
            }
          });
        }
      } catch (socketErr) {
        console.error('[CancelBooking] Error emitting cancellation sockets:', socketErr);
      }
    }

    // Send notification to user
    await createNotification({
      userId,
      type: 'booking_cancelled',
      title: 'Booking Cancelled',
      message: refundMessage || `Your booking ${booking.bookingNumber} has been cancelled.`,
      relatedId: booking._id,
      relatedType: 'booking',
      pushData: {
        type: 'booking_cancelled',
        bookingId: booking._id.toString(),
        link: `/user/booking/${booking._id}`
      }
    });

    // Manual FCM push removed (handled by createNotification)

    // Send notification to vendor
    if (booking.vendorId) {
      await createNotification({
        vendorId: booking.vendorId,
        type: 'booking_cancelled',
        title: 'Booking Cancelled',
        message: `Booking ${booking.bookingNumber} has been cancelled by the customer.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: {
          type: 'booking_cancelled',
          bookingId: booking._id.toString(),
          link: `/vendor/bookings/${booking._id}`
        }
      });
      // Manual FCM push removed
    }

    // Notify worker if assigned
    if (booking.workerId) {
      await createNotification({
        workerId: booking.workerId,
        type: 'booking_cancelled',
        title: 'Booking Cancelled',
        message: `Job ${booking.bookingNumber} has been cancelled by the customer.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: {
          type: 'job_cancelled',
          bookingId: booking._id.toString(),
          link: `/worker/job/${booking._id}`
        }
      });
      // Manual FCM push removed
    }

    res.status(200).json({
      success: true,
      message: refundMessage || 'Booking cancelled successfully',
      data: booking
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking. Please try again.'
    });
  }
};

/**
 * Reschedule booking
 */
const rescheduleBooking = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const { id } = req.params;
    const { scheduledDate, scheduledTime, timeSlot } = req.body;

    const booking = await Booking.findOne({ _id: id, userId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking can be rescheduled
    if (booking.status === BOOKING_STATUS.COMPLETED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reschedule completed booking'
      });
    }

    if (booking.status === BOOKING_STATUS.CANCELLED) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reschedule cancelled booking'
      });
    }

    // Update booking
    booking.scheduledDate = new Date(scheduledDate);
    booking.scheduledTime = scheduledTime;
    booking.timeSlot = {
      start: timeSlot.start,
      end: timeSlot.end
    };

    // Reset status to pending if it was confirmed
    if (booking.status === BOOKING_STATUS.CONFIRMED) {
      booking.status = BOOKING_STATUS.PENDING;
    }

    await booking.save();

    // Send notification to vendor
    await createNotification({
      vendorId: booking.vendorId,
      type: 'booking_created', // Keeping type as is for now
      title: 'Booking Rescheduled',
      message: `Booking ${booking.bookingNumber} has been rescheduled.`,
      relatedId: booking._id,
      relatedType: 'booking',
      pushData: {
        type: 'booking_rescheduled',
        bookingId: booking._id.toString(),
        link: `/vendor/bookings/${booking._id}`
      }
    });

    res.status(200).json({
      success: true,
      message: 'Booking rescheduled successfully',
      data: booking
    });
  } catch (error) {
    console.error('Reschedule booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reschedule booking. Please try again.'
    });
  }
};

/**
 * Add review and rating after completion
 */
const addReview = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.id;
    const { id } = req.params;
    const { rating, review, reviewImages } = req.body;

    const booking = await Booking.findOne({ _id: id, userId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking is completed or work is done
    if (booking.status !== BOOKING_STATUS.COMPLETED && booking.status !== BOOKING_STATUS.WORK_DONE) {
      return res.status(400).json({
        success: false,
        message: 'Can only review bookings after work is done'
      });
    }

    // Check if already reviewed
    if (booking.rating) {
      return res.status(400).json({
        success: false,
        message: 'Booking already reviewed'
      });
    }

    // Update booking
    booking.rating = rating;
    booking.review = review || null;
    booking.reviewImages = reviewImages || [];
    booking.reviewedAt = new Date();

    await booking.save();

    // Create a new Review document for the Review model (used by Admin)
    try {
      await Review.create({
        bookingId: booking._id,
        userId: booking.userId,
        serviceId: booking.serviceId,
        vendorId: booking.vendorId,
        workerId: booking.workerId,
        rating: rating,
        review: review || '',
        images: reviewImages || [],
        status: 'active'
      });
    } catch (reviewErr) {
      console.error('Error creating separate review document:', reviewErr);
      // We don't fail the request if the separate review creation fails
    }

    // Helper to update cumulative rating on Model
    const updateCumulativeRating = async (Model, docId, newRating) => {
      try {
        const doc = await Model.findById(docId);
        if (!doc) return;

        const oldTotal = doc.totalReviews || 0;
        const oldRating = doc.rating || 0;

        const newTotal = oldTotal + 1;
        const updatedRating = ((oldRating * oldTotal) + newRating) / newTotal;

        doc.rating = Number(updatedRating.toFixed(2));
        doc.totalReviews = newTotal;
        await doc.save();
      } catch (err) {
        console.error(`Error updating rating for ${Model.modelName}:`, err);
      }
    };

    // Run time-consuming background tasks in parallel without blocking main response
    const tasks = [];
    if (booking.vendorId) tasks.push(updateCumulativeRating(Vendor, booking.vendorId, rating));
    if (booking.workerId) tasks.push(updateCumulativeRating(Worker, booking.workerId, rating));
    if (booking.vendorId) {
      tasks.push(createNotification({
        vendorId: booking.vendorId,
        type: 'review_submitted',
        title: 'New Review Received',
        message: `You have received a ${rating}-star review for booking ${booking.bookingNumber}.`,
        relatedId: booking._id,
        relatedType: 'booking'
      }));
    }

    await Promise.all(tasks).catch(err => console.error('Error in review background tasks:', err));

    res.status(200).json({
      success: true,
      message: 'Review added successfully',
      data: booking
    });
  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add review. Please try again.'
    });
  }
};

/**
 * Get user ratings and reviews (given by the user)
 */
const getUserRatings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Fetch bookings where rating is not null
    const bookings = await Booking.find({ userId, rating: { $ne: null } })
      .populate('vendorId', 'name businessName profilePhoto')
      .populate('serviceId', 'title iconUrl')
      .populate('workerId', 'name profilePhoto')
      .sort({ reviewedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments({ userId, rating: { $ne: null } });

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
    console.error('Get user ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your ratings'
    });
  }
};

module.exports = {
  createBooking,
  getUserBookings,
  getBookingById,
  cancelBooking,
  rescheduleBooking,
  addReview,
  getUserRatings
};

