import {
    registerRestaurant,
    listApprovedRestaurants,
    getApprovedRestaurantByIdOrSlug,
    getCurrentRestaurantProfile,
    updateRestaurantProfile,
    updateRestaurantAcceptingOrders,
    updateCurrentRestaurantDiningSettings,
    uploadRestaurantProfileImage,
    uploadRestaurantMenuImage,
    uploadRestaurantCoverImages,
    uploadRestaurantMenuImages,
    uploadRestaurantAttachment,
    listPublicOffers,
    getRestaurantComplaints,
    deleteCurrentRestaurantAccount
} from '../services/restaurant.service.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { sendResponse } from '../../../../utils/response.js';

export const uploadRestaurantAttachmentController = async (req, res, next) => {
    try {
        const { folder } = req.body;
        const result = await uploadRestaurantAttachment(req.file, folder);
        return sendResponse(res, 200, 'Image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const registerRestaurantController = async (req, res, next) => {
    try {
        const validated = validateRestaurantRegisterDto(req.body);
        const restaurant = await registerRestaurant(validated, req.files);
        return sendResponse(res, 201, 'Restaurant registered successfully', restaurant);
    } catch (error) {
        next(error);
    }
};

export const listApprovedRestaurantsController = async (req, res, next) => {
    try {
        const data = await listApprovedRestaurants(req.query);
        return sendResponse(res, 200, 'Restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedRestaurantController = async (req, res, next) => {
    try {
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const getCurrentRestaurantController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await getCurrentRestaurantProfile(restaurantId);
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

/**
 * The commission rate that currently applies to this restaurant.
 *
 * Exposed so the item form can show what a dish actually earns before the
 * restaurant saves a price, rather than making them discover it on a payout.
 * Resolved through the same path an order uses -- including any dated override
 * in effect right now -- so the number shown is the number that would be
 * charged, not an approximation of it.
 *
 * The rate is returned rather than a computed amount: the form recalculates on
 * every keystroke, and a round trip per character would be both slow and
 * pointless when the arithmetic is a multiplication.
 */
export const getRestaurantCommissionRateController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { getRestaurantCommissionSnapshot } = await import(
            '../../orders/services/foodTransaction.service.js'
        );

        // A synthetic order of 100 so a percentage rate reads directly, and a
        // flat rate comes back as its own amount either way.
        const snapshot = await getRestaurantCommissionSnapshot({
            restaurantId,
            pricing: { subtotal: 100 },
        });

        return sendResponse(res, 200, 'Commission fetched successfully', {
            commissionType: snapshot.commissionType,
            commissionValue: snapshot.commissionValue,
            commissionLabel: snapshot.commissionLabel || '',
            commissionSource: snapshot.commissionSource,
        });
    } catch (error) {
        next(error);
    }
};


/**
 * How the restaurant's own menu prices are taxed.
 *
 * Returned together with the platform's GST rate because the setting is
 * meaningless without it: a restaurant deciding whether its Rs 200 is inclusive
 * needs to see the Rs 190.48 and Rs 9.52 that decision produces. The rate is
 * the admin's to set; only the flag is the restaurant's.
 */
export const getRestaurantTaxSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const [{ FoodRestaurant }, { FoodFeeSettings }] = await Promise.all([
            import('../models/restaurant.model.js'),
            import('../../admin/models/feeSettings.model.js'),
        ]);
        const { DEFAULT_PLATFORM_FEE_GST_RATE } = await import('../../shared/billing.js');

        const { withMasterFees } = await import('../../../../core/finance/platformFees.service.js');
        const [restaurant, ownFeeSettings] = await Promise.all([
            FoodRestaurant.findById(restaurantId).select('priceIncludesGst').lean(),
            FoodFeeSettings.findOne({ isActive: true }).lean(),
        ]);
        // The rate the checkout charges, which is Master's when one is set.
        const feeSettings = await withMasterFees('food', ownFeeSettings);

        if (!restaurant) {
            return sendResponse(res, 404, 'Restaurant not found', null);
        }

        const gstRate = Number(feeSettings?.gstRate);
        // Same null-reads-as-a-finite-0 hole as the pricing path: without this
        // a cleared setting reports 0% to the restaurant AND charges 0%, so the
        // two agree and are both wrong.
        const platformFeeGstRateRaw = feeSettings?.platformFeeGstRate;
        const platformFeeGstRate =
            platformFeeGstRateRaw == null || platformFeeGstRateRaw === ''
                ? NaN
                : Number(platformFeeGstRateRaw);

        return sendResponse(res, 200, 'Tax settings fetched successfully', {
            priceIncludesGst: restaurant.priceIncludesGst === true,
            gstRate: Number.isFinite(gstRate) && gstRate >= 0 ? gstRate : 0,
            platformFeeGstRate: Number.isFinite(platformFeeGstRate) && platformFeeGstRate >= 0
                ? platformFeeGstRate
                : DEFAULT_PLATFORM_FEE_GST_RATE,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * The restaurant's own "GST on menu prices" switch, on its GST page.
 *
 * The admin can set the same flag on Edit Restaurant; either side saving last
 * wins, and both read the one stored field. This is the ONLY restaurant route
 * that writes it -- the profile save and the dish save both ignore it -- so the
 * restaurant changes it deliberately, on the page that explains what it does,
 * and never as a side effect of editing something else.
 */
export const updateRestaurantTaxSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        if (req.body?.priceIncludesGst === undefined) {
            return sendResponse(res, 400, 'priceIncludesGst is required', null);
        }
        // Goes through the profile service so the one place that validates this
        // flag stays the one place that writes it.
        const profile = await updateRestaurantProfile(restaurantId, {
            priceIncludesGst: req.body.priceIncludesGst,
        });
        return sendResponse(res, 200, 'Tax settings updated successfully', {
            priceIncludesGst: profile?.priceIncludesGst === true,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * The restaurant's own "spend this much, get this free" ladder.
 *
 * The same document the admin panel edits, so whichever side saves last wins and
 * neither can end up looking at a different offer than the one being applied.
 */
export const getFreebieOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { getFreebieOffer } = await import('../../shared/freebieOffer.service.js');
        const offer = await getFreebieOffer(restaurantId);
        return sendResponse(res, 200, 'Freebie offer fetched successfully', {
            offer: offer || { restaurantId, isActive: true, tiers: [] },
        });
    } catch (error) {
        next(error);
    }
};

export const updateFreebieOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { normalizeFreebieTiersInput } = await import('../../shared/freebieRewards.js');
        const { saveFreebieOffer } = await import('../../shared/freebieOffer.service.js');

        let tiers;
        try {
            tiers = normalizeFreebieTiersInput(req.body || {})?.tiers;
        } catch (validationError) {
            return sendResponse(res, 400, validationError.message, null);
        }

        const offer = await saveFreebieOffer(restaurantId, {
            tiers,
            isActive: req.body?.isActive,
            updatedByRole: 'RESTAURANT',
        });
        return sendResponse(res, 200, 'Freebie offer saved successfully', { offer });
    } catch (error) {
        next(error);
    }
};

/**
 * The restaurant's own "buy one, get one free" dishes.
 *
 * Like the freebie ladder above, the same document the admin panel edits, so
 * whichever side saves last wins and neither can end up looking at an offer
 * different from the one being applied at checkout.
 */
export const getBogoOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { getBogoOffer } = await import('../../shared/bogoOffer.service.js');
        const offer = await getBogoOffer(restaurantId);
        return sendResponse(res, 200, 'Buy one get one offer fetched successfully', {
            offer: offer || { restaurantId, isActive: true, offers: [] },
        });
    } catch (error) {
        next(error);
    }
};

export const updateBogoOfferController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { normalizeBogoOffersInput } = await import('../../shared/bogoOffer.js');
        const { saveBogoOffer } = await import('../../shared/bogoOffer.service.js');

        let offers;
        try {
            offers = normalizeBogoOffersInput(req.body || {})?.offers;
        } catch (validationError) {
            return sendResponse(res, 400, validationError.message, null);
        }

        const offer = await saveBogoOffer(restaurantId, {
            offers,
            isActive: req.body?.isActive,
            updatedByRole: 'RESTAURANT',
        });
        return sendResponse(res, 200, 'Buy one get one offer saved successfully', { offer });
    } catch (error) {
        next(error);
    }
};

