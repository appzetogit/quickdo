import mongoose from 'mongoose';
import * as adminService from '../services/admin.service.js';
import * as priceAdjustmentService from '../services/priceAdjustment.service.js';
import { validateCategoryListQuery, validateCategoryRejectDto, validateCategoryUpsertDto } from '../validators/category.validator.js';
import { validateCreateOfferDto, validateUpdateOfferCartVisibilityDto } from '../validators/offer.validator.js';
import { validateAddDeliveryBonusDto } from '../validators/deliveryBonus.validator.js';
import { validateCheckCompletionsDto, validateEarningAddonHistoryActionDto, validateEarningAddonUpsertDto, validateToggleEarningAddonStatusDto } from '../validators/earningAddon.validator.js';
import { validateDeliveryCommissionRuleDto, validateOptionalStatusDto, validateRestaurantCommissionUpsertDto, validateZoneSurgeUpsertDto } from '../validators/commission.validator.js';
import { validateFeeSettingsUpsertDto } from '../validators/feeSettings.validator.js';
import { validateDeliveryEmergencyHelpUpsertDto } from '../validators/deliveryEmergencyHelp.validator.js';
import { validateReferralSettingsUpsertDto } from '../validators/referralSettings.validator.js';

// ----- Customers / Users -----
export async function getCustomers(req, res, next) {
    try {
        const data = await adminService.getCustomers(req.query || {});
        res.status(200).json({ success: true, message: 'Customers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getCustomerById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const customer = await adminService.getCustomerById(id);
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer fetched successfully', data: { user: customer, customer } });
    } catch (error) {
        next(error);
    }
}

export async function updateCustomerStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const isActive = req.body?.isActive;
        const updated = await adminService.updateCustomerStatus(id, isActive);
        if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer status updated successfully', data: { user: updated, customer: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateCustomerCodBlockStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const isBlockedFromCOD = req.body?.isBlockedFromCOD;
        const updated = await adminService.updateCustomerCodBlockStatus(id, isBlockedFromCOD);
        if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
        res.status(200).json({ success: true, message: 'Customer COD block status updated successfully', data: { user: updated, customer: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Safety / Emergency Reports -----
export async function getSafetyEmergencyReports(req, res, next) {
    try {
        const data = await adminService.getSafetyEmergencyReports(req.query || {});
        res.status(200).json({ success: true, message: 'Safety emergency reports fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSafetyEmergencyStatus(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await adminService.updateSafetyEmergencyStatus(id, req.body?.status);
        if (!updated) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { report: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateSafetyEmergencyPriority(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await adminService.updateSafetyEmergencyPriority(id, req.body?.priority);
        if (!updated) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Priority updated successfully', data: { report: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteSafetyEmergencyReport(req, res, next) {
    try {
        const { id } = req.params;
        const deleted = await adminService.deleteSafetyEmergencyReport(id);
        if (!deleted) return res.status(404).json({ success: false, message: 'Report not found' });
        res.status(200).json({ success: true, message: 'Safety emergency report deleted successfully', data: { report: deleted } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantComplaint(req, res, next) {
    try {
        const { id } = req.params;
        const { status, adminResponse } = req.body;
        const updated = await adminService.updateRestaurantComplaint(id, { status, adminResponse });
        res.status(200).json({ success: true, message: 'Complaint updated successfully', data: { complaint: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Restaurants -----
export async function getRestaurantComplaints(req, res, next) {
    try {
        const data = await adminService.getRestaurantComplaints(req.query || {});
        res.status(200).json({ success: true, message: 'Restaurant complaints fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function globalSearch(req, res, next) {
    try {
        const { query } = req.query;
        const data = await adminService.globalSearch(query);
        res.status(200).json({
            success: true,
            message: 'Global search results fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurants(req, res, next) {
    try {
        const data = await adminService.getRestaurants(req.query);
        res.status(200).json({
            success: true,
            message: 'Restaurants fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantReport(req, res, next) {
    try {
        const data = await adminService.getRestaurantReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Restaurant report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDashboardStats(req, res, next) {
    try {
        const data = await adminService.getDashboardStats(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Dashboard stats fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTransactionReport(req, res, next) {
    try {
        const data = await adminService.getTransactionReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Transaction report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTaxReport(req, res, next) {
    try {
        const data = await adminService.getTaxReport(req.query || {});
        res.status(200).json({
            success: true,
            message: 'Tax report fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getTaxReportDetail(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.getTaxReportDetail(id, req.query || {});
        res.status(200).json({
            success: true,
            message: 'Tax report detail fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantReviews(req, res, next) {
    try {
        const data = await adminService.getRestaurantReviews(req.query);
        res.status(200).json({
            success: true,
            message: 'Restaurant reviews fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const restaurant = await adminService.getRestaurantById(id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Restaurant fetched successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantAnalytics(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const data = await adminService.getRestaurantAnalytics(id);
        if (!data) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Restaurant analytics fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

/**
 * A restaurant's spend-threshold reward ladder, from the admin panel.
 *
 * Reads and writes the same document the restaurant's own panel edits, rather
 * than an admin-side copy: two ladders for one restaurant would mean the order
 * path has to pick one, and whichever it picked would surprise somebody.
 */
export async function getRestaurantFreebieOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const { getFreebieOffer } = await import('../../shared/freebieOffer.service.js');
        const offer = await getFreebieOffer(id);
        res.status(200).json({
            success: true,
            message: 'Freebie offer fetched successfully',
            data: { offer: offer || { restaurantId: id, isActive: true, tiers: [] } },
        });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantFreebieOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const { normalizeFreebieTiersInput } = await import('../../shared/freebieRewards.js');
        const { saveFreebieOffer } = await import('../../shared/freebieOffer.service.js');

        let tiers;
        try {
            tiers = normalizeFreebieTiersInput(req.body || {})?.tiers;
        } catch (validationError) {
            return res.status(400).json({ success: false, message: validationError.message });
        }

        const offer = await saveFreebieOffer(id, {
            tiers,
            isActive: req.body?.isActive,
            updatedByRole: 'ADMIN',
        });
        res.status(200).json({ success: true, message: 'Freebie offer saved successfully', data: { offer } });
    } catch (error) {
        next(error);
    }
}

/**
 * A restaurant's buy-one-get-one dishes, from the admin side.
 *
 * The same document the restaurant panel edits, for the same reason as the
 * freebie ladder above: one row per restaurant means support can fix a badly
 * configured offer without the restaurant and admin looking at rival copies.
 */
/**
 * Per-restaurant free delivery. The stored shape is a mode plus two numbers;
 * 'inherit' is the default and means "follow the platform rule", so a restaurant
 * that has never been configured returns that rather than a null the panel would
 * have to special-case.
 */
export async function getRestaurantFreeDelivery(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const { FoodRestaurant } = await import('../../restaurant/models/restaurant.model.js');
        const { normalizeRestaurantFreeDelivery, normalizeFreeDeliveryRule, resolveEffectiveFreeDeliveryRule } =
            await import('../../shared/freeDeliveryRule.js');
        const { FoodFeeSettings } = await import('../models/feeSettings.model.js');

        const restaurant = await FoodRestaurant.findById(id).select('restaurantName freeDeliveryRule').lean();
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        // Same query the order path uses, so the panel shows the document that
        // actually governs pricing rather than an inactive or older one.
        const feeSettings = await FoodFeeSettings.findOne({ isActive: true })
            .sort({ createdAt: -1 })
            .select('freeDeliveryRule')
            .lean();

        const setting = normalizeRestaurantFreeDelivery(restaurant.freeDeliveryRule);
        const platform = normalizeFreeDeliveryRule(feeSettings?.freeDeliveryRule);
        // The panel shows what actually governs orders today, so an admin can see
        // the effect of 'inherit' without opening the platform page.
        const effective = resolveEffectiveFreeDeliveryRule({
            restaurant: restaurant.freeDeliveryRule,
            platform: feeSettings?.freeDeliveryRule,
        });

        res.status(200).json({
            success: true,
            message: 'Free delivery setting fetched successfully',
            data: {
                restaurantId: id,
                restaurantName: restaurant.restaurantName || '',
                setting,
                platform,
                effective: effective.rule,
                effectiveSource: effective.source,
            },
        });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantFreeDelivery(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const { validateRestaurantFreeDelivery, mergeRestaurantFreeDelivery } =
            await import('../../shared/freeDeliveryRule.js');
        const { FoodRestaurant } = await import('../../restaurant/models/restaurant.model.js');

        const existing = await FoodRestaurant.findById(id).select('freeDeliveryRule').lean();
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }

        // Merge over what is stored, so switching to inherit or off keeps the
        // radius and minimum the admin typed rather than resetting them.
        const merged = mergeRestaurantFreeDelivery(req.body || {}, existing.freeDeliveryRule);
        const verdict = validateRestaurantFreeDelivery(merged);
        if (!verdict.ok) {
            return res.status(400).json({ success: false, message: verdict.reason });
        }

        const updated = await FoodRestaurant.findByIdAndUpdate(
            id,
            { $set: { freeDeliveryRule: verdict.setting } },
            { new: true, runValidators: true },
        ).select('restaurantName freeDeliveryRule').lean();

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }

        // Menu and checkout responses are cached; a delivery rule change has to
        // show up on the next order, not five minutes later.
        try {
            const { invalidatePriceCaches } = await import('../../../../middleware/cache.js');
            await invalidatePriceCaches();
        } catch (cacheErr) {
            console.error('Cache clear after free delivery change failed:', cacheErr?.message || cacheErr);
        }

        res.status(200).json({
            success: true,
            message: 'Free delivery setting saved successfully',
            data: { setting: updated.freeDeliveryRule },
        });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantBogoOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const { getBogoOffer } = await import('../../shared/bogoOffer.service.js');
        const offer = await getBogoOffer(id);
        res.status(200).json({
            success: true,
            message: 'Buy one get one offer fetched successfully',
            data: { offer: offer || { restaurantId: id, isActive: true, offers: [] } },
        });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantBogoOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const { normalizeBogoOffersInput } = await import('../../shared/bogoOffer.js');
        const { saveBogoOffer } = await import('../../shared/bogoOffer.service.js');

        let offers;
        try {
            offers = normalizeBogoOffersInput(req.body || {})?.offers;
        } catch (validationError) {
            return res.status(400).json({ success: false, message: validationError.message });
        }

        const offer = await saveBogoOffer(id, {
            offers,
            isActive: req.body?.isActive,
            updatedByRole: 'ADMIN',
        });
        res.status(200).json({ success: true, message: 'Buy one get one offer saved successfully', data: { offer } });
    } catch (error) {
        next(error);
    }
}

/**
 * Combos, admin side.
 *
 * A combo is stored as an ordinary FoodItem marked `isCombo`, so what the admin
 * saves here is live immediately -- the same rule that applies to a dish the
 * admin creates directly, and the reason the restaurant's own combos go to the
 * approval queue instead.
 */
const invalidComboRestaurant = (id, res) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        return true;
    }
    return false;
};

const comboValidationHandled = (error, res) => {
    if (error?.name === 'ValidationError' && error?.statusCode === 400) {
        res.status(400).json({ success: false, message: error.message });
        return true;
    }
    return false;
};

export async function listRestaurantCombos(req, res, next) {
    try {
        const { id } = req.params;
        if (invalidComboRestaurant(id, res)) return;
        const { listCombos } = await import('../../shared/combo.service.js');
        const combos = await listCombos(id);
        res.status(200).json({ success: true, message: 'Combos fetched successfully', data: { combos } });
    } catch (error) {
        next(error);
    }
}

export async function createRestaurantCombo(req, res, next) {
    try {
        const { id } = req.params;
        if (invalidComboRestaurant(id, res)) return;
        const { saveCombo } = await import('../../shared/combo.service.js');
        const result = await saveCombo(id, req.body || {}, { updatedByRole: 'ADMIN' });
        res.status(201).json({ success: true, message: 'Combo created successfully', data: result });
    } catch (error) {
        if (comboValidationHandled(error, res)) return;
        next(error);
    }
}

export async function updateRestaurantCombo(req, res, next) {
    try {
        const { id, comboId } = req.params;
        if (invalidComboRestaurant(id, res)) return;
        const { saveCombo } = await import('../../shared/combo.service.js');
        const result = await saveCombo(id, req.body || {}, { comboId, updatedByRole: 'ADMIN' });
        res.status(200).json({ success: true, message: 'Combo updated successfully', data: result });
    } catch (error) {
        if (comboValidationHandled(error, res)) return;
        next(error);
    }
}

export async function deleteRestaurantCombo(req, res, next) {
    try {
        const { id, comboId } = req.params;
        if (invalidComboRestaurant(id, res)) return;
        const { deleteCombo } = await import('../../shared/combo.service.js');
        await deleteCombo(id, comboId);
        res.status(200).json({ success: true, message: 'Combo deleted successfully', data: null });
    } catch (error) {
        if (comboValidationHandled(error, res)) return;
        next(error);
    }
}

export async function getRestaurantMenuById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const menu = await adminService.getRestaurantMenuById(id);
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({ success: true, message: 'Menu fetched successfully', data: { menu } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantMenuById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const menu = await adminService.updateRestaurantMenuById(id, req.body || {});
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({ success: true, message: 'Menu updated successfully', data: { menu } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const updated = await adminService.updateRestaurantById(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({ success: true, message: 'Restaurant updated successfully', data: { restaurant: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const updated = await adminService.updateRestaurantStatus(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({ success: true, message: 'Restaurant status updated successfully', data: { restaurant: updated } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantLocation(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid restaurant id' });
        }
        const updated = await adminService.updateRestaurantLocation(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        res.status(200).json({ success: true, message: 'Restaurant location updated successfully', data: { restaurant: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Foods -----
export async function getFoods(req, res, next) {
    try {
        const data = await adminService.getFoods(req.query || {});
        res.status(200).json({ success: true, message: 'Foods fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createFood(req, res, next) {
    try {
        const created = await adminService.createFood(req.body || {});
        res.status(201).json({ success: true, message: 'Food created successfully', data: { food: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateFood(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid food id' });
        }
        const updated = await adminService.updateFood(id, req.body || {});
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Food not found' });
        }
        res.status(200).json({ success: true, message: 'Food updated successfully', data: { food: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteFood(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid food id' });
        }
        const result = await adminService.deleteFood(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Food not found' });
        }
        res.status(200).json({ success: true, message: 'Food deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

// ----- Categories -----
export async function getCategories(req, res, next) {
    try {
        const query = validateCategoryListQuery(req.query || {});
        const data = await adminService.getCategories(query);
        res.status(200).json({ success: true, message: 'Categories fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createCategory(req, res, next) {
    try {
        const body = validateCategoryUpsertDto(req.body || {});
        const created = await adminService.createCategory(body);
        res.status(201).json({ success: true, message: 'Category created successfully', data: { category: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const body = validateCategoryUpsertDto(req.body || {});
        const updated = await adminService.updateCategory(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category updated successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const result = await adminService.deleteCategory(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleCategoryStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.toggleCategoryStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category status updated successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function approveCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.approveCategory(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found or already approved' });
        }
        res.status(200).json({ success: true, message: 'Category approved successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function rejectCategory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const body = validateCategoryRejectDto(req.body || {});
        const updated = await adminService.rejectCategory(id, body.reason);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category rejected successfully', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

export async function makeCategoryGlobal(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid category id' });
        }
        const updated = await adminService.makeCategoryGlobal(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Category not found' });
        }
        res.status(200).json({ success: true, message: 'Category is now global', data: { category: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Offers & Coupons -----
export async function getAllOffers(req, res, next) {
    try {
        const data = await adminService.getAllOffers(req.query || {});
        res.status(200).json({ success: true, message: 'Offers fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createAdminOffer(req, res, next) {
    try {
        const body = validateCreateOfferDto(req.body || {});
        const created = await adminService.createAdminOffer(body);
        res.status(201).json({ success: true, message: 'Offer created successfully', data: { offer: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateAdminOfferCartVisibility(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const body = validateUpdateOfferCartVisibilityDto(req.body || {});
        const updated = await adminService.updateAdminOfferCartVisibility(id, body.itemId, body.showInCart);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer updated successfully', data: { offer: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteAdminOffer(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid offer id' });
        }
        const result = await adminService.deleteAdminOffer(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }
        res.status(200).json({ success: true, message: 'Offer deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function getSupportTicketsController(req, res, next) {
    try {
        const data = await adminService.getSupportTickets(req.query || {});
        res.status(200).json({ success: true, message: 'Support tickets fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateSupportTicketController(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid ticket id' });
        }
        const updated = await adminService.updateSupportTicket(id, req.body || {});
        if (!updated) return res.status(404).json({ success: false, message: 'Ticket not found' });
        res.status(200).json({ success: true, message: 'Support ticket updated successfully', data: { ticket: updated } });
    } catch (error) {
        next(error);
    }
}

export async function getPendingRestaurants(req, res, next) {
    try {
        const pending = await adminService.getPendingRestaurants();
        res.status(200).json({
            success: true,
            message: 'Pending restaurants fetched successfully',
            data: pending
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery partner bonus (admin) -----
export async function getDeliveryPartnerBonusTransactions(req, res, next) {
    try {
        const data = await adminService.getDeliveryPartnerBonusTransactions(req.query || {});
        res.status(200).json({ success: true, message: 'Bonus transactions fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function addDeliveryPartnerBonus(req, res, next) {
    try {
        const body = validateAddDeliveryBonusDto(req.body || {});
        const created = await adminService.addDeliveryPartnerBonus(body, req.user);
        res.status(201).json({ success: true, message: 'Bonus added successfully', data: { transaction: created } });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryEarnings(req, res, next) {
    try {
        const data = await adminService.getDeliveryEarnings(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery earnings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Earning Addon (admin) -----
export async function getEarningAddons(req, res, next) {
    try {
        const data = await adminService.getEarningAddons();
        res.status(200).json({ success: true, message: 'Earning addons fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createEarningAddon(req, res, next) {
    try {
        const body = validateEarningAddonUpsertDto(req.body || {});
        const created = await adminService.createEarningAddon(body);
        res.status(201).json({ success: true, message: 'Earning addon created successfully', data: { earningAddon: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateEarningAddon(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const body = validateEarningAddonUpsertDto(req.body || {});
        const updated = await adminService.updateEarningAddon(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Earning addon updated successfully', data: { earningAddon: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteEarningAddon(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const result = await adminService.deleteEarningAddon(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Earning addon deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleEarningAddonStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid earning addon id' });
        }
        const { status } = validateToggleEarningAddonStatusDto(req.body || {});
        const updated = await adminService.toggleEarningAddonStatus(id, status);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Earning addon not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { earningAddon: updated } });
    } catch (error) {
        next(error);
    }
}

export async function getEarningAddonHistory(req, res, next) {
    try {
        const data = await adminService.getEarningAddonHistory(req.query || {});
        res.status(200).json({ success: true, message: 'Earning addon history fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function creditEarningToWallet(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid history id' });
        }
        const { notes } = validateEarningAddonHistoryActionDto(req.body || {});
        const updated = await adminService.creditEarningAddonHistory(id, notes);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'History record not found' });
        }
        res.status(200).json({ success: true, message: 'Earning credited successfully', data: { history: updated } });
    } catch (error) {
        next(error);
    }
}

export async function cancelEarningAddonHistory(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid history id' });
        }
        const { reason } = validateEarningAddonHistoryActionDto(req.body || {});
        const updated = await adminService.cancelEarningAddonHistory(id, reason);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'History record not found' });
        }
        res.status(200).json({ success: true, message: 'Earning cancelled successfully', data: { history: updated } });
    } catch (error) {
        next(error);
    }
}

export async function checkEarningAddonCompletions(req, res, next) {
    try {
        const { deliveryPartnerId, force } = validateCheckCompletionsDto(req.body || {});
        const data = await adminService.checkEarningAddonCompletions(deliveryPartnerId, force);
        res.status(200).json({ success: true, message: 'Completion check done', data });
    } catch (error) {
        next(error);
    }
}

// ----- Restaurant Commission (admin) -----
export async function getRestaurantCommissions(req, res, next) {
    try {
        const data = await adminService.getRestaurantCommissions();
        res.status(200).json({ success: true, message: 'Restaurant commissions fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantCommissionBootstrap(req, res, next) {
    try {
        const data = await adminService.getRestaurantCommissionBootstrap();
        res.status(200).json({ success: true, message: 'Restaurant commission bootstrap fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantCommissionById(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const commission = await adminService.getRestaurantCommissionById(id);
        if (!commission) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission fetched successfully', data: { commission } });
    } catch (error) {
        next(error);
    }
}

export async function createRestaurantCommission(req, res, next) {
    try {
        const body = validateRestaurantCommissionUpsertDto(req.body || {});
        const created = await adminService.createRestaurantCommission(body);
        res.status(201).json({ success: true, message: 'Commission created successfully', data: { commission: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantCommission(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const body = validateRestaurantCommissionUpsertDto(req.body || {});
        const updated = await adminService.updateRestaurantCommission(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteRestaurantCommission(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const result = await adminService.deleteRestaurantCommission(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Commission deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleRestaurantCommissionStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const updated = await adminService.toggleRestaurantCommissionStatus(id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery commission rules (admin) -----
export async function getDeliveryCommissionRules(req, res, next) {
    try {
        const data = await adminService.getDeliveryCommissionRules();
        res.status(200).json({ success: true, message: 'Commission rules fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createDeliveryCommissionRule(req, res, next) {
    try {
        const body = validateDeliveryCommissionRuleDto(req.body || {});
        const created = await adminService.createDeliveryCommissionRule(body);
        res.status(201).json({ success: true, message: 'Commission rule created successfully', data: { commission: created } });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryCommissionRule(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const body = validateDeliveryCommissionRuleDto(req.body || {});
        const updated = await adminService.updateDeliveryCommissionRule(id, body);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Commission rule updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

export async function deleteDeliveryCommissionRule(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const result = await adminService.deleteDeliveryCommissionRule(id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Commission rule deleted successfully', data: result });
    } catch (error) {
        next(error);
    }
}

export async function toggleDeliveryCommissionRuleStatus(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid commission id' });
        }
        const { status } = validateOptionalStatusDto(req.body || {});
        if (typeof status !== 'boolean') {
            return res.status(400).json({ success: false, message: 'status is required' });
        }
        const updated = await adminService.toggleDeliveryCommissionRuleStatus(id, status);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Commission rule not found' });
        }
        res.status(200).json({ success: true, message: 'Status updated successfully', data: { commission: updated } });
    } catch (error) {
        next(error);
    }
}

// ----- Fee Settings (admin) -----
export async function getFeeSettings(req, res, next) {
    try {
        const data = await adminService.getFeeSettings();
        res.status(200).json({ success: true, message: 'Fee settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getMonetizationMode(req, res, next) {
    try {
        const data = await adminService.getMonetizationMode();
        res.status(200).json({ success: true, message: 'Monetization mode fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateMonetizationMode(req, res, next) {
    try {
        const data = await adminService.setMonetizationMode(req.body || {});
        res.status(200).json({ success: true, message: 'Monetization mode updated', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateFeeSettings(req, res, next) {
    try {
        const body = validateFeeSettingsUpsertDto(req.body || {});
        const feeSettings = await adminService.upsertFeeSettings(body);
        res.status(200).json({ success: true, message: 'Fee settings saved successfully', data: { feeSettings } });
    } catch (error) {
        next(error);
    }
}

// ----- Referral Settings (admin) -----
export async function getReferralSettings(req, res, next) {
    try {
        const data = await adminService.getReferralSettings();
        res.status(200).json({ success: true, message: 'Referral settings fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateReferralSettings(req, res, next) {
    try {
        const body = validateReferralSettingsUpsertDto(req.body || {});
        const referralSettings = await adminService.upsertReferralSettings(body);
        res.status(200).json({ success: true, message: 'Referral settings saved successfully', data: { referralSettings } });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery Cash Limit (admin) -----
export async function getDeliveryCashLimit(req, res, next) {
    try {
        const data = await adminService.getDeliveryCashLimitSettings();
        res.status(200).json({ success: true, message: 'Delivery cash limit fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryCashLimit(req, res, next) {
    try {
        const data = await adminService.upsertDeliveryCashLimitSettings(req.body || {});
        res.status(200).json({ success: true, message: 'Delivery cash limit updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantWithdrawalSetting(req, res, next) {
    try {
        const data = await adminService.getRestaurantWithdrawalSettings();
        res.status(200).json({ success: true, message: 'Restaurant withdrawal setting fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateRestaurantWithdrawalSetting(req, res, next) {
    try {
        const data = await adminService.upsertRestaurantWithdrawalSettings(req.body || {});
        res.status(200).json({ success: true, message: 'Restaurant withdrawal setting updated successfully', data });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery Emergency Help (admin) -----
export async function getEmergencyHelp(req, res, next) {
    try {
        const data = await adminService.getDeliveryEmergencyHelp();
        res.status(200).json({ success: true, message: 'Emergency help fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createOrUpdateEmergencyHelp(req, res, next) {
    try {
        const body = validateDeliveryEmergencyHelpUpsertDto(req.body || {});
        const data = await adminService.upsertDeliveryEmergencyHelp(body);
        res.status(200).json({ success: true, message: 'Emergency help saved successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function approveRestaurant(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid restaurant id'
            });
        }
        const restaurant = await adminService.approveRestaurant(id);
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: 'Restaurant not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Restaurant approved successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function createRestaurant(req, res, next) {
    try {
        const restaurant = await adminService.createRestaurantByAdmin(req.body || {});
        res.status(201).json({
            success: true,
            message: 'Restaurant created successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

export async function rejectRestaurant(req, res, next) {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid restaurant id'
            });
        }
        const restaurant = await adminService.rejectRestaurant(id, reason);
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: 'Restaurant not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Restaurant rejected successfully',
            data: restaurant
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery join requests -----
export async function getDeliveryJoinRequests(req, res, next) {
    try {
        const data = await adminService.getDeliveryJoinRequests(req.query);
        res.status(200).json({
            success: true,
            message: 'Delivery join requests fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}


// ----- Support tickets -----
export async function getSupportTicketStats(req, res, next) {
    try {
        const data = await adminService.getSupportTicketStats();
        res.status(200).json({
            success: true,
            message: 'Support ticket stats fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getSupportTickets(req, res, next) {
    try {
        const data = await adminService.getDeliverySupportTickets(req.query);
        res.status(200).json({
            success: true,
            message: 'Support tickets fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function updateSupportTicket(req, res, next) {
    try {
        const ticket = await adminService.updateDeliverySupportTicket(req.params.id, req.body);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Support ticket not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Support ticket updated successfully',
            data: ticket
        });
    } catch (error) {
        next(error);
    }
}

// ----- Delivery partners -----
/** "Delete" on the rider list: removes the rider permanently (?force=1 past a money warning). */
export async function deactivateDeliveryPartner(req, res, next) {
    try {
        const force = ['1', 'true'].includes(String(req.query?.force || ''));
        const data = await adminService.deleteDeliveryPartnerPermanently(req.params.id, { force });
        if (!data) return res.status(404).json({ success: false, message: 'Delivery partner not found' });
        if (data.needsConfirm) {
            return res.status(409).json({
                success: false,
                needsConfirm: true,
                message: 'This rider still has money on their account',
                data,
            });
        }
        res.status(200).json({ success: true, message: 'Delivery partner deleted permanently', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryPartners(req, res, next) {
    try {
        const data = await adminService.getDeliveryPartners(req.query);
        res.status(200).json({
            success: true,
            message: 'Delivery partners fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDeliverymanReviews(req, res, next) {
    try {
        const data = await adminService.getDeliverymanReviews(req.query);
        res.status(200).json({
            success: true,
            message: 'Deliveryman reviews fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getContactMessages(req, res, next) {
    try {
        const data = await adminService.getContactMessages(req.query);
        res.status(200).json({
            success: true,
            message: 'Contact messages fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryPartnerById(req, res, next) {
    try {
        const delivery = await adminService.getDeliveryPartnerById(req.params.id);
        if (!delivery) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner fetched successfully',
            data: { delivery }
        });
    } catch (error) {
        next(error);
    }
}

export async function approveDeliveryPartner(req, res, next) {
    try {
        // Optional: which verticals to enable. Omitted means food delivery only.
        const serviceCapabilities = req.body?.serviceCapabilities;
        const partner = await adminService.approveDeliveryPartner(req.params.id, { serviceCapabilities });
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner approved successfully',
            data: partner
        });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryPartnerCapabilities(req, res, next) {
    try {
        const partner = await adminService.updateDeliveryPartnerCapabilities(
            req.params.id,
            req.body?.serviceCapabilities,
        );
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Delivery partner not found' });
        }
        res.status(200).json({
            success: true,
            message: 'Driver services updated successfully',
            data: partner,
        });
    } catch (error) {
        next(error);
    }
}

export async function rejectDeliveryPartner(req, res, next) {
    try {
        const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
        const partner = await adminService.rejectDeliveryPartner(req.params.id, reason);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Delivery partner not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Delivery partner rejected successfully',
            data: partner
        });
    } catch (error) {
        next(error);
    }
}

// ----- Zones -----
export async function getZones(req, res, next) {
    try {
        const data = await adminService.getZones(req.query);
        res.status(200).json({
            success: true,
            message: 'Zones fetched successfully',
            data
        });
    } catch (error) {
        next(error);
    }
}

export async function getZoneById(req, res, next) {
    try {
        const zone = await adminService.getZoneById(req.params.id);
        if (!zone) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone fetched successfully',
            data: { zone }
        });
    } catch (error) {
        next(error);
    }
}

export async function createZone(req, res, next) {
    try {
        const result = await adminService.createZone(req.body || {});
        if (result.error) {
            return res.status(400).json({
                success: false,
                message: result.error
            });
        }
        res.status(201).json({
            success: true,
            message: 'Zone created successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function updateZone(req, res, next) {
    try {
        const result = await adminService.updateZone(req.params.id, req.body || {});
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone updated successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteZone(req, res, next) {
    try {
        const result = await adminService.deleteZone(req.params.id);
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Zone not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Zone deleted successfully',
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function processRefund(req, res, next) {
    try {
        const { orderId } = req.params;
        if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
            return res.status(400).json({ success: false, message: 'Invalid order id' });
        }

        /*
         * Deliberately not implemented, rather than wired to the wrong thing.
         *
         * This called adminService.processRefund, which has never existed, so
         * every call threw -- and had it not, it would then have pushed the
         * customer "Refund processed" for a refund nobody made. The food side's
         * only real refund path is processOrderRefundOnce in
         * orders/services/order.service.js: private to that module, full-amount
         * only, and run as part of cancelling an order. A standalone admin refund
         * needs its own guarded service there -- amount <= paid, one claim per
         * order -- before this can be switched on. No route mounts this handler
         * today; the 501 is for when one does.
         */
        return res.status(501).json({
            success: false,
            message: 'Admin refunds are not available here yet. Cancel the order to refund a paid order in full.'
        });
    } catch (error) {
        next(error);
    }
}
export async function getWithdrawals(req, res, next) {
    try {
        const data = await adminService.getWithdrawals(req.query || {});
        res.status(200).json({ success: true, message: 'Withdrawals fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateWithdrawalStatus(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.updateWithdrawalStatus(id, req.body || {});
        res.status(200).json({ success: true, message: 'Withdrawal status updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryWithdrawals(req, res, next) {
    try {
        const data = await adminService.getDeliveryWithdrawals(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery withdrawals fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateDeliveryWithdrawalStatus(req, res, next) {
    try {
        const { id } = req.params;
        const data = await adminService.updateDeliveryWithdrawalStatus(id, req.body || {});
        res.status(200).json({ success: true, message: 'Delivery withdrawal status updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryWallets(req, res, next) {
    try {
        const data = await adminService.getDeliveryWallets(req.query || {});
        res.status(200).json({ success: true, message: 'Delivery wallets fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getCashLimitSettlements(req, res, next) {
    try {
        const data = await adminService.getCashLimitSettlements(req.query || {});
        res.status(200).json({ success: true, message: 'Cash limit settlements fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getSidebarBadges(req, res, next) {
    try {
        const counts = await adminService.getSidebarBadges();
        res.status(200).json({ success: true, counts });
    } catch (error) {
        next(error);
    }
}

export async function getDeliveryZoneSurgeConfigs(req, res, next) {
    try {
        const data = await adminService.getDeliveryZoneSurgeConfigs();
        res.status(200).json({ success: true, message: 'Zone surge configs fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function upsertDeliveryZoneSurgeConfig(req, res, next) {
    try {
        const body = validateZoneSurgeUpsertDto(req.body || {});
        const adminId = req.user?.id || req.user?._id || null;
        const surgeConfig = await adminService.upsertDeliveryZoneSurgeConfig(body, adminId);
        res.status(200).json({ success: true, message: 'Zone surge config saved successfully', data: { surgeConfig } });
    } catch (error) {
        next(error);
    }
}

export async function toggleDeliveryZoneSurgeStatus(req, res, next) {
    try {
        const { zoneId } = req.params;
        if (!zoneId || !mongoose.Types.ObjectId.isValid(zoneId)) {
            return res.status(400).json({ success: false, message: 'Invalid zone id' });
        }
        const { status } = validateOptionalStatusDto(req.body || {});
        if (typeof status !== 'boolean') {
            return res.status(400).json({ success: false, message: 'status is required' });
        }
        const adminId = req.user?.id || req.user?._id || null;
        const surgeConfig = await adminService.toggleDeliveryZoneSurgeStatus(zoneId, status, adminId);
        res.status(200).json({ success: true, message: 'Zone surge status updated successfully', data: { surgeConfig } });
    } catch (error) {
        next(error);
    }
}

export async function getExpiredFssaiNotifications(req, res, next) {
    try {
        const { listExpiredFssaiRestaurants } = await import('../../restaurant/services/fssaiExpiry.service.js');
        const items = await listExpiredFssaiRestaurants();
        res.status(200).json({
            success: true,
            message: 'Expired FSSAI notifications fetched successfully',
            data: { items }
        });
    } catch (error) {
        next(error);
    }
}
export async function bulkApproveFoodItems(req, res, next) {
    try {
        const { restaurantId } = req.body;
        const result = await adminService.bulkApproveFoodItems(restaurantId);
        res.status(200).json({
            success: true,
            message: `Successfully approved ${result.modifiedCount} items`,
            data: result
        });
    } catch (error) {
        next(error);
    }
}


// ----- Global Menu Price Adjustment -----
export async function getStandingAdjustments(req, res, next) {
    try {
        const data = await priceAdjustmentService.listStandingAdjustments();
        res.status(200).json({ success: true, message: 'Standing adjustments fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getPriceAdjustments(req, res, next) {
    try {
        const data = await priceAdjustmentService.listPriceAdjustments(req.query || {});
        res.status(200).json({ success: true, message: 'Price adjustments fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function getPriceAdjustmentPreview(req, res, next) {
    try {
        const data = await priceAdjustmentService.getPriceAdjustmentPreview(req.query || {});
        res.status(200).json({ success: true, message: 'Price adjustment preview fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function applyPriceAdjustment(req, res, next) {
    try {
        const data = await priceAdjustmentService.applyPriceAdjustment(req.body || {}, req.user || {});
        res.status(200).json({ success: true, message: `Updated ${data.itemsUpdated} item(s)`, data });
    } catch (error) {
        next(error);
    }
}

export async function revertPriceAdjustment(req, res, next) {
    try {
        const data = await priceAdjustmentService.revertPriceAdjustment(req.params.id, req.user || {});
        res.status(200).json({ success: true, message: `Reverted ${data.itemsUpdated} item(s)`, data });
    } catch (error) {
        next(error);
    }
}

// ----- Scheduled commission rates -----
export async function listCommissionSchedules(req, res, next) {
    try {
        const data = await adminService.listCommissionSchedules(req.query || {});
        res.status(200).json({ success: true, message: 'Commission schedules fetched successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function createCommissionSchedule(req, res, next) {
    try {
        const data = await adminService.createCommissionSchedule(req.body || {}, req.user || {});
        res.status(201).json({ success: true, message: 'Commission schedule created successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function updateCommissionSchedule(req, res, next) {
    try {
        const data = await adminService.updateCommissionSchedule(req.params.id, req.body || {});
        if (!data) return res.status(404).json({ success: false, message: 'Commission schedule not found' });
        res.status(200).json({ success: true, message: 'Commission schedule updated successfully', data });
    } catch (error) {
        next(error);
    }
}

export async function deleteCommissionSchedule(req, res, next) {
    try {
        const data = await adminService.deleteCommissionSchedule(req.params.id);
        if (!data) return res.status(404).json({ success: false, message: 'Commission schedule not found' });
        res.status(200).json({ success: true, message: 'Commission schedule deleted successfully', data });
    } catch (error) {
        next(error);
    }
}
