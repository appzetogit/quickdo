import { FoodRestaurant } from '../models/restaurant.model.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import mongoose from 'mongoose';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { attachOutletOpenState, describeOutletHours } from '../../shared/outletHours.js';

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

const toUrl = (v) => (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : '';

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
            ? {
                type: loc?.type || 'Point',
                coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
                latitude: typeof loc?.latitude === 'number' ? loc.latitude : (Array.isArray(loc?.coordinates) ? loc.coordinates[1] : undefined),
                longitude: typeof loc?.longitude === 'number' ? loc.longitude : (Array.isArray(loc?.coordinates) ? loc.coordinates[0] : undefined),
                formattedAddress: loc?.formattedAddress || loc?.address || '',
                address: loc?.address || loc?.formattedAddress || '',
                addressLine1: loc?.addressLine1 || doc.addressLine1 || '',
                addressLine2: loc?.addressLine2 || doc.addressLine2 || '',
                area: loc?.area || doc.area || '',
                city: loc?.city || doc.city || '',
                state: loc?.state || doc.state || '',
                pincode: loc?.pincode || doc.pincode || '',
                landmark: loc?.landmark || doc.landmark || ''
            }
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
        priceIncludesGst: doc.priceIncludesGst === true,
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
        status: doc.status || null,
        petpoojaEnabled: Boolean(doc.petpoojaEnabled),
        petpoojaOutletId: doc.petpoojaOutletId || '',
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

const MAX_RECOMMENDED_IMAGES_PER_RESTAURANT = 8;

/**
 * Add the free delivery offer each restaurant is actually running, so the app can
 * badge a restaurant card instead of leaving the customer to discover it at
 * checkout.
 *
 * The rule resolves per restaurant -- a restaurant's own setting beats the
 * platform one, including an exclusion -- so this cannot be a single value the
 * app fetches once. The fee settings are read once per request rather than once
 * per restaurant.
 *
 * The badge states the offer's terms, not a promise for this customer: the list
 * has no delivery distance to test against, so whether the radius is actually met
 * is settled at checkout by the pricing call. The copy says "within N km" for
 * exactly that reason.
 *
 * The stored mode enum is deliberately not exposed. 'off' is an internal way of
 * saying "no offer here", and an app that saw it might render an exclusion as if
 * it were a promotion.
 */
/**
 * The categories this restaurant's live menu actually uses.
 *
 * The app was rendering the platform-wide list -- Burgers, Beverages and so on
 * -- because that is all any public endpoint offered: /categories/public
 * returns zone plus global categories with no way to scope to one restaurant,
 * and the detail response carried none at all. So a restaurant selling Briyani,
 * Pasta and Sweets showed chips for categories it does not stock.
 *
 * Derived from the dishes rather than from what the restaurant once created, so
 * a category with nothing orderable in it does not appear as an empty tab.
 * Sorted the way the menu sorts, so the chips and the sections agree.
 */
const attachMenuCategories = async (restaurant) => {
    if (!restaurant?._id) return restaurant;
    try {
        const { FoodItem } = await import('../../admin/models/food.model.js');
        const { FoodCategory } = await import('../../admin/models/category.model.js');

        const foods = await FoodItem.find({
            restaurantId: restaurant._id,
            approvalStatus: 'approved',
            isActive: { $ne: false },
        }).select('categoryId categoryName').lean();

        const counts = new Map();
        for (const food of foods) {
            const id = food?.categoryId ? String(food.categoryId) : '';
            const key = id || `name:${String(food?.categoryName || 'Menu').toLowerCase()}`;
            const row = counts.get(key) || { id: id || null, name: food?.categoryName || 'Menu', itemCount: 0 };
            row.itemCount += 1;
            counts.set(key, row);
        }
        if (!counts.size) return { ...restaurant, menuCategories: [] };

        const ids = [...counts.values()].map((r) => r.id).filter(Boolean);
        const docs = ids.length
            ? await FoodCategory.find({ _id: { $in: ids } }).select('name image sortOrder').lean()
            : [];
        const byId = new Map(docs.map((d) => [String(d._id), d]));

        const menuCategories = [...counts.values()]
            .map((row) => {
                const doc = row.id ? byId.get(row.id) : null;
                return {
                    id: row.id,
                    name: doc?.name || row.name,
                    image: doc?.image || '',
                    itemCount: row.itemCount,
                    sortOrder: Number.isFinite(Number(doc?.sortOrder)) ? Number(doc.sortOrder) : Number.MAX_SAFE_INTEGER,
                };
            })
            .sort((a, b) => (a.sortOrder !== b.sortOrder
                ? a.sortOrder - b.sortOrder
                : String(a.name).localeCompare(String(b.name))));

        return { ...restaurant, menuCategories };
    } catch (err) {
        // A category lookup must never fail the restaurant page.
        console.error('Menu categories lookup failed:', err?.message || err);
        return { ...restaurant, menuCategories: [] };
    }
};

const attachFreeDeliveryOffer = async (restaurants = []) => {
    const list = Array.isArray(restaurants) ? restaurants : [];
    if (!list.length) return list;

    let platformRule = null;
    try {
        const { FoodFeeSettings } = await import('../../admin/models/feeSettings.model.js');
        const feeDoc = await FoodFeeSettings.findOne({ isActive: true })
            .sort({ createdAt: -1 })
            .select('freeDeliveryRule')
            .lean();
        platformRule = feeDoc?.freeDeliveryRule || null;
    } catch (err) {
        // A missing fee document must not break the restaurant list; every
        // restaurant simply reports no offer.
        console.error('Free delivery badge: fee settings unavailable:', err?.message || err);
    }

    const { resolveEffectiveFreeDeliveryRule, describeFreeDeliveryRule } =
        await import('../../shared/freeDeliveryRule.js');

    return list.map((r) => {
        /*
         * A restaurant with no coordinates can never satisfy a distance rule:
         * the order path cannot measure the trip, and an unmeasured distance
         * deliberately does not qualify. Advertising the offer anyway promises
         * the customer something checkout will never honour, so the badge is
         * withheld until the location is set.
         */
        const coords = r?.location?.coordinates;
        const canMeasureDistance = Array.isArray(coords)
            && coords.length === 2
            && Number.isFinite(Number(coords[0]))
            && Number.isFinite(Number(coords[1]));

        const { rule, source } = resolveEffectiveFreeDeliveryRule({
            restaurant: r?.freeDeliveryRule,
            platform: platformRule,
        });
        const { freeDeliveryRule, ...rest } = r || {};
        return {
            ...rest,
            /*
             * Two shapes on purpose, both from this one resolution so they cannot
             * disagree.
             *
             * freeDeliveryRule + freeDeliverySource mirror what
             * /orders/calculate returns under deliveryFeeBreakdown, so the app
             * parses a restaurant card and a checkout response with one model.
             * null means "nothing runs here", which makes rendering an offer
             * that does not apply impossible rather than merely discouraged --
             * including the case where this restaurant is excluded from a
             * running platform promotion.
             *
             * freeDeliveryOffer carries server-written copy so the badge wording
             * stays in step with checkout.
             */
            freeDeliveryRule: rule.isEnabled && canMeasureDistance
                ? { maxDistanceKm: rule.maxDistanceKm, minOrderAmount: rule.minOrderAmount }
                : null,
            freeDeliverySource: source,
            freeDeliveryOffer: rule.isEnabled && canMeasureDistance
                ? {
                    isEnabled: true,
                    maxDistanceKm: rule.maxDistanceKm,
                    minOrderAmount: rule.minOrderAmount,
                    label: describeFreeDeliveryRule(rule),
                    shortLabel: `Free delivery over ₹${rule.minOrderAmount}`,
                }
                : { isEnabled: false },
        };
    });
};

/**
 * "Spend ₹X, get a free Y" ladder, batch-attached the same way
 * attachFreeDeliveryOffer is -- one query for the whole page rather than one
 * per restaurant card.
 *
 * Unlike free delivery there is no platform-level fallback: a freebie ladder
 * is a restaurant's own choice, one document per restaurant (see
 * shared/freebieOffer.service.js), so a restaurant with none configured
 * simply reports `freebieOffer: null` rather than falling back to anything.
 *
 * Reward names are resolved here too (same lookup shape as
 * freebieOffer.service.js's loadReward, batched instead of per-tier) so the
 * app can show "add ₹40 more for a free Cold Drink" before checkout, not only
 * once a cart is being priced. Whether each tier is currently EARNED/claimed
 * is not this endpoint's job -- that depends on the customer's live cart
 * total, which only /orders/calculate knows.
 */
const attachFreebieOffer = async (restaurants = []) => {
    const list = Array.isArray(restaurants) ? restaurants : [];
    if (!list.length) return list;

    const ids = list.map((r) => r?._id).filter(Boolean);
    if (!ids.length) return list;

    let offersByRestaurant = new Map();
    try {
        const { FoodFreebieOffer } = await import('../../admin/models/freebieOffer.model.js');
        const offers = await FoodFreebieOffer.find({ restaurantId: { $in: ids } }).lean();
        offersByRestaurant = new Map(offers.map((o) => [String(o.restaurantId), o]));
    } catch (err) {
        // A missing/broken freebie collection must not break the restaurant
        // list; every restaurant simply reports no offer.
        console.error('Freebie badge: offers unavailable:', err?.message || err);
        return list;
    }
    if (!offersByRestaurant.size) return list;

    // Every item/addon id any active offer's tiers reference, across the
    // whole page, fetched in two queries total rather than one per tier.
    const itemIds = new Set();
    const addonIds = new Set();
    for (const offer of offersByRestaurant.values()) {
        if (offer.isActive === false) continue;
        for (const tier of offer.tiers || []) {
            if (tier.rewardType === 'item' && tier.rewardItemId) itemIds.add(String(tier.rewardItemId));
            if (tier.rewardType === 'addon' && tier.rewardAddonId) addonIds.add(String(tier.rewardAddonId));
        }
    }

    const itemNames = new Map();
    const itemImages = new Map();
    const addonNames = new Map();
    const addonImages = new Map();
    try {
        if (itemIds.size) {
            const { FoodItem } = await import('../../admin/models/food.model.js');
            const docs = await FoodItem.find({ _id: { $in: [...itemIds] }, isActive: { $ne: false }, isAvailable: { $ne: false } })
                .select('_id name image')
                .lean();
            for (const d of docs) {
                itemNames.set(String(d._id), d.name || '');
                itemImages.set(String(d._id), d.image || '');
            }
        }
        if (addonIds.size) {
            const { FoodAddon } = await import('../models/foodAddon.model.js');
            const docs = await FoodAddon.find({ _id: { $in: [...addonIds] }, isDeleted: { $ne: true } }).lean();
            for (const d of docs) {
                addonNames.set(String(d._id), d.published?.name || d.name || '');
                addonImages.set(String(d._id), d.published?.image || d.image || '');
            }
        }
    } catch (err) {
        // Names best-effort -- a tier whose reward vanished just shows no name
        // rather than breaking the whole list's freebie badges.
        console.error('Freebie badge: reward name lookup failed:', err?.message || err);
    }

    const rewardNameOf = (tier) => {
        if (tier.rewardType === 'manual') return tier.rewardName || '';
        if (tier.rewardType === 'addon') return addonNames.get(String(tier.rewardAddonId)) || '';
        return itemNames.get(String(tier.rewardItemId)) || '';
    };
    // Manual rewards have no catalogue row, so nothing to show a photo of --
    // the customer app falls back to a plain icon for those.
    const rewardImageOf = (tier) => {
        if (tier.rewardType === 'manual') return '';
        if (tier.rewardType === 'addon') return addonImages.get(String(tier.rewardAddonId)) || '';
        return itemImages.get(String(tier.rewardItemId)) || '';
    };

    return list.map((r) => {
        const offer = offersByRestaurant.get(String(r._id));
        if (!offer || offer.isActive === false) return { ...r, freebieOffer: null };

        const tiers = (offer.tiers || [])
            .map((tier) => ({
                minOrderValue: tier.minOrderValue,
                rewardType: tier.rewardType,
                rewardName: rewardNameOf(tier),
                rewardImage: rewardImageOf(tier),
            }))
            // A reward that no longer names anything (withdrawn item/add-on)
            // is not advertised -- same "quietly stop offering it" rule
            // buildFreebieLine follows at order time.
            .filter((tier) => tier.rewardName)
            .sort((a, b) => a.minOrderValue - b.minOrderValue);

        return { ...r, freebieOffer: tiers.length ? { isActive: true, tiers } : null };
    });
};

const attachRecommendedImagesToRestaurants = async (restaurants = []) => {
    if (!Array.isArray(restaurants) || restaurants.length === 0) return [];

    const restaurantIds = restaurants
        .map((restaurant) => restaurant?._id)
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id)));

    if (restaurantIds.length === 0) {
        return restaurants.map((restaurant) => ({
            ...restaurant,
            recommendedImages: []
        }));
    }

    const recommendedItems = await FoodItem.find({
        restaurantId: { $in: restaurantIds },
        approvalStatus: 'approved',
        isRecommended: true,
        isActive: { $ne: false },
        isAvailable: { $ne: false }
    })
        .select('restaurantId image name')
        .sort({ createdAt: -1 })
        .lean();

    const recommendedByRestaurantId = new Map();

    for (const item of recommendedItems) {
        const restaurantId = String(item?.restaurantId || '');
        const image = typeof item?.image === 'string' ? item.image.trim() : '';
        if (!restaurantId || !image) continue;

        const current = recommendedByRestaurantId.get(restaurantId) || [];
        if (current.length >= MAX_RECOMMENDED_IMAGES_PER_RESTAURANT) continue;

        current.push({
            id: String(item?._id || `${restaurantId}-${current.length}`),
            image,
            name: item?.name || ''
        });
        recommendedByRestaurantId.set(restaurantId, current);
    }

    return restaurants.map((restaurant) => ({
        ...restaurant,
        recommendedImages: recommendedByRestaurantId.get(String(restaurant?._id || '')) || []
    }));
};

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

