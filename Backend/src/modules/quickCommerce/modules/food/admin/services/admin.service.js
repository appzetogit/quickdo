import { safeRiderZoneFilter } from '../../../../../../core/zones/riderZones.js';
import { normalizeBarcode } from '../../../../../../core/catalog/barcode.js';
import mongoose from 'mongoose';
// NotFoundError was already used further down this file (deleteDeliveryPartner)
// without ever being imported — that path threw a ReferenceError instead of a 404
// whenever the partner was missing.
import { zoneMatchFrom } from '../../../../../../core/admin/adminZoneScope.js';
import { NotFoundError, ValidationError } from '../../../../core/auth/errors.js';
import { normalizeFoodImages } from './foodImages.util.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodRestaurantOutletTimings } from '../../restaurant/models/outletTimings.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { DeliverySupportTicket } from '../../delivery/models/supportTicket.model.js';
import { FoodNotification } from '../../../../core/notifications/models/notification.model.js';
import { sendNotificationToOwner } from '../../../../core/notifications/firebase.service.js';
import { FoodRestaurantSubscriptionSettings } from '../models/restaurantSubscriptionSettings.model.js';
import { QCZone } from '../models/zone.model.js';
import { zoneModelFor } from '../../shared/zoneServiceability.js';

/*
 * Zone reads and writes. Quick commerce has one map (qc_zones); the old
 * `vertical` parameter (Medical had its own) is accepted and ignored.
 */
const zonesOf = (vertical) => zoneModelFor(vertical);
import { invalidateActiveZonesCache } from '../../shared/zoneServiceability.js';
import { FoodCategory } from '../models/category.model.js';
import { FoodItem } from '../models/food.model.js';
import { FoodOffer } from '../models/offer.model.js';
import { FoodOfferUsage } from '../models/offerUsage.model.js';
import { DeliveryBonusTransaction } from '../models/deliveryBonusTransaction.model.js';
import { normalizeStoreTypeInput } from '../../shared/storeType.js';
import { storeTypeCondition, sellerIdsOfStoreType, applySellerScope } from '../../shared/storeScope.js';
import { FoodEarningAddon } from '../models/earningAddon.model.js';
import { FoodEarningAddonHistory } from '../models/earningAddonHistory.model.js';
import { FoodRestaurantCommission } from '../models/restaurantCommission.model.js';
import { FoodDeliveryCommissionRule } from '../models/deliveryCommissionRule.model.js';
import { FoodFeeSettings } from '../models/feeSettings.model.js';
import { FeedbackExperience } from '../models/feedbackExperience.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
// Master's model, bound to this vertical's own collection. The fork's copy of the
// schema is gone; qc_refresh_tokens is not, because moving it would log everyone out.
import { QCRefreshToken as FoodRefreshToken } from '../../../../../../core/refreshTokens/refreshToken.model.js';
import { FoodDeliveryCashLimit } from '../models/deliveryCashLimit.model.js';
import { FoodDeliveryEmergencyHelp } from '../models/deliveryEmergencyHelp.model.js';
import { FoodReferralSettings } from '../models/referralSettings.model.js';
import { FoodReferralLog } from '../models/referralLog.model.js';
import { FoodSafetyEmergencyReport } from '../models/safetyEmergencyReport.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { FoodRestaurantSupportTicket } from '../../restaurant/models/supportTicket.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { isCancelledOrder, CANCELLED_ORDER_STATUSES } from '../../orders/services/order.helpers.js';
import { FoodTransaction } from '../../orders/models/foodTransaction.model.js';
import { FoodRestaurantWithdrawal } from '../../restaurant/models/foodRestaurantWithdrawal.model.js';
import { FoodDeliveryWithdrawal } from '../../delivery/models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryWallet } from '../../delivery/models/deliveryWallet.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { FoodUnregisteredRestaurant } from '../../restaurant/models/unregisteredRestaurant.model.js';
import { FoodAdmin } from '../../../../core/admin/admin.model.js';
import { getAdminRestaurantSubscriptionHistory as getAdminRestaurantSubscriptionHistoryFromRestaurant } from '../../restaurant/services/subscriptionHistory.service.js';
import { FoodRestaurantSubscriptionHistory } from '../../restaurant/models/subscriptionHistory.model.js';
import { ADMIN_FULL_PERMISSIONS, isValidPermissionPayload, sanitizeAdminPermissions } from '../../../../constants/permissions.js';
import {
    backfillLegacyCategoryWorkflow,
    categoryAllowsFoodType,
    normalizeCategoryFoodTypeScope,
    serializeCategoryForResponse
} from '../../shared/categoryWorkflow.js';
import {
    extractRawFoodVariants,
    getFoodDisplayOtherPrice,
    getFoodDisplayPrice,
    hasFoodVariants,
    normalizeFoodVariantsInput,
    serializeFoodVariants
} from './foodVariant.service.js';
import { resolveDiscountSplit } from '../../shared/discountSplit.util.js';
import {
    isRestaurantEarnedOrder,
    computeRestaurantOrderShare,
} from '../../shared/restaurantPayout.util.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const parseBooleanLike = (value, fieldName) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on', 'active'].includes(normalized)) return true;
        if (['false', '0', 'no', 'n', 'off', 'inactive'].includes(normalized)) return false;
    }
    throw new ValidationError(`${fieldName} must be a boolean`);
};

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(num) ? num : null;
};

const normalizeRestaurantTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const toHHMM = (hour, minute) => {
        const h = Number(hour);
        const m = Number(minute);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
        if (h < 0 || h > 23 || m < 0 || m > 59) return '';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return toHHMM(hhmm[1], hhmm[2]);

    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampm) {
        let hour = Number(ampm[1]);
        const minute = Number(ampm[2]);
        const period = ampm[3].toUpperCase();
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
        if (period === 'AM') hour = hour === 12 ? 0 : hour;
        if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
        return toHHMM(hour, minute);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return toHHMM(parsed.getHours(), parsed.getMinutes());
    }

    return '';
};

const timeToMinutes = (value) => {
    const normalized = normalizeRestaurantTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const validateOpeningClosingTimes = (openingTime, closingTime) => {
    const open = timeToMinutes(openingTime);
    const close = timeToMinutes(closingTime);
    if (open === null || close === null) return;
    if (open === close) {
        throw new ValidationError('Opening time and closing time cannot be same');
    }
    if (close < open) {
        throw new ValidationError('Closing time cannot be less than opening time');
    }
};

const normalizeDayName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const exact = DAY_NAMES.find((d) => d.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const abbr = raw.slice(0, 3).toLowerCase();
    return DAY_NAMES.find((d) => d.toLowerCase().startsWith(abbr)) || null;
};

const syncAdminRestaurantOutletTimings = async (restaurantDoc) => {
    const openingTime = normalizeRestaurantTime(restaurantDoc?.openingTime) || '09:00';
    const closingTime = normalizeRestaurantTime(restaurantDoc?.closingTime) || '22:00';
    const normalizedOpenDays = Array.isArray(restaurantDoc?.openDays)
        ? [...new Set(restaurantDoc.openDays.map(normalizeDayName).filter(Boolean))]
        : [];
    const fallbackOpenDays = new Set(normalizedOpenDays.length ? normalizedOpenDays : DAY_NAMES);

    const existing = await FoodRestaurantOutletTimings.findOne({ restaurantId: restaurantDoc._id })
        .select('timings')
        .lean();
    const existingTimings = Array.isArray(existing?.timings) ? existing.timings : [];

    const timings = DAY_NAMES.map((day) => {
        const current = existingTimings.find((slot) => normalizeDayName(slot?.day) === day);
        const isOpen = current ? current.isOpen !== false : fallbackOpenDays.has(day);
        return {
            day,
            isOpen,
            openingTime: isOpen ? openingTime : '',
            closingTime: isOpen ? closingTime : '',
        };
    });

    await FoodRestaurantOutletTimings.updateOne(
        { restaurantId: restaurantDoc._id },
        { $set: { timings } },
        { upsert: true }
    );
};

export async function getRestaurantComplaints(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { type: 'order' };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.complaintType && query.complaintType !== 'all') filter.issueType = query.complaintType;
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }
    if (query.search) {
        const searchRegex = { $regex: query.search, $options: 'i' };
        const restaurantIds = await FoodRestaurant.find({ restaurantName: searchRegex }).select('_id').lean();
        const userIds = await FoodUser.find({ name: searchRegex }).select('_id').lean();
        const orderIds = await FoodOrder.find({ orderId: searchRegex }).select('_id').lean();

        filter.$or = [
            { restaurantId: { $in: restaurantIds.map(r => r._id) } },
            { userId: { $in: userIds.map(u => u._id) } },
            { orderId: { $in: orderIds.map(o => o._id) } },
            { description: searchRegex },
            { issueType: searchRegex }
        ];
    }
    const fromDate = query.fromDate || query.startDate;
    const toDate = query.toDate || query.endDate;
    if (fromDate && toDate) {
        filter.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }

    const [complaints, total] = await Promise.all([
        FoodSupportTicket.find(filter)
            .populate('userId', 'name phone profileImage')
            .populate('restaurantId', 'restaurantName profileImage area city')
            .populate('orderId', 'orderId orderStatus pricing createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodSupportTicket.countDocuments(filter)
    ]);

    return { complaints, total, page, limit };
}

export async function getRestaurantComplaintStats(query = {}) {
    const baseFilter = { type: 'order' };
    if (query.complaintType && query.complaintType !== 'all') {
        baseFilter.issueType = query.complaintType;
    }

    const [open, inProgress, resolved, total] = await Promise.all([
        FoodSupportTicket.countDocuments({ ...baseFilter, status: 'open' }),
        FoodSupportTicket.countDocuments({ ...baseFilter, status: 'in-progress' }),
        FoodSupportTicket.countDocuments({ ...baseFilter, status: 'resolved' }),
        FoodSupportTicket.countDocuments(baseFilter),
    ]);

    return { total, open, inProgress, resolved };
}

export async function globalSearch(query = '') {
    const term = String(query).trim();
    if (!term) return [];
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };

    const [orders, users, restaurants, items, categories, addons] = await Promise.all([
        FoodOrder.find({
            $or: [{ orderId: regex }, { orderStatus: regex }]
        })
            .limit(5)
            .select('orderId orderStatus createdAt')
            .lean(),
        FoodUser.find({
            $or: [{ name: regex }, { email: regex }, { phone: regex }],
            role: 'USER'
        })
            .limit(5)
            .select('name email phone')
            .lean(),
        FoodRestaurant.find({
            $or: [{ restaurantName: regex }, { ownerName: regex }, { city: regex }]
        })
            .limit(5)
            .select('restaurantName city area status')
            .lean(),
        FoodItem.find({
            $or: [{ name: regex }, { description: regex }]
        })
            .limit(5)
            .select('name description price')
            .lean(),
        FoodCategory.find({ name: regex })
            .limit(3)
            .select('name image')
            .lean(),
        FoodAddon.find({ name: regex })
            .limit(3)
            .select('name price')
            .lean()
    ]);

    const results = [];

    orders.forEach(o => results.push({
        id: o._id,
        type: 'Order',
        title: `#${o.orderId}`,
        description: `Status: ${o.orderStatus}`,
        path: `/admin/food/orders/all?orderId=${o._id}`
    }));

    users.forEach(u => results.push({
        id: u._id,
        type: 'User',
        title: u.name || 'Unnamed',
        description: `${u.email || u.phone || ''}`,
        path: `/admin/food/customers?userId=${u._id}`
    }));

    restaurants.forEach(r => results.push({
        id: r._id,
        type: 'Restaurant',
        title: r.restaurantName,
        description: `${r.area || ''}, ${r.city || ''} (${r.status})`,
        path: `/admin/food/restaurants?restaurantId=${r._id}`
    }));

    items.forEach(i => results.push({
        id: i._id,
        type: 'Product',
        title: i.name,
        description: `Price: ₹${i.price}`,
        path: `/admin/food/foods?productId=${i._id}`
    }));

    categories.forEach(c => results.push({
        id: c._id,
        type: 'Category',
        title: c.name,
        description: 'Menu Category',
        path: `/admin/food/categories`
    }));

    addons.forEach(a => results.push({
        id: a._id,
        type: 'Addon',
        title: a.name,
        description: `Price: ₹${a.price}`,
        path: `/admin/food/addons`
    }));

    return results;
}

export async function updateRestaurantComplaint(id, updateData) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid complaint ID');
    }
    const update = {};
    if (updateData.status && ['open', 'in-progress', 'resolved'].includes(String(updateData.status))) {
        update.status = String(updateData.status);
    }
    if (updateData.adminResponse !== undefined) update.adminResponse = updateData.adminResponse;

    const updated = await FoodSupportTicket.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true }
    ).lean();

    if (!updated) throw new ValidationError('Complaint not found');
    return updated;
}

export async function getRestaurants(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const status = query.status;
    const search = String(query.search || '').trim();
    const isActiveRaw = query.isActive;
    const sortBy = String(query.sortBy || 'created-desc').trim();
    const includeStats = query.includeStats === 'true' || query.includeStats === true;

    const filter = {};
    const zoneMatch = zoneMatchFrom(query);
    if (zoneMatch) filter.zoneId = zoneMatch;
    // Optionally narrowed to one store type. An unknown type is refused rather
    // than ignored, so a bad value can never widen the list back to every seller.
    const storeTypeFilter = storeTypeCondition(query.storeType);
    if (storeTypeFilter) filter.storeType = storeTypeFilter;
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
        filter.status = status;
    }
    if (search) {
        const raw = search.slice(0, 80);
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const normalized = raw.toLowerCase().trim().replace(/\s+/g, ' ');
        const phoneDigits = raw.replace(/\D/g, '');
        const or = [
            { restaurantName: { $regex: escaped, $options: 'i' } },
            { ownerName: { $regex: escaped, $options: 'i' } },
            { ownerEmail: { $regex: escaped, $options: 'i' } },
            { ownerPhone: { $regex: escaped, $options: 'i' } },
            { primaryContactNumber: { $regex: escaped, $options: 'i' } },
        ];
        if (normalized.length >= 2) {
            or.push({ restaurantNameNormalized: { $regex: normalized, $options: 'i' } });
        }
        if (phoneDigits.length >= 4) {
            or.push({ ownerPhoneLast10: { $regex: phoneDigits } });
            or.push({ ownerPhoneDigits: { $regex: phoneDigits } });
        }
        filter.$or = or;
    }
    if (isActiveRaw === 'true' || isActiveRaw === true) {
        // Treat missing isActive as active (legacy restaurants may not have the field).
        filter.isActive = { $ne: false };
    } else if (isActiveRaw === 'false' || isActiveRaw === false) {
        filter.isActive = false;
    }

    const sortMap = {
        'created-desc': { createdAt: -1 },
        'created-asc': { createdAt: 1 },
        'name-asc': { restaurantName: 1 },
        'name-desc': { restaurantName: -1 },
        'owner-asc': { ownerName: 1 },
        'owner-desc': { ownerName: -1 },
        'rating-asc': { rating: 1 },
        'rating-desc': { rating: -1 },
        'active-asc': { isActive: 1 },
        'active-desc': { isActive: -1 },
    };
    const sort = sortMap[sortBy] || { createdAt: -1 };

    const listPromise = FoodRestaurant.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .select('restaurantName slug location area city status isAcceptingOrders ownerName ownerPhone primaryContactNumber zoneId profileImage coverImages menuImages rating totalRatings isActive')
        .populate('zoneId', 'name zoneName')
        .lean();
    const countPromise = FoodRestaurant.countDocuments(filter);

    const statsFilter = status && ['pending', 'approved', 'rejected'].includes(status)
        ? { status }
        : {};
    const statsPromises = includeStats
        ? [
            FoodRestaurant.countDocuments(statsFilter),
            FoodRestaurant.countDocuments({ ...statsFilter, isActive: true }),
            FoodRestaurant.countDocuments({ ...statsFilter, isActive: { $ne: true } }),
        ]
        : [];

    const [restaurants, total, statsTotal, statsActive, statsInactive] = await Promise.all([
        listPromise,
        countPromise,
        ...statsPromises,
    ]);

    const result = { restaurants, total, page, limit };
    if (includeStats) {
        result.stats = {
            total: Number(statsTotal || 0),
            active: Number(statsActive || 0),
            inactive: Number(statsInactive || 0),
        };
    }
    return result;
}


const PENDING_ORDER_STATUSES = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];

const getDateRangeByPeriod = (periodRaw) => {
    const period = String(periodRaw || 'overall').trim().toLowerCase();
    if (!period || period === 'overall' || period === 'all') return null;

    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    if (period === 'today') {
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }

    if (period === 'week') {
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - start.getDay());
        end.setTime(start.getTime());
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    }

    if (period === 'month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start: monthStart, end: monthEnd };
    }

    if (period === 'year') {
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        return { start: yearStart, end: yearEnd };
    }

    return null;
};

const formatMonthShort = (year, monthIndex) =>
    new Date(year, monthIndex, 1).toLocaleString('en-IN', { month: 'short' });

export async function getDashboardStats(query = {}) {
    const periodRange = getDateRangeByPeriod(query.period);
    // The asked zone, or a zone-limited sub-admin's zones ($in), or none.
    const zoneId = zoneMatchFrom(query);

    const orderMatch = {
        $or: [
            { "payment.method": { $in: ["cash", "wallet"] } },
            { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
        ],
    };
    if (periodRange) {
        orderMatch.createdAt = { $gte: periodRange.start, $lte: periodRange.end };
    }
    if (zoneId) {
        orderMatch.zoneId = zoneId;
    }

    const restaurantMatch = {};
    if (zoneId) {
        restaurantMatch.zoneId = zoneId;
    }

    const zoneRestaurantIds = zoneId
        ? await FoodRestaurant.find({ zoneId }).distinct('_id')
        : null;
    const zoneScopedRestaurantMatch = zoneId
        ? { restaurantId: { $in: zoneRestaurantIds || [] } }
        : {};

    const [
        orderTotalsAgg,
        monthlyAgg,
        restaurantsTotal,
        restaurantsPending,
        deliveryTotal,
        deliveryPending,
        foodsTotal,
        addonsTotal,
        customersTotal,
        recentPendingRestaurants,
        recentPendingDelivery,
        recentPendingOrders,
        recentDeliveredOrders,
        recentCancelledOrders,
        recentCustomers
    ] = await Promise.all([
        FoodOrder.aggregate([
            { $match: orderMatch },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] } },
                    cancelled: {
                        $sum: {
                            $cond: [{ $in: ['$orderStatus', CANCELLED_ORDER_STATUSES] }, 1, 0]
                        }
                    },
                    pending: {
                        $sum: {
                            $cond: [{ $in: ['$orderStatus', PENDING_ORDER_STATUSES] }, 1, 0]
                        }
                    },
                    revenueTotal: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.total', 0] }, 0] 
                        } 
                    },
                    commissionTotal: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.restaurantCommission', 0] }, 0] 
                        } 
                    },
                    platformFeeTotal: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.platformFee', 0] }, 0] 
                        } 
                    },
                    deliveryFeeTotal: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.deliveryFee', 0] }, 0] 
                        } 
                    },
                    gstTotal: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.tax', 0] }, 0] 
                        } 
                    },
                    adminNetProfit: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$platformProfit', 0] }, 0] 
                        } 
                    }
                }
            }
        ]),
        FoodOrder.aggregate([
            {
                $match: {
                    ...orderMatch,
                    createdAt: {
                        $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1),
                        $lte: new Date()
                    }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    orders: { $sum: 1 },
                    revenue: { 
                        $sum: { 
                            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, { $ifNull: ['$pricing.total', 0] }, 0] 
                        } 
                    },
                    commission: {
                        $sum: {
                            $cond: [
                                { $eq: ['$orderStatus', 'delivered'] },
                                { $ifNull: ['$platformProfit', { $ifNull: ['$pricing.platformFee', 0] }] },
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]),
        FoodRestaurant.countDocuments({ ...restaurantMatch, status: 'approved' }),
        FoodRestaurant.countDocuments({ ...restaurantMatch, status: 'pending' }),
        FoodDeliveryPartner.countDocuments({ status: 'approved' }),
        FoodDeliveryPartner.countDocuments({ status: 'pending' }),
        FoodItem.countDocuments({ approvalStatus: 'approved', ...zoneScopedRestaurantMatch }),
        FoodAddon.countDocuments({ approvalStatus: 'approved', isDeleted: { $ne: true }, ...zoneScopedRestaurantMatch }),
        zoneId
            ? FoodOrder.distinct('userId', { ...orderMatch, userId: { $ne: null } }).then((ids) => ids.length)
            : FoodUser.countDocuments({}),
        FoodRestaurant.find({ ...restaurantMatch, status: 'pending' }).sort({ createdAt: -1 }).limit(5).select('restaurantName createdAt').lean(),
        FoodDeliveryPartner.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(5).select('name createdAt').lean(),
        FoodOrder.find({ 
            ...orderMatch,
            orderStatus: { $in: PENDING_ORDER_STATUSES },
        }).sort({ createdAt: -1 }).limit(5).select('orderId createdAt').lean(),
        FoodOrder.find({ ...orderMatch, orderStatus: 'delivered' }).sort({ updatedAt: -1 }).limit(5).select('orderId updatedAt').lean(),
        FoodOrder.find({ 
            ...orderMatch,
            orderStatus: { $in: CANCELLED_ORDER_STATUSES },
        }).sort({ updatedAt: -1 }).limit(5).select('orderId updatedAt').lean(),
        zoneId
            ? FoodOrder.aggregate([
                { $match: { ...orderMatch, userId: { $ne: null } } },
                { $sort: { createdAt: -1 } },
                {
                    $group: {
                        _id: '$userId',
                        createdAt: { $first: '$createdAt' }
                    }
                },
                { $sort: { createdAt: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: 'food_users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: '$user' },
                {
                    $project: {
                        _id: '$user._id',
                        name: '$user.name',
                        createdAt: 1
                    }
                }
            ])
            : FoodUser.find({}).sort({ createdAt: -1 }).limit(5).select('name createdAt').lean()
    ]);

    const liveSignals = [];
    
    (recentPendingRestaurants || []).forEach(r => {
        liveSignals.push({
            type: 'restaurant',
            title: 'New Restaurant Request',
            detail: `${r.restaurantName} is waiting for approval`,
            time: formatTimeAgo(r.createdAt),
            timestamp: r.createdAt
        });
    });

    (recentPendingDelivery || []).forEach(d => {
        liveSignals.push({
            type: 'delivery',
            title: 'New Delivery Partner',
            detail: `${d.name} requested to join`,
            time: formatTimeAgo(d.createdAt),
            timestamp: d.createdAt
        });
    });

    (recentPendingOrders || []).forEach(o => {
        liveSignals.push({
            type: 'order_pending',
            title: 'New Order Received',
            detail: `Order #${o.orderId} is pending`,
            time: formatTimeAgo(o.createdAt),
            timestamp: o.createdAt
        });
    });

    (recentDeliveredOrders || []).forEach(o => {
        liveSignals.push({
            type: 'order_delivered',
            title: 'Order Delivered',
            detail: `Order #${o.orderId} was successful`,
            time: formatTimeAgo(o.updatedAt),
            timestamp: o.updatedAt
        });
    });

    (recentCancelledOrders || []).forEach(o => {
        liveSignals.push({
            type: 'order_cancelled',
            title: 'Order Cancelled',
            detail: `Order #${o.orderId} was cancelled`,
            time: formatTimeAgo(o.updatedAt),
            timestamp: o.updatedAt
        });
    });

    (recentCustomers || []).forEach(c => {
        liveSignals.push({
            type: 'customer',
            title: 'New Customer',
            detail: `${c.name} just registered`,
            time: formatTimeAgo(c.createdAt),
            timestamp: c.createdAt
        });
    });

    // Sort by timestamp and take top 15
    liveSignals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const finalLiveSignals = liveSignals.slice(0, 15);

    const totals = orderTotalsAgg?.[0] || {};

    const now = new Date();
    const monthlyMap = new Map(
        (monthlyAgg || []).map((row) => {
            const key = `${row._id?.year}-${row._id?.month}`;
            return [key, row];
        })
    );

    const monthlyData = [];
    for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const key = `${year}-${month}`;
        const row = monthlyMap.get(key);
        monthlyData.push({
            month: formatMonthShort(year, month - 1),
            orders: Number(row?.orders || 0),
            revenue: Number(row?.revenue || 0),
            commission: Number(row?.commission || 0)
        });
    }

    return {
        orders: {
            total: Number(totals.totalOrders || 0),
            byStatus: {
                delivered: Number(totals.delivered || 0),
                cancelled: Number(totals.cancelled || 0),
                pending: Number(totals.pending || 0)
            }
        },
        revenue: { total: Number(totals.revenueTotal || 0) },
        commission: { total: Number(totals.commissionTotal || 0) },
        platformFee: { total: Number(totals.platformFeeTotal || 0) },
        deliveryFee: { total: Number(totals.deliveryFeeTotal || 0) },
        gst: { total: Number(totals.gstTotal || 0) },
        totalAdminEarnings: Number(totals.adminNetProfit || 0) + Number(totals.gstTotal || 0),
        deliveryProfit: Number(totals.adminNetProfit || 0) - Number(totals.commissionTotal || 0) - Number(totals.platformFeeTotal || 0),
        restaurants: {
            total: Number(restaurantsTotal || 0),
            pendingRequests: Number(restaurantsPending || 0)
        },
        deliveryBoys: {
            total: Number(deliveryTotal || 0),
            pendingRequests: Number(deliveryPending || 0)
        },
        foods: { total: Number(foodsTotal || 0) },
        addons: { total: Number(addonsTotal || 0) },
        customers: { total: Number(customersTotal || 0) },
        orderStats: {
            pending: Number(totals.pending || 0),
            completed: Number(totals.delivered || 0)
        },
        monthlyData,
        liveSignals: finalLiveSignals
    };
}

function formatTimeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + ' years ago';
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + ' months ago';
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + ' days ago';
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + ' hours ago';
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + ' minutes ago';
    return Math.floor(seconds) + ' seconds ago';
}


