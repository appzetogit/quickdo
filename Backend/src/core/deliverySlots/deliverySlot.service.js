import mongoose from 'mongoose';
import { DeliverySlot, DeliverySlotBooking } from './deliverySlot.model.js';
import { ValidationError, NotFoundError } from '../auth/errors.js';

/**
 * Scheduled delivery against admin-defined slots (plan §5.3).
 *
 *  - a vertical (and zone) with NO active slot keeps today's behaviour: a
 *    scheduledAt is taken as given;
 *  - once slots exist, scheduledAt must fall inside one that is open for
 *    booking, and the slot's capacity for that day is claimed atomically when
 *    the order is placed (released again if the order is cancelled).
 */

const TZ_OFFSET_MIN = () => {
    const n = Number(process.env.SLOT_TZ_OFFSET_MINUTES);
    return Number.isFinite(n) ? n : 330;
};

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Local (platform time zone) date, time and weekday of an instant. */
export function localParts(at) {
    const d = new Date(new Date(at).getTime() + TZ_OFFSET_MIN() * 60000);
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), hhmm: iso.slice(11, 16), dow: d.getUTCDay() };
}

/** The instant a local date + "HH:MM" names. */
export function instantFor(date, hhmm) {
    return new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - TZ_OFFSET_MIN() * 60000);
}

const minutesOf = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
};

/** The slots that apply to a zone: its own, else the vertical-wide ones. */
export async function activeSlotsFor(vertical, zoneId) {
    const base = { vertical, isActive: true };
    if (zoneId && isId(zoneId)) {
        const own = await DeliverySlot.find({ ...base, zoneId: oid(zoneId) }).sort({ sortOrder: 1, startTime: 1 }).lean();
        if (own.length) return own;
    }
    return DeliverySlot.find({ ...base, zoneId: null }).sort({ sortOrder: 1, startTime: 1 }).lean();
}

function slotWindow(slot, date) {
    const startAt = instantFor(date, slot.startTime);
    let endAt = instantFor(date, slot.endTime);
    if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 3600 * 1000);
    return { startAt, endAt };
}

const bookingOpen = (slot, startAt, now = new Date()) =>
    startAt.getTime() - (Number(slot.cutoffMinutes) || 0) * 60000 > now.getTime();

/**
 * Which slot a scheduled time books. Returns null when the vertical/zone has no
 * slots (legacy behaviour: the time is used as given). Throws when slots exist
 * and the time matches none that is open, or the named slot is full.
 */
export async function resolveSlot({ vertical = 'quickCommerce', zoneId, scheduledAt, slotId, now = new Date() }) {
    if (!scheduledAt) return null;
    const at = new Date(scheduledAt);
    if (Number.isNaN(at.getTime())) throw new ValidationError('Invalid scheduled time');
    const slots = await activeSlotsFor(vertical, zoneId);
    if (!slots.length) return null;

    const { date, hhmm, dow } = localParts(at);
    const t = minutesOf(hhmm);
    const candidates = slots.filter((s) => {
        if (slotId && String(s._id) !== String(slotId)) return false;
        if (Array.isArray(s.daysOfWeek) && s.daysOfWeek.length && !s.daysOfWeek.includes(dow)) return false;
        const start = minutesOf(s.startTime);
        let end = minutesOf(s.endTime);
        if (end <= start) end += 24 * 60;
        return t >= start && t < end;
    });
    if (!candidates.length) {
        throw new ValidationError('Pick one of the available delivery slots for the scheduled time.');
    }
    const slot = candidates[0];
    const { startAt, endAt } = slotWindow(slot, date);
    if (!bookingOpen(slot, startAt, now)) {
        throw new ValidationError('That delivery slot is closed for booking. Please pick a later one.');
    }
    return { slot, date, startAt, endAt };
}

/**
 * Claim one place in a slot for an order. Idempotent per order: the same order
 * claiming twice holds one place. Throws when the slot is full.
 */
export async function reserveSlot({ slot, date, orderId }) {
    const slotId = oid(slot._id);
    const orderOid = oid(orderId);
    await DeliverySlotBooking.updateOne(
        { slotId, date },
        { $setOnInsert: { count: 0, orderIds: [] } },
        { upsert: true },
    ).catch((err) => { if (err?.code !== 11000) throw err; });

    const claimed = await DeliverySlotBooking.findOneAndUpdate(
        { slotId, date, count: { $lt: Number(slot.capacity) || 0 }, orderIds: { $ne: orderOid } },
        { $inc: { count: 1 }, $push: { orderIds: orderOid } },
        { new: true },
    ).lean();
    if (claimed) return { reserved: true, count: claimed.count };
    const mine = await DeliverySlotBooking.exists({ slotId, date, orderIds: orderOid });
    if (mine) return { reserved: true, already: true };
    throw new ValidationError('That delivery slot is full. Please pick another one.');
}

