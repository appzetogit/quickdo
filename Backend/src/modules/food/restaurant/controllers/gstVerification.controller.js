import mongoose from 'mongoose';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { verifyGstin, publicVerification } from '../../../../core/gst/gstVerification.service.js';
import { FoodRestaurant } from '../models/restaurant.model.js';

/**
 * POST /food/restaurant/gst/verify   { gstin, legalName?, panNumber?, state? }
 *
 * Used by the onboarding form to check a GSTIN as it is typed and to fill the
 * legal name and address from the register when a provider is configured.
 * Anyone can call it (the applicant has no account yet), so it returns what
 * the public GST search publishes for a number and nothing about any
 * restaurant on this platform.
 */
export const verifyGstinPublicController = async (req, res, next) => {
    try {
        const { gstin, legalName, panNumber, state } = req.body || {};
        if (!gstin || String(gstin).trim().length < 15) return sendError(res, 400, 'Enter the 15-character GSTIN');
        const result = await verifyGstin(String(gstin), { legalName, panNumber, state });
        return sendResponse(res, 200, 'GSTIN checked', publicVerification(result));
    } catch (err) {
        return next(err);
    }
};

/**
 * POST /food/admin/restaurants/:id/gst-verify
 *
 * Admin review: re-run the check against what the restaurant submitted and
 * store the result. Fills the legal name / address only where the restaurant
 * left them empty; a disagreement is stored as a mismatch for the reviewer.
 */
export const reverifyRestaurantGstinAdminController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(String(id))) return sendError(res, 400, 'Invalid restaurant id');
        const r = await FoodRestaurant.findById(id)
            .select('gstRegistered gstNumber gstLegalName gstAddress panNumber location state')
            .lean();
        if (!r) return sendError(res, 404, 'Restaurant not found');
        if (!r.gstNumber) return sendError(res, 400, 'This restaurant has not given a GSTIN');
        const result = await verifyGstin(r.gstNumber, {
            legalName: r.gstLegalName,
            address: r.gstAddress,
            panNumber: r.panNumber,
            state: r.location?.state || r.state,
        });
        const set = { gstVerification: result };
        if (!String(r.gstLegalName || '').trim() && result.legalName) set.gstLegalName = result.legalName;
        if (!String(r.gstAddress || '').trim() && result.address) set.gstAddress = result.address;
        await FoodRestaurant.updateOne({ _id: r._id }, { $set: set });
        return sendResponse(res, 200, 'GSTIN re-checked', {
            verification: publicVerification(result),
            filled: { gstLegalName: set.gstLegalName || null, gstAddress: set.gstAddress || null },
        });
    } catch (err) {
        return next(err);
    }
};
