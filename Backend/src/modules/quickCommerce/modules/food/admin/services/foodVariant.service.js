import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

const toTrimmedString = (value) => (value == null ? '' : String(value).trim());

const toNonNegativeNumber = (value, fallback = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
};

/**
 * Stock fields on a variant. `undefined` means "the caller did not send it",
 * which is every existing edit form: those keep the saved value (see
 * carryVariantStock). `null` means untracked, a number is units on hand.
 */
const stockInput = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) throw new ValidationError('Stock must be 0 or more');
    return n;
};

/** GST % on a variant: undefined = not sent (keep), null/'' = use the product's rate. */
const gstInput = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ValidationError('GST rate must be between 0 and 100');
    return n;
};

/**
 * Keep the stock of variants the form did not mention. Matched by id, then by
 * name, so a form that re-creates variants without ids does not reset stock.
 */
const carryVariantStock = (variant, existing = []) => {
    const match = (existing || []).find((e) => e?._id && variant._id && String(e._id) === String(variant._id))
        || (existing || []).find((e) => toTrimmedString(e?.name).toLowerCase() === variant.name.toLowerCase());
    if (!match) return variant;
    if (variant._id === undefined && match._id) variant._id = match._id;
    for (const key of ['stockQty', 'lowStockThreshold', 'gstRate']) {
        if (variant[key] === undefined && match[key] !== undefined) variant[key] = match[key];
    }
    if (variant.sku === undefined && match.sku) variant.sku = match.sku;
    return variant;
};

export const extractRawFoodVariants = (value = {}) => {
    if (Array.isArray(value?.variants)) return value.variants;
    if (Array.isArray(value?.variations)) return value.variations;
    return [];
};

export const normalizeFoodVariantsInput = (value = [], options = {}) => {
    const {
        allowEmpty = true,
        priceLabel = 'Variant price',
        existing = []
    } = options;

    if (value == null || value === '') {
        if (allowEmpty) return [];
        throw new ValidationError('At least one variant is required');
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('Variants must be an array');
    }

    const normalized = value
        .map((entry = {}) => {
            const name = toTrimmedString(entry?.name);
            if (!name) {
                throw new ValidationError('Each variant must have a name');
            }

            const price = Number(entry?.price);
            if (!Number.isFinite(price) || price <= 0) {
                throw new ValidationError(`${priceLabel} must be greater than 0`);
            }

            const variant = {
                name,
                price,
                otherPrice: toNonNegativeNumber(entry?.otherPrice, 0)
            };

            const variantId = entry?._id || entry?.id;
            if (variantId && mongoose.Types.ObjectId.isValid(String(variantId))) {
                variant._id = new mongoose.Types.ObjectId(String(variantId));
            }

            const stockQty = stockInput(entry?.stockQty);
            if (stockQty !== undefined) variant.stockQty = stockQty;
            const low = stockInput(entry?.lowStockThreshold);
            if (low !== undefined) variant.lowStockThreshold = low;
            if (entry?.sku !== undefined) variant.sku = toTrimmedString(entry.sku);
            const gst = gstInput(entry?.gstRate);
            if (gst !== undefined) variant.gstRate = gst;

            return carryVariantStock(variant, existing);
        })
        .filter(Boolean);

    if (!allowEmpty && normalized.length === 0) {
        throw new ValidationError('At least one variant is required');
    }

    return normalized;
};

export const serializeFoodVariants = (value = []) =>
    (Array.isArray(value) ? value : [])
        .map((entry = {}) => {
            const name = toTrimmedString(entry?.name);
            const price = Number(entry?.price);
            if (!name || !Number.isFinite(price) || price <= 0) return null;

            const variantId = entry?._id || entry?.id;
            return {
                id: variantId ? String(variantId) : '',
                _id: variantId ? String(variantId) : '',
                name,
                price,
                otherPrice: toNonNegativeNumber(entry?.otherPrice, 0),
                // Stock per variant. null = not tracked (always sellable).
                stockQty: entry?.stockQty ?? null,
                lowStockThreshold: entry?.lowStockThreshold ?? null,
                sku: toTrimmedString(entry?.sku),
                // GST % for this size; null = the product's rate.
                gstRate: entry?.gstRate ?? null,
                inStock: entry?.stockQty == null || Number(entry.stockQty) > 0
            };
        })
        .filter(Boolean);

export const hasFoodVariants = (value = {}) => serializeFoodVariants(value?.variants || value?.variations || []).length > 0;

export const getFoodDisplayPrice = (value = {}) => {
    const variants = serializeFoodVariants(value?.variants || value?.variations || []);
    if (variants.length > 0) {
        return Math.min(...variants.map((entry) => Number(entry.price) || 0));
    }

    const price = Number(value?.price);
    return Number.isFinite(price) ? price : 0;
};

export const getFoodDisplayOtherPrice = (value = {}) => {
    const variants = serializeFoodVariants(value?.variants || value?.variations || []);
    if (variants.length > 0) {
        const validOtherPrices = variants
            .map((entry) => Number(entry.otherPrice) || 0)
            .filter((p) => p > 0);
        return validOtherPrices.length > 0 ? Math.min(...validOtherPrices) : 0;
    }

    const otherPrice = Number(value?.otherPrice);
    if (Number.isFinite(otherPrice) && otherPrice > 0) {
        return otherPrice;
    }

    return 0;
};
