import mongoose from 'mongoose';
import { NotFoundError, ValidationError } from '../../../../core/auth/errors.js';
import { buildPaginatedResult } from '../../../../utils/helpers.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { MEDICAL_STORE_TYPE } from '../../shared/storeType.js';
import { sellerIdsOfStoreType, applySellerScope } from '../../shared/storeScope.js';
import { PRESCRIPTION_STATUS } from '../../shared/prescriptionRules.js';

/**
 * The admin's view of the prescription queue.
 *
 * The pharmacist decides -- see orders/services reviewOrderPrescription, which owns
 * the rules. Nothing here writes: an admin approving a prescription would be a
 * non-pharmacist authorising a dispense, which is the one thing the seller-side
 * gate exists to prevent. This is the same queue, read-only, so the platform can
 * see what is waiting and what was refused.
 *
 * Scope is not taken from the caller. Every other medical list reads `storeType`
 * off the query because it is the same screen serving both panels; this one has no
 * unscoped counterpart, so the pharmacy filter is hardcoded and a missing or
 * unexpected query parameter cannot widen it to a grocer's orders.
 */

const PRESCRIPTION_STATUSES = Object.freeze(Object.values(PRESCRIPTION_STATUS));

const escapeSearchRegex = (value) => String(value || '').slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const appendAndCondition = (filter, condition) => {
    if (!condition || Object.keys(condition).length === 0) return;
    if (!filter.$and) filter.$and = [];
    filter.$and.push(condition);
};

/** Absent or 'all' means every status; anything else must be a status we know. */
const normalizePrescriptionStatusFilter = (value) => {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw || raw === 'all') return null;
    if (!PRESCRIPTION_STATUSES.includes(raw)) {
        throw new ValidationError(`Unknown prescription status: ${String(value).slice(0, 40)}`);
    }
    return raw;
};

/**
 * Everything except the status tab, so the tab counts and the list they sit above
 * are answering the same question. Built here rather than twice, because a search
 * that narrowed the rows but not the counts would read as the counts being wrong.
 */
async function buildQueueFilter(query = {}) {
    // Only orders that actually carry a prescription. `required` is stamped at
    // creation from the seller's store type, so this is the order's own record of
    // having needed one -- not a re-read of what the shop is today.
    // Rows an admin removed from the queue stay in the database (money, refunds
    // and reports still reference them) but no longer show here.
    const filter = { 'prescription.required': true, 'prescription.adminRemovedAt': null };

    const restaurantIdRaw = typeof query.restaurantId === 'string' ? query.restaurantId.trim() : '';
    if (restaurantIdRaw && mongoose.Types.ObjectId.isValid(restaurantIdRaw)) {
        filter.restaurantId = new mongoose.Types.ObjectId(restaurantIdRaw);
    }

    const startDateRaw = typeof query.startDate === 'string' ? query.startDate.trim() : '';
    const endDateRaw = typeof query.endDate === 'string' ? query.endDate.trim() : '';
    if (startDateRaw || endDateRaw) {
        const createdAt = {};
        const start = startDateRaw ? new Date(startDateRaw) : null;
        const end = endDateRaw ? new Date(endDateRaw) : null;
        if (start && !Number.isNaN(start.getTime())) createdAt.$gte = start;
        if (end && !Number.isNaN(end.getTime())) {
            // The screen sends a plain date. Without this an order placed at 14:00
            // on the end date falls outside its own day.
            end.setHours(23, 59, 59, 999);
            createdAt.$lte = end;
        }
        if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;
    }

    const search = typeof query.search === 'string' ? query.search.trim() : '';
    if (search) {
        const escaped = escapeSearchRegex(search);
        const phoneDigits = search.replace(/\D/g, '');
        const orConditions = [
            { order_id: { $regex: escaped, $options: 'i' } },
            { orderId: { $regex: escaped, $options: 'i' } },
            { customerName: { $regex: escaped, $options: 'i' } },
            { customerPhone: { $regex: escaped, $options: 'i' } },
        ];
        // A phone typed with spaces or +91 matches nothing against the stored digits.
        if (phoneDigits.length >= 4) orConditions.push({ customerPhone: { $regex: phoneDigits } });
        appendAndCondition(filter, { $or: orConditions });
    }

    /*
     * Applied LAST, and it intersects. A named seller above may be a grocer, and a
     * scope applied before it would be replaced -- putting that grocer's order on
     * a medical screen. With no pharmacy on the platform this narrows to nothing,
     * which is the honest answer.
     */
    applySellerScope(filter, await sellerIdsOfStoreType(FoodRestaurant, MEDICAL_STORE_TYPE));
    return filter;
}

