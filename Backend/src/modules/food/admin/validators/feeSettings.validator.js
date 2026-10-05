import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

// Platform-funded free delivery: a radius AND a minimum basket, both required.
const freeDeliveryRuleSchema = z.object({
    isEnabled: z.boolean().optional(),
    maxDistanceKm: z.number().min(0).max(50).optional(),
    minOrderAmount: z.number().min(0).optional()
});

const rangeSchema = z.object({
    min: z.number().min(0),
    max: z.number().min(0),
    fee: z.number().min(0)
});

const distanceSlabAdminDeliveryCommissionSchema = z.object({
    distanceRuleId: z.string().min(1),
    isEnabled: z.boolean().optional(),
    adminDeliveryCommissionPercent: z.number().min(0).max(100).optional()
});

const deliveryPartnerIncentiveRuleSchema = z.object({
    isEnabled: z.boolean().optional(),
    minOrderAmount: z.number().min(0).optional(),
    incentivePercent: z.number().min(0).max(100).optional()
});

const packagingChargeSchema = z.object({
    isEnabled: z.boolean().optional(),
    mode: z.enum(['ADMIN', 'RESTAURANT']).optional(),
    adminChargePerOrder: z.number().min(0).optional()
});

const otherPlatformPriceSchema = z.object({
    isEnabled: z.boolean().optional(),
    markupPercent: z.number().min(0).max(300).optional(),
    label: z.string().optional()
});

const feeSettingsUpsertSchema = z.object({
    deliveryFee: z.number().min(0).nullable().optional(),
    deliveryFeeRanges: z.array(rangeSchema).optional(),
    deliveryFeeComputationMode: z.enum(['distance_order_value']).optional(),
    distanceSlabAdminDeliveryCommission: z.array(distanceSlabAdminDeliveryCommissionSchema).optional(),
    deliveryPartnerIncentiveRule: deliveryPartnerIncentiveRuleSchema.optional(),
    freeDeliveryThreshold: z.number().min(0).nullable().optional(),
    freeDeliveryRule: freeDeliveryRuleSchema.optional(),
    platformFee: z.number().min(0).nullable().optional(),
    gstRate: z.number().min(0).max(100).nullable().optional(),
    platformFeeGstRate: z.number().min(0).max(100).nullable().optional(),
    codOrderLimit: z.number().min(0).nullable().optional(),
    packagingCharge: packagingChargeSchema.optional(),
    otherPlatformPrice: otherPlatformPriceSchema.optional(),
    isActive: z.boolean().optional()
});