/**
 * The zone a newly registering restaurant belongs to.
 *
 * An explicit id wins. Otherwise the pinned coordinates are matched against
 * the active zone polygons -- the same check updateRestaurant already runs, so
 * a restaurant that moves its pin later lands the same way it did on day one.
 *
 * Throws rather than returning null. A restaurant with no zone cannot appear
 * in any customer listing, so accepting the registration would create an
 * account that silently never trades.
 */
const resolveZoneForOnboarding = async ({ zoneId, latitude, longitude }) => {
    const explicit = String(zoneId || '').trim();
    if (explicit && mongoose.Types.ObjectId.isValid(explicit)) {
        const zone = await FoodZone.findById(explicit).select('_id isActive').lean();
        if (!zone?._id) throw new ValidationError('The selected delivery zone does not exist');
        return new mongoose.Types.ObjectId(String(zone._id));
    }

    if (latitude !== null && longitude !== null) {
        const activeZones = await FoodZone.find({ isActive: true }).select('_id coordinates').lean();
        const matched = activeZones.find((zone) =>
            isPointInZonePolygon(latitude, longitude, zone?.coordinates)
        );
        if (matched?._id) return new mongoose.Types.ObjectId(String(matched._id));
    }

    throw new ValidationError(
        'Select a delivery zone, or pin the restaurant inside one. '
        + 'A restaurant outside every zone cannot be shown to customers.'
    );
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
        // Pre-uploaded image URLs from background uploads
        profileImage: preUploadedProfileImage,
        panImage: preUploadedPanImage,
        gstImage: preUploadedGstImage,
        fssaiImage: preUploadedFssaiImage,
        menuImages: preUploadedMenuImages
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

    /*
     * A restaurant must land in a zone at onboarding, not later.
     *
     * The customer listing filters strictly by zone, so a restaurant that
     * registers without one is invisible to every customer -- and nothing said
     * so. It looked live in the admin panel, its menu was approved, and it took
     * no orders because it was never in anyone's results. Zone was assigned
     * afterwards by hand, if someone noticed.
     *
     * The pin the restaurant already drops is enough to answer this, so the
     * zone is derived from it rather than asked for twice; an explicitly
     * supplied zoneId still wins, for an admin registering on someone's behalf.
     * Only when neither resolves is the registration refused, and then with a
     * message that says what to do about it.
     */
    const resolvedZoneId = await resolveZoneForOnboarding({
        zoneId,
        latitude: toFiniteNumber(latitude),
        longitude: toFiniteNumber(longitude),
    });

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

    // Wait for all uploads to complete in parallel
    if (uploadTasks.length > 0) {
        console.log(`[ONBOARDING] Starting upload of ${uploadTasks.length} image tasks...`);
        console.time('ImageUploadTotal');
        await Promise.all(uploadTasks);
        console.timeEnd('ImageUploadTotal');
        console.log('[ONBOARDING] All image uploads completed.');
    }

    Object.assign(images, imageMap);

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

    try {
        const existingRejected = await FoodRestaurant.findOne({
            $or: [
                { ownerPhoneDigits },
                { ownerPhoneLast10 }
            ]
        });
        if (existingRejected) {
            if (existingRejected.status !== 'rejected') {
                throw new ValidationError('Restaurant with this owner phone already exists');
            }
            await FoodRestaurant.deleteMany({
                $or: [
                    { ownerPhoneDigits },
                    { ownerPhoneLast10 }
                ]
            });
        }

        const latNum = toFiniteNumber(latitude);
        const lngNum = toFiniteNumber(longitude);
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
            // Resolved above, and never undefined: see resolveZoneForOnboarding.
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
            // priceIncludesGst is deliberately not taken from the application.
            // Whether menu prices include GST is set by the admin
            // (admin.service updateRestaurantById); a new restaurant starts on
            // the schema default, exclusive, until the admin says otherwise.
            fssaiNumber,
            fssaiExpiry,
            accountNumber,
            ifscCode,
            accountHolderName,
            accountType,
            menuImages,
            ...images
        });

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
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'priceIncludesGst',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'isAcceptingOrders',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        )
        .lean();
    return toRestaurantProfile(doc);
};

