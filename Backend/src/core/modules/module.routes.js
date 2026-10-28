import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { requireRoles } from '../roles/role.middleware.js';
import { sendResponse, sendError } from '../../utils/response.js';
import { ALL_MODULES, isKnownModule } from './moduleRegistry.js';
import { getModuleStates, setModuleEnabled } from './moduleState.service.js';

/**
 * Platform module kill-switch, mounted at /v1/platform/modules.
 *
 * Deliberately NOT under any vertical's /admin prefix: the whole point is to act on a
 * vertical that is misbehaving, and routing that through the vertical's own admin
 * tree would make the switch depend on the thing it is meant to isolate.
 */
const router = express.Router();

// Read is open to any signed-in admin — seeing that quick-commerce is off is how you
// explain the 503s people are reporting.
router.get('/', authMiddleware, requireRoles('ADMIN'), async (_req, res) => {
    const states = await getModuleStates();
    return sendResponse(res, 200, 'Module states', {
        modules: ALL_MODULES.map((name) => ({ name, ...states[name] })),
    });
});

// Writing is SUPER_ADMIN only. Disabling a vertical stops it taking orders, which is
// a revenue decision, not a routine admin one.
router.patch('/:name', authMiddleware, requireRoles('SUPER_ADMIN'), async (req, res) => {
    const { name } = req.params;
    if (!isKnownModule(name)) {
        return sendError(res, 404, `Unknown module: ${name}`);
    }

    const { enabled, reason } = req.body || {};
    if (typeof enabled !== 'boolean') {
        return sendError(res, 400, '`enabled` must be true or false');
    }
    // A disable with no reason produces a 503 saying nothing, to a customer who then
    // calls support. Make the operator write the sentence.
    if (enabled === false && !String(reason || '').trim()) {
        return sendError(res, 400, 'A reason is required when disabling a module — it is shown to customers');
    }

    const state = await setModuleEnabled(name, enabled, {
        reason,
        actorId: req.user?.userId || '',
    });

    return sendResponse(res, 200, `Module ${name} ${enabled ? 'enabled' : 'disabled'}`, { name, ...state });
});

export default router;
