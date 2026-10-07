/**
 * SOS, one path for every caller (SOW plan §4.7).
 *
 * There used to be two: POST /safety/sos (userSafety.service.triggerSOS) saved
 * an EmergencyAlert and told nobody ("In future: Trigger SMS/Push..."), and
 * POST /users/sos and /drivers/sos (safetyController) saved a SafetyAlert and
 * told the admin panel over the socket. The admin SOS screen read neither
 * consistently. Every entry point now lands here, on SafetyAlert, and a trigger:
 *
 *   1. saves the alert (or, pressed again on the same open ride alert, adds to
 *      the one already open instead of texting everyone twice);
 *   2. tells the admins: socket (`new_sos`, `safety:alert:new`) and FCM;
 *   3. texts every trusted contact of a rider -- or every emergency contact of
 *      a driver -- the live trip link (or a map link when there is no ride);
 *   4. keeps recording where the person is, at most every 10 seconds, until
 *      an admin resolves it.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { logger } from '../../../../utils/logger.js';
import { SafetyAlert } from '../../common/models/SafetyAlert.js';
import { Driver } from '../../driver/models/Driver.js';
import { Ride } from '../../user/models/Ride.js';
import { User } from '../../user/models/User.js';
import EmergencySetting from '../models/EmergencySetting.js';
import TrustedContact from '../models/TrustedContact.js';
import { emitToAdmins } from '../../services/dispatchService.js';
import { buildTripShareUrl, ensureTripShareLink } from './tripShare.service.js';

export const SOS_LOCATION_INTERVAL_MS = 10 * 1000;
const SOS_TRAIL_MAX = 720; // two hours at one point every 10 seconds
const REPEAT_WINDOW_MS = 30 * 60 * 1000;

const cleanString = (value = '') => String(value || '').trim();

/* The SMS sender, swappable so tests can stand in for SMS India Hub. */
let sendSms = async (args) => {
  const { sendSosAlertSms } = await import('../../services/smsService.js');
  return sendSosAlertSms(args);
};
export const setSosSmsSender = (fn) => {
  sendSms = fn;
};

const maskPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 4 ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : '****';
};

export const normalizeSosCoordinates = (value) => {
  if (!value) return null;
  const pick = (lng, lat) => {
    const x = Number(lng);
    const y = Number(lat);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= 90 && Math.abs(x) <= 180 ? [x, y] : null;
  };
  if (Array.isArray(value) && value.length >= 2) return pick(value[0], value[1]);
  if (Array.isArray(value?.coordinates) && value.coordinates.length >= 2) return pick(value.coordinates[0], value.coordinates[1]);
  return pick(value?.lng ?? value?.longitude ?? value?.lon, value?.lat ?? value?.latitude);
};

export const serializeSafetyAlert = (alert = {}) => {
  const coordinates = Array.isArray(alert?.location?.coordinates) ? alert.location.coordinates : [];
  const [lng, lat] = coordinates;

  return {
    id: String(alert?._id || ''),
    incidentType: cleanString(alert?.incidentType || 'sos').toLowerCase(),
    status: cleanString(alert?.status || 'active').toLowerCase(),
    sourceApp: cleanString(alert?.sourceApp || '').toLowerCase(),
    serviceType: cleanString(alert?.serviceType || 'general').toLowerCase(),
    riderName: cleanString(alert?.riderName),
    riderPhone: cleanString(alert?.riderPhone),
    driverName: cleanString(alert?.driverName),
    driverPhone: cleanString(alert?.driverPhone),
    vehicleLabel: cleanString(alert?.vehicleLabel),
    tripCode: cleanString(alert?.tripCode),
    pickupAddress: cleanString(alert?.pickupAddress),
    dropAddress: cleanString(alert?.dropAddress),
    locationLabel: cleanString(alert?.locationLabel),
    location:
      Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
        ? { lat: Number(lat), lng: Number(lng), coordinates: [Number(lng), Number(lat)] }
        : null,
    locationTrail: (Array.isArray(alert?.locationTrail) ? alert.locationTrail : []).slice(-60).map((point) => ({
      lat: Number(point?.coordinates?.[1]),
      lng: Number(point?.coordinates?.[0]),
      at: point?.at || null,
    })),
    lastLocationAt: alert?.lastLocationAt || null,
    shareUrl: alert?.shareToken ? buildTripShareUrl(alert.shareToken) : '',
    contactsNotified: Array.isArray(alert?.contactsNotified) ? alert.contactsNotified : [],
    notes: cleanString(alert?.notes),
    createdAt: alert?.createdAt || null,
    updatedAt: alert?.updatedAt || null,
    resolvedAt: alert?.resolvedAt || null,
    rideId: alert?.rideId ? String(alert.rideId?._id || alert.rideId) : '',
    deliveryId: alert?.deliveryId ? String(alert.deliveryId?._id || alert.deliveryId) : '',
    userId: alert?.userId ? String(alert.userId?._id || alert.userId) : '',
    driverId: alert?.driverId ? String(alert.driverId?._id || alert.driverId) : '',
    logs: Array.isArray(alert?.logs)
      ? alert.logs.map((log) => ({
        id: String(log?._id || ''),
        actorRole: cleanString(log?.actorRole || 'system').toLowerCase(),
        message: cleanString(log?.message),
        createdAt: log?.createdAt || null,
      }))
      : [],
  };
};

