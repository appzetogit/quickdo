import mongoose from 'mongoose';
import { FoodItem } from '../models/food.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodPriceAdjustment } from '../models/priceAdjustment.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { invalidatePriceCaches } from '../../../../middleware/cache.js';
import { FoodPriceAdjustmentSnapshot } from '../models/priceAdjustmentSnapshot.model.js';
import {
    computeFormulationPrice,
    normalizeFormulationPercent,
    resolveFormulationPricing,
} from '../../shared/formulationPricing.js';

/**
 * A single adjustment may not wipe out more than 90% of a price or more than
 * quadruple it. A typo of "1000" instead of "10" would otherwise be a
 * catastrophic, item-by-item-to-undo mistake.
 */
const MIN_PERCENT = -90;
const MAX_PERCENT = 300;

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Prices below this are treated as unset and left alone. */
const MIN_RESULT_PRICE = 0.01;

/**
 * authMiddleware puts the admin on the request as { userId, role } -- there is no
 * _id, no id and no name. Reading actor._id meant every adjustment recorded a null
 * author, so the one audit trail for a change that rewrites every price on the
 * platform was always blank. The name is not on the token, so it is looked up.
 */
const resolveActor = async (actor = {}) => {
    const id = actor?.userId || actor?._id || actor?.id || null;
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        return { appliedBy: null, appliedByName: '' };
    }
    const { FoodAdmin } = await import('../../../../core/admin/admin.model.js');
    const admin = await FoodAdmin.findById(id).select('name email').lean();
    return {
        appliedBy: id,
        appliedByName: admin?.name || admin?.email || ''
    };
};

const buildFilter = (restaurantId) => {
    /*
     * Combos are left out. A combo is already a deal -- its price sits under
     * what its dishes cost separately, and that parts total is the figure it
     * strikes through. A run moved it like any dish: a decrease replaced the
     * parts-total strike with the combo's own pre-cut price, and an increase
     * struck a number unrelated to what the dishes cost.
     */
    const filter = { isCombo: { $ne: true } };
    if (restaurantId) filter.restaurantId = new mongoose.Types.ObjectId(String(restaurantId));
    return filter;
};

/**
 * What a dish with no comparison figure of its own is currently showing.
 *
 * resolveItemOtherPlatformPrice falls back to the blanket markup for those
 * dishes, so the number on screen is price x (1 + markup), not price. An
 * adjustment has to move THAT, or the first run at a restaurant where no dish
 * carries a figure yet moves the comparison somewhere the customer never was.
 *
 * 1 when the markup is off, which makes the seed the selling price -- the
 * previous behaviour, and still correct when no fallback is in play.
 */
const resolveComparisonSeedMultiplier = async () => {
    const { FoodFeeSettings } = await import('../models/feeSettings.model.js');
    const { normalizeOtherPlatformSettings } = await import('../../shared/otherPlatformPricing.js');
    const feeDoc = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    const { isEnabled, markupPercent } = normalizeOtherPlatformSettings(feeDoc || {});
    if (!isEnabled || !(markupPercent > 0)) return 1;
    return 1 + markupPercent / 100;
};

/**
 * The figure a run starts from: the dish's own stored comparison, or the
 * markup-derived one it is currently displaying. Shared by the preview and the
 * write so the two cannot drift -- the preview existing at all is because a run
 * that silently did nothing was indistinguishable from one that worked.
 */
const comparisonSeedExpr = (seedMultiplier) => ({
    $cond: [
        { $gt: [{ $ifNull: ['$otherPrice', 0] }, 0] },
        '$otherPrice',
        { $multiply: ['$price', seedMultiplier] },
    ],
});

const resolveRestaurant = async (restaurantId) => {
    if (!restaurantId) return { restaurantId: null, restaurantName: 'All restaurants' };
    if (!mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant');
    }
    const restaurant = await FoodRestaurant.findById(restaurantId).select('restaurantName').lean();
    if (!restaurant?._id) throw new ValidationError('Restaurant not found');
    return {
        restaurantId: restaurant._id,
        restaurantName: restaurant.restaurantName || 'Unnamed restaurant'
    };
};

/**
 * Multiplies `price` and every variant price by `factor` in one pass.
 *
 * `$max` against MIN_RESULT_PRICE keeps a steep cut from writing a zero or
 * negative price, which the FoodItem schema would reject on the next save and
 * which checkout would happily charge as ₹0.
 */
/**
 * Scale a menu, keeping base price and discount coherent.
 *
 * `price` is derived (basePrice less discountPercent), so scaling price alone
 * would leave the two disagreeing -- the item would advertise "20% off 50" while
 * charging something that is not 40. The base is scaled and the selling price
 * re-derived from it, in two stages: a later stage in an aggregation-pipeline
 * update sees what an earlier one wrote.
 *
 * Clamping stays on the base rather than the selling price. Since the selling
 * price is at most the base, holding the base at the MRP keeps the whole item
 * under it, and does so without breaking the invariant the way clamping only
 * the derived price would.
 *
 * Rows predating basePrice have null there; $multiply on null yields null, which
 * readers already treat as "base equals price", so they scale on price alone and
 * stay correct.
 */
