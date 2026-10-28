import { getPublicGourmetRestaurants } from '../services/gourmet.service.js';
import { getLandingSettings } from '../services/landingSettings.service.js';
import { FoodHeroBanner } from '../models/heroBanner.model.js';
import { FoodUnder250Banner } from '../models/under250Banner.model.js';
import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { FoodExploreIcon } from '../models/exploreIcon.model.js';
import { HomePromotionBanner } from '../models/homePromotionBanner.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { getPublicHomePromotionBanners } from '../services/homePromotionBanner.service.js';
import { sendResponse } from '../../../../utils/response.js';
import { normalizeHeroBannerModule } from '../services/heroBanner.service.js';

/**
 * Public hero banners for a module's home screen: active only, sorted, with
 * linkedRestaurants populated for click-through.
 *
 * `?module=` scopes the result. Omitting it returns food's banners, which is
 * what every existing caller gets today -- the parameter was accepted and
 * silently ignored before this, so a client asking for taxi was handed food's
 * artwork.
 */
export const getPublicHeroBannersController = async (req, res, next) => {
    try {
        const requested = normalizeHeroBannerModule(req.query?.module) || 'food';

        // Banners predating the module field belong to food, so food's query
        // has to match an absent field as well as an explicit one.
        const moduleFilter = requested === 'food'
            ? { $or: [{ module: 'food' }, { module: { $exists: false } }, { module: null }] }
            : { module: requested };

        const docs = await FoodHeroBanner.find({ isActive: true, ...moduleFilter })
            .sort({ sortOrder: 1, createdAt: -1 })
            .populate({
                path: 'linkedRestaurantIds',
                select: '_id restaurantName slug area city rating cuisines profileImage pureVegRestaurant',
                model: 'FoodRestaurant'
            })
            .lean();
        const banners = (docs || []).map((b) => {
            const { linkedRestaurantIds, ...rest } = b;
            return {
                ...rest,
                linkedRestaurants: Array.isArray(linkedRestaurantIds) ? linkedRestaurantIds : [],
                imageUrl: b.imageUrl,
                // Always stated, even for the legacy rows that have no stored
                // value: the app keeps only banners naming the module it asked
                // for, so an absent field would make them invisible.
                module: b.module || 'food'
            };
        });
        return sendResponse(res, 200, 'Hero banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicUnder250BannersController = async (req, res, next) => {
    try {
        const docs = await FoodUnder250Banner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        return sendResponse(res, 200, 'Under 250 banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicDiningBannersController = async (req, res, next) => {
    try {
        const docs = await FoodDiningBanner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        return sendResponse(res, 200, 'Dining banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicExploreIconsController = async (req, res, next) => {
    try {
        const docs = await FoodExploreIcon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        const items = docs.map(({ targetPath, sortOrder, ...rest }) => ({ ...rest, link: targetPath, order: sortOrder }));
        return sendResponse(res, 200, 'Explore icons fetched', { items });
    } catch (error) {
        next(error);
    }
};

export const getPublicHomePromotionBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const banners = await getPublicHomePromotionBanners(zoneId);
        return sendResponse(res, 200, 'Home promotion banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicGourmetController = async (req, res, next) => {
    try {
        const docs = await getPublicGourmetRestaurants();
        const restaurants = (docs || []).map((d) => ({
            ...(d.restaurant || {}),
            _id: d.restaurant?._id || d.restaurantId,
            priority: d.priority
        })).filter((r) => r && r._id);
        return sendResponse(res, 200, 'Gourmet restaurants fetched', { restaurants });
    } catch (error) {
        next(error);
    }
};

export const getPublicLandingSettingsController = async (req, res, next) => {
    try {
        const settings = await getLandingSettings();
        const ids = settings?.recommendedRestaurantIds || [];
        let recommendedRestaurants = [];
        if (Array.isArray(ids) && ids.length > 0) {
            recommendedRestaurants = await FoodRestaurant.find({ _id: { $in: ids }, status: 'approved' })
                .select('restaurantName area city profileImage coverImages menuImages slug rating cuisines pureVegRestaurant')
                .lean();
        }
        // Always emit a resolved cap. Mongoose defaults apply when a document is
        // created, not when an older one is read, so the settings document that
        // predates this field would otherwise send null and make every client
        // implement the fallback itself.
        const { resolveNinetyNineCap } = await import('../../shared/ninetyNineStore.js');

        const payload = {
            ...settings,
            ninetyNineStoreMaxPrice: resolveNinetyNineCap(settings?.ninetyNineStoreMaxPrice),
            recommendedRestaurantIds: undefined,
            recommendedRestaurants
        };
        return sendResponse(res, 200, 'Landing settings fetched', payload);
    } catch (error) {
        next(error);
    }
};
