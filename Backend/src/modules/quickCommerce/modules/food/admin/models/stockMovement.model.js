import mongoose from 'mongoose';

/**
 * Every change to a quick-commerce stock count: a sale, a cancel, a return, a
 * seller's or admin's edit. Answers "where did my 20 units go" without anyone
 * reading order logs. Written best-effort after the count itself has changed,
 * so a failed write here never blocks an order.
 */
const stockMovementSchema = new mongoose.Schema(
    {
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCRestaurant', index: true },
        itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'QCItem', required: true },
        variantId: { type: String, default: '' },
        itemName: { type: String, default: '' },
        variantName: { type: String, default: '' },
        delta: { type: Number, required: true },
        after: { type: Number, default: null },
        reason: {
            type: String,
            enum: ['sale', 'cancel', 'return', 'manual', 'bulk', 'import', 'tracking'],
            required: true,
        },
        orderId: { type: mongoose.Schema.Types.ObjectId, default: null },
        note: { type: String, default: '' },
        actor: {
            role: { type: String, default: 'system' },
            id: { type: String, default: '' },
            name: { type: String, default: '' },
        },
    },
    { collection: 'qc_stock_movements', timestamps: { createdAt: true, updatedAt: false } },
);

stockMovementSchema.index({ itemId: 1, variantId: 1, createdAt: -1 });
stockMovementSchema.index({ restaurantId: 1, createdAt: -1 });

export const QCStockMovement = mongoose.models.QCStockMovement
    || mongoose.model('QCStockMovement', stockMovementSchema);
