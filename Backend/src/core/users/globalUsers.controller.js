import { logger } from '../../utils/logger.js';
import { listGlobalUsers, streamGlobalUsersCsv, setCustomerBlocked } from './globalUsers.service.js';

/** Master > Customers. Read and export only -- see the service for why. */

export async function listGlobalUsersController(req, res, next) {
    try {
        const data = await listGlobalUsers(req.query || {});
        // A customer list is personal data; never let a proxy or the browser
        // keep a copy of it.
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ success: true, data });
    } catch (err) {
        return next(err);
    }
}

/** Block / unblock a customer in every app (body: { blocked: boolean }). */
export async function setCustomerBlockedController(req, res, next) {
    try {
        const result = await setCustomerBlocked(req.params.id, req.body?.blocked === true);
        if (!result) return res.status(404).json({ success: false, message: 'Customer not found' });
        logger.info(`globalUsers: customer ${result.id} ${result.isActive ? 'unblocked' : 'blocked'} by admin ${req.user?.userId || req.user?.id || ''}`);
        return res.json({ success: true, data: result });
    } catch (err) {
        return next(err);
    }
}

export async function exportGlobalUsersController(req, res, next) {
    try {
        await streamGlobalUsersCsv(res, req.query || {});
        return undefined;
    } catch (err) {
        /*
         * Headers are sent as soon as the first row is written, so a failure
         * part way through cannot become a JSON error response -- the client is
         * already receiving a file. Ending the stream is the only honest move;
         * a truncated CSV is visible to whoever opens it, whereas an error page
         * saved as .csv is not.
         */
        logger.error(`globalUsers: export failed: ${err.message}`);
        if (res.headersSent) return res.end();
        return next(err);
    }
}
