/**
 * Quote flow for consultancy categories (plan §3.4).
 *
 * Customer                                   Provider (vendor or worker, per Settings.bookingModel)
 *   POST /users/quotes/requests       ─────►   GET  /{vendors|workers}/quotes/requests
 *   GET  /users/quotes/requests[/:id] ◄─────   POST /{vendors|workers}/quotes/requests/:bookingId  (submit / revise)
 *   POST /users/quotes/:quoteId/accept         POST /{vendors|workers}/quotes/:quoteId/withdraw
 *   POST /users/quotes/requests/:id/cancel
 *
 * A request is a Booking with isConsultancyRequest = true and status
 * 'quote_requested'. Accepting a quote turns that booking into a normal booking
 * at the quoted price, assigned to the quoting provider (vendor: confirmed;
 * worker: assigned), and every other quote is rejected. Requests expire at
 * quoteExpiresAt, quotes at validUntil (expireQuotes, run lazily and on the
 * scheduler tick).
 */
const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const Quote = require('../../models/Quote');
const Category = require('../../models/Category');
const Settings = require('../../models/Settings');
const { BOOKING_STATUS, PAYMENT_STATUS } = require('../../utils/constants');
const { createNotification } = require('../notificationControllers/notificationController');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const HOUR = 60 * 60 * 1000;

let lastSweep = 0;
/** Expire lapsed quote requests and quotes. Cheap; throttled when called from the scheduler. */
const expireQuotes = async ({ force = false } = {}) => {
  const now = new Date();
  if (!force && Date.now() - lastSweep < 60 * 1000) return;
  lastSweep = Date.now();
  await Quote.updateMany({ status: 'submitted', validUntil: { $lte: now } }, { $set: { status: 'expired', respondedAt: now } });
  const lapsed = await Booking.find({ status: BOOKING_STATUS.QUOTE_REQUESTED, quoteExpiresAt: { $lte: now } }).select('_id').lean();
  if (lapsed.length) {
    const ids = lapsed.map((b) => b._id);
    await Booking.updateMany(
      { _id: { $in: ids }, status: BOOKING_STATUS.QUOTE_REQUESTED },
      { $set: { status: BOOKING_STATUS.CANCELLED, cancelledAt: now, cancelledBy: 'system', cancellationReason: 'quote_request_expired' } }
    );
    await Quote.updateMany({ bookingId: { $in: ids }, status: 'submitted' }, { $set: { status: 'expired', respondedAt: now } });
  }
};

const providerModel = (type) => (type === 'vendor' ? require('../../models/Vendor') : require('../../models/Worker'));

// ── Customer ───────────────────────────────────────────────────────────────

const createQuoteRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { categoryId, serviceId, address, scheduledDate, scheduledTime, timeSlot, bookingType, requirementText, requirementImages } = req.body || {};
    if (!mongoose.isValidObjectId(categoryId)) return res.status(400).json({ success: false, message: 'categoryId is required' });
    const category = await Category.findById(categoryId).select('title isConsultancy homeIconUrl imageUrl').lean();
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    if (!category.isConsultancy) {
      return res.status(400).json({ success: false, message: 'Quotes are only for consultancy categories; book this service directly' });
    }
    if (!address || !address.addressLine1 || !address.city || !address.state || !address.pincode) {
      return res.status(400).json({ success: false, message: 'address with addressLine1, city, state and pincode is required' });
    }
    const lat = Number(address.lat);
    const lng = Number(address.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ success: false, message: 'address.lat and address.lng are required' });
    if (!String(requirementText || '').trim()) return res.status(400).json({ success: false, message: 'Describe what you need in requirementText' });

    let service = null;
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) return res.status(400).json({ success: false, message: 'Invalid serviceId' });
      service = await require('../../models/UserService').findById(serviceId).select('title').lean();
      if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    }

    const settings = (await Settings.findOne({ type: 'global' }).lean()) || {};
    const bookingModel = settings.bookingModel || 'worker';
    const { findNearbyVendors, findNearbyWorkers } = require('../../services/locationService');
    const { bookingSlot } = require('../../services/providerEligibility');
    const slot = bookingSlot({ bookingType, scheduledDate, timeSlot, scheduledTime });
    const filters = { service: category.title, categoryId: category._id, slot };
    const providers = bookingModel === 'vendor'
      ? await findNearbyVendors({ lat, lng }, settings.searchRadius || 10, { ...filters, city: address.city })
      : await findNearbyWorkers({ lat, lng }, settings.searchRadius || 10, filters);

    const when = scheduledDate ? new Date(scheduledDate) : new Date();
    const booking = await Booking.create({
      bookingNumber: `QR${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      userId,
      serviceId: service?._id || null,
      categoryId: category._id,
      serviceName: service?.title || `${category.title} consultation`,
      serviceCategory: category.title,
      categoryIcon: category.homeIconUrl || category.imageUrl || null,
      bookingType: bookingType === 'instant' ? 'instant' : 'scheduled',
      bookingModel,
      isConsultancyRequest: true,
      requirementText: String(requirementText).trim(),
      requirementImages: Array.isArray(requirementImages) ? requirementImages.filter((u) => typeof u === 'string') : [],
      basePrice: 0,
      finalAmount: 0,
      address: {
        type: address.type || 'home', addressLine1: address.addressLine1, addressLine2: address.addressLine2 || '',
        city: address.city, state: address.state, pincode: address.pincode, landmark: address.landmark || '', lat, lng
      },
      scheduledDate: Number.isNaN(when.getTime()) ? new Date() : when,
      scheduledTime: scheduledTime || 'To be agreed',
      timeSlot: { start: timeSlot?.start || 'flexible', end: timeSlot?.end || 'flexible' },
      status: BOOKING_STATUS.QUOTE_REQUESTED,
      quoteExpiresAt: new Date(Date.now() + (settings.quoteRequestExpiryHours || 48) * HOUR),
      ...(bookingModel === 'vendor'
        ? { potentialVendors: providers.map((p) => ({ vendorId: p._id, distance: p.distance || 0 })), notifiedVendors: providers.map((p) => p._id) }
        : { potentialWorkers: providers.map((p) => ({ workerId: p._id, distance: p.distance || 0 })), notifiedWorkers: providers.map((p) => p._id) })
    });

    setImmediate(() => {
      providers.forEach((p) => createNotification({
        ...(bookingModel === 'vendor' ? { vendorId: p._id } : { workerId: p._id }),
        type: 'quote_requested',
        title: 'New quote request',
        message: `A customer near you needs ${category.title}. Send your quote.`,
        relatedId: booking._id,
        relatedType: 'booking',
        pushData: { type: 'quote_requested', bookingId: String(booking._id) }
      }).catch(() => {}));
    });

    return res.status(201).json({
      success: true,
      message: providers.length ? `Sent to ${providers.length} provider(s) near you` : 'No providers are available near you right now',
      data: { _id: booking._id, bookingNumber: booking.bookingNumber, status: booking.status, quoteExpiresAt: booking.quoteExpiresAt, providersNotified: providers.length }
    });
  } catch (error) {
    console.error('Create quote request error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create quote request' });
  }
};

const quoteView = (q, providers) => {
  const p = providers.get(String(q.providerId));
  return {
    _id: q._id, bookingId: q.bookingId, status: q.status, providerType: q.providerType,
    provider: p ? { _id: p._id, name: p.businessName || p.name, profilePhoto: p.profilePhoto || null, rating: p.rating || 0, totalJobs: p.totalJobs || 0 } : { _id: q.providerId },
    lineItems: q.lineItems, subtotal: q.subtotal, gstPercentage: q.gstPercentage, tax: q.tax,
    visitingCharges: q.visitingCharges, amount: q.amount, note: q.note, validUntil: q.validUntil, createdAt: q.createdAt
  };
};

const loadProviders = async (quotes) => {
  const map = new Map();
  for (const type of ['vendor', 'worker']) {
    const ids = quotes.filter((q) => q.providerType === type).map((q) => q.providerId);
    if (!ids.length) continue;
    const docs = await providerModel(type).find({ _id: { $in: ids } }).select('name businessName profilePhoto rating totalJobs').lean();
    docs.forEach((d) => map.set(String(d._id), d));
  }
  return map;
};

const listQuoteRequests = async (req, res) => {
  try {
    await expireQuotes({ force: true });
    const bookings = await Booking.find({ userId: req.user.id, isConsultancyRequest: true })
      .sort({ createdAt: -1 }).limit(50)
      .select('bookingNumber serviceName serviceCategory status quoteExpiresAt acceptedQuoteId finalAmount createdAt').lean();
    const counts = await Quote.aggregate([
      { $match: { bookingId: { $in: bookings.map((b) => b._id) }, status: { $in: ['submitted', 'accepted'] } } },
      { $group: { _id: '$bookingId', count: { $sum: 1 }, lowest: { $min: '$amount' } } }
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c]));
    return res.json({ success: true, data: bookings.map((b) => ({ ...b, quoteCount: byId.get(String(b._id))?.count || 0, lowestQuote: byId.get(String(b._id))?.lowest ?? null })) });
  } catch (error) {
    console.error('List quote requests error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load quote requests' });
  }
};

const getQuoteRequest = async (req, res) => {
  try {
    await expireQuotes({ force: true });
    const booking = await Booking.findOne({ _id: req.params.bookingId, userId: req.user.id, isConsultancyRequest: true })
      .select('-potentialVendors -potentialWorkers -notifiedVendors -notifiedWorkers -notifiedPartners').lean();
    if (!booking) return res.status(404).json({ success: false, message: 'Quote request not found' });
    const quotes = await Quote.find({ bookingId: booking._id, status: { $ne: 'withdrawn' } }).sort({ amount: 1 }).lean();
    const providers = await loadProviders(quotes);
    return res.json({ success: true, data: { request: booking, quotes: quotes.map((q) => quoteView(q, providers)) } });
  } catch (error) {
    console.error('Get quote request error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load quote request' });
  }
};

const cancelQuoteRequest = async (req, res) => {
  try {
    const now = new Date();
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.bookingId, userId: req.user.id, status: BOOKING_STATUS.QUOTE_REQUESTED },
      { $set: { status: BOOKING_STATUS.CANCELLED, cancelledAt: now, cancelledBy: 'user', cancellationReason: req.body?.reason || 'quote_request_cancelled' } },
      { new: true }
    );
    if (!booking) return res.status(400).json({ success: false, message: 'This quote request is no longer open' });
    await Quote.updateMany({ bookingId: booking._id, status: 'submitted' }, { $set: { status: 'rejected', respondedAt: now } });
    return res.json({ success: true, message: 'Quote request cancelled' });
  } catch (error) {
    console.error('Cancel quote request error:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel quote request' });
  }
};

const acceptQuote = async (req, res) => {
  try {
    const now = new Date();
    const userId = req.user.id;
    const paymentMethod = req.body?.paymentMethod || 'pay_at_home';
    if (!['pay_at_home', 'cash', 'online', 'razorpay', 'wallet'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Unsupported paymentMethod' });
    }
    const quote = await Quote.findOneAndUpdate(
      { _id: req.params.quoteId, userId, status: 'submitted', validUntil: { $gt: now } },
      { $set: { status: 'accepted', respondedAt: now } },
      { new: true }
    );
    if (!quote) {
      const q = await Quote.findOne({ _id: req.params.quoteId, userId }).select('status validUntil').lean();
      if (!q) return res.status(404).json({ success: false, message: 'Quote not found' });
      return res.status(400).json({ success: false, message: q.status === 'submitted' ? 'This quote has expired' : `This quote is ${q.status}` });
    }

    const assignment = quote.providerType === 'vendor'
      ? { vendorId: quote.providerId, status: BOOKING_STATUS.CONFIRMED, acceptedAt: now }
      : { workerId: quote.providerId, status: BOOKING_STATUS.ASSIGNED, workerResponse: 'ACCEPTED', assignedAt: now, acceptedAt: now };
    const booking = await Booking.findOneAndUpdate(
      { _id: quote.bookingId, userId, status: BOOKING_STATUS.QUOTE_REQUESTED, quoteExpiresAt: { $gt: now } },
      {
        $set: {
          ...assignment,
          bookingModel: quote.providerType,
          acceptedQuoteId: quote._id,
          basePrice: quote.subtotal,
          tax: quote.tax,
          visitingCharges: quote.visitingCharges,
          discount: 0,
          finalAmount: quote.amount,
          userPayableAmount: quote.amount,
          paymentMethod,
          paymentStatus: PAYMENT_STATUS.PENDING,
          bookedItems: quote.lineItems.map((li) => ({ serviceName: li.name, card: { title: li.name, price: li.price }, quantity: li.quantity }))
        }
      },
      { new: true }
    );
    if (!booking) {
      // The request closed (expired, cancelled, or another quote won) in between: undo.
      await Quote.updateOne({ _id: quote._id, status: 'accepted' }, { $set: { status: 'submitted', respondedAt: null } });
      return res.status(400).json({ success: false, message: 'This quote request is no longer open' });
    }
    const others = await Quote.find({ bookingId: booking._id, _id: { $ne: quote._id }, status: 'submitted' }).select('providerType providerId').lean();
    await Quote.updateMany({ bookingId: booking._id, _id: { $ne: quote._id }, status: 'submitted' }, { $set: { status: 'rejected', respondedAt: now } });

    setImmediate(() => {
      createNotification({
        ...(quote.providerType === 'vendor' ? { vendorId: quote.providerId } : { workerId: quote.providerId }),
        type: 'quote_accepted', title: 'Quote accepted',
        message: `Your quote of ₹${quote.amount} for ${booking.serviceName} was accepted. Booking ${booking.bookingNumber} is yours.`,
        relatedId: booking._id, relatedType: 'booking', priority: 'high',
        pushData: { type: 'quote_accepted', bookingId: String(booking._id) }
      }).catch(() => {});
      others.forEach((o) => createNotification({
        ...(o.providerType === 'vendor' ? { vendorId: o.providerId } : { workerId: o.providerId }),
        type: 'quote_rejected', title: 'Quote not selected',
        message: `The customer chose another quote for ${booking.serviceName}.`,
        relatedId: booking._id, relatedType: 'booking'
      }).catch(() => {}));
    });

    return res.json({ success: true, message: 'Quote accepted. Your booking is confirmed.', data: booking });
  } catch (error) {
    console.error('Accept quote error:', error);
    return res.status(500).json({ success: false, message: 'Failed to accept quote' });
  }
};

// ── Provider ───────────────────────────────────────────────────────────────

const providerSide = (providerType) => {
  const potentialField = providerType === 'vendor' ? 'potentialVendors.vendorId' : 'potentialWorkers.workerId';

  const listOpenRequests = async (req, res) => {
    try {
      await expireQuotes({ force: true });
      const me = new mongoose.Types.ObjectId(String(req.user.id));
      const bookings = await Booking.find({ status: BOOKING_STATUS.QUOTE_REQUESTED, [potentialField]: me, quoteExpiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 }).limit(50)
        .select('bookingNumber serviceName serviceCategory categoryId requirementText requirementImages address.city address.pincode address.lat address.lng scheduledDate scheduledTime timeSlot quoteExpiresAt createdAt potentialVendors potentialWorkers')
        .lean();
      const mine = await Quote.find({ bookingId: { $in: bookings.map((b) => b._id) }, providerType, providerId: me }).lean();
      const byBooking = new Map(mine.map((q) => [String(q.bookingId), q]));
      const data = bookings.map(({ potentialVendors, potentialWorkers, ...b }) => {
        const entry = (potentialVendors || potentialWorkers || []).find((p) => String(p.vendorId || p.workerId) === String(me));
        return { ...b, distance: entry?.distance ?? null, myQuote: byBooking.get(String(b._id)) || null };
      });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('List open quote requests error:', error);
      return res.status(500).json({ success: false, message: 'Failed to load quote requests' });
    }
  };

  const submitQuote = async (req, res) => {
    try {
      const me = new mongoose.Types.ObjectId(String(req.user.id));
      const { lineItems, gstPercentage, visitingCharges, note, validForHours } = req.body || {};
      if (!Array.isArray(lineItems) || !lineItems.length) return res.status(400).json({ success: false, message: 'lineItems must list at least one item' });
      const items = [];
      for (const li of lineItems) {
        const name = String(li?.name || '').trim();
        const price = Number(li?.price);
        const quantity = Math.max(1, Math.floor(Number(li?.quantity) || 1));
        if (!name || !Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, message: 'Each line item needs a name and a price of 0 or more' });
        items.push({ name, price: round2(price), quantity, total: round2(price * quantity) });
      }
      const settings = (await Settings.findOne({ type: 'global' }).select('serviceGstPercentage quoteValidityHours').lean()) || {};
      const gst = gstPercentage === undefined ? (settings.serviceGstPercentage ?? 18) : Number(gstPercentage);
      if (!Number.isFinite(gst) || gst < 0 || gst > 100) return res.status(400).json({ success: false, message: 'gstPercentage must be 0-100' });
      const visit = visitingCharges === undefined ? 0 : Number(visitingCharges);
      if (!Number.isFinite(visit) || visit < 0) return res.status(400).json({ success: false, message: 'visitingCharges must be 0 or more' });
      const hours = validForHours === undefined ? (settings.quoteValidityHours || 72) : Number(validForHours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) return res.status(400).json({ success: false, message: 'validForHours must be between 1 and 720' });

      const booking = await Booking.findOne({ _id: req.params.bookingId, status: BOOKING_STATUS.QUOTE_REQUESTED, [potentialField]: me })
        .select('userId serviceName quoteExpiresAt').lean();
      if (!booking) return res.status(404).json({ success: false, message: 'Quote request not found or not offered to you' });
      if (booking.quoteExpiresAt && booking.quoteExpiresAt <= new Date()) return res.status(400).json({ success: false, message: 'This quote request has expired' });

      const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
      const tax = round2((subtotal * gst) / 100);
      const amount = round2(subtotal + tax + visit);
      const existing = await Quote.findOne({ bookingId: booking._id, providerType, providerId: me }).select('status').lean();
      if (existing && !['submitted', 'withdrawn', 'expired'].includes(existing.status)) {
        return res.status(400).json({ success: false, message: `Your quote is already ${existing.status}` });
      }
      const quote = await Quote.findOneAndUpdate(
        { bookingId: booking._id, providerType, providerId: me },
        {
          $set: {
            userId: booking.userId, lineItems: items, subtotal, gstPercentage: gst, tax, visitingCharges: round2(visit), amount,
            note: note ? String(note).trim() : null,
            validUntil: new Date(Math.min(Date.now() + hours * HOUR, booking.quoteExpiresAt ? new Date(booking.quoteExpiresAt).getTime() : Infinity)),
            status: 'submitted', respondedAt: null
          }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      setImmediate(() => createNotification({
        userId: booking.userId, type: 'quote_received', title: 'New quote received',
        message: `You received a quote of ₹${amount} for ${booking.serviceName}.`,
        relatedId: booking._id, relatedType: 'booking',
        pushData: { type: 'quote_received', bookingId: String(booking._id) }
      }).catch(() => {}));
      return res.status(existing ? 200 : 201).json({ success: true, message: existing ? 'Quote updated' : 'Quote sent', data: quote });
    } catch (error) {
      console.error('Submit quote error:', error);
      return res.status(500).json({ success: false, message: 'Failed to submit quote' });
    }
  };

  const withdrawQuote = async (req, res) => {
    try {
      const q = await Quote.findOneAndUpdate(
        { _id: req.params.quoteId, providerType, providerId: req.user.id, status: 'submitted' },
        { $set: { status: 'withdrawn', respondedAt: new Date() } },
        { new: true }
      );
      if (!q) return res.status(400).json({ success: false, message: 'Only a submitted quote can be withdrawn' });
      return res.json({ success: true, message: 'Quote withdrawn', data: q });
    } catch (error) {
      console.error('Withdraw quote error:', error);
      return res.status(500).json({ success: false, message: 'Failed to withdraw quote' });
    }
  };

  return { listOpenRequests, submitQuote, withdrawQuote };
};

const buildUserRouter = () => {
  const router = require('express').Router();
  const { authenticate } = require('../../middleware/authMiddleware');
  const { isUser } = require('../../middleware/roleMiddleware');
  router.post('/requests', authenticate, isUser, createQuoteRequest);
  router.get('/requests', authenticate, isUser, listQuoteRequests);
  router.get('/requests/:bookingId', authenticate, isUser, getQuoteRequest);
  router.post('/requests/:bookingId/cancel', authenticate, isUser, cancelQuoteRequest);
  router.post('/:quoteId/accept', authenticate, isUser, acceptQuote);
  return router;
};

const buildProviderRouter = (providerType) => {
  const router = require('express').Router();
  const { authenticate } = require('../../middleware/authMiddleware');
  const { isVendor, isWorker } = require('../../middleware/roleMiddleware');
  const guard = providerType === 'vendor' ? isVendor : isWorker;
  const h = providerSide(providerType);
  router.get('/requests', authenticate, guard, h.listOpenRequests);
  router.post('/requests/:bookingId', authenticate, guard, h.submitQuote);
  router.post('/:quoteId/withdraw', authenticate, guard, h.withdrawQuote);
  return router;
};

module.exports = {
  expireQuotes,
  createQuoteRequest,
  listQuoteRequests,
  getQuoteRequest,
  cancelQuoteRequest,
  acceptQuote,
  vendorQuotes: providerSide('vendor'),
  workerQuotes: providerSide('worker'),
  buildUserRouter,
  buildProviderRouter
};