export async function getTransactionReport(query = {}) {
    const { fromDate, toDate, zone, restaurant, search } = query;
    const match = {};

    if (fromDate && toDate) {
        match.createdAt = { $gte: new Date(fromDate), $lte: new Date(toDate) };
    }

    if (search) {
        const searchRegex = new RegExp(String(search).trim(), "i");
        const matchingOrders = await FoodOrder.find({ orderId: { $regex: searchRegex } })
            .select('_id')
            .lean();

        match.$or = [
            { orderReadableId: { $regex: searchRegex } },
            { orderId: { $in: matchingOrders.map((order) => order._id) } }
        ];
    }

    if (zone || restaurant) {
        const restFilter = {};

        if (zone) {
            const zoneRaw = String(zone).trim();
            if (zoneRaw) {
                if (mongoose.Types.ObjectId.isValid(zoneRaw)) {
                    restFilter.zoneId = new mongoose.Types.ObjectId(zoneRaw);
                } else {
                    const matchedZone = await QCZone.findOne({
                        $or: [{ name: zoneRaw }, { zoneName: zoneRaw }]
                    })
                        .select('_id')
                        .lean();
                    if (matchedZone?._id) {
                        restFilter.zoneId = matchedZone._id;
                    } else {
                        match.restaurantId = { $in: [] };
                    }
                }
            }
        }

        if (restaurant && restaurant !== 'All restaurants') {
            const restaurantRaw = String(restaurant).trim();
            if (restaurantRaw) {
                let restDoc = null;
                if (mongoose.Types.ObjectId.isValid(restaurantRaw)) {
                    restDoc = await mongoose
                        .model('FoodRestaurant')
                        .findById(restaurantRaw)
                        .select('_id')
                        .lean();
                } else {
                    restDoc = await mongoose.model('QCRestaurant').findOne({
                        $or: [{ restaurantName: restaurantRaw }, { name: restaurantRaw }]
                    })
                        .select('_id')
                        .lean();
                }
                if (restDoc?._id) {
                    restFilter._id = restDoc._id;
                } else {
                    match.restaurantId = { $in: [] };
                }
            }
        }

        if (!match.restaurantId && Object.keys(restFilter).length > 0) {
            const restaurantsList = await mongoose
                .model('FoodRestaurant')
                .find(restFilter)
                .select('_id')
                .lean();
            match.restaurantId = { $in: restaurantsList.map((r) => r._id) };
        }
    }

    // Include only resolved transactions for reports (or all to match orders)
    // We will query the FoodTransaction table directly as it is the ledger
    const transactionRows = await FoodTransaction.find(match)
        .populate('orderId')
        .populate('userId', 'name')
        .populate('restaurantId', 'restaurantName')
        .sort({ createdAt: -1 })
        .lean();

    const transactions = transactionRows.map((tx) => {
        const order = tx.orderId || {};
        const pricing = order.pricing || {};
        const subtotal = Number(pricing.subtotal || 0) || 0;
        const packagingFee = Number(pricing.packagingFee || 0) || 0;
        const deliveryFee = Number(pricing.deliveryFee || 0) || 0;
        const tax = Number(pricing.tax || 0) || 0;
        const discount = Number(pricing.discount || 0) || 0;
        const total = Number(pricing.total || 0) || 0;

        // "Platform fee" should come from pricing.platformFee when available.
        // For older orders where pricing.platformFee isn't stored, derive it from the pricing equation:
        // total = subtotal + packagingFee + deliveryFee + platformFee + tax - discount
        const platformFeeDerived = Math.max(
            0,
            total - subtotal - packagingFee - deliveryFee - tax + discount
        );
        const platformFee =
            pricing.platformFee !== undefined && pricing.platformFee !== null
                ? Number(pricing.platformFee || 0) || 0
                : platformFeeDerived;
        return {
            id: tx._id,
            orderId: tx.orderReadableId || order.orderId || 'N/A',
            restaurant: tx.restaurantId?.restaurantName || 'N/A',
            customerName: tx.userId?.name || 'Guest',
            totalItemAmount: subtotal,
            itemDiscount: pricing.discount || 0,
            couponDiscount: pricing.discount || 0,
            adminDiscountShare: Number(tx.amounts?.adminDiscountShare || 0),
            restaurantDiscountShare: Number(tx.amounts?.restaurantDiscountShare || 0),
            referralDiscount: 0, // Placeholder
            discountedAmount: Math.max(0, (pricing.subtotal || 0) - (pricing.discount || 0)),
            vatTax: tx.amounts?.taxAmount || pricing.tax || 0,
            deliveryCharge: pricing.deliveryFee || 0,
            platformFee,
            orderAmount: tx.amounts?.totalCustomerPaid || pricing.total || 0,
            status: tx.status
        };
    });

    let completedTransaction = 0;
    let refundedTransaction = 0;
    let adminEarning = 0;
    let restaurantEarning = 0;
    let deliverymanEarning = 0;

    for (const tx of transactionRows) {
        // Calculate Summary
        if (tx.status === 'captured' || tx.status === 'settled' || (tx.orderId && tx.orderId.orderStatus === 'delivered')) {
            completedTransaction += tx.amounts?.totalCustomerPaid || 0;
            adminEarning += tx.amounts?.platformNetProfit || 0;
            restaurantEarning += tx.amounts?.restaurantShare || 0;
            deliverymanEarning += tx.amounts?.riderShare || 0;
        }
        if (tx.status === 'refunded' || (tx.orderId && tx.orderId.orderStatus === 'cancelled_by_admin')) {
            // Count number of refunded transactions according to old logic or sum them
            refundedTransaction += tx.amounts?.totalCustomerPaid || 0;
        }
    }

    const summary = {
        completedTransaction,
        refundedTransaction, // Returning amount instead of count for consistency, frontend might expect count though
        adminEarning,
        restaurantEarning,
        deliverymanEarning,
    };

    return { transactions, summary };
}

export async function getRestaurantReport(query = {}) {
    const parseTimeRange = (timeLabel) => {
        const now = new Date();
        const start = new Date(now);
        const end = new Date(now);

        const value = String(timeLabel || '').trim().toLowerCase();
        if (!value || value === 'all time') return null;

        if (value === 'today') {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        if (value === 'this week') {
            const day = start.getDay(); // 0=Sun
            const diffToMonday = day === 0 ? 6 : day - 1;
            start.setDate(start.getDate() - diffToMonday);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        if (value === 'this month') {
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        if (value === 'this year') {
            start.setMonth(0, 1);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return { $gte: start, $lte: end };
        }

        return null;
    };

    const formatCurrency = (value) => `\u20B9${Number(value || 0).toFixed(2)}`;

    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 5000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const restaurantFilter = {};
    const allFilter = String(query.all || '').trim().toLowerCase();
    if (allFilter === 'active') {
        restaurantFilter.status = 'approved';
    } else if (allFilter === 'inactive') {
        restaurantFilter.status = { $ne: 'approved' };
    }

    const zoneRaw = String(query.zone || '').trim();
    if (zoneRaw) {
        if (mongoose.Types.ObjectId.isValid(zoneRaw)) {
            restaurantFilter.zoneId = new mongoose.Types.ObjectId(zoneRaw);
        } else {
            const matchedZone = await QCZone.findOne({
                $or: [{ name: zoneRaw }, { zoneName: zoneRaw }]
            })
                .select('_id')
                .lean();
            if (matchedZone?._id) {
                restaurantFilter.zoneId = matchedZone._id;
            } else {
                return { restaurants: [], total: 0, page, limit };
            }
        }
    }

    const typeRaw = String(query.type || '').trim().toLowerCase();
    if (typeRaw === 'commission') {
        const commissionRows = await FoodRestaurantCommission.find({ status: { $ne: false } })
            .select('restaurantId')
            .lean();
        const commissionRestaurantIds = commissionRows
            .map((row) => row?.restaurantId)
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));

        if (!commissionRestaurantIds.length) {
            return { restaurants: [], total: 0, page, limit };
        }
        restaurantFilter._id = { $in: commissionRestaurantIds };
    }

    const searchRaw = String(query.search || '').trim();
    if (searchRaw) {
        const escaped = searchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        restaurantFilter.$or = [
            { restaurantName: { $regex: escaped, $options: 'i' } },
            { ownerName: { $regex: escaped, $options: 'i' } },
            { ownerPhone: { $regex: escaped, $options: 'i' } },
            { city: { $regex: escaped, $options: 'i' } },
            { area: { $regex: escaped, $options: 'i' } }
        ];
    }

    const [restaurantDocs, total] = await Promise.all([
        FoodRestaurant.find(restaurantFilter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('restaurantName profileImage rating totalRatings status zoneId')
            .populate('zoneId', 'name zoneName')
            .lean(),
        FoodRestaurant.countDocuments(restaurantFilter)
    ]);

    const restaurantIds = restaurantDocs.map((r) => r._id).filter(Boolean);
    if (!restaurantIds.length) {
        return { restaurants: [], total, page, limit };
    }

    const orderCreatedAtFilter = (() => {
        if (query.fromDate || query.toDate) {
            const createdAt = {};
            if (query.fromDate) {
                createdAt.$gte = new Date(query.fromDate);
            }
            if (query.toDate) {
                createdAt.$lte = new Date(query.toDate);
            }
            return Object.keys(createdAt).length ? createdAt : null;
        }
        return parseTimeRange(query.time);
    })();
    const orderMatch = {
        restaurantId: { $in: restaurantIds },
        $or: [
            { "payment.method": { $in: ["cash", "wallet"] } },
            { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
        ],
    };
    if (orderCreatedAtFilter) {
        orderMatch.createdAt = orderCreatedAtFilter;
    }

    const [foodsAgg, ordersAgg] = await Promise.all([
        FoodItem.aggregate([
            {
                $match: {
                    restaurantId: { $in: restaurantIds },
                    approvalStatus: 'approved'
                }
            },
            {
                $group: {
                    _id: '$restaurantId',
                    totalFood: { $sum: 1 }
                }
            }
        ]),
        FoodOrder.aggregate([
            { $match: orderMatch },
            {
                $group: {
                    _id: '$restaurantId',
                    totalOrder: { $sum: 1 },
                    totalOrderAmount: { $sum: { $ifNull: ['$pricing.total', 0] } },
                    totalDiscountGiven: { $sum: { $ifNull: ['$pricing.discount', 0] } },
                    totalVATTAX: { $sum: { $ifNull: ['$pricing.tax', 0] } },
                    totalAdminCommissionFromPlatformProfit: { $sum: { $ifNull: ['$platformProfit', 0] } },
                    totalAdminCommissionFromPlatformFee: { $sum: { $ifNull: ['$pricing.platformFee', 0] } }
                }
            }
        ])
    ]);

    const foodMap = new Map(foodsAgg.map((x) => [String(x._id), Number(x.totalFood || 0)]));
    const orderMap = new Map(
        ordersAgg.map((x) => [
            String(x._id),
            {
                totalOrder: Number(x.totalOrder || 0),
                totalOrderAmount: Number(x.totalOrderAmount || 0),
                totalDiscountGiven: Number(x.totalDiscountGiven || 0),
                totalVATTAX: Number(x.totalVATTAX || 0),
                totalAdminCommission:
                    Number(x.totalAdminCommissionFromPlatformProfit || 0) > 0
                        ? Number(x.totalAdminCommissionFromPlatformProfit || 0)
                        : Number(x.totalAdminCommissionFromPlatformFee || 0)
            }
        ])
    );

    const restaurants = restaurantDocs.map((restaurant, index) => {
        const key = String(restaurant._id);
        const counts = orderMap.get(key) || {
            totalOrder: 0,
            totalOrderAmount: 0,
            totalDiscountGiven: 0,
            totalVATTAX: 0,
            totalAdminCommission: 0
        };

        return {
            _id: restaurant._id,
            sl: skip + index + 1,
            icon: restaurant.profileImage || '',
            restaurantName: restaurant.restaurantName || '',
            totalFood: foodMap.get(key) || 0,
            totalOrder: counts.totalOrder,
            totalOrderAmount: formatCurrency(counts.totalOrderAmount),
            totalDiscountGiven: formatCurrency(counts.totalDiscountGiven),
            totalAdminCommission: formatCurrency(counts.totalAdminCommission),
            totalVATTAX: formatCurrency(counts.totalVATTAX),
            averageRatings: Number(restaurant.rating || 0),
            reviews: Number(restaurant.totalRatings || 0),
            status: restaurant.status || 'pending',
            zoneName: restaurant.zoneId?.name || restaurant.zoneId?.zoneName || ''
        };
    });

    return { restaurants, total, page, limit };
}

function buildTaxReportDateMatch(fromDate, toDate) {
    const createdAt = {};
    if (fromDate) {
        createdAt.$gte = new Date(fromDate);
    }
    if (toDate) {
        const end = new Date(toDate);
        if (!Number.isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            createdAt.$lte = end;
        }
    }
    return Object.keys(createdAt).length > 0 ? createdAt : null;
}

function normalizeTaxReportCalculateTax(value) {
    return String(value || 'percentage').toLowerCase().replace(/\s+/g, '_');
}

function shouldRecalculateTaxAtRate(taxRate, calculateTax) {
    const rate = Number(taxRate);
    return (
        Number.isFinite(rate) &&
        rate > 0 &&
        normalizeTaxReportCalculateTax(calculateTax) === 'percentage'
    );
}

function buildOrderTaxAmountExpression(taxRate, calculateTax) {
    if (shouldRecalculateTaxAtRate(taxRate, calculateTax)) {
        const rate = Number(taxRate) / 100;
        return {
            $round: [
                {
                    $multiply: [
                        {
                            $max: [
                                0,
                                {
                                    $subtract: [
                                        { $ifNull: ['$pricing.subtotal', 0] },
                                        { $ifNull: ['$pricing.discount', 0] }
                                    ]
                                }
                            ]
                        },
                        rate
                    ]
                },
                0
            ]
        };
    }
    return { $ifNull: ['$pricing.tax', 0] };
}

function computeOrderTaxAmount(pricing = {}, taxRate, calculateTax) {
    if (shouldRecalculateTaxAtRate(taxRate, calculateTax)) {
        const rate = Number(taxRate) / 100;
        const taxableBase = Math.max(
            0,
            (Number(pricing.subtotal) || 0) - (Number(pricing.discount) || 0)
        );
        return Math.round(taxableBase * rate);
    }
    return Number(pricing.tax) || 0;
}

async function loadOffersByRestaurantIds(restaurantIds = []) {
    const uniqueIds = [...new Set(
        (restaurantIds || [])
            .map((id) => String(id || '').trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    )];
    if (!uniqueIds.length) return new Map();

    const objectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));
    const offers = await FoodOffer.find({
        $or: [
            { restaurantScope: { $ne: 'selected' } },
            { restaurantId: { $in: objectIds } },
            { restaurantIds: { $in: objectIds } },
        ],
    }).lean();

    const offersByRestaurantId = new Map();
    for (const restaurantId of uniqueIds) {
        const scopedOffers = offers.filter((offer) => {
            if (offer?.restaurantScope !== 'selected') return true;
            const selectedIds = Array.isArray(offer.restaurantIds) && offer.restaurantIds.length > 0
                ? offer.restaurantIds
                : [offer.restaurantId].filter(Boolean);
            return selectedIds.some((id) => String(id) === restaurantId);
        });
        offersByRestaurantId.set(restaurantId, scopedOffers);
    }
    return offersByRestaurantId;
}

async function summarizeRestaurantEarningsForTaxReport(orders = [], { taxRate, calculateTax } = {}) {
    const earnedOrders = (orders || []).filter(isRestaurantEarnedOrder);
    if (!earnedOrders.length) {
        return { grouped: new Map(), totalEarnings: 0, totalTax: 0 };
    }

    const orderIds = earnedOrders.map((order) => order._id);
    const restaurantIds = earnedOrders.map((order) => order.restaurantId);
    const [transactions, offersByRestaurantId] = await Promise.all([
        FoodTransaction.find({ orderId: { $in: orderIds } })
            .select('orderId pricing amounts')
            .lean(),
        loadOffersByRestaurantIds(restaurantIds),
    ]);
    const txByOrderId = new Map(transactions.map((tx) => [String(tx.orderId), tx]));

    const grouped = new Map();
    let totalEarnings = 0;
    let totalTax = 0;

    for (const order of earnedOrders) {
        const restaurantId = String(order.restaurantId);
        const tx = txByOrderId.get(String(order._id));
        const pricing = tx?.pricing || order.pricing || {};
        const offers = offersByRestaurantId.get(restaurantId) || [];
        const earnings = computeRestaurantOrderShare(order, tx, offers, restaurantId);
        const taxAmount = computeOrderTaxAmount(pricing, taxRate, calculateTax);

        if (!grouped.has(restaurantId)) {
            grouped.set(restaurantId, { totalEarnings: 0, totalTax: 0, orderCount: 0 });
        }
        const bucket = grouped.get(restaurantId);
        bucket.totalEarnings += earnings;
        bucket.totalTax += taxAmount;
        bucket.orderCount += 1;
        totalEarnings += earnings;
        totalTax += taxAmount;
    }

    return { grouped, totalEarnings, totalTax };
}

export async function getTaxReport(query = {}) {
    const { fromDate, toDate, search, taxRate, calculateTax } = query;
    const match = {
        orderStatus: { $nin: ['pending_payment'] },
    };

    const createdAt = buildTaxReportDateMatch(fromDate, toDate);
    if (createdAt) {
        match.createdAt = createdAt;
    }

    if (search) {
        match.orderId = { $regex: search, $options: 'i' };
    }

    const orders = await FoodOrder.find(match)
        .select('restaurantId orderStatus status deliveryState pricing createdAt orderId')
        .lean();

    const { grouped, totalEarnings, totalTax } = await summarizeRestaurantEarningsForTaxReport(
        orders,
        { taxRate, calculateTax },
    );

    const restaurantObjectIds = [...grouped.keys()]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    const restaurants = restaurantObjectIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantObjectIds } })
            .select('restaurantName')
            .lean()
        : [];
    const restaurantNameById = new Map(restaurants.map((row) => [String(row._id), row.restaurantName]));

    const taxData = [...grouped.entries()]
        .map(([restaurantId, item]) => ({
            _id: restaurantId,
            incomeSource: restaurantNameById.get(restaurantId) || 'Unknown Restaurant',
            totalIncome: item.totalEarnings,
            totalTax: item.totalTax,
            orderCount: item.orderCount,
        }))
        .sort((a, b) => b.totalTax - a.totalTax);

    const reports = taxData.map((item, index) => ({
        sl: index + 1,
        id: item._id,
        incomeSource: item.incomeSource,
        totalIncome: `\u20B9${item.totalIncome.toFixed(2)}`,
        totalTax: `\u20B9${item.totalTax.toFixed(2)}`,
        orderCount: item.orderCount,
    }));

    return {
        reports,
        stats: {
            totalIncome: `\u20B9${totalEarnings.toFixed(2)}`,
            totalTax: `\u20B9${totalTax.toFixed(2)}`,
        },
    };
}

export async function getTaxReportDetail(restaurantId, query = {}) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Invalid restaurant ID');
    }

    const { fromDate, toDate, taxRate, calculateTax } = query;
    const match = {
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        orderStatus: { $nin: ['pending_payment'] },
    };

    const createdAt = buildTaxReportDateMatch(fromDate, toDate);
    if (createdAt) {
        match.createdAt = createdAt;
    }

    const orders = await FoodOrder.find(match)
        .select('orderId orderStatus status deliveryState pricing createdAt restaurantId')
        .sort({ createdAt: -1 })
        .lean();

    const earnedOrders = orders.filter(isRestaurantEarnedOrder);
    const orderIds = earnedOrders.map((order) => order._id);
    const [transactions, offers] = await Promise.all([
        orderIds.length
            ? FoodTransaction.find({ orderId: { $in: orderIds } })
                .select('orderId pricing amounts')
                .lean()
            : [],
        loadOffersByRestaurantIds([restaurantId]).then((map) => map.get(String(restaurantId)) || []),
    ]);
    const txByOrderId = new Map(transactions.map((tx) => [String(tx.orderId), tx]));

    const restaurant = await FoodRestaurant.findById(restaurantId).select('restaurantName').lean();

    return {
        restaurantName: restaurant?.restaurantName || 'Unknown Restaurant',
        orders: earnedOrders.map((order) => {
            const tx = txByOrderId.get(String(order._id));
            const pricing = tx?.pricing || order.pricing || {};
            const earnings = computeRestaurantOrderShare(order, tx, offers, restaurantId);
            const taxAmount = computeOrderTaxAmount(pricing, taxRate, calculateTax);
            return {
                id: order._id,
                orderId: order.orderId,
                totalAmount: `\u20B9${earnings.toFixed(2)}`,
                taxAmount: `\u20B9${taxAmount.toFixed(2)}`,
                date: order.createdAt,
            };
        }),
    };
}

// ----- Customers / Users (admin) -----
export async function getCustomers(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { role: 'USER' };

    if (query.status) {
        if (String(query.status) === 'active') filter.isActive = true;
        if (String(query.status) === 'inactive') filter.isActive = false;
    }

    if (query.joiningDate && String(query.joiningDate).trim()) {
        const d = new Date(String(query.joiningDate));
        if (!Number.isNaN(d.getTime())) {
            const start = new Date(d);
            start.setHours(0, 0, 0, 0);
            const end = new Date(d);
            end.setHours(23, 59, 59, 999);
            filter.createdAt = { $gte: start, $lte: end };
        }
    }

    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { email: { $regex: term, $options: 'i' } },
            { phone: { $regex: term, $options: 'i' } }
        ];
    }

    const sort = {};
    const sortBy = String(query.sortBy || '').trim();
    const needsOrderSort = sortBy === 'orders-asc' || sortBy === 'orders-desc';
    if (sortBy === 'name-asc') sort.name = 1;
    else if (sortBy === 'name-desc') sort.name = -1;
    else if (!needsOrderSort) sort.createdAt = -1;

    let docs = [];
    let total = 0;

    if (needsOrderSort) {
        const orderDir = sortBy === 'orders-asc' ? 1 : -1;
        [docs, total] = await Promise.all([
            FoodUser.aggregate([
                { $match: filter },
                {
                    $lookup: {
                        from: 'food_orders',
                        let: { uid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$userId', '$$uid'] },
                                    orderStatus: 'delivered',
                                },
                            },
                            { $project: { total: { $ifNull: ['$pricing.total', 0] } } },
                        ],
                        as: 'deliveredOrders',
                    },
                },
                {
                    $addFields: {
                        totalOrder: { $size: '$deliveredOrders' },
                        totalOrderAmount: { $sum: '$deliveredOrders.total' },
                    },
                },
                { $sort: { totalOrder: orderDir, createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
                {
                    $project: {
                        name: 1,
                        email: 1,
                        phone: 1,
                        countryCode: 1,
                        isVerified: 1,
                        isActive: 1,
                        createdAt: 1,
                        profileImage: 1,
                        totalOrder: 1,
                        totalOrderAmount: 1,
                    },
                },
            ]),
            FoodUser.countDocuments(filter),
        ]);
    } else {
        [docs, total] = await Promise.all([
            FoodUser.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .select('name email phone countryCode isVerified isActive createdAt profileImage')
                .lean(),
            FoodUser.countDocuments(filter),
        ]);
    }

    const sanitizeUrl = (s) => {
        if (!s) return '';
        const str = String(s).trim();
        return str.replace(/^`+|`+$/g, '').trim();
    };

    const userIds = needsOrderSort ? [] : docs.map((u) => u._id).filter(Boolean);
    const orderStats = userIds.length > 0
        ? await FoodOrder.aggregate([
            {
                $match: {
                    userId: { $in: userIds },
                    orderStatus: 'delivered'
                }
            },
            {
                $group: {
                    _id: '$userId',
                    totalOrder: { $sum: 1 },
                    totalOrderAmount: { $sum: { $ifNull: ['$pricing.total', 0] } }
                }
            }
        ])
        : [];

    const orderStatsMap = new Map(
        orderStats.map((x) => [
            String(x._id),
            {
                totalOrder: Number(x.totalOrder || 0),
                totalOrderAmount: Number(x.totalOrderAmount || 0)
            }
        ])
    );

    let customers = docs.map((u) => {
        const stats = needsOrderSort
            ? {
                totalOrder: Number(u.totalOrder || 0),
                totalOrderAmount: Number(u.totalOrderAmount || 0),
            }
            : orderStatsMap.get(String(u._id)) || { totalOrder: 0, totalOrderAmount: 0 };
        return ({
        id: u._id,
        _id: u._id,
        name: u.name || 'Unnamed',
        email: u.email || '',
        phone: u.phone || '',
        profileImage: sanitizeUrl(u.profileImage || ''),
        countryCode: u.countryCode || '+91',
        status: u.isActive !== false,
        isActive: u.isActive !== false,
        isVerified: u.isVerified === true,
        totalOrder: stats.totalOrder,
        totalOrderAmount: stats.totalOrderAmount,
        joiningDate: u.createdAt,
        createdAt: u.createdAt
        });
    });

    const chooseFirst = parseInt(query.chooseFirst, 10);
    if (Number.isFinite(chooseFirst) && chooseFirst > 0) {
        customers = customers.slice(0, chooseFirst);
    }

    return { customers, total, page, limit };
}

export async function getCustomerById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const u = await FoodUser.findById(id).select('-__v').lean();
    if (!u) return null;
    const customerObjectId = new mongoose.Types.ObjectId(id);
    const orderStats = await FoodOrder.aggregate([
        {
            $match: {
                userId: customerObjectId,
                orderStatus: 'delivered'
            }
        },
        {
            $group: {
                _id: '$userId',
                totalOrders: { $sum: 1 },
                totalOrderAmount: { $sum: { $ifNull: ['$pricing.total', 0] } }
            }
        }
    ]);
    const stats = orderStats?.[0] || {};
    const sanitizeUrl = (s) => {
        if (!s) return '';
        const str = String(s).trim();
        return str.replace(/^`+|`+$/g, '').trim();
    };
    return {
        id: u._id,
        _id: u._id,
        name: u.name || 'Unnamed',
        email: u.email || '',
        phone: u.phone || '',
        profileImage: sanitizeUrl(u.profileImage || ''),
        countryCode: u.countryCode || '+91',
        status: u.isActive !== false,
        isActive: u.isActive !== false,
        isVerified: u.isVerified === true,
        totalOrders: Number(stats.totalOrders || 0),
        totalOrder: Number(stats.totalOrders || 0),
        totalOrderAmount: Number(stats.totalOrderAmount || 0),
        joiningDate: u.createdAt,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
    };
}

export async function updateCustomerStatus(id, isActive) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updatedDoc = await FoodUser.findByIdAndUpdate(
        id,
        { $set: { isActive: Boolean(isActive) } },
        { new: true }
    );
    if (!updatedDoc) return null;
    const updated = updatedDoc.toObject();
    if (updated.isActive === false) {
        await FoodRefreshToken.deleteMany({ userId: updated._id });
    }
    return updated;
}