const applyFactorToMenu = async (filter, factor) => {
    const clampToMrp = (scaledExpr) => ({
        $cond: [
            { $gt: [{ $ifNull: ['$mrp', 0] }, 0] },
            { $min: [scaledExpr, '$mrp'] },
            scaledExpr
        ]
    });
    const scaled = (expr) => ({ $max: [MIN_RESULT_PRICE, { $round: [{ $multiply: [expr, factor] }, 2] }] });

    const result = await FoodItem.updateMany(filter, [
        {
            $set: {
                basePrice: {
                    $cond: [
                        { $gt: [{ $ifNull: ['$basePrice', 0] }, 0] },
                        clampToMrp(scaled('$basePrice')),
                        null
                    ]
                },
                price: clampToMrp(scaled('$price')),
                variants: {
                    $map: {
                        input: { $ifNull: ['$variants', []] },
                        as: 'variant',
                        in: {
                            $mergeObjects: [
                                '$$variant',
                                {
                                    // Variants have no MRP of their own; the item's
                                    // MRP caps every size, same as the per-item save
                                    // path, which validates the highest variant.
                                    price: clampToMrp(scaled('$$variant.price'))
                                }
                            ]
                        }
                    }
                }
            }
        },
        {
            // Re-derive the selling price from the scaled base, so the discount the
            // restaurant set still holds. Only for rows that actually carry a base;
            // the stage above already scaled price directly for the rest.
            $set: {
                price: {
                    $cond: [
                        { $gt: [{ $ifNull: ['$basePrice', 0] }, 0] },
                        {
                            $max: [
                                MIN_RESULT_PRICE,
                                {
                                    $round: [
                                        {
                                            $multiply: [
                                                '$basePrice',
                                                { $subtract: [1, { $divide: [{ $ifNull: ['$discountPercent', 0] }, 100] }] }
                                            ]
                                        },
                                        2
                                    ]
                                }
                            ]
                        },
                        '$price'
                    ]
                }
            }
        }
    ]);
    return result?.modifiedCount || 0;
};

/**
 * Record what every affected dish was priced at, before a run touches it.
 *
 * Neither direction is reversible by arithmetic. A markdown overwrites
 * basePrice with the current selling price, so the old pre-discount figure is
 * gone; an increase overwrites the comparison with a figure derived from the
 * price rather than from itself, so dividing by the factor lands somewhere the
 * dish never was. This is the only way either run stays undoable.
 *
 * Taken for every run, not just markdowns. That is a change: increases used to
 * rely on the inverse multiply, which was exact only while they were multiplies.
 *
 * Written BEFORE the update on purpose: a crash between the two leaves a
 * snapshot describing dishes that were never changed, and restoring a dish to
 * the price it already has is harmless. The reverse -- changing a dish with no
 * snapshot -- is not.
 */
const snapshotPrices = async (filter, adjustmentId) => {
    const items = await FoodItem.find(filter)
        .select('price basePrice discountPercent otherPrice formulationPercent formulationPrice variants')
        .lean();
    if (!items.length) return 0;

    const orNull = (value) => (value === null || value === undefined ? null : Number(value));

    await FoodPriceAdjustmentSnapshot.insertMany(
        items.map((item) => ({
            adjustmentId,
            itemId: item._id,
            price: Number(item.price) || 0,
            basePrice: orNull(item.basePrice),
            discountPercent: Number(item.discountPercent) || 0,
            otherPrice: Number(item.otherPrice) || 0,
            formulationPercent: orNull(item.formulationPercent),
            formulationPrice: orNull(item.formulationPrice),
            variants: (item.variants || []).map((v) => ({ _id: v._id, price: Number(v.price) || 0 })),
            variantBases: (item.variants || []).map((v) => ({ _id: v._id, basePrice: orNull(v.basePrice) })),
        })),
        { ordered: false },
    );
    return items.length;
};

export async function listPriceAdjustments({ limit = 20 } = {}) {
    const capped = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const adjustments = await FoodPriceAdjustment.find({})
        .sort({ createdAt: -1 })
        .limit(capped)
        .lean();
    return { adjustments };
}

/**
 * What each restaurant's menu is actually carrying right now.
 *
 * The history below this page answers "what did an admin ask for?", which is
 * not the same question and has been known to disagree with the menu: a run
 * records a request, not a direct correction, a bulk reset or a migration, and
 * this platform has had all three. An admin about to run another adjustment
 * needs the standing figure, or they compound a markup they cannot see.
 *
 * Read from the dishes for that reason, the same source and the same rule as
 * resolveStandingAdjustment: the MODE of (markup, discount) across a
 * restaurant's approved dishes, because a menu is usually uniform and a single
 * hand-priced outlier should not speak for it.
 *
 * `isMixed` says the mode does not cover the whole menu, which is the case an
 * admin most needs to see before applying anything to "all dishes".
 */
