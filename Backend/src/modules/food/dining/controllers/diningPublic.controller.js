import * as diningService from '../services/dining.service.js';


export async function getPublicDiningRestaurants(req, res, next) {
    try {
        const restaurants = await diningService.listDiningRestaurantsPublic(req.query || {});
        res.status(200).json({ success: true, message: 'Dining restaurants fetched successfully', data: restaurants });
    } catch (error) {
        next(error);
    }
}
