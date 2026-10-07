import { FoodGourmetRestaurant } from '../models/gourmetRestaurant.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import mongoose from 'mongoose';
import { QUICK_SHOP_SELLER_FILTER } from '../../shared/storeType.js';

export const getPublicGourmetRestaurants = async (zoneId) => {
    const docs = await FoodGourmetRestaurant.find({ isActive: true })
        .sort({ priority: 1, createdAt: -1 })
        .lean();

    const restaurantIds = docs.map((d) => d.restaurantId);
    
    // Legacy pharmacies are not public, so not among Quick Shop's picks.
    const query = { _id: { $in: restaurantIds }, status: 'approved', ...QUICK_SHOP_SELLER_FILTER };
    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
        query.zoneId = new mongoose.Types.ObjectId(zoneId);
    }

    const restaurants = await FoodRestaurant.find(query)
        .select('restaurantName area city profileImage rating cuisines slug pureVegRestaurant location estimatedDeliveryTime zoneId')
        .lean();

    const restaurantMap = new Map(restaurants.map((r) => [r._id.toString(), r]));

    return docs.map((item) => {
        const r = restaurantMap.get(item.restaurantId.toString());
        return {
            ...item,
            restaurant: r ? {
                _id: r._id,
                name: r.restaurantName,
                restaurantName: r.restaurantName,
                rating: r.rating || 0,
                profileImage: r.profileImage ? { url: r.profileImage } : null,
                area: r.area,
                city: r.city,
                cuisines: r.cuisines || [],
                slug: r.slug,
                pureVegRestaurant: r.pureVegRestaurant,
                location: r.location,
                estimatedDeliveryTime: r.estimatedDeliveryTime,
                zoneId: r.zoneId
            } : null
        };
    });
};

