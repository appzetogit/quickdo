/**
 * Split one amount between several parts in proportion to their weights, to the
 * paisa, so the parts always add back to exactly the whole.
 *
 * Used by the multi-seller checkout (plan §5.1): one delivery fee, one platform
 * fee, one coupon and one loyalty redemption on the parent order are shared out
 * between its per-store child orders by each child's item value. Each child keeps
 * its share, so a refund or cancellation of one child gives back exactly that
 * child's part -- and the shares of all children always equal what the customer
 * was charged.
 *
 * Largest remainder in integer paise: floor every share, then hand the paise left
 * over to the parts with the biggest fractional remainders (ties to the earlier
 * part, so the result is deterministic).
 *
 * @param {number} total   rupees to split (>= 0)
 * @param {number[]} weights  one per part (>= 0). All zero splits evenly.
 * @returns {number[]} rupees per part, same order as weights
 */
export function splitProRata(total, weights = []) {
    const n = Array.isArray(weights) ? weights.length : 0;
    if (n === 0) return [];
    const totalPaise = Math.max(0, Math.round((Number(total) || 0) * 100));
    const w = weights.map((x) => Math.max(0, Number(x) || 0));
    let sum = w.reduce((a, b) => a + b, 0);
    const basis = sum > 0 ? w : w.map(() => 1);
    if (sum <= 0) sum = n;

    const exact = basis.map((x) => (totalPaise * x) / sum);
    const floors = exact.map((x) => Math.floor(x));
    let left = totalPaise - floors.reduce((a, b) => a + b, 0);
    const order = exact
        .map((x, i) => ({ i, rem: x - Math.floor(x) }))
        .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
    for (let k = 0; left > 0 && k < order.length; k += 1, left -= 1) {
        floors[order[k].i] += 1;
    }
    return floors.map((p) => p / 100);
}

/** Integer split for points (whole points, same largest-remainder rule). */
export function splitProRataInt(total, weights = []) {
    return splitProRata(Math.max(0, Math.round(Number(total) || 0)) / 100, weights).map((r) => Math.round(r * 100));
}
