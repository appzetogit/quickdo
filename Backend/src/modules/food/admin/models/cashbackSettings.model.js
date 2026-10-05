import mongoose from 'mongoose';

/**
 * Admin-configured cashback rules. Cashback is awarded once per order, when the order is
 * delivered, and is credited to the customer's wallet as a normal 'addition' transaction
 * with metadata.source = 'cashback' (no separate ledger — the wallet IS the ledger).
 */
const cashbackSettingsSchema = new mongoose.Schema(
    {
        isEnabled: { type: Boolean, default: false },
        /** 'percentage' -> percent of item subtotal; 'flat' -> fixed rupees */
        cashbackType: { type: String, enum: ['percentage', 'flat'], default: 'percentage' },
        /** percent (when percentage) or rupees (when flat) */
        cashbackValue: { type: Number, min: 0, default: 0 },
        /** Order subtotal must be at least this to qualify. */
        minOrderValue: { type: Number, min: 0, default: 0 },
        /** Upper bound in rupees for a percentage award. 0 = uncapped. */
        maxCashback: { type: Number, min: 0, default: 0 },
        /** Only the customer's first ever delivered order qualifies. */
        firstOrderOnly: { type: Boolean, default: false },
        /** Max awards per customer overall. 0 = unlimited. */
        perUserLimit: { type: Number, min: 0, default: 0 },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_cashback_settings', timestamps: true }
);

cashbackSettingsSchema.index({ isActive: 1, createdAt: -1 });

export const FoodCashbackSettings = mongoose.models.FoodCashbackSettings || mongoose.model('FoodCashbackSettings', cashbackSettingsSchema, 'food_cashback_settings');
