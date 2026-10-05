import { sendResponse } from '../../../../utils/response.js';
import * as favoriteService from '../services/userFavorite.service.js';

const me = (req) => req.user?.userId;

export async function getFavoritesController(req, res, next) {
    try {
        const data = await favoriteService.getUserFavorites(me(req));
        return sendResponse(res, 200, 'Favorites fetched', data);
    } catch (err) {
        next(err);
    }
}

export async function addFavoriteRestaurantController(req, res, next) {
    try {
        const data = await favoriteService.addFavoriteRestaurant(
            me(req),
            req.params.restaurantId
        );
        return sendResponse(res, 200, 'Restaurant added to favorites', data);
    } catch (err) {
        next(err);
    }
}

export async function removeFavoriteRestaurantController(req, res, next) {
    try {
        const data = await favoriteService.removeFavoriteRestaurant(
            me(req),
            req.params.restaurantId
        );
        return sendResponse(res, 200, 'Restaurant removed from favorites', data);
    } catch (err) {
        next(err);
    }
}

export async function addFavoriteFoodController(req, res, next) {
    try {
        const data = await favoriteService.addFavoriteFood(me(req), req.params.foodId);
        return sendResponse(res, 200, 'Dish added to favorites', data);
    } catch (err) {
        next(err);
    }
}

export async function removeFavoriteFoodController(req, res, next) {
    try {
        const data = await favoriteService.removeFavoriteFood(me(req), req.params.foodId);
        return sendResponse(res, 200, 'Dish removed from favorites', data);
    } catch (err) {
        next(err);
    }
}
