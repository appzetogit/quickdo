import { sendResponse } from '../../../../utils/response.js';
import { listPublicFoods } from '../services/publicFoods.service.js';

export const listPublicFoodsController = async (req, res, next) => {
    try {
        const data = await listPublicFoods(req.query || {});
        return sendResponse(res, 200, 'Foods fetched successfully', data);
    } catch (error) {
        next(error);
    }
};