const getEmergencySettings = async () => {
  const settings = await EmergencySetting.findOne().lean();
  return settings || { enable_sos: true };
};

const deriveServiceType = ({ requested, ride }) => {
  const direct = cleanString(requested).toLowerCase();
  if (['ride', 'intercity', 'general'].includes(direct)) return direct;
  const rideType = cleanString(ride?.serviceType).toLowerCase();
  return ['ride', 'intercity'].includes(rideType) ? rideType : 'general';
};

/** The people to text: a rider's trusted contacts, or a driver's emergency contacts. */
const loadContacts = async ({ sourceApp, actorId }) => {
  if (sourceApp === 'driver') {
    const driver = await Driver.findById(actorId).select('emergencyContacts').lean();
    return (driver?.emergencyContacts || []).map((c) => ({ name: c.name, phone: c.phone }));
  }
  const contacts = await TrustedContact.find({ user_id: actorId, status: { $ne: 'inactive' } })
    .select('name phone')
    .lean();
  return contacts.map((c) => ({ name: c.name, phone: c.phone }));
};

const notifyContacts = async ({ alert, sourceApp, actorId, actorName, link }) => {
  const contacts = await loadContacts({ sourceApp, actorId });
  const results = [];
  for (const contact of contacts) {
    let outcome;
    try {
      outcome = await sendSms({ phone: contact.phone, name: actorName, link });
    } catch (error) {
      outcome = { sent: false, reason: error?.message || 'send_failed' };
    }
    results.push({
      name: cleanString(contact.name),
      phoneMasked: maskPhone(contact.phone),
      status: outcome?.sent ? 'sent' : 'failed',
      reason: outcome?.sent ? '' : cleanString(outcome?.reason).slice(0, 80),
    });
  }
  const sent = results.filter((r) => r.status === 'sent').length;
  await SafetyAlert.updateOne(
    { _id: alert._id },
    {
      $set: { contactsNotified: results },
      $push: {
        logs: {
          actorRole: 'system',
          message: contacts.length
            ? `Texted ${sent} of ${contacts.length} ${sourceApp === 'driver' ? 'emergency' : 'trusted'} contact(s)`
            : `No ${sourceApp === 'driver' ? 'emergency' : 'trusted'} contacts to text`,
        },
      },
    },
  );
  return results;
};

const notifyAdmins = async (payload) => {
  emitToAdmins('new_sos', payload);
  emitToAdmins('safety:alert:new', payload);
  try {
    const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
    await notifyAdminsSafely({
      title: 'SOS alert',
      body: `${payload.sourceApp === 'driver' ? payload.driverName || 'A driver' : payload.riderName || 'A rider'} raised an SOS`,
      data: { type: 'taxi_sos', alertId: payload.id, rideId: payload.rideId || '' },
    });
  } catch (error) {
    logger.warn(`[sos] admin push failed: ${error?.message || error}`);
  }
};

