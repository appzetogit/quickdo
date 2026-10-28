/**
 * Combos: several existing dishes sold together as one menu entry at a fixed price.
 *
 * "Burger + Fries + Coke -- Rs 199". The restaurant picks dishes it already sells;
 * a combo never introduces a new dish, it only groups them. Two dishes is the
 * common case and the minimum -- a combo of one is just a dish with a discount,
 * and there are already three ways to do that.
 *
 * This module is pure: no database, no Express, no Mongoose. Everything it needs
 * arrives as arguments, which is what makes the rules below testable in isolation
 * (see __checks__/combo.check.js). The service layer resolves prices and
 * availability from the menu and hands the results in.
 *
 * The one genuinely awkward problem here is splitting money. A combo is charged as
 * a single fixed price, but the platform still has to know what each component was
 * worth: commission is taken per line and the POS is sent per-dish rows. So the
 * fixed price is allocated back across the components in proportion to their list
 * prices, with the rounding remainder handed to one component so the parts always
 * sum to exactly the price the customer paid. Getting that wrong is how a bill
 * ends up a paisa short of itself.
 */

/** A combo of one dish is not a combo. Two is the pair case the menu is built for. */
export const MIN_COMBO_COMPONENTS = 2;

/** Beyond this a "combo" is really a banquet, and the picker becomes unusable. */
export const MAX_COMBO_COMPONENTS = 10;

/** Total units across all components, so 10 x 9 cannot become a 90-dish line. */
export const MAX_COMBO_UNITS = 20;

/** Mirrors MAX_BOGO_OFFERS: a bounded list keeps one document per restaurant. */
export const MAX_COMBOS_PER_RESTAURANT = 25;

const toPositiveInt = (value, fallback = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.floor(n);
    return i > 0 ? i : fallback;
};

const toMoney = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    // Two decimal places. Money in this codebase is rupees-as-Number, so every
    // arithmetic result gets pinned here rather than left to drift.
    return Math.round(n * 100) / 100;
};

const idOf = (value) => (value == null ? '' : String(value));

/**
 * A component identifies a dish that may not exist in the catalogue at all --
 * a manually-typed name has no itemId to key off, so it is keyed by its own
 * name and price instead. Two manual rows with the same name and price are
 * the same "dish" for merge purposes, same as picking a real one twice.
 */
const manualKeyOf = (component = {}) =>
    String(component.manualName || '').trim().toLowerCase() + '::' + (Number(component.manualPrice) || 0);

/**
 * A component is identified by dish AND variant: "Pizza (Small)" and
 * "Pizza (Large)" are different things to buy, so they are different rows and a
 * combo may legitimately contain both. A manual row has no variant, so it is
 * keyed by name and price alone.
 */
export const componentKey = (component = {}) =>
    component.itemId
        ? idOf(component.itemId) + '::' + idOf(component.variantId)
        : 'manual::' + manualKeyOf(component);

/** What "different dishes" counts for the composition rules -- a manual row
 *  counts as its own dish, same as a catalogue one. */
const dishIdentity = (component = {}) => (component.itemId ? idOf(component.itemId) : componentKey(component));

const readMap = (source, key) => {
    if (!source) return undefined;
    if (typeof source.get === 'function') return source.get(key);
    return source[key];
};

/**
 * Clean up whatever the panel sent: coerce quantities, drop rows with neither a
 * dish nor a manual name, and merge duplicates by adding their quantities rather
 * than rejecting them. Someone adding the same dish twice means "two of these",
 * not a mistake.
 *
 * A row is either a catalogue pick (itemId) or a manually-typed one (manualName
 * + manualPrice) -- never both. Manual rows exist for a giveaway or a one-off
 * that never got a menu entry of its own; they carry their own price rather
 * than looking one up, and are always available (see resolveComboAvailability).
 */
