/**
 * Every setting the platform has, declared once.
 *
 * A key/value store without this is a free-for-all: nothing stops a typo creating
 * `cash_limt`, nothing stops a cash limit being saved as the string "2000", and
 * nothing tells the admin panel what to render. The registry is what buys back the
 * schema that a generic store gives away.
 *
 * Each entry declares:
 *   type      how to coerce and validate
 *   default   the value when no level has set one -- so a missing row is never
 *             the same as zero, which is the bug in reading
 *             `Number(settings?.deliveryCashLimit) || 0` as "no limit"
 *   scopes    which levels may set it. Not everything is overridable per partner:
 *             a maintenance switch is global by nature, and offering a partner-level
 *             override for it invites someone to create one that does nothing.
 *   label/help what the panel shows
 *
 * Keys are namespaced `area.name` so the panel can group them without a second
 * table of groupings that drifts from this one.
 */

import { normalizeFormula } from '../finance/deliveryFormula.js';

const ALL_SCOPES = ['global', 'vertical', 'zone', 'partner'];
const GLOBAL_ONLY = ['global'];
const NOT_PER_PARTNER = ['global', 'vertical', 'zone'];
/*
 * A promo code already belongs to one city through its own service locations,
 * so a zone-level ceiling would be a second, invisible way to scope the same
 * thing -- and the two would disagree.
 */
const GLOBAL_AND_VERTICAL = ['global', 'vertical'];

