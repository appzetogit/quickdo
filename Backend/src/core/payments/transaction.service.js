import mongoose from 'mongoose';
import { Transaction } from './models/transaction.model.js';
import { FoodUserWallet } from '../../modules/food/user/models/userWallet.model.js';
import { FoodRestaurantWallet } from '../../modules/food/restaurant/models/restaurantWallet.model.js';
import { FoodDeliveryWallet } from '../../modules/food/delivery/models/deliveryWallet.model.js';
import { FoodAdminWallet } from '../../modules/food/admin/models/adminWallet.model.js';
import { logger } from '../../utils/logger.js';

/**
 * Resolve the wallet model + id-field for a given entity.
 * Returns { Model, filter } so callers can findOne/updateOne generically.
 */
function resolveWallet(entityType, entityId) {
    switch (entityType) {
        case 'user': {
            const id = new mongoose.Types.ObjectId(entityId);
            return { Model: FoodUserWallet, filter: { userId: id }, idField: 'userId' };
        }
        case 'restaurant': {
            const id = new mongoose.Types.ObjectId(entityId);
            return { Model: FoodRestaurantWallet, filter: { restaurantId: id }, idField: 'restaurantId' };
        }
        case 'deliveryBoy': {
            const id = new mongoose.Types.ObjectId(entityId);
            return { Model: FoodDeliveryWallet, filter: { deliveryPartnerId: id }, idField: 'deliveryPartnerId' };
        }
        case 'admin':
            return { Model: FoodAdminWallet, filter: { key: 'platform' }, idField: 'key' };
        default:
            throw new Error(`Unknown entityType: ${entityType}`);
    }
}

/** Fixed ObjectId for admin entity used in Transaction documents (singleton) */
const ADMIN_ENTITY_OID = new mongoose.Types.ObjectId('000000000000000000000001');

/**
 * Ensure wallet exists, creating it if needed. Returns the wallet document.
 */
export async function ensureWallet(entityType, entityId) {
    const { Model, filter, idField } = resolveWallet(entityType, entityId);
    let wallet = await Model.findOne(filter);
    if (!wallet) {
        const createPayload = { ...filter, balance: 0 };
        wallet = await Model.create(createPayload);
    }
    return wallet;
}

/**
 * Get balance for an entity wallet.
 */
export async function getBalance(entityType, entityId) {
    const wallet = await ensureWallet(entityType, entityId);
    return {
        balance: Number(wallet.balance) || 0,
        lockedAmount: Number(wallet.lockedAmount) || 0,
        availableBalance: (Number(wallet.balance) || 0) - (Number(wallet.lockedAmount) || 0)
    };
}

/** Mongo marks write conflicts inside a transaction as retryable. */
const isTransientTxnError = (err) =>
    Boolean(err?.hasErrorLabel?.('TransientTransactionError'))
    || err?.code === 112 // WriteConflict
    || /write conflict/i.test(String(err?.message || ''));

const MAX_TXN_ATTEMPTS = 3;

/**
 * CORE ATOMIC OPERATION: Record a transaction AND update wallet balance
 * in a single MongoDB transaction. This is the ONLY way to change wallet balances.
 *
 * @param {Object} payload
 * @param {string} payload.entityType - 'user' | 'restaurant' | 'deliveryBoy' | 'admin'
 * @param {string} payload.entityId - ObjectId of the entity
 * @param {string} payload.type - 'credit' | 'debit'
 * @param {number} payload.amount - positive amount
 * @param {string} payload.description - human readable
 * @param {string} [payload.category] - transaction category
 * @param {string} [payload.orderId] - linked order
 * @param {string} [payload.paymentId] - linked payment
 * @param {Object} [payload.metadata] - extra data
 * @param {string} [payload.idempotencyKey] - names the movement (core/finance/idempotencyKeys.js).
 *        A second call with the same key returns the first row with `duplicate: true`
 *        and moves no money. This is what makes a retry safe (P0-4).
 * @returns {Object} { transaction, wallet, duplicate? }
 */
export async function recordTransaction(payload) {
    const { type, amount } = payload;
    if (!['credit', 'debit'].includes(type)) throw new Error('type must be credit or debit');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');

    /*
     * A write conflict used to abort the transaction and surface as an error, which
     * every caller in payment.processor.js caught and logged -- a lost credit (P0-3).
     * Mongo labels these as transient: running the whole transaction again is the
     * documented fix, and with an idempotency key it is safe even if the first
     * attempt's commit actually landed.
     */
    let lastErr;
    for (let attempt = 1; attempt <= MAX_TXN_ATTEMPTS; attempt += 1) {
        try {
            return await recordTransactionOnce(payload);
        } catch (err) {
            lastErr = err;
            if (!isTransientTxnError(err) || attempt === MAX_TXN_ATTEMPTS) break;
            logger.warn(`recordTransaction: transient conflict, retrying (${attempt}/${MAX_TXN_ATTEMPTS}): ${err.message}`);
        }
    }
    logger.error(`recordTransaction failed: ${lastErr?.message}`);
    throw lastErr;
}

