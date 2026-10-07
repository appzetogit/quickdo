import { FoodRestaurant } from '../models/restaurant.model.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { normalizeMediaUrlForStorage } from '../../../../services/storage.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import mongoose from 'mongoose';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { FoodRestaurantMenu } from '../models/restaurantMenu.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurantOutletTimings } from '../models/outletTimings.model.js';
import { attachOutletTimingsToRestaurants } from './outletTimings.service.js';
import { getRestaurantOperationalStatus, getRestaurantAvailabilityStatus } from '../helpers/restaurantAvailability.helper.js';
import {
    calculateDistanceKm,
    normalizeRestaurantLocation,
} from '../../shared/geo.utils.js';
import { getRestaurantSubscriptionSettings } from '../../admin/services/admin.service.js';
import {
    isLegacyPharmacy,
    normalizeStoreTypeInput,
    QUICK_SHOP_SELLER_FILTER,
} from '../../shared/storeType.js';
import { ZONE_VERTICALS, findZoneForPoint } from '../../shared/zoneServiceability.js';
import { GST_RATE } from './subscriptionPlan.service.js';
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature,
} from '../../orders/helpers/razorpay.helper.js';

const normalizeName = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ');

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '').slice(-15);
    return {
        digits: digits || '',
        last10: digits ? digits.slice(-10) : ''
    };
};

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const normalizeDayName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const exact = DAY_NAMES.find((d) => d.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const abbr = raw.slice(0, 3).toLowerCase();
    return DAY_NAMES.find((d) => d.toLowerCase().startsWith(abbr)) || null;
};


const normalizeRatingValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const normalizeTotalRatingsValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
};

const toUrl = (v) => {
    const raw = (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : '';
    return normalizeMediaUrlForStorage(raw);
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

    // HH:mm / H:mm
    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return toHHMM(hhmm[1], hhmm[2]);

    // hh:mm AM/PM
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

const extractRecommendedItems = (sections) => {
    const recommended = [];
    if (!Array.isArray(sections)) return recommended;

    for (const section of sections) {
        if (!section) continue;

        // Items in main section
        if (Array.isArray(section.items)) {
            for (const item of section.items) {
                if (item && (item.isRecommended === true || item.isRecommended === 'true')) {
                    recommended.push({
                        id: item.id || item._id,
                        name: item.name || 'Unnamed Item',
                        price: item.price || item.featuredPrice || 0,
                        image: item.image || item.profileImage || ''
                    });
                }
                if (recommended.length >= 10) return recommended;
            }
        }

        // Items in subsections
        if (Array.isArray(section.subsections)) {
            for (const sub of section.subsections) {
                if (!sub || !Array.isArray(sub.items)) continue;
                for (const item of sub.items) {
                    if (item && (item.isRecommended === true || item.isRecommended === 'true')) {
                        recommended.push({
                            id: item.id || item._id,
                            name: item.name || 'Unnamed Item',
                            price: item.price || item.featuredPrice || 0,
                            image: item.image || item.profileImage || ''
                        });
                    }
                    if (recommended.length >= 10) return recommended;
                }
            }
        }
    }
    return recommended;
};

const timeToMinutes = (value) => {
    const normalized = normalizeRestaurantTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const parseEstimatedDeliveryMinutes = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const matches = raw.match(/\d+/g);
    if (!matches || !matches.length) return null;
    const numbers = matches.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
    if (!numbers.length) return null;
    return Math.round(numbers[numbers.length - 1]);
};

const buildActivePublicOfferFilter = (now = new Date()) => {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    return {
        status: 'active',
        showInCart: { $ne: false },
        $and: [
            { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
            { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: startOfToday } }] },
            {
                $or: [
                    { usageLimit: { $exists: false } },
                    { usageLimit: null },
                    { usageLimit: 0 },
                    { $expr: { $lt: ['$usedCount', '$usageLimit'] } }
                ]
            }
        ]
    };
};

const formatRestaurantOfferSummary = (offer) => {
    if (!offer) return '';

    const discountType = offer.discountType;
    const discountValue = Number(offer.discountValue) || 0;
    const minOrderValue = Number(offer.minOrderValue) || 0;

    let summary = '';
    if (discountType === 'flat-price') {
        summary = `Flat ₹${discountValue} OFF`;
    } else {
        summary = `${discountValue}% OFF`;
        const maxDiscount = Number(offer.maxDiscount);
        if (Number.isFinite(maxDiscount) && maxDiscount > 0) {
            summary += ` up to ₹${maxDiscount}`;
        }
    }

    if (minOrderValue > 0) {
        summary += ` above ₹${minOrderValue}`;
    }

    return summary.trim();
};

const attachPublicOffersToRestaurants = async (restaurants = []) => {
    if (!Array.isArray(restaurants) || restaurants.length === 0) return restaurants;

    const restaurantIds = restaurants
        .map((restaurant) => String(restaurant?._id || restaurant?.id || restaurant?.restaurantId || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!restaurantIds.length) {
        return restaurants.map((restaurant) => ({
            ...restaurant,
            activeOffers: [],
            offerCount: 0
        }));
    }

    const objectRestaurantIds = restaurantIds.map((id) => new mongoose.Types.ObjectId(id));
    const activeOfferFilter = buildActivePublicOfferFilter();
    const offers = await FoodOffer.find({
        ...activeOfferFilter,
        $and: [
            ...(activeOfferFilter.$and || []),
            {
                $or: [
                    { restaurantScope: 'all' },
                    { restaurantId: { $in: objectRestaurantIds } },
                    { restaurantIds: { $in: objectRestaurantIds } }
                ]
            }
        ]
    })
        .select('couponCode discountType discountValue minOrderValue maxDiscount restaurantScope restaurantId restaurantIds')
        .sort({ createdAt: -1 })
        .lean();

    const globalOfferSummaries = [];
    const selectedOfferMap = new Map();

    for (const offer of offers) {
        const summary = formatRestaurantOfferSummary(offer);
        if (!summary) continue;

        const payload = {
            id: String(offer._id),
            couponCode: offer.couponCode || '',
            summary,
            discountType: offer.discountType,
            discountValue: Number(offer.discountValue) || 0,
            minOrderValue: Number(offer.minOrderValue) || 0,
            maxDiscount: Number.isFinite(Number(offer.maxDiscount)) ? Number(offer.maxDiscount) : null,
            restaurantScope: offer.restaurantScope
        };

        if (offer.restaurantScope === 'all') {
            globalOfferSummaries.push(payload);
            continue;
        }

        const eligibleIds = new Set([
            ...(Array.isArray(offer.restaurantIds) ? offer.restaurantIds : []),
            offer.restaurantId
        ].map((id) => String(id || '')).filter(Boolean));

        for (const restaurantId of eligibleIds) {
            if (!selectedOfferMap.has(restaurantId)) {
                selectedOfferMap.set(restaurantId, []);
            }
            selectedOfferMap.get(restaurantId).push(payload);
        }
    }

    return restaurants.map((restaurant) => {
        const restaurantId = String(restaurant?._id || restaurant?.id || restaurant?.restaurantId || '');
        const combinedOffers = [...globalOfferSummaries, ...(selectedOfferMap.get(restaurantId) || [])];
        const dedupedOffers = Array.from(
            new Map(combinedOffers.map((offer) => [offer.id, offer])).values()
        );

        return {
            ...restaurant,
            activeOffers: dedupedOffers,
            offerCount: dedupedOffers.length
        };
    });
};

const toRestaurantProfile = (doc) => {
    if (!doc) return null;
    const loc = doc.location && typeof doc.location === 'object' ? doc.location : null;
    const location =
        (loc?.formattedAddress ||
            loc?.address ||
            loc?.addressLine1 ||
            loc?.addressLine2 ||
            loc?.area ||
            loc?.city ||
            loc?.state ||
            loc?.pincode ||
            loc?.landmark ||
            doc.addressLine1 ||
            doc.addressLine2 ||
            doc.area ||
            doc.city ||
            doc.state ||
            doc.pincode ||
            doc.landmark)
            ? normalizeRestaurantLocation({
                type: loc?.type || 'Point',
                coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
                latitude: loc?.latitude ?? loc?.lat,
                longitude: loc?.longitude ?? loc?.lng,
                formattedAddress: loc?.formattedAddress || loc?.address || '',
                address: loc?.address || loc?.formattedAddress || '',
                addressLine1: loc?.addressLine1 || doc.addressLine1 || '',
                addressLine2: loc?.addressLine2 || doc.addressLine2 || '',
                area: loc?.area || doc.area || '',
                city: loc?.city || doc.city || '',
                state: loc?.state || doc.state || '',
                pincode: loc?.pincode || doc.pincode || '',
                landmark: loc?.landmark || doc.landmark || ''
            })
            : null;

    const menuImages = Array.isArray(doc.menuImages)
        ? doc.menuImages.map((m) => toUrl(m)).filter(Boolean).map((url) => ({ url, publicId: null }))
        : [];
    const coverImages = Array.isArray(doc.coverImages)
        ? doc.coverImages.map((m) => toUrl(m)).filter(Boolean).map((url) => ({ url, publicId: null }))
        : [];

    return {
        id: doc._id,
        _id: doc._id,
        restaurantId: doc.restaurantId || undefined,
        name: doc.restaurantName || '',
        restaurantName: doc.restaurantName || '',
        zoneId: doc.zoneId ? String(doc.zoneId) : '',
        cuisines: Array.isArray(doc.cuisines) ? doc.cuisines : [],
        location,
        ownerName: doc.ownerName || '',
        ownerEmail: doc.ownerEmail || '',
        ownerPhone: doc.ownerPhone || '',
        primaryContactNumber: doc.primaryContactNumber || '',
        panNumber: doc.panNumber || '',
        nameOnPan: doc.nameOnPan || '',
        panImage: doc.panImage ? { url: doc.panImage } : null,
        gstRegistered: Boolean(doc.gstRegistered),
        gstNumber: doc.gstNumber || '',
        gstLegalName: doc.gstLegalName || '',
        gstAddress: doc.gstAddress || '',
        gstImage: doc.gstImage ? { url: doc.gstImage } : null,
        fssaiNumber: doc.fssaiNumber || '',
        fssaiExpiry: doc.fssaiExpiry || null,
        fssaiImage: doc.fssaiImage ? { url: doc.fssaiImage } : null,
        accountNumber: doc.accountNumber || '',
        ifscCode: doc.ifscCode || '',
        accountHolderName: doc.accountHolderName || '',
        accountType: doc.accountType || '',
        upiId: doc.upiId || '',
        upiQrImage: doc.upiQrImage ? { url: doc.upiQrImage } : null,
        pureVegRestaurant: Boolean(doc.pureVegRestaurant),
        profileImage: doc.profileImage ? { url: doc.profileImage } : null,
        menuImages,
        coverImages,
        openingTime: normalizeRestaurantTime(doc.openingTime) || null,
        closingTime: normalizeRestaurantTime(doc.closingTime) || null,
        openDays: Array.isArray(doc.openDays) ? doc.openDays : [],
        estimatedDeliveryTime: doc.estimatedDeliveryTime || '',
        estimatedDeliveryTimeMinutes:
            Number.isFinite(Number(doc.estimatedDeliveryTimeMinutes))
                ? Number(doc.estimatedDeliveryTimeMinutes)
                : null,
        isAcceptingOrders: doc.isAcceptingOrders !== false,
        outsideHoursOverride: doc.outsideHoursOverride === true,
        subscriptionPlan: doc.subscriptionPlan || '',
        subscriptionAmount: Number.isFinite(Number(doc.subscriptionAmount)) ? Number(doc.subscriptionAmount) : 0,
        subscriptionPaidAmount: Number.isFinite(Number(doc.subscriptionPaidAmount)) ? Number(doc.subscriptionPaidAmount) : 0,
        subscriptionDueAmount: Number.isFinite(Number(doc.subscriptionDueAmount)) ? Number(doc.subscriptionDueAmount) : 0,
        subscriptionStatus: doc.subscriptionStatus || 'due',
        subscriptionValidTill: doc.subscriptionValidTill || null,
        onboardingFeePaid: Boolean(doc.onboardingFeePaid),
        onboardingFeePaidAt: doc.onboardingFeePaidAt || null,
        onboardingFeePaymentMethod: doc.onboardingFeePaymentMethod || '',
        onboardingFeePaymentOrderId: doc.onboardingFeePaymentOrderId || '',
        onboardingFeePaymentId: doc.onboardingFeePaymentId || '',
        onboardingFeePaymentSignature: doc.onboardingFeePaymentSignature || '',
        status: doc.status || null,
        locationUpdateStatus: doc.locationUpdateStatus || 'none',
        locationUpdateRequestedAt: doc.locationUpdateRequestedAt || null,
        locationUpdateReviewedAt: doc.locationUpdateReviewedAt || null,
        locationRejectionReason: doc.locationRejectionReason || '',
        pendingLocation: normalizeProfileLocation(doc.pendingLocation),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings)
    };
};