/**
 * Combos: several existing dishes sold together as one menu entry at a fixed
 * price.
 *
 * A combo is stored as an ordinary FoodItem marked `isCombo`, so it appears on
 * the menu, in the cart and on the order exactly as a dish does. What a
 * restaurant saves here therefore enters the normal approval queue, the same as
 * any dish it adds -- a combo is not a way around it.
 */
export const listCombosController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { listCombos } = await import('../../shared/combo.service.js');
        const combos = await listCombos(restaurantId);
        return sendResponse(res, 200, 'Combos fetched successfully', { combos });
    } catch (error) {
        next(error);
    }
};

export const createComboController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { saveCombo } = await import('../../shared/combo.service.js');
        const result = await saveCombo(restaurantId, req.body || {}, { updatedByRole: 'RESTAURANT' });
        return sendResponse(res, 201, 'Combo created and sent for approval', result);
    } catch (error) {
        // A ValidationError carries a message written for the person who typed it.
        if (error?.name === 'ValidationError' && error?.statusCode === 400) {
            return sendResponse(res, 400, error.message, null);
        }
        next(error);
    }
};

export const updateComboController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { saveCombo } = await import('../../shared/combo.service.js');
        const result = await saveCombo(restaurantId, req.body || {}, {
            comboId: req.params.comboId,
            updatedByRole: 'RESTAURANT',
        });
        return sendResponse(res, 200, 'Combo updated and sent for approval', result);
    } catch (error) {
        if (error?.name === 'ValidationError' && error?.statusCode === 400) {
            return sendResponse(res, 400, error.message, null);
        }
        next(error);
    }
};

