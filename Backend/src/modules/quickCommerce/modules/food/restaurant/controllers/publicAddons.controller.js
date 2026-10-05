import { sendResponse } from '../../../../utils/response.js';
import { getPublicApprovedRestaurantAddons } from '../services/publicAddons.service.js';

export const getPublicRestaurantAddonsController = async (req, res, next) => {
    try {
        // ?foodId=<menu item id> narrows to that item's add-ons plus any
        // whole-menu ones. Omit it to get everything the restaurant offers.
        const result = await getPublicApprovedRestaurantAddons(req.params.id, {
            foodId: req.query?.foodId,
        });
        if (!result) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        // `addons` keeps its original flat shape for existing clients; `groups` is
        // the grouped, rule-carrying shape the item sheet renders.
        return sendResponse(res, 200, 'Add-ons fetched successfully', {
            addons: result.addons,
            groups: result.groups,
        });
    } catch (error) {
        next(error);
    }
};

