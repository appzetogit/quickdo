import { resolveEarningSlabs, resolveIncentive } from './deliveryEarnings.service.js';
import { resolveDeliveryFormula, formulaFromSlabs } from './deliveryFormula.js';

/**
 * What a module is paying today, and where that came from.
 *
 * The Master editor needs this before it can safely offer "start from the
 * module's current table": without it an admin building a table by hand loses
 * the band ids, and the per-band admin delivery commission in fee settings --
 * which is keyed by them -- silently stops matching. Handing back the real
 * bands, ids and all, is what keeps that intact.
 */

const VERTICALS = Object.freeze(['food', 'quickCommerce', 'medical', 'taxi']);

/** Each module's own bands, in the engine's shape. Empty when it has none. */
async function legacyFor(vertical) {
    if (vertical === 'food') {
        const { FoodDeliveryCommissionRule } = await import(
            '../../modules/food/admin/models/deliveryCommissionRule.model.js'
        );
        return FoodDeliveryCommissionRule.find({ status: { $ne: false } }).lean();
    }
    if (vertical === 'quickCommerce' || vertical === 'medical') {
        const { FoodFeeSettings } = await import(
            '../../modules/quickCommerce/modules/food/admin/models/feeSettings.model.js'
        );
        const doc = await FoodFeeSettings.findOne({ isActive: { $ne: false } })
            .sort({ createdAt: -1 })
            .lean();
        // Quick commerce stores its bands inside fee settings under different
        // names; translated here so the editor shows one shape for every module.
        return (doc?.deliveryFeeRanges || []).map((r) => ({
            _id: null,
            minDistance: Number(r.min || 0),
            maxDistance: r.max == null ? null : Number(r.max),
            userDeliveryFee: Number(r.fee || 0),
            commissionPerKm: Number(r.deliveryBoyPerKm || 0),
            basePayout: Number(r.deliveryBoyBasePay || 0),
        }));
    }
    // Taxi prices rides from its own fare rules, not a delivery band table.
    return [];
}

/** Food's per-band admin delivery commission %, by band id (enabled rows only). */
async function foodCommissionByBand() {
    const { FoodFeeSettings } = await import('../../modules/food/admin/models/feeSettings.model.js');
    const doc = await FoodFeeSettings.findOne({ isActive: { $ne: false } }).sort({ createdAt: -1 }).lean();
    const out = {};
    for (const r of doc?.distanceSlabAdminDeliveryCommission || []) {
        if (r?.isEnabled === true) out[String(r.distanceRuleId)] = Number(r.adminDeliveryCommissionPercent) || 0;
    }
    return out;
}

/** The module's own incentive rule, where it has one. */
async function legacyIncentiveFor(vertical) {
    if (vertical !== 'food') return null;
    const { FoodFeeSettings } = await import(
        '../../modules/food/admin/models/feeSettings.model.js'
    );
    const doc = await FoodFeeSettings.findOne({ isActive: { $ne: false } })
        .sort({ createdAt: -1 })
        .lean();
    return doc?.deliveryPartnerIncentiveRule || null;
}

export async function getEarningsController(req, res, next) {
    try {
        const vertical = String(req.params.vertical || '').trim();
        if (!VERTICALS.includes(vertical)) {
            return res.status(400).json({ success: false, message: `Unknown module "${vertical}"` });
        }
        const zoneId = req.query.zoneId ? String(req.query.zoneId) : undefined;

        const [table, incentive, ownBands, formula] = await Promise.all([
            resolveEarningSlabs({ vertical, zoneId, loadLegacy: () => legacyFor(vertical) }),
            resolveIncentive({ vertical, zoneId, legacy: await legacyIncentiveFor(vertical) }),
            legacyFor(vertical),
            resolveDeliveryFormula({ vertical, zoneId }),
        ]);
        // What is charged and paid today, written as the new formula, so the
        // editor can open on it and saving changes nothing until a number does.
        const currentAsFormula = formulaFromSlabs(table.slabs, {
            riderRule: vertical === 'food' ? 'food' : 'quickCommerce',
            commissionPercentByBand: vertical === 'food' ? await foodCommissionByBand() : {},
        });

        return res.json({
            success: true,
            data: {
                vertical,
                zoneId: zoneId || null,
                slabs: table.slabs,
                slabSource: table.source,
                slabLevel: table.level,
                incentive,
                // The formula in force (null = the module still uses its band table).
                formula: formula ? formula.formula : null,
                formulaSource: formula ? formula.source : null,
                formulaLevel: formula ? formula.level : null,
                currentAsFormula,
                /*
                 * The module's own bands, always -- what "start from the current
                 * table" fills the editor with, even once a Master table is set,
                 * so an admin can get back to where they started.
                 */
                moduleBands: (ownBands || []).map((r) => ({
                    distanceRuleId: r?._id ? String(r._id) : null,
                    name: String(r?.name || '').trim(),
                    minDistance: Number(r?.minDistance || 0),
                    maxDistance: r?.maxDistance == null ? null : Number(r.maxDistance),
                    userDeliveryFee: Number(r?.userDeliveryFee || 0),
                    commissionPerKm: Number(r?.commissionPerKm || 0),
                    basePayout: Number(r?.basePayout || 0),
                })),
            },
        });
    } catch (err) {
        return next(err);
    }
}

export const __testables = { legacyFor, VERTICALS };
