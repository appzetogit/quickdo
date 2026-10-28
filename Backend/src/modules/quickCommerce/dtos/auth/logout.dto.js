import { z } from 'zod';
import { ValidationError } from '../../core/auth/errors.js';
import { normalizePlatform } from '../../utils/platform.js';

const schema = z.object({
    /**
     * Optional on purpose: logging out must not be able to fail.
     *
     * Clients legitimately reach here with no refresh token -- it already
     * expired, or was cleared before the call. Requiring it returned 400 and
     * aborted the request, which meant the fcmToken below was never
     * unregistered, so a logged-out device kept receiving push notifications.
     * Absence is a no-op, reported as invalidated:false, not an error.
     */
    refreshToken: z.string().min(1).nullish(),
    fcmToken: z.string().nullish(),
    platform: z.preprocess(
        (value) => normalizePlatform(value, { allowUndefined: true }),
        z.enum(['web', 'mobile']).optional()
    )
});

export const validateLogoutDto = (body) => {
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