const toItem = (line = {}) => ({
    itemId: line.itemId || '',
    name: line.name || '',
    quantity: Number(line.quantity) || 0,
    price: Number(line.price) || 0,
    packSize: line.packSize || '',
    notes: line.notes || '',
});

const serializeQueueOrder = (doc, { withItems = false } = {}) => {
    const seller = doc.restaurantId && typeof doc.restaurantId === 'object' ? doc.restaurantId : null;
    const customer = doc.userId && typeof doc.userId === 'object' ? doc.userId : null;
    const rx = doc.prescription || {};
    const items = Array.isArray(doc.items) ? doc.items : [];

    const out = {
        id: String(doc._id),
        // The human-readable code the customer and the shop both quote. Older orders
        // predate it, so the mongo id stands in rather than the row rendering blank.
        orderId: doc.order_id || doc.orderId || String(doc._id),
        createdAt: doc.createdAt || null,
        orderStatus: doc.orderStatus || '',
        // A prescription-only order has no lines until the pharmacist prices it, so
        // zero here is a real state, not missing data. See shared/prescriptionOrder.js.
        prescriptionOnly: doc.prescriptionOnly === true,
        itemCount: items.length,
        total: Number(doc.pricing?.total) || 0,
        sellerId: seller ? String(seller._id) : (doc.restaurantId ? String(doc.restaurantId) : null),
        sellerName: seller?.restaurantName || '',
        customerName: doc.customerName || customer?.name || '',
        customerPhone: doc.customerPhone || customer?.phone || '',
        prescription: {
            required: rx.required === true,
            imageUrl: rx.imageUrl || '',
            uploadedAt: rx.uploadedAt || null,
            status: rx.status || PRESCRIPTION_STATUS.NOT_REQUIRED,
            reviewedAt: rx.reviewedAt || null,
            reviewedBy: rx.reviewedBy ? String(rx.reviewedBy) : null,
            rejectionReason: rx.rejectionReason || '',
            /*
             * The pharmacy's bill and the customer's answer to it, which did not
             * exist when this queue was written. Without it the screen shows an
             * order sitting at "approved" with no way to tell whether it is
             * waiting on the pharmacist to bill it or on the customer to pay --
             * the two longest waits in the flow, and the two an operator is
             * called about.
             */
            bill: {
                imageUrl: rx.bill?.imageUrl || '',
                amount: Number(rx.bill?.amount) || 0,
                status: rx.bill?.status || 'none',
                uploadedAt: rx.bill?.uploadedAt || null,
                approvedAt: rx.bill?.approvedAt || null,
                declineReason: rx.bill?.declineReason || '',
            },
        },
        // What the customer actually owes, and whether it has been paid. The
        // total alone does not say which.
        paymentMethod: doc.payment?.method || '',
        paymentStatus: doc.payment?.status || '',
    };

    if (withItems) out.items = items.map(toItem);
    return out;
};

/**
 * The queue, newest first.
 *
 * @param {object} query page, limit, status, search, restaurantId, startDate, endDate
 */
export async function listPrescriptionOrders(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 2000);
    const skip = (page - 1) * limit;

    const filter = await buildQueueFilter(query);
    const status = normalizePrescriptionStatusFilter(query.status);
    if (status) filter['prescription.status'] = status;

    const [docs, total] = await Promise.all([
        FoodOrder.find(filter)
            .populate('userId', 'name phone email')
            .populate('restaurantId', 'restaurantName area city ownerPhone')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodOrder.countDocuments(filter),
    ]);

    const paginated = buildPaginatedResult({ docs: docs.map((d) => serializeQueueOrder(d)), total, page, limit });
    return { ...paginated, orders: paginated.data };
}

/**
 * One order, with what was dispensed.
 *
 * Looked up inside the same scope as the list rather than by id alone: an id
 * guessed or pasted from the unscoped orders screen must not open a grocery
 * order on a medical panel.
 */