const toFiniteNumber = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCuisine = (value) => String(value || '').trim().slice(0, 80);

const parseSortBy = (value) => {
    const v = String(value || '').trim();
    const allowed = new Set(['nearest', 'rating', 'newest', 'deliveryTime', 'price-low', 'price-high', 'rating-high', 'rating-low']);
    return allowed.has(v) ? v : null;
};

const zoneToPolygon = (zoneDoc) => {
    const coords = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : [];
    if (coords.length < 3) return null;
    const ring = coords
        .map((c) => [Number(c.longitude), Number(c.latitude)])
        .filter((pair) => pair.every((n) => Number.isFinite(n)));
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return { type: 'Polygon', coordinates: [ring] };
};

const isPointInZonePolygon = (lat, lng, polygon = []) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = Number(polygon[i]?.longitude);
        const yi = Number(polygon[i]?.latitude);
        const xj = Number(polygon[j]?.longitude);
        const yj = Number(polygon[j]?.latitude);
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
};

const findMatchedZoneForCoordinates = async (lat, lng) => {
    if (lat === null || lng === null) return null;
    const activeZones = await FoodZone.find({ isActive: true })
        .select('_id coordinates name zoneName')
        .lean();
    return activeZones.find((zone) => isPointInZonePolygon(lat, lng, zone?.coordinates)) || null;
};

const hasPublishedRestaurantLocation = (restaurant = {}) => {
    const loc = restaurant?.location;
    if (!loc || typeof loc !== 'object') return false;
    const lat = toFiniteNumber(loc.latitude ?? loc?.coordinates?.[1]);
    const lng = toFiniteNumber(loc.longitude ?? loc?.coordinates?.[0]);
    return lat !== null && lng !== null;
};

const buildLocationObjectFromInput = (loc = {}) => {
    const toStr = (v) => (v != null ? String(v).trim() : '');
    const formattedAddress = toStr(loc.formattedAddress || loc.address);
    const lat = toFiniteNumber(loc.latitude);
    const lng = toFiniteNumber(loc.longitude);
    return {
        type: 'Point',
        coordinates: lat !== null && lng !== null ? [lng, lat] : undefined,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        formattedAddress,
        address: formattedAddress,
        addressLine1: toStr(loc.addressLine1),
        addressLine2: toStr(loc.addressLine2),
        area: toStr(loc.area),
        city: toStr(loc.city),
        state: toStr(loc.state),
        pincode: toStr(loc.pincode),
        landmark: toStr(loc.landmark)
    };
};

const normalizeProfileLocation = (loc) => {
    if (!loc || typeof loc !== 'object') return null;
    return normalizeRestaurantLocation({
        type: loc?.type || 'Point',
        coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
        latitude: loc?.latitude ?? loc?.lat,
        longitude: loc?.longitude ?? loc?.lng,
        formattedAddress: loc?.formattedAddress || loc?.address || '',
        address: loc?.address || loc?.formattedAddress || '',
        addressLine1: loc?.addressLine1 || '',
        addressLine2: loc?.addressLine2 || '',
        area: loc?.area || '',
        city: loc?.city || '',
        state: loc?.state || '',
        pincode: loc?.pincode || '',
        landmark: loc?.landmark || ''
    });
};

const stripPendingLocationFromPublicRestaurant = (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    const {
        pendingLocation,
        pendingZoneId,
        locationUpdateStatus,
        locationUpdateRequestedAt,
        locationUpdateReviewedAt,
        locationRejectionReason,
        ...publicDoc
    } = doc;
    return publicDoc;
};

/**
 * Keep public restaurant.location.latitude/longitude in sync with GeoJSON coordinates
 * so user-home Haversine matches delivery (which already parses coordinates-first).
 * Optionally attach distanceInKm when the client sent lat/lng.
 */
/**
 * Open every day, round the clock.
 *
 * Seven days, and a window that
 * leaves no gap. A shop trading 00:00-23:59 is 24x7 in every sense a
 * customer cares about -- the missing minute is how a closing time is
 * written, not a shutter.
 */
const isRoundTheClockSeller = (doc) => {
    const days = Array.isArray(doc?.openDays) ? doc.openDays : [];
    if (days.length < 7) return false;
    const open = String(doc?.openingTime || '').trim();
    const close = String(doc?.closingTime || '').trim();
    if (!open || !close) return false;
    if (open === close) return true;
    return open === '00:00' && ['23:59', '24:00', '00:00'].includes(close);
};

const normalizePublicRestaurantGeo = (doc, userLat = null, userLng = null) => {
    if (!doc || typeof doc !== 'object') return doc;

    const location = doc.location
        ? normalizeRestaurantLocation(doc.location)
        : doc.location;

    const next = location ? { ...doc, location } : { ...doc };

    if (
        Number.isFinite(userLat) &&
        Number.isFinite(userLng) &&
        location
    ) {
        const km = calculateDistanceKm(
            { latitude: userLat, longitude: userLng },
            location,
        );
        if (Number.isFinite(km)) {
            next.distanceInKm = Number(km.toFixed(2));
        }
    }

    /*
     * Whether it is trading right now. The listing already carried the
     * timetable but no verdict, and the customer app defaults a missing
     * `isOpenNow` to true -- so a shut seller read as open on every screen
     * fed by this endpoint.
     *
     * Wrapped because a malformed timetable must not take down a listing:
     * an unknown answer leaves the field off, which is what the client
     * already handles.
     */
    try {
        next.isOpenNow = getRestaurantAvailabilityStatus(next)?.isOpen === true;
    } catch (err) {
        // Left absent rather than guessed -- but said out loud. This catch
        // silently ate a TypeError once and the field just never appeared.
        console.warn(
            `[sellers] open-state unavailable for ${next?._id}: ${err?.message || err}`,
        );
    }
    next.is24x7 = isRoundTheClockSeller(next);

    return next;
};

const notifyAdminsAboutRestaurantLocationUpdate = async (restaurantId, restaurantName) => {
    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'Restaurant Location Update',
            body: `Restaurant "${restaurantName || 'Unknown Restaurant'}" requested a location change and is pending approval.`,
            data: {
                type: 'restaurant_location_updated',
                subType: 'restaurant',
                id: String(restaurantId)
            }
        });
    } catch (e) {
        console.error('Failed to notify admins of restaurant location update:', e);
    }
};

const notifyAdminsAboutRestaurantProfileReview = async (restaurantId, restaurantName) => {
    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'Restaurant Profile Updated',
            body: `Restaurant "${restaurantName || 'Unknown Restaurant'}" updated its profile and is pending approval again.`,
            data: {
                type: 'restaurant_profile_updated',
                subType: 'restaurant',
                id: String(restaurantId)
            }
        });
    } catch (e) {
        console.error('Failed to notify admins of restaurant profile resubmission:', e);
    }
};

