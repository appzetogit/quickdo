/**
 * The fare for a ride, from its vehicle's price row.
 *
 * One calculation, used by the booking (rideService.createRideRecord) and by the
 * quote the app shows before booking (POST /rides/quote), so the figure a rider
 * confirms and the figure they are charged cannot drift apart. The app used to
 * run its own copy of this, which disagreed in three ways -- it charged time
 * inside the base distance, and knew nothing of the platform fee or surge -- and
 * fell back to another vehicle's rates when a vehicle had none.
 *
 * The rules, exactly as the booking has always charged them:
 *   - Within the base distance the fare is the base price alone.
 *   - Past it: base + (km past the base) x per-km + minutes x per-minute.
 *   - Service tax on that subtotal, then the platform fee on top, untaxed.
 *   - Rounded to a whole rupee, then the zone's surge added.
 *
 * Returns null when there is nothing to charge from: no row, or a row whose
 * prices are all zero. A caller must refuse the ride then -- never fall back to
 * a figure the app sent.
 */
import { resolvePlatformFee } from './platformFee.js';

const money = (value) => Math.round(value * 100) / 100;

export function computeRideFare({
    pricingRule,
    transportType = 'taxi',
    distanceMeters = 0,
    durationMinutes = 0,
    surgeAmount = 0,
} = {}) {
    if (!pricingRule) return null;

    const isIntercity = String(transportType || '').trim().toLowerCase() === 'intercity';
    const rate = (outstation, local) =>
        Math.max(0, Number(pricingRule[isIntercity ? outstation : local] || 0));

    const basePrice = rate('outstation_base_price', 'base_price');
    const baseDistanceKm = rate('outstation_base_distance', 'base_distance');
    const perKm = rate('outstation_price_per_distance', 'price_per_distance');
    const perMinute = rate('outstation_time_price', 'time_price');
    const serviceTaxPercent = Math.max(0, Number(pricingRule.service_tax || 0));

    const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
    const minutes = Math.max(0, Number(durationMinutes) || 0);
    const withinBase = baseDistanceKm > 0 && distanceKm <= baseDistanceKm;

    const distanceFare = withinBase ? 0 : Math.max(0, distanceKm - baseDistanceKm) * perKm;
    const timeFare = withinBase ? 0 : minutes * perMinute;
    const subtotal = basePrice + distanceFare + timeFare;
    if (!(subtotal > 0)) return null;

    const serviceTax = (subtotal * serviceTaxPercent) / 100;
    const platformFee = resolvePlatformFee(pricingRule, subtotal);
    const fareBeforeSurge = Math.max(0, Math.round(subtotal + serviceTax + platformFee));
    const surge = money(Math.max(0, Number(surgeAmount) || 0));

    const lines = {
        baseFare: money(basePrice),
        distanceFare: money(distanceFare),
        timeFare: money(timeFare),
        serviceTax: money(serviceTax),
        platformFee: money(platformFee),
    };
    // Taken against the printed lines rather than the unrounded sum, so the
    // rows a rider sees add up to the total to the paisa.
    const printed = Object.values(lines).reduce((sum, value) => sum + value, 0);

    return {
        ...lines,
        subtotal: money(subtotal),
        serviceTaxPercent,
        roundOff: money(fareBeforeSurge - printed),
        fareBeforeSurge,
        surge,
        total: money(fareBeforeSurge + surge),
    };
}
