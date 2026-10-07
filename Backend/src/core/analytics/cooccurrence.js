/**
 * "Frequently bought together" from order co-occurrence. Pure.
 *
 * For every pair of items that appear in the same order:
 *   count       orders with both
 *   confidence  P(B | A) = count / orders with A
 *   lift        confidence / P(B): above 1 means A makes B more likely than usual
 *
 * Ranked by count, then lift, then name -- count first, so a pair seen twice with
 * a huge lift does not outrank a pair seen in hundreds of orders. Pairs seen
 * fewer than `minSupport` times are dropped as noise.
 *
 * @param {Array<Array<{id: string, name?: string, partnerId?: string}>>} baskets
 * @returns {Map<string, {id, name, partnerId, orders, together: Array<{id, name, count, confidence, lift}>}>}
 */
export function cooccurrence(baskets, { minSupport = 2, topK = 10, maxItemsPerBasket = 30 } = {}) {
    const itemCount = new Map();
    const meta = new Map();
    const pairs = new Map();
    let n = 0;
    for (const raw of baskets || []) {
        const seen = new Map();
        for (const it of raw || []) {
            const id = String(it?.id || '').trim();
            if (id && !seen.has(id)) seen.set(id, it);
        }
        if (!seen.size) continue;
        n += 1;
        const ids = [...seen.keys()].slice(0, maxItemsPerBasket).sort();
        for (const id of ids) {
            itemCount.set(id, (itemCount.get(id) || 0) + 1);
            if (!meta.has(id)) meta.set(id, { name: seen.get(id).name || '', partnerId: seen.get(id).partnerId ? String(seen.get(id).partnerId) : '' });
        }
        for (let i = 0; i < ids.length; i += 1) {
            for (let j = i + 1; j < ids.length; j += 1) {
                const key = `${ids[i]}\u0000${ids[j]}`;
                pairs.set(key, (pairs.get(key) || 0) + 1);
            }
        }
    }

    const together = new Map();
    for (const [key, count] of pairs) {
        if (count < minSupport) continue;
        const [a, b] = key.split('\u0000');
        for (const [x, y] of [[a, b], [b, a]]) {
            const cx = itemCount.get(x);
            const cy = itemCount.get(y);
            const confidence = count / cx;
            const lift = n ? confidence / (cy / n) : 0;
            if (!together.has(x)) together.set(x, []);
            together.get(x).push({ id: y, name: meta.get(y)?.name || '', count, confidence: Math.round(confidence * 1000) / 1000, lift: Math.round(lift * 100) / 100 });
        }
    }

    const out = new Map();
    for (const [id, list] of together) {
        list.sort((p, q) => q.count - p.count || q.lift - p.lift || p.name.localeCompare(q.name));
        out.set(id, { id, name: meta.get(id)?.name || '', partnerId: meta.get(id)?.partnerId || '', orders: itemCount.get(id), together: list.slice(0, topK) });
    }
    return out;
}

/** Grid cell for "popular near you": about 5.5 km squares. */
export const CELL_DEG = 0.05;
export const cellOf = (lat, lng) => {
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
    return `${Math.floor(a / CELL_DEG + 1e-9)}:${Math.floor(b / CELL_DEG + 1e-9)}`;
};
export const neighbourCells = (cell) => {
    const [x, y] = String(cell).split(':').map(Number);
    const out = [];
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) out.push(`${x + dx}:${y + dy}`);
    return out;
};
