import mongoose from 'mongoose';
import { RecentSearch } from './recentSearch.model.js';

/**
 * Search-as-you-type (plan §5.5), for any vertical's catalogue.
 *
 * Prefix match on product, category and brand names, ranked by popularity --
 * how many units of a product, a category or a brand were ordered in the last
 * `days` -- then by the closer, shorter name. Popularity is one aggregation
 * over the vertical's orders, cached for a few minutes: it moves slowly and
 * this runs on every keystroke.
 *
 * The vertical passes its own models (quick commerce today), so the logic is
 * shared and the collections stay each vertical's own.
 */

const POPULARITY_TTL_MS = 10 * 60 * 1000;
const popularityCache = new Map();

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Starts the name, or starts any word in it ("milk" finds "Amul Milk"). */
export function prefixRegex(q) {
    const term = escapeRegex(String(q || '').trim().replace(/\s+/g, ' '));
    return new RegExp(`(^|\\s)${term}`, 'i');
}

export function normalizeQuery(q) {
    return String(q || '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

/**
 * Units ordered per product id, category id and brand over the last `days`.
 * Cancelled and unpaid orders do not count.
 */
export async function popularityFor(OrderModel, { days = 90, now = Date.now(), fresh = false } = {}) {
    const key = `${OrderModel.collection.name}:${days}`;
    const hit = popularityCache.get(key);
    if (!fresh && hit && hit.expiresAt > now) return hit.value;
    const since = new Date(now - days * 86400000);
    const rows = await OrderModel.aggregate([
        {
            $match: {
                createdAt: { $gte: since },
                orderStatus: { $nin: ['pending_payment', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'] },
            },
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: { item: '$items.itemId', category: '$items.categoryId', brand: '$items.brand' },
                units: { $sum: { $ifNull: ['$items.quantity', 1] } },
            },
        },
    ]);
    const value = { items: new Map(), categories: new Map(), brands: new Map() };
    const add = (map, k, n) => {
        if (k) map.set(String(k), (map.get(String(k)) || 0) + n);
    };
    for (const r of rows) {
        add(value.items, r._id.item, r.units);
        add(value.categories, r._id.category, r.units);
        add(value.brands, r._id.brand ? String(r._id.brand).toLowerCase() : '', r.units);
    }
    popularityCache.set(key, { value, expiresAt: now + POPULARITY_TTL_MS });
    return value;
}

export const __clearPopularityCache = () => popularityCache.clear();

/** Popular first; then names the query starts; then shorter names. */
export function rankSuggestions(list, q) {
    const lower = String(q || '').toLowerCase();
    return [...list].sort((a, b) =>
        (b.popularity - a.popularity)
        || (Number(b.text.toLowerCase().startsWith(lower)) - Number(a.text.toLowerCase().startsWith(lower)))
        || (a.text.length - b.text.length)
        || a.text.localeCompare(b.text));
}

/**
 * @param {object} opts
 *   q, limit
 *   ItemModel, CategoryModel, OrderModel   the vertical's models
 *   itemFilter, categoryFilter             extra conditions (approved, live, zone)
 */
export async function suggest({ q, limit = 10, ItemModel, CategoryModel, OrderModel, itemFilter = {}, categoryFilter = {} }) {
    const query = normalizeQuery(q);
    if (!query) return { query, suggestions: [] };
    const rx = prefixRegex(query);
    const cap = Math.min(Math.max(Number(limit) || 10, 1), 25);

    const [pop, items, categories, brands] = await Promise.all([
        popularityFor(OrderModel),
        ItemModel.find({ ...itemFilter, name: rx })
            .select('_id name image images brand restaurantId categoryId')
            .limit(60)
            .lean(),
        CategoryModel
            ? CategoryModel.find({ ...categoryFilter, name: rx }).select('_id name image').limit(30).lean()
            : [],
        ItemModel.aggregate([
            { $match: { ...itemFilter, brand: { $regex: rx } } },
            { $group: { _id: { $toLower: '$brand' }, brand: { $first: '$brand' }, products: { $sum: 1 } } },
            { $limit: 30 },
        ]),
    ]);

    // One entry per product name: the same product sold by five stores is one suggestion.
    const byName = new Map();
    for (const it of items) {
        const k = it.name.toLowerCase();
        const p = pop.items.get(String(it._id)) || 0;
        const prev = byName.get(k);
        if (prev) {
            prev.popularity += p;
            continue;
        }
        byName.set(k, {
            type: 'product',
            id: String(it._id),
            text: it.name,
            image: it.image || it.images?.[0] || '',
            brand: it.brand || '',
            storeId: it.restaurantId ? String(it.restaurantId) : null,
            categoryId: it.categoryId ? String(it.categoryId) : null,
            popularity: p,
        });
    }
    const catRows = new Map();
    for (const c of categories) {
        const k = c.name.toLowerCase();
        const p = pop.categories.get(String(c._id)) || 0;
        if (catRows.has(k)) {
            catRows.get(k).popularity += p;
            continue;
        }
        catRows.set(k, { type: 'category', id: String(c._id), text: c.name, image: c.image || '', popularity: p });
    }
    const brandRows = brands
        .filter((b) => b._id)
        .map((b) => ({ type: 'brand', id: b._id, text: b.brand, products: b.products, popularity: pop.brands.get(b._id) || 0 }));

    const ranked = rankSuggestions([...byName.values(), ...catRows.values(), ...brandRows], query);
    return { query, suggestions: ranked.slice(0, cap) };
}

/* ---------------------------------------------------------- recent searches */

const MAX_RECENT = 15;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

export async function recordRecentSearch(userId, vertical, term, now = new Date()) {
    const t = normalizeQuery(term);
    if (!isId(userId) || !t || t.length < 2) return listRecentSearches(userId, vertical);
    const _id = new mongoose.Types.ObjectId(String(userId));
    // Drop any older copy (case-insensitively), then put it first and cap the list.
    await RecentSearch.updateOne(
        { userId: _id, vertical },
        { $pull: { terms: { term: new RegExp(`^${escapeRegex(t)}$`, 'i') } } },
    );
    await RecentSearch.updateOne(
        { userId: _id, vertical },
        { $push: { terms: { $each: [{ term: t, at: now }], $position: 0, $slice: MAX_RECENT } } },
        { upsert: true },
    );
    return listRecentSearches(userId, vertical);
}

export async function listRecentSearches(userId, vertical) {
    if (!isId(userId)) return [];
    const row = await RecentSearch.findOne({ userId: new mongoose.Types.ObjectId(String(userId)), vertical }).lean();
    return (row?.terms || []).map((x) => ({ term: x.term, at: x.at }));
}

export async function clearRecentSearches(userId, vertical, term = null) {
    if (!isId(userId)) return [];
    const _id = new mongoose.Types.ObjectId(String(userId));
    if (term) {
        await RecentSearch.updateOne(
            { userId: _id, vertical },
            { $pull: { terms: { term: new RegExp(`^${escapeRegex(normalizeQuery(term))}$`, 'i') } } },
        );
    } else {
        await RecentSearch.deleteOne({ userId: _id, vertical });
    }
    return listRecentSearches(userId, vertical);
}
