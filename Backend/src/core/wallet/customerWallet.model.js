import mongoose from 'mongoose';

/**
 * A customer's wallet. One per person, whichever app they use it from.
 *
 * Food kept its balance in `food_user_wallets` and taxi in `taxiuserwallets`,
 * both keyed by the same `users._id` -- food and taxi customers are already the
 * same documents. So a customer who topped up while booking a ride saw Rs 0 when
 * they went to order food, and a refund credited on one side was invisible on
 * the other. This model is the one both now read and write.
 *
 * ONE SCHEMA, deliberately. Two schemas over one collection is the hazard the
 * shared `users` collection already carries: a `.save()` through either drops
 * the fields only the other declares. Taxi's admin adjustment does load, mutate,
 * save -- so with two schemas it would have stripped food's `referralEarnings`,
 * and food would have stripped taxi's `refundWallet`. Every vertical imports
 * THIS model instead, so every field is known to every write.
 *
 * The fields are the union of both, kept additive: nothing either side relied
 * on is renamed or removed.
 */

const walletTransactionSchema = new mongoose.Schema(
    {
        /*
         * The two verticals name the direction differently -- food `type`
         * (addition / deduction / refund), taxi `kind` (credit / debit) -- and
         * each screen reads its own. Neither can be REQUIRED here, because a row
         * written by one side never carries the other's field; the hook below
         * fills whichever is missing so every row answers both.
         */
        type: { type: String, enum: ['addition', 'deduction', 'refund'] },
        kind: { type: String, enum: ['credit', 'debit'] },

        // Always positive in both verticals: the direction is `type` / `kind`,
        // and the balance moves by the signed `$inc` the service applies.
        amount: { type: Number, required: true, min: 0 },
        status: { type: String, default: 'Completed' },

        // Food's wording, and taxi's.
        description: { type: String, default: '' },
        title: { type: String, default: '', trim: true },
        metadata: { type: Object, default: {} },

        // Food's Razorpay references.
        razorpayOrderId: { type: String, default: null },
        razorpayPaymentId: { type: String, default: null },
        razorpaySignature: { type: String, default: null },

        // Taxi's: a transfer's other party, the payment provider's references,
        // and `referenceKey`, which is how taxi refuses to apply one credit twice.
        counterpartyPhone: { type: String, default: '', trim: true },
        provider: { type: String, default: '', trim: true },
        providerOrderId: { type: String, default: '', trim: true },
        providerPaymentId: { type: String, default: '', trim: true },
        referenceKey: { type: String, default: '', trim: true },
    },
    { _id: true, timestamps: true },
);

const KIND_OF_TYPE = { addition: 'credit', refund: 'credit', deduction: 'debit' };
const TYPE_OF_KIND = { credit: 'addition', debit: 'deduction' };

/*
 * Fill the direction the writer did not set, so food's screen and taxi's screen
 * can both read every row. Runs on `.save()` and document creation. Atomic
 * `$push` updates skip it -- which is why the services also set both fields
 * when they push (see withBothDirections below).
 */
walletTransactionSchema.pre('validate', function fillDirection(next) {
    if (!this.kind && this.type) this.kind = KIND_OF_TYPE[this.type];
    if (!this.type && this.kind) this.type = TYPE_OF_KIND[this.kind];
    next();
});

/**
 * A transaction row with BOTH direction fields set.
 *
 * `$push` in an update does not run subdocument hooks, so a row pushed
 * atomically would otherwise carry only the field its writer knew. Services
 * wrap the row they push in this.
 */
export const withBothDirections = (tx = {}) => {
    const out = { ...tx };
    if (!out.kind && out.type) out.kind = KIND_OF_TYPE[out.type];
    if (!out.type && out.kind) out.type = TYPE_OF_KIND[out.kind];
    return out;
};

const customerWalletSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
        balance: { type: Number, default: 0, min: 0, index: true },
        /*
         * Taxi's refund balance: money returned from a ride, kept apart from
         * money the customer topped up. Kept as its own figure rather than
         * folded into `balance`, because merging them changes what a customer
         * can spend it on -- a product decision, not a storage one.
         */
        refundWallet: { type: Number, default: 0, min: 0 },
        referralEarnings: { type: Number, default: 0 },
        transactions: { type: [walletTransactionSchema], default: [] },
    },
    { collection: 'food_user_wallets', timestamps: true },
);

/*
 * Every atomic write, from either vertical, gets both direction fields.
 *
 * Both sides push transaction rows with `$push` inside `updateOne` /
 * `findOneAndUpdate` -- food through applyWalletMove, taxi in several places --
 * and a `$push` never runs the subdocument hook above. Normalising here, once,
 * is what keeps a taxi row readable on the food screen and the reverse, without
 * relying on every current and future call site to remember.
 */
function normalisePushedTransactions() {
    const update = this.getUpdate?.();
    const push = update?.$push?.transactions;
    if (!push) return;
    if (Array.isArray(push.$each)) {
        push.$each = push.$each.map(withBothDirections);
    } else if (typeof push === 'object') {
        update.$push.transactions = withBothDirections(push);
    }
}
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate']) {
    customerWalletSchema.pre(op, normalisePushedTransactions);
}

export const CustomerWallet =
    mongoose.models.CustomerWallet || mongoose.model('CustomerWallet', customerWalletSchema);

export const __testables = { KIND_OF_TYPE, TYPE_OF_KIND };