export const SETTINGS = Object.freeze({
    // --- partner money -------------------------------------------------------
    'finance.cashLimit': {
        type: 'number',
        default: 0,
        min: 0,
        scopes: ALL_SCOPES,
        label: 'Cash collection limit',
        help: 'Most platform cash a partner may hold before new cash work is refused. 0 means no ceiling. Riders have ONE limit across taxi, food and quick commerce: set it globally or per rider (a vertical value does not apply to them). Service providers read the serviceProvider vertical value. Until a value is set here, each partner keeps the limit from its own admin screen.',
    },
    'finance.enforceCashLimit': {
        type: 'boolean',
        default: true,
        scopes: NOT_PER_PARTNER,
        label: 'Enforce the cash limit',
        help: 'Turn off to measure the limit without acting on it.',
    },
    'finance.minimumWalletBalance': {
        type: 'number',
        default: null,
        scopes: ALL_SCOPES,
        label: 'Minimum wallet balance',
        help: 'Below this SIGNED balance a partner gets no new work. Negative is normal: taxi records cash owed as a negative balance. Unset means no minimum.',
    },
    'finance.blockOnNonPositiveWallet': {
        type: 'boolean',
        default: false,
        scopes: NOT_PER_PARTNER,
        label: 'Block at zero or below',
        help: 'Off by default. Taxi encodes cash owed as a negative balance, so switching this on platform-wide stops most riders who have collected any cash.',
    },

    // --- rider earnings ------------------------------------------------------
    /*
     * What a rider is paid, as the whole distance table rather than one number.
     *
     * The formula is `basePayout + commissionPerKm` PER DISTANCE SLAB, so a
     * scalar key cannot express it: a single global "base payout" would flatten
     * every slab into one and quietly re-price every delivery. The value is
     * therefore the table itself, which is also what makes "set it for one
     * module or for all" work -- the whole table is what differs between
     * verticals, not one row of it.
     *
     * Unset (the default) means the vertical keeps reading its own
     * `food_delivery_commission_rules` rows exactly as today. Food and quick
     * commerce currently point at that SAME collection, so they already share
     * one table by accident; setting a vertical value here is what finally lets
     * them differ on purpose.
     */
    'earnings.distanceSlabs': {
        type: 'object',
        default: null,
        scopes: NOT_PER_PARTNER,
        label: 'Rider earning formula',
        help: 'The distance table a rider is paid from: base payout plus a per-km rate for each distance band. Leave unset and each module keeps its existing table. Set it globally to pay the same everywhere, or per module to pay differently.',
        validate: (rows) => {
            if (!Array.isArray(rows)) throw new Error('The earning formula must be a list of distance bands');
            if (!rows.length) throw new Error('Add at least one distance band, or clear the setting to use the module\'s own table');
            return rows.map((r, i) => {
                const at = `Band ${i + 1}`;
                const min = Number(r?.minDistance);
                const max = r?.maxDistance === null || r?.maxDistance === undefined || r?.maxDistance === '' ? null : Number(r.maxDistance);
                const perKm = Number(r?.commissionPerKm);
                const base = Number(r?.basePayout);
                const userFee = Number(r?.userDeliveryFee ?? 0);
                const extraPerKm = Number(r?.extraPerKm ?? 0);
                if (!Number.isFinite(min) || min < 0) throw new Error(`${at}: "from" must be 0 or more`);
                if (max !== null && (!Number.isFinite(max) || max <= min)) throw new Error(`${at}: "to" must be greater than "from"`);
                if (!Number.isFinite(perKm) || perKm < 0) throw new Error(`${at}: per-km rate must be 0 or more`);
                if (!Number.isFinite(base) || base < 0) throw new Error(`${at}: base payout must be 0 or more`);
                if (!Number.isFinite(userFee) || userFee < 0) throw new Error(`${at}: customer delivery fee must be 0 or more`);
                if (!Number.isFinite(extraPerKm) || extraPerKm < 0) throw new Error(`${at}: extra per-km must be 0 or more`);
                return {
                    /*
                     * The id of the module band this row came from, kept so the
                     * per-band admin delivery commission in fee settings -- which
                     * is keyed by that id -- still matches after the table moves
                     * here. The panel pre-fills from the module's own table, so
                     * an admin who edits rates keeps their commission rows; only
                     * a band added here is new and has none.
                     */
                    distanceRuleId: r?.distanceRuleId ? String(r.distanceRuleId) : null,
                    name: String(r?.name || '').trim(),
                    minDistance: min,
                    maxDistance: max,
                    userDeliveryFee: userFee,
                    commissionPerKm: perKm,
                    basePayout: base,
                    /*
                     * Charged on the distance ABOVE this band's start, on top of
                     * the band's own fee. It is what makes an open-ended last
                     * band ("6 km and beyond") chargeable: without it every trip
                     * past the final band costs the same as one at its edge, so
                     * a 45km delivery billed the same as a 5.5km one and paid
                     * the rider the same for it. 0 leaves the band flat.
                     */
                    extraPerKm,
                };
            }).sort((a, b) => a.minDistance - b.minDistance);
        },
    },
    /*
     * The delivery formula: what the customer pays and what the rider earns,
     * set as two separate lines (core/finance/deliveryFormula.js). Replaces
     * the band table above for any module where it is set; where it is not,
     * that module keeps the table exactly as before.
     */
    'earnings.formula': {
        type: 'object',
        default: null,
        scopes: NOT_PER_PARTNER,
        label: 'Delivery formula',
        help: 'Customer pays a base fee for the first N km plus a per-km rate after that; the rider earns their own base plus per km. Optional distance bands, minimum and maximum fee.',
        validate: (v) => normalizeFormula(v),
    },
    /*
     * The top-up a rider earns on a large order. Scalar, unlike the table above,
     * and today it exists only in food's fee settings -- quick commerce has no
     * incentive rule at all, so its riders silently get nothing on the same
     * order. Setting this globally is what closes that gap.
     */
    'earnings.incentive': {
        type: 'object',
        default: null,
        scopes: NOT_PER_PARTNER,
        label: 'Rider incentive',
        help: 'An extra percentage paid to the rider on orders at or above a given value. Leave unset and each module keeps its own rule (quick commerce currently has none). Set it globally to pay the same incentive everywhere.',
        validate: (v) => {
            if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('The incentive must be a single rule');
            const minOrderAmount = Number(v.minOrderAmount ?? 0);
            const incentivePercent = Number(v.incentivePercent ?? 0);
            if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0) throw new Error('Minimum order value must be 0 or more');
            if (!Number.isFinite(incentivePercent) || incentivePercent < 0 || incentivePercent > 100) throw new Error('Incentive percent must be between 0 and 100');
            return { isEnabled: v.isEnabled === true, minOrderAmount, incentivePercent };
        },
    },

    // --- promotions ----------------------------------------------------------
    /*
     * A ceiling on what any promo code may give away, NOT a default.
     *
     * The distinction is the whole point. A default would pre-fill a form and
     * then be ignored by every code already out there; a ceiling is applied when
     * the code is redeemed, so it reaches existing promos too. And it only ever
     * TIGHTENS -- a code asking for fewer uses than the ceiling keeps its own
     * number. Raising the ceiling can therefore never quietly make a live promo
     * more generous than whoever created it intended.
     *
     * Unset means no ceiling, which is today's behaviour.
     */
    'promo.maxUsesPerUser': {
        type: 'number',
        default: null,
        min: 1,
        scopes: GLOBAL_AND_VERTICAL,
        label: 'Most uses of one code per customer',
        help: 'No promo code may be used by a single customer more times than this, whatever the code itself says. Unset means no ceiling. A code that allows fewer keeps its own limit -- this only ever tightens.',
    },
    'promo.maxUsesTotal': {
        type: 'number',
        default: null,
        min: 1,
        scopes: GLOBAL_AND_VERTICAL,
        label: 'Most uses of one code in total',
        help: 'No promo code may be redeemed more times than this across all customers. Unset means no ceiling. A code with a smaller cap of its own keeps it.',
    },

    // --- fees ----------------------------------------------------------------
    /*
     * The platform fee on an order and the GST on it, set once (Master >
     * Platform Fee & GST). Unset keeps each service's own fee settings, which is
     * how it worked before. Read by core/finance/platformFees.service.js.
     */
    'fees.platformFee': {
        type: 'number',
        default: null,
        min: 0,
        max: 1000,
        scopes: NOT_PER_PARTNER,
        label: 'Platform fee per order',
        help: 'A flat amount added to every Food and Quick & Medical order. 0 charges none. Unset keeps each service’s own fee.',
    },
    'fees.platformFeeGstRate': {
        type: 'number',
        default: null,
        min: 0,
        max: 100,
        scopes: NOT_PER_PARTNER,
        label: 'GST on the platform fee (%)',
        help: 'Added on top of the platform fee. Food only: Quick & Medical does not add GST to its platform fee. Unset keeps Food’s own rate (18% if it has none).',
    },

    // --- order cancellation --------------------------------------------------
    /*
     * How long a customer may cancel after the restaurant or store accepts
     * (Master > Cancellation Policy). Unset keeps each service's own rule: Food's
     * Order cancellation screen, and Quick & Medical's "only before the store
     * accepts". Read by modules/food/orders/services/cancellationPolicy.js.
     */
    'orders.cancelAfterAccept': {
        type: 'boolean',
        default: null,
        scopes: NOT_PER_PARTNER,
        label: 'Customers may cancel after the order is accepted',
        help: 'Off: a customer can cancel only while the order waits to be accepted. Never once the rider has picked it up.',
    },
    'orders.cancelWindowMinutes': {
        type: 'number',
        default: null,
        min: 1,
        max: 120,
        scopes: NOT_PER_PARTNER,
        label: 'Minutes after acceptance to allow cancelling',
        help: 'Counted from when the restaurant or store accepted.',
    },
    'orders.cancelStopWhenPreparing': {
        type: 'boolean',
        default: null,
        scopes: NOT_PER_PARTNER,
        label: 'Stop as soon as preparing starts',
        help: 'On: cancelling closes when the kitchen or store marks it preparing, even inside the window.',
    },
    /*
     * A short hold before a new order reaches the restaurant or store, so a
     * customer who changes their mind can cancel before anyone starts on it
     * (core/orders/orderHold.js). 0 sends it straight away, as before.
     */
    'orders.holdSeconds': {
        type: 'number',
        default: 0,
        min: 0,
        max: 600,
        scopes: NOT_PER_PARTNER,
        label: 'Seconds to hold a new order before the restaurant sees it',
        help: 'The customer can cancel free during the hold. 0 sends orders straight away.',
    },

    // --- referral ------------------------------------------------------------
    /*
     * What a referral pays, set once for every service (Master > Referral).
     *
     * Unset means each service keeps paying what its own referral screen says,
     * which is how the platform behaved before this existed. Once set, it is what
     * Food, Quick & Medical and Taxi pay (core/referral/referralSettings.service.js);
     * WHEN each pays stays the service's own rule -- Food and Quick at sign-up or
     * approval, Taxi after the rides its screen asks for.
     */
    'referral.customerReward': {
        type: 'number',
        default: null,
        min: 0,
        scopes: GLOBAL_AND_VERTICAL,
        label: 'Reward for referring a customer',
        help: 'Credited to the wallet of the customer who invited a new one. 0 switches customer referral rewards off. Unset keeps what each service pays today.',
    },
    'referral.customerLimit': {
        type: 'number',
        default: null,
        min: 1,
        scopes: GLOBAL_AND_VERTICAL,
        label: 'Most rewarded customer referrals per person',
        help: 'After this many rewarded invites a customer earns nothing more. Food and Quick only: Taxi has no cap. Unset keeps each service’s own limit.',
    },
    'referral.partnerReward': {
        type: 'number',
        default: null,
        min: 0,
        scopes: GLOBAL_AND_VERTICAL,
        label: 'Reward for referring a rider or driver',
        help: 'Credited to the rider or driver who brought in a new one. 0 switches these rewards off. Unset keeps what each service pays today.',
    },
    'referral.partnerLimit': {
        type: 'number',
        default: null,
        min: 1,
        scopes: GLOBAL_AND_VERTICAL,
        label: 'Most rewarded rider or driver referrals per person',
        help: 'Food and Quick riders only: Taxi has no cap. Unset keeps each service’s own limit.',
    },

    // --- assignment ----------------------------------------------------------
    'assignment.maxConcurrentJobs': {
        type: 'number',
        default: 1,
        min: 1,
        max: 5,
        scopes: ALL_SCOPES,
        label: 'Maximum concurrent jobs',
        help: 'How many jobs one partner may hold at once. 1 is no stacking.',
    },
    'assignment.maxDistanceKm': {
        type: 'number',
        default: null,
        min: 1,
        scopes: NOT_PER_PARTNER,
        label: 'Assignment radius (km)',
        help: 'Unset by default, deliberately: each vertical still manages its own radius and they are not comparable. Food searches 15km from the restaurant; taxi widens through 2.5km to 15km and up to 50km intercity. A single engine-level figure of 15 would have reported every legitimate intercity ride as out of range. Set this only once the verticals hand their radius over.',
    },
    'assignment.refuseUnknownLocation': {
        type: 'boolean',
        default: false,
        scopes: NOT_PER_PARTNER,
        label: 'Refuse partners with a stale position',
        help: 'On, a partner whose last GPS fix is older than the staleness window is not offered work rather than being assumed nearby.',
    },
    'assignment.staleLocationMs': {
        type: 'number',
        default: 10 * 60 * 1000,
        min: 30_000,
        scopes: NOT_PER_PARTNER,
        label: 'Position staleness window (ms)',
    },

    // --- order batching (core/delivery/batching.js) -------------------------
    'batching.enabled': {
        type: 'boolean',
        default: false,
        scopes: NOT_PER_PARTNER,
        label: 'Give a rider a second order on the same trip',
        help: 'Food, Quick and Medical. A rider on the way to a store can be offered another order from the same or a nearby store going the same way. Off: one order per rider.',
    },
    'batching.maxOrders': {
        type: 'number',
        default: 2,
        min: 2,
        max: 3,
        scopes: NOT_PER_PARTNER,
        label: 'Most orders on one trip',
    },
    'batching.pickupRadiusM': {
        type: 'number',
        default: 500,
        min: 0,
        max: 3000,
        scopes: NOT_PER_PARTNER,
        label: 'Stores at most this far apart (metres)',
        help: '0 means the same store only.',
    },
    'batching.dropRadiusKm': {
        type: 'number',
        default: 3,
        min: 0.2,
        max: 15,
        scopes: NOT_PER_PARTNER,
        label: 'Drops at most this far apart (km)',
    },
    'batching.maxWaitMinutes': {
        type: 'number',
        default: 10,
        min: 1,
        max: 60,
        scopes: NOT_PER_PARTNER,
        label: 'Only within this many minutes of the first order being accepted',
        help: 'Keeps the first customer from waiting on a long detour.',
    },

    // --- partner rules -------------------------------------------------------
    'partner.requireKyc': {
        type: 'boolean',
        default: false,
        scopes: NOT_PER_PARTNER,
        label: 'Require completed KYC',
    },

    // --- platform ------------------------------------------------------------
    'platform.maintenanceMode': {
        type: 'boolean',
        default: false,
        scopes: GLOBAL_ONLY,
        label: 'Maintenance mode',
        help: 'Global by nature. A per-partner maintenance override would be an override that does nothing.',
    },
});

