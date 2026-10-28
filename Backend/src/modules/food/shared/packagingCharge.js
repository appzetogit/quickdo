import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Food packaging charge — single source of truth for how the fee is configured,
 * stored on menu items, and turned into money at checkout.
 *
 * Admin picks who owns the charge (food fee settings -> packagingCharge):
 *   ADMIN      — a flat charge set by admin, kept by the platform: once per
 *                order, or once per `adminItemsPerCharge` items when that is set.
 *   RESTAURANT — each restaurant sets a charge on its own menu items (with a
 *                per-item on/off toggle) covering `unitsPerCharge` units of
 *                that item; the money goes to the restaurant.
 *
 * "Per N" means blocks: with N = 3, 1-3 units pay one charge, 4-6 two, 7-9
 * three -- ceil(quantity / N) charges. N = 1 is a charge per unit, as before.
 *
 * Nothing here reads client input: order lines are stamped from the DB menu item
 * in resolveAuthoritativeItems before pricing runs.
 */

export const PACKAGING_MODES = {
    ADMIN: 'ADMIN',
    RESTAURANT: 'RESTAURANT'
};

const roundCurrency = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Number(num.toFixed(2));
};

/** Admin config, with safe defaults when fee settings have never been saved. */
export function normalizePackagingConfig(feeSettingsDoc = null) {
    const raw = feeSettingsDoc?.packagingCharge || {};
    const mode =
        String(raw.mode || '').trim().toUpperCase() === PACKAGING_MODES.RESTAURANT
            ? PACKAGING_MODES.RESTAURANT
            : PACKAGING_MODES.ADMIN;

    return {
        isEnabled: raw.isEnabled === true,
        mode,
        adminChargePerOrder: Math.max(0, Number(raw.adminChargePerOrder) || 0),
        adminItemsPerCharge: Math.max(0, Math.floor(Number(raw.adminItemsPerCharge) || 0))
    };
}

/**
 * Menu-item packaging input (restaurant/admin item forms).
 * Returns undefined when the caller didn't touch the field, so partial updates
 * don't wipe a stored value.
 */
export function normalizeItemPackagingChargeInput(raw, { label = 'This item' } = {}) {
    if (raw === undefined || raw === null) return undefined;

    const isEnabled = raw?.isEnabled === true || raw?.isEnabled === 'true';
    const amount = Number(raw?.amount);
    // Undefined when not sent (older app builds), so the caller keeps the stored value.
    const unitsPerCharge = normalizeUnitsPerCharge(raw?.unitsPerCharge, label);

    if (!isEnabled) {
        // Keep the amount so toggling back on restores what was typed.
        return {
            isEnabled: false,
            amount: Number.isFinite(amount) && amount > 0 ? roundCurrency(amount) : 0,
            ...(unitsPerCharge !== undefined ? { unitsPerCharge } : {})
        };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError(`Enter a packaging charge for "${label}" or turn the charge off`);
    }
    if (amount > 10000) {
        throw new ValidationError(`Packaging charge for "${label}" is too high`);
    }
    return { isEnabled: true, amount: roundCurrency(amount), ...(unitsPerCharge !== undefined ? { unitsPerCharge } : {}) };
}

function normalizeUnitsPerCharge(raw, label) {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 999) {
        throw new ValidationError(`"${label}": one packaging charge must cover 1 to 999 units`);
    }
    return n;
}

/** How many units of this item one packaging charge covers (1 = per unit). */
export function resolveItemPackagingUnits(foodDoc = null) {
    const n = Math.floor(Number(foodDoc?.packagingCharge?.unitsPerCharge) || 1);
    return n >= 1 ? n : 1;
}

/** ceil(quantity / perCharge) charges; quantity 0 pays nothing. */
const chargesFor = (quantity, perCharge) =>
    quantity > 0 ? Math.ceil(quantity / Math.max(1, perCharge)) : 0;

/** Per-unit charge a stored menu item contributes; 0 when the item opted out. */
export function resolveItemPackagingAmount(foodDoc = null) {
    const charge = foodDoc?.packagingCharge;
    if (!charge || charge.isEnabled !== true) return 0;
    return Math.max(0, Number(charge.amount) || 0);
}

/**
 * Order-level packaging fee.
 * `items` are checkout lines already stamped with `foodPackagingCharge` (per unit).
 */
export function computeFoodPackagingFee({ items = [], config = null } = {}) {
    const packagingConfig = config || normalizePackagingConfig(null);
    const lines = Array.isArray(items) ? items : [];

    if (!packagingConfig.isEnabled || lines.length === 0) {
        return { packagingFee: 0, packagingMode: '' };
    }

    if (packagingConfig.mode === PACKAGING_MODES.ADMIN) {
        const perOrder = packagingConfig.adminChargePerOrder;
        const every = packagingConfig.adminItemsPerCharge;
        const totalQty = lines.reduce((s, it) => s + Math.max(0, Number(it?.quantity) || 0), 0);
        return {
            packagingFee: roundCurrency(every > 0 ? perOrder * chargesFor(totalQty, every) : perOrder),
            packagingMode: PACKAGING_MODES.ADMIN
        };
    }

    /*
     * One item ordered in two sizes is still one item: its quantities are
     * pooled before the blocks are counted, so 2 small + 1 large of an item at
     * "one charge per 3" pays one charge, not two.
     */
    const pooled = new Map();
    for (const item of lines) {
        const perCharge = Math.max(0, Number(item?.foodPackagingCharge) || 0);
        if (!perCharge) continue;
        const units = Math.max(1, Math.floor(Number(item?.foodPackagingUnits) || 1));
        const key = `${String(item?.itemId || item?.foodId || item?.name || '')}|${perCharge}|${units}`;
        const entry = pooled.get(key) || { perCharge, units, quantity: 0 };
        entry.quantity += Math.max(0, Number(item?.quantity) || 0);
        pooled.set(key, entry);
    }
    let total = 0;
    for (const { perCharge, units, quantity } of pooled.values()) total += perCharge * chargesFor(quantity, units);

    return {
        packagingFee: roundCurrency(total),
        packagingMode: PACKAGING_MODES.RESTAURANT
    };
}