export async function listStandingAdjustments() {
    const rows = await FoodItem.aggregate([
        { $match: { approvalStatus: 'approved', price: { $gt: 0 }, isCombo: { $ne: true } } },
        {
            $group: {
                _id: {
                    restaurantId: '$restaurantId',
                    markup: { $ifNull: ['$formulationMarkupPercent', 0] },
                    discount: { $ifNull: ['$formulationDiscountPercent', 0] },
                },
                count: { $sum: 1 },
            },
        },
        // Sorted before the second group so $first is the most common pairing.
        { $sort: { count: -1 } },
        {
            $group: {
                _id: '$_id.restaurantId',
                markupPercent: { $first: '$_id.markup' },
                discountPercent: { $first: '$_id.discount' },
                onThisFormulation: { $first: '$count' },
                totalItems: { $sum: '$count' },
            },
        },
    ]);

    const restaurants = await FoodRestaurant.find({ _id: { $in: rows.map((r) => r._id).filter(Boolean) } })
        .select('restaurantName')
        .lean();
    const nameById = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));

    return {
        standing: rows
            .map((row) => {
                const markupPercent = round2(Number(row.markupPercent) || 0);
                const discountPercent = round2(Number(row.discountPercent) || 0);
                return {
                    restaurantId: String(row._id || ''),
                    restaurantName: nameById.get(String(row._id)) || 'Unknown restaurant',
                    markupPercent,
                    discountPercent,
                    totalItems: row.totalItems,
                    onThisFormulation: row.onThisFormulation,
                    // Part of the menu sits on a different pairing, so the figures
                    // above describe most of it rather than all of it.
                    isMixed: row.onThisFormulation < row.totalItems,
                    // Nothing has ever been applied here, which reads differently
                    // from "0% after a revert" only in that no run is standing.
                    isUntouched: markupPercent === 0 && discountPercent === 0,
                };
            })
            .sort((a, b) => a.restaurantName.localeCompare(b.restaurantName)),
    };
}

export async function getPriceAdjustmentPreview({ restaurantId, percent } = {}) {
    const { restaurantName } = await resolveRestaurant(restaurantId);
    const filter = buildFilter(restaurantId);
    const itemCount = await FoodItem.countDocuments(filter);

    /*
     * Nothing can be pushed above its MRP any more. An increase moves only the
     * struck-through figure and a decrease lowers what is charged, so the
     * charged price never rises. Kept in the response shape because the admin
     * screen still reads it.
     */
    const itemsCappedByMrp = 0;

    /*
     * Real dishes at their real current values, not an invented "Rs 500 becomes
     * Rs 550". Without this the admin cannot see what a run did, so a run that
     * worked and one that silently did nothing look identical -- which is how
     * the same increase came to be applied five times in a row.
     *
     * Both figures come from resolveFormulationPricing, the same function the
     * write derives from, so the preview cannot describe a different run from
     * the one that happens. They disagreed once, and a preview that lies is
     * worse than no preview.
     */
    const pct = Number.isFinite(Number(percent)) ? Number(percent) : 0;
    const sampleDocs = await FoodItem.find(filter)
        .select('name price basePrice formulationPercent formulationPrice')
        .sort({ name: 1 })
        .limit(5)
        .lean();

    const samples = sampleDocs.map((doc) => {
        const now = resolveFormulationPricing(doc);
        const after = resolveFormulationPricing({ ...doc, formulationPercent: pct });
        /*
         * The figure the percent actually moves, which is direction-dependent:
         * an increase moves the struck-through comparison and leaves the price
         * alone, a decrease moves the price and strikes the base. Reporting the
         * formulation price for both would show "200 -> 200" on every increase
         * and read as a run that did nothing.
         */
        const moved = (r) => computeFormulationPrice(r.basePrice, r.formulationPercent) ?? r.price;
        return {
            name: doc?.name || '',
            current: moved(now),
            next: moved(after),
            // What the two mean for the customer, since a positive percent
            // moves the strike and a negative one moves the bill.
            paysNow: now.price,
            paysAfter: after.price,
            strikeAfter: after.strikePrice,
        };
    });

    /*
     * How many dishes would end up with nothing struck through.
     *
     * Only a percent of exactly 0 can do that now -- any other value puts the
     * formulation price either side of the base, and the further of the two is
     * struck. Computed rather than hardcoded so that if the derivation changes
     * again this goes wrong loudly instead of quietly reassuring an admin.
     */
    const itemsWithoutComparison = pct === 0 ? itemCount : 0;

    return {
        itemCount,
        restaurantName,
        itemsCappedByMrp,
        target: 'formulation',
        samples,
        itemsWithoutComparison,
    };
}

/**
 * Multiply the comparison figure by a factor. Kept only to undo runs recorded
 * before snapshotting covered every direction -- see setComparisonFromPrice for
 * what a run does now, and why multiplying was the thing that had to stop.
 *
 * Those older runs were applied as multiplies, so the inverse multiply is still
 * the correct way to reverse one. Nothing calls this forwards.
 */
const applyFactorToComparison = async (filter, factor, seedMultiplier = 1) => {
    const result = await FoodItem.updateMany(filter, [
        {
            $set: {
                otherPrice: {
                    $max: [
                        MIN_RESULT_PRICE,
                        {
                            $round: [
                                {
                                    $multiply: [
                                        comparisonSeedExpr(seedMultiplier),
                                        factor,
                                    ],
                                },
                                2,
                            ],
                        },
                    ],
                },
            },
        },
    ]);
    return result?.modifiedCount || 0;
};

