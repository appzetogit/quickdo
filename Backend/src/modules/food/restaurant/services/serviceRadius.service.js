/**
 * The single door for a restaurant's delivery radius.
 *
 * The restaurant app (PUT /food/restaurant/service-radius) and the admin panel
 * (PUT /food/admin/restaurants/:id/service-radius) both call
 * setRestaurantServiceRadius below. Neither controller touches the field
 * itself, so the two sides cannot drift: same validation, same ceiling, same
 * cache clear, same record of who changed it.
 *
 * The rule itself -- bounds, ceiling, inside or outside -- is in
 * shared/serviceRadius.js.
 */
import mongoose from 'mongoose';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodServiceRadiusSettings } from '../../admin/models/serviceRadiusSettings.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import {
    normalizeServiceRadiusSettings,
    validateServiceRadius,
    validateServiceRadiusSettings,
    resolveEffectiveServiceRadius,
} from '../../shared/serviceRadius.js';

export const SERVICE_RADIUS_ACTORS = Object.freeze(['restaurant', 'admin']);

export async function loadServiceRadiusSettings() {
    const doc = await FoodServiceRadiusSettings.findOne({ key: 'default' }).lean();
    return normalizeServiceRadiusSettings(doc);
}

export async function updateServiceRadiusSettings(body = {}) {
    const verdict = validateServiceRadiusSettings(body);
    if (!verdict.ok) throw new ValidationError(verdict.reason);

    await FoodServiceRadiusSettings.findOneAndUpdate(
        { key: 'default' },
        { $set: { maxRadiusKm: verdict.settings.maxRadiusKm } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    // Lowering the ceiling narrows restaurants that saved more, so the listing
    // has to change now rather than when its cache expires.
    await clearRestaurantCaches();
    return getServiceRadiusOverview();
}

/** For the admin settings card: the ceiling, and how many restaurants it is holding back. */
export async function getServiceRadiusOverview() {
    const settings = await loadServiceRadiusSettings();
    const [withRadius, capped] = await Promise.all([
        FoodRestaurant.countDocuments({ serviceRadiusKm: { $gt: 0 } }),
        FoodRestaurant.countDocuments({ serviceRadiusKm: { $gt: settings.maxRadiusKm } }),
    ]);
    return { settings, restaurantsWithRadius: withRadius, restaurantsCapped: capped };
}

const hasCoordinates = (restaurant) => {
    const coords = restaurant?.location?.coordinates;
    return Array.isArray(coords)
        && coords.length === 2
        && coords.every((n) => Number.isFinite(Number(n)));
};

/** What both panels show: the saved value, what is enforced, and who set it. */
function describe(restaurant, settings) {
    const effective = resolveEffectiveServiceRadius({
        restaurantRadiusKm: restaurant?.serviceRadiusKm,
        settings,
    });
    return {
        restaurantId: String(restaurant._id),
        restaurantName: restaurant.restaurantName || '',
        serviceRadiusKm: effective.savedRadiusKm,
        effectiveRadiusKm: effective.radiusKm,
        usesDefault: effective.isDefault === true,
        capped: effective.capped,
        maxRadiusKm: effective.maxRadiusKm,
        minRadiusKm: 1,
        hasLocation: hasCoordinates(restaurant),
        updatedBy: restaurant.serviceRadiusUpdatedBy || null,
        updatedAt: restaurant.serviceRadiusUpdatedAt || null,
    };
}

const SELECT = 'restaurantName location serviceRadiusKm serviceRadiusUpdatedBy serviceRadiusUpdatedAt';

export async function getRestaurantServiceRadius(restaurantId) {
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const [restaurant, settings] = await Promise.all([
        FoodRestaurant.findById(restaurantId).select(SELECT).lean(),
        loadServiceRadiusSettings(),
    ]);
    if (!restaurant) throw new NotFoundError('Restaurant not found');
    return describe(restaurant, settings);
}

/**
 * Save a restaurant's radius, from either side.
 *
 * `value` blank clears it. A radius cannot be set on a restaurant with no
 * location: there is nothing to measure from, so every order would be refused
 * as "distance unknown" -- better to say so here, at the one moment someone is
 * looking.
 */
export async function setRestaurantServiceRadius(restaurantId, value, { actor } = {}) {
    if (!SERVICE_RADIUS_ACTORS.includes(actor)) {
        throw new Error(`setRestaurantServiceRadius: unknown actor ${actor}`);
    }
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const [restaurant, settings] = await Promise.all([
        FoodRestaurant.findById(restaurantId).select(SELECT).lean(),
        loadServiceRadiusSettings(),
    ]);
    if (!restaurant) throw new NotFoundError('Restaurant not found');

    const verdict = validateServiceRadius(value, settings);
    if (!verdict.ok) throw new ValidationError(verdict.reason);

    if (verdict.radiusKm !== null && !hasCoordinates(restaurant)) {
        throw new ValidationError(
            actor === 'admin'
                ? 'This restaurant has no location saved, so a delivery radius cannot be measured. Set its location first.'
                : 'Your outlet has no location saved, so a delivery radius cannot be measured. Update your outlet address first.',
        );
    }

    const updated = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                serviceRadiusKm: verdict.radiusKm,
                serviceRadiusUpdatedBy: actor,
                serviceRadiusUpdatedAt: new Date(),
            },
        },
        { new: true, runValidators: true },
    ).select(SELECT).lean();

    await clearRestaurantCaches();
    return describe(updated, settings);
}

