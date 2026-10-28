import { getUserActivity, getUserSpend, ACTIVITY_STATUS } from './activity.service.js';
import { resolveCustomerIdentities } from './identityResolver.js';
import { Activity } from './activity.model.js';

/**
 * GET /api/v1/me/activity — the customer's history across every vertical.
 *
 * Query: ?status=pending|active|completed|cancelled
 *        ?vertical=food|quickCommerce|taxi|serviceProvider
 *        ?limit=20&skip=0
 *
 * The caller is identified by their token, then resolved to the id they carry in each
 * vertical (see identityResolver) -- querying the token id alone would silently omit
 * service-provider and quick-commerce, which key on their own user documents.
 */
export const getMyActivityController = async (req, res, next) => {
    try {
        const masterUserId = req.user?.userId || req.user?.id || req.auth?.sub;
        if (!masterUserId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const { status, vertical } = req.query;
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const skip = Math.max(Number(req.query.skip) || 0, 0);

        if (status && !Object.values(ACTIVITY_STATUS).includes(status)) {
            return res.status(400).json({
                success: false,
                message: `status must be one of: ${Object.values(ACTIVITY_STATUS).join(', ')}`,
            });
        }

        const { ids, resolved } = await resolveCustomerIdentities(masterUserId);

        const query = { userId: { $in: ids } };
        if (status) query.status = status;
        if (vertical) query.vertical = vertical;

        const [items, total] = await Promise.all([
            Activity.find(query).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
            Activity.countDocuments(query),
        ]);

        return res.status(200).json({
            success: true,
            message: 'Activity fetched',
            data: {
                items: items.map((a) => ({
                    id: a._id,
                    vertical: a.vertical,
                    status: a.status,
                    rawStatus: a.rawStatus,
                    amount: a.amount,
                    currency: a.currency,
                    title: a.title,
                    occurredAt: a.occurredAt,
                    ref: { model: a.refModel, id: a.refId },
                })),
                total,
                limit,
                skip,
                // Which verticals this customer could be resolved in. A vertical missing
                // here means no linked account was found, not that they have no history.
                resolvedVerticals: resolved,
            },
        });
    } catch (error) {
        next(error);
    }
};

/** GET /api/v1/me/spend — what this customer has spent, per vertical and in total. */
export const getMySpendController = async (req, res, next) => {
    try {
        const masterUserId = req.user?.userId || req.user?.id || req.auth?.sub;
        if (!masterUserId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const { ids } = await resolveCustomerIdentities(masterUserId);
        const rows = await Activity.aggregate([
            { $match: { userId: { $in: ids }, status: ACTIVITY_STATUS.COMPLETED } },
            { $group: { _id: '$vertical', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
            { $sort: { amount: -1 } },
        ]);

        return res.status(200).json({
            success: true,
            message: 'Spend fetched',
            data: {
                byVertical: rows.map((r) => ({ vertical: r._id, amount: r.amount, count: r.count })),
                total: rows.reduce((a, r) => a + r.amount, 0),
                count: rows.reduce((a, r) => a + r.count, 0),
            },
        });
    } catch (error) {
        next(error);
    }
};

export { getUserActivity, getUserSpend };