export const validateFeeSettingsUpsertDto = (body) => {
    const normalized = {
        deliveryFee:
            body?.deliveryFee === null
                ? null
                : body?.deliveryFee !== undefined
                    ? Number(body.deliveryFee)
                    : undefined,
        deliveryFeeRanges: Array.isArray(body?.deliveryFeeRanges)
            ? body.deliveryFeeRanges.map((r) => ({
                min: Number(r?.min),
                max: Number(r?.max),
                fee: Number(r?.fee)
            }))
            : undefined,
        deliveryFeeComputationMode:
            body?.deliveryFeeComputationMode !== undefined
                ? String(body.deliveryFeeComputationMode)
                : undefined,
        distanceSlabAdminDeliveryCommission: Array.isArray(body?.distanceSlabAdminDeliveryCommission)
            ? body.distanceSlabAdminDeliveryCommission.map((row) => ({
                distanceRuleId: String(row?.distanceRuleId || ''),
                isEnabled: row?.isEnabled !== undefined ? Boolean(row.isEnabled) : false,
                adminDeliveryCommissionPercent:
                    row?.adminDeliveryCommissionPercent !== undefined
                        ? Number(row.adminDeliveryCommissionPercent)
                        : 0
            }))
            : undefined,
        deliveryPartnerIncentiveRule: body?.deliveryPartnerIncentiveRule
            ? {
                isEnabled: body.deliveryPartnerIncentiveRule.isEnabled !== undefined
                    ? Boolean(body.deliveryPartnerIncentiveRule.isEnabled)
                    : false,
                minOrderAmount: body.deliveryPartnerIncentiveRule.minOrderAmount !== undefined
                    ? Number(body.deliveryPartnerIncentiveRule.minOrderAmount)
                    : 0,
                incentivePercent: body.deliveryPartnerIncentiveRule.incentivePercent !== undefined
                    ? Number(body.deliveryPartnerIncentiveRule.incentivePercent)
                    : 0,
            }
            : undefined,
        freeDeliveryThreshold:
            body?.freeDeliveryThreshold === null
                ? null
                : body?.freeDeliveryThreshold !== undefined
                    ? Number(body.freeDeliveryThreshold)
                    : undefined,
        platformFee:
            body?.platformFee === null ? null : body?.platformFee !== undefined ? Number(body.platformFee) : undefined,
        gstRate:
            body?.gstRate === null ? null : body?.gstRate !== undefined ? Number(body.gstRate) : undefined,
        platformFeeGstRate:
            body?.platformFeeGstRate === null
                ? null
                : body?.platformFeeGstRate !== undefined
                    ? Number(body.platformFeeGstRate)
                    : undefined,
        codOrderLimit:
            body?.codOrderLimit === null ? null : body?.codOrderLimit !== undefined ? Number(body.codOrderLimit) : undefined,
        packagingCharge: body?.packagingCharge
            ? {
                isEnabled: body.packagingCharge.isEnabled !== undefined
                    ? Boolean(body.packagingCharge.isEnabled)
                    : false,
                mode: body.packagingCharge.mode !== undefined
                    ? String(body.packagingCharge.mode).toUpperCase()
                    : 'ADMIN',
                adminChargePerOrder: body.packagingCharge.adminChargePerOrder !== undefined
                    ? Number(body.packagingCharge.adminChargePerOrder)
                    : 0
            }
            : undefined,
        otherPlatformPrice: body?.otherPlatformPrice
            ? {
                isEnabled: body.otherPlatformPrice.isEnabled !== undefined
                    ? Boolean(body.otherPlatformPrice.isEnabled)
                    : false,
                markupPercent: body.otherPlatformPrice.markupPercent !== undefined
                    ? Number(body.otherPlatformPrice.markupPercent)
                    : 0,
                label: body.otherPlatformPrice.label !== undefined
                    ? String(body.otherPlatformPrice.label)
                    : undefined
            }
            : undefined,
        isActive: body?.isActive !== undefined ? Boolean(body.isActive) : undefined
    };

    const result = feeSettingsUpsertSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    // Validate ranges: min < max, non-overlapping after sorting
    const ranges = Array.isArray(result.data.deliveryFeeRanges) ? result.data.deliveryFeeRanges : undefined;
    if (ranges) {
        const sorted = [...ranges].sort((a, b) => a.min - b.min);
        for (const r of sorted) {
            if (r.min >= r.max) {
                throw new ValidationError('Each range must have min less than max');
            }
        }
        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const cur = sorted[i];
            if (cur.min < prev.max) {
                throw new ValidationError('Delivery fee ranges must not overlap');
            }
        }
        result.data.deliveryFeeRanges = sorted;
    }

    if (Array.isArray(result.data.distanceSlabAdminDeliveryCommission)) {
        const dedupe = new Set();
        result.data.distanceSlabAdminDeliveryCommission = result.data.distanceSlabAdminDeliveryCommission.map((row) => {
            if (dedupe.has(row.distanceRuleId)) {
                throw new ValidationError('Duplicate distanceRuleId found in admin delivery commission config');
            }
            dedupe.add(row.distanceRuleId);
            const pct = Math.round((Number(row.adminDeliveryCommissionPercent || 0) * 100)) / 100;
            return {
                distanceRuleId: row.distanceRuleId,
                isEnabled: row.isEnabled === true,
                adminDeliveryCommissionPercent: pct
            };
        });
    }

    if (result.data.deliveryPartnerIncentiveRule) {
        result.data.deliveryPartnerIncentiveRule = {
            isEnabled: result.data.deliveryPartnerIncentiveRule.isEnabled === true,
            minOrderAmount: Math.round((Number(result.data.deliveryPartnerIncentiveRule.minOrderAmount || 0)) * 100) / 100,
            incentivePercent: Math.round((Number(result.data.deliveryPartnerIncentiveRule.incentivePercent || 0)) * 100) / 100,
        };
    }

    if (result.data.packagingCharge) {
        const pc = result.data.packagingCharge;
        result.data.packagingCharge = {
            isEnabled: pc.isEnabled === true,
            mode: pc.mode === 'RESTAURANT' ? 'RESTAURANT' : 'ADMIN',
            adminChargePerOrder: Math.round((Number(pc.adminChargePerOrder || 0)) * 100) / 100
        };
        if (
            result.data.packagingCharge.isEnabled &&
            result.data.packagingCharge.mode === 'ADMIN' &&
            result.data.packagingCharge.adminChargePerOrder <= 0
        ) {
            throw new ValidationError('Set a packaging charge per order, or turn the charge off');
        }
    }

    return result.data;
};