const findByKey = async (idempotencyKey) =>
    (idempotencyKey ? Transaction.findOne({ idempotencyKey }).lean() : null);

async function recordTransactionOnce(payload) {
    const {
        entityType, entityId, type, amount,
        description = '', category = 'other',
        orderId = null, paymentId = null,
        metadata = undefined, module = 'food'
    } = payload;
    const idempotencyKey = payload.idempotencyKey ? String(payload.idempotencyKey).trim() : '';

    // Fast path for a retry: the movement already happened, report it.
    const prior = await findByKey(idempotencyKey);
    if (prior) {
        return { transaction: prior, wallet: { balance: prior.balanceAfter }, duplicate: true };
    }

    const { Model, filter } = resolveWallet(entityType, entityId);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Ensure wallet exists
        let wallet = await Model.findOne(filter).session(session);
        if (!wallet) {
            [wallet] = await Model.create([{ ...filter, balance: 0 }], { session });
        }

        // 2. Compute new balance
        const currentBalance = Number(wallet.balance) || 0;
        const newBalance = type === 'credit'
            ? currentBalance + amount
            : currentBalance - amount;

        // Debit guard: prevent negative balance (except admin wallet which can go negative)
        if (type === 'debit' && entityType !== 'admin' && newBalance < 0) {
            throw new Error(`Insufficient balance. Current: ${currentBalance}, Debit: ${amount}`);
        }

        // 3. Create transaction row. The unique index on idempotencyKey is the real
        // guard: two concurrent first attempts both pass the fast path above, and the
        // loser's insert fails here, rolling its balance change back with it.
        const entityOid = entityType === 'admin'
            ? ADMIN_ENTITY_OID
            : new mongoose.Types.ObjectId(entityId);

        const [txn] = await Transaction.create([{
            paymentId: paymentId ? new mongoose.Types.ObjectId(paymentId) : null,
            orderId: orderId ? new mongoose.Types.ObjectId(orderId) : null,
            entityType,
            entityId: entityOid,
            type,
            amount,
            balanceAfter: newBalance,
            currency: 'INR',
            status: 'completed',
            description,
            category,
            module,
            metadata,
            ...(idempotencyKey ? { idempotencyKey } : {})
        }], { session });

        // 4. Update wallet balance atomically
        if (type === 'credit') {
            if (entityType === 'restaurant' || entityType === 'deliveryBoy') {
                await Model.updateOne(filter, {
                    $set: { balance: newBalance },
                    $inc: { totalEarnings: amount }
                }, { session });
            } else if (entityType === 'admin') {
                await Model.updateOne(filter, {
                    $set: { balance: newBalance },
                    $inc: { totalRevenue: amount }
                }, { session });
            } else {
                await Model.updateOne(filter, { $set: { balance: newBalance } }, { session });
            }
        } else {
            await Model.updateOne(filter, { $set: { balance: newBalance } }, { session });
        }

        await session.commitTransaction();

        logger.info(`Transaction recorded: ${type} ${amount} INR for ${entityType}:${entityId} → balance ${newBalance}`);

        return {
            transaction: txn.toObject(),
            wallet: { balance: newBalance }
        };
    } catch (err) {
        await session.abortTransaction().catch(() => {});
        if (err?.code === 11000 && idempotencyKey) {
            const winner = await findByKey(idempotencyKey);
            if (winner) {
                return { transaction: winner, wallet: { balance: winner.balanceAfter }, duplicate: true };
            }
        }
        throw err;
    } finally {
        session.endSession();
    }
}
/**
 * List transactions for an entity with pagination.
 */
export async function getTransactionsByEntity(entityType, entityId, { page = 1, limit = 20 } = {}) {
    const skip = (Math.max(1, page) - 1) * limit;
    const entityOid = entityType === 'admin'
        ? ADMIN_ENTITY_OID
        : new mongoose.Types.ObjectId(entityId);
    const filter = {
        entityType,
        entityId: entityOid
    };

    const [docs, total] = await Promise.all([
        Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Transaction.countDocuments(filter)
    ]);

    return {
        transactions: docs,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
    };
}

/**
 * Get transactions for a specific order across all entities.
 */
export async function getTransactionsByOrder(orderId) {
    return Transaction.find({ orderId: new mongoose.Types.ObjectId(orderId) })
        .sort({ createdAt: -1 })
        .lean();
}