export async function getSupportTickets(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const source = String(query.source || 'all').toLowerCase();
    const search = String(query.search || '').trim();
    const type = query.type ? String(query.type) : '';
    const category = query.category ? String(query.category) : '';

    const userFilter = {};
    const restaurantFilter = {};
    if (query.status && ['open', 'in-progress', 'resolved'].includes(String(query.status))) {
        userFilter.status = String(query.status);
        restaurantFilter.status = String(query.status);
    }
    if (type && ['order', 'restaurant', 'other'].includes(type)) {
        userFilter.type = type;
    }
    if (category && ['orders', 'payments', 'menu', 'restaurant', 'technical', 'other'].includes(category)) {
        restaurantFilter.category = category;
    }

    const userSearchOr = [];
    const restaurantSearchOr = [];
    if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        userSearchOr.push(
            { issueType: searchRegex },
            { description: searchRegex }
        );
        restaurantSearchOr.push(
            { issueType: searchRegex },
            { subject: searchRegex },
            { description: searchRegex },
            { orderRef: searchRegex }
        );
        const [restaurantIds, userIds, orderIds] = await Promise.all([
            FoodRestaurant.find({ restaurantName: searchRegex }).select('_id').lean(),
            FoodUser.find({ name: searchRegex }).select('_id').lean(),
            FoodOrder.find({ orderId: searchRegex }).select('_id').lean()
        ]);
        if (restaurantIds.length) {
            const ids = restaurantIds.map((r) => r._id);
            userSearchOr.push({ restaurantId: { $in: ids } });
            restaurantSearchOr.push({ restaurantId: { $in: ids } });
        }
        if (userIds.length) {
            userSearchOr.push({ userId: { $in: userIds.map((u) => u._id) } });
        }
        if (orderIds.length) {
            userSearchOr.push({ orderId: { $in: orderIds.map((o) => o._id) } });
        }
        if (mongoose.Types.ObjectId.isValid(search)) {
            userSearchOr.push({ _id: new mongoose.Types.ObjectId(search) });
            restaurantSearchOr.push({ _id: new mongoose.Types.ObjectId(search) });
        }
    }
    if (userSearchOr.length) userFilter.$or = userSearchOr;
    if (restaurantSearchOr.length) restaurantFilter.$or = restaurantSearchOr;

    const shouldFetchUser = source === 'all' || source === 'user';
    const shouldFetchRestaurant =
        (source === 'all' || source === 'restaurant') && !type;

    const fetchCap = source === 'all' ? skip + limit : limit;
    const fetchSkip = source === 'all' ? 0 : skip;

    const [userList, userTotal, restaurantList, restaurantTotal] = await Promise.all([
        shouldFetchUser
            ? FoodSupportTicket.find(userFilter)
                  .sort({ createdAt: -1 })
                  .skip(fetchSkip)
                  .limit(fetchCap)
                  .populate('userId', 'name phone email')
                  .populate('restaurantId', 'restaurantName city area')
                  .populate({
                      path: 'orderId',
                      select: 'restaurantId',
                      populate: { path: 'restaurantId', select: 'restaurantName city area' }
                  })
                  .lean()
            : Promise.resolve([]),
        shouldFetchUser ? FoodSupportTicket.countDocuments(userFilter) : Promise.resolve(0),
        shouldFetchRestaurant
            ? FoodRestaurantSupportTicket.find(restaurantFilter)
                  .sort({ createdAt: -1 })
                  .skip(fetchSkip)
                  .limit(fetchCap)
                  .populate('restaurantId', 'restaurantName city area')
                  .lean()
            : Promise.resolve([]),
        shouldFetchRestaurant ? FoodRestaurantSupportTicket.countDocuments(restaurantFilter) : Promise.resolve(0)
    ]);

    const mappedUserTickets = userList.map((t) => {
        const user =
            t.userId && typeof t.userId === 'object' && t.userId !== null
                ? {
                      _id: t.userId._id,
                      name: t.userId.name || '',
                      phone: t.userId.phone || '',
                      email: t.userId.email || ''
                  }
                : null;
        const userId =
            t.userId && typeof t.userId === 'object' && t.userId !== null ? String(t.userId._id) : String(t.userId);

        let restaurantDoc = null;
        if (t.restaurantId && typeof t.restaurantId === 'object' && t.restaurantId !== null) {
            restaurantDoc = t.restaurantId;
        } else if (t.orderId && typeof t.orderId === 'object' && t.orderId !== null) {
            const rid = t.orderId.restaurantId;
            if (rid && typeof rid === 'object' && rid !== null) {
                restaurantDoc = rid;
            }
        }

        const restaurant =
            restaurantDoc && typeof restaurantDoc === 'object'
                ? {
                      _id: restaurantDoc._id,
                      name: restaurantDoc.restaurantName || '',
                      city: restaurantDoc.city || '',
                      area: restaurantDoc.area || ''
                  }
                : null;

        const restaurantId =
            restaurant && restaurant._id
                ? String(restaurant._id)
                : t.restaurantId
                ? String(t.restaurantId)
                : t.orderId && typeof t.orderId === 'object' && t.orderId !== null && t.orderId.restaurantId
                ? String(t.orderId.restaurantId)
                : null;

        const restaurantName = restaurant ? restaurant.name : '';

        return {
            _id: t._id,
            source: 'user',
            userId,
            type: t.type,
            orderId: t.orderId || null,
            restaurantId,
            issueType: t.issueType,
            description: t.description,
            status: t.status,
            adminResponse: t.adminResponse,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            user,
            restaurant,
            restaurantName
        };
    });

    const mappedRestaurantTickets = restaurantList.map((t) => {
        const restaurant =
            t.restaurantId && typeof t.restaurantId === 'object'
                ? {
                      _id: t.restaurantId._id,
                      name: t.restaurantId.restaurantName || '',
                      city: t.restaurantId.city || '',
                      area: t.restaurantId.area || ''
                  }
                : null;
        const restaurantId =
            restaurant && restaurant._id ? String(restaurant._id) : t.restaurantId ? String(t.restaurantId) : null;
        return {
            _id: t._id,
            source: 'restaurant',
            userId: null,
            type: 'restaurant-support',
            category: t.category || 'other',
            orderId: null,
            orderRef: t.orderRef || '',
            restaurantId,
            issueType: t.issueType,
            subject: t.subject || '',
            description: t.description,
            priority: t.priority || 'medium',
            status: t.status,
            adminResponse: t.adminResponse,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            user: null,
            restaurant,
            restaurantName: restaurant ? restaurant.name : ''
        };
    });

    let tickets = [];
    let total = 0;
    if (source === 'user') {
        tickets = mappedUserTickets;
        total = userTotal;
    } else if (source === 'restaurant') {
        tickets = mappedRestaurantTickets;
        total = restaurantTotal;
    } else {
        const merged = [...mappedUserTickets, ...mappedRestaurantTickets].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        tickets = merged.slice(skip, skip + limit);
        total = userTotal + restaurantTotal;
    }

    return { tickets, total, page, limit };
}

export async function getFoodSupportTicketStats(query = {}) {
    const source = String(query.source || 'all').toLowerCase();
    const type = query.type ? String(query.type) : '';
    const category = query.category ? String(query.category) : '';

    const userFilter = {};
    const restaurantFilter = {};
    if (type && ['order', 'restaurant', 'other'].includes(type)) {
        userFilter.type = type;
    }
    if (category && ['orders', 'payments', 'menu', 'restaurant', 'technical', 'other'].includes(category)) {
        restaurantFilter.category = category;
    }

    const shouldFetchUser = source === 'all' || source === 'user';
    const shouldFetchRestaurant =
        (source === 'all' || source === 'restaurant') && !type;

    const countStatuses = async (model, filter) => {
        const [open, inProgress, resolved, total] = await Promise.all([
            model.countDocuments({ ...filter, status: 'open' }),
            model.countDocuments({ ...filter, status: 'in-progress' }),
            model.countDocuments({ ...filter, status: 'resolved' }),
            model.countDocuments(filter),
        ]);
        return { open, inProgress, resolved, total };
    };

    const empty = { open: 0, inProgress: 0, resolved: 0, total: 0 };
    const [userCounts, restaurantCounts] = await Promise.all([
        shouldFetchUser ? countStatuses(FoodSupportTicket, userFilter) : Promise.resolve(empty),
        shouldFetchRestaurant
            ? countStatuses(FoodRestaurantSupportTicket, restaurantFilter)
            : Promise.resolve(empty),
    ]);

    return {
        total: userCounts.total + restaurantCounts.total,
        open: userCounts.open + restaurantCounts.open,
        inProgress: userCounts.inProgress + restaurantCounts.inProgress,
        resolved: userCounts.resolved + restaurantCounts.resolved,
    };
}

export async function updateSupportTicket(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const source = String(body.source || 'user').toLowerCase();
    const set = {};
    if (body.status && ['open', 'in-progress', 'resolved'].includes(String(body.status))) {
        set.status = String(body.status);
    }
    if (typeof body.adminResponse === 'string') {
        set.adminResponse = body.adminResponse;
    }
    if (!Object.keys(set).length) return null;
    const model = source === 'restaurant' ? FoodRestaurantSupportTicket : FoodSupportTicket;
    const updated = await model.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();

    // Send notification if admin response was added
    if (updated && set.adminResponse) {
        const ownerType = source === 'restaurant' ? 'RESTAURANT' : 'USER';
        const ownerId = updated.restaurantId || updated.userId;

        if (ownerId) {
            await FoodNotification.create({
                ownerType,
                ownerId,
                title: 'Support Ticket Response',
                message: `Admin has responded to your ticket: "${updated.subject}"`,
                source: 'SUPPORT_RESPONSE',
                category: 'support',
                metadata: { ticketId: updated._id, source }
            }).catch(err => console.error('Error creating support notification:', err));

            // Also send push notification (FCM)
            await sendNotificationToOwner({
                ownerType,
                ownerId,
                payload: {
                    title: 'Support Ticket Response',
                    body: `Admin has responded to your ticket: "${updated.subject}"`,
                    data: {
                        type: 'SUPPORT_RESPONSE',
                        ticketId: String(updated._id),
                        source
                    }
                }
            }).catch(err => console.error('Error sending support push notification:', err));
        }
    }

    return updated || null;
}

// ----- Restaurant Commission (admin) -----
export async function getRestaurantCommissions() {
    const list = await FoodRestaurantCommission.find({})
        .sort({ createdAt: -1 })
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .lean();

    const commissions = list.map((c, index) => ({
        _id: c._id,
        sl: index + 1,
        restaurantId: c.restaurantId?._id ? String(c.restaurantId._id) : String(c.restaurantId),
        restaurantName: c.restaurantId?.restaurantName || '',
        restaurant: c.restaurantId?._id ? { _id: c.restaurantId._id, name: c.restaurantId.restaurantName } : null,
        defaultCommission: c.defaultCommission || { type: 'percentage', value: 0 },
        notes: c.notes || '',
        status: c.status !== false
    }));

    return { commissions };
}

export async function getRestaurantCommissionBootstrap() {
    const [commissionsData, restaurantsData] = await Promise.all([
        getRestaurantCommissions(),
        getRestaurants({ status: 'approved', limit: 1000, page: 1 })
    ]);

    const commissionByRestaurantId = new Set(
        (commissionsData.commissions || []).map((c) => String(c.restaurantId))
    );

    const restaurants = (restaurantsData.restaurants || []).map((r) => ({
        _id: r._id,
        name: r.restaurantName || r.name || '',
        restaurantId: r._id ? `REST${r._id.toString().slice(-6).padStart(6, '0')}` : '',
        ownerName: r.ownerName || '',
        hasCommissionSetup: commissionByRestaurantId.has(String(r._id))
    }));

    return { commissions: commissionsData.commissions || [], restaurants };
}

export async function getRestaurantCommissionById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurantCommission.findById(id)
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .lean();
    if (!doc) return null;
    return {
        _id: doc._id,
        restaurantId: doc.restaurantId?._id ? String(doc.restaurantId._id) : String(doc.restaurantId),
        restaurant: doc.restaurantId?._id ? { _id: doc.restaurantId._id, name: doc.restaurantId.restaurantName } : null,
        restaurantName: doc.restaurantId?.restaurantName || '',
        defaultCommission: doc.defaultCommission || { type: 'percentage', value: 0 },
        notes: doc.notes || '',
        status: doc.status !== false
    };
}

export async function createRestaurantCommission(body) {
    const exists = await FoodRestaurantCommission.findOne({ restaurantId: body.restaurantId }).lean();
    if (exists) {
        throw new ValidationError('Commission already exists for this restaurant');
    }
    const created = await FoodRestaurantCommission.create({
        restaurantId: body.restaurantId,
        defaultCommission: body.defaultCommission,
        notes: body.notes || '',
        status: true
    });
    return created.toObject();
}

export async function updateRestaurantCommission(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updated = await FoodRestaurantCommission.findByIdAndUpdate(
        id,
        { $set: { defaultCommission: body.defaultCommission, notes: body.notes || '' } },
        { new: true }
    ).lean();
    return updated;
}

export async function deleteRestaurantCommission(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodRestaurantCommission.findByIdAndDelete(id).lean();
    return deleted ? { id } : null;
}

export async function toggleRestaurantCommissionStatus(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurantCommission.findById(id);
    if (!doc) return null;
    doc.status = !Boolean(doc.status);
    await doc.save();
    return doc.toObject();
}

// ----- Delivery Boy Commission Rule (admin) -----
export async function getDeliveryCommissionRules() {
    const list = await FoodDeliveryCommissionRule.find({}).sort({ createdAt: -1 }).lean();
    const commissions = list.map((r, index) => ({
        _id: r._id,
        sl: index + 1,
        name: r.name || '',
        minDistance: r.minDistance,
        maxDistance: r.maxDistance ?? null,
        commissionPerKm: r.commissionPerKm,
        basePayout: r.basePayout,
        status: r.status !== false
    }));
    return { commissions };
}

function validateCommissionRuleSet(rules) {
    const active = (rules || []).filter((r) => r && r.status !== false);
    if (!active.length) {
        throw new ValidationError('A base slab with minDistance = 0 is required');
    }
    const baseRules = active.filter((r) => Number(r.minDistance || 0) === 0);
    if (baseRules.length !== 1) {
        throw new ValidationError('A base slab with minDistance = 0 is required');
    }
    const sorted = [...active].sort((a, b) => Number(a.minDistance || 0) - Number(b.minDistance || 0));
    for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];
        const min = Number(current.minDistance || 0);
        const max = current.maxDistance == null ? null : Number(current.maxDistance);
        if (max != null && max <= min) {
            throw new ValidationError('maxDistance must be greater than minDistance');
        }
        if (i > 0) {
            const prev = sorted[i - 1];
            const prevMin = Number(prev.minDistance || 0);
            const prevMax = prev.maxDistance == null ? null : Number(prev.maxDistance);
            const effectivePrevMax = prevMax == null ? Infinity : prevMax;
            if (min < effectivePrevMax) {
                throw new ValidationError('Distance slabs must not overlap');
            }
            if (min === prevMin) {
                throw new ValidationError('Distance slabs must not share the same minDistance');
            }
        }
    }
}

export async function createDeliveryCommissionRule(body) {
    const existing = await FoodDeliveryCommissionRule.find({}).lean();
    const candidate = [
        ...existing,
        {
            minDistance: body.minDistance,
            maxDistance: body.maxDistance ?? null,
            commissionPerKm: body.commissionPerKm,
            basePayout: body.basePayout,
            status: body.status ?? true
        }
    ];
    validateCommissionRuleSet(candidate);
    const created = await FoodDeliveryCommissionRule.create({
        name: body.name || '',
        minDistance: body.minDistance,
        maxDistance: body.maxDistance ?? null,
        commissionPerKm: body.commissionPerKm,
        basePayout: body.basePayout,
        status: body.status ?? true
    });
    return created.toObject();
}

export async function updateDeliveryCommissionRule(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const existing = await FoodDeliveryCommissionRule.find({}).lean();
    const candidate = existing.map((r) =>
        String(r._id) === String(id)
            ? {
                  ...r,
                  minDistance: body.minDistance,
                  maxDistance: body.maxDistance ?? null,
                  commissionPerKm: body.commissionPerKm,
                  basePayout: body.basePayout,
                  status: r.status !== false
              }
            : r
    );
    validateCommissionRuleSet(candidate);
    const updated = await FoodDeliveryCommissionRule.findByIdAndUpdate(
        id,
        {
            $set: {
                name: body.name || '',
                minDistance: body.minDistance,
                maxDistance: body.maxDistance ?? null,
                commissionPerKm: body.commissionPerKm,
                basePayout: body.basePayout
            }
        },
        { new: true }
    ).lean();
    return updated;
}

export async function deleteDeliveryCommissionRule(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodDeliveryCommissionRule.findByIdAndDelete(id).lean();
    return deleted ? { id } : null;
}

export async function toggleDeliveryCommissionRuleStatus(id, status) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updated = await FoodDeliveryCommissionRule.findByIdAndUpdate(
        id,
        { $set: { status: Boolean(status) } },
        { new: true }
    ).lean();
    return updated;
}

// ----- Fee Settings (admin) -----
export async function getFeeSettings() {
    const doc = await FoodFeeSettings.findOne().sort({ createdAt: -1 }).lean();
    // If not configured yet, return null so UI does not show defaults automatically.
    return { feeSettings: doc || null };
}

export async function upsertFeeSettings(body) {
    // Single active doc pattern: keep only one active record.
    const existing = await FoodFeeSettings.findOne().sort({ createdAt: -1 });
    console.log('[DEBUG] upsertFeeSettings - existing:', existing ? 'Yes' : 'No');
    if (existing) {
        const $set = {};
        const $unset = {};

        if (body.deliveryFee === null) $unset.deliveryFee = 1;
        else if (body.deliveryFee !== undefined) $set.deliveryFee = body.deliveryFee;

        if (body.deliveryFeeRanges !== undefined) $set.deliveryFeeRanges = body.deliveryFeeRanges;

        if (body.platformFee === null) $unset.platformFee = 1;
        else if (body.platformFee !== undefined) $set.platformFee = body.platformFee;

        if (body.quickDeliveryFee === null) $unset.quickDeliveryFee = 1;
        else if (body.quickDeliveryFee !== undefined) $set.quickDeliveryFee = body.quickDeliveryFee;

        if (body.gstRate === null) $unset.gstRate = 1;
        else if (body.gstRate !== undefined) $set.gstRate = body.gstRate;

        if (body.isActive !== undefined) $set.isActive = body.isActive;

        const update = {};
        if (Object.keys($set).length) update.$set = $set;
        if (Object.keys($unset).length) update.$unset = $unset;
        if (!Object.keys(update).length) return existing.toObject();

        const updated = await FoodFeeSettings.findByIdAndUpdate(existing._id, update, { new: true }).lean();
        return updated;
    }

    const payload = {
        deliveryFeeRanges: body.deliveryFeeRanges ?? [],
        isActive: body.isActive !== false
    };
    if (body.deliveryFee !== undefined && body.deliveryFee !== null) payload.deliveryFee = body.deliveryFee;
    if (body.platformFee !== undefined && body.platformFee !== null) payload.platformFee = body.platformFee;
    if (body.quickDeliveryFee !== undefined && body.quickDeliveryFee !== null) payload.quickDeliveryFee = body.quickDeliveryFee;
    if (body.gstRate !== undefined && body.gstRate !== null) payload.gstRate = body.gstRate;

    console.log('[DEBUG] Creating NEW settings with payload:', JSON.stringify(payload, null, 2));
    const created = await FoodFeeSettings.create(payload);
    return created.toObject();
}

// ----- Referral Settings (admin) -----
export async function getReferralSettings() {
    const doc = await FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    return { referralSettings: doc || null };
}

export async function upsertReferralSettings(body = {}) {
    const existing = await FoodReferralSettings.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (existing) {
        const $set = {};

        if (body.referralRewardUser !== undefined) $set.referralRewardUser = Math.max(0, Number(body.referralRewardUser) || 0);
        if (body.referralRewardDelivery !== undefined) $set.referralRewardDelivery = Math.max(0, Number(body.referralRewardDelivery) || 0);
        if (body.referralLimitUser !== undefined) $set.referralLimitUser = Math.max(0, Number(body.referralLimitUser) || 0);
        if (body.referralLimitDelivery !== undefined) $set.referralLimitDelivery = Math.max(0, Number(body.referralLimitDelivery) || 0);
        if (body.referralLinkUser !== undefined) $set.referralLinkUser = String(body.referralLinkUser || '').trim();
        if (body.referralLinkDelivery !== undefined) $set.referralLinkDelivery = String(body.referralLinkDelivery || '').trim();
        if (body.isActive !== undefined) $set.isActive = Boolean(body.isActive);

        if (!Object.keys($set).length) return existing.toObject();
        const updated = await FoodReferralSettings.findByIdAndUpdate(existing._id, { $set }, { new: true }).lean();
        return updated;
    }

    const created = await FoodReferralSettings.create({
        referralRewardUser: Math.max(0, Number(body.referralRewardUser) || 0),
        referralRewardDelivery: Math.max(0, Number(body.referralRewardDelivery) || 0),
        referralLimitUser: Math.max(0, Number(body.referralLimitUser) || 0),
        referralLimitDelivery: Math.max(0, Number(body.referralLimitDelivery) || 0),
        referralLinkUser: String(body.referralLinkUser || '').trim(),
        referralLinkDelivery: String(body.referralLinkDelivery || '').trim(),
        isActive: body.isActive !== false
    });
    return created.toObject();
}

// ----- Safety / Emergency Reports (admin) -----
export async function getSafetyEmergencyReports(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.status && ['unread', 'read', 'urgent', 'resolved'].includes(String(query.status))) {
        filter.status = String(query.status);
    }
    if (query.priority && ['low', 'medium', 'high', 'critical'].includes(String(query.priority))) {
        filter.priority = String(query.priority);
    }
    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 120);
        const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { userName: { $regex: term, $options: 'i' } },
            { userEmail: { $regex: term, $options: 'i' } },
            { message: { $regex: term, $options: 'i' } }
        ];
    }

    const [list, total] = await Promise.all([
        FoodSafetyEmergencyReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        FoodSafetyEmergencyReport.countDocuments(filter)
    ]);

    return {
        safetyEmergencies: list || [],
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    };
}

export async function updateSafetyEmergencyStatus(id, status) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid report id');
    const next = String(status);
    if (!['unread', 'read', 'urgent', 'resolved'].includes(next)) throw new ValidationError('Invalid status');
    const updated = await FoodSafetyEmergencyReport.findByIdAndUpdate(
        id,
        { $set: { status: next } },
        { new: true }
    ).lean();
    return updated;
}

export async function updateSafetyEmergencyPriority(id, priority) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid report id');
    const next = String(priority);
    if (!['low', 'medium', 'high', 'critical'].includes(next)) throw new ValidationError('Invalid priority');
    const updated = await FoodSafetyEmergencyReport.findByIdAndUpdate(
        id,
        { $set: { priority: next } },
        { new: true }
    ).lean();
    return updated;
}

export async function deleteSafetyEmergencyReport(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid report id');
    const deleted = await FoodSafetyEmergencyReport.findByIdAndDelete(id).lean();
    return deleted;
}

export async function getContactMessages(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    // Fix old records with 'User' instead of 'FoodUser' for population to work
    await FeedbackExperience.updateMany({ userModel: 'User' }, { $set: { userModel: 'FoodUser' } });

    const filter = {};
    if (query.rating && !isNaN(query.rating)) {
        filter.rating = parseInt(query.rating);
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        
        const [users, restaurants, partners] = await Promise.all([
            FoodUser.find({
                $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }]
            }).select('_id').lean(),
            FoodRestaurant.find({
                $or: [{ restaurantName: searchRegex }, { ownerEmail: searchRegex }, { ownerPhone: searchRegex }]
            }).select('_id').lean(),
            FoodDeliveryPartner.find({
                $or: [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }]
            }).select('_id').lean()
        ]);

        filter.$or = [
            { comment: searchRegex },
            { userId: { $in: [...users.map(u => u._id), ...restaurants.map(r => r._id), ...partners.map(p => p._id)] } }
        ];
    }

    const [list, total] = await Promise.all([
        FeedbackExperience.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId')
            .lean(),
        FeedbackExperience.countDocuments(filter)
    ]);

    const reviews = list.map((doc) => {
        const user = (doc.userId && typeof doc.userId === 'object') ? doc.userId : {};
        return {
            _id: doc._id,
            customer: {
                name: user.name || user.restaurantName || 'Unknown',
                email: user.email || user.ownerEmail || 'N/A',
                phone: user.phone || user.ownerPhone || 'N/A'
            },
            comment: doc.comment || '',
            rating: doc.rating || 0,
            submittedAt: doc.createdAt,
            module: doc.module
        };
    });

    return {
        reviews,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        }
    };
}

// ----- Delivery Cash Limit (admin) -----
export async function getDeliveryCashLimitSettings() {
    const doc = await FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    const settings = doc || { deliveryCashLimit: 0, deliveryWithdrawalLimit: 100, isActive: true };
    return {
        deliveryCashLimit: Number(settings.deliveryCashLimit) || 0,
        deliveryWithdrawalLimit: Number(settings.deliveryWithdrawalLimit) || 100
    };
}

export async function upsertDeliveryCashLimitSettings(body = {}) {
    const existing = await FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 });
    const nextCashLimit = body.deliveryCashLimit;
    const nextWithdrawalLimit = body.deliveryWithdrawalLimit;

    if (existing) {
        if (nextCashLimit !== undefined) existing.deliveryCashLimit = Math.max(0, Number(nextCashLimit) || 0);
        if (nextWithdrawalLimit !== undefined) existing.deliveryWithdrawalLimit = Math.max(0, Number(nextWithdrawalLimit) || 0);
        await existing.save();
        return {
            deliveryCashLimit: existing.deliveryCashLimit,
            deliveryWithdrawalLimit: existing.deliveryWithdrawalLimit
        };
    }

    const created = await FoodDeliveryCashLimit.create({
        deliveryCashLimit: nextCashLimit !== undefined ? Math.max(0, Number(nextCashLimit) || 0) : 0,
        deliveryWithdrawalLimit: nextWithdrawalLimit !== undefined ? Math.max(0, Number(nextWithdrawalLimit) || 0) : 100,
        isActive: true
    });

    return {
        deliveryCashLimit: created.deliveryCashLimit,
        deliveryWithdrawalLimit: created.deliveryWithdrawalLimit
    };
}

// ----- Delivery Emergency Help (admin) -----
export async function getDeliveryEmergencyHelp() {
    const doc = await FoodDeliveryEmergencyHelp.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    
    // Provide sensible defaults for India if numbers are not configured
    const defaults = {
        medicalEmergency: '102',
        accidentHelpline: '108',
        contactPolice: '100',
        insurance: '',
        isActive: true
    };

    const data = doc || defaults;

    return {
        medicalEmergency: (data.medicalEmergency || defaults.medicalEmergency).trim(),
        accidentHelpline: (data.accidentHelpline || defaults.accidentHelpline).trim(),
        contactPolice: (data.contactPolice || defaults.contactPolice).trim(),
        insurance: (data.insurance || '').trim()
    };
}

export async function upsertDeliveryEmergencyHelp(body = {}) {
    const existing = await FoodDeliveryEmergencyHelp.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (existing) {
        if (body.medicalEmergency !== undefined) existing.medicalEmergency = String(body.medicalEmergency || '').trim();
        if (body.accidentHelpline !== undefined) existing.accidentHelpline = String(body.accidentHelpline || '').trim();
        if (body.contactPolice !== undefined) existing.contactPolice = String(body.contactPolice || '').trim();
        if (body.insurance !== undefined) existing.insurance = String(body.insurance || '').trim();
        await existing.save();
        return {
            medicalEmergency: existing.medicalEmergency || '',
            accidentHelpline: existing.accidentHelpline || '',
            contactPolice: existing.contactPolice || '',
            insurance: existing.insurance || ''
        };
    }
    const created = await FoodDeliveryEmergencyHelp.create({
        medicalEmergency: String(body.medicalEmergency || '').trim(),
        accidentHelpline: String(body.accidentHelpline || '').trim(),
        contactPolice: String(body.contactPolice || '').trim(),
        insurance: String(body.insurance || '').trim(),
        isActive: true
    });
    return {
        medicalEmergency: created.medicalEmergency || '',
        accidentHelpline: created.accidentHelpline || '',
        contactPolice: created.contactPolice || '',
        insurance: created.insurance || ''
    };
}

