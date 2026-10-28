import { sendResponse, sendError } from '../../../../utils/response.js';
import { listTrendingFoods, setFoodTrending } from '../services/trendingFoods.service.js';

export const listTrendingFoodsController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Trending foods fetched successfully', await listTrendingFoods(req.query || {}));
    } catch (error) {
        next(error);
    }
};

export const setFoodTrendingController = async (req, res, next) => {
    try {
        const food = await setFoodTrending(req.params.id, req.body?.isTrending);
        return sendResponse(res, 200, food.isTrending ? "Recommended: shows in Trending Now and its restaurant's Recommended" : 'No longer recommended', { food });
    } catch (error) {
        if (error.statusCode) return sendError(res, error.statusCode, error.message);
        next(error);
    }
};
