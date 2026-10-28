/**
 * Platform fee charged to the customer on a ride.
 *
 * Shown in the admin panel as "Platform Fee" on a vehicle's set-price row, and on
 * the package-price screen. Stored as `admin_commision` / `admin_commision_type`
 * rather than renamed, because those keys are already written by the seller apps
 * and the package pricing rows; renaming them would be a data migration for a
 * label change.
 *
 * It used to be stored and echoed to the apps but never charged -- the fare was
 * the ride subtotal plus service tax and nothing else -- so whatever an admin
 * typed here made no difference to what a customer paid.
 *
 * Type follows the convention the rest of the module already stores:
 *   1 = percentage of the ride subtotal
 *   0 = flat amount
 * The admin panel's "Fixed" option used to submit 2, which matched neither, so a
 * fee saved as fixed could not be read back as fixed. It submits 0 now; anything
 * that is not 1 is still treated as a flat amount, so rows already stored with 2
 * behave the way the admin who typed them intended.
 */

/**
 * @param {object} pricingRule vehicle pricing row (admin_commision, admin_commision_type)
 * @param {number} subtotal ride subtotal, before service tax
 * @returns {number} fee amount, never negative
 */
export function resolvePlatformFee(pricingRule, subtotal) {
    const value = Number(pricingRule?.admin_commision);
    if (!Number.isFinite(value) || value <= 0) return 0;

    const type = Number(pricingRule?.admin_commision_type ?? 1);
    const base = Number.isFinite(Number(subtotal)) ? Math.max(0, Number(subtotal)) : 0;

    const fee = type === 1 ? (base * value) / 100 : value;
    return Number.isFinite(fee) && fee > 0 ? fee : 0;
}