export async function getRestaurantReviews(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {
        'ratings.restaurant.rating': { $exists: true, $ne: null }
    };

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        
        const restaurants = await FoodRestaurant.find({
            $or: [{ restaurantName: searchRegex }]
        }).select('_id').lean();
        
        const customers = await FoodUser.find({
            $or: [{ name: searchRegex }, { email: searchRegex }]
        }).select('_id').lean();

        filter.$or = [
            { orderId: searchRegex },
            { 'ratings.restaurant.comment': searchRegex },
            { restaurantId: { $in: restaurants.map(r => r._id) } },
            { userId: { $in: customers.map(c => c._id) } }
        ];
    }

    const [docs, total] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email phone')
            .populate('restaurantId', 'restaurantName')
            .select('orderId userId restaurantId ratings.restaurant createdAt')
            .lean(),
        FoodOrder.countDocuments(filter)
    ]);

    const reviews = docs.map((doc, index) => ({
        sl: skip + index + 1,
        orderId: doc.orderId,
        restaurant: doc.restaurantId?.restaurantName || 'Unknown',
        restaurantId: doc.restaurantId?._id || 'N/A',
        customer: doc.userId?.name || 'Unknown',
        customerId: doc.userId?._id || 'N/A',
        review: doc.ratings?.restaurant?.comment || '',
        rating: doc.ratings?.restaurant?.rating || 0,
        submittedAt: doc.createdAt
    }));

    return { reviews, total, page, limit };
}

export async function getRestaurantById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    return FoodRestaurant.findById(id)
        .select('-__v')
        .populate('zoneId', 'name zoneName serviceLocation isActive')
        .lean();
}

function formatSubscriptionPlanLabel(plan) {
    const key = String(plan || '').trim().toLowerCase();
    if (key === 'starter') return 'Starter';
    if (key === 'growth') return 'Growth';
    if (key === 'premium') return 'Premium';
    if (!key) return 'Not assigned';
    return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Invoice-based subscription summary for the admin POS analytics view
 * (calendar-month postpaid billing).
 */
async function buildRestaurantSubscriptionSummary(restaurantId) {
    const rId = new mongoose.Types.ObjectId(String(restaurantId));

    const [
        { FoodSubscriptionInvoice },
        { FoodSubscriptionTransaction },
        billingService,
    ] = await Promise.all([
        import('../../restaurant/models/subscriptionInvoice.model.js'),
        import('../../restaurant/models/subscriptionTransaction.model.js'),
        import('../../restaurant/services/subscriptionBilling.service.js'),
    ]);

    const currentMonth = billingService.formatBillingMonth(new Date());
    const { start: monthStart } = billingService.getMonthWindow(currentMonth);

    const [invoiceAgg, latestInvoice, lastPaymentTx, currentGmv, invoices] = await Promise.all([
        FoodSubscriptionInvoice.aggregate([
            { $match: { restaurantId: rId } },
            {
                $group: {
                    _id: null,
                    totalBilled: { $sum: { $ifNull: ['$totalAmount', 0] } },
                    totalPaid: { $sum: { $ifNull: ['$paidAmount', 0] } },
                    totalWaived: { $sum: { $ifNull: ['$waivedAmount', 0] } },
                    totalOutstanding: { $sum: { $ifNull: ['$outstandingAmount', 0] } },
                    invoiceCount: { $sum: 1 },
                },
            },
        ]),
        FoodSubscriptionInvoice.findOne({ restaurantId: rId, billingMonth: { $ne: 'legacy' } })
            .sort({ billingMonth: -1 })
            .lean(),
        FoodSubscriptionTransaction.findOne({
            restaurantId: rId,
            type: { $in: ['wallet_deduction', 'manual_payment', 'online_payment'] },
        })
            .sort({ createdAt: -1 })
            .lean(),
        billingService.computeMonthlyGmv(rId, monthStart, new Date()),
        FoodSubscriptionInvoice.find({ restaurantId: rId })
            .sort({ billingMonth: -1 })
            .limit(12)
            .lean(),
    ]);

    const walletDeductionAgg = await FoodSubscriptionTransaction.aggregate([
        { $match: { restaurantId: rId, type: 'wallet_deduction' } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$amount', 0] } }, count: { $sum: 1 } } },
    ]);

    const agg = invoiceAgg?.[0] || {};
    const dueAmount = Math.max(0, Number(agg.totalOutstanding) || 0);
    const planKey = String(latestInvoice?.planName || '').trim().toLowerCase();

    return {
        billingModel: 'calendar_month_postpaid',
        currentBillingMonth: currentMonth,
        currentMonthGmv: Number(currentGmv?.gmv) || 0,
        plan: planKey,
        planLabel: latestInvoice ? formatSubscriptionPlanLabel(planKey) : 'Not billed yet',
        cycleFee: Math.max(0, Number(latestInvoice?.totalAmount) || 0),
        lastBilledMonth: latestInvoice?.billingMonth || null,
        status: dueAmount > 0 ? 'due' : 'paid',
        statusLabel: dueAmount > 0 ? 'Outstanding dues pending' : 'No outstanding dues',
        dueAmount,
        paidAmount: Math.max(0, Number(agg.totalPaid) || 0),
        totalBilled: Math.max(0, Number(agg.totalBilled) || 0),
        totalWaived: Math.max(0, Number(agg.totalWaived) || 0),
        totalCollected: Math.max(0, Number(agg.totalPaid) || 0),
        walletDeductionsTotal: Math.max(0, Number(walletDeductionAgg?.[0]?.total) || 0),
        invoiceCount: Math.max(0, Number(agg.invoiceCount) || 0),
        invoices: invoices.map((inv) => ({
            billingMonth: inv.billingMonth,
            billingMonthLabel: billingService.billingMonthLabel(inv.billingMonth),
            gmv: inv.gmv,
            planName: inv.planName,
            totalAmount: inv.totalAmount,
            paidAmount: inv.paidAmount,
            waivedAmount: inv.waivedAmount,
            outstandingAmount: inv.outstandingAmount,
            status: inv.status,
        })),
        lastPayment: lastPaymentTx
            ? {
                amount: Math.max(0, Number(lastPaymentTx.amount) || 0),
                eventType: String(lastPaymentTx.type || ''),
                paymentType: lastPaymentTx.type === 'wallet_deduction' ? 'wallet' : 'manual',
                date: lastPaymentTx.createdAt || null,
                note: String(lastPaymentTx.remarks || '').trim(),
            }
            : null,
    };
}

export async function getRestaurantAnalytics(restaurantId) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) return null;
    const rId = new mongoose.Types.ObjectId(restaurantId);
    const restaurantOrderMatch = {
        $or: [
            { restaurantId: rId },
            { restaurantId: String(restaurantId) },
        ],
    };

    const [restaurant, commissionDoc, orders, txRows, orderStatsRows, relevantOffers] = await Promise.all([
        FoodRestaurant.findById(rId).lean(),
        FoodRestaurantCommission.findOne({ restaurantId: rId, status: { $ne: false } }).lean(),
        FoodOrder.find(restaurantOrderMatch).lean(),
        FoodTransaction.find({ restaurantId: rId })
            .populate('orderId', 'orderStatus deliveryState createdAt pricing')
            .sort({ createdAt: -1 })
            .lean(),
        FoodOrder.aggregate([
            { $match: restaurantOrderMatch },
            {
                $addFields: {
                    statusNormalized: {
                        $toLower: {
                            $trim: {
                                input: { $ifNull: ['$orderStatus', '$status', ''] },
                            },
                        },
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    completedOrders: {
                        $sum: {
                            $cond: [{ $eq: ['$statusNormalized', 'delivered'] }, 1, 0],
                        },
                    },
                    notDeliveredOrders: {
                        $sum: {
                            $cond: [{ $ne: ['$statusNormalized', 'delivered'] }, 1, 0],
                        },
                    },
                    explicitlyCancelledOrders: {
                        $sum: {
                            $cond: [
                                { $in: ['$statusNormalized', CANCELLED_ORDER_STATUSES] },
                                1,
                                0,
                            ],
                        },
                    },
                    cancelledByRestaurant: {
                        $sum: {
                            $cond: [{ $eq: ['$statusNormalized', 'cancelled_by_restaurant'] }, 1, 0],
                        },
                    },
                    cancelledByAdmin: {
                        $sum: {
                            $cond: [{ $eq: ['$statusNormalized', 'cancelled_by_admin'] }, 1, 0],
                        },
                    },
                    cancelledByUser: {
                        $sum: {
                            $cond: [{ $eq: ['$statusNormalized', 'cancelled_by_user'] }, 1, 0],
                        },
                    },
                    inProgressOrders: {
                        $sum: {
                            $cond: [
                                {
                                    $in: [
                                        '$statusNormalized',
                                        [
                                            'created',
                                            'confirmed',
                                            'preparing',
                                            'ready_for_pickup',
                                            'reached_pickup',
                                            'picked_up',
                                            'reached_drop',
                                        ],
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        FoodOffer.find({
            $or: [
                { restaurantScope: { $ne: 'selected' } },
                { restaurantId: rId },
                { restaurantIds: rId },
            ],
        }).lean(),
    ]);

    if (!restaurant) return null;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const toStatus = (value) => String(value || '').trim().toLowerCase();
    const isCompletedOrder = (order) => {
        if (isCancelledOrder(order)) return false;
        const orderStatus = toStatus(order?.orderStatus || order?.status);
        const deliveryPhase = toStatus(order?.deliveryState?.currentPhase);
        return orderStatus === 'delivered' || deliveryPhase === 'delivered' || deliveryPhase === 'completed';
    };
    const getPricing = (row) => row?.pricing || row?.orderId?.pricing || {};
    const getAmount = (row, key) => {
        const value = row?.amounts?.[key];
        return value === undefined || value === null ? null : Number(value);
    };
    const getRestaurantShare = (row) => {
        const explicitShare = getAmount(row, 'restaurantShare');
        if (Number.isFinite(explicitShare)) return explicitShare;
        const pricing = getPricing(row);
        const subtotal = Number(pricing?.subtotal) || 0;
        const packagingFee = Number(pricing?.packagingFee) || 0;
        const commission = Number(pricing?.restaurantCommission) || 0;
        return Math.max(0, subtotal + packagingFee - commission);
    };
    const getOrderFromRow = (row) => (row?.orderId && typeof row.orderId === 'object' ? row.orderId : row);
    const getDiscountShares = (row) => {
        const pricing = getPricing(row);
        const amounts = row?.amounts || {};
        const order = getOrderFromRow(row);
        return resolveDiscountSplit({
            order,
            pricing,
            amounts,
            offers: relevantOffers,
            restaurantId: rId,
        });
    };

    const completedOrders = orders.filter(isCompletedOrder);
    const orderStats = orderStatsRows?.[0] || {};
    const totalOrdersCount = Number(orderStats.totalOrders) || orders.length;
    const completedOrdersCount = Number(orderStats.completedOrders) || 0;
    const notDeliveredOrdersCount = Number(orderStats.notDeliveredOrders) || 0;
    const explicitlyCancelledOrdersCount = Number(orderStats.explicitlyCancelledOrders) || 0;
    const inProgressOrdersCount = Number(orderStats.inProgressOrders) || 0;

    // Money metrics should come from the ledger (FoodTransaction), not FoodOrder.
    const completedTxByOrderId = new Map(
        (txRows || [])
            .filter((tx) => tx?.orderId && isCompletedOrder(tx.orderId))
            .map((tx) => [String(tx.orderId?._id || tx.orderId), tx])
    );
    // Prefer the ledger snapshot per order, but do not drop a completed order
    // just because its transaction row is missing.
    const completedMoneyRows = completedOrders.map(
        (order) => completedTxByOrderId.get(String(order._id)) || order
    );

    const sum = (arr, pick) => (arr || []).reduce((s, it) => s + (Number(pick(it)) || 0), 0);

    // 1) Total order value (gross customer paid)
    const totalRevenue = sum(completedMoneyRows, (row) => getAmount(row, 'totalCustomerPaid') ?? getPricing(row)?.total);

    // 2) Restaurant share (payout to restaurant)
    const restaurantEarning = sum(completedMoneyRows, getRestaurantShare);

    // 3) Restaurant commission paid to admin
    const totalCommission = sum(completedMoneyRows, (row) => getAmount(row, 'restaurantCommission') ?? getPricing(row)?.restaurantCommission);

    // 4) Restaurant profit (in this system, equals restaurant share)
    const restaurantProfit = restaurantEarning;

    const monthlyOrdersList = orders.filter(o => {
        const d = new Date(o.createdAt);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const monthlyCompletedMoneyRows = completedMoneyRows.filter((row) => {
        const d = new Date(row?.createdAt || row?.orderId?.createdAt || 0);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const monthlyProfit = sum(monthlyCompletedMoneyRows, getRestaurantShare);

    const yearlyOrdersList = orders.filter(o => {
        const d = new Date(o.createdAt);
        return d.getFullYear() === currentYear;
    });
    const yearlyCompletedMoneyRows = completedMoneyRows.filter((row) => {
        const d = new Date(row?.createdAt || row?.orderId?.createdAt || 0);
        return d.getFullYear() === currentYear;
    });
    const yearlyProfit = sum(yearlyCompletedMoneyRows, getRestaurantShare);

    const avgOrderValue = completedMoneyRows.length > 0 ? totalRevenue / completedMoneyRows.length : 0;

    const uniqueCustomers = new Set(orders.map(o => String(o.userId))).size;
    const customerOrderCounts = orders.reduce((acc, o) => {
        const uid = String(o.userId);
        acc[uid] = (acc[uid] || 0) + 1;
        return acc;
    }, {});
    const repeatCustomers = Object.values(customerOrderCounts).filter(count => count > 1).length;

    // 5) Restaurant commission percent
    const commissionType = commissionDoc?.defaultCommission?.type || 'percentage';
    const commissionValue = Number(commissionDoc?.defaultCommission?.value || 0) || 0;
    const completedSubtotal = sum(completedMoneyRows, (row) => getPricing(row)?.subtotal);
    const computedCommissionPercent =
        commissionType === 'percentage'
            ? commissionValue
            : (completedSubtotal > 0 ? (totalCommission / completedSubtotal) * 100 : 0);

    const analytics = {
        totalOrders: totalOrdersCount,
        cancelledOrders: explicitlyCancelledOrdersCount,
        explicitlyCancelledOrders: explicitlyCancelledOrdersCount,
        inProgressOrders: inProgressOrdersCount,
        notDeliveredOrders: notDeliveredOrdersCount,
        completedOrders: completedOrdersCount,
        cancelledByRestaurant: Number(orderStats.cancelledByRestaurant) || 0,
        cancelledByAdmin: Number(orderStats.cancelledByAdmin) || 0,
        cancelledByUser: Number(orderStats.cancelledByUser) || 0,
        averageRating: Number(restaurant.rating || 0),
        totalRatings: Number(restaurant.totalRatings || 0),
        commissionPercentage: computedCommissionPercent,
        monthlyProfit,
        yearlyProfit,
        averageOrderValue: avgOrderValue,
        totalRevenue,
        totalCommission,
        restaurantEarning, // restaurant share
        restaurantProfit,
        monthlyOrders: monthlyOrdersList.length,
        yearlyOrders: yearlyOrdersList.length,
        averageMonthlyProfit: monthlyProfit, // Placeholder: can be improved if historical data exists
        averageYearlyProfit: yearlyProfit,   // Placeholder: can be improved if historical data exists
        status: restaurant.status === 'approved' ? 'active' : 'inactive',
        joinDate: restaurant.createdAt,
        totalCustomers: uniqueCustomers,
        repeatCustomers,
        cancellationRate: totalOrdersCount > 0 ? (explicitlyCancelledOrdersCount / totalOrdersCount) * 100 : 0,
        completionRate: totalOrdersCount > 0 ? (completedOrdersCount / totalOrdersCount) * 100 : 0,
        inProgressRate: totalOrdersCount > 0 ? (inProgressOrdersCount / totalOrdersCount) * 100 : 0,
    };

    const paymentSummary = {
        // Pricing (what customer paid components)
        subtotal: sum(completedMoneyRows, (row) => getPricing(row)?.subtotal),
        tax: sum(completedMoneyRows, (row) => getPricing(row)?.tax ?? getAmount(row, 'taxAmount')),
        packagingFee: sum(completedMoneyRows, (row) => getPricing(row)?.packagingFee),
        deliveryFee: sum(completedMoneyRows, (row) => getPricing(row)?.deliveryFee),
        platformFee: sum(completedMoneyRows, (row) => getPricing(row)?.platformFee),
        discount: sum(completedMoneyRows, (row) => getPricing(row)?.discount),
        adminDiscountShare: sum(completedMoneyRows, (row) => getDiscountShares(row).adminDiscountShare),
        restaurantDiscountShare: sum(completedMoneyRows, (row) => getDiscountShares(row).restaurantDiscountShare),
        total: totalRevenue,
        currency: 'INR',

        // Split (who got what)
        restaurantShare: restaurantEarning,
        restaurantCommission: totalCommission,
        riderShare: sum(completedMoneyRows, (row) => getAmount(row, 'riderShare') ?? row?.riderEarning),
        platformNetProfit: sum(completedMoneyRows, (row) => getAmount(row, 'platformNetProfit') ?? row?.platformProfit),
    };

    const subscriptionSummary = await buildRestaurantSubscriptionSummary(rId);

    return { restaurant, analytics, paymentSummary, subscriptionSummary };
}

export async function getRestaurantMenuById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id).select('menu').lean();
    if (!doc) return null;
    return doc.menu || { sections: [] };
}

export async function updateRestaurantMenuById(id, menu) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id);
    if (!doc) return null;
    const sections = Array.isArray(menu?.sections) ? menu.sections : [];
    doc.menu = { sections };
    await doc.save();
    return doc.menu || { sections: [] };
}

export async function getPendingRestaurants() {
    const restaurants = await FoodRestaurant.find({
        $or: [
            { status: { $in: ['pending', 'rejected'] } },
            { locationUpdateStatus: 'pending' }
        ]
    })
        .populate('zoneId', 'name zoneName')
        .populate('pendingZoneId', 'name zoneName')
        .sort({ createdAt: -1 })
        .lean();
    return restaurants.map((r, i) => ({
        ...r,
        sl: i + 1,
        zone: r.zoneId?.zoneName || r.zoneId?.name || null,
        pendingZone: r.pendingZoneId?.zoneName || r.pendingZoneId?.name || null,
    }));
}

export async function getUnregisteredRestaurants() {
    const list = await FoodUnregisteredRestaurant.find()
        .sort({ createdAt: -1 })
        .lean();
    return list.map((item, index) => ({
        ...item,
        sl: index + 1
    }));
}

export async function deleteUnregisteredRestaurant(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid unregistered restaurant id');
    const deleted = await FoodUnregisteredRestaurant.findByIdAndDelete(id).lean();
    return deleted;
}

export async function updateRestaurantById(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id);
    if (!doc) return null;

    const toStr = (v) => (v != null ? String(v).trim() : '');
    const toFinite = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    };

    if (body.name !== undefined || body.restaurantName !== undefined) {
        const name = toStr(body.name !== undefined ? body.name : body.restaurantName);
        if (!name) throw new ValidationError('Restaurant name cannot be empty');
        doc.restaurantName = name;
    }

    if (body.ownerName !== undefined) doc.ownerName = toStr(body.ownerName);
    if (body.ownerEmail !== undefined) doc.ownerEmail = toStr(body.ownerEmail).toLowerCase();
    if (body.ownerPhone !== undefined) doc.ownerPhone = toStr(body.ownerPhone);
    if (body.primaryContactNumber !== undefined) doc.primaryContactNumber = toStr(body.primaryContactNumber);

    if (body.pureVegRestaurant !== undefined) {
        doc.pureVegRestaurant = parseBooleanLike(body.pureVegRestaurant, 'pureVegRestaurant');
    }

    // Admin-only on purpose: a seller cannot grant themselves auto-accept.
    if (body.autoAcceptOrders !== undefined) {
        doc.autoAcceptOrders = parseBooleanLike(body.autoAcceptOrders, 'autoAcceptOrders');
    }
    if (body.isAcceptingOrders !== undefined) {
        doc.isAcceptingOrders = parseBooleanLike(body.isAcceptingOrders, 'isAcceptingOrders');
        doc.outsideHoursOverride = false;
    }

    if (body.cuisines !== undefined) {
        if (Array.isArray(body.cuisines)) {
            doc.cuisines = body.cuisines
                .map((c) => toStr(c))
                .filter(Boolean)
                .slice(0, 50);
        } else if (typeof body.cuisines === 'string') {
            doc.cuisines = body.cuisines
                .split(',')
                .map((c) => toStr(c))
                .filter(Boolean)
                .slice(0, 50);
        } else {
            throw new ValidationError('cuisines must be an array or comma-separated string');
        }
    }

    if (body.openingTime !== undefined) doc.openingTime = normalizeRestaurantTime(body.openingTime) || '';
    if (body.closingTime !== undefined) doc.closingTime = normalizeRestaurantTime(body.closingTime) || '';
    validateOpeningClosingTimes(doc.openingTime, doc.closingTime);
    if (body.openDays !== undefined && Array.isArray(body.openDays)) {
        doc.openDays = body.openDays.map(d => toStr(d)).filter(Boolean);
    }
    if (body.offer !== undefined) doc.offer = toStr(body.offer);

    if (body.estimatedDeliveryTime !== undefined) {
        doc.estimatedDeliveryTime = toStr(body.estimatedDeliveryTime);
    }
    if (body.estimatedDeliveryTimeMinutes !== undefined) {
        const minutes = toFiniteNumber(body.estimatedDeliveryTimeMinutes);
        if (minutes === null) {
            doc.estimatedDeliveryTimeMinutes = undefined;
        } else if (minutes < 0) {
            throw new ValidationError('estimatedDeliveryTimeMinutes must be >= 0');
        } else {
            doc.estimatedDeliveryTimeMinutes = Math.round(minutes);
        }
    }

    // Business & Docs
    if (body.panNumber !== undefined) doc.panNumber = toStr(body.panNumber);
    if (body.nameOnPan !== undefined) doc.nameOnPan = toStr(body.nameOnPan);
    if (body.gstRegistered !== undefined) doc.gstRegistered = parseBooleanLike(body.gstRegistered, 'gstRegistered');
    if (body.gstNumber !== undefined) doc.gstNumber = toStr(body.gstNumber);
    if (body.gstLegalName !== undefined) doc.gstLegalName = toStr(body.gstLegalName);
    if (body.gstAddress !== undefined) doc.gstAddress = toStr(body.gstAddress);
    if (body.fssaiNumber !== undefined) doc.fssaiNumber = toStr(body.fssaiNumber);
    if (body.fssaiExpiry !== undefined) doc.fssaiExpiry = body.fssaiExpiry ? new Date(body.fssaiExpiry) : undefined;

    // Store type. A legacy pharmacy may send its own type back unchanged; nothing
    // can be switched to pharmacy (the Medical vertical was removed). Drug-licence
    // fields are no longer written.
    {
        const storeType = normalizeStoreTypeInput(body.storeType, {
            allowLegacy: doc.storeType === 'pharmacy',
        });
        if (storeType !== undefined) doc.storeType = storeType;
    }

    // Bank Details
    if (body.accountNumber !== undefined) doc.accountNumber = toStr(body.accountNumber);
    if (body.ifscCode !== undefined) doc.ifscCode = toStr(body.ifscCode);
    if (body.accountHolderName !== undefined) doc.accountHolderName = toStr(body.accountHolderName);
    if (body.accountType !== undefined) doc.accountType = toStr(body.accountType);

    // Featured Info
    if (body.featuredDish !== undefined) doc.featuredDish = toStr(body.featuredDish);
    if (body.featuredPrice !== undefined) doc.featuredPrice = toFinite(body.featuredPrice);

    // Images
    const getUrl = (v) => (v && typeof v === 'object' ? v.url : v);
    if (body.profileImage !== undefined) doc.profileImage = toStr(getUrl(body.profileImage)) || undefined;
    if (body.panImage !== undefined) doc.panImage = toStr(getUrl(body.panImage)) || undefined;
    if (body.gstImage !== undefined) doc.gstImage = toStr(getUrl(body.gstImage)) || undefined;
    if (body.fssaiImage !== undefined) doc.fssaiImage = toStr(getUrl(body.fssaiImage)) || undefined;

    const toUrlList = (value, max) => {
        const list = Array.isArray(value) ? value : [value];
        return list.map((v) => toStr(getUrl(v))).filter(Boolean).slice(0, max);
    };

    if (body.menuImages !== undefined) doc.menuImages = toUrlList(body.menuImages, 10);

    // Media images. These were missing, so an admin could edit a restaurant's
    // documents and menu photos but not the cover or premises gallery — the two
    // the customer app and the rider's pickup screen actually show.
    //
    // coverImage is the single hero; coverImages is the public page's banner array.
    // Both are kept because the model carries them separately and onboarding does
    // not consistently fill the same one.
    if (body.coverImage !== undefined) doc.coverImage = toStr(getUrl(body.coverImage)) || undefined;
    if (body.coverImages !== undefined) doc.coverImages = toUrlList(body.coverImages, 10);
    if (body.galleryImages !== undefined) doc.galleryImages = toUrlList(body.galleryImages, 10);

    await doc.save();

    if (body.openingTime !== undefined || body.closingTime !== undefined) {
        await syncAdminRestaurantOutletTimings(doc);
    }

    // Always invalidate, not only on a timings change. Name, cuisines and every
    // image field above are part of the cached public payload, so editing an image
    // and seeing the old one for the rest of the TTL was indistinguishable from the
    // upload silently failing.
    {
        const { invalidateCache } = await import('../../../../middleware/cache.js');
        void invalidateCache('restaurants:*');
        void invalidateCache('restaurant_detail:*');
        void invalidateCache('restaurant_timings:*');
    }

    return FoodRestaurant.findById(id).select('-__v').populate('zoneId', 'name zoneName serviceLocation isActive').lean();
}

export async function updateRestaurantStatus(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const raw = body.status !== undefined ? body.status : body.isActive;
    let status = null;

    if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase();
        if (['approved', 'pending', 'rejected'].includes(normalized)) {
            status = normalized;
        }
    }

    if (!status) {
        const isActive = parseBooleanLike(raw, 'status');
        status = isActive ? 'approved' : 'rejected';
    }

    const approvedAt = status === 'approved' ? new Date() : undefined;
    const rejectedAt = status === 'rejected' ? new Date() : undefined;
    const rejectionReason = status === 'rejected' ? 'Disabled by admin' : undefined;

    return FoodRestaurant.findByIdAndUpdate(
        id,
        {
            $set: {
                status,
                approvedAt,
                rejectedAt,
                rejectionReason
            }
        },
        { new: true, runValidators: false }
    ).lean();
}

export async function updateRestaurantLocation(id, body = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodRestaurant.findById(id);
    if (!doc) return null;

    const source = (body.location && typeof body.location === 'object') ? body.location : body;
    const toStr = (v) => (v != null ? String(v).trim() : '');

    const coordinates = Array.isArray(source.coordinates) ? source.coordinates : [];
    const lngFromCoordinates = toFiniteNumber(coordinates[0]);
    const latFromCoordinates = toFiniteNumber(coordinates[1]);
    const latitude = toFiniteNumber(source.latitude ?? latFromCoordinates);
    const longitude = toFiniteNumber(source.longitude ?? lngFromCoordinates);

    const addressLine1 = toStr(source.addressLine1 || source.formattedAddress || source.address);
    const addressLine2 = toStr(source.addressLine2);
    const area = toStr(source.area);
    const city = toStr(source.city);
    const state = toStr(source.state);
    const pincode = toStr(source.pincode || source.zipCode || source.postalCode);
    const landmark = toStr(source.landmark);
    const formattedAddress = toStr(source.formattedAddress || source.address || addressLine1);

    if (!doc.location || typeof doc.location !== 'object') {
        doc.location = { type: 'Point' };
    }
    doc.location.type = 'Point';
    if (latitude !== null && longitude !== null) {
        doc.location.latitude = latitude;
        doc.location.longitude = longitude;
        doc.location.coordinates = [longitude, latitude];
    }
    doc.location.formattedAddress = formattedAddress;
    doc.location.address = toStr(source.address || formattedAddress);
    doc.location.addressLine1 = addressLine1;
    doc.location.addressLine2 = addressLine2;
    doc.location.area = area;
    doc.location.city = city;
    doc.location.state = state;
    doc.location.pincode = pincode;
    doc.location.landmark = landmark;

    // Keep flat fields in sync for legacy readers.
    doc.addressLine1 = addressLine1;
    doc.addressLine2 = addressLine2;
    doc.area = area;
    doc.city = city;
    doc.state = state;
    doc.pincode = pincode;
    doc.landmark = landmark;

    if (body.zoneId !== undefined) {
        const zoneId = String(body.zoneId || '').trim();
        if (!zoneId) {
            doc.zoneId = undefined;
        } else if (!mongoose.Types.ObjectId.isValid(zoneId)) {
            throw new ValidationError('Invalid zoneId');
        } else {
            doc.zoneId = new mongoose.Types.ObjectId(zoneId);
        }
    }

    await doc.save();
    return FoodRestaurant.findById(id).select('-__v').populate('zoneId', 'name zoneName serviceLocation isActive').lean();
}

// ----- Categories -----
export async function getCategories(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        filter.$or = [{ name: { $regex: term, $options: 'i' } }];
    }
    // Optional zone filter for admin list.
    // - zoneId=global => only global categories (zoneId missing)
    // - zoneId=<ObjectId> => only categories bound to that zone
    if (query.zoneId && String(query.zoneId).trim()) {
        const zid = String(query.zoneId).trim();
        if (zid === 'global') {
            filter.$or = [...(filter.$or || []), { zoneId: { $exists: false } }, { zoneId: null }];
        } else if (mongoose.Types.ObjectId.isValid(zid)) {
            filter.zoneId = new mongoose.Types.ObjectId(zid);
        }
    }
    if (query.approvalStatus) {
        const approvalStatus = String(query.approvalStatus);
        if (approvalStatus === 'pending') {
            filter.$and = [...(filter.$and || []), {
                $or: [
                    { approvalStatus: 'pending' },
                    { approvalStatus: { $exists: false }, isApproved: false }
                ]
            }];
        } else {
            filter.approvalStatus = approvalStatus;
        }
    } else if (query.isApproved !== undefined) {
        if (query.isApproved === true) {
            filter.$and = [...(filter.$and || []), {
                $or: [
                    { approvalStatus: 'approved' },
                    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
                ]
            }];
        } else {
            filter.$and = [...(filter.$and || []), {
                $or: [
                    { approvalStatus: 'pending' },
                    { approvalStatus: { $exists: false }, isApproved: false }
                ]
            }];
        }
    }

    const [list, total] = await Promise.all([
        FoodCategory.find(filter)
            .sort({ sortOrder: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodCategory.countDocuments(filter)
    ]);

    const statsById = await backfillLegacyCategoryWorkflow(list);
    const restaurantIds = Array.from(
        new Set(
            list
                .flatMap((category) => [category?.restaurantId, category?.createdByRestaurantId])
                .map((value) => (value ? String(value) : ''))
                .filter(Boolean)
        )
    );
    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } })
            .select('restaurantName ownerName ownerPhone')
            .lean()
        : [];
    const restaurantMap = new Map(restaurants.map((restaurant) => [String(restaurant._id), restaurant]));

    const hydratedList = list.map((category) => ({
        ...category,
        restaurantId: category?.restaurantId ? restaurantMap.get(String(category.restaurantId)) || category.restaurantId : category.restaurantId,
        createdByRestaurantId: category?.createdByRestaurantId ? restaurantMap.get(String(category.createdByRestaurantId)) || category.createdByRestaurantId : category.createdByRestaurantId
    }));
    const categories = hydratedList.map((category) => serializeCategoryForResponse(category, { includeCounts: true, statsById }));

    return { categories, total, page, limit };
}

/**
 * Validates a category's parent: it must exist, and it must be top level.
 *
 * Refusing a parent that already has one keeps the tree two deep, which is
 * what a grocery app renders. It also makes a cycle impossible without walking
 * the chain -- a category cannot be its own grandparent if there are no
 * grandparents. Empty promotes back to top level.
 */
async function resolveCategoryParentId(value, selfId = null) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === 'none') return undefined;
    if (!mongoose.Types.ObjectId.isValid(raw)) throw new ValidationError('Invalid parentId');

    if (selfId && String(selfId) === raw) {
        throw new ValidationError('A category cannot be its own parent');
    }

    // The other way a third level appears: demoting a category that is already
    // somebody's parent.
    if (selfId && (await FoodCategory.exists({ parentId: selfId }))) {
        throw new ValidationError('This category has subcategories, so it cannot become one');
    }

    const parent = await FoodCategory.findById(raw).select('parentId').lean();
    if (!parent?._id) throw new ValidationError('Parent category not found');
    if (parent.parentId) {
        throw new ValidationError('A subcategory cannot be nested under another subcategory');
    }

    return parent._id;
}

export async function createCategory(body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('Category name is required');
    const doc = new FoodCategory({
        name,
        image: typeof body.image === 'string' ? body.image.trim() : '',
        type: typeof body.type === 'string' ? body.type.trim() : '',
        foodTypeScope: normalizeCategoryFoodTypeScope(body.foodTypeScope, 'Both'),
        zoneId:
            body.zoneId && String(body.zoneId).trim()
                ? (() => {
                    const zid = String(body.zoneId).trim();
                    if (zid === 'global') return undefined;
                    if (!mongoose.Types.ObjectId.isValid(zid)) throw new ValidationError('Invalid zoneId');
                    return new mongoose.Types.ObjectId(zid);
                })()
                : undefined,
        isActive: body.isActive !== false,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        parentId: await resolveCategoryParentId(body.parentId),
        // Admin-created categories are globally available immediately.
        approvalStatus: 'approved',
        isApproved: true,
        approvedAt: new Date(),
        rejectionReason: '',
        restaurantId: undefined,
        createdByRestaurantId: undefined
    });
    await doc.save();
    return doc.toObject();
}

export async function approveCategory(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;

    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    doc.approvalStatus = 'approved';
    doc.isApproved = true;
    doc.approvedAt = new Date();
    doc.rejectedAt = undefined;
    doc.rejectionReason = '';
    await doc.save();
    return doc.toObject();
}

export async function rejectCategory(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;
    if (!doc.restaurantId && !doc.createdByRestaurantId) {
        throw new ValidationError('Only restaurant-created categories can be rejected');
    }

    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    doc.approvalStatus = 'rejected';
    doc.isApproved = false;
    doc.rejectionReason = String(reason || '').trim();
    doc.rejectedAt = new Date();
    doc.approvedAt = undefined;
    await doc.save();
    return doc.toObject();
}

export async function makeCategoryGlobal(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;

    if (!doc.restaurantId && !doc.createdByRestaurantId) {
        return doc.toObject();
    }
    if (String(doc.approvalStatus || '') !== 'approved' && doc.isApproved !== true) {
        throw new ValidationError('Only approved categories can be made global');
    }

    doc.createdByRestaurantId = doc.createdByRestaurantId || doc.restaurantId;
    doc.restaurantId = undefined;
    doc.zoneId = undefined;
    doc.approvalStatus = 'approved';
    doc.isApproved = true;
    doc.rejectionReason = '';
    doc.globalizedAt = new Date();
    doc.approvedAt = doc.approvedAt || new Date();
    await doc.save();
    return doc.toObject();
}

export async function updateCategory(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;

    const nextFoodTypeScope = body.foodTypeScope !== undefined
        ? normalizeCategoryFoodTypeScope(body.foodTypeScope, doc.foodTypeScope || 'Both')
        : normalizeCategoryFoodTypeScope(doc.foodTypeScope, 'Both');

    if (body.foodTypeScope !== undefined && nextFoodTypeScope !== 'Both') {
        const incompatibleFoods = await FoodItem.countDocuments({
            categoryId: doc._id,
            foodType: nextFoodTypeScope === 'Veg' ? 'Non-Veg' : 'Veg'
        });
        if (incompatibleFoods > 0) {
            throw new ValidationError(`This category already has ${incompatibleFoods} food item(s) outside the selected diet scope`);
        }
    }

    if (body.name !== undefined) doc.name = String(body.name || '').trim();
    if (body.image !== undefined) doc.image = String(body.image || '').trim();
    if (body.type !== undefined) doc.type = String(body.type || '').trim();
    if (body.foodTypeScope !== undefined) doc.foodTypeScope = nextFoodTypeScope;
    if (!doc.restaurantId && doc.createdByRestaurantId) {
        doc.zoneId = undefined;
    } else if (body.zoneId !== undefined) {
        const raw = String(body.zoneId || '').trim();
        if (!raw || raw === 'global') {
            doc.zoneId = undefined;
        } else {
            if (!mongoose.Types.ObjectId.isValid(raw)) throw new ValidationError('Invalid zoneId');
            doc.zoneId = new mongoose.Types.ObjectId(raw);
        }
    }
    if (body.isActive !== undefined) doc.isActive = body.isActive !== false;
    if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;
    if (body.parentId !== undefined) doc.parentId = await resolveCategoryParentId(body.parentId, doc._id);
    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    await doc.save();
    return doc.toObject();
}

export async function deleteCategory(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const categoryObjectId = new mongoose.Types.ObjectId(id);
    await FoodItem.updateMany(
        { categoryId: categoryObjectId },
        {
            $set: {
                categoryId: null,
                categoryName: ''
            }
        }
    );
    const deleted = await FoodCategory.findByIdAndDelete(id).lean();
    return deleted ? { id } : null;
}

export async function toggleCategoryStatus(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodCategory.findById(id);
    if (!doc) return null;
    doc.isActive = !doc.isActive;
    if (!doc.createdByRestaurantId && doc.restaurantId) {
        doc.createdByRestaurantId = doc.restaurantId;
    }
    await doc.save();
    return doc.toObject();
}

// ----- Restaurant Add-ons approval (admin) -----
export async function getRestaurantAddonsAdmin(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: { $ne: true } };

    const approvalStatus = String(query.approvalStatus || '').trim();
    if (approvalStatus && ['pending', 'approved', 'rejected'].includes(approvalStatus)) {
        filter.approvalStatus = approvalStatus;
    }

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        filter.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    }

    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matchingRestaurantIds = await FoodRestaurant.find({
            restaurantName: { $regex: term, $options: 'i' }
        })
            .select('_id')
            .lean();

        filter.$or = [
            { 'draft.name': { $regex: term, $options: 'i' } },
            { restaurantId: { $in: matchingRestaurantIds.map((restaurant) => restaurant._id) } }
        ];
    }

    const [list, total] = await Promise.all([
        FoodAddon.find(filter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('restaurantId', 'restaurantName ownerName ownerPhone')
            .lean(),
        FoodAddon.countDocuments(filter)
    ]);

    const addons = list.map((a) => ({
        id: a._id,
        _id: a._id,
        restaurantId: a.restaurantId?._id ? String(a.restaurantId._id) : String(a.restaurantId),
        restaurant: a.restaurantId?._id
            ? {
                _id: a.restaurantId._id,
                name: a.restaurantId.restaurantName || '',
                ownerName: a.restaurantId.ownerName || '',
                ownerPhone: a.restaurantId.ownerPhone || ''
            }
            : null,
        approvalStatus: a.approvalStatus || 'pending',
        rejectionReason: a.rejectionReason || '',
        requestedAt: a.requestedAt,
        approvedAt: a.approvedAt,
        rejectedAt: a.rejectedAt,
        isAvailable: a.isAvailable !== false,
        draft: a.draft || null,
        published: a.published || null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt
    }));

    return { addons, total, page, limit };
}

export async function updateRestaurantAddonAdmin(addonId, body) {
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) return null;
    const _id = new mongoose.Types.ObjectId(String(addonId));
    
    const addon = await FoodAddon.findOne({ _id, isDeleted: { $ne: true } });
    if (!addon) return null;

    const updatePayload = {};
    if (body.name !== undefined) updatePayload.name = String(body.name || '').trim();
    if (body.description !== undefined) updatePayload.description = String(body.description || '').trim();
    if (body.foodType !== undefined) {
        const foodType = String(body.foodType || '').trim().toLowerCase();
        if (!['veg', 'non-veg'].includes(foodType)) {
            throw new ValidationError('Food type must be veg or non-veg');
        }
        updatePayload.foodType = foodType;
    }
    if (body.price !== undefined) {
        const p = Number(body.price);
        if (!Number.isFinite(p) || p < 0) throw new ValidationError('Price must be a valid positive number');
        updatePayload.price = p;
    }
    if (body.image !== undefined) updatePayload.image = String(body.image || '').trim();
    if (body.images !== undefined && Array.isArray(body.images)) {
        updatePayload.images = body.images.map(img => typeof img === 'string' ? img : img?.url).filter(Boolean);
    } else if (updatePayload.image) {
        updatePayload.images = [updatePayload.image];
    }

    // Update draft fields
    if (addon.draft) {
        Object.assign(addon.draft, updatePayload);
    } else {
        addon.draft = updatePayload;
    }

    // If already approved, update published state as well
    if (addon.approvalStatus === 'approved') {
        if (addon.published) {
            Object.assign(addon.published, updatePayload);
        } else {
            addon.published = updatePayload;
        }
    }

    if (body.isAvailable !== undefined) {
        addon.isAvailable = body.isAvailable === true;
    }

    await addon.save();
    {
        const { invalidatePublicAddonCache } = await import(
            '../../restaurant/services/restaurantAddon.service.js'
        );
        await invalidatePublicAddonCache();
    }
    return addon.toObject();
}

