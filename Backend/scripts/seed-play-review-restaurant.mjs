/**
 * An approved restaurant for Play Store / App Store review, on a fixed-OTP
 * test number, with a small approved menu so the reviewer lands on a working
 * dashboard.
 *
 *   Login: 7470311227   OTP: 1234   (DUMMY_OTP_PHONES in core/otp/otp.service.js)
 *
 * Location, zone, hours and delivery settings are copied from an existing
 * approved Indore restaurant, so it behaves like a real one. Safe to re-run:
 * if the restaurant already exists it is only reported, never duplicated.
 *
 *   node scripts/seed-play-review-restaurant.mjs            # dry run
 *   node scripts/seed-play-review-restaurant.mjs --apply
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const PHONE = '7470311227';
const NAME = 'Quick Drop Test Kitchen';
const TEMPLATE_NAME = 'Spice Garden Restaurant';
const apply = process.argv.includes('--apply');

const DISHES = [
    { name: 'Paneer Butter Masala', price: 220, foodType: 'Veg', description: 'Cottage cheese in a rich tomato and butter gravy' },
    { name: 'Veg Biryani', price: 180, foodType: 'Veg', description: 'Fragrant basmati rice with mixed vegetables' },
    { name: 'Masala Dosa', price: 120, foodType: 'Veg', description: 'Crisp rice crepe with spiced potato filling' },
    { name: 'Chicken Curry', price: 260, foodType: 'Non-Veg', description: 'Home-style chicken in onion tomato gravy' },
];

await mongoose.connect(process.env.MONGODB_URI);
try {
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { FoodCategory } = await import('../src/modules/food/admin/models/category.model.js');
    const { FoodItem } = await import('../src/modules/food/admin/models/food.model.js');

    const existing = await FoodRestaurant.findOne({ ownerPhoneLast10: PHONE }).lean();
    if (existing) {
        const dishes = await FoodItem.countDocuments({ restaurantId: existing._id, approvalStatus: 'approved' });
        console.log(`exists: ${existing.restaurantName} (${existing._id}) status=${existing.status}, ${dishes} approved dishes`);
    } else {
        const t = await FoodRestaurant.findOne({ restaurantName: TEMPLATE_NAME, status: 'approved' }).lean();
        if (!t) throw new Error(`template restaurant "${TEMPLATE_NAME}" not found`);
        const copy = (keys) => Object.fromEntries(keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
        const doc = {
            ...copy(['addressLine1', 'area', 'city', 'state', 'pincode', 'cuisines', 'openingTime', 'closingTime',
                'openDays', 'location', 'zoneId', 'estimatedDeliveryTime', 'estimatedDeliveryTimeMinutes',
                'diningSettings', 'priceIncludesGst', 'serviceRadiusKm', 'menuImages', 'coverImages', 'coverImage']),
            restaurantName: NAME,
            ownerName: 'Store Review',
            ownerEmail: 'review@quickdropsindia.com',
            ownerPhone: PHONE,
            primaryContactNumber: PHONE,
            pureVegRestaurant: false,
            gstRegistered: false,
            isAcceptingOrders: true,
            status: 'approved',
            approvedAt: new Date(),
        };
        if (!apply) {
            console.log(`would create ${NAME} on ${PHONE} in zone ${t.zoneId} with ${DISHES.length} approved dishes`);
        } else {
            const r = await FoodRestaurant.create(doc);
            const cat = await FoodCategory.create({
                name: 'Popular', restaurantId: r._id, createdByRestaurantId: r._id, zoneId: r.zoneId,
                foodTypeScope: 'Both', approvalStatus: 'approved', isApproved: true, isActive: true,
            });
            for (const d of DISHES) {
                await FoodItem.create({
                    ...d, basePrice: d.price, restaurantId: r._id, categoryId: cat._id, categoryName: cat.name,
                    preparationTime: '20-25 mins', isAvailable: true, isActive: true,
                    approvalStatus: 'approved', approvedAt: new Date(),
                });
            }
            console.log(`created ${NAME} (${r._id}) on ${PHONE}: status=approved, ${DISHES.length} approved dishes`);
        }
    }
} finally {
    await mongoose.disconnect();
}
