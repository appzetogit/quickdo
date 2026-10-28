import mongoose from 'mongoose';
import { SCOPE_LEVELS } from './scope.js';

/**
 * One row per (level, scope, key). The collection that replaces about
 * twenty-four settings models.
 *
 * `FoodFeeSettings`, its quick-commerce fork, `deliveryCashLimit`,
 * `businessSettings`, `cashbackSettings`, `referralSettings`, taxi's
 * `AdminBusinessSetting` and `AdminAppSetting`, SP's `Settings` -- most of them
 * singleton documents holding a bag of unrelated values, each one duplicated per
 * vertical. Changing a platform-wide rule means finding and editing all of them,
 * and nothing stops them disagreeing.
 *
 * A generic key/value store is normally the wrong answer, because it throws away
 * the schema. It is the right answer HERE for one reason: the thing being modelled
 * is not the values, it is the OVERRIDE RELATIONSHIP between them. A typed
 * document per vertical cannot express "2000 everywhere, 2500 for taxi, 1500 for
 * this driver" no matter how well it is designed. Validation moves to the
 * registry, where each key declares its own type and bounds.
 *
 * Values are typed as Mixed deliberately: a cash limit is a number, an operating
 * window is an object, a feature switch is a boolean. The registry is what stops
 * that becoming a free-for-all.
 */
const settingSchema = new mongoose.Schema(
    {
        /** Which layer this row belongs to. Precedence lives in scope.js. */
        level: { type: String, enum: SCOPE_LEVELS, required: true },
        /**
         * What it is scoped TO: a partner id, a zone id, a vertical name, or '*'
         * for global. A string so all four are expressible in one field.
         */
        scopeId: { type: String, required: true, default: '*' },

        key: { type: String, required: true },
        value: { type: mongoose.Schema.Types.Mixed },

        /**
         * Who changed it and why. A configuration change can stop an entire city's
         * riders earning, so it is exactly as auditable as a wallet adjustment.
         */
        updatedBy: { type: String, default: '' },
        reason: { type: String, default: '' },
    },
    { collection: 'platform_settings', timestamps: true },
);

/*
 * One value per key per scope. Without this, two admins saving the same screen
 * produce two rows and the winner is whichever the query happens to return
 * first -- a setting that changes on refresh.
 */
settingSchema.index({ level: 1, scopeId: 1, key: 1 }, { unique: true });
settingSchema.index({ key: 1 });

export const PlatformSetting =
    mongoose.models.PlatformSetting || mongoose.model('PlatformSetting', settingSchema);