export async function approveRestaurantAddon(addonId) {
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) return null;
    const _id = new mongoose.Types.ObjectId(String(addonId));

    // Use update pipeline to copy draft -> published atomically.
    const updated = await FoodAddon.findOneAndUpdate(
        { _id, isDeleted: { $ne: true } },
        [
            {
                $set: {
                    published: '$draft',
                    approvalStatus: 'approved',
                    approvedAt: '$$NOW',
                    rejectedAt: null,
                    rejectionReason: ''
                }
            }
        ],
        { new: true }
    ).lean();

    if (updated) {
        // Approval flips draft -> published, which is what the public endpoint
        // serves. Without this the add-on stayed invisible for up to 600s.
        const { invalidatePublicAddonCache } = await import(
            '../../restaurant/services/restaurantAddon.service.js'
        );
        await invalidatePublicAddonCache();
    }

    if (updated?.restaurantId) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Addon Approved! âœ…',
                    body: `Your addon "${updated.published?.name || 'New Addon'}" has been approved and is now live.`,
                    image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                    data: {
                        type: 'addon_approved',
                        addonId: String(updated._id),
                        restaurantId: String(updated.restaurantId)
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send addon approval notification:', e);
        }
    }

    return updated || null;
}

export async function rejectRestaurantAddon(addonId, reason) {
    if (!addonId || !mongoose.Types.ObjectId.isValid(String(addonId))) return null;
    const _id = new mongoose.Types.ObjectId(String(addonId));
    const rejectionReason = String(reason || '').trim();
    if (!rejectionReason) {
        throw new ValidationError('Rejection reason is required');
    }
    const updated = await FoodAddon.findOneAndUpdate(
        { _id, isDeleted: { $ne: true } },
        {
            $set: {
                approvalStatus: 'rejected',
                rejectionReason,
                rejectedAt: new Date()
            }
        },
        { new: true }
    ).lean();

    if (updated?.restaurantId) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Addon Rejected âŒ',
                    body: `Your addon request for "${updated.draft?.name || 'New Addon'}" was rejected. Reason: ${rejectionReason}`,
                    image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                    data: {
                        type: 'addon_rejected',
                        addonId: String(updated._id),
                        restaurantId: String(updated.restaurantId),
                        reason: rejectionReason
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send addon rejection notification:', e);
        }
    }

    return updated || null;
}

// ----- Foods (separate collection) -----
export async function getFoods(query) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const filter = {};

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = query.restaurantId;
    }
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim();
        filter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { categoryName: { $regex: term, $options: 'i' } }
        ];
    }
    if (query.approvalStatus && ['pending', 'approved', 'rejected'].includes(String(query.approvalStatus))) {
        filter.approvalStatus = String(query.approvalStatus);
    }
    // A product carries no store type of its own; it inherits its seller's.
    applySellerScope(filter, await sellerIdsOfStoreType(FoodRestaurant, query.storeType));

    const [list, total] = await Promise.all([
        FoodItem.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodItem.countDocuments(filter)
    ]);

    const restaurantIds = Array.from(new Set(list.map((f) => String(f.restaurantId)).filter(Boolean)));
    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } }).select('restaurantName').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));

    const foods = list.map((f) => ({
        id: f._id,
        _id: f._id,
        restaurantId: f.restaurantId,
        restaurantName: restaurantMap.get(String(f.restaurantId)) || 'Unknown Restaurant',
        categoryId: f.categoryId || null,
        categoryName: f.categoryName || '',
        name: f.name,
        description: f.description || '',
        price: getFoodDisplayPrice(f),
        otherPrice: getFoodDisplayOtherPrice(f),
        // The admin food form is shared with the food vertical and sends mrp, so
        // it has to come back or the field renders blank and the next save clears
        // what the seller set.
        mrp: f.mrp ?? null,
        // Stock, for the admin form (per size is inside each variant).
        stockQty: f.stockQty ?? null,
        lowStockThreshold: f.lowStockThreshold ?? null,
        // GST % (per size is inside each variant); null = the standard rate.
        gstRate: f.gstRate ?? null,
        variants: serializeFoodVariants(f.variants),
        variations: serializeFoodVariants(f.variants),
        image: f.image || '',
        // Falls back to the single image so a dish saved before galleries existed
        // still returns a one-entry list, rather than the panel having to special
        // case "no images but there is an image".
        images: Array.isArray(f.images) && f.images.length
            ? f.images
            : (f.image ? [f.image] : []),
        foodType: f.foodType || 'Non-Veg',
        isAvailable: f.isAvailable !== false,
        preparationTime: f.preparationTime || '',
        approvalStatus: f.approvalStatus || 'approved',
        createdAt: f.createdAt,
        updatedAt: f.updatedAt
    }));

    return { foods, total, page, limit };
}

const resolveAdminFoodCategory = async ({ categoryId, categoryName, foodType, pureVegRestaurant }) => {
    let resolvedCategoryId = null;
    let resolvedCategoryName = typeof categoryName === 'string' ? categoryName.trim() : '';
    let categoryDoc = null;

    if (categoryId) {
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new ValidationError('Invalid category id');
        }
        categoryDoc = await FoodCategory.findById(categoryId)
            .select('name foodTypeScope')
            .lean();
        if (!categoryDoc?._id) {
            throw new ValidationError('Category not found');
        }
        resolvedCategoryId = categoryDoc._id;
        resolvedCategoryName = categoryDoc.name || resolvedCategoryName;
    }

    if (!resolvedCategoryName) {
        throw new ValidationError('Category is required');
    }

    if (categoryDoc?.foodTypeScope) {
        if (pureVegRestaurant && String(categoryDoc.foodTypeScope || '') !== 'Veg') {
            throw new ValidationError('Pure veg restaurants can only use veg categories');
        }
        if (!categoryAllowsFoodType(categoryDoc.foodTypeScope, foodType)) {
            throw new ValidationError(`This ${categoryDoc.foodTypeScope} category cannot accept ${foodType} food`);
        }
    }

    return {
        categoryId: resolvedCategoryId,
        categoryName: resolvedCategoryName
    };
};

const getAdminFoodCreatePricing = (body = {}) => {
    const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body));
    if (variants.length > 0) {
        return {
            price: getFoodDisplayPrice({ variants }),
            otherPrice: getFoodDisplayOtherPrice({ variants }),
            variants
        };
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) throw new ValidationError('Price must be greater than 0');
    const otherPrice = Number(body.otherPrice);
    return {
        price,
        otherPrice: Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0,
        variants: []
    };
};

const getAdminFoodUpdatedPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const existingHasVariants = hasFoodVariants(existing);
    const update = {};

    if (variantsTouched) {
        const variants = normalizeFoodVariantsInput(extractRawFoodVariants(body), { existing: existing.variants });
        update.variants = variants;

        if (variants.length > 0) {
            update.price = getFoodDisplayPrice({ variants });
            update.otherPrice = getFoodDisplayOtherPrice({ variants });
            return update;
        }

        const nextBasePrice = body.price !== undefined ? Number(body.price) : Number(existingHasVariants ? NaN : existing.price);
        if (!Number.isFinite(nextBasePrice) || nextBasePrice <= 0) {
            throw new ValidationError('Base price must be greater than 0 when variants are removed');
        }
        update.price = nextBasePrice;
        if (body.otherPrice !== undefined) {
            const otherPrice = Number(body.otherPrice);
            update.otherPrice = Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0;
        } else {
            update.otherPrice = 0;
        }
        return update;
    }

    if (body.price !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base price for foods with variants');
        }
        const price = Number(body.price);
        if (!Number.isFinite(price) || price <= 0) throw new ValidationError('Price must be greater than 0');
        update.price = price;
    }

    if (body.otherPrice !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base other price for foods with variants');
        }
        const otherPrice = Number(body.otherPrice);
        update.otherPrice = Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0;
    }

    return update;
};

export async function createFood(body) {
    const restaurantId = body.restaurantId;
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Valid restaurantId is required');
    }
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('pureVegRestaurant')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('Food name is required');
    const foodType = body.foodType === 'Veg' ? 'Veg' : 'Non-Veg';
    if (restaurant.pureVegRestaurant === true && foodType !== 'Veg') {
        throw new ValidationError('Pure veg restaurants can only use veg foods');
    }
    const { price, otherPrice, variants } = getAdminFoodCreatePricing(body);

    let categoryName = typeof body.categoryName === 'string' ? body.categoryName.trim() : '';
    if (!categoryName && typeof body.category === 'string') categoryName = body.category.trim();
    const { categoryId, categoryName: resolvedCategoryName } = await resolveAdminFoodCategory({
        categoryId: body.categoryId,
        categoryName,
        foodType,
        pureVegRestaurant: restaurant.pureVegRestaurant === true
    });

    const doc = new FoodItem({
        restaurantId,
        categoryId,
        categoryName: resolvedCategoryName,
        name,
        description: typeof body.description === 'string' ? body.description.trim() : '',
        price,
        otherPrice,
        variants,
        ...(normalizeFoodImages(body) ?? { image: '', images: [] }),
        foodType,
        isAvailable: body.isAvailable !== false,
        preparationTime: typeof body.preparationTime === 'string' ? body.preparationTime.trim() : '',
        // Same grocery fields the seller-side create accepts. Without these the
        // admin panel silently dropped them, so anything catalogued centrally
        // came out untracked and taxed at the order-wide rate.
        ...buildAdminCatalogFields(body),
        approvalStatus: 'approved'
    });
    await doc.save();
    return doc.toObject();
}

/** Grocery fields shared by the admin create and update paths. Undefined leaves the schema default. */
function buildAdminCatalogFields(body = {}) {
    const num = (value, { min = 0, max = Infinity } = {}) => {
        if (value === undefined || value === null || value === '') return undefined;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined;
        return parsed;
    };

    const mrp = num(body.mrp);
    const price = num(body.price);
    if (mrp !== undefined && price !== undefined && price > mrp) {
        throw new ValidationError(`Price cannot be above the MRP of ${mrp}`);
    }

    return {
        brand: typeof body.brand === 'string' ? body.brand.trim() : undefined,
        packSize: typeof body.packSize === 'string' ? body.packSize.trim() : undefined,
        sku: typeof body.sku === 'string' ? body.sku.trim() : undefined,
        // Scanned code (plan §5.6); `ean` accepted as the same field.
        barcode: normalizeBarcode(body.barcode ?? body.ean),
        mrp,
        gstRate: num(body.gstRate, { max: 100 }),
        stockQty: num(body.stockQty),
        lowStockThreshold: num(body.lowStockThreshold),
        maxQtyPerOrder: num(body.maxQtyPerOrder, { min: 1 })
    };
}

export async function updateFood(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodItem.findById(id);
    if (!doc) return null;
    const restaurant = await FoodRestaurant.findById(doc.restaurantId)
        .select('pureVegRestaurant')
        .lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }
    if (body.name !== undefined) doc.name = String(body.name || '').trim();
    if (body.description !== undefined) doc.description = String(body.description || '').trim();
    const targetFoodType = body.foodType !== undefined ? (body.foodType === 'Veg' ? 'Veg' : 'Non-Veg') : (doc.foodType === 'Veg' ? 'Veg' : 'Non-Veg');
    if (restaurant.pureVegRestaurant === true && targetFoodType !== 'Veg') {
        throw new ValidationError('Pure veg restaurants can only use veg foods');
    }
    const pricingUpdate = getAdminFoodUpdatedPricing(doc.toObject(), body);
    if (pricingUpdate.price !== undefined) doc.price = pricingUpdate.price;
    if (pricingUpdate.otherPrice !== undefined) doc.otherPrice = pricingUpdate.otherPrice;
    if (pricingUpdate.variants !== undefined) doc.variants = pricingUpdate.variants;
    const nextImages = normalizeFoodImages(body, doc.toObject());
    if (nextImages) {
        doc.images = nextImages.images;
        doc.image = nextImages.image;
    }
    if (body.foodType !== undefined) doc.foodType = targetFoodType;
    if (body.isAvailable !== undefined) doc.isAvailable = body.isAvailable !== false;
    if (body.preparationTime !== undefined) doc.preparationTime = String(body.preparationTime || '').trim();
    // MRP is validated against whichever price ends up on the document, so
    // editing either one alone cannot leave the item priced above its MRP.
    const adminCatalog = buildAdminCatalogFields({ ...body, price: body.price ?? doc.price, mrp: body.mrp ?? doc.mrp });
    for (const [field, value] of Object.entries(adminCatalog)) {
        if (body[field] !== undefined) doc[field] = value ?? null;
    }
    if (body.categoryId !== undefined || body.categoryName !== undefined || body.category !== undefined || body.foodType !== undefined) {
        const nextCategoryName = body.categoryName !== undefined
            ? String(body.categoryName || '').trim()
            : (body.category !== undefined ? String(body.category || '').trim() : doc.categoryName);
        const { categoryId, categoryName } = await resolveAdminFoodCategory({
            categoryId: body.categoryId !== undefined ? body.categoryId : doc.categoryId,
            categoryName: nextCategoryName,
            foodType: targetFoodType,
            pureVegRestaurant: restaurant.pureVegRestaurant === true
        });
        doc.categoryId = categoryId;
        doc.categoryName = categoryName;
    }
    await doc.save();
    // A count set here to 0 hides the product; a restock brings it back
    // (unless a seller switched it off by hand), as on the Stock page.
    if (body.stockQty !== undefined || body.variants !== undefined || body.variations !== undefined) {
        try {
            const { syncAvailability } = await import('../../orders/services/inventory.service.js');
            await syncAvailability(doc.toObject(), { revive: body.isAvailable !== false });
        } catch { /* availability is re-derived on the next stock change */ }
    }
    return doc.toObject();
}