export const uploadRestaurantAttachment = async (file, folderType = 'profile') => {
    if (!file || !file.buffer) {
        throw new Error('File is required for upload');
    }

    let folder = 'food/restaurants';
    if (folderType === 'profile') folder += '/profile';
    else if (folderType === 'pan') folder += '/pan';
    else if (folderType === 'gst') folder += '/gst';
    else if (folderType === 'fssai') folder += '/fssai';
    else if (folderType === 'menu') folder += '/menu';
    else folder += '/others';

    const url = await uploadImageBuffer(file.buffer, folder);
    return { url };
};

const computeOnboardingFeeWithGst = (baseFee) => {
    const fee = Math.max(0, Number(baseFee) || 0);
    const gstAmount = Math.round(fee * GST_RATE * 100) / 100;
    const total = Math.round((fee + gstAmount) * 100) / 100;
    return { baseFee: fee, gstAmount, total };
};

export const createRestaurantOnboardingFeeOrder = async ({ ownerPhone }) => {
    const settings = await getRestaurantSubscriptionSettings();
    const fee = Math.max(0, Number(settings?.onboardingFee) || 0);
    if (fee <= 0) {
        throw new ValidationError('Onboarding fee is not required');
    }

    const { baseFee, gstAmount, total } = computeOnboardingFeeWithGst(fee);

    const { last10 } = normalizePhone(ownerPhone);
    if (!last10) {
        throw new ValidationError('Owner phone is required to create onboarding fee payment');
    }

    const amountPaise = Math.round(total * 100);

    if (!isRazorpayConfigured()) {
        return {
            onboardingFeeAmount: baseFee,
            onboardingFeeGst: gstAmount,
            onboardingFeeTotal: total,
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId: `order_dev_onboarding_${last10}_${Date.now()}`,
                amount: amountPaise,
                currency: 'INR',
            },
        };
    }

    const receipt = `onboarding_${last10}_${Date.now()}`;
    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);
    return {
        onboardingFeeAmount: baseFee,
        onboardingFeeGst: gstAmount,
        onboardingFeeTotal: total,
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR',
        },
    };
};

/**
 * The zone a newly registering seller belongs to.
 *
 * An explicit id wins, so an admin registering on someone behalf can still
 * place a store by hand. Otherwise the pinned coordinates are matched against
 * the active zone polygons -- the same check the order path runs, so a shop is
 * findable on day one by the same rule that will later serve its orders.
 *
 * Returns undefined when no zone contains the pin, which stores exactly what
 * is stored today. This module tolerates a seller with no zone by design, so
 * refusing the registration would break a case that currently works.
 */
const resolveOnboardingZoneId = async ({ zoneId, latitude, longitude }) => {
    const explicit = String(zoneId || '').trim();
    if (explicit && mongoose.Types.ObjectId.isValid(explicit)) {
        return new mongoose.Types.ObjectId(explicit);
    }

    const lat = toFiniteNumber(latitude);
    const lng = toFiniteNumber(longitude);
    if (lat === null || lng === null) return undefined;

    try {
        const zone = await findZoneForPoint(lat, lng, ZONE_VERTICALS.QUICK);
        return zone && zone._id ? new mongoose.Types.ObjectId(String(zone._id)) : undefined;
    } catch (err) {
        // A zone lookup that fails must not fail the signup: the seller is
        // created unzoned, exactly as it was before this existed.
        return undefined;
    }
};

