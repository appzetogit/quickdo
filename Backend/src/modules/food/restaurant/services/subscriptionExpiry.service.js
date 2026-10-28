import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodNotification } from '../../../../core/notifications/models/notification.model.js';
import { notifyOwnerSafely, notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';

/**
 * Service to handle subscription renewals and debt accumulation.
 * This should be called by a daily cron job.
 */
export const processSubscriptionExpiries = async () => {
    const now = new Date();
    
    // Find all restaurants whose subscription has expired
    const expiredRestaurants = await FoodRestaurant.find({
        status: 'approved',
        subscriptionValidTill: { $lt: now }
    });

    console.log(`[SUBSCRIPTION] Found ${expiredRestaurants.length} expired subscriptions to process.`);

    const results = {
        processed: 0,
        errors: 0
    };

    const GST_RATE = 0.18;

    for (const restaurant of expiredRestaurants) {
        try {
            // 1. Calculate the renewal amount (Debt Accumulation)
            let planBase = 0;
            const plan = String(restaurant.subscriptionPlan || '');
            
            if (plan === 'elite' || plan === '4999') {
                planBase = 4999;
            } else if (plan === 'pro' || plan === '9999') {
                planBase = 9999;
            } else {
                // Fallback to existing subscriptionAmount if plan name is missing/custom
                planBase = Math.round((restaurant.subscriptionAmount || 0) / (1 + GST_RATE));
            }

            const planGST = Math.round(planBase * GST_RATE);
            const renewalTotal = planBase + planGST;

            // 2. Update the restaurant record
            // Add new month's fee to the due amount
            const oldDue = Number(restaurant.subscriptionDueAmount || 0);
            const newDue = oldDue + renewalTotal;
            
            // Set new expiry for next month
            const currentExpiry = new Date(restaurant.subscriptionValidTill || now);
            const nextExpiry = new Date(currentExpiry);
            nextExpiry.setMonth(nextExpiry.getMonth() + 1);

            restaurant.subscriptionDueAmount = newDue;
            restaurant.subscriptionAmount = (restaurant.subscriptionAmount || 0) + renewalTotal;
            restaurant.subscriptionValidTill = nextExpiry;
            restaurant.subscriptionStatus = 'due';

            await restaurant.save();

            // 3. Notify the owner
            const message = `Your subscription for "${restaurant.restaurantName}" has been renewed. An amount of ₹${renewalTotal} has been added to your dues. Total due: ₹${newDue}.`;
            
            await FoodNotification.create({
                ownerType: 'RESTAURANT',
                ownerId: restaurant._id,
                title: 'Subscription Renewed',
                message,
                category: 'billing',
                source: 'SUBSCRIPTION_RENEWAL'
            });

            await notifyOwnerSafely(
                { ownerType: 'RESTAURANT', ownerId: restaurant._id },
                {
                    title: 'Subscription Renewed 💳',
                    body: message,
                    data: {
                        type: 'subscription_renewed',
                        restaurantId: String(restaurant._id),
                        newDueAmount: String(newDue)
                    }
                }
            );

            results.processed++;
        } catch (err) {
            console.error(`[SUBSCRIPTION] Error processing restaurant ${restaurant._id}:`, err);
            results.errors++;
        }
    }

    return results;
};