export async function deleteFood(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodItem.findByIdAndDelete(id).lean();
    if (deleted?.restaurantId) {
        try {
            const { invalidateCache } = await import('../../../../middleware/cache.js');
            await invalidateCache(`restaurant_menu:${deleted.restaurantId}`);
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after food delete:', cacheErr);
        }
    }
    return deleted ? { id } : null;
}

export async function bulkDeleteFoods({ restaurantId, foodIds = [], selectAll = false, search = '' }) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(restaurantId)) {
        throw new ValidationError('Valid restaurantId is required');
    }

    const restaurant = await FoodRestaurant.findById(restaurantId).select('_id').lean();
    if (!restaurant?._id) {
        throw new ValidationError('Restaurant not found');
    }

    const filter = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };

    if (selectAll) {
        const term = String(search || '').trim();
        if (term) {
            filter.$or = [
                { name: { $regex: term, $options: 'i' } },
                { categoryName: { $regex: term, $options: 'i' } },
            ];
        }
    } else {
        const ids = (Array.isArray(foodIds) ? foodIds : [])
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id));
        if (ids.length === 0) {
            throw new ValidationError('No valid food items selected');
        }
        filter._id = { $in: ids };
    }

    const result = await FoodItem.deleteMany(filter);

    if (result.deletedCount > 0) {
        try {
            const { invalidateCache } = await import('../../../../middleware/cache.js');
            await invalidateCache(`restaurant_menu:${restaurantId}`);
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after bulk food delete:', cacheErr);
        }
    }

    return { deletedCount: result.deletedCount };
}

/** Admin creates a restaurant (JSON body with image URLs already uploaded). Single API. */
export async function createRestaurantByAdmin(body) {
    const loc = body.location || {};
    const toStr = (v) => (v != null && v !== undefined ? String(v).trim() : '');
    const toUrl = (v) => (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : undefined;
    const coordinates = Array.isArray(loc.coordinates) ? loc.coordinates : [];
    const lngFromCoordinates = toFiniteNumber(coordinates[0]);
    const latFromCoordinates = toFiniteNumber(coordinates[1]);
    const latitude = toFiniteNumber(loc.latitude ?? latFromCoordinates);
    const longitude = toFiniteNumber(loc.longitude ?? lngFromCoordinates);
    const menuUrls = Array.isArray(body.menuImages)
        ? body.menuImages.map((m) => toUrl(m)).filter(Boolean)
        : [];

    const normalizedOpeningTime = normalizeRestaurantTime(body.openingTime) || '09:00';
    const normalizedClosingTime = normalizeRestaurantTime(body.closingTime) || '22:00';
    validateOpeningClosingTimes(normalizedOpeningTime, normalizedClosingTime);

    const doc = {
        restaurantName: toStr(body.restaurantName) || toStr(body.name),
        ownerName: toStr(body.ownerName),
        ownerEmail: toStr(body.ownerEmail),
        ownerPhone: toStr(body.ownerPhone),
        primaryContactNumber: toStr(body.primaryContactNumber) || toStr(body.ownerPhone),
        pureVegRestaurant: body.pureVegRestaurant !== undefined
            ? parseBooleanLike(body.pureVegRestaurant, 'pureVegRestaurant')
            : false,
        addressLine1: toStr(loc.addressLine1),
        addressLine2: toStr(loc.addressLine2),
        area: toStr(loc.area),
        city: toStr(loc.city),
        state: toStr(loc.state),
        pincode: toStr(loc.pincode),
        landmark: toStr(loc.landmark),
        cuisines: Array.isArray(body.cuisines) ? body.cuisines : [],
        openingTime: normalizedOpeningTime,
        closingTime: normalizedClosingTime,
        openDays: Array.isArray(body.openDays) ? body.openDays : [],
        panNumber: toStr(body.panNumber),
        nameOnPan: toStr(body.nameOnPan),
        gstRegistered: Boolean(body.gstRegistered),
        gstNumber: toStr(body.gstNumber),
        gstLegalName: toStr(body.gstLegalName),
        gstAddress: toStr(body.gstAddress),
        fssaiNumber: toStr(body.fssaiNumber),
        fssaiExpiry: body.fssaiExpiry ? new Date(body.fssaiExpiry) : undefined,
        accountNumber: toStr(body.accountNumber),
        ifscCode: toStr(body.ifscCode),
        accountHolderName: toStr(body.accountHolderName),
        accountType: toStr(body.accountType),
        menuImages: menuUrls,
        profileImage: toUrl(body.profileImage),
        panImage: toUrl(body.panImage),
        gstImage: toUrl(body.gstImage),
        fssaiImage: toUrl(body.fssaiImage),
        estimatedDeliveryTime: toStr(body.estimatedDeliveryTime),
        featuredDish: toStr(body.featuredDish),
        featuredPrice: typeof body.featuredPrice === 'number' ? body.featuredPrice : (parseFloat(body.featuredPrice) || undefined),
        offer: toStr(body.offer),
        status: 'approved',
        approvedAt: new Date()
    };

    // What kind of shop this is. A new seller cannot be a pharmacy.
    doc.storeType = normalizeStoreTypeInput(body.storeType) || 'grocery';

    if (body.zoneId !== undefined) {
        const zoneId = String(body.zoneId || '').trim();
        if (!zoneId) {
            doc.zoneId = undefined;
        } else if (!mongoose.Types.ObjectId.isValid(zoneId)) {
            throw new ValidationError('Invalid zoneId');
        } else {
            doc.zoneId = new mongoose.Types.ObjectId(zoneId);
        }
    }

    if (latitude !== null && longitude !== null) {
        doc.location = {
            type: 'Point',
            coordinates: [longitude, latitude],
            latitude,
            longitude,
            formattedAddress: toStr(loc.formattedAddress || loc.address || loc.addressLine1),
            address: toStr(loc.address || loc.formattedAddress || loc.addressLine1),
            addressLine1: toStr(loc.addressLine1 || loc.formattedAddress || loc.address),
            addressLine2: toStr(loc.addressLine2),
            area: toStr(loc.area),
            city: toStr(loc.city),
            state: toStr(loc.state),
            pincode: toStr(loc.pincode || loc.zipCode || loc.postalCode),
            landmark: toStr(loc.landmark),
        };
    }

    if (!doc.restaurantName || !doc.ownerName) {
        throw new ValidationError('Restaurant name and owner name are required');
    }
    if (!doc.ownerPhone && !doc.primaryContactNumber) {
        throw new ValidationError('Owner phone or primary contact number is required');
    }

    // Prevent duplicate restaurant onboarding with the same contact number
    // across existing restaurants and restaurant-auth users.
    const phoneCandidates = [doc.ownerPhone, doc.primaryContactNumber]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    const normalizedPhoneCandidates = Array.from(
        new Set(
            phoneCandidates.flatMap((phone) => {
                const digits = phone.replace(/\D/g, '');
                const last10 = digits.slice(-10);
                return [phone, digits, last10].filter(Boolean);
            })
        )
    );

    if (normalizedPhoneCandidates.length) {
        const duplicateRestaurant = await FoodRestaurant.findOne({
            $or: [
                { ownerPhone: { $in: normalizedPhoneCandidates } },
                { primaryContactNumber: { $in: normalizedPhoneCandidates } },
                { ownerPhoneDigits: { $in: normalizedPhoneCandidates } },
                { ownerPhoneLast10: { $in: normalizedPhoneCandidates } },
            ],
        })
            .select('_id restaurantName ownerPhone primaryContactNumber')
            .lean();

        if (duplicateRestaurant?._id) {
            throw new ValidationError('A restaurant with this phone number already exists');
        }

        const duplicateRestaurantUser = await FoodUser.findOne({
            role: 'RESTAURANT',
            phone: { $in: normalizedPhoneCandidates },
        })
            .select('_id phone')
            .lean();

        if (duplicateRestaurantUser?._id) {
            throw new ValidationError('A restaurant account with this phone number already exists');
        }
    }

    const restaurant = await FoodRestaurant.create(doc);
    return restaurant.toObject();
}

export async function approveRestaurant(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    const existing = await FoodRestaurant.findById(id).lean();
    if (!existing) return null;

    const $set = {
        status: 'approved',
        approvedAt: new Date()
    };
    const $unset = {
        rejectedAt: 1,
        rejectionReason: 1
    };

    if (existing.locationUpdateStatus === 'pending' && existing.pendingLocation) {
        const pending = existing.pendingLocation;
        $set.location = pending;
        $set.addressLine1 = pending.addressLine1 || existing.addressLine1 || '';
        $set.addressLine2 = pending.addressLine2 || existing.addressLine2 || '';
        $set.area = pending.area || existing.area || '';
        $set.city = pending.city || existing.city || '';
        $set.state = pending.state || existing.state || '';
        $set.pincode = pending.pincode || existing.pincode || '';
        $set.landmark = pending.landmark || existing.landmark || '';
        if (existing.pendingZoneId) {
            $set.zoneId = existing.pendingZoneId;
        }
        $set.locationUpdateStatus = 'approved';
        $set.locationUpdateReviewedAt = new Date();
        $unset.pendingLocation = 1;
        $unset.pendingZoneId = 1;
        $unset.locationUpdateRequestedAt = 1;
        $unset.locationRejectionReason = 1;
    }

    const updated = await FoodRestaurant.findByIdAndUpdate(
        id,
        { $set, $unset },
        { new: true, runValidators: false }
    ).lean();

    if (updated) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated._id }],
                {
                    title: 'Congratulations! ',
                    body: `Your restaurant "${updated.restaurantName}" has been approved.`,
                    image: updated.profileImage || 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                    data: {
                        type: 'restaurant_approved',
                        restaurantId: String(updated._id)
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send restaurant approval notification:', e);
        }
    }
    return updated;
}

export async function rejectRestaurant(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;

    const existing = await FoodRestaurant.findById(id).lean();
    if (!existing) return null;

    if (existing.status === 'approved' && existing.locationUpdateStatus === 'pending') {
        const updated = await FoodRestaurant.findByIdAndUpdate(
            id,
            {
                $set: {
                    locationUpdateStatus: 'rejected',
                    locationUpdateReviewedAt: new Date(),
                    locationRejectionReason: typeof reason === 'string' ? reason.trim() : ''
                },
                $unset: {
                    pendingLocation: 1,
                    pendingZoneId: 1,
                    locationUpdateRequestedAt: 1
                }
            },
            { new: true, runValidators: false }
        ).lean();
        return updated;
    }

    const updated = await FoodRestaurant.findByIdAndUpdate(
        id,
        {
            $set: {
                status: 'rejected',
                rejectedAt: new Date(),
                rejectionReason: typeof reason === 'string' ? reason.trim() : undefined,
                approvedAt: null
            }
        },
        { new: true, runValidators: false }
    ).lean();

    if (updated) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated._id }],
                {
                    title: 'Update on Registration ðŸ“‹',
                    body: `Your restaurant registration for "${updated.restaurantName}" has been rejected. Reason: ${reason || 'Incomplete documents'}.`,
                    image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                    data: {
                        type: 'restaurant_rejected',
                        restaurantId: String(updated._id),
                        reason: reason || ''
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send restaurant rejection notification:', e);
        }
    }
    return updated;
}

// ----- Offers & Coupons -----
export async function getAllOffers(_query = {}) {
    const list = await FoodOffer.find({})
        .sort({ createdAt: -1 })
        .populate({ path: 'restaurantId', select: 'restaurantName' })
        .populate({ path: 'restaurantIds', select: 'restaurantName' })
        .lean();

    const offers = list.map((o, index) => {
        const now = Date.now();
        const endTs = o.endDate ? new Date(o.endDate).getTime() : null;
        const isExpired = Boolean(endTs && now >= endTs);
        const selectedRestaurants = Array.isArray(o.restaurantIds) && o.restaurantIds.length > 0
            ? o.restaurantIds
            : (o.restaurantId ? [o.restaurantId] : []);
        const restaurantName = o.restaurantScope === 'selected'
            ? (selectedRestaurants.map((restaurant) => restaurant?.restaurantName).filter(Boolean).join(', ') || 'Selected Restaurants')
            : 'All Restaurants';

        const discountPercentage = o.discountType === 'percentage' ? Number(o.discountValue) : 0;

        const originalPrice = o.discountType === 'flat-price' ? Number(o.discountValue) : 0;
        const discountedPrice = 0;

        return {
            sl: index + 1,
            offerId: String(o._id),
            dishId: 'all',
            restaurantName,
            dishName: 'All Items',
            couponCode: o.couponCode,
            customerGroup: o.customerScope === 'first-time' ? 'new' : 'all',
            discountType: o.discountType,
            discountPercentage,
            originalPrice,
            discountedPrice,
            status: isExpired ? 'inactive' : (o.status || 'active'),
            showInCart: o.showInCart !== false,
            endDate: o.endDate || null,
            // Additional info for admin UI (backward compatible)
            minOrderValue: o.minOrderValue ?? 0,
            maxDiscount: o.maxDiscount ?? null,
            usageLimit: o.usageLimit ?? null,
            usedCount: o.usedCount ?? 0,
            restaurantScope: o.restaurantScope,
            createdByRole: o.createdByRole || 'ADMIN',
            adminBearPercentage: Number(o.adminBearPercentage ?? (o.createdByRole === 'RESTAURANT' ? 0 : 100)),
            restaurantBearPercentage: Number(o.restaurantBearPercentage ?? (o.createdByRole === 'RESTAURANT' ? 100 : 0))
        };
    });

    return { offers };
}

export async function createAdminOffer(body) {
    const existing = await FoodOffer.findOne({ couponCode: body.couponCode }).lean();
    if (existing) {
        throw new ValidationError('Coupon code already exists');
    }

    const doc = await FoodOffer.create({
        couponCode: body.couponCode,
        discountType: body.discountType,
        discountValue: body.discountValue,
        customerScope: body.customerScope,
        restaurantScope: body.restaurantScope,
        restaurantId: body.restaurantScope === 'selected' ? body.restaurantId : undefined,
        restaurantIds: body.restaurantScope === 'selected' ? body.restaurantIds : [],
        minOrderValue: body.minOrderValue ?? 0,
        maxDiscount: body.maxDiscount ?? null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        startDate: body.startDate,
        isFirstOrderOnly: body.isFirstOrderOnly ?? false,
        endDate: body.endDate,
        status: body.endDate && new Date(body.endDate).getTime() <= Date.now() ? 'inactive' : 'active',
        showInCart: true,
        createdByRole: 'ADMIN',
        adminBearPercentage: body.adminBearPercentage ?? 100,
        restaurantBearPercentage: body.restaurantBearPercentage ?? 0
    });

    const selectedRestaurantIds = doc.restaurantScope === 'selected'
        ? (doc.restaurantIds?.length ? doc.restaurantIds : [doc.restaurantId]).filter(Boolean)
        : [];
    if (selectedRestaurantIds.length > 0) {
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                selectedRestaurantIds.map((ownerId) => ({ ownerType: 'RESTAURANT', ownerId })),
                {
                    title: 'New Campaign Invitation! ðŸ“¢',
                    body: `You have been invited to join a new campaign: "${doc.couponCode}". Check it out now!`,
                    image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                    data: {
                        type: 'campaign_invitation',
                        offerId: String(doc._id),
                        couponCode: doc.couponCode
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send campaign invitation notification:', e);
        }
    }

    return doc.toObject();
}

export async function updateAdminOfferCartVisibility(offerId, itemId, showInCart) {
    if (!offerId || !mongoose.Types.ObjectId.isValid(offerId)) return null;
    if (!itemId) return null;
    const updated = await FoodOffer.findByIdAndUpdate(
        offerId,
        { $set: { showInCart: Boolean(showInCart) } },
        { new: true }
    ).lean();
    return updated;
}

export async function deleteAdminOffer(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodOffer.findByIdAndDelete(id).lean();
    if (!deleted) return null;
    await FoodOfferUsage.deleteMany({ offerId: new mongoose.Types.ObjectId(id) });
    return { id };
}

export async function expireExpiredOffers() {
    const now = new Date();
    await FoodOffer.updateMany(
        { status: 'active', endDate: { $lte: now } },
        { $set: { status: 'inactive' } }
    );
}
// ----- Delivery join requests -----
export async function getDeliveryJoinRequests(query) {
    const { status = 'pending', page = 1, limit = 1000, search, zone, vehicleType } = query;
    const filter = {};
    if (status === 'pending') filter.status = 'pending';
    else if (status === 'denied' || status === 'rejected') filter.status = 'rejected';
    else filter.status = status;

    const andParts = [];
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        andParts.push({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } }
            ]
        });
    }
    if (zone && zone.trim()) {
        const z = zone.trim();
        andParts.push({
            $or: [
                { city: { $regex: z, $options: 'i' } },
                { state: { $regex: z, $options: 'i' } },
                { address: { $regex: z, $options: 'i' } }
            ]
        });
    }
    if (andParts.length) filter.$and = andParts;
    if (vehicleType && vehicleType.trim()) {
        filter.vehicleType = { $regex: vehicleType.trim(), $options: 'i' };
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    // A zone-limited sub-admin sees only riders in their zones (core/zones/riderZones.js).
    const riderZone = await safeRiderZoneFilter('quickCommerce', query.scopeZoneIds, FoodDeliveryPartner);
    if (riderZone) filter.$and = [...(filter.$and || []), riderZone];

    const list = await FoodDeliveryPartner.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean();

    const requests = list.map((doc, index) => ({
        _id: doc._id,
        sl: skip + index + 1,
        name: doc.name || '',
        email: doc.email || '',
        phone: doc.phone || '',
        zone: doc.city || doc.state || doc.address || '',
        jobType: doc.jobType || '',
        vehicleType: doc.vehicleType || '',
        status: doc.status === 'rejected' ? 'denied' : doc.status,
        rejectionReason: doc.rejectionReason || undefined,
        profilePhoto: doc.profilePhoto || null,
        profileImage: doc.profilePhoto ? { url: doc.profilePhoto } : null
    }));

    return { requests };
}

export function getDeliveryWalletsStub() {
    return {
        wallets: [],
        pagination: { page: 1, limit: 100, total: 0, pages: 0 }
    };
}

// ----- Support tickets -----
export async function getSupportTicketStats() {
    const [open, inProgress, resolved, closed] = await Promise.all([
        DeliverySupportTicket.countDocuments({ status: 'open' }),
        DeliverySupportTicket.countDocuments({ status: 'in_progress' }),
        DeliverySupportTicket.countDocuments({ status: 'resolved' }),
        DeliverySupportTicket.countDocuments({ status: 'closed' })
    ]);
    return {
        total: open + inProgress + resolved + closed,
        open,
        inProgress,
        resolved,
        closed
    };
}

export async function getDeliverySupportTickets(query = {}) {
    const { status, priority, search, page = 1, limit = 100 } = query;
    const filter = {};
    if (status && String(status).trim()) filter.status = String(status).trim();
    if (priority && String(priority).trim()) filter.priority = String(priority).trim();
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        filter.$or = [
            { subject: { $regex: term, $options: 'i' } },
            { description: { $regex: term, $options: 'i' } },
            { ticketId: { $regex: term, $options: 'i' } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(500, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(500, Number(limit) || 100));

    const [list, total] = await Promise.all([
        DeliverySupportTicket.find(filter)
            .populate('deliveryPartnerId', 'name phone email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean(),
        DeliverySupportTicket.countDocuments(filter)
    ]);

    const tickets = list.map((t) => ({
        _id: t._id,
        ticketId: t.ticketId,
        subject: t.subject,
        description: t.description,
        category: t.category,
        priority: t.priority,
        status: t.status,
        adminResponse: t.adminResponse,
        respondedAt: t.respondedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        deliveryPartner: t.deliveryPartnerId
            ? {
                _id: t.deliveryPartnerId._id,
                name: t.deliveryPartnerId.name || '',
                phone: t.deliveryPartnerId.phone || '',
                email: t.deliveryPartnerId.email || ''
            }
            : null
    }));

    return {
        tickets,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

export async function updateDeliverySupportTicket(id, body = {}) {
    const ticket = await DeliverySupportTicket.findById(id);
    if (!ticket) return null;
    const { status, adminResponse } = body || {};
    if (status !== undefined) {
        const allowed = ['open', 'in_progress', 'resolved', 'closed'];
        if (allowed.includes(String(status))) ticket.status = String(status);
    }
    if (adminResponse !== undefined) {
        ticket.adminResponse = typeof adminResponse === 'string' ? adminResponse.trim() : '';
        if (ticket.adminResponse) ticket.respondedAt = new Date();
    }
    await ticket.save();

    // Send notification if admin response was added
    if (adminResponse !== undefined && ticket.adminResponse && ticket.deliveryPartnerId) {
        await FoodNotification.create({
            ownerType: 'DELIVERY_PARTNER',
            ownerId: ticket.deliveryPartnerId,
            title: 'Support Ticket Response',
            message: `Admin has responded to your ticket: "${ticket.subject}"`,
            source: 'SUPPORT_RESPONSE',
            category: 'support',
            metadata: { ticketId: ticket._id }
        }).catch(err => console.error('Error creating delivery support notification:', err));

        // Also send push notification (FCM)
        await sendNotificationToOwner({
            ownerType: 'DELIVERY_PARTNER',
            ownerId: ticket.deliveryPartnerId,
            payload: {
                title: 'Support Ticket Response',
                body: `Admin has responded to your ticket: "${ticket.subject}"`,
                data: {
                    type: 'SUPPORT_RESPONSE',
                    ticketId: String(ticket._id)
                }
            }
        }).catch(err => console.error('Error sending delivery support push notification:', err));
    }

    return ticket.toObject();
}

/**
 * Subscription Settings
 */
export const getRestaurantSubscriptionSettings = async () => {
    const settings = await FoodRestaurantSubscriptionSettings.findOne();
    const raw = settings ? settings.toObject() : {};
    const starterPrice = Number(raw?.starterPrice ?? raw?.silverPrice ?? 999) || 999;
    const growthPrice = Number(raw?.growthPrice ?? raw?.goldPrice ?? 1999) || 1999;
    const premiumPrice = Number(raw?.premiumPrice ?? 2999) || 2999;
    const starterMinGmv = Number(raw?.starterMinGmv ?? 0) || 0;
    const starterMaxGmv = Number(raw?.starterMaxGmv ?? 30000) || 30000;
    const growthMinGmv = Number(raw?.growthMinGmv ?? (starterMaxGmv + 0.01)) || (starterMaxGmv + 0.01);
    const growthMaxGmv = Number(raw?.growthMaxGmv ?? 60000) || 60000;
    const premiumMinGmv = Number(raw?.premiumMinGmv ?? (growthMaxGmv + 0.01)) || (growthMaxGmv + 0.01);
    const onboardingFee = Math.max(0, Number(raw?.onboardingFee ?? 0) || 0);

    let planCatalog = null;
    try {
        const { buildPlanCatalog, GST_RATE } = await import('../../restaurant/services/subscriptionPlan.service.js');
        planCatalog = buildPlanCatalog({
            starterPrice,
            growthPrice,
            premiumPrice,
            starterMinGmv,
            starterMaxGmv,
            growthMinGmv,
            growthMaxGmv,
            premiumMinGmv,
        });
        return {
            ...raw,
            starterPrice,
            growthPrice,
            premiumPrice,
            starterMinGmv,
            starterMaxGmv,
            growthMinGmv,
            growthMaxGmv,
            premiumMinGmv,
            onboardingFee,
            planCatalog,
            gstRate: GST_RATE,
        };
    } catch {
        return {
            ...raw,
            starterPrice,
            growthPrice,
            premiumPrice,
            starterMinGmv,
            starterMaxGmv,
            growthMinGmv,
            growthMaxGmv,
            premiumMinGmv,
            onboardingFee,
        };
    }
};


export const updateRestaurantSubscriptionSettings = async (data) => {
    let settings = await FoodRestaurantSubscriptionSettings.findOne();
    if (!settings) {
        settings = new FoodRestaurantSubscriptionSettings();
    }

    if (data.starterPrice !== undefined) settings.starterPrice = Math.max(0, Number(data.starterPrice) || 0);
    if (data.growthPrice !== undefined) settings.growthPrice = Math.max(0, Number(data.growthPrice) || 0);
    if (data.premiumPrice !== undefined) settings.premiumPrice = Math.max(0, Number(data.premiumPrice) || 0);
    if (data.starterMinGmv !== undefined) settings.starterMinGmv = Math.max(0, Number(data.starterMinGmv) || 0);
    if (data.starterMaxGmv !== undefined) settings.starterMaxGmv = Math.max(0, Number(data.starterMaxGmv) || 0);
    if (data.growthMinGmv !== undefined) settings.growthMinGmv = Math.max(0, Number(data.growthMinGmv) || 0);
    if (data.growthMaxGmv !== undefined) settings.growthMaxGmv = Math.max(0, Number(data.growthMaxGmv) || 0);
    if (data.premiumMinGmv !== undefined) settings.premiumMinGmv = Math.max(0, Number(data.premiumMinGmv) || 0);
    if (data.onboardingFee !== undefined) settings.onboardingFee = Math.max(0, Number(data.onboardingFee) || 0);

    // Keep ranges monotonic and contiguous by default.
    settings.starterMinGmv = Math.min(Number(settings.starterMinGmv || 0), Number(settings.starterMaxGmv || 0));
    if (Number(settings.growthMinGmv || 0) < Number(settings.starterMaxGmv || 0)) {
        settings.growthMinGmv = Number(settings.starterMaxGmv || 0);
    }
    if (Number(settings.growthMaxGmv || 0) < Number(settings.growthMinGmv || 0)) {
        settings.growthMaxGmv = Number(settings.growthMinGmv || 0);
    }
    if (Number(settings.premiumMinGmv || 0) < Number(settings.growthMaxGmv || 0)) {
        settings.premiumMinGmv = Number(settings.growthMaxGmv || 0);
    }

    await settings.save();
    return getRestaurantSubscriptionSettings();
};

export const getAdminRestaurantSubscriptionHistory = async (query = {}) => {
    return getAdminRestaurantSubscriptionHistoryFromRestaurant(query);
};

// ----- Delivery partners (approved list) -----
/**
 * Private helper to get financial stats for multiple delivery partners in bulk.
 */
async function getBulkDeliveryPartnerStats(partnerIds) {
    if (!partnerIds || partnerIds.length === 0) return new Map();

    const [earnings, cash, deposits, bonuses, withdrawals, ordersCount] = await Promise.all([
        // Total Earnings
        FoodOrder.aggregate([
            { $match: { 'dispatch.deliveryPartnerId': { $in: partnerIds }, orderStatus: 'delivered' } },
            { $group: { _id: '$dispatch.deliveryPartnerId', total: { $sum: { $ifNull: ['$riderEarning', 0] } } } }
        ]),
        // Cash Collected (COD)
        FoodOrder.aggregate([
            { $match: { 
                'dispatch.deliveryPartnerId': { $in: partnerIds }, 
                orderStatus: 'delivered', 
                $or: [ { paymentMethod: 'cash' }, { 'payment.method': 'cash' } ] 
            } },
            { $group: { _id: '$dispatch.deliveryPartnerId', total: { $sum: { $ifNull: ['$pricing.total', 0] } } } }
        ]),
        // Cash Deposits
        FoodDeliveryCashDeposit.aggregate([
            { $match: { deliveryPartnerId: { $in: partnerIds }, status: 'Completed' } },
            { $group: { _id: '$deliveryPartnerId', total: { $sum: '$amount' } } }
        ]),
        // Bonuses
        DeliveryBonusTransaction.aggregate([
            { $match: { deliveryPartnerId: { $in: partnerIds } } },
            { $group: { _id: '$deliveryPartnerId', total: { $sum: '$amount' } } }
        ]),
        // Withdrawals
        FoodDeliveryWithdrawal.aggregate([
            { $match: { deliveryPartnerId: { $in: partnerIds }, status: { $in: ['approved', 'pending'] } } },
            { $group: { 
                _id: '$deliveryPartnerId', 
                approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] } },
                pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } }
            } }
        ]),
        // Total Delivered Orders
        FoodOrder.aggregate([
            { $match: { 'dispatch.deliveryPartnerId': { $in: partnerIds }, orderStatus: 'delivered' } },
            { $group: { _id: '$dispatch.deliveryPartnerId', count: { $sum: 1 } } }
        ])
    ]);

    const statsMap = new Map();
    partnerIds.forEach(id => {
        const idStr = id.toString();
        statsMap.set(idStr, {
            totalEarning: 0,
            cashCollected: 0,
            totalDeposited: 0,
            bonus: 0,
            totalWithdrawn: 0,
            pendingWithdrawal: 0,
            totalOrders: 0
        });
    });

    earnings.forEach(row => { if (row._id) statsMap.get(row._id.toString()).totalEarning = row.total; });
    cash.forEach(row => { if (row._id) statsMap.get(row._id.toString()).cashCollected = row.total; });
    deposits.forEach(row => { if (row._id) statsMap.get(row._id.toString()).totalDeposited = row.total; });
    bonuses.forEach(row => { if (row._id) statsMap.get(row._id.toString()).bonus = row.total; });
    withdrawals.forEach(row => { 
        if (row._id) {
            statsMap.get(row._id.toString()).totalWithdrawn = row.approved;
            statsMap.get(row._id.toString()).pendingWithdrawal = row.pending;
        }
    });
    ordersCount.forEach(row => { if (row._id) statsMap.get(row._id.toString()).totalOrders = row.count; });

    // Calculate final pocket balance and other fields
    for (const [id, stats] of statsMap) {
        stats.pocketBalance = stats.totalEarning + stats.bonus - stats.totalWithdrawn - stats.pendingWithdrawal;
        stats.cashInHand = stats.cashCollected - stats.totalDeposited;
    }

    return statsMap;
}

