import { ValidationError } from '../../../core/auth/errors.js';

/**
 * Food packaging charge — single source of truth for how the fee is configured,
 * stored on menu items, and turned into money at checkout.
 *
 * Admin picks who owns the charge (food fee settings -> packagingCharge):
 *   ADMIN      — one flat charge per order, set by admin, kept by the platform.
 *   RESTAURANT — each restaurant sets a per-unit charge on its own menu items
 *                (with a per-item on/off toggle); the money goes to the restaurant.
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
        adminChargePerOrder: Math.max(0, Number(raw.adminChargePerOrder) || 0)
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

    if (!isEnabled) {
        // Keep the amount so toggling back on restores what was typed.
        return { isEnabled: false, amount: Number.isFinite(amount) && amount > 0 ? roundCurrency(amount) : 0 };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError(`Enter a packaging charge for "${label}" or turn the charge off`);
    }
    if (amount > 10000) {
        throw new ValidationError(`Packaging charge for "${label}" is too high`);
    }
    return { isEnabled: true, amount: roundCurrency(amount) };
}

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
        return {
            packagingFee: roundCurrency(packagingConfig.adminChargePerOrder),
            packagingMode: PACKAGING_MODES.ADMIN
        };
    }

    const total = lines.reduce((sum, item) => {
        const perUnit = Math.max(0, Number(item?.foodPackagingCharge) || 0);
        const quantity = Math.max(0, Number(item?.quantity) || 0);
        return sum + perUnit * quantity;
    }, 0);

    return {
        packagingFee: roundCurrency(total),
        packagingMode: PACKAGING_MODES.RESTAURANT
    };
}