export const registerRestaurant = async (payload, files) => {
    const {
        restaurantName,
        ownerName,
        ownerEmail,
        ownerPhone,
        primaryContactNumber,
        pureVegRestaurant,
        addressLine1,
        addressLine2,
        area,
        city,
        state,
        pincode,
        landmark,
        formattedAddress,
        latitude,
        longitude,
        zoneId,
        cuisines,
        openingTime,
        closingTime,
        openDays,
        estimatedDeliveryTime,
        panNumber,
        nameOnPan,
        gstRegistered,
        gstNumber,
        gstLegalName,
        gstAddress,
        fssaiNumber,
        fssaiExpiry,
        accountNumber,
        ifscCode,
        accountHolderName,
        accountType,
        subscriptionPlan,
        subscriptionAmount,
        subscriptionPaidAmount,
        subscriptionDueAmount,
        onboardingFeeAmount,
        onboardingFeePaid,
        paymentType,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        // Pre-uploaded image URLs from background uploads
        profileImage: preUploadedProfileImage,
        panImage: preUploadedPanImage,
        gstImage: preUploadedGstImage,
        fssaiImage: preUploadedFssaiImage,
        menuImages: preUploadedMenuImages,
        storeType: rawStoreType,
        upiId,
    } = payload;

    if (!ownerPhone) {
        throw new ValidationError('Owner phone is required to register a restaurant');
    }

    const { digits: ownerPhoneDigits, last10: ownerPhoneLast10 } = normalizePhone(ownerPhone);
    if (!ownerPhoneLast10) {
        throw new ValidationError('Owner phone is invalid');
    }

    const restaurantNameNormalized = normalizeName(restaurantName);
    if (!restaurantNameNormalized) {
        throw new ValidationError('Restaurant name is required to register a restaurant');
    }

    /**
     * One store per phone number.
     *
     * The unique index covers name *and* phone, so the same number could
     * register any number of stores as long as each had a different name. Sign
     * in then looks the seller up by phone alone and takes the first match --
     * the oldest record -- so a seller who registered twice was permanently
     * bound to their first attempt. Approving the second one in the admin panel
     * changed nothing they could see, and the app kept reporting whatever the
     * first record said.
     *
     * The message names the store that already holds the number, so an admin
     * looking at a list of similar test entries can tell which row is which.
     */
    const existing = await FoodRestaurant.findOne({
        $or: [
            { ownerPhoneLast10 },
            { ownerPhone },
            { primaryContactNumber: ownerPhone }
        ]
    })
        .select('restaurantName status')
        .lean();

    if (existing) {
        if (existing.status === 'rejected') {
            throw new ValidationError(
                `This number is already registered to "${existing.restaurantName}", which was not approved. ` +
                'Please contact support to re-apply rather than creating a second store.'
            );
        }
        throw new ValidationError(
            `This number is already registered to "${existing.restaurantName}". Please sign in instead.`
        );
    }

    const images = {
        profileImage: preUploadedProfileImage || '',
        panImage: preUploadedPanImage || '',
        gstImage: preUploadedGstImage || '',
        fssaiImage: preUploadedFssaiImage || ''
    };

    const uploadTasks = [];
    const imageMap = {};

    if (files?.profileImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.profileImage[0].buffer, 'food/restaurants/profile')
            .then(url => { imageMap.profileImage = url; }));
    }
    if (files?.panImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.panImage[0].buffer, 'food/restaurants/pan')
            .then(url => { imageMap.panImage = url; }));
    }
    if (files?.gstImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.gstImage[0].buffer, 'food/restaurants/gst')
            .then(url => { imageMap.gstImage = url; }));
    }
    if (files?.fssaiImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.fssaiImage[0].buffer, 'food/restaurants/fssai')
            .then(url => { imageMap.fssaiImage = url; }));
    }

    // Registration document and store photos: each arrives either as a file or
    // as a URL already uploaded through /upload-attachment.
    const partnerImages = {
        businessRegistrationImage: String(payload.businessRegistrationImage || '').trim(),
        storeFrontImage: String(payload.storeFrontImage || '').trim(),
        storeInsideImage: String(payload.storeInsideImage || '').trim(),
        storeSignboardImage: String(payload.storeSignboardImage || '').trim(),
    };
    for (const [field, folder] of [
        ['businessRegistrationImage', 'qc/partners/registration'],
        ['storeFrontImage', 'qc/partners/store-front'],
        ['storeInsideImage', 'qc/partners/store-inside'],
        ['storeSignboardImage', 'qc/partners/store-signboard'],
    ]) {
        if (files?.[field]?.[0]) {
            uploadTasks.push(uploadImageBuffer(files[field][0].buffer, folder)
                .then((url) => { if (url) partnerImages[field] = url; }));
        }
    }

    let menuImages = [];
    // If we have pre-uploaded menu images, use them
    if (preUploadedMenuImages) {
        try {
            menuImages = Array.isArray(preUploadedMenuImages)
                ? preUploadedMenuImages
                : (typeof preUploadedMenuImages === 'string' ? JSON.parse(preUploadedMenuImages) : []);
        } catch (e) {
            console.error('Error parsing preUploadedMenuImages:', e);
        }
    }

    if (files?.menuImages?.length) {
        uploadTasks.push(Promise.all(
            files.menuImages.map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/menu'))
        ).then(urls => { menuImages = [...menuImages, ...urls]; }));
    }

    // Main cover image (single hero shot of the restaurant).
    let coverImage = String(payload.coverImage || '').trim();
    if (files?.coverImage?.[0]) {
        uploadTasks.push(
            uploadImageBuffer(files.coverImage[0].buffer, 'food/restaurants/cover')
                .then((url) => { if (url) coverImage = url; })
        );
    }

    // Premises gallery — the rider uses these to identify the shop at pickup.
    let galleryImages = [];
    if (payload.galleryImages) {
        try {
            const pre = typeof payload.galleryImages === 'string'
                ? JSON.parse(payload.galleryImages)
                : payload.galleryImages;
            if (Array.isArray(pre)) galleryImages = pre.map((u) => String(u || '').trim()).filter(Boolean);
        } catch {
            // A single pre-uploaded URL rather than a JSON array is fine too.
            const single = String(payload.galleryImages).trim();
            if (single.startsWith('http') || single.startsWith('/')) galleryImages = [single];
        }
    }
    if (files?.galleryImages?.length) {
        uploadTasks.push(Promise.all(
            files.galleryImages.map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/gallery'))
        ).then((urls) => { galleryImages = [...galleryImages, ...urls.filter(Boolean)]; }));
    }

    // Wait for all uploads to complete in parallel
    if (uploadTasks.length > 0) {
        console.log(`[ONBOARDING] Starting upload of ${uploadTasks.length} image tasks...`);
        console.time('ImageUploadTotal');
        await Promise.all(uploadTasks);
        console.timeEnd('ImageUploadTotal');
        console.log('[ONBOARDING] All image uploads completed.');
    }

    Object.assign(images, imageMap);

    // What kind of shop this is. A new seller cannot be a (legacy) pharmacy.
    const storeType = normalizeStoreTypeInput(rawStoreType) || 'grocery';
    const storeFields = { storeType };

    const partnerFields = {
        businessRegistrationImage: partnerImages.businessRegistrationImage,
        storePhotos: {
            front: partnerImages.storeFrontImage,
            inside: partnerImages.storeInsideImage,
            signboard: partnerImages.storeSignboardImage,
        },
        upiId: String(upiId || '').trim(),
        applicationSubmittedAt: new Date(),
    };

    const normalizedOpeningTime = normalizeRestaurantTime(openingTime);
    const normalizedClosingTime = normalizeRestaurantTime(closingTime);
    const openingMinutes = timeToMinutes(normalizedOpeningTime);
    const closingMinutes = timeToMinutes(normalizedClosingTime);
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        if (closingMinutes < openingMinutes) {
            throw new ValidationError('Closing time cannot be less than opening time');
        }
    }
    const estimatedDeliveryTimeText = String(estimatedDeliveryTime || '').trim();
    const estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText);

    const subscriptionSettings = await getRestaurantSubscriptionSettings();
    const requiredOnboardingFee = Math.max(0, Number(subscriptionSettings?.onboardingFee) || 0);
    const { total: requiredOnboardingFeeTotal } = computeOnboardingFeeWithGst(requiredOnboardingFee);
    let onboardingFeeFields = {};

    if (requiredOnboardingFee > 0) {
        if (!onboardingFeePaid) {
            throw new ValidationError('Onboarding fee payment is required before completing registration');
        }
        const paidAmount = Math.max(0, Number(onboardingFeeAmount) || 0);
        if (Math.abs(paidAmount - requiredOnboardingFeeTotal) > 0.01) {
            throw new ValidationError('Onboarding fee amount does not match the configured fee');
        }
        const orderId = String(razorpayOrderId || '').trim();
        const paymentId = String(razorpayPaymentId || '').trim();
        const signature = String(razorpaySignature || '').trim();
        if (!orderId || !paymentId || !signature) {
            throw new ValidationError('Complete onboarding fee payment details are required');
        }
        const verified = isRazorpayConfigured()
            ? verifyPaymentSignature(orderId, paymentId, signature)
            : true;
        if (!verified) {
            throw new ValidationError('Onboarding fee payment verification failed');
        }
        onboardingFeeFields = {
            onboardingFeePaid: true,
            onboardingFeeAmount: requiredOnboardingFeeTotal,
            onboardingFeePaidAt: new Date(),
            onboardingFeePaymentMethod: paymentType || 'razorpay',
            onboardingFeePaymentOrderId: orderId,
            onboardingFeePaymentId: paymentId,
            onboardingFeePaymentSignature: signature,
        };
    }

    try {
        const latNum = toFiniteNumber(latitude);
        const lngNum = toFiniteNumber(longitude);
        // Derived from the pin rather than expected from the client: no app
        // or panel sends a zone at registration, which is why every store
        // onboarded through them had none.
        const resolvedZoneId = await resolveOnboardingZoneId({
            zoneId,
            latitude: latNum,
            longitude: lngNum,
        });
        const restaurant = await FoodRestaurant.create({
            restaurantName,
            restaurantNameNormalized,
            ownerName,
            ownerEmail,
            // Store phone in a consistent digits-only format to match OTP login flow.
            ownerPhone: ownerPhoneDigits,
            ownerPhoneDigits,
            ownerPhoneLast10,
            primaryContactNumber,
            pureVegRestaurant: pureVegRestaurant === true,
            zoneId: resolvedZoneId,
            // Store unified location object (geo + address).
            location: {
                type: 'Point',
                coordinates: latNum !== null && lngNum !== null ? [lngNum, latNum] : undefined,
                latitude: latNum ?? undefined,
                longitude: lngNum ?? undefined,
                formattedAddress: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                address: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                addressLine1: addressLine1 || '',
                addressLine2: addressLine2 || '',
                area: area || '',
                city: city || '',
                state: state || '',
                pincode: pincode || '',
                landmark: landmark || ''
            },
            cuisines: cuisines || [],
            openingTime: normalizedOpeningTime || undefined,
            closingTime: normalizedClosingTime || undefined,
            openDays: openDays || [],
            estimatedDeliveryTime: estimatedDeliveryTimeText || undefined,
            estimatedDeliveryTimeMinutes: estimatedDeliveryTimeMinutes ?? undefined,
            panNumber,
            nameOnPan,
            gstRegistered,
            gstNumber,
            gstLegalName,
            gstAddress,
            fssaiNumber,
            fssaiExpiry,
            accountNumber,
            ifscCode,
            accountHolderName,
            accountType,
            menuImages,
            coverImage,
            galleryImages,
            // Keep coverImages (the public page banner array) seeded from onboarding so the
            // restaurant page isn't blank before they manage banners themselves.
            coverImages: coverImage ? [coverImage, ...galleryImages] : galleryImages,
            // Postpaid subscription model: monthly invoices from GMV at month end.
            ...onboardingFeeFields,
            ...storeFields,
            ...partnerFields,
            ...images
        });

        // Seed day-wise outlet timings at onboarding from the initial opening/closing fields.
        // Later manual changes by restaurant are preserved (we only insert if missing).
        try {
            const normalizedOpenDays = Array.isArray(openDays)
                ? [...new Set(openDays.map(normalizeDayName).filter(Boolean))]
                : [];
            const openDaysSet = new Set(normalizedOpenDays.length ? normalizedOpenDays : DAY_NAMES);
            const seedOpeningTime = normalizedOpeningTime || '09:00';
            const seedClosingTime = normalizedClosingTime || '22:00';

            const seededTimings = DAY_NAMES.map((day) => {
                const isOpen = openDaysSet.has(day);
                return {
                    day,
                    isOpen,
                    openingTime: isOpen ? seedOpeningTime : '',
                    closingTime: isOpen ? seedClosingTime : '',
                };
            });

            await FoodRestaurantOutletTimings.updateOne(
                { restaurantId: restaurant._id },
                { $setOnInsert: { restaurantId: restaurant._id, timings: seededTimings } },
                { upsert: true }
            );
        } catch (seedErr) {
            console.error('Failed to seed outlet timings during onboarding:', seedErr);
        }

        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'New Restaurant Registration 🏪',
                body: `A new restaurant "${restaurant.restaurantName}" has registered and is pending approval.`,
                data: {
                    type: 'new_registration',
                    subType: 'restaurant',
                    id: String(restaurant._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of new restaurant registration:', e);
        }

        return restaurant.toObject();
    } catch (err) {
        // Handle uniqueness conflicts deterministically (race-safe).
        if (err && (err.code === 11000 || err?.name === 'MongoServerError')) {
            throw new ValidationError('Restaurant with this name and owner phone already exists');
        }
        throw err;
    }
};