export function normalizeComboComponents(rows = []) {
    if (!Array.isArray(rows)) return [];
    const merged = new Map();
    for (const row of rows) {
        const itemId = idOf(row?.itemId ?? row?._id ?? row?.foodId).trim();
        const manualName = itemId ? '' : String(row?.manualName || '').trim();
        let component;
        if (itemId) {
            component = {
                itemId,
                variantId: idOf(row?.variantId).trim() || null,
                quantity: toPositiveInt(row?.quantity, 1),
            };
        } else if (manualName) {
            component = {
                itemId: null,
                variantId: null,
                manualName,
                manualPrice: toMoney(row?.manualPrice),
                quantity: toPositiveInt(row?.quantity, 1),
            };
        } else {
            continue;
        }
        const key = componentKey(component);
        const existing = merged.get(key);
        if (existing) existing.quantity += component.quantity;
        else merged.set(key, component);
    }
    return [...merged.values()];
}

/**
 * Structural rules only -- whether the dishes exist and are sellable is the
 * service's job, since that needs the database.
 *
 * Returns a reason rather than throwing, so the panel can show it inline and the
 * checks can assert on it.
 */
export function validateComboComposition(components = []) {
    const distinctDishes = new Set(components.map(dishIdentity)).size;

    // Distinct dishes first, and the word "different" is doing real work here.
    // normalizeComboComponents merges duplicate rows, so picking the same dish
    // twice arrives as one row of quantity two. Testing row count first would
    // then answer "pick at least 2 dishes" to somebody who just picked two --
    // technically a refusal, but not one that says what is wrong.
    if (distinctDishes < MIN_COMBO_COMPONENTS) {
        return {
            ok: false,
            reason: 'Pick at least ' + MIN_COMBO_COMPONENTS + ' different dishes for a combo.',
        };
    }
    if (components.length > MAX_COMBO_COMPONENTS) {
        return { ok: false, reason: 'A combo can hold at most ' + MAX_COMBO_COMPONENTS + ' dishes.' };
    }
    const units = components.reduce((sum, c) => sum + toPositiveInt(c.quantity, 1), 0);
    if (units > MAX_COMBO_UNITS) {
        return { ok: false, reason: 'A combo can hold at most ' + MAX_COMBO_UNITS + ' items in total.' };
    }
    return { ok: true, reason: '' };
}

/** What the same dishes would cost bought separately. A manual row's price is
 *  whatever was typed for it -- there is no catalogue lookup to fall back on. */
export function computeComponentTotal(components = [], priceByKey = new Map()) {
    let total = 0;
    for (const component of components) {
        const unit = component.itemId
            ? Number(readMap(priceByKey, componentKey(component)) ?? 0)
            : Number(component.manualPrice) || 0;
        if (!Number.isFinite(unit) || unit < 0) continue;
        total += unit * toPositiveInt(component.quantity, 1);
    }
    return toMoney(total);
}

/**
 * The combo price must undercut the component total, otherwise it is not an offer
 * and the "you save" line would read as a negative number on the menu.
 */
export function validateComboPrice(comboPrice, componentTotal) {
    const price = Number(comboPrice);
    if (!Number.isFinite(price) || price <= 0) {
        return { ok: false, reason: 'Set a combo price above zero.' };
    }
    if (!(componentTotal > 0)) {
        return { ok: false, reason: 'These dishes have no price yet, so a combo cannot be priced.' };
    }
    if (price >= componentTotal) {
        return {
            ok: false,
            reason: 'A combo has to be cheaper than its parts. These dishes cost '
                + toMoney(componentTotal) + ' separately.',
        };
    }
    return { ok: true, reason: '' };
}

export function computeComboSaving(componentTotal, comboPrice) {
    const total = toMoney(componentTotal);
    const price = toMoney(comboPrice);
    const amount = toMoney(Math.max(0, total - price));
    const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
    return { componentTotal: total, comboPrice: price, amount, percent };
}

/**
 * A combo is only orderable while every dish inside it is. One sold-out component
 * takes the whole combo off the menu -- shipping two thirds of a combo for the
 * combo price is worse than not offering it at all.
 *
 * `stateByKey` maps a component key to { isAvailable, approvalStatus, name }. A
 * component the menu has never heard of counts as missing, not as available: a
 * deleted dish must not silently drop out of a combo the customer is paying for.
 *
 * A manual row is exempt: it has no catalogue entry that can sell out, go
 * unapproved, or be deleted out from under the combo, so it can never block one.
 */
