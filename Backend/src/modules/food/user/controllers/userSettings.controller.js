import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { listActiveDeliveryInstructions } from '../../orders/services/deliveryInstructions.service.js';
import { sendResponse } from '../../../../utils/response.js';

export const getPublicFeeSettingsController = async (req, res, next) => {
    try {
        const feeDoc = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 });
        const codOrderLimit = feeDoc?.codOrderLimit ?? Infinity;
        
        // Find max available cash limit among online delivery boys
        const { FoodDeliveryPartner } = await import('../../delivery/models/deliveryPartner.model.js');
        const { getDeliveryPartnerWalletEnhanced } = await import('../../delivery/services/deliveryFinance.service.js');
        
        const onlinePartners = await FoodDeliveryPartner.find({ availabilityStatus: 'online' }).lean();
        
        let maxAvailableCashLimit = 0;
        
        if (onlinePartners.length === 0) {
            maxAvailableCashLimit = codOrderLimit; // Fallback if no online partners
        } else {
            for (const partner of onlinePartners) {
                try {
                    const wallet = await getDeliveryPartnerWalletEnhanced(partner._id);
                    if (wallet.availableCashLimit > maxAvailableCashLimit) {
                        maxAvailableCashLimit = wallet.availableCashLimit;
                    }
                } catch (e) {
                    // Ignore errors for individual partners
                }
            }
        }

        return sendResponse(res, 200, 'Fee settings fetched', {
            codOrderLimit: codOrderLimit,
            maxAvailableCashLimit: maxAvailableCashLimit
        });
    } catch (error) {
        next(error);
    }
};

/** The checkout chip list (Food admin panel -> Delivery Management -> Delivery Instructions). */
export const getDeliveryInstructionsController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Delivery instructions fetched', await listActiveDeliveryInstructions());
    } catch (error) {
        next(error);
    }
};