export const getCurrentRestaurantProfile = async (restaurantId) => {
    if (!restaurantId) return null;
    const doc = await FoodRestaurant.findById(restaurantId)
        .select(
            [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'panNumber',
                'nameOnPan',
                'panImage',
                'gstRegistered',
                'gstNumber',
                'gstLegalName',
                'gstAddress',
                'gstImage',
                'fssaiNumber',
                'fssaiExpiry',
                'fssaiImage',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'isAcceptingOrders',
                'outsideHoursOverride',
                'subscriptionPlan',
                'subscriptionAmount',
                'subscriptionPaidAmount',
                'subscriptionDueAmount',
                'subscriptionStatus',
                'subscriptionValidTill',
                'onboardingFeePaid',
                'onboardingFeePaidAt',
                'onboardingFeePaymentMethod',
                'onboardingFeePaymentOrderId',
                'onboardingFeePaymentId',
                'onboardingFeePaymentSignature',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        )
        .lean();
    const profile = toRestaurantProfile(doc);
    if (!profile) return null;
    return enrichRestaurantProfileWithAvailability(profile, doc);
};

const enrichRestaurantProfileWithAvailability = async (profile, doc) => {
    if (!profile || !doc) return profile;
    const [withTimings] = await attachOutletTimingsToRestaurants([doc]);
    const outletTimings = withTimings?.outletTimings || null;
    const operationalStatus = getRestaurantOperationalStatus({
        ...doc,
        isAcceptingOrders: profile.isAcceptingOrders,
        outsideHoursOverride: false,
        outletTimings,
    });
    return {
        ...profile,
        outsideHoursOverride: false,
        outletTimings,
        operationalStatus,
    };
};

export const updateRestaurantAcceptingOrders = async (restaurantId, isAcceptingOrders) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }
    const value = Boolean(isAcceptingOrders);
    // Offline = manual force-offline. Online = clear override and follow outlet timings.
    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                isAcceptingOrders: value,
                outsideHoursOverride: false,
            },
        },
        {
            new: true,
            runValidators: true,
            projection: [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'isAcceptingOrders',
                'outsideHoursOverride',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();
    const profile = toRestaurantProfile(doc);
    return enrichRestaurantProfileWithAvailability(profile, doc);
};

export const updateRestaurantProfile = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select(
            'restaurantName restaurantNameNormalized ownerPhone ownerPhoneDigits ownerPhoneLast10 primaryContactNumber status location'
        )
        .lean();

    if (!currentRestaurant) {
        throw new ValidationError('Restaurant not found');
    }

    const update = {};

    // Owner/contact fields (used by restaurant Contact Details screens)
    if (body.ownerName !== undefined) {
        const ownerName = String(body.ownerName || '').trim();
        if (!ownerName) {
            throw new ValidationError('Owner name cannot be empty');
        }
        if (ownerName.length > 120) {
            throw new ValidationError('Owner name is too long');
        }
        update.ownerName = ownerName;
    }

    if (body.ownerEmail !== undefined) {
        const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
        if (ownerEmail) {
            const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!EMAIL_REGEX.test(ownerEmail)) {
                throw new ValidationError('Owner email is invalid');
            }
            const domainParts = ownerEmail.split('@')[1].split('.');
            for (let i = 0; i < domainParts.length - 1; i++) {
                if (domainParts[i] === domainParts[i + 1] && domainParts[i].length > 0) {
                    throw new ValidationError('Owner email has repeated domain parts (like .com.com)');
                }
            }
            if (ownerEmail.includes('..')) {
                throw new ValidationError('Owner email cannot contain consecutive dots');
            }
            if (ownerEmail.length > 254) {
                throw new ValidationError('Owner email is too long');
            }
            update.ownerEmail = ownerEmail;
        } else {
            update.ownerEmail = '';
        }
    }

    // Note: UI keeps phone read-only, but we accept it safely and normalize if sent.
    if (body.ownerPhone !== undefined) {
        const { digits, last10 } = normalizePhone(body.ownerPhone);
        if (!digits || digits.length < 8) {
            throw new ValidationError('Owner phone is invalid');
        }

        const currentOwnerPhoneDigits =
            currentRestaurant.ownerPhoneDigits ||
            normalizePhone(currentRestaurant.ownerPhone).digits ||
            '';

        if (digits !== currentOwnerPhoneDigits) {
            update.ownerPhone = digits;
            update.ownerPhoneDigits = digits;
            update.ownerPhoneLast10 = last10 || undefined;
        }
    }

    if (body.primaryContactNumber !== undefined) {
        const { digits } = normalizePhone(body.primaryContactNumber);
        const normalizedPrimaryContact =
            digits || String(body.primaryContactNumber || '').trim();
        const currentPrimaryContact =
            currentRestaurant.primaryContactNumber != null
                ? String(currentRestaurant.primaryContactNumber).trim()
                : '';

        if (normalizedPrimaryContact !== currentPrimaryContact) {
            update.primaryContactNumber = normalizedPrimaryContact;
        }
    }

    if (body.pureVegRestaurant !== undefined) {
        if (typeof body.pureVegRestaurant === 'boolean') {
            update.pureVegRestaurant = body.pureVegRestaurant;
        } else if (typeof body.pureVegRestaurant === 'string') {
            const normalized = body.pureVegRestaurant.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.pureVegRestaurant = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.pureVegRestaurant = false;
            } else {
                throw new ValidationError('pureVegRestaurant must be a boolean');
            }
        } else {
            throw new ValidationError('pureVegRestaurant must be a boolean');
        }
    }

    if (body.zoneId !== undefined && body.location === undefined) {
        const zoneId = String(body.zoneId || '').trim();
        update.zoneId = zoneId && mongoose.Types.ObjectId.isValid(zoneId)
            ? new mongoose.Types.ObjectId(zoneId)
            : undefined;
    }

    // Bank + UPI fields (Explore -> Update Bank Details page)
    if (body.accountHolderName !== undefined) {
        update.accountHolderName = String(body.accountHolderName || '').trim();
    }
    if (body.accountNumber !== undefined) {
        update.accountNumber = String(body.accountNumber || '').replace(/\s|-/g, '').trim();
    }
    if (body.ifscCode !== undefined) {
        update.ifscCode = String(body.ifscCode || '').trim().toUpperCase();
    }
    if (body.accountType !== undefined) {
        update.accountType = String(body.accountType || '').trim();
    }
    if (body.upiId !== undefined) {
        update.upiId = String(body.upiId || '').trim();
    }
    if (body.upiQrImage !== undefined || body.upiQrCode !== undefined) {
        const qrImage = body.upiQrImage !== undefined ? body.upiQrImage : body.upiQrCode;
        update.upiQrImage = String(qrImage || '').trim();
    }

    if (body.name !== undefined || body.restaurantName !== undefined) {
        const raw = body.name !== undefined ? body.name : body.restaurantName;
        const name = String(raw || '').trim();
        if (!name) {
            throw new ValidationError('Restaurant name cannot be empty');
        }
        const normalizedName = normalizeName(name) || undefined;
        const currentName = String(currentRestaurant.restaurantName || '').trim();
        const currentNormalizedName =
            currentRestaurant.restaurantNameNormalized || normalizeName(currentName) || undefined;

        if (name !== currentName || normalizedName !== currentNormalizedName) {
            update.restaurantName = name;
            update.restaurantNameNormalized = normalizedName;
        }
    }

    if (body.cuisines !== undefined) {
        if (!Array.isArray(body.cuisines)) {
            throw new ValidationError('Cuisines must be an array of strings');
        }
        const cuisines = body.cuisines
            .map((c) => String(c || '').trim())
            .filter(Boolean)
            .slice(0, 50);
        update.cuisines = cuisines;
    }

    if (body.location !== undefined) {
        const loc = body.location && typeof body.location === 'object' ? body.location : null;
        if (!loc) {
            throw new ValidationError('Location must be an object');
        }

        const nextLocation = buildLocationObjectFromInput(loc);
        const lat = toFiniteNumber(nextLocation.latitude);
        const lng = toFiniteNumber(nextLocation.longitude);
        if (lat === null || lng === null) {
            throw new ValidationError('Location latitude and longitude are required');
        }

        const matchedZone = await findMatchedZoneForCoordinates(lat, lng);
        if (!matchedZone?._id) {
            throw new ValidationError('Selected location is outside the service zone. Please pin inside an active zone.');
        }

        const pendingZoneId = new mongoose.Types.ObjectId(String(matchedZone._id));
        const isLocationChangeRequest = hasPublishedRestaurantLocation(currentRestaurant);

        if (isLocationChangeRequest) {
            update.pendingLocation = nextLocation;
            update.pendingZoneId = pendingZoneId;
            update.locationUpdateStatus = 'pending';
            update.locationUpdateRequestedAt = new Date();
            update.locationRejectionReason = '';
            update.locationUpdateReviewedAt = null;
        } else {
            update.location = nextLocation;
            update.zoneId = pendingZoneId;
            update.addressLine1 = nextLocation.addressLine1;
            update.addressLine2 = nextLocation.addressLine2;
            update.area = nextLocation.area;
            update.city = nextLocation.city;
            update.state = nextLocation.state;
            update.pincode = nextLocation.pincode;
            update.landmark = nextLocation.landmark;
            update.locationUpdateStatus = 'none';
        }
    }

    if (body.openingTime !== undefined) {
        update.openingTime = normalizeRestaurantTime(body.openingTime) || '';
    }
    if (body.closingTime !== undefined) {
        update.closingTime = normalizeRestaurantTime(body.closingTime) || '';
    }
    if (body.openDays !== undefined) {
        if (!Array.isArray(body.openDays)) {
            throw new ValidationError('openDays must be an array');
        }
        update.openDays = body.openDays
            .map((day) => String(day || '').trim())
            .filter(Boolean)
            .slice(0, 7);
    }
    if (body.estimatedDeliveryTime !== undefined) {
        const estimatedDeliveryTimeText = String(body.estimatedDeliveryTime || '').trim();
        update.estimatedDeliveryTime = estimatedDeliveryTimeText;
        update.estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText) ?? undefined;
    }

    const openingMinutes = body.openingTime !== undefined ? timeToMinutes(update.openingTime) : null;
    const closingMinutes = body.closingTime !== undefined ? timeToMinutes(update.closingTime) : null;
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        if (closingMinutes < openingMinutes) {
            throw new ValidationError('Closing time cannot be less than opening time');
        }
    }

    if (body.menuImages !== undefined) {
        if (!Array.isArray(body.menuImages)) {
            throw new ValidationError('menuImages must be an array');
        }
        const urls = body.menuImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.menuImages = urls;
    }

    if (body.coverImages !== undefined) {
        if (!Array.isArray(body.coverImages)) {
            throw new ValidationError('coverImages must be an array');
        }
        const urls = body.coverImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.coverImages = urls;
    }

    if (body.profileImage !== undefined) {
        update.profileImage = toUrl(body.profileImage) || '';
    }

    if (body.panNumber !== undefined) {
        update.panNumber = String(body.panNumber || '').trim().toUpperCase();
    }
    if (body.nameOnPan !== undefined) {
        update.nameOnPan = String(body.nameOnPan || '').trim();
    }
    if (body.panImage !== undefined) {
        update.panImage = toUrl(body.panImage) || '';
    }
    if (body.gstRegistered !== undefined) {
        if (typeof body.gstRegistered === 'boolean') {
            update.gstRegistered = body.gstRegistered;
        } else if (typeof body.gstRegistered === 'string') {
            const normalized = body.gstRegistered.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.gstRegistered = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.gstRegistered = false;
            } else {
                throw new ValidationError('gstRegistered must be a boolean');
            }
        } else {
            throw new ValidationError('gstRegistered must be a boolean');
        }
    }
    if (body.gstNumber !== undefined) {
        update.gstNumber = String(body.gstNumber || '').trim().toUpperCase();
    }
    if (body.gstLegalName !== undefined) {
        update.gstLegalName = String(body.gstLegalName || '').trim();
    }
    if (body.gstAddress !== undefined) {
        update.gstAddress = String(body.gstAddress || '').trim();
    }
    if (body.gstImage !== undefined) {
        update.gstImage = toUrl(body.gstImage) || '';
    }
    if (body.fssaiNumber !== undefined) {
        update.fssaiNumber = String(body.fssaiNumber || '').trim();
    }
    if (body.fssaiExpiry !== undefined) {
        const rawExpiry = String(body.fssaiExpiry || '').trim();
        if (!rawExpiry) {
            update.fssaiExpiry = null;
        } else {
            const parsedExpiry = new Date(rawExpiry);
            if (Number.isNaN(parsedExpiry.getTime())) {
                throw new ValidationError('FSSAI expiry date is invalid');
            }
            update.fssaiExpiry = parsedExpiry;
        }
    }
    if (body.fssaiImage !== undefined) {
        update.fssaiImage = toUrl(body.fssaiImage) || '';
    }

    if (!Object.keys(update).length) {
        return getCurrentRestaurantProfile(restaurantId);
    }

    // Only move profile to pending review when sensitive business/KYC fields are changed.
    // Operational updates like location/zone/timings should stay visible to users immediately.
    const reviewRequiredFields = new Set([
        'restaurantName',
        'restaurantNameNormalized',
        'ownerName',
        'ownerEmail',
        'ownerPhone',
        'ownerPhoneDigits',
        'ownerPhoneLast10',
        'primaryContactNumber',
        'panNumber',
        'nameOnPan',
        'panImage',
        'gstRegistered',
        'gstNumber',
        'gstLegalName',
        'gstAddress',
        'gstImage',
        'fssaiNumber',
        'fssaiExpiry',
        'fssaiImage',
        'accountHolderName',
        'accountNumber',
        'ifscCode',
        'accountType',
        'upiId',
        'upiQrImage',
        'profileImage',
        'coverImages',
        'menuImages'
    ]);

    const requiresReview = Object.keys(update).some((field) => reviewRequiredFields.has(field));
    const isLocationChangeRequest = update.locationUpdateStatus === 'pending' && Boolean(update.pendingLocation);

    if (requiresReview) {
        update.status = 'pending';
    }

    const updateOps = requiresReview
        ? {
            $set: update,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        }
        : {
            $set: update
        };

    try {
        const doc = await FoodRestaurant.findByIdAndUpdate(
            restaurantId,
            updateOps,
            {
                new: true,
                runValidators: true,
                projection: [
                    'restaurantName',
                    'cuisines',
                    'location',
                    'addressLine1',
                    'addressLine2',
                    'area',
                    'city',
                    'state',
                    'pincode',
                    'landmark',
                    'ownerName',
                    'ownerEmail',
                    'ownerPhone',
                    'primaryContactNumber',
                    'pureVegRestaurant',
                    'profileImage',
                    'coverImages',
                    'menuImages',
                    'openingTime',
                    'closingTime',
                    'openDays',
                    'status',
                    'createdAt',
                    'updatedAt',
                    'panNumber',
                    'nameOnPan',
                    'panImage',
                    'gstRegistered',
                    'gstNumber',
                    'gstLegalName',
                    'gstAddress',
                    'gstImage',
                    'fssaiNumber',
                    'fssaiExpiry',
                    'fssaiImage',
                    'accountNumber',
                    'ifscCode',
                    'accountHolderName',
                    'accountType',
                    'upiId',
                    'upiQrImage',
                    'estimatedDeliveryTime',
                    'estimatedDeliveryTimeMinutes',
                    'zoneId',
                    'pendingLocation',
                    'pendingZoneId',
                    'locationUpdateStatus',
                    'locationUpdateRequestedAt',
                    'locationUpdateReviewedAt',
                    'locationRejectionReason'
                ].join(' ')
            }
        ).lean();

        if (requiresReview && currentRestaurant.status !== 'pending') {
            const restaurantNameForNotification =
                update.restaurantName || currentRestaurant.restaurantName || doc?.restaurantName;
            void notifyAdminsAboutRestaurantProfileReview(restaurantId, restaurantNameForNotification);
        }

        if (isLocationChangeRequest) {
            void notifyAdminsAboutRestaurantLocationUpdate(
                restaurantId,
                currentRestaurant.restaurantName || doc?.restaurantName
            );
        }

        return toRestaurantProfile(doc);
    } catch (err) {
        if (err && err.code === 11000) {
            throw new ValidationError('A restaurant with this name and phone already exists');
        }
        throw err;
    }
};