export function resolveComboAvailability(components = [], stateByKey = new Map()) {
    const blockedBy = [];
    for (const component of components) {
        if (!component.itemId) continue;
        const key = componentKey(component);
        const state = readMap(stateByKey, key);
        if (!state) {
            blockedBy.push({ key, name: 'A removed dish', reason: 'no longer on the menu' });
            continue;
        }
        if (state.approvalStatus && state.approvalStatus !== 'approved') {
            blockedBy.push({ key, name: state.name || 'A dish', reason: 'awaiting approval' });
            continue;
        }
        if (state.isAvailable === false) {
            blockedBy.push({ key, name: state.name || 'A dish', reason: 'unavailable' });
        }
    }
    return { available: blockedBy.length === 0, blockedBy };
}

/**
 * Split the fixed combo price back across the components, in proportion to what
 * each is worth at list price.
 *
 * Pro-rata rather than even: a Rs 250 biryani and a Rs 20 papad should not each
 * absorb half the discount, or the restaurant's own per-dish reporting stops
 * making sense and commission lands in the wrong place.
 *
 * Every share is floored to paise and the leftover is given to the single most
 * expensive component, so the shares sum to the combo price exactly. Spreading the
 * remainder evenly would reintroduce the drift this exists to prevent.
 */
export function allocateComboPrice(components = [], priceByKey = new Map(), comboPrice = 0) {
    const target = toMoney(comboPrice);

    const rows = components.map((component) => {
        const key = componentKey(component);
        const quantity = toPositiveInt(component.quantity, 1);
        const raw = component.itemId
            ? Number(readMap(priceByKey, key) ?? 0)
            : Number(component.manualPrice) || 0;
        const unit = Number.isFinite(raw) && raw > 0 ? raw : 0;
        return { component, key, quantity, unit, lineList: toMoney(unit * quantity), paise: 0 };
    });

    const listTotal = rows.reduce((sum, r) => sum + r.lineList, 0);
    // No usable list prices: fall back to an even split by units, which at least
    // sums correctly and keeps the order priceable.
    const units = rows.reduce((sum, r) => sum + r.quantity, 0) || 1;

    const targetPaise = Math.round(target * 100);
    let allocatedPaise = 0;
    for (const row of rows) {
        const share = listTotal > 0 ? row.lineList / listTotal : row.quantity / units;
        row.paise = Math.floor(targetPaise * share);
        allocatedPaise += row.paise;
    }

    const remainder = targetPaise - allocatedPaise;
    if (remainder !== 0 && rows.length) {
        // Largest line takes the rounding, so the adjustment is proportionally
        // smallest where it lands.
        const biggest = rows.reduce((a, b) => (b.lineList > a.lineList ? b : a), rows[0]);
        biggest.paise += remainder;
    }

    return rows.map((row) => ({
        // Carried through rather than re-derived: a manual row's key depends on
        // manualName/manualPrice, which this output shape does not otherwise keep.
        key: row.key,
        itemId: row.component.itemId,
        variantId: row.component.variantId,
        manualName: row.component.itemId ? '' : row.component.manualName || '',
        quantity: row.quantity,
        listUnitPrice: toMoney(row.unit),
        listLineTotal: row.lineList,
        comboLineTotal: toMoney(row.paise / 100),
        comboUnitPrice: toMoney(row.paise / 100 / row.quantity),
    }));
}

/** Menu copy: "3 items - save Rs 61 (23%)". */
export function describeCombo(components = [], saving = null) {
    const units = components.reduce((sum, c) => sum + toPositiveInt(c.quantity, 1), 0);
    const parts = [units + ' item' + (units === 1 ? '' : 's')];
    if (saving && saving.amount > 0) {
        parts.push('save ₹' + saving.amount + (saving.percent > 0 ? ' (' + saving.percent + '%)' : ''));
    }
    return parts.join(' · ');
}
