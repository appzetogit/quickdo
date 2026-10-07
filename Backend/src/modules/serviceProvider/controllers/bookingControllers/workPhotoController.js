/**
 * Work-verification photo upload (plan §3.5).
 *
 *   POST /workers/jobs/:id/photos           { phase: 'before'|'after', photos: [url | {url,lat,lng}], lat, lng }
 *   POST /vendors/bookings/:id/self/photos  (same body; vendor doing the job themselves)
 *
 * Photos are uploaded to storage first (existing upload endpoints) and the URLs
 * sent here. 'before' photos are accepted once the provider is on the way or on
 * site; 'after' photos once work has started. The visit-verify and complete
 * endpoints also accept them inline (beforePhotos / afterPhotos).
 */
const Booking = require('../../models/Booking');
const { BOOKING_STATUS } = require('../../utils/constants');
const { parseIncomingPhotos, addWorkPhotos } = require('../../utils/workPhotos');

const PHASE_STATUSES = {
  before: [BOOKING_STATUS.JOURNEY_STARTED, BOOKING_STATUS.VISITED, BOOKING_STATUS.IN_PROGRESS],
  after: [BOOKING_STATUS.VISITED, BOOKING_STATUS.IN_PROGRESS, BOOKING_STATUS.WORK_DONE]
};

const uploadPhotos = (role) => async (req, res) => {
  try {
    const { id } = req.params;
    const { phase, photos, lat, lng } = req.body || {};
    if (!['before', 'after'].includes(phase)) {
      return res.status(400).json({ success: false, message: "phase must be 'before' or 'after'" });
    }
    const parsed = parseIncomingPhotos(photos, { uploadedBy: req.user.id, lat, lng });
    if (!parsed.length) return res.status(400).json({ success: false, message: 'photos must contain at least one URL' });
    if (parsed.length > 10) return res.status(400).json({ success: false, message: 'At most 10 photos per upload' });

    const filter = role === 'worker' ? { _id: id, workerId: req.user.id } : { _id: id, vendorId: req.user.id, workerId: null };
    const booking = await Booking.findOne(filter);
    if (!booking) return res.status(404).json({ success: false, message: 'Job not found' });
    if (!PHASE_STATUSES[phase].includes(booking.status)) {
      return res.status(400).json({ success: false, message: `Cannot add ${phase} photos while the job is ${booking.status}` });
    }
    const workPhotos = addWorkPhotos(booking, phase, parsed);
    await booking.save();
    return res.json({ success: true, message: `${parsed.length} ${phase} photo(s) saved`, data: { workPhotos } });
  } catch (error) {
    console.error(`[workPhotos] ${role} upload error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to save photos' });
  }
};

module.exports = { uploadWorkerPhotos: uploadPhotos('worker'), uploadVendorPhotos: uploadPhotos('vendor') };