/**
 * Trigger an SOS. `sourceApp` is 'user' or 'driver', `actorId` the signed-in
 * rider or driver. Returns the serialized alert.
 */
export const triggerSos = async ({
  sourceApp,
  actorId,
  rideId,
  location,
  serviceType,
  locationLabel,
  pickupAddress,
  dropAddress,
  notes,
  tripCode,
  vehicleLabel,
  reason = 'sos_button',
}) => {
  if (!['user', 'driver'].includes(sourceApp)) {
    throw new ApiError(400, 'Unknown SOS source');
  }
  const settings = await getEmergencySettings();
  if (settings.enable_sos === false) {
    throw new ApiError(403, 'SOS feature is currently disabled.');
  }

  const validRideId = mongoose.Types.ObjectId.isValid(String(rideId || '')) ? String(rideId) : null;
  // Only the rider's or driver's own ride is attached: an id for anyone
  // else's ride would otherwise pull that ride's people into this alert.
  const ride = validRideId
    ? await Ride.findOne({ _id: validRideId, ...(sourceApp === 'user' ? { userId: actorId } : { driverId: actorId }) })
      .populate('userId', 'name phone')
      .populate('driverId', 'name phone vehicleNumber vehicleType')
      .lean()
    : null;
  const coords = normalizeSosCoordinates(location)
    || ride?.lastDriverLocation?.coordinates
    || ride?.pickupLocation?.coordinates
    || null;

  // Pressed again while the same ride's alert is still open: add to it.
  if (ride) {
    const open = await SafetyAlert.findOne({
      rideId: ride._id,
      sourceApp,
      status: 'active',
      createdAt: { $gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
    });
    if (open) {
      open.logs.push({ actorRole: sourceApp, message: 'SOS pressed again' });
      if (coords) {
        open.location = { type: 'Point', coordinates: coords };
        open.locationTrail.push({ coordinates: coords, at: new Date() });
        open.lastLocationAt = new Date();
      }
      await open.save();
      const payload = serializeSafetyAlert(open.toObject());
      emitToAdmins('safety:alert:updated', payload);
      return payload;
    }
  }

  const actorUser = sourceApp === 'user'
    ? await User.findById(actorId).select('name phone').lean()
    : ride?.userId || null;
  const actorDriver = sourceApp === 'driver'
    ? await Driver.findById(actorId).select('name phone vehicleNumber vehicleType').lean()
    : ride?.driverId || null;

  let shareToken = '';
  if (ride?.userId?._id && ['accepted', 'ongoing'].includes(ride.status)) {
    const link = await ensureTripShareLink({ rideId: ride._id, userId: ride.userId._id });
    shareToken = link.token;
  }

  const created = await SafetyAlert.create({
    sourceApp,
    serviceType: deriveServiceType({ requested: serviceType, ride }),
    userId: sourceApp === 'user' ? actorId : actorUser?._id || null,
    driverId: sourceApp === 'driver' ? actorId : actorDriver?._id || null,
    rideId: ride?._id || null,
    riderName: cleanString(actorUser?.name),
    riderPhone: cleanString(actorUser?.phone),
    driverName: cleanString(actorDriver?.name),
    driverPhone: cleanString(actorDriver?.phone),
    vehicleLabel: cleanString(vehicleLabel) || cleanString(actorDriver?.vehicleNumber) || cleanString(actorDriver?.vehicleType),
    tripCode: cleanString(tripCode) || (ride ? String(ride._id) : ''),
    pickupAddress: cleanString(pickupAddress) || cleanString(ride?.pickupAddress),
    dropAddress: cleanString(dropAddress) || cleanString(ride?.dropAddress),
    locationLabel: cleanString(locationLabel) || cleanString(ride?.pickupAddress),
    location: coords ? { type: 'Point', coordinates: coords } : undefined,
    locationTrail: coords ? [{ coordinates: coords, at: new Date() }] : [],
    lastLocationAt: coords ? new Date() : null,
    shareToken,
    notes: cleanString(notes).slice(0, 1000),
    logs: [{
      actorRole: 'system',
      message: reason === 'sos_button'
        ? `SOS triggered from ${sourceApp} app`
        : `SOS raised by the ride check (${reason})`,
    }],
  });

  const payload = serializeSafetyAlert(created.toObject());
  await notifyAdmins(payload);

  const actorName = sourceApp === 'driver' ? cleanString(actorDriver?.name) : cleanString(actorUser?.name);
  const link = shareToken
    ? buildTripShareUrl(shareToken)
    : coords ? `https://www.google.com/maps/search/?api=1&query=${coords[1]},${coords[0]}` : '';
  await notifyContacts({ alert: created, sourceApp, actorId, actorName: actorName.split(/\s+/)[0] || '', link })
    .catch((error) => logger.warn(`[sos] contact texts failed for alert ${created._id}: ${error?.message || error}`));

  return serializeSafetyAlert((await SafetyAlert.findById(created._id).lean()) || created.toObject());
};

/**
 * A new position for an open alert, kept at most every 10 seconds. The
 * caller is the alert's own rider or driver (`actorId`), or the system for a
 * ride's location update (actorId omitted).
 */
export const recordSosLocation = async ({ alertId, sourceApp, actorId, coordinates, at = new Date() }) => {
  const coords = normalizeSosCoordinates(coordinates);
  if (!coords) throw new ApiError(400, 'location is required');
  if (!mongoose.Types.ObjectId.isValid(String(alertId || ''))) throw new ApiError(404, 'Alert not found');

  const owner = sourceApp === 'driver' ? { driverId: actorId } : sourceApp === 'user' ? { userId: actorId } : {};
  const since = new Date(new Date(at).getTime() - SOS_LOCATION_INTERVAL_MS);
  // Conditional on the last point being 10 s old, so a burst keeps one.
  const updated = await SafetyAlert.findOneAndUpdate(
    {
      _id: alertId,
      ...owner,
      status: 'active',
      $or: [{ lastLocationAt: null }, { lastLocationAt: { $lte: since } }],
    },
    {
      $set: { location: { type: 'Point', coordinates: coords }, lastLocationAt: new Date(at) },
      $push: { locationTrail: { $each: [{ coordinates: coords, at: new Date(at) }], $slice: -SOS_TRAIL_MAX } },
    },
    { returnDocument: 'after' },
  ).lean();

  if (updated) {
    emitToAdmins('safety:alert:location', {
      id: String(updated._id),
      location: { lat: coords[1], lng: coords[0] },
      at: new Date(at).toISOString(),
    });
    return { recorded: true };
  }

  const exists = await SafetyAlert.exists({ _id: alertId, ...owner });
  if (!exists) throw new ApiError(404, 'Alert not found');
  return { recorded: false };
};

/** From a driver's ride location update: every open alert on that ride. */
export const recordSosLocationForRide = async ({ rideId, coordinates }) => {
  if (!mongoose.Types.ObjectId.isValid(String(rideId || ''))) return 0;
  const open = await SafetyAlert.find({ rideId, status: 'active' }).select('_id').lean();
  let recorded = 0;
  for (const alert of open) {
    const result = await recordSosLocation({ alertId: alert._id, coordinates }).catch(() => null);
    if (result?.recorded) recorded += 1;
  }
  return recorded;
};

export const resolveSos = async ({ alertId, adminId, note }) => {
  const alert = await SafetyAlert.findById(alertId);
  if (!alert) throw new ApiError(404, 'Safety alert not found');
  if (alert.status !== 'resolved') {
    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.resolvedByAdminId = cleanString(adminId);
  }
  alert.logs.push({ actorRole: 'admin', message: cleanString(note) || 'Incident marked as resolved by admin' });
  await alert.save();
  const payload = serializeSafetyAlert(alert.toObject());
  emitToAdmins('safety:alert:updated', payload);
  return payload;
};

export const listSos = async ({ status = 'active', page = 1, limit = 25 } = {}) => {
  const normalized = cleanString(status || 'active').toLowerCase();
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const query = normalized && normalized !== 'all' ? { status: normalized } : {};
  const [results, total] = await Promise.all([
    SafetyAlert.find(query).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    SafetyAlert.countDocuments(query),
  ]);
  return {
    results: results.map(serializeSafetyAlert),
    paginator: { current_page: safePage, last_page: Math.max(1, Math.ceil(total / safeLimit)), total },
  };
};
