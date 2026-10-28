import { logger } from '../../utils/logger.js';

/**
 * The delivery formula: what the customer pays and what the rider earns, as two
 * separate lines an admin can read.
 *
 *     customer pays  = base fee for the first N km  + per km after that
 *     rider earns    = base pay for the first N km  + per km after that
 *     platform keeps = the difference
 *
 * It replaces the distance-band table (deliveryEarnings.service.js), whose
 * columns meant different things depending on each other: "per km" was the
 * CUSTOMER's rate, applied to the whole trip only when the flat fee was 0; an
 * "extra per km" was added on top; and the rider's pay was the base payout plus
 * the customer's fee minus a commission % set on another screen (food), or a
 * base-or-per-km rule of its own (quick commerce). Here both sides are set
 * directly and every module pays the same way.
 *
 * Distance bands are still available (mode 'bands') for pricing that genuinely
 * changes with distance. Each band is the same two lines, measured from the
 * band's start: fee + per km past `fromKm`.
 *
 * Key `earnings.formula` in Master settings, scoped zone > vertical > global
 * like every other setting. Until someone saves one, resolveDeliveryFormula
 * returns null and each module keeps its old table exactly as before.
 */

export const FORMULA_KEY = 'earnings.formula';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const km0 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

function money(v, label) {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be 0 or more`);
    return round2(n);
}
function optionalMoney(v, label) {
    if (v === null || v === undefined || v === '') return null;
    return money(v, label);
}

function side(raw = {}, who) {
    return {
        base: money(raw.base, `${who}: base`),
        includedKm: money(raw.includedKm, `${who}: km covered by the base`),
        perKm: money(raw.perKm, `${who}: per km`),
    };
}

/** Validates and cleans a formula; used by the settings registry on save. */
export function normalizeFormula(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('The delivery formula is missing');
    const mode = raw.mode === 'bands' ? 'bands' : 'simple';
    const out = {
        mode,
        customer: side(raw.customer, 'Customer'),
        rider: side(raw.rider, 'Rider'),
        minFee: optionalMoney(raw.minFee, 'Minimum delivery fee'),
        maxFee: optionalMoney(raw.maxFee, 'Maximum delivery fee'),
        bands: [],
    };
    if (out.minFee !== null && out.maxFee !== null && out.maxFee < out.minFee) {
        throw new Error('The maximum delivery fee must be at least the minimum');
    }
    if (mode === 'bands') {
        const rows = Array.isArray(raw.bands) ? raw.bands : [];
        if (!rows.length) throw new Error('Add at least one distance band');
        out.bands = rows
            .map((r, i) => {
                const at = `Band ${i + 1}`;
                const fromKm = money(r?.fromKm, `${at}: from`);
                const toKm = r?.toKm === null || r?.toKm === undefined || r?.toKm === '' ? null : money(r.toKm, `${at}: to`);
                if (toKm !== null && toKm <= fromKm) throw new Error(`${at}: "to" must be more than "from"`);
                return {
                    fromKm,
                    toKm,
                    customerFee: money(r?.customerFee, `${at}: customer fee`),
                    customerPerKm: money(r?.customerPerKm, `${at}: customer per km`),
                    riderPay: money(r?.riderPay, `${at}: rider pay`),
                    riderPerKm: money(r?.riderPerKm, `${at}: rider per km`),
                };
            })
            .sort((a, b) => a.fromKm - b.fromKm);
        if (out.bands[0].fromKm !== 0) throw new Error('The first band must start at 0 km');
        for (let i = 1; i < out.bands.length; i += 1) {
            const prev = out.bands[i - 1];
            if (prev.toKm === null) throw new Error(`Band ${i}: only the last band can be open ended`);
            if (out.bands[i].fromKm !== prev.toKm) {
                throw new Error(`Band ${i + 1} must start where band ${i} ends (${prev.toKm} km)`);
            }
        }
    }
    return out;
}

/** The band a trip falls in: the one containing it, else the last one (open ended or not). */
function bandFor(bands, km) {
    return bands.find((b) => km >= b.fromKm && (b.toKm === null || km < b.toKm)) || bands[bands.length - 1];
}

/**
 * What a trip of `distanceKm` costs the customer and pays the rider.
 * @returns {{customerFee:number, riderPay:number, platformKeeps:number, distanceKm:number, band:object|null}}
 */
export function priceDelivery(formula, distanceKm) {
    const km = round2(km0(distanceKm));
    let fee;
    let pay;
    let band = null;
    if (formula?.mode === 'bands' && Array.isArray(formula.bands) && formula.bands.length) {
        band = bandFor(formula.bands, km);
        const past = Math.max(0, km - band.fromKm);
        fee = band.customerFee + band.customerPerKm * past;
        pay = band.riderPay + band.riderPerKm * past;
    } else {
        const c = formula?.customer || {};
        const r = formula?.rider || {};
        fee = (Number(c.base) || 0) + (Number(c.perKm) || 0) * Math.max(0, km - (Number(c.includedKm) || 0));
        pay = (Number(r.base) || 0) + (Number(r.perKm) || 0) * Math.max(0, km - (Number(r.includedKm) || 0));
    }
    if (formula?.minFee != null) fee = Math.max(fee, Number(formula.minFee));
    if (formula?.maxFee != null) fee = Math.min(fee, Number(formula.maxFee));
    fee = round2(fee);
    pay = round2(pay);
    return { customerFee: fee, riderPay: pay, platformKeeps: round2(fee - pay), distanceKm: km, band };
}

/**
 * The formula in force for a module (and zone), or null when none has been
 * saved at any level -- the caller then keeps its old table.
 * @returns {Promise<{formula:object, source:string, level:string}|null>}
 */
export async function resolveDeliveryFormula({ vertical, zoneId } = {}) {
    try {
        const { get } = await import('../config/resolver.service.js');
        const row = await get(FORMULA_KEY, {
            vertical: vertical || undefined,
            zoneId: zoneId ? String(zoneId) : undefined,
        });
        if (!row || row.isDefault || !row.value) return null;
        return { formula: normalizeFormula(row.value), source: row.source, level: row.level };
    } catch (err) {
        // A settings read must never be the reason an order cannot be priced.
        logger.warn(`deliveryFormula: settings read failed, using the module's own table: ${err.message}`);
        return null;
    }
}