export async function getPrescriptionOrder(orderId) {
    const raw = String(orderId || '').trim();
    if (!raw) throw new ValidationError('Order id required');

    // Scope only. The list's own search and date filters are deliberately not
    // applied: the row was opened from a list that had already matched it, and
    // re-applying them would 404 an order the operator is looking at.
    const filter = await buildQueueFilter({});
    filter.$or = mongoose.Types.ObjectId.isValid(raw)
        ? [{ _id: new mongoose.Types.ObjectId(raw) }, { order_id: raw }, { orderId: raw }, { previousOrderIds: raw }]
        : [{ order_id: raw }, { orderId: raw }, { previousOrderIds: raw }];

    const doc = await FoodOrder.findOne(filter)
        .populate('userId', 'name phone email')
        .populate('restaurantId', 'restaurantName area city ownerPhone')
        .lean();
    if (!doc) throw new NotFoundError('Order not found');

    return { order: serializeQueueOrder(doc, { withItems: true }) };
}

/**
 * Totals behind the status tabs.
 *
 * One grouped pass rather than a count per tab: four round trips against the same
 * filter can disagree with each other when a pharmacist reviews something between
 * them, and the tabs would then not add up to the "All" they sit beside.
 */
export async function getPrescriptionOrderCounts(query = {}) {
    const filter = await buildQueueFilter(query);
    const rows = await FoodOrder.aggregate([
        { $match: filter },
        { $group: { _id: '$prescription.status', count: { $sum: 1 } } },
    ]);

    const counts = {
        [PRESCRIPTION_STATUS.PENDING_REVIEW]: 0,
        [PRESCRIPTION_STATUS.APPROVED]: 0,
        [PRESCRIPTION_STATUS.REJECTED]: 0,
        all: 0,
    };
    for (const row of rows) {
        const key = String(row._id || '');
        if (key in counts && key !== 'all') counts[key] = row.count;
        counts.all += row.count;
    }
    return { counts };
}

/** A rider is carrying it: never removed from here. */
const WITH_RIDER = new Set(['picked_up', 'reached_drop']);
/** Still at the pharmacy: cancelled as admin first (refund, stock, customer told), then removed. */
const BEFORE_PICKUP = new Set(['created', 'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup']);
const IN_PROGRESS = new Set([...WITH_RIDER, ...BEFORE_PICKUP]);

/**
 * Take an order out of the prescription queue.
 *
 * A soft removal: the order and its payment record are kept (settlements,
 * refunds and reports read them), only this queue stops listing it. Refused
 * while the order is still being prepared or delivered, so live work cannot be
 * hidden from the pharmacist's supervisors by accident.
 */
export async function removePrescriptionOrder(orderId, { adminId = null, reason = '' } = {}) {
    const raw = String(orderId || '').trim();
    if (!raw) throw new ValidationError('Order id required');
    const scope = await buildQueueFilter({});
    const idFilter = mongoose.Types.ObjectId.isValid(raw)
        ? { $or: [{ _id: new mongoose.Types.ObjectId(raw) }, { order_id: raw }, { orderId: raw }] }
        : { $or: [{ order_id: raw }, { orderId: raw }] };

    const doc = await FoodOrder.findOne({ ...scope, ...idFilter }).select('orderStatus').lean();
    if (!doc) throw new NotFoundError('Order not found');
    if (WITH_RIDER.has(String(doc.orderStatus))) {
        throw new ValidationError('A rider is delivering this order. It can be removed once it is delivered or cancelled.');
    }
    let cancelledFirst = false;
    if (BEFORE_PICKUP.has(String(doc.orderStatus))) {
        // The same admin cancel the orders screen uses: refunds an online payment,
        // puts the stock back and tells the customer.
        const { updateOrderStatusAdmin } = await import('../../orders/services/order.service.js');
        await updateOrderStatusAdmin(String(doc._id), 'cancelled_by_admin', String(reason || '').trim() || 'Cancelled by admin', adminId);
        cancelledFirst = true;
    }

    // Conditional, so a status change between the read and the write is honoured.
    const updated = await FoodOrder.findOneAndUpdate(
        { _id: doc._id, 'prescription.adminRemovedAt': null, orderStatus: { $nin: [...IN_PROGRESS] } },
        {
            $set: {
                'prescription.adminRemovedAt': new Date(),
                'prescription.adminRemovedBy': adminId && mongoose.Types.ObjectId.isValid(String(adminId))
                    ? new mongoose.Types.ObjectId(String(adminId)) : null,
                'prescription.adminRemovedReason': String(reason || '').trim().slice(0, 300),
            },
        },
        { new: true, projection: { _id: 1 } },
    );
    if (!updated) throw new ValidationError('This order changed while you were removing it. Refresh and try again.');
    return { orderId: String(updated._id), removed: true, cancelledFirst };
}
