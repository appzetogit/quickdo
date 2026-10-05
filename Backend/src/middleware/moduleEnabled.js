import { sendError } from '../utils/response.js';
import { isWriteRequest, isAlwaysAllowed } from '../core/modules/moduleRegistry.js';
import { getModuleState } from '../core/modules/moduleState.service.js';

/**
 * Refuse new commitments to a vertical that has been switched off.
 *
 * Mounted per vertical in routes/index.js, ahead of that vertical's routes.
 *
 * What gets through even when disabled, and why (see moduleRegistry.js):
 *   - every read, so in-flight orders stay visible and trackable
 *   - /admin, so the panel can turn it back on
 *   - /payments/webhook, so a callback for an order placed before the switch still
 *     reconciles instead of stranding the money
 *   - /auth, so operators and drivers can still sign in
 *
 * 503 with Retry-After rather than 403: this is temporary and not the caller's fault,
 * and well-behaved clients back off instead of hammering.
 */
export const requireModuleEnabled = (moduleName) => async (req, res, next) => {
    try {
        if (!isWriteRequest(req.method)) return next();
        if (isAlwaysAllowed(req.originalUrl || req.url)) return next();

        const state = await getModuleState(moduleName);
        if (state.enabled !== false) return next();

        res.set('Retry-After', '300');
        return sendError(
            res,
            503,
            state.reason
                || 'This service is temporarily unavailable. Existing orders are unaffected.',
        );
    } catch (err) {
        // Fail OPEN: the switch failing must not take down the vertical it guards.
        return next();
    }
};
