/**
 * Work-verification photos (plan §3.5).
 *
 * Booking.workPhotos is { before: [photo], after: [photo] } with
 * photo = { url, uploadedAt, uploadedBy, lat, lng }. Bookings from before this
 * change hold a flat array of URL strings: those read as 'after' photos.
 */

const toPhoto = (p, defaults = {}) => {
  if (!p) return null;
  const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  if (typeof p === 'string') return p.trim() ? { url: p.trim(), uploadedAt: defaults.uploadedAt || null, uploadedBy: defaults.uploadedBy || null, lat: num(defaults.lat), lng: num(defaults.lng) } : null;
  if (typeof p !== 'object' || !p.url || typeof p.url !== 'string') return null;
  return {
    url: p.url.trim(),
    uploadedAt: p.uploadedAt ? new Date(p.uploadedAt) : (defaults.uploadedAt || null),
    uploadedBy: p.uploadedBy || defaults.uploadedBy || null,
    lat: num(p.lat ?? defaults.lat),
    lng: num(p.lng ?? defaults.lng)
  };
};

/** Either stored shape -> { before, after }. */
const normalizeWorkPhotos = (raw) => {
  if (Array.isArray(raw)) {
    return { before: [], after: raw.map((p) => toPhoto(p)).filter(Boolean) };
  }
  if (raw && typeof raw === 'object') {
    return {
      before: (Array.isArray(raw.before) ? raw.before : []).map((p) => toPhoto(p)).filter(Boolean),
      after: (Array.isArray(raw.after) ? raw.after : []).map((p) => toPhoto(p)).filter(Boolean)
    };
  }
  return { before: [], after: [] };
};

/**
 * Photos from a request: an array of URLs or {url, lat, lng}. Each is stamped
 * with uploadedAt/uploadedBy, and request-level lat/lng fill gaps.
 */
const parseIncomingPhotos = (input, { uploadedBy, lat, lng } = {}) => {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const uploadedAt = new Date();
  return list.map((p) => toPhoto(p, { uploadedAt, uploadedBy: uploadedBy ? String(uploadedBy) : null, lat, lng }))
    .filter(Boolean)
    .map((p) => ({ ...p, uploadedAt, uploadedBy: uploadedBy ? String(uploadedBy) : p.uploadedBy }));
};

/** Add photos to a booking document's phase, converting the old shape first. */
const addWorkPhotos = (booking, phase, photos) => {
  const current = normalizeWorkPhotos(booking.workPhotos);
  current[phase] = [...current[phase], ...photos];
  booking.workPhotos = current;
  if (typeof booking.markModified === 'function') booking.markModified('workPhotos');
  return current;
};

/** Category.requireWorkPhotos (default true). */
const workPhotosRequired = async (booking) => {
  if (!booking?.categoryId) return true;
  const Category = require('../models/Category');
  const cat = await Category.findById(booking.categoryId?._id || booking.categoryId).select('requireWorkPhotos').lean();
  return cat ? cat.requireWorkPhotos !== false : true;
};

/** Plain-object copy of a booking with workPhotos normalized, for responses. */
const withNormalizedPhotos = (booking) => {
  if (!booking) return booking;
  const o = typeof booking.toObject === 'function' ? booking.toObject() : { ...booking };
  o.workPhotos = normalizeWorkPhotos(o.workPhotos);
  return o;
};

module.exports = { normalizeWorkPhotos, parseIncomingPhotos, addWorkPhotos, workPhotosRequired, withNormalizedPhotos };