export const uploadRestaurantProfileImage = async (restaurantId, file) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!file?.buffer) throw new ValidationError('Image file is required');

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/profile');
    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                profileImage: url,
                status: 'pending'
            },
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true, projection: 'profileImage coverImages restaurantName cuisines location menuImages addressLine1 addressLine2 area city state pincode landmark ownerName ownerEmail ownerPhone primaryContactNumber pureVegRestaurant openingTime closingTime openDays status createdAt updatedAt' }
    ).lean();

    if (!doc) throw new ValidationError('Restaurant not found');

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || doc.restaurantName);
    }

    return { profileImage: { url } };
};

export const uploadRestaurantMenuImage = async (file) => {
    if (!file?.buffer) throw new ValidationError('Image file is required');
    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/menu');
    return { menuImage: { url, publicId: null } };
};

export const uploadRestaurantCoverImages = async (restaurantId, files = []) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status profileImage coverImages')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const uploadedUrls = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/cover'))
    );
    const existingCoverImages = Array.isArray(currentRestaurant.coverImages)
        ? currentRestaurant.coverImages.map((image) => toUrl(image)).filter(Boolean)
        : [];
    const nextCoverImages = [...existingCoverImages];

    uploadedUrls.forEach((url) => {
        if (!nextCoverImages.includes(url)) nextCoverImages.push(url);
    });

    const update = {
        coverImages: nextCoverImages.slice(0, 20),
        status: 'pending'
    };

    if (!toUrl(currentRestaurant.profileImage) && uploadedUrls[0]) {
        update.profileImage = uploadedUrls[0];
    }

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: update,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');
    }

    return {
        coverImages: uploadedUrls.map((url) => ({ url, publicId: null })),
        profileImage: update.profileImage ? { url: update.profileImage } : undefined
    };
};

export const uploadRestaurantMenuImages = async (restaurantId, files = []) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status menuImages')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const uploadedUrls = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/menu'))
    );
    const existingMenuImages = Array.isArray(currentRestaurant.menuImages)
        ? currentRestaurant.menuImages.map((image) => toUrl(image)).filter(Boolean)
        : [];
    const nextMenuImages = [...existingMenuImages];

    uploadedUrls.forEach((url) => {
        if (!nextMenuImages.includes(url)) nextMenuImages.push(url);
    });

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                menuImages: nextMenuImages.slice(0, 20),
                status: 'pending'
            },
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');
    }

    return {
        menuImages: uploadedUrls.map((url) => ({ url, publicId: null }))
    };
};