export const deleteComboController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { deleteCombo } = await import('../../shared/combo.service.js');
        await deleteCombo(restaurantId, req.params.comboId);
        return sendResponse(res, 200, 'Combo deleted successfully', null);
    } catch (error) {
        if (error?.name === 'ValidationError' && error?.statusCode === 400) {
            return sendResponse(res, 400, error.message, null);
        }
        next(error);
    }
};

export const updateRestaurantProfileController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        // priceIncludesGst is the admin's to set (see updateRestaurantTaxSettingsController),
        // so the restaurant's own profile save cannot change it either.
        const { priceIncludesGst: _adminOnly, ...body } = req.body || {};
        const restaurant = await updateRestaurantProfile(restaurantId, body);
        return sendResponse(res, 200, 'Restaurant updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantAcceptingOrdersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantAcceptingOrders(restaurantId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Restaurant availability updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantDiningSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantDiningSettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Dining settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantProfileImageController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantProfileImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadRestaurantMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantCoverImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Restaurant photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantMenuImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers(req.query || {});
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantComplaintsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantComplaints(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const deleteCurrentRestaurantAccountController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await deleteCurrentRestaurantAccount(restaurantId);
        return sendResponse(res, 200, 'Restaurant account deleted successfully', result);
    } catch (error) {
        next(error);
    }
};

import { FoodOrder } from '../../orders/models/order.model.js';

export const getRestaurantPublicReviewsController = async (req, res, next) => {
    try {
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        
        const restaurantId = restaurant._id;
        const reviews = await FoodOrder.find({
            restaurantId,
            'ratings.restaurant.rating': { $exists: true, $ne: null }
        })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('userId', 'name')
        .lean();
        
        const formattedReviews = reviews.map(order => ({
            id: order._id,
            userName: order.userId?.name || 'Anonymous Customer',
            rating: order.ratings?.restaurant?.rating,
            comment: order.ratings?.restaurant?.comment || 'No comment provided',
            date: order.createdAt
        }));
        
        return sendResponse(res, 200, 'Reviews fetched successfully', { reviews: formattedReviews });
    } catch (error) {
        next(error);
    }
};
