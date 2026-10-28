/**
 * Can this seller actually hold this product?
 *
 * A product's `perishability` says what it needs; a seller's `storageCapability` says
 * what the shop has. Nothing checked the two against each other, which is how a
 * kirana store with one shelf ends up listing ice cream: the order is accepted, the
 * goods arrive thawed, and the platform pays for the return under seller fault.
 *
 * Pure, so the rule is testable without a database and lives in exactly one place —
 * the catalogue write path and the seller onboarding screen both need the same
 * answer.
 */

/** Which storage band a perishability level requires. Ambient needs nothing extra. */
const REQUIRED_STORAGE = Object.freeze({
    ambient: null,
    chilled: 'chilled',
    // Frozen goods are modelled as `fresh` produce's colder sibling: the catalogue
    // records perishability, and anything needing a freezer is tagged `fresh` plus an
    // explicit frozen flag on the product. Where that flag is absent, chilled is the
    // safe floor — refusing a listing is recoverable, thawed stock is not.
    fresh: 'chilled',
});

/**
 * @param {object} seller             needs storageCapability
 * @param {object} product            needs perishability, optionally requiresFreezer
 * @returns {{ ok: boolean, reason?: string, required?: string }}
 */
export const canSellerStock = (seller, product) => {
    const perishability = product?.perishability || 'ambient';
    const capability = Array.isArray(seller?.storageCapability) ? seller.storageCapability : [];

    const required = product?.requiresFreezer ? 'frozen' : REQUIRED_STORAGE[perishability];
    if (!required) return { ok: true };

    if (capability.includes(required)) return { ok: true };

    // A freezer satisfies a chilled requirement; a chiller does not satisfy a frozen
    // one. Without this the rule would refuse frozen-capable sellers their chilled
    // lines, which is both wrong and the kind of thing sellers open tickets about.
    if (required === 'chilled' && capability.includes('frozen')) return { ok: true };

    return {
        ok: false,
        required,
        reason: `This product needs ${required} storage, which this store is not set up for. `
            + `Update the store's storage capability before listing it.`,
    };
};

/**
 * Filter a seller's catalogue down to what they can legitimately hold.
 *
 * Used when a store's capability is REDUCED — a broken chiller, a downgraded plan —
 * to find what must come off the shelf, rather than leaving unfulfillable listings up.
 */
export const unstockableProducts = (seller, products = []) => products
    .filter((product) => !canSellerStock(seller, product).ok);