/** Give an order's place back. Idempotent: an order not in the slot changes nothing. */
export async function releaseSlot({ slotId, date, orderId }) {
    if (!isId(slotId) || !date || !isId(orderId)) return { released: false };
    const r = await DeliverySlotBooking.updateOne(
        { slotId: oid(slotId), date, orderIds: oid(orderId) },
        { $inc: { count: -1 }, $pull: { orderIds: oid(orderId) } },
    );
    return { released: r.modifiedCount === 1 };
}

/** What the customer can pick: the next `days` days of slots with places left. */
export async function listAvailableSlots({ vertical = 'quickCommerce', zoneId, days = 3, now = new Date() } = {}) {
    const slots = await activeSlotsFor(vertical, zoneId);
    if (!slots.length) return { slotsEnabled: false, days: [] };
    const span = Math.min(Math.max(Number(days) || 3, 1), 14);
    const dates = [];
    for (let i = 0; i < span; i += 1) dates.push(localParts(new Date(now.getTime() + i * 86400000)));
    const bookings = await DeliverySlotBooking.find({
        slotId: { $in: slots.map((s) => s._id) },
        date: { $in: dates.map((d) => d.date) },
    }).select('slotId date count').lean();
    const used = new Map(bookings.map((b) => [`${b.slotId}:${b.date}`, b.count]));

    return {
        slotsEnabled: true,
        days: dates.map(({ date, dow }) => ({
            date,
            slots: slots
                .filter((s) => !s.daysOfWeek?.length || s.daysOfWeek.includes(dow))
                .map((s) => {
                    const { startAt, endAt } = slotWindow(s, date);
                    const booked = used.get(`${s._id}:${date}`) || 0;
                    const remaining = Math.max(0, Number(s.capacity) - booked);
                    return {
                        slotId: String(s._id),
                        label: s.label || `${s.startTime} - ${s.endTime}`,
                        startTime: s.startTime,
                        endTime: s.endTime,
                        scheduledAt: startAt.toISOString(),
                        endsAt: endAt.toISOString(),
                        capacity: s.capacity,
                        remaining,
                        available: remaining > 0 && bookingOpen(s, startAt, now),
                    };
                }),
        })),
    };
}

/* ------------------------------------------------------------------ admin */

const ADMIN_FIELDS = ['vertical', 'zoneId', 'label', 'daysOfWeek', 'startTime', 'endTime', 'capacity', 'cutoffMinutes', 'isActive', 'sortOrder'];

function pickSlotInput(body = {}) {
    const out = {};
    for (const k of ADMIN_FIELDS) if (body[k] !== undefined) out[k] = body[k];
    if (out.zoneId === '' || out.zoneId === 'all') out.zoneId = null;
    if (out.zoneId && !isId(out.zoneId)) throw new ValidationError('Invalid zone');
    if (out.daysOfWeek !== undefined) {
        if (!Array.isArray(out.daysOfWeek)) throw new ValidationError('daysOfWeek must be a list of 0-6');
        out.daysOfWeek = [...new Set(out.daysOfWeek.map(Number))].filter((d) => d >= 0 && d <= 6);
    }
    if (out.capacity !== undefined) {
        out.capacity = Number(out.capacity);
        if (!Number.isInteger(out.capacity) || out.capacity < 1) throw new ValidationError('Capacity must be a whole number of at least 1');
    }
    if (out.vertical !== undefined && !['quickCommerce', 'food'].includes(out.vertical)) {
        throw new ValidationError('vertical must be quickCommerce or food');
    }
    return out;
}

export const listSlotsAdmin = async ({ vertical, zoneId } = {}) => {
    const q = {};
    if (vertical) q.vertical = vertical;
    if (zoneId === 'all') q.zoneId = null;
    else if (zoneId && isId(zoneId)) q.zoneId = oid(zoneId);
    return DeliverySlot.find(q).sort({ vertical: 1, zoneId: 1, sortOrder: 1, startTime: 1 }).lean();
};

export const createSlotAdmin = async (body) => {
    const input = pickSlotInput(body);
    try {
        return (await DeliverySlot.create(input)).toObject();
    } catch (err) {
        if (err?.name === 'ValidationError') throw new ValidationError(err.message);
        throw err;
    }
};

export const updateSlotAdmin = async (id, body) => {
    if (!isId(id)) throw new NotFoundError('Slot not found');
    const input = pickSlotInput(body);
    const doc = await DeliverySlot.findByIdAndUpdate(id, { $set: input }, { new: true, runValidators: true }).lean();
    if (!doc) throw new NotFoundError('Slot not found');
    return doc;
};

/** Deleting a slot keeps the orders already booked in it; it only stops new bookings. */
export const deleteSlotAdmin = async (id) => {
    if (!isId(id)) throw new NotFoundError('Slot not found');
    const r = await DeliverySlot.deleteOne({ _id: oid(id) });
    if (!r.deletedCount) throw new NotFoundError('Slot not found');
    return { deleted: true };
};