// ----- Delivery partners (approved list) -----
export async function getDeliveryPartners(query) {
    const { page = 1, limit = 1000, search } = query;
    const filter = { status: 'approved' };
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        filter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { phone: { $regex: term, $options: 'i' } },
            { email: { $regex: term, $options: 'i' } },
            { city: { $regex: term, $options: 'i' } },
            { state: { $regex: term, $options: 'i' } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    const riderZone = await safeRiderZoneFilter('quickCommerce', query.scopeZoneIds, FoodDeliveryPartner);
    if (riderZone) filter.$and = [...(filter.$and || []), riderZone];

    const [list, total] = await Promise.all([
        FoodDeliveryPartner.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean(),
        FoodDeliveryPartner.countDocuments(filter)
    ]);

    const partnerIds = list.map(p => p._id);
    const statsMap = await getBulkDeliveryPartnerStats(partnerIds);

    const deliveryPartners = list.map((doc, index) => {
        const stats = statsMap.get(doc._id.toString()) || {};
        const lastLat = toFiniteNumber(doc.lastLat ?? doc.lastLocation?.coordinates?.[1]);
        const lastLng = toFiniteNumber(doc.lastLng ?? doc.lastLocation?.coordinates?.[0]);
        const lastLocation = lastLat !== null && lastLng !== null
            ? {
                lat: lastLat,
                lng: lastLng,
                latitude: lastLat,
                longitude: lastLng,
                timestamp: doc.lastLocationAt ? new Date(doc.lastLocationAt).getTime() : null
            }
            : null;
        return {
            _id: doc._id,
            sl: skip + index + 1,
            name: doc.name || '',
            email: doc.email || '',
            phone: doc.phone || '',
            deliveryId: doc._id ? `DP-${doc._id.toString().slice(-8).toUpperCase()}` : null,
            zone: doc.city || doc.state || doc.address || '',
            vehicleType: doc.vehicleType || '',
            status: doc.status,
            availabilityStatus: doc.availabilityStatus || 'offline',
            isOnline: doc.availabilityStatus === 'online',
            lastLocation,
            lastLat,
            lastLng,
            lastLocationAt: doc.lastLocationAt || null,
            // Whether this rider can actually be sent an order offer.
            //
            // A rider with no push token is invisible to dispatch no matter how
            // online they look, and nothing surfaced that: five of six online
            // riders sat unreachable for hours while the list showed them green.
            // Exposed as a field so the panel can say so instead of it being
            // discoverable only from server logs.
            hasPushToken:
                (Array.isArray(doc.fcmTokenMobile) && doc.fcmTokenMobile.length > 0) ||
                (Array.isArray(doc.fcmTokens) && doc.fcmTokens.length > 0),
            profilePhoto: doc.profilePhoto || null,
            profileImage: doc.profilePhoto ? { url: doc.profilePhoto } : null,
            // Stats fields
            totalOrders: stats.totalOrders || 0,
            pocketBalance: stats.pocketBalance || 0,
            cashInHand: stats.cashInHand || 0,
            totalEarning: stats.totalEarning || 0,
            bonus: stats.bonus || 0,
            totalWithdrawn: stats.totalWithdrawn || 0,
            pendingWithdrawal: stats.pendingWithdrawal || 0
        };
    });

    return {
        deliveryPartners,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

// ----- Delivery partner bonus (admin) -----
function generateBonusTransactionId() {
    const n = Date.now().toString(36).slice(-6).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `BON-${n}${r}`;
}

export async function getDeliveryPartnerBonusTransactions(query = {}) {
    const { page = 1, limit = 1000, search } = query;
    const filter = {};

    // For search (name/phone/email/transactionId) we do a two-step lookup to keep it simple.
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        const partnerIds = await FoodDeliveryPartner.find({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } },
                { email: { $regex: term, $options: 'i' } }
            ]
        }).select('_id').lean();
        filter.$or = [
            { transactionId: { $regex: term, $options: 'i' } },
            { deliveryPartnerId: { $in: partnerIds.map((p) => p._id) } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    const [list, total] = await Promise.all([
        DeliveryBonusTransaction.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate({ path: 'deliveryPartnerId', select: 'name phone email' })
            .lean(),
        DeliveryBonusTransaction.countDocuments(filter)
    ]);

    const transactions = list.map((t, index) => {
        const partner = t.deliveryPartnerId;
        const partnerId = partner?._id ? String(partner._id) : null;
        return {
            sl: skip + index + 1,
            transactionId: t.transactionId,
            deliveryPartnerId: partnerId,
            deliveryId: partnerId ? `DP-${partnerId.slice(-8).toUpperCase()}` : null,
            deliveryman: partner?.name || '',
            amount: t.amount,
            bonus: t.amount, // legacy compatibility
            reference: t.reference || '',
            createdAt: t.createdAt
        };
    });

    return {
        transactions,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

export async function addDeliveryPartnerBonus(body, adminUser) {
    const partner = await FoodDeliveryPartner.findById(body.deliveryPartnerId).lean();
    if (!partner) {
        throw new ValidationError('Delivery partner not found');
    }
    if (partner.status !== 'approved') {
        throw new ValidationError('Delivery partner must be approved');
    }

    let transactionId = generateBonusTransactionId();
    let exists = await DeliveryBonusTransaction.findOne({ transactionId }).lean();
    while (exists) {
        transactionId = generateBonusTransactionId();
        exists = await DeliveryBonusTransaction.findOne({ transactionId }).lean();
    }

    const amountToCredit = Number(body.amount) || 0;
    if (amountToCredit <= 0) {
        throw new ValidationError('Bonus amount must be greater than 0');
    }

    const created = await DeliveryBonusTransaction.create({
        deliveryPartnerId: body.deliveryPartnerId,
        transactionId,
        amount: amountToCredit,
        reference: body.reference || '',
        createdByAdminId: adminUser?._id
    });

    // Keep wallet ledger in sync so pocket balance updates immediately in delivery app.
    await FoodDeliveryWallet.findOneAndUpdate(
        { deliveryPartnerId: body.deliveryPartnerId },
        { $inc: { balance: amountToCredit, totalBonus: amountToCredit } },
        { upsert: true }
    );

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: body.deliveryPartnerId },
            {
                title: 'Bonus Credited!',
                body: `You have received a bonus of \u20B9${amountToCredit}. ${body.reference || 'Great job!'}`,
                image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                data: {
                    type: 'bonus_credited',
                    amount: String(amountToCredit),
                    transactionId: created.transactionId
                }
            }
        );
    } catch (e) {
        console.error('Failed to send bonus notification:', e);
    }

    return created.toObject();
}

// ----- Delivery Earnings (admin) -----
export async function getDeliveryEarnings(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.max(1, Math.min(1000, parseInt(query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = {
        'dispatch.deliveryPartnerId': { $ne: null }
    };

    // Date range filters
    const createdAtFilter = {};
    if (query.fromDate) {
        const from = new Date(query.fromDate);
        if (!Number.isNaN(from.getTime())) {
            from.setHours(0, 0, 0, 0);
            createdAtFilter.$gte = from;
        }
    }
    if (query.toDate) {
        const to = new Date(query.toDate);
        if (!Number.isNaN(to.getTime())) {
            to.setHours(23, 59, 59, 999);
            createdAtFilter.$lte = to;
        }
    }

    // Period filters (only when explicit date range is not provided)
    if (!createdAtFilter.$gte && !createdAtFilter.$lte) {
        const period = String(query.period || 'all').trim().toLowerCase();
        const now = new Date();
        if (period === 'today') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        } else if (period === 'week') {
            const start = new Date(now);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() - start.getDay()); // Sunday
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        } else if (period === 'month') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$gte = start;
            createdAtFilter.$lte = end;
        }
    }

    if (createdAtFilter.$gte || createdAtFilter.$lte) {
        filter.createdAt = createdAtFilter;
    }

    if (query.deliveryPartnerId && mongoose.Types.ObjectId.isValid(query.deliveryPartnerId)) {
        filter['dispatch.deliveryPartnerId'] = new mongoose.Types.ObjectId(query.deliveryPartnerId);
    }

    const search = String(query.search || '').trim();
    if (search) {
        const regex = new RegExp(search, 'i');

        const [partners, restaurants] = await Promise.all([
            FoodDeliveryPartner.find({
                $or: [{ name: regex }, { phone: regex }, { email: regex }]
            }).select('_id').lean(),
            FoodRestaurant.find({
                $or: [{ restaurantName: regex }, { name: regex }]
            }).select('_id').lean()
        ]);

        const partnerIds = partners.map((p) => p._id);
        const restaurantIds = restaurants.map((r) => r._id);

        filter.$or = [
            { orderId: regex },
            { 'dispatch.deliveryPartnerId': { $in: partnerIds } },
            { restaurantId: { $in: restaurantIds } }
        ];
    }

    const [orders, total, earningsAgg, distinctPartners] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('orderId orderStatus createdAt pricing riderEarning deliveryPartnerSettlement dispatch.deliveryPartnerId restaurantId')
            .populate({ path: 'dispatch.deliveryPartnerId', select: 'name phone' })
            .populate({ path: 'restaurantId', select: 'restaurantName name' })
            .lean(),
        FoodOrder.countDocuments(filter),
        FoodOrder.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    totalEarnings: {
                        $sum: {
                            $ifNull: [
                                '$riderEarning',
                                {
                                    $ifNull: [
                                        '$deliveryPartnerSettlement',
                                        { $ifNull: ['$pricing.deliveryFee', 0] }
                                    ]
                                }
                            ]
                        }
                    },
                    totalOrders: { $sum: 1 }
                }
            }
        ]),
        FoodOrder.distinct('dispatch.deliveryPartnerId', filter)
    ]);

    const earnings = orders.map((order) => {
        const partner = order?.dispatch?.deliveryPartnerId;
        const amount = Number(
            order?.riderEarning ??
            order?.deliveryPartnerSettlement ??
            order?.pricing?.deliveryFee ??
            0
        ) || 0;

        return {
            transactionId: String(order._id),
            orderId: order.orderId || 'N/A',
            deliveryPartnerId: partner?._id ? String(partner._id) : null,
            deliveryPartnerName: partner?.name || 'N/A',
            deliveryPartnerPhone: partner?.phone || 'N/A',
            restaurantName: order?.restaurantId?.restaurantName || order?.restaurantId?.name || 'N/A',
            amount,
            orderTotal: Number(order?.pricing?.total || 0) || 0,
            deliveryFee: Number(order?.pricing?.deliveryFee || 0) || 0,
            orderStatus: order?.orderStatus || 'N/A',
            createdAt: order?.createdAt || null
        };
    });

    const agg = earningsAgg?.[0] || {};
    const totalDeliveryPartners = (distinctPartners || []).filter(Boolean).length;

    return {
        earnings,
        summary: {
            totalDeliveryPartners,
            totalEarnings: Number(agg.totalEarnings || 0),
            totalOrders: Number(agg.totalOrders || 0)
        },
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit) || 1
        }
    };
}

// ----- Earning Addon Offers (admin) -----
export async function getEarningAddons() {
    const list = await FoodEarningAddon.find({})
        .sort({ createdAt: -1 })
        .lean();

    const now = Date.now();
    const earningAddons = list.map((a) => {
        const start = a.startDate ? new Date(a.startDate).getTime() : 0;
        const end = a.endDate ? new Date(a.endDate).getTime() : 0;
        const isValid = Boolean(a.status === 'active' && start && end && now >= start && now <= end);
        const isExpired = Boolean(end && now > end);

        return {
            ...a,
            isValid,
            status: isExpired ? 'expired' : (a.status || 'inactive')
        };
    });

    return { earningAddons };
}

/*
 * Earning Addon is retired. Each service's offers counted only that service's
 * orders (Food offers ignored Quick deliveries), while riders take
 * every kind. Master > Delivery Incentives replaces it: one ladder that counts
 * Food and Quick orders together. Credited history stays
 * readable; no new offer is shown, created or credited.
 */
export const EARNING_ADDON_RETIRED_MESSAGE =
    'Earning Addon has been replaced by Master > Delivery Incentives, which counts every order type together.';

export async function createEarningAddon(body) {
    throw new ValidationError(EARNING_ADDON_RETIRED_MESSAGE);
    const created = await FoodEarningAddon.create({
        title: body.title,
        requiredOrders: body.requiredOrders,
        earningAmount: body.earningAmount,
        startDate: body.startDate,
        endDate: body.endDate,
        maxRedemptions: body.maxRedemptions ?? null,
        status: 'active'
    });
    return created.toObject();
}

export async function updateEarningAddon(id, body) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await FoodEarningAddon.findById(id);
    if (!doc) return null;
    doc.title = body.title;
    doc.requiredOrders = body.requiredOrders;
    doc.earningAmount = body.earningAmount;
    doc.startDate = body.startDate;
    doc.endDate = body.endDate;
    doc.maxRedemptions = body.maxRedemptions ?? null;
    await doc.save();
    return doc.toObject();
}

export async function deleteEarningAddon(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const deleted = await FoodEarningAddon.findByIdAndDelete(id).lean();
    return deleted ? { id } : null;
}

export async function toggleEarningAddonStatus(id, status) {
    if (String(status) === 'active') throw new ValidationError(EARNING_ADDON_RETIRED_MESSAGE);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    return FoodEarningAddon.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean();
}

// ----- Earning Addon History (admin) -----
export async function getEarningAddonHistory(query = {}) {
    const { page = 1, limit = 1000, search } = query;
    const filter = {};

    // Optional search by delivery partner name/phone/email or offer title.
    // Keep it simple and fast: only apply when search is provided.
    let partnerIds = null;
    let offerIds = null;
    if (search && typeof search === 'string' && search.trim()) {
        const term = search.trim();
        partnerIds = await FoodDeliveryPartner.find({
            $or: [
                { name: { $regex: term, $options: 'i' } },
                { phone: { $regex: term, $options: 'i' } },
                { email: { $regex: term, $options: 'i' } }
            ]
        }).select('_id').lean();
        offerIds = await FoodEarningAddon.find({ title: { $regex: term, $options: 'i' } }).select('_id').lean();
        filter.$or = [
            { deliveryPartnerId: { $in: (partnerIds || []).map((p) => p._id) } },
            { offerId: { $in: (offerIds || []).map((o) => o._id) } }
        ];
    }

    const skip = Math.max(0, (Number(page) || 1) - 1) * Math.max(1, Math.min(1000, Number(limit) || 100));
    const limitNum = Math.max(1, Math.min(1000, Number(limit) || 100));

    const [list, total] = await Promise.all([
        FoodEarningAddonHistory.find(filter)
            .sort({ completedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate({ path: 'deliveryPartnerId', select: 'name phone email' })
            .populate({ path: 'offerId', select: 'title requiredOrders earningAmount' })
            .lean(),
        FoodEarningAddonHistory.countDocuments(filter)
    ]);

    const history = list.map((h, index) => {
        const partner = h.deliveryPartnerId;
        const offer = h.offerId;
        const partnerId = partner?._id ? String(partner._id) : null;
        return {
            _id: h._id,
            sl: skip + index + 1,
            deliveryPartnerId: partnerId,
            deliveryId: partnerId ? `DP-${partnerId.slice(-8).toUpperCase()}` : null,
            deliveryman: partner?.name || '',
            deliveryPhone: partner?.phone || 'N/A',
            offerTitle: offer?.title || '',
            ordersCompleted: h.ordersCompleted ?? 0,
            ordersRequired: h.ordersRequired ?? offer?.requiredOrders ?? 0,
            earningAmount: h.earningAmount ?? offer?.earningAmount ?? 0,
            totalEarning: h.totalEarning ?? h.earningAmount ?? 0,
            status: h.status || 'pending',
            date: h.completedAt || h.createdAt,
            completedAt: h.completedAt || h.createdAt
        };
    });

    return {
        history,
        pagination: {
            page: Number(page) || 1,
            limit: limitNum,
            total,
            pages: Math.ceil(total / limitNum) || 1
        }
    };
}

export async function creditEarningAddonHistory(historyId, notes) {
    if (!historyId || !mongoose.Types.ObjectId.isValid(historyId)) return null;
    const doc = await FoodEarningAddonHistory.findById(historyId).populate('offerId');
    if (!doc) return null;
    if (doc.status !== 'pending') return doc.toObject();

    const amountToCredit = Number(doc.earningAmount || 0);

    // 1. Update history status
    doc.status = 'credited';
    doc.creditedAt = new Date();
    doc.creditedNotes = typeof notes === 'string' ? notes.trim() : '';
    await doc.save();

    // 2. Credit the wallet
    if (amountToCredit > 0) {
        await FoodDeliveryWallet.findOneAndUpdate(
            { deliveryPartnerId: doc.deliveryPartnerId },
            { $inc: { balance: amountToCredit, totalEarnings: amountToCredit } },
            { upsert: true }
        );

        // 3. Create a transaction for ledger
        try {
            await DeliveryBonusTransaction.create({
                deliveryPartnerId: doc.deliveryPartnerId,
                transactionId: `ADDON-${String(doc._id).slice(-8).toUpperCase()}-${Date.now().toString().slice(-4)}`,
                amount: amountToCredit,
                reference: `Earning Addon: ${doc.offerId?.title || 'Offer Reward'}`
            });
        } catch (txnError) {
            console.error('Failed to create bonus transaction:', txnError);
            // Non-blocking but should be logged.
        }
    }

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: doc.deliveryPartnerId },
            {
                title: 'Incentive Credited! ðŸŽ¯',
                body: `Your incentive for "${doc.offerId?.title || 'Earning Addon'}" has been approved and moved to your pocket.`,
                image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                data: {
                    type: 'incentive_credited',
                    historyId: String(doc._id),
                    amount: String(doc.earningAmount || 0)
                }
            }
        );
    } catch (e) {
        console.error('Failed to send incentive credited notification:', e);
    }

    return doc.toObject();
}

export async function cancelEarningAddonHistory(historyId, reason) {
    if (!historyId || !mongoose.Types.ObjectId.isValid(historyId)) return null;
    const doc = await FoodEarningAddonHistory.findById(historyId).populate('offerId');
    if (!doc) return null;
    if (doc.status !== 'pending') return doc.toObject();
    doc.status = 'cancelled';
    doc.cancelledAt = new Date();
    doc.cancelReason = typeof reason === 'string' ? reason.trim() : '';
    await doc.save();

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: doc.deliveryPartnerId },
            {
                title: 'Incentive Update ðŸ“‹',
                body: `Your incentive request for "${doc.offerId?.title || 'Earning Addon'}" was not approved. Reason: ${doc.cancelReason || 'Ineligible'}`,
                image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                data: {
                    type: 'incentive_rejected',
                    historyId: String(doc._id),
                    reason: doc.cancelReason
                }
            }
        );
    } catch (e) {
        console.error('Failed to send incentive rejection notification:', e);
    }

    return doc.toObject();
}

export async function checkEarningAddonCompletions(deliveryPartnerId, _force = false) {
    // Retired (see EARNING_ADDON_RETIRED_MESSAGE): nothing new is credited.
    return { completionsFound: 0, retired: true };
    const now = new Date();
    
    // Only search for active offers that are currently running.
    const activeOffers = await FoodEarningAddon.find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now }
    }).lean();

    if (activeOffers.length === 0) return { completionsFound: 0 };

    let partnerIds = [];
    if (deliveryPartnerId === 'all') {
        const partners = await FoodDeliveryPartner.find({ status: 'approved' }).select('_id').lean();
        partnerIds = partners.map(p => p._id);
    } else if (deliveryPartnerId && mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
        partnerIds = [deliveryPartnerId];
    }

    if (partnerIds.length === 0) return { completionsFound: 0 };

    let globalCompletions = 0;

    for (const pId of partnerIds) {
        for (const offer of activeOffers) {
            // Find existing history so we don't grant it twice for the same offer.
            const existing = await FoodEarningAddonHistory.findOne({
                deliveryPartnerId: pId,
                offerId: offer._id,
                status: { $in: ['pending', 'credited'] }
            }).lean();

            if (existing) continue;

            // Count orders delivered by this partner during the offer period.
            const orderCount = await FoodOrder.countDocuments({
                'dispatch.deliveryPartnerId': pId,
                orderStatus: 'delivered',
                createdAt: { $gte: offer.startDate, $lte: offer.endDate }
            });

            if (orderCount >= (offer.requiredOrders || 1)) {
                // Requirement met!
                await FoodEarningAddonHistory.create({
                    offerId: offer._id,
                    deliveryPartnerId: pId,
                    ordersCompleted: orderCount,
                    ordersRequired: offer.requiredOrders,
                    earningAmount: offer.earningAmount,
                    totalEarning: offer.earningAmount,
                    status: 'pending',
                    completedAt: now
                });
                
                // Update current redemptions in addon
                await FoodEarningAddon.findByIdAndUpdate(offer._id, { $inc: { currentRedemptions: 1 } });
                
                globalCompletions++;
            }
        }
    }

    return { completionsFound: globalCompletions };
}

export async function getDeliveryPartnerById(id) {
    const partner = await FoodDeliveryPartner.findById(id).lean();
    if (!partner) return null;
    const deliveryId = partner._id ? `DP-${partner._id.toString().slice(-8).toUpperCase()}` : null;
    return {
        ...partner,
        email: partner.email || null,
        deliveryId,
        status: partner.status === 'rejected' ? 'blocked' : partner.status,
        profileImage: partner.profilePhoto ? { url: partner.profilePhoto } : null,
        documents: {
            aadhar: (partner.aadharPhoto || partner.aadharNumber)
                ? { number: partner.aadharNumber || null, document: partner.aadharPhoto || null }
                : null,
            pan: (partner.panPhoto || partner.panNumber)
                ? { number: partner.panNumber || null, document: partner.panPhoto || null }
                : null,
            drivingLicense: partner.drivingLicensePhoto ? { document: partner.drivingLicensePhoto } : null,
            bankDetails:
                partner.bankAccountHolderName || partner.bankAccountNumber || partner.bankIfscCode || partner.bankName
                    ? {
                        accountHolderName: partner.bankAccountHolderName || null,
                        accountNumber: partner.bankAccountNumber || null,
                        ifscCode: partner.bankIfscCode || null,
                        bankName: partner.bankName || null
                    }
                    : null
        },
        location: (partner.address || partner.city || partner.state)
            ? { addressLine1: partner.address, city: partner.city, state: partner.state }
            : null,
        vehicle: (partner.vehicleType || partner.vehicleName || partner.vehicleNumber)
            ? {
                type: partner.vehicleType,
                brand: partner.vehicleName,
                model: partner.vehicleName,
                number: partner.vehicleNumber
            }
            : null
    };
}

export async function getDeliverymanReviews(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {
        'ratings.deliveryPartner.rating': { $exists: true, $ne: null }
    };

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const searchRegex = new RegExp(term, 'i');
        
        // Find delivery partners matching search
        const partners = await FoodDeliveryPartner.find({
            $or: [
                { name: searchRegex },
                { phone: searchRegex }
            ]
        }).select('_id').lean();
        
        // Find customers matching search
        const customers = await FoodUser.find({
            $or: [
                { name: searchRegex },
                { email: searchRegex }
            ]
        }).select('_id').lean();

        filter.$or = [
            { orderId: searchRegex },
            { 'ratings.deliveryPartner.comment': searchRegex },
            { 'dispatch.deliveryPartnerId': { $in: partners.map(p => p._id) } },
            { userId: { $in: customers.map(c => c._id) } }
        ];
    }

    const [docs, total] = await Promise.all([
        FoodOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email phone')
            .populate('dispatch.deliveryPartnerId', 'name phone')
            .select('orderId userId dispatch.deliveryPartnerId ratings.deliveryPartner createdAt deliveryState.deliveredAt')
            .lean(),
        FoodOrder.countDocuments(filter)
    ]);

    const reviews = docs.map((doc, index) => ({
        sl: skip + index + 1,
        orderId: doc.orderId,
        deliveryman: doc.dispatch?.deliveryPartnerId?.name || 'Unknown',
        deliverymanId: doc.dispatch?.deliveryPartnerId?._id || 'N/A',
        deliverymanPhone: doc.dispatch?.deliveryPartnerId?.phone || 'N/A',
        customer: doc.userId?.name || 'Unknown',
        customerId: doc.userId?._id || 'N/A',
        customerPhone: doc.userId?.phone || 'N/A',
        review: doc.ratings?.deliveryPartner?.comment || '',
        rating: doc.ratings?.deliveryPartner?.rating || 0,
        submittedAt: doc.createdAt,
        deliveredAt: doc.deliveryState?.deliveredAt
    }));

    return { reviews, total, page, limit };
}

