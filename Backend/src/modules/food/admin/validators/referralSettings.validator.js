import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const schema = z.object({
    referralRewardUser: z.number().min(0).optional(),
    referralRewardDelivery: z.number().min(0).optional(),
    referralLimitUser: z.number().min(0).optional(),
    referralLimitDelivery: z.number().min(0).optional(),
    isActive: z.boolean().optional()
});

export const validateReferralSettingsUpsertDto = (body) => {
    const normalized = {
        referralRewardUser: body?.referralRewardUser !== undefined ? Number(body.referralRewardUser) : undefined,
        referralRewardDelivery: body?.referralRewardDelivery !== undefined ? Number(body.referralRewardDelivery) : undefined,
        referralLimitUser: body?.referralLimitUser !== undefined ? Number(body.referralLimitUser) : undefined,
        referralLimitDelivery: body?.referralLimitDelivery !== undefined ? Number(body.referralLimitDelivery) : undefined,
        isActive: body?.isActive !== undefined ? Boolean(body.isActive) : undefined
    };

    const result = schema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};