export const isKnownKey = (key) => Object.prototype.hasOwnProperty.call(SETTINGS, key);

export const definitionOf = (key) => (isKnownKey(key) ? SETTINGS[key] : null);

/**
 * Coerce and validate a value for a key. Returns the value to store.
 * Throws with a message an operator can act on -- these surface in the panel.
 */
export function coerce(key, raw) {
    const def = definitionOf(key);
    if (!def) {
        // An unknown key is refused rather than stored. A typo that silently
        // persists is a setting somebody will later swear they changed.
        const err = new Error(`Unknown setting "${key}"`);
        err.statusCode = 400;
        throw err;
    }

    // Explicit null clears an override at this level, which is different from
    // setting it to zero. Preserved rather than coerced.
    if (raw === null || raw === undefined || raw === '') return null;

    if (def.type === 'boolean') {
        if (typeof raw === 'boolean') return raw;
        const s = String(raw).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(s)) return true;
        if (['0', 'false', 'no', 'off'].includes(s)) return false;
        const err = new Error(`"${key}" must be true or false`);
        err.statusCode = 400;
        throw err;
    }

    if (def.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
            const err = new Error(`"${key}" must be a number`);
            err.statusCode = 400;
            throw err;
        }
        if (def.min !== undefined && n < def.min) {
            const err = new Error(`"${key}" must be at least ${def.min}`);
            err.statusCode = 400;
            throw err;
        }
        if (def.max !== undefined && n > def.max) {
            const err = new Error(`"${key}" must be at most ${def.max}`);
            err.statusCode = 400;
            throw err;
        }
        return n;
    }

    /*
     * Structured values (the earning table, the incentive rule) validate through
     * the key's own `validate`, which also NORMALISES: it returns the shape that
     * gets stored, so a table saved from the panel and one saved by a script are
     * the same rows in the same order. Without that the store keeps whatever was
     * posted, and pricing has to defend against every variation of it.
     */
    if (def.type === 'object') {
        let value = raw;
        if (typeof value === 'string') {
            try {
                value = JSON.parse(value);
            } catch {
                const err = new Error(`"${key}" must be valid JSON`);
                err.statusCode = 400;
                throw err;
            }
        }
        if (typeof def.validate !== 'function') return value;
        try {
            return def.validate(value);
        } catch (e) {
            const err = new Error(e.message);
            err.statusCode = 400;
            throw err;
        }
    }

    return raw;
}

/**
 * May this key be set at this level?
 *
 * Refusing here rather than silently storing it is the point: a partner-level row
 * for a global-only key would sit in the database looking like an override and
 * never win anything, which is worse than an error.
 */
export function assertScopeAllowed(key, level) {
    const def = definitionOf(key);
    if (!def) {
        const err = new Error(`Unknown setting "${key}"`);
        err.statusCode = 400;
        throw err;
    }
    if (!def.scopes.includes(level)) {
        const err = new Error(
            `"${key}" cannot be set at the ${level} level. Allowed: ${def.scopes.join(', ')}`,
        );
        err.statusCode = 400;
        throw err;
    }
    return true;
}

export const defaultsFor = (keys) =>
    Object.fromEntries((keys || Object.keys(SETTINGS)).map((k) => [k, definitionOf(k)?.default]));