/**
 * Mongo clause for the customer listing: keep restaurants with no radius, and
 * those with one that reaches (lat, lng). Null when there is no point to judge
 * from, in which case nothing is filtered -- the zone still applies.
 *
 * Straight-line distance, measured by the 2dsphere index. That is the most a
 * listing can afford, and it errs on the side of showing: the road is never
 * shorter than the straight line, so a restaurant hidden here would certainly
 * be refused at the cart, while one shown here may still be refused there with
 * the road distance in the message. The cart and order placement are the
 * authority; this only spares the customer browsing places that cannot reach
 * them.
 */
export async function serviceRadiusListingClause(lat, lng) {
    // Number('') and Number(null) are both 0: an absent point must not be judged
    // as the Gulf of Guinea, which would hide every restaurant with a radius.
    const absent = (v) => v === null || v === undefined || String(v).trim() === '';
    if (absent(lat) || absent(lng)) return null;
    const latN = Number(lat);
    const lngN = Number(lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
    if (Math.abs(latN) > 90 || Math.abs(lngN) > 180) return null;

    const { maxRadiusKm } = await loadServiceRadiusSettings();
    // Every restaurant is held to a radius now: its own, or the platform's when
    // it set none (resolveEffectiveServiceRadius). Straight-line here, as the
    // listing always was; checkout judges the road distance.
    const reachable = await FoodRestaurant.aggregate([
        {
            $geoNear: {
                near: { type: 'Point', coordinates: [lngN, latN] },
                distanceField: 'distanceMeters',
                spherical: true,
            },
        },
        {
            $match: {
                $expr: {
                    $lte: [
                        '$distanceMeters',
                        {
                            $multiply: [
                                {
                                    $cond: [
                                        { $gt: [{ $ifNull: ['$serviceRadiusKm', 0] }, 0] },
                                        { $min: ['$serviceRadiusKm', maxRadiusKm] },
                                        maxRadiusKm,
                                    ],
                                },
                                1000,
                            ],
                        },
                    ],
                },
            },
        },
        { $project: { _id: 1 } },
    ]);

    return {
        $or: [
            // A restaurant with no map pin cannot be measured, so it is not
            // hidden for it; the zone still decides where it shows.
            { 'location.coordinates.1': { $exists: false } },
            { _id: { $in: reachable.map((r) => r._id) } },
        ],
    };
}

async function clearRestaurantCaches() {
    try {
        const { invalidateCache, invalidatePriceCaches } = await import('../../../../middleware/cache.js');
        await Promise.all([
            invalidateCache('restaurants:*'),
            invalidateCache('restaurant_detail:*'),
            invalidatePriceCaches(),
        ]);
    } catch (err) {
        console.error('Cache clear after delivery radius change failed:', err?.message || err);
    }
}