export const updateRestaurantAcceptingOrders = async (restaurantId, isAcceptingOrders) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }
    const value = Boolean(isAcceptingOrders);
    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        { $set: { isAcceptingOrders: value } },
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
                'priceIncludesGst',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'isAcceptingOrders',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();
    return toRestaurantProfile(doc);
};

export const updateRestaurantProfile = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName restaurantNameNormalized ownerPhone ownerPhoneDigits ownerPhoneLast10 primaryContactNumber status')
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
            const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!EMAIL_REGEX.test(ownerEmail)) {
                throw new ValidationError('Owner email is invalid');
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

    /*
     * Whether the menu prices the restaurant types already contain GST.
     *
     * Off means the stored price is net and tax is added on top at checkout,
     * which is what every restaurant did before this setting existed. On means
     * the listed price is the whole price and the tax is extracted from inside
     * it, so the customer pays exactly what the menu says and the restaurant
     * earns the net.
     */
    if (body.priceIncludesGst !== undefined) {
        const raw = body.priceIncludesGst;
        if (typeof raw === 'boolean') {
            update.priceIncludesGst = raw;
        } else if (typeof raw === 'string') {
            const normalized = raw.trim().toLowerCase();
            if (['true', '1', 'yes'].includes(normalized)) {
                update.priceIncludesGst = true;
            } else if (['false', '0', 'no'].includes(normalized)) {
                update.priceIncludesGst = false;
            } else {
                throw new ValidationError('priceIncludesGst must be a boolean');
            }
        } else {
            throw new ValidationError('priceIncludesGst must be a boolean');
        }
    }

    if (body.zoneId !== undefined) {
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
        const toStr = (v) => (v != null ? String(v).trim() : '');
        const formattedAddress = toStr(loc.formattedAddress || loc.address);
        update.addressLine1 = toStr(loc.addressLine1);
        update.addressLine2 = toStr(loc.addressLine2);
        update.area = toStr(loc.area);
        update.city = toStr(loc.city);
        update.state = toStr(loc.state);
        update.pincode = toStr(loc.pincode);
        update.landmark = toStr(loc.landmark);

        // Optional geo coords for server-side distance filtering.
        const lat = toFiniteNumber(loc.latitude);
        const lng = toFiniteNumber(loc.longitude);
        update.location = {
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

        // Auto-detect and sync zone from coordinates when caller doesn't pass zoneId explicitly.
        // This keeps restaurant.zoneId aligned with Zone Setup pin location.
        if (body.zoneId === undefined && lat !== null && lng !== null) {
            const activeZones = await FoodZone.find({ isActive: true })
                .select('_id coordinates')
                .lean();
            const matchedZone = activeZones.find((zone) =>
                isPointInZonePolygon(lat, lng, zone?.coordinates)
            );
            update.zoneId = matchedZone?._id
                ? new mongoose.Types.ObjectId(String(matchedZone._id))
                : null;
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
    if (body.petpoojaEnabled !== undefined) {
        update.petpoojaEnabled = body.petpoojaEnabled === true || body.petpoojaEnabled === 'true';
    }
    if (body.petpoojaOutletId !== undefined) {
        update.petpoojaOutletId = String(body.petpoojaOutletId || '').trim();
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
    if (requiresReview) {
        update.status = 'pending';
    }
    // There used to be an else-branch here that set a PENDING store back to
    // 'approved' whenever an edit touched only operational fields -- a one-off
    // repair for stores an old bug had sent to review. It also let any store
    // clear its own review: change the bank account (-> pending), then edit a
    // cuisine (-> approved), and payouts went to an account nobody checked.
    // A pending store now waits for an admin.

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
                'priceIncludesGst',
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
                    'petpoojaEnabled',
                    'petpoojaOutletId'
                ].join(' ')
            }
        ).lean();

        if (requiresReview && currentRestaurant.status !== 'pending') {
            const restaurantNameForNotification =
                update.restaurantName || currentRestaurant.restaurantName || doc?.restaurantName;
            void notifyAdminsAboutRestaurantProfileReview(restaurantId, restaurantNameForNotification);
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

/**
 * Restaurants with at least one dish a customer could actually order.
 *
 * Approving a restaurant and approving its menu are separate steps, and only
 * the first was gating this listing -- so a restaurant went live the moment an
 * admin approved the shop, with an empty menu or one still awaiting review. A
 * customer tapped through to nothing.
 *
 * One distinct() over the items rather than a lookup per restaurant. The set is
 * small (it is bounded by the number of restaurants, not dishes) and this runs
 * once per listing request.
 */
const restaurantIdsWithApprovedMenu = async () =>
    FoodItem.distinct('restaurantId', {
        approvalStatus: 'approved',
        isActive: { $ne: false },
        isAvailable: { $ne: false },
        price: { $gt: 0 },
    });

export const listApprovedRestaurants = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { status: 'approved' };

    /*
     * Menu approval is a second gate, not the same one. See
     * restaurantIdsWithApprovedMenu -- an approved shop with no approved dish
     * is not something a customer can order from, and listing it is how the
     * app came to show restaurants that opened to an empty menu.
     */
    filter._id = { $in: await restaurantIdsWithApprovedMenu() };

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
    if (query.cuisine && String(query.cuisine).trim()) {
        const cuisine = normalizeCuisine(query.cuisine);
        // cuisines is an array of strings.
        filter.cuisines = { $in: [new RegExp(escapeRegex(cuisine), 'i')] };
    }
    if (query.hasOffers === 'true') {
        filter.offer = { $exists: true, $ne: null, $ne: '' };
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

    // The restaurant's own delivery radius, when the customer's point is known.
    // Distinct from `radiusKm` above, which is the customer's search filter.
    // Applied to `filter` so both the geo and the plain path below honour it.
    if (lat !== null && lng !== null) {
        const { serviceRadiusListingClause } = await import('./serviceRadius.service.js');
        const clause = await serviceRadiusListingClause(lat, lng);
        if (clause) filter.$and = [...(filter.$and || []), clause];
    }

    const projection = {
        restaurantName: 1,
        // Needed to resolve the free delivery badge; stripped again before the
        // response, since the raw mode enum is internal.
        freeDeliveryRule: 1,
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
        // Public licence number, shown at the foot of the menu (the app opens the
        // menu from this list's copy of the restaurant).
        fssaiNumber: 1
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
        const restaurantsWithRecommendedImages = await attachRecommendedImagesToRestaurants(pageDocs);
        const withDeliveryOffers = await attachFreeDeliveryOffer(restaurantsWithRecommendedImages);
        const withOffers = await attachFreebieOffer(withDeliveryOffers);
        // Trading hours, in one query for the page. See shared/outletHours.js.
        const withHours = await attachOutletOpenState(withOffers);
        return { restaurants: withHours, total, page, limit };
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

    const restaurantsWithRecommendedImages = await attachRecommendedImagesToRestaurants(restaurantsRaw || []);
    const withDeliveryOffersOnly = await attachFreeDeliveryOffer(restaurantsWithRecommendedImages);
    const withOffersOnly = await attachFreebieOffer(withDeliveryOffersOnly);
    // Trading hours, in one query for the page. See shared/outletHours.js.
    const withOffers = await attachOutletOpenState(withOffersOnly);
    const restaurants = withOffers.map((r) => ({
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
        menuImages: Array.isArray(r.menuImages) ? r.menuImages : [],
        recommendedImages: Array.isArray(r.recommendedImages) ? r.recommendedImages : []
    }));

    return { restaurants, total, page, limit };
};

/*
 * Fields a customer must never receive from the PUBLIC restaurant detail endpoint.
 *
 * GET /v1/food/restaurant/restaurants/:id is unauthenticated, and returned the whole
 * document: PAN and name on PAN, GST number/legal name/address, bank account number,
 * IFSC, account holder, UPI id, the PAN/GST/FSSAI/UPI-QR image URLs (served from
 * /uploads without auth), the owner's email and phone, and the restaurant's FCM
 * push tokens. Anyone could list /restaurants and harvest every restaurant's bank
 * and KYC details.
 *
 * A denylist rather than the quick-commerce allowlist: food's detail screen reads
 * many display fields, and an allowlist that missed one would break the customer
 * page. None of these are read by the customer restaurant, cart or menu screens.
 * fssaiNumber stays -- a licence number food apps display.
 */
export const PUBLIC_RESTAURANT_EXCLUDE = Object.freeze({
    panNumber: 0, nameOnPan: 0, panImage: 0,
    gstNumber: 0, gstLegalName: 0, gstAddress: 0, gstImage: 0,
    fssaiImage: 0, fssaiExpiry: 0,
    accountNumber: 0, ifscCode: 0, accountHolderName: 0, accountType: 0,
    upiId: 0, upiQrImage: 0,
    ownerEmail: 0, ownerPhone: 0, ownerPhoneDigits: 0, ownerPhoneLast10: 0, primaryContactNumber: 0,
    fcmTokens: 0, fcmTokenMobile: 0,
    petpoojaOutletId: 0, rejectionReason: 0,
});

export const getApprovedRestaurantByIdOrSlug = async (idOrSlug) => {
    const value = String(idOrSlug || '').trim();
    if (!value) return null;

    // ObjectId path
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        const doc = await FoodRestaurant.findOne({ _id: value, status: 'approved' }, PUBLIC_RESTAURANT_EXCLUDE).lean();
        if (!doc) return null;
        const [withDeliveryOffer] = await attachFreeDeliveryOffer([doc]);
        const [withOffer] = await attachFreebieOffer([withDeliveryOffer]);
        const decorated = await attachMenuCategories(withOffer);
        // The detail screen has to agree with the listing badge, or a customer
        // taps a restaurant marked closed and finds an ordinary open shop.
        const [withHours] = await attachOutletOpenState([decorated]);
        return {
            ...withHours,
            rating: normalizeRatingValue(doc.rating),
            totalRatings: normalizeTotalRatingsValue(doc.totalRatings)
        };
    }

    // Slug path: use normalized field for index-friendly exact match.
    const restaurantNameNormalized = normalizeName(value);
    if (!restaurantNameNormalized) return null;

    const doc = await FoodRestaurant.findOne({
        status: 'approved',
        restaurantNameNormalized
    }, PUBLIC_RESTAURANT_EXCLUDE).lean();
    if (!doc) return null;
    const [withDeliveryOffer] = await attachFreeDeliveryOffer([doc]);
    const [withOffer] = await attachFreebieOffer([withDeliveryOffer]);
    const decorated = await attachMenuCategories(withOffer);
    const [withHours] = await attachOutletOpenState([decorated]);
    return {
        ...withHours,
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings)
    };
};

export const listPublicOffers = async () => {
    const now = new Date();
    const filter = {
        status: 'active',
        $and: [
            { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
            { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gt: now } }] }
        ]
    };

    const list = await FoodOffer.find(filter)
        .sort({ createdAt: -1 })
        .populate({ path: 'restaurantId', select: 'restaurantName restaurantNameNormalized profileImage estimatedDeliveryTime rating' })
        .lean();

    const allOffers = list.map((o) => {
        const restaurant = o.restaurantId && typeof o.restaurantId === 'object' ? o.restaurantId : null;
        const restaurantSlug = restaurant?.restaurantNameNormalized || undefined;
        const restaurantName =
            o.restaurantScope === 'selected'
                ? (restaurant?.restaurantName || 'Selected Restaurant')
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
            customerScope: o.customerScope,
            restaurantScope: o.restaurantScope,
            restaurantId: restaurant?._id ? String(restaurant._id) : (o.restaurantScope === 'selected' ? String(o.restaurantId) : null),
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
        createdByRole: 'RESTAURANT'
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
 * Everything keyed to a restaurant that becomes meaningless once it is gone.
 *
 * Configuration and presentation only. A row here describes how the restaurant
 * behaves or where it is shown, and outlives it as a broken reference: a
 * commission record whose restaurant cannot be looked up renders as a blank
 * name and a null id in the admin panel, and a dining or gourmet showcase entry
 * keeps advertising a restaurant customers can no longer order from.
 *
 * Collection names rather than models, because these live across two verticals
 * and several modules; importing eight models into a delete path is how the
 * list falls out of date the first time someone adds a ninth.
 */
const RESTAURANT_SCOPED_CONFIG = [
    'food_restaurant_commissions',
    'food_categories',
    'food_offers',
    'food_bogo_offers',
    'food_freebie_offers',
    'food_dining_restaurants',
    'food_gourmet_restaurants',
    'food_user_carts',
    'food_restaurant_withdrawal_settings',
    // The quick-commerce twins, which mount the same restaurants.
    'qc_items',
    'qc_restaurant_outlet_timings',
];

/**
 * What is deliberately NOT deleted with a restaurant.
 *
 * Orders, transactions and price-adjustment runs are the financial and audit
 * record. A delivered order does not stop having happened because the shop
 * later closed, and deleting it would take the money trail, the customer's
 * order history and the platform's own accounts with it. These rows keep a
 * restaurantId that no longer resolves, and that is correct: it is a historical
 * fact about an entity that used to exist.
 *
 *   food_orders, qc_orders
 *   food_transactions, qc_transactions
 *   food_price_adjustments
 */

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

    /*
     * The rest of the configuration, which this used to leave behind. A
     * deleted restaurant kept its commission record, and the admin panel
     * rendered it as a row with no name and a null id -- along with its
     * offers, its menu categories, and its slot in the dining and gourmet
     * showcases the customer app reads.
     *
     * Matched on both the ObjectId and its string form: these collections were
     * written by several modules and not all of them cast the id.
     */
    const asId = mongoose.Types.ObjectId.isValid(String(restaurantId))
        ? new mongoose.Types.ObjectId(String(restaurantId))
        : null;
    const idMatch = { $in: [asId, String(restaurantId)].filter((v) => v !== null) };

    for (const collection of RESTAURANT_SCOPED_CONFIG) {
        try {
            await mongoose.connection.collection(collection)
                .deleteMany({ restaurantId: idMatch });
        } catch (err) {
            /*
             * One missing collection must not abort the delete and leave the
             * restaurant half-removed. Logged, not thrown: a stray config row
             * is a cosmetic problem, a half-deleted restaurant is not.
             */
            console.error(`Failed clearing ${collection} for restaurant ${restaurantId}:`, err?.message || err);
        }
    }

    // Remove Restaurant
    await FoodRestaurant.findByIdAndDelete(restaurantId);

    // The listing, menu and detail responses all cache; a deleted restaurant
    // must not keep being served from one.
    try {
        const { invalidateMenuCaches } = await import('../../../../middleware/cache.js');
        await invalidateMenuCaches();
    } catch (err) {
        console.error('Failed to invalidate caches after deleting a restaurant:', err?.message || err);
    }

    return { success: true };
};