export const listApprovedRestaurants = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { status: 'approved' };

    if (query.city && String(query.city).trim()) {
        const city = String(query.city).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(city), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.city': rx }, { city: rx }] }];
    }
    if (query.area && String(query.area).trim()) {
        const area = String(query.area).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(area), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.area': rx }, { area: rx }] }];
    }
    // ?storeType=<type> narrows to one kind of shop. Validated rather than
    // passed through, so an unknown value is refused instead of quietly matching
    // nothing and looking like an empty neighbourhood. 'pharmacy' is refused too:
    // legacy pharmacies are not public (the Medical vertical was removed).
    // With no type asked for (or "quick") this is the Quick Shop list.
    const askedType = String(query.storeType || '').trim().toLowerCase();
    if (askedType && askedType !== 'quick') {
        filter.storeType = normalizeStoreTypeInput(askedType);
    } else {
        Object.assign(filter, QUICK_SHOP_SELLER_FILTER);
    }
    if (query.cuisine && String(query.cuisine).trim()) {
        const cuisine = normalizeCuisine(query.cuisine);
        // cuisines is an array of strings.
        filter.cuisines = { $in: [new RegExp(escapeRegex(cuisine), 'i')] };
    }
    if (query.hasOffers === 'true') {
        const activeOfferFilter = buildActivePublicOfferFilter();
        const [hasGlobalOffers, selectedOffers] = await Promise.all([
            FoodOffer.exists({
                ...activeOfferFilter,
                restaurantScope: 'all'
            }),
            FoodOffer.find({
                ...activeOfferFilter,
                restaurantScope: 'selected'
            })
                .select('restaurantId restaurantIds')
                .lean()
        ]);

        if (!hasGlobalOffers) {
            const eligibleRestaurantIds = Array.from(
                new Set(
                    selectedOffers.flatMap((offer) => [
                        ...(Array.isArray(offer.restaurantIds) ? offer.restaurantIds : []),
                        offer.restaurantId
                    ].map((id) => String(id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id)))
                )
            ).map((id) => new mongoose.Types.ObjectId(id));

            const hasOfferCondition = [
                { offer: { $exists: true, $nin: [null, ''] } }
            ];

            if (eligibleRestaurantIds.length) {
                hasOfferCondition.push({ _id: { $in: eligibleRestaurantIds } });
            }

            if (Array.isArray(filter.$or) && filter.$or.length) {
                filter.$and = [...(filter.$and || []), { $or: filter.$or }];
                delete filter.$or;
            }

            filter.$and = [...(filter.$and || []), { $or: hasOfferCondition }];
        }
    }
    const minRating = toFiniteNumber(query.minRating);
    if (minRating !== null) {
        filter.rating = { $gte: Math.max(0, Math.min(5, minRating)) };
    }
    const maxDeliveryTime = toFiniteNumber(query.maxDeliveryTime);
    if (maxDeliveryTime !== null) {
        filter.estimatedDeliveryTimeMinutes = { $lte: Math.max(0, Math.round(maxDeliveryTime)) };
    }
    const maxPrice = toFiniteNumber(query.maxPrice);
    if (maxPrice !== null) {
        filter.featuredPrice = { $lte: Math.max(0, maxPrice) };
    }
    if (query.topRated === 'true') {
        filter.rating = { ...(filter.rating || {}), $gte: 4.5 };
    }
    if (query.trusted === 'true') {
        filter.totalRatings = { ...(filter.totalRatings || {}), $gte: 100 };
    }
    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = escapeRegex(raw);
        if (term.length >= 2) {
            filter.$or = [
                { restaurantName: { $regex: term, $options: 'i' } },
                { area: { $regex: term, $options: 'i' } },
                { city: { $regex: term, $options: 'i' } },
                { 'location.area': { $regex: term, $options: 'i' } },
                { 'location.city': { $regex: term, $options: 'i' } },
                { cuisines: { $in: [new RegExp(term, 'i')] } }
            ];
        }
    }

    // Strict zone filter for user listing:
    // if zoneId is provided, return only restaurants mapped to that zone.
    const zoneIdRaw = String(query.zoneId || '').trim();
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        filter.zoneId = new mongoose.Types.ObjectId(zoneIdRaw);
    }

    const lat = toFiniteNumber(query.lat);
    const lng = toFiniteNumber(query.lng);
    // Accept both radiusKm (preferred) and maxDistance (legacy frontend param).
    const radiusKm = toFiniteNumber(query.radiusKm) ?? toFiniteNumber(query.maxDistance);
    const sortBy = parseSortBy(query.sortBy);

    const projection = {
        restaurantName: 1,
        area: 1,
        city: 1,
        cuisines: 1,
        profileImage: 1,
        coverImages: 1,
        menuImages: 1,
        estimatedDeliveryTime: 1,
        estimatedDeliveryTimeMinutes: 1,
        offer: 1,
        featuredDish: 1,
        featuredPrice: 1,
        rating: 1,
        totalRatings: 1,
        isAcceptingOrders: 1,
        status: 1,
        pureVegRestaurant: 1,
        createdAt: 1,
        location: 1,
        openingTime: 1,
        closingTime: 1,
        openDays: 1,
        // What kind of shop this is. Projected here as well as in
        // PUBLIC_RESTAURANT_SELECT because this listing builds its own
        // projection rather than using that constant.
        storeType: 1
    };

    // Use $geoNear only when geo is explicitly needed (radius filter or nearest sorting).
    // This avoids accidentally hiding restaurants that do not have coordinates yet.
    const wantsGeo = (radiusKm !== null) || sortBy === 'nearest';
    if (lat !== null && lng !== null && wantsGeo) {
        const geoNear = {
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                distanceField: 'distanceMeters',
                spherical: true,
                query: filter
            }
        };
        if (radiusKm !== null) {
            geoNear.$geoNear.maxDistance = Math.max(0.1, radiusKm) * 1000;
        }

        const sortStage = (() => {
            if (sortBy === 'rating' || sortBy === 'rating-high') return { $sort: { rating: -1, distanceMeters: 1 } };
            if (sortBy === 'rating-low') return { $sort: { rating: 1, distanceMeters: 1 } };
            if (sortBy === 'price-low') return { $sort: { featuredPrice: 1, distanceMeters: 1 } };
            if (sortBy === 'price-high') return { $sort: { featuredPrice: -1, distanceMeters: 1 } };
            if (sortBy === 'newest') return { $sort: { createdAt: -1 } };
            if (sortBy === 'deliveryTime') return { $sort: { estimatedDeliveryTimeMinutes: 1, distanceMeters: 1 } };
            // nearest (default)
            return { $sort: { distanceMeters: 1 } };
        })();

        const basePipeline = [
            geoNear,
            {
                $addFields: {
                    distanceInKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 2] }
                }
            },
            sortStage
        ];

        const [pageDocs, totalDocs] = await Promise.all([
            FoodRestaurant.aggregate([
                ...basePipeline,
                { $project: projection },
                { $skip: skip },
                { $limit: limit }
            ]),
            FoodRestaurant.aggregate([...basePipeline, { $count: 'count' }])
        ]);

        const total = totalDocs?.[0]?.count || 0;
        const restaurants = pageDocs || [];
        const restaurantIds = restaurants.map(r => r._id);
        const recommendedItemsRaw = restaurantIds.length
            ? await FoodItem.find({
                restaurantId: { $in: restaurantIds },
                isRecommended: true,
                approvalStatus: 'approved'
            })
                .select('restaurantId name price image')
                .sort({ createdAt: -1 })
                .lean()
            : [];

        const recommendedMap = recommendedItemsRaw.reduce((acc, item) => {
            const rId = String(item.restaurantId);
            if (!acc[rId]) acc[rId] = [];
            if (acc[rId].length < 10) {
                acc[rId].push({
                    id: String(item._id),
                    name: item.name,
                    price: item.price,
                    image: item.image
                });
            }
            return acc;
        }, {});

        const restaurantsWithRecommended = restaurants.map(r => {
            return {
                ...r,
                recommendedItems: recommendedMap[String(r._id)] || []
            };
        });
        const restaurantsWithOffers = await attachPublicOffersToRestaurants(restaurantsWithRecommended);
        const restaurantsWithTimings = await attachOutletTimingsToRestaurants(restaurantsWithOffers);

        return {
            restaurants: restaurantsWithTimings.map((r) =>
                normalizePublicRestaurantGeo(r, lat, lng),
            ),
            total,
            page,
            limit,
        };
    }

    // Non-geo path: normal query + sort.
    const sort = (() => {
        if (sortBy === 'rating' || sortBy === 'rating-high') return { rating: -1, createdAt: -1 };
        if (sortBy === 'rating-low') return { rating: 1, createdAt: -1 };
        if (sortBy === 'price-low') return { featuredPrice: 1, createdAt: -1 };
        if (sortBy === 'price-high') return { featuredPrice: -1, createdAt: -1 };
        if (sortBy === 'deliveryTime') return { estimatedDeliveryTimeMinutes: 1, createdAt: -1 };
        return { createdAt: -1 };
    })();

    const [restaurantsRaw, total] = await Promise.all([
        FoodRestaurant.find(filter)
            .select(Object.keys(projection).join(' '))
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        FoodRestaurant.countDocuments(filter)
    ]);

    const restaurants = (restaurantsRaw || []).map((r) => ({
        ...r,
        // Frontend user app expects `name` and often checks `profileImage.url`
        restaurantId: r._id,
        id: r._id,
        name: r.restaurantName || '',
        rating: normalizeRatingValue(r.rating),
        totalRatings: normalizeTotalRatingsValue(r.totalRatings),
        profileImage: r.profileImage ? { url: r.profileImage } : null,
        coverImages: Array.isArray(r.coverImages) ? r.coverImages : [],
        openingTime: r.openingTime || null,
        closingTime: r.closingTime || null,
        openDays: Array.isArray(r.openDays) ? r.openDays : [],
        // Keep menuImages as an array for fallbacks; allow both string and {url} on client.
        menuImages: Array.isArray(r.menuImages) ? r.menuImages : []
    }));

    const restaurantIds = restaurants.map(r => r._id);
    const recommendedItemsRaw = restaurantIds.length
        ? await FoodItem.find({
            restaurantId: { $in: restaurantIds },
            isRecommended: true,
            approvalStatus: 'approved'
        })
            .select('restaurantId name price image')
            .sort({ createdAt: -1 })
            .lean()
        : [];

    const recommendedMap = recommendedItemsRaw.reduce((acc, item) => {
        const rId = String(item.restaurantId);
        if (!acc[rId]) acc[rId] = [];
        if (acc[rId].length < 10) {
            acc[rId].push({
                id: String(item._id),
                name: item.name,
                price: item.price,
                image: item.image
            });
        }
        return acc;
    }, {});

    const restaurantsWithRecommended = restaurants.map(r => {
        return {
            ...r,
            recommendedItems: recommendedMap[String(r._id)] || []
        };
    });
    const restaurantsWithOffers = await attachPublicOffersToRestaurants(restaurantsWithRecommended);
    const restaurantsWithTimings = await attachOutletTimingsToRestaurants(restaurantsWithOffers);

    return {
        restaurants: restaurantsWithTimings.map((r) =>
            normalizePublicRestaurantGeo(r, lat, lng),
        ),
        total,
        page,
        limit,
    };
};

/**
 * Everything a customer-facing client may see about a seller.
 *
 * An allowlist on purpose. As an exclusion list, any sensitive field added to
 * the schema later would leak by default — which is exactly how this endpoint
 * came to return bank account numbers, IFSC codes, PAN numbers and a URL to the
 * PAN scan to anyone who asked, unauthenticated.
 *
 * Never add to this list: accountNumber, accountHolderName, accountType,
 * ifscCode, nameOnPan, panNumber, panImage, gstImage, gstRegistered,
 * fssaiNumber, fssaiImage, fssaiExpiry, ownerName, ownerEmail, ownerPhone,
 * ownerPhoneDigits, ownerPhoneLast10, primaryContactNumber, fcmTokens,
 * fcmTokenMobile, tokenVersion, any subscription* or onboardingFee* field.
 */
export const PUBLIC_RESTAURANT_SELECT = [
    '_id', 'restaurantName', 'restaurantNameNormalized', 'description',
    'profileImage', 'coverImage', 'coverImages', 'galleryImages', 'menuImages',
    'cuisines', 'rating', 'totalRatings',
    'addressLine1', 'addressLine2', 'area', 'city', 'state', 'pincode',
    'landmark', 'formattedAddress', 'location', 'latitude', 'longitude',
    'estimatedDeliveryTime', 'estimatedDeliveryTimeMinutes',
    'isAcceptingOrders', 'isVerified', 'openingTime', 'closingTime', 'openDays',
    'outletTimings', 'deliveryTimings', 'outsideHoursOverride',
    'pureVegRestaurant', 'offer', 'featuredDish',
    'featuredPrice', 'status', 'zoneId', 'createdAt',
    // What kind of shop this is (grocery, kirana, ...).
    'storeType',
].join(' ');