export async function approveDeliveryPartner(id) {
    const partner = await FoodDeliveryPartner.findById(id);
    if (!partner) return null;
    partner.status = 'approved';
    partner.approvedAt = new Date();
    partner.rejectedAt = undefined;
    partner.rejectionReason = undefined;
    await partner.save();

    try {
        const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnerSafely(
            { ownerType: 'DELIVERY_PARTNER', ownerId: partner._id },
            {
                title: 'Welcome Aboard!',
                body: `Your delivery partner application has been approved. You can now go online and start earning!`,
                image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                data: {
                    type: 'delivery_partner_approved',
                    eventType: 'delivery_partner_approved',
                    partnerId: String(partner._id),
                    targetUrl: '/delivery'
                }
            }
        );
    } catch (e) {
        console.error('Failed to send delivery partner approval notification:', e);
    }

    // Referral crediting deliberately does NOT happen here. Approval alone is not enough
    // to earn the bonus — the referred rider must also complete one delivery. The reward is
    // credited by creditDeliveryReferralOnFirstDelivery(), invoked from completeDelivery in
    // modules/food/orders/services/order-delivery.service.js.
    return partner.toObject();
}

export async function rejectDeliveryPartner(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
    const updated = await FoodDeliveryPartner.findByIdAndUpdate(
        id,
        {
            $set: {
                status: 'rejected',
                rejectedAt: new Date(),
                rejectionReason: typeof reason === 'string' ? reason.trim() : undefined,
                approvedAt: null
            }
        },
        { new: true }
    ).lean();

    if (updated) {
        try {
            const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnerSafely(
                { ownerType: 'DELIVERY_PARTNER', ownerId: updated._id },
                {
                    title: 'Onboarding Update ðŸ“‹',
                    body: `Your application to join as a delivery partner was rejected. Reason: ${reason || 'Incomplete documents'}.`,
                    image: 'https://i.ibb.co/5GzXz7r/Switcheats-Brand-Image.png',
                    data: {
                        type: 'onboarding_rejected',
                        partnerId: String(updated._id),
                        reason: reason || ''
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send delivery partner rejection notification:', e);
        }
    }
    return updated;
}

// ----- Zones CRUD -----
export async function getZones(query) {
    // Which vertical's map. See zonesOf.
    const vertical = query.vertical;
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const isActive = query.isActive;
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const filter = {};
    if (isActive !== undefined && isActive !== '') {
        filter.isActive = isActive === 'true' || isActive === '1';
    }
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { zoneName: { $regex: search, $options: 'i' } },
            { serviceLocation: { $regex: search, $options: 'i' } },
            { country: { $regex: search, $options: 'i' } }
        ];
    }

    const Zone = zonesOf(vertical);
    const [zones, total] = await Promise.all([
        Zone.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Zone.countDocuments(filter)
    ]);
    return { zones, total, page, limit };
}

export async function getZoneById(id, vertical) {
    return zonesOf(vertical).findById(id).lean();
}

export async function createZone(body, vertical) {
    const name = typeof body.name === 'string' ? body.name.trim() : (body.zoneName && body.zoneName.trim()) || '';
    if (!name) return { error: 'Zone name is required' };
    const coordinates = Array.isArray(body.coordinates) ? body.coordinates : [];
    if (coordinates.length < 3) return { error: 'At least 3 coordinates (polygon points) are required' };

    const normalized = coordinates.map((c) => ({
        latitude: Number(c.latitude) || 0,
        longitude: Number(c.longitude) || 0
    }));

    const zone = new (zonesOf(vertical))({
        name,
        zoneName: body.zoneName && body.zoneName.trim() ? body.zoneName.trim() : name,
        country: (body.country && body.country.trim()) || 'India',
        serviceLocation: (body.serviceLocation && body.serviceLocation.trim()) || name,
        unit: body.unit === 'miles' ? 'miles' : 'kilometer',
        coordinates: normalized,
        isActive: body.isActive !== false
    });
    await zone.save();
    void invalidateActiveZonesCache(vertical);
    return { zone: zone.toObject() };
}

export async function updateZone(id, body, vertical) {
    const zone = await zonesOf(vertical).findById(id);
    if (!zone) return null;

    if (body.name !== undefined) zone.name = String(body.name).trim();
    if (body.zoneName !== undefined) zone.zoneName = String(body.zoneName).trim();
    if (body.country !== undefined) zone.country = String(body.country).trim();
    if (body.serviceLocation !== undefined) zone.serviceLocation = String(body.serviceLocation).trim();
    if (body.unit !== undefined) zone.unit = body.unit === 'miles' ? 'miles' : 'kilometer';
    if (body.isActive !== undefined) zone.isActive = body.isActive !== false;
    if (Array.isArray(body.coordinates) && body.coordinates.length >= 3) {
        zone.coordinates = body.coordinates.map((c) => ({
            latitude: Number(c.latitude) || 0,
            longitude: Number(c.longitude) || 0
        }));
    }
    if (zone.name) zone.serviceLocation = zone.serviceLocation || zone.name;

    await zone.save();
    void invalidateActiveZonesCache(vertical);
    return { zone: zone.toObject() };
}

export async function deleteZone(id, vertical) {
    const zone = await zonesOf(vertical).findByIdAndDelete(id);
    if (zone) void invalidateActiveZonesCache(vertical);
    return zone ? { id } : null;
}

// ----- Withdrawals (admin) -----
export async function getWithdrawals(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.status && query.status !== 'all') {
        filter.status = query.status.toLowerCase();
    }
    if (query.restaurantId && mongoose.Types.ObjectId.isValid(query.restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(query.restaurantId);
    }

    const [withdrawals, total] = await Promise.all([
        FoodRestaurantWithdrawal.find(filter)
            .populate('restaurantId', 'restaurantName profileImage ownerName phone ownerPhone accountHolderName accountNumber ifscCode accountType upiId upiQrImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodRestaurantWithdrawal.countDocuments(filter)
    ]);

    // UI expects status with first letter capitalized, and data in 'requests' key
    const requests = withdrawals.map((w) => ({
        ...w,
        id: w._id,
        restaurantName: w.restaurantId?.restaurantName || 'N/A',
        restaurantIdString: w.restaurantId ? `REST${w.restaurantId._id.toString().slice(-6).padStart(6, '0')}` : 'N/A',
        restaurantBankDetails: {
            accountHolderName: w.restaurantId?.accountHolderName || '',
            accountNumber: w.restaurantId?.accountNumber || '',
            ifscCode: w.restaurantId?.ifscCode || '',
            accountType: w.restaurantId?.accountType || '',
            upiId: w.restaurantId?.upiId || '',
            upiQrImage: w.restaurantId?.upiQrImage || ''
        },
        status: w.status.charAt(0).toUpperCase() + w.status.slice(1)
    }));

    return { requests, total, page, limit };
}

export async function updateWithdrawalStatus(id, { status, adminNote, rejectionReason, transactionId }) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid withdrawal ID');
    
    const update = {
        status: String(status).toLowerCase(),
        adminNote,
        rejectionReason,
        transactionId,
        processedAt: new Date()
    };

    const updated = await FoodRestaurantWithdrawal.findByIdAndUpdate(
        id,
        { $set: update },
        { new: true }
    ).populate('restaurantId', 'restaurantName').lean();

    if (!updated) throw new ValidationError('Withdrawal request not found');
    return updated;
}

export async function getDeliveryWithdrawals(query = {}) {
    const limit = parseInt(query.limit, 10) || 100;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.status && query.status !== 'All') {
        filter.status = query.status.toLowerCase();
    }

    if (query.search) {
        // Search by amount or placeholder for name (name requires join usually)
        if (!isNaN(query.search)) {
            filter.amount = Number(query.search);
        }
    }

    const [withdrawals, total] = await Promise.all([
        FoodDeliveryWithdrawal.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('deliveryPartnerId', 'name phone profilePartnerId upiId upiQrCode')
            .lean(),
        FoodDeliveryWithdrawal.countDocuments(filter)
    ]);

    const requests = withdrawals.map((w) => ({
        ...w,
        id: w._id,
        deliveryName: w.deliveryPartnerId?.name || 'N/A',
        deliveryPhone: w.deliveryPartnerId?.phone || 'N/A',
        deliveryIdString: w.deliveryPartnerId?.profilePartnerId || 'N/A',
        status: w.status.charAt(0).toUpperCase() + w.status.slice(1)
    }));

    return { requests, total, page, limit };
}

export async function updateDeliveryWithdrawalStatus(id, { status, adminNote, rejectionReason, transactionId }) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid withdrawal ID');

    const normalizedStatus = String(status || '').toLowerCase() === 'processed'
        ? 'approved'
        : String(status || '').toLowerCase();

    if (!['approved', 'rejected', 'pending'].includes(normalizedStatus)) {
        throw new ValidationError('Invalid withdrawal status');
    }

    const existing = await FoodDeliveryWithdrawal.findById(id);
    if (!existing) throw new ValidationError('Withdrawal request not found');

    const previousStatus = String(existing.status || '').toLowerCase();
    const nextStatus = normalizedStatus;
    const amount = Number(existing.amount || 0);
    const deliveryPartnerId = existing.deliveryPartnerId;

    if (previousStatus !== 'pending' && previousStatus !== nextStatus) {
        throw new ValidationError(`Cannot change a ${previousStatus} withdrawal request`);
    }

    if (amount > 0 && previousStatus === 'pending' && nextStatus !== 'pending') {
        const wallet = await FoodDeliveryWallet.findOne({ deliveryPartnerId });
        const currentBalance = Number(wallet?.balance) || 0;
        const currentLocked = Number(wallet?.lockedAmount) || 0;

        if (nextStatus === 'approved') {
            if (currentBalance < amount) {
                throw new ValidationError('Delivery wallet balance is lower than the requested amount');
            }

            await FoodDeliveryWallet.findOneAndUpdate(
                { deliveryPartnerId },
                {
                    $inc: {
                        balance: -amount,
                        totalSettled: amount,
                        lockedAmount: -Math.min(currentLocked, amount)
                    }
                }
            );
        }

        if (nextStatus === 'rejected' && currentLocked > 0) {
            await FoodDeliveryWallet.findOneAndUpdate(
                { deliveryPartnerId },
                { $inc: { lockedAmount: -Math.min(currentLocked, amount) } }
            );
        }
    }

    existing.status = nextStatus;
    existing.adminNote = adminNote;
    existing.rejectionReason = rejectionReason;
    existing.transactionId = transactionId;
    existing.processedAt = nextStatus === 'pending' ? undefined : new Date();
    await existing.save();

    return FoodDeliveryWithdrawal.findById(id)
        .populate('deliveryPartnerId', 'name phone profilePartnerId')
        .lean();
}

/**
 * Fetch delivery partner wallets with financial summary
 */
export async function getDeliveryWallets(query = {}) {
    const limit = parseInt(query.limit, 10) || 20;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;

    const filter = { status: 'approved' };
    if (query.search) {
        filter.$or = [
            { name: new RegExp(query.search, 'i') },
            { phone: new RegExp(query.search, 'i') }
        ];
    }

    const [partners, total] = await Promise.all([
        FoodDeliveryPartner.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodDeliveryPartner.countDocuments(filter)
    ]);

    const cashLimitSettings = await FoodDeliveryCashLimit.findOne({ isActive: true }).lean();
    const globalLimit = Number(cashLimitSettings?.deliveryCashLimit || 0);

    const partnerIds = partners.map(p => p._id);
    const statsMap = await getBulkDeliveryPartnerStats(partnerIds);

    // Same figures as the rider app (see the food admin service).
    const finances = await Promise.all(partners.map(async (p) => {
        try {
            const { getRiderFinance } = await import('../../../../../../core/finance/riderFinance.service.js');
            return await getRiderFinance(p._id);
        } catch {
            return null;
        }
    }));
    const wallets = partners.map((p, i) => {
        const stats = statsMap.get(p._id.toString()) || {};
        const finance = finances[i];
        if (finance) {
            const d = finance.breakdown?.delivery || {};
            return {
                walletId: p._id,
                deliveryId: p._id,
                name: p.name,
                deliveryIdString: p.phone,
                pocketBalance: finance.walletBalance,
                cashCollected: finance.cashInHand,
                cashLimit: finance.cashLimit,
                remainingCashLimit: finance.availableCashLimit,
                availableCashLimit: finance.availableCashLimit,
                totalEarning: Number(d.totalEarned || 0),
                bonus: Number(d.totalBonus || 0),
                totalWithdrawn: Number(d.totalWithdrawn || 0),
                isBlocked: finance.isBlocked,
                totalOrders: stats.totalOrders || 0,
            };
        }
        return {
            walletId: p._id, // Using partner ID as wallet ID fallback
            deliveryId: p._id,
            name: p.name,
            deliveryIdString: p.phone,
            pocketBalance: stats.pocketBalance || 0,
            remainingCashLimit: Math.max(0, globalLimit - (stats.cashInHand || 0)),
            cashCollected: stats.cashInHand || 0,
            totalEarning: stats.totalEarning || 0,
            bonus: stats.bonus || 0,
            totalWithdrawn: stats.totalWithdrawn || 0,
            availableCashLimit: globalLimit,
            totalOrders: stats.totalOrders || 0
        };
    });

    return { 
        wallets, 
        pagination: { 
            total, 
            page, 
            limit, 
            pages: Math.ceil(total / limit) || 1 
        } 
    };
}

/**
 * Update delivery partner wallet manually (admin)
 */
export async function updateDeliveryBoyWallet(data) {
    const { deliveryId, pocketBalance, cashInHand } = data;
    if (!deliveryId) throw new ValidationError('Delivery partner ID required');

    let wallet = await FoodDeliveryWallet.findOne({ deliveryPartnerId: deliveryId });
    if (!wallet) {
        wallet = new FoodDeliveryWallet({
            deliveryPartnerId: deliveryId,
            balance: pocketBalance || 0,
            cashInHand: cashInHand || 0
        });
    } else {
        if (pocketBalance !== undefined) wallet.balance = pocketBalance;
        if (cashInHand !== undefined) wallet.cashInHand = cashInHand;
    }

    await wallet.save();
    return wallet.toObject();
}

/**
 * Deactivate a delivery partner (admin)
 */
/**
 * Edits a delivery partner's name and phone from the admin panel.
 *
 * Phone is not just a display field — it is how the rider logs in, and it carries a
 * unique index. Two things follow:
 *
 *  - A number already used by another partner has to be rejected with a readable
 *    message. Letting it reach the database surfaces a raw E11000 to the admin, and
 *    a deactivated partner still holds its number, so the collision is not always
 *    visible in the list.
 *  - Changing the number changes who can sign in. The rider's existing sessions are
 *    invalidated so the old handset cannot keep acting on an identity that has moved.
 */
export async function updateDeliveryPartnerProfile(id, { name, phone } = {}) {
    const partner = await FoodDeliveryPartner.findById(id);
    if (!partner) throw new NotFoundError('Delivery partner not found');

    const nextName = typeof name === 'string' ? name.trim() : undefined;
    const nextPhone = typeof phone === 'string' ? phone.trim() : undefined;

    if (nextName !== undefined) {
        if (!nextName) throw new ValidationError('Name cannot be empty');
        partner.name = nextName;
    }

    let phoneChanged = false;
    if (nextPhone !== undefined && nextPhone !== partner.phone) {
        if (!/^\d{10}$/.test(nextPhone)) {
            throw new ValidationError('Phone must be a 10 digit number');
        }

        const clash = await FoodDeliveryPartner.findOne({
            phone: nextPhone,
            _id: { $ne: partner._id },
        })
            .select('_id name status')
            .lean();

        if (clash) {
            throw new ValidationError(
                `That number already belongs to ${clash.name || 'another delivery partner'}` +
                    (clash.status === 'deactivated' ? ' (a deactivated account)' : ''),
            );
        }

        partner.phone = nextPhone;
        phoneChanged = true;
    }

    // Moving the number moves the login. Bump the token version so sessions issued
    // against the old identity stop being accepted on their next request.
    if (phoneChanged) {
        partner.tokenVersion = (Number(partner.tokenVersion) || 0) + 1;
    }

    await partner.save();
    return partner.toObject();
}

export async function deleteDeliveryPartner(id) {
    const partner = await FoodDeliveryPartner.findById(id);
    if (!partner) throw new NotFoundError('Delivery partner not found');

    partner.status = 'deactivated';
    await partner.save();

    // Optional: You could also clear FCM tokens to log them out
    // partner.fcmTokens = [];
    // await partner.save();

    return partner.toObject();
}

/**
 * Fetch cash limit settlement (deposit) transactions
 */
export async function getCashLimitSettlements(query = {}) {
    const limit = parseInt(query.limit, 10) || 20;
    const page = parseInt(query.page, 10) || 1;
    const skip = (page - 1) * limit;

    const filter = {};
    if (query.search) {
        // Search by razorpay ID or find partner IDs to search by partner
        if (query.search.startsWith('pay_')) {
            filter.razorpayPaymentId = query.search;
        }
    }

    const [deposits, total] = await Promise.all([
        FoodDeliveryCashDeposit.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('deliveryPartnerId', 'name phone')
            .lean(),
        FoodDeliveryCashDeposit.countDocuments(filter)
    ]);

    const transactions = deposits.map((d) => ({
        id: d._id,
        createdAt: d.createdAt,
        deliveryId: d.deliveryPartnerId?._id,
        deliveryName: d.deliveryPartnerId?.name || 'N/A',
        deliveryIdString: d.deliveryPartnerId?.phone || 'N/A',
        amount: Number(d.amount || 0),
        status: d.status,
        razorpayPaymentId: d.razorpayPaymentId || '-'
    }));

    return { 
        transactions, 
        pagination: { 
            total, 
            page, 
            limit,
            pages: Math.ceil(total / limit) || 1
        }
    };
}

export async function getSidebarBadges() {
    try {
        const [
            pendingRestaurants,
            pendingDeliveryPartners,
            pendingFoods,
            pendingAddons,
            pendingOrders,
            pendingOfflinePayments,
            pendingRestaurantWithdrawals,
            pendingDeliveryWithdrawals,
            openUserSupportTickets,
            openDeliverySupportTickets,
            pendingEarningAddons,
            pendingSafetyReports,
            pendingEmergencyHelp,
            pendingRestaurantComplaints
        ] = await Promise.all([
            FoodRestaurant.countDocuments({ status: 'pending' }),
            FoodDeliveryPartner.countDocuments({ status: 'pending' }),
            FoodItem.countDocuments({ approvalStatus: 'pending' }),
            FoodAddon.countDocuments({ approvalStatus: 'pending' }),
            FoodOrder.countDocuments({ orderStatus: 'pending' }),
            FoodOrder.countDocuments({ paymentMethod: 'offline_payment', orderStatus: 'pending' }),
            FoodRestaurantWithdrawal.countDocuments({ status: 'pending' }),
            FoodDeliveryWithdrawal.countDocuments({ status: 'pending' }),
            FoodSupportTicket.countDocuments({ status: 'open', userId: { $exists: true }, restaurantId: { $exists: false } }),
            DeliverySupportTicket.countDocuments({ status: 'open' }),
            FoodEarningAddonHistory.countDocuments({ status: 'pending' }),
            FoodSafetyEmergencyReport.countDocuments({ status: 'pending' }),
            FoodDeliveryEmergencyHelp.countDocuments({ status: 'pending' }),
            FoodSupportTicket.countDocuments({ status: 'open', restaurantId: { $exists: true } })
        ]);

        return {
            restaurants: pendingRestaurants,
            deliveryPartners: pendingDeliveryPartners,
            foods: pendingFoods + pendingAddons,
            foodApprovals: pendingFoods,
            orders: pendingOrders,
            offlinePayments: pendingOfflinePayments,
            restaurantWithdrawals: pendingRestaurantWithdrawals,
            deliveryWithdrawals: pendingDeliveryWithdrawals,
            userSupportTickets: openUserSupportTickets,
            deliverySupportTickets: openDeliverySupportTickets,
            earningAddons: pendingEarningAddons,
            safetyReports: pendingSafetyReports,
            emergencyHelp: pendingEmergencyHelp,
            restaurantComplaints: pendingRestaurantComplaints
        };
    } catch (error) {
        console.error('Error fetching sidebar badges:', error);
        return {};
    }
}
export async function bulkApproveFoodItems(restaurantId) {
    const filter = { approvalStatus: 'pending', isDeleted: { $ne: true } };
    
    if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
        filter.restaurantId = new mongoose.Types.ObjectId(restaurantId);
    }

    const now = new Date();

    // 1. Bulk Approve Food Items
    const foodResult = await FoodItem.updateMany(
        filter,
        {
            $set: {
                approvalStatus: 'approved',
                approvedAt: now,
                rejectionReason: ''
            }
        }
    );

    // 2. Bulk Approve Addons
    // For addons, we need to move 'draft' to 'published'
    // UpdateMany with pipeline (if MongoDB 4.2+) or manual loop
    // To be efficient for bulk admin use, we'll use a loop if the count is small, 
    // or a direct update if we just want to set the status (though published should ideally match)
    const addonResult = await FoodAddon.updateMany(
        filter,
        [
            {
                $set: {
                    published: '$draft',
                    approvalStatus: 'approved',
                    approvedAt: now,
                    rejectionReason: ''
                }
            }
        ]
    );

    // 3. Invalidate Cache if restaurantId is provided
    if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
        try {
            const { invalidateCache } = await import('../../../../middleware/cache.js');
            await invalidateCache(`restaurant_menu:${restaurantId}`);
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after bulk approval:', cacheErr);
        }
    }

    return {
        foodItems: foodResult,
        addons: addonResult,
        modifiedCount: (foodResult.modifiedCount || 0) + (addonResult.modifiedCount || 0)
    };
}

export async function deleteRestaurant(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid restaurant ID');
    }

    const restaurant = await FoodRestaurant.findById(id).lean();
    if (!restaurant) {
        return null;
    }

    // Delete the restaurant
    await FoodRestaurant.findByIdAndDelete(id);

    // Delete associated food items
    await FoodItem.deleteMany({ restaurantId: id });

    // Delete associated addons
    await FoodAddon.deleteMany({ restaurantId: id });

    // Delete associated categories if they are restaurant-specific
    // Assuming categories are global unless they have a restaurantId field (need to check FoodCategory model)
    await FoodCategory.deleteMany({ restaurantId: id });

    // Delete associated user/owner account if it's a restaurant role
    if (restaurant.ownerPhone) {
        await FoodUser.deleteOne({ phone: restaurant.ownerPhone, role: 'RESTAURANT' });
    }

    return restaurant;
}

const toEmail = (value) => String(value || '').trim().toLowerCase();

export async function createSubAdmin(payload = {}, actorId) {
    const email = toEmail(payload.email);
    const password = String(payload.password || '').trim();
    const name = String(payload.name || '').trim();

    if (!email || !password) {
        throw new ValidationError('Email and password are required');
    }

    const existing = await FoodAdmin.findOne({ email }).lean();
    if (existing) {
        throw new ValidationError('Admin with this email already exists');
    }

    const subAdmin = await FoodAdmin.create({
        email,
        password,
        name,
        phone: String(payload.phone || '').trim(),
        role: 'ADMIN',
        adminType: 'sub_admin',
        permissions: {},
        isActive: true,
        isDeleted: false,
        createdBy: actorId || null,
        updatedBy: actorId || null,
    });

    return FoodAdmin.findById(subAdmin._id).select('-password').lean();
}

export async function getSubAdmins(query = {}) {
    const filter = { adminType: 'sub_admin' };
    if (query.includeDeleted !== 'true') {
        filter.isDeleted = false;
    }
    if (query.status === 'active') filter.isActive = true;
    if (query.status === 'inactive') filter.isActive = false;

    const search = String(query.search || '').trim();
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
        ];
    }

    const items = await FoodAdmin.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .lean();
    return { items };
}

export async function getSubAdminById(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid sub-admin id');
    }
    const item = await FoodAdmin.findOne({ _id: id, adminType: 'sub_admin' }).select('-password').lean();
    if (!item) throw new ValidationError('Sub-admin not found');
    return item;
}

export async function updateSubAdminProfile(id, payload = {}, actorId) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid sub-admin id');
    }
    const update = { updatedBy: actorId || null };
    if (payload.name !== undefined) update.name = String(payload.name || '').trim();
    if (payload.phone !== undefined) update.phone = String(payload.phone || '').trim();
    if (payload.email !== undefined) update.email = toEmail(payload.email);

    const updated = await FoodAdmin.findOneAndUpdate(
        { _id: id, adminType: 'sub_admin', isDeleted: false },
        { $set: update },
        { new: true }
    ).select('-password').lean();
    if (!updated) throw new ValidationError('Sub-admin not found');
    return updated;
}

export async function updateSubAdminPermissions(id, rawPermissions = {}, actorId) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid sub-admin id');
    }
    if (!isValidPermissionPayload(rawPermissions)) {
        throw new ValidationError('Invalid permissions payload');
    }
    const permissions = sanitizeAdminPermissions(rawPermissions);
    const updated = await FoodAdmin.findOneAndUpdate(
        { _id: id, adminType: 'sub_admin', isDeleted: false },
        { $set: { permissions, updatedBy: actorId || null } },
        { new: true }
    ).select('-password').lean();
    if (!updated) throw new ValidationError('Sub-admin not found');
    return updated;
}

export async function updateSubAdminStatus(id, isActive, actorId) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid sub-admin id');
    }
    const updated = await FoodAdmin.findOneAndUpdate(
        { _id: id, adminType: 'sub_admin', isDeleted: false },
        { $set: { isActive: Boolean(isActive), updatedBy: actorId || null } },
        { new: true }
    ).select('-password').lean();
    if (!updated) throw new ValidationError('Sub-admin not found');
    return updated;
}

export async function deleteSubAdmin(id, actorId) {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid sub-admin id');
    }
    const updated = await FoodAdmin.findOneAndUpdate(
        { _id: id, adminType: 'sub_admin', isDeleted: false },
        { $set: { isDeleted: true, isActive: false, updatedBy: actorId || null } },
        { new: true }
    ).select('-password').lean();
    if (!updated) throw new ValidationError('Sub-admin not found');
    return updated;
}

export function getAdminPermissionCatalog() {
    return {
        actions: ['view', 'create', 'edit', 'delete', 'export'],
        sections: Object.keys(ADMIN_FULL_PERMISSIONS).map((section) => ({
            key: section,
            actions: ADMIN_FULL_PERMISSIONS[section],
        })),
    };
}
