import mongoose from 'mongoose';
import { notificationSchema } from '../../../../../core/notifications/models/notification.model.js';

/**
 * Quick-commerce notifications now live in the shared `food_notifications` collection.
 *
 * This file used to hold a near-identical fork of the core schema writing to
 * `qc_notifications`. The two had drifted only in the `source` enum, which core has
 * since absorbed.
 *
 * It is a second model over the SAME schema and the SAME collection rather than a
 * plain re-export, for one reason: the seven call sites in this module create
 * notifications without naming a vertical, so a re-export would silently label every
 * quick-commerce notification 'food' (the core default). Cloning lets the default
 * carry the vertical instead of editing all seven -- and, more to the point, instead
 * of relying on nobody forgetting it at the eighth.
 */
const qcNotificationSchema = notificationSchema.clone();
qcNotificationSchema.path('vertical').default('quickCommerce');

// Exported under the food name because this module is a fork of the food codebase and
// every importer here already says `FoodNotification`.
export const FoodNotification =
    mongoose.models.QCNotification ||
    mongoose.model('QCNotification', qcNotificationSchema, 'food_notifications');