export const getApprovedRestaurantByIdOrSlug = async (idOrSlug) => {
    const value = String(idOrSlug || '').trim();
    if (!value) return null;

    // ObjectId path
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        const doc = await FoodRestaurant.findOne({ _id: value, status: 'approved' })
            .select(PUBLIC_RESTAURANT_SELECT)
            .lean();
        if (!doc) return null;
        const [withTimings] = await attachOutletTimingsToRestaurants([
            normalizePublicRestaurantGeo(
                stripPendingLocationFromPublicRestaurant({
                    ...doc,
                    rating: normalizeRatingValue(doc.rating),
                    totalRatings: normalizeTotalRatingsValue(doc.totalRatings),
                }),
            ),
        ]);
        return withTimings;
    }

    // Slug path: use normalized field for index-friendly exact match.
    const restaurantNameNormalized = normalizeName(value);
    if (!restaurantNameNormalized) return null;

    const doc = await FoodRestaurant.findOne({
        status: 'approved',
        restaurantNameNormalized
    })
        .select(PUBLIC_RESTAURANT_SELECT)
        .lean();
    if (!doc) return null;
    const [withTimings] = await attachOutletTimingsToRestaurants([
        normalizePublicRestaurantGeo(
            stripPendingLocationFromPublicRestaurant({
                ...doc,
                rating: normalizeRatingValue(doc.rating),
                totalRatings: normalizeTotalRatingsValue(doc.totalRatings),
            }),
        ),
    ]);
    return withTimings;
};

export const listPublicOffers = async (query = {}) => {
    const { subtotal, restaurantId, userId } = query;
    const now = new Date();
    const filter = buildActivePublicOfferFilter(now);

    // If restaurantId is provided, filter for global (all) or specific restaurant coupons
    if (restaurantId && mongoose.Types.ObjectId.isValid(restaurantId)) {
        filter.$and.push({
            $or: [
                { restaurantScope: 'all' },
                { 
                    $and: [
                        { restaurantScope: 'selected' },
                        {
                            $or: [
                                { restaurantIds: new mongoose.Types.ObjectId(restaurantId) },
                                { restaurantId: new mongoose.Types.ObjectId(restaurantId) }
                            ]
                        }
                    ]
                }
            ]
        });
    }

    // If userId is provided, filter out first-time only coupons if user already has orders
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const orderCount = await FoodOrder.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
        if (orderCount > 0) {
            filter.$and.push({
                customerScope: { $ne: 'first-time' },
                isFirstOrderOnly: { $ne: true }
            });
        }
    }

    // If subtotal is provided, filter by minOrderValue
    if (subtotal !== undefined && subtotal !== null && subtotal !== '' && !isNaN(Number(subtotal))) {
        const numericSubtotal = Number(subtotal);
        if (numericSubtotal > 0) {
            filter.$and.push({
                $or: [
                    { minOrderValue: { $exists: false } },
                    { minOrderValue: null },
                    { minOrderValue: { $lte: numericSubtotal } }
                ]
            });
        }
    }

    const list = await FoodOffer.find(filter)
        .sort({ createdAt: -1 })
        .populate({ path: 'restaurantId', select: 'restaurantName restaurantNameNormalized profileImage estimatedDeliveryTime rating storeType' })
        .populate({ path: 'restaurantIds', select: 'restaurantName restaurantNameNormalized profileImage estimatedDeliveryTime rating storeType' })
        .lean();

    // Legacy pharmacies are not public: a store-specific offer shows only if it
    // covers at least one store that is not one.
    const offersForThisList = list.filter((o) => {
        if (o.restaurantScope !== 'selected') return true;
        const stores = Array.isArray(o.restaurantIds) && o.restaurantIds.length > 0
            ? o.restaurantIds
            : (o.restaurantId ? [o.restaurantId] : []);
        const known = stores.filter((s) => s && typeof s === 'object');
        if (known.length === 0) return true;
        return known.some((s) => !isLegacyPharmacy(s.storeType));
    });

    let allOffers = offersForThisList.map((o) => {
        const selectedRestaurants = Array.isArray(o.restaurantIds) && o.restaurantIds.length > 0
            ? o.restaurantIds
            : (o.restaurantId ? [o.restaurantId] : []);
        const restaurant = selectedRestaurants.find((item) => String(item?._id || item) === String(restaurantId || ''))
            || selectedRestaurants[0]
            || null;
        const restaurantIds = selectedRestaurants.map((item) => String(item?._id || item)).filter(Boolean);
        const restaurantSlug = restaurant?.restaurantNameNormalized || undefined;
        const restaurantName =
            o.restaurantScope === 'selected'
                ? (restaurant?.restaurantName || 'Selected Restaurants')
                : 'All Restaurants';

        const title =
            o.discountType === 'percentage'
                ? `${Number(o.discountValue) || 0}% OFF`
                : `Flat ₹${Number(o.discountValue) || 0} OFF`;

        return {
            id: String(o._id),
            offerId: String(o._id),
            couponCode: o.couponCode,
            title,
            discountType: o.discountType,
            discountValue: o.discountValue,
            maxDiscount: o.maxDiscount ?? null,
            perUserLimit: o.perUserLimit ?? null,
            customerScope: o.customerScope,
            isFirstOrderOnly: !!o.isFirstOrderOnly,
            restaurantScope: o.restaurantScope,
            restaurantId: restaurant?._id ? String(restaurant._id) : (o.restaurantScope === 'selected' ? String(o.restaurantId) : null),
            restaurantIds,
            restaurantName,
            restaurantSlug,
            restaurantImage: restaurant?.profileImage || null,
            deliveryTime: restaurant?.estimatedDeliveryTime || null,
            restaurantRating: typeof restaurant?.rating === 'number' ? restaurant.rating : 0,
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            minOrderValue: o.minOrderValue ?? 0
        };
    });

    // If userId is provided, filter out coupons that have reached their per-user limit
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const usages = await FoodOfferUsage.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
        const usageMap = usages.reduce((map, u) => {
            map[String(u.offerId)] = Number(u.count || 0);
            return map;
        }, {});

        allOffers = allOffers.filter((o) => {
            const perUserLimit = Number(o.perUserLimit || 0);
            if (perUserLimit > 0) {
                const used = usageMap[String(o.id)] || 0;
                return used < perUserLimit;
            }
            return true;
        });
    }

    return { allOffers, groupedByOffer: {} };
};

/**
 * List complaints for a restaurant.
 * Calls adminService.getRestaurantComplaints with fixed restaurantId.
 */
export const getRestaurantComplaints = async (restaurantId, query = {}) => {
    const { getRestaurantComplaints: getComplaintsInternal } = await import('../../admin/services/admin.service.js');
    return getComplaintsInternal({ ...query, restaurantId });
};


/**
 * Create a new offer for a restaurant.
 */
export async function createRestaurantOffer(restaurantId, body) {
    const existing = await FoodOffer.findOne({ couponCode: body.couponCode }).lean();
    if (existing) {
        throw new ValidationError('Coupon code already exists');
    }

    const doc = await FoodOffer.create({
        couponCode: body.couponCode,
        discountType: body.discountType,
        discountValue: body.discountValue,
        customerScope: body.customerScope || 'all',
        restaurantScope: 'selected',
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        minOrderValue: body.minOrderValue ?? 0,
        maxDiscount: body.maxDiscount ?? null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        startDate: body.startDate,
        isFirstOrderOnly: body.isFirstOrderOnly ?? false,
        endDate: body.endDate,
        status: body.endDate && new Date(body.endDate).getTime() <= Date.now() ? 'inactive' : 'active',
        showInCart: true,
        createdByRole: 'RESTAURANT',
        adminBearPercentage: 0,
        restaurantBearPercentage: 100
    });

    return doc;
}

/**
 * List offers for a specific restaurant.
 */
export async function listRestaurantOffers(restaurantId) {
    const list = await FoodOffer.find({
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        restaurantScope: 'selected'
    }).sort({ createdAt: -1 }).lean();

    return list.map(o => ({
        ...o,
        id: String(o._id),
        offerId: String(o._id)
    }));
}

/**
 * Delete a restaurant offer.
 */
export async function deleteRestaurantOffer(restaurantId, offerId) {
    const res = await FoodOffer.deleteOne({
        _id: new mongoose.Types.ObjectId(offerId),
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        createdByRole: 'RESTAURANT'
    });
    if (res.deletedCount === 0) {
        throw new NotFoundError('Offer not found or not owned by you');
    }
    return true;
}

/**
 * Toggle status of a restaurant offer.
 */
export async function updateRestaurantOfferStatus(restaurantId, offerId, status) {
    const allowedStatus = ['active', 'paused', 'inactive'];
    if (!allowedStatus.includes(status)) {
        throw new ValidationError('Invalid status');
    }

    const doc = await FoodOffer.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(offerId),
            restaurantId: new mongoose.Types.ObjectId(restaurantId),
            createdByRole: 'RESTAURANT'
        },
        { $set: { status } },
        { new: true }
    );

    if (!doc) {
        throw new NotFoundError('Offer not found or not owned by you');
    }

    return doc;
}

/**
 * Delete a restaurant and all associated data (menu, wallet, items, timings) permanently.
 */
export const deleteCurrentRestaurantAccount = async (restaurantId) => {
    // Dynamic imports to avoid issues
    const { FoodRestaurantMenu } = await import('../models/restaurantMenu.model.js');
    const { FoodRestaurantWallet } = await import('../models/restaurantWallet.model.js');
    const { FoodRestaurantOutletTimings } = await import('../models/outletTimings.model.js');
    const { FoodItem } = await import('../../admin/models/food.model.js');
    const { FoodAddon } = await import('../models/foodAddon.model.js');

    const restaurant = await FoodRestaurant.findById(restaurantId);
    if (!restaurant) throw new NotFoundError('Restaurant not found');

    // Remove all associated documents
    await FoodRestaurantMenu.findOneAndDelete({ restaurantId });
    await FoodRestaurantWallet.findOneAndDelete({ restaurantId });
    await FoodRestaurantOutletTimings.findOneAndDelete({ restaurantId });
    await FoodItem.deleteMany({ restaurantId });
    await FoodAddon.deleteMany({ restaurantId });

    // Remove Restaurant
    await FoodRestaurant.findByIdAndDelete(restaurantId);

    return { success: true };
};