/**
 * Today's band table written as a formula, so switching changes nothing until
 * the admin edits a number. Exact for the fee side. The rider side follows each
 * module's old rule: food paid base payout + the customer fee less its per-band
 * commission %; quick commerce paid the base pay, else per km over the trip.
 *
 * @param {Array} slabs      engine-shaped bands (deliveryEarnings.service.js)
 * @param {object} [opts]
 * @param {'food'|'quickCommerce'} [opts.riderRule]
 * @param {Object<string, number>} [opts.commissionPercentByBand] food's per-band commission, by band id
 */
export function formulaFromSlabs(slabs, { riderRule = 'food', commissionPercentByBand = {} } = {}) {
    const rows = (Array.isArray(slabs) ? slabs : [])
        .map((s) => ({ ...s, minDistance: Number(s.minDistance) || 0 }))
        .sort((a, b) => a.minDistance - b.minDistance);
    if (!rows.length) return null;
    const bands = rows.map((s, i) => {
        const fromKm = i === 0 ? 0 : s.minDistance;
        const next = rows[i + 1];
        const toKm = next ? next.minDistance : (s.maxDistance == null ? null : Number(s.maxDistance));
        const flat = Number(s.userDeliveryFee) || 0;
        const perKm = Number(s.commissionPerKm) || 0;
        const extra = Number(s.extraPerKm) || 0;
        // Old fee: the flat fee, or per km over the WHOLE trip; plus extra past the band start.
        const customerFee = flat > 0 ? flat : perKm * fromKm;
        const customerPerKm = (flat > 0 ? 0 : perKm) + extra;
        let riderPay;
        let riderPerKm;
        if (riderRule === 'quickCommerce') {
            const base = Number(s.basePayout) || 0;
            riderPay = base > 0 ? base : perKm * fromKm;
            riderPerKm = (base > 0 ? 0 : perKm) + extra;
        } else {
            const share = 1 - (Number(commissionPercentByBand[String(s.distanceRuleId || s._id || '')]) || 0) / 100;
            riderPay = (Number(s.basePayout) || 0) + customerFee * share;
            riderPerKm = customerPerKm * share;
        }
        return {
            fromKm: round2(fromKm),
            toKm: toKm === null ? null : round2(toKm),
            customerFee: round2(customerFee),
            customerPerKm: round2(customerPerKm),
            riderPay: round2(riderPay),
            riderPerKm: round2(riderPerKm),
        };
    });
    // The last band is open ended: trips past it used to price at its rate anyway.
    bands[bands.length - 1].toKm = null;
    if (bands.length === 1) {
        const b = bands[0];
        return {
            mode: 'simple',
            customer: { base: b.customerFee, includedKm: 0, perKm: b.customerPerKm },
            rider: { base: b.riderPay, includedKm: 0, perKm: b.riderPerKm },
            minFee: null,
            maxFee: null,
            bands: [],
        };
    }
    return {
        mode: 'bands',
        customer: { base: 0, includedKm: 0, perKm: 0 },
        rider: { base: 0, includedKm: 0, perKm: 0 },
        minFee: null,
        maxFee: null,
        bands,
    };
}