/**
 * Store the percent on every matching dish and re-derive what follows from it.
 *
 * One pipeline for both directions, replacing applyMarkdownToMenu,
 * applyFactorToMenu and setComparisonFromPrice. Nothing here multiplies a
 * figure by the value it already held, which is what makes a run idempotent
 * and a repeat harmless.
 *
 * Stage by stage, because a later stage in an aggregation-pipeline update sees
 * what an earlier one wrote:
 *
 *   1. settle the base. Adopted from `price` only where the dish has none --
 *      that IS its unadjusted price, so nothing is discarded. Where the dish
 *      has one it is left exactly as the restaurant typed it. Variants get the
 *      same treatment, since they had no base at all until now.
 *   2. store the percent and derive the formulation price from the base.
 *   3. charge the lower of the two and derive the advertised saving from the
 *      two figures actually stored, so the percentage always describes them.
 *
 * `otherPrice` is deliberately untouched. It goes back to meaning only what a
 * restaurant typed about a rival, which is what it was for; global runs stop
 * writing it, so it stops being a second, competing comparison that could
 * outrank the real one.
 */
const applyFormulationPercent = async (filter, percent, { undo = false } = {}) => {
    const applied = normalizeFormulationPercent(percent);
    /*
     * Which accumulator this run moves, and in which direction. The two never
     * touch each other.
     *
     * `undo` subtracts the same run's contribution instead of adding it, which
     * is what makes a revert behave like `git revert` rather than
     * `git reset --hard`: undoing a -10% takes 10 off the discount total and
     * leaves every run made since exactly where it is. Restoring a snapshot
     * would have thrown those away.
     *
     * It composes because accumulation is linear against a fixed base. Undoing
     * a run from the middle of the history lands on the same totals as if it
     * had never been applied, whatever ran after it.
     */
    const sign = undo ? -1 : 1;
    const addMarkup = applied > 0 ? sign * applied : 0;
    const addDiscount = applied < 0 ? sign * -applied : 0;

    /*
     * A row written before the split carries one signed percent: positive was a
     * markup, negative a discount. Seeded here so the first run after the split
     * adds to what the dish already had rather than discarding it.
     */
    const legacy = (positive) => ({
        $let: {
            vars: { p: { $ifNull: ['$formulationPercent', 0] } },
            in: positive
                ? { $cond: [{ $gt: ['$$p', 0] }, '$$p', 0] }
                : {
                    $cond: [
                        { $lt: ['$$p', 0] },
                        { $multiply: ['$$p', -1] },
                        /*
                         * Older still: a row with no percent at all carries its
                         * discount in the gap between basePrice and price. The
                         * display infers it the same way, so the write and the
                         * read agree about what a dish is already on -- without
                         * this, a dish already 10% off would take a further -20%
                         * and land at -20% total, quietly handing back the 10%.
                         *
                         * `$price` is still the pre-run value here; the stage
                         * above touched only basePrice.
                         */
                        {
                            $cond: [
                                { $gt: ['$basePrice', '$price'] },
                                {
                                    $round: [
                                        {
                                            $multiply: [
                                                {
                                                    $divide: [
                                                        { $subtract: ['$basePrice', '$price'] },
                                                        '$basePrice',
                                                    ],
                                                },
                                                100,
                                            ],
                                        },
                                        2,
                                    ],
                                },
                                0,
                            ],
                        },
                    ],
                },
        },
    });

    const accumulate = (field, add, positive, cap) => ({
        $max: [
            0,
            {
                $min: [
                    cap,
                    { $add: [{ $ifNull: ['$' + field, legacy(positive)] }, add] },
                ],
            },
        ],
    });

    const discountedFrom = (baseField) => ({
        $max: [
            MIN_RESULT_PRICE,
            {
                $round: [
                    {
                        $multiply: [
                            baseField,
                            { $subtract: [1, { $divide: ['$formulationDiscountPercent', 100] }] },
                        ],
                    },
                    2,
                ],
            },
        ],
    });

    const result = await FoodItem.updateMany(
        { ...filter, price: { $gt: 0 } },
        [
            {
                // Settle the base first: adopted from `price` only where the dish
                // has none, so nothing the restaurant typed is discarded.
                $set: {
                    basePrice: {
                        $cond: [
                            { $gt: [{ $ifNull: ['$basePrice', 0] }, 0] },
                            { $round: ['$basePrice', 2] },
                            { $round: ['$price', 2] },
                        ],
                    },
                    variants: {
                        $map: {
                            input: { $ifNull: ['$variants', []] },
                            as: 'v',
                            in: {
                                $mergeObjects: [
                                    '$$v',
                                    {
                                        basePrice: {
                                            $cond: [
                                                { $gt: [{ $ifNull: ['$$v.basePrice', 0] }, 0] },
                                                { $round: ['$$v.basePrice', 2] },
                                                { $round: ['$$v.price', 2] },
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
            {
                /*
                 * Each direction adds to its own total, both measured against the
                 * same base. An increase raises only the struck comparison; a
                 * decrease lowers only what is charged. Sharing one signed
                 * counter meant a decrease spent itself cancelling a standing
                 * increase, and the price never moved.
                 */
                $set: {
                    formulationMarkupPercent:
                        accumulate('formulationMarkupPercent', addMarkup, true, MAX_PERCENT),
                    formulationDiscountPercent:
                        accumulate('formulationDiscountPercent', addDiscount, false, -MIN_PERCENT),
                },
            },
            {
                /*
                 * The struck-through figure, decided by THIS run.
                 *
                 * A decrease sets it to what the dish is selling for right now,
                 * before the stage below cuts the price -- so the customer sees
                 * the figure it just dropped from. An increase sets it from the
                 * markup total instead.
                 *
                 * `$price` is still the pre-run value here; the next stage is
                 * what changes it. That ordering is the whole mechanism, and
                 * merging these two stages would capture the already-cut price
                 * and strike through the number being charged.
                 */
                $set: {
                    /*
                     * An undo has no "price before the cut" to strike -- the run
                     * it is removing no longer applies -- so the strike falls
                     * back to the markup figure, which is what a dish carrying
                     * only a markup shows.
                     */
                    formulationStrikePrice: (!undo && addDiscount > 0)
                        ? { $round: ['$price', 2] }
                        : {
                            $round: [
                                {
                                    $multiply: [
                                        '$basePrice',
                                        { $add: [1, { $divide: ['$formulationMarkupPercent', 100] }] },
                                    ],
                                },
                                2,
                            ],
                        },
                    /*
                     * Every size gets the same decision, measured against its own
                     * base. This stage used to set the dish's strike and nothing
                     * else, so an increase on a dish sold by size landed nowhere a
                     * customer could see: the markup only ever moves a struck
                     * figure, and the sizes had none.
                     *
                     * Still reading the PRE-run `$$v.price` on a decrease, exactly
                     * as the dish above does -- the stage that cuts prices runs
                     * after this one.
                     */
                    variants: {
                        $map: {
                            input: { $ifNull: ['$variants', []] },
                            as: 'v',
                            in: {
                                $mergeObjects: [
                                    '$$v',
                                    {
                                        formulationStrikePrice: (!undo && addDiscount > 0)
                                            ? { $round: ['$$v.price', 2] }
                                            : {
                                                $round: [
                                                    {
                                                        $multiply: [
                                                            '$$v.basePrice',
                                                            { $add: [1, { $divide: ['$formulationMarkupPercent', 100] }] },
                                                        ],
                                                    },
                                                    2,
                                                ],
                                            },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
            {
                // Derived from the totals above, which is why this is its own
                // stage: a stage sees the document as it was when it began.
                $set: {
                    price: discountedFrom('$basePrice'),
                    variants: {
                        $map: {
                            input: { $ifNull: ['$variants', []] },
                            as: 'v',
                            in: {
                                $mergeObjects: [
                                    '$$v',
                                    { price: discountedFrom('$$v.basePrice') },
                                ],
                            },
                        },
                    },
                },
            },
            {
                $set: {
                    // What the customer pays, equal to `price` by definition.
                    formulationPrice: '$price',
                    /*
                     * The signed field older readers still consult. A markup
                     * wins when both stand, which is how it was interpreted
                     * before the split.
                     */
                    formulationPercent: {
                        $cond: [
                            { $gt: ['$formulationMarkupPercent', 0] },
                            '$formulationMarkupPercent',
                            { $multiply: ['$formulationDiscountPercent', -1] },
                        ],
                    },
                    discountPercent: {
                        $let: {
                            // The saving read off the two figures on screen, so
                            // it has to use the strike this run actually stored.
                            vars: { strike: '$formulationStrikePrice' },
                            in: {
                                $cond: [
                                    { $gt: ['$$strike', '$price'] },
                                    {
                                        $round: [
                                            {
                                                $multiply: [
                                                    {
                                                        $divide: [
                                                            { $subtract: ['$$strike', '$price'] },
                                                            '$$strike',
                                                        ],
                                                    },
                                                    100,
                                                ],
                                            },
                                            2,
                                        ],
                                    },
                                    0,
                                ],
                            },
                        },
                    },
                },
            },
        ],
    );
    return result?.modifiedCount || 0;
};

/**
 * The global adjustment currently standing over a restaurant's menu.
 *
 * A dish arriving for approval carries no adjustment: it was created after
 * every run that shaped the menu around it, so it would go live at its bare
 * base price beside dishes marked 20% up and 10% down. The admin approving it
 * has to be able to say whether it joins them.
 *
 * Totalled from the run history rather than read off a neighbouring dish. A
 * menu is not always uniform -- an earlier per-restaurant run may have touched
 * only part of it -- and "what the runs say" is a fact, where "what that dish
 * over there has" is a guess.
 *
 * Included: every formulation run that is not itself a revert and has not been
 * reverted, scoped either to this restaurant or to all restaurants. Increases
 * add to the markup, decreases to the discount, matching how a run accumulates.
 *
 * Excluded: the older `scale` and `markdown` runs. Those multiplied stored
 * prices rather than recording a percent, so there is no total to inherit --
 * and a dish created today was never part of what they did.
 */
export async function resolveStandingAdjustment(restaurantId, { excludeItemId = null } = {}) {
    /*
     * Read from the dishes, not from the run history.
     *
     * The history looks authoritative and is not. A run records what an admin
     * asked for; it does not record anything done to prices outside the
     * adjuster -- a direct correction, a bulk reset, a migration. This platform
     * has had all three, and the two sources had already diverged: seven runs
     * summing to 50% markup and 30% discount over a menu whose dishes all sat
     * at zero, because a reset had cleared the dishes and left the history
     * standing.
     *
     * A dish inheriting from the history would then have landed at 30% off
     * beside neighbours at full price -- the precise opposite of the point.
     * What the neighbours actually carry is the only thing that answers "make
     * this one match", so that is what is read.
     *
     * The mode rather than the mean or the first row: a menu is usually
     * uniform, and where it is not, the majority is what a new dish should join.
     * An outlier priced by hand should not drag every future dish toward it.
     */
    const match = { approvalStatus: 'approved', price: { $gt: 0 } };
    if (restaurantId && mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        match.restaurantId = new mongoose.Types.ObjectId(String(restaurantId));
    }
    /*
     * The dish being approved is excluded from its own sample.
     *
     * Approval flips approvalStatus before this runs, so without this the dish
     * asking "what do my neighbours carry?" is counted as one of them -- and on
     * a menu whose only approved dish is that one, it answers with its own
     * zeroes and inherits nothing.
     */
    if (excludeItemId && mongoose.Types.ObjectId.isValid(String(excludeItemId))) {
        match._id = { $ne: new mongoose.Types.ObjectId(String(excludeItemId)) };
    }

    const grouped = await FoodItem.aggregate([
        { $match: match },
        {
            $group: {
                _id: {
                    markup: { $ifNull: ['$formulationMarkupPercent', 0] },
                    discount: { $ifNull: ['$formulationDiscountPercent', 0] },
                    /*
                     * Whether those dishes strike the price they dropped from
                     * (a decrease ran last) or the markup figure (an increase
                     * did).
                     *
                     * Told apart by where the stored strike sits relative to
                     * the base, not by whether one exists: both directions
                     * write it now, so its presence says nothing. A decrease
                     * records the pre-cut price, which is at or below the base;
                     * an increase records base x (1 + markup), which is above.
                     */
                    struckFromBase: {
                        $and: [
                            { $gt: [{ $ifNull: ['$formulationStrikePrice', 0] }, 0] },
                            {
                                $lte: [
                                    { $ifNull: ['$formulationStrikePrice', 0] },
                                    { $ifNull: ['$basePrice', 0] },
                                ],
                            },
                        ],
                    },
                },
                count: { $sum: 1 },
            },
        },
        { $sort: { count: -1 } },
        { $limit: 1 },
    ]);

    const top = grouped[0]?._id;
    if (top) {
        const markupPercent = Math.min(Math.max(round2(Number(top.markup) || 0), 0), MAX_PERCENT);
        const discountPercent = Math.min(Math.max(round2(Number(top.discount) || 0), 0), -MIN_PERCENT);
        return {
            markupPercent,
            discountPercent,
            lastDirection: top.struckFromBase && discountPercent > 0 ? 'decrease' : 'increase',
            source: 'menu',
            sampleSize: grouped[0].count,
        };
    }

    /*
     * No approved dish to copy, so nothing is standing. Not "nothing we can
     * find" -- nothing.
     *
     * This used to fall back to the run history, summing every non-reverted
     * platform-wide run into one total on the grounds that those runs would
     * have reached this restaurant had it existed. Three things were wrong
     * with that, and the header above this function had already said the first:
     *
     *   - the history is not authoritative. It records what an admin asked
     *     for, not what was done to prices outside the adjuster, and the two
     *     have diverged on this platform before;
     *   - it SUMMED runs. Seven unrelated runs over two years became "50%
     *     markup and 30% discount", a figure no dish anywhere ever carried;
     *   - it answered for a restaurant with an empty menu, where the question
     *     -- "what do the other dishes here carry?" -- has no other dishes to
     *     ask about.
     *
     * The approval dialog printed that sum as fact: "This menu is on a price
     * adjustment. 50% markup and 30% discount applies to the other dishes
     * here", to an admin approving the first dish of a restaurant with no other
     * dishes at all, whose owner had never been offered any such thing.
     *
     * Same rule as the comparison-price seed, and for the same reason: a
     * restaurant with nothing of its own inherits nothing. Zero here means the
     * dialog offers no choice, which is correct -- there is nothing to join.
     */
    return {
        markupPercent: 0,
        discountPercent: 0,
        lastDirection: 'increase',
        source: 'none',
        sampleSize: 0,
    };
}

export async function applyPriceAdjustment(body = {}, actor = {}) {
    const percent = Number(body.percent);
    if (!Number.isFinite(percent) || percent === 0) {
        throw new ValidationError('Enter a percent other than 0');
    }
    if (percent < MIN_PERCENT || percent > MAX_PERCENT) {
        throw new ValidationError(`Percent must be between ${MIN_PERCENT} and ${MAX_PERCENT}`);
    }

    const { restaurantId, restaurantName } = await resolveRestaurant(body.restaurantId);
    const factor = 1 + percent / 100;
    const filter = buildFilter(restaurantId);

    /*
     * A run stores the percent. It does not apply it to anything.
     *
     * That single sentence is the fix for every compounding bug this feature
     * has had. `formulationPercent` REPLACES whatever was there, and
     * `formulationPrice` is re-derived from `basePrice`, which a run never
     * writes -- so five identical +20% runs land on the same figure, and
     * switching to -10% afterwards measures from the restaurant's price rather
     * than from the last run's output.
     *
     * Direction no longer selects a code path. It falls out of the arithmetic:
     * a positive percent puts formulationPrice above basePrice, so the customer
     * keeps paying the base and the formulation is struck through; a negative
     * one puts it below, so it becomes what is charged and the base is struck.
     * The markdown-versus-scale split, and the two revert strategies it needed,
     * are gone with it.
     *
     * `target` and `strategy` are still recorded, as 'formulation', so the
     * history reads honestly and revert can tell these runs from the older
     * ones it still has to undo by hand.
     */
    const target = 'formulation';
    const strategy = 'formulation';

    /*
     * No MRP count. Only the charged price can breach a printed maximum, and
     * this never raises it: an increase moves the struck-through figure alone,
     * and a decrease lowers what is charged. Nothing on the platform carries an
     * MRP today in any case.
     */
    const itemsCappedByMrp = 0;

    // The record is created first so the snapshot can point at it, and so a run
    // that dies partway still leaves a trace of what was attempted.
    const adjustment = await FoodPriceAdjustment.create({
        percent,
        factor,
        target,
        strategy,
        restaurantId,
        restaurantName,
        itemsUpdated: 0,
        itemsCappedByMrp,
        ...(await resolveActor(actor))
    });

    /*
     * Still snapshotted, though revert no longer needs it: a run overwrites the
     * percent, and the percent each dish carried before is the only record of
     * what a partial or per-restaurant history looked like. Cheap insurance
     * against a migration or a bad backfill, which is exactly the situation
     * this platform has been in.
     */
    await snapshotPrices(filter, adjustment._id);

    const itemsUpdated = await applyFormulationPercent(filter, percent);

    adjustment.itemsUpdated = itemsUpdated;
    await adjustment.save();

    // The public endpoints cache for up to five minutes. Without this the new
    // prices sit in Mongo while the apps keep serving the old ones, which reads
    // as the run having done nothing -- and invites running it again.
    await invalidatePriceCaches();

    return { adjustment: adjustment.toObject(), itemsUpdated, itemsCappedByMrp };
}

export async function revertPriceAdjustment(id, actor = {}) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid adjustment');
    }
    const original = await FoodPriceAdjustment.findById(id);
    if (!original) throw new ValidationError('Adjustment not found');
    if (original.isReverted) throw new ValidationError('This adjustment was already reverted');
    if (original.revertsAdjustmentId) throw new ValidationError('A revert cannot itself be reverted');

    const factor = Number(original.factor);
    if (!Number.isFinite(factor) || factor <= 0) {
        throw new ValidationError('This adjustment cannot be reverted automatically');
    }

    // ponytail: reverting divides by the original factor rather than restoring a
    // per-item snapshot, so a price can land a paisa off if it was not a clean
    // multiple (and any price clamped at MIN_RESULT_PRICE does not come back).
    // Snapshot every item's old price if exact restoration ever matters.
    const inverse = 1 / factor;

    // Undo the number the original run moved. This always scaled the selling
    // price regardless of what the run targeted, so reverting a comparison
    // adjustment repriced the live menu -- the one thing that run had
    // deliberately left alone.
    const target = String(original.target || 'otherPrice') === 'price' ? 'price' : 'otherPrice';
    const filter = buildFilter(original.restaurantId);

    /*
     * A markdown overwrote each dish's base price with its selling price, so
     * there is nothing to multiply back. Restore what was recorded instead.
     *
     * Rows written before `strategy` existed are all scales, which the default
     * handles.
     */
    let itemsUpdated = 0;

    /*
     * A formulation run is undone by removing its own contribution, not by
     * restoring the prices as they stood before it.
     *
     * That distinction is the difference between `git revert` and
     * `git reset --hard`. Restoring the snapshot puts every dish back to the
     * moment before this run -- discarding every adjustment made since, which
     * is almost never what someone reverting a week-old run wants. Subtracting
     * the percent removes that run alone and leaves the rest standing.
     *
     * Exact rather than approximate, because accumulation is linear against a
     * base no run writes: undoing -10 from a dish now at -30 lands on -20, the
     * same total it would have had if the run had never happened.
     */
    if (String(original.strategy) === 'formulation') {
        itemsUpdated = await applyFormulationPercent(
            buildFilter(original.restaurantId),
            Number(original.percent),
            { undo: true },
        );

        original.isReverted = true;
        await original.save();

        const revertEntry = await FoodPriceAdjustment.create({
            percent: -Number(original.percent),
            factor: 1 / (Number(original.factor) || 1),
            target: 'formulation',
            strategy: 'formulation',
            restaurantId: original.restaurantId,
            restaurantName: original.restaurantName,
            itemsUpdated,
            revertsAdjustmentId: original._id,
            ...(await resolveActor(actor)),
        });

        await invalidatePriceCaches();
        return { adjustment: revertEntry.toObject(), itemsUpdated };
    }

    const snapshots = await FoodPriceAdjustmentSnapshot.find({ adjustmentId: original._id }).lean();

    /*
     * Restore what was recorded, whichever direction the run went. Every run
     * now snapshots, because neither direction is an invertible multiply any
     * more -- see snapshotPrices. Runs from before that carry nothing, and fall
     * through to the inverse below, which is exactly what they were undone by
     * at the time.
     */
    if (snapshots.length) {
        // Variants are restored per row, since each carries its own prices.
        for (const snap of snapshots) {
            if (!snap.variants?.length) continue;
            await FoodItem.updateOne(
                { _id: snap.itemId },
                [{
                    $set: {
                        variants: {
                            $map: {
                                input: { $ifNull: ['$variants', []] },
                                as: 'v',
                                in: {
                                    $mergeObjects: [
                                        '$$v',
                                        {
                                            price: {
                                                $let: {
                                                    vars: {
                                                        saved: {
                                                            $first: {
                                                                $filter: {
                                                                    input: snap.variants,
                                                                    as: 's',
                                                                    cond: { $eq: ['$$s._id', '$$v._id'] },
                                                                },
                                                            },
                                                        },
                                                    },
                                                    in: { $ifNull: ['$$saved.price', '$$v.price'] },
                                                },
                                            },
                                            // A formulation run adopts a base
                                            // for every size that had none, so
                                            // the absence of one is itself a
                                            // state a revert has to restore.
                                            basePrice: {
                                                $let: {
                                                    vars: {
                                                        savedBase: {
                                                            $first: {
                                                                $filter: {
                                                                    input: snap.variantBases || [],
                                                                    as: 's',
                                                                    cond: { $eq: ['$$s._id', '$$v._id'] },
                                                                },
                                                            },
                                                        },
                                                    },
                                                    in: {
                                                        $cond: [
                                                            { $gt: [{ $size: { $ifNull: [snap.variantBases, []] } }, 0] },
                                                            // Same guard as the dish above: a size the
                                                            // snapshot has no base for keeps the one it
                                                            // has, rather than being blanked.
                                                            { $ifNull: ['$$savedBase.basePrice', '$$v.basePrice'] },
                                                            '$$v.basePrice',
                                                        ],
                                                    },
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    },
                }],
            );
        }
        const res = await FoodItem.bulkWrite(
            snapshots.map((snap) => ({
                updateOne: {
                    filter: { _id: snap.itemId },
                    update: {
                        $set: {
                            price: snap.price,
                            /*
                             * The base is restored ONLY when the snapshot recorded
                             * a real one.
                             *
                             * 62 snapshots on production carry basePrice null --
                             * rows captured before the field existed. Writing that
                             * back blanked the dish's base, and the next decrease,
                             * finding no base, adopted the already-discounted price
                             * as the new one. That is a base price falling as a
                             * result of a global run, which must never happen.
                             *
                             * Leaving the current base in place is right in any
                             * case: a run never writes the base, so a revert has
                             * nothing of its own to undo there.
                             */
                            ...(Number(snap.basePrice) > 0 ? { basePrice: snap.basePrice } : {}),
                            discountPercent: snap.discountPercent,
                            /*
                             * Each field restored only when the snapshot
                             * actually recorded it. Snapshots have been widened
                             * twice -- markdown-only at first, then every
                             * direction, then the formulation fields -- and
                             * reading an absent field as 0 would clear a value
                             * the run never touched, blanking the strike on
                             * dishes a revert was meant to leave alone.
                             */
                            ...(snap.otherPrice === undefined || snap.otherPrice === null
                                ? {}
                                : { otherPrice: Number(snap.otherPrice) || 0 }),
                            ...(snap.formulationPercent === undefined || snap.formulationPercent === null
                                ? {}
                                : { formulationPercent: Number(snap.formulationPercent) || 0 }),
                            ...(snap.formulationPrice === undefined || snap.formulationPrice === null
                                ? {}
                                : { formulationPrice: Number(snap.formulationPrice) || 0 }),
                        },
                    },
                },
            })),
        );
        itemsUpdated = res?.modifiedCount || 0;
    } else if (String(original.strategy) === 'markdown') {
        throw new ValidationError(
            'This markdown has no saved prices to restore, so it cannot be reverted automatically',
        );
    } else {
        // Same seed as the forward run. Every dish the original touched now
        // carries a stored figure, so the seed is unused for those and the
        // revert stays exact; it only decides what happens to a dish added
        // between the run and the undo, where seeding from the bare price would
        // write a figure below the selling price and strike nothing through.
        itemsUpdated = target === 'price'
            ? await applyFactorToMenu(filter, inverse)
            : await applyFactorToComparison(filter, inverse, await resolveComparisonSeedMultiplier());
    }

    original.isReverted = true;
    await original.save();

    const revertEntry = await FoodPriceAdjustment.create({
        percent: (inverse - 1) * 100,
        factor: inverse,
        target,
        restaurantId: original.restaurantId,
        restaurantName: original.restaurantName,
        itemsUpdated,
        revertsAdjustmentId: original._id,
        ...(await resolveActor(actor))
    });

    await invalidatePriceCaches();

    return { adjustment: revertEntry.toObject(), itemsUpdated };
}
