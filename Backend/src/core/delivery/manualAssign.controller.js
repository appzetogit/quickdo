import mongoose from 'mongoose';
import { ValidationError } from '../auth/errors.js';
import { sendResponse } from '../../utils/response.js';
import { listRiderCandidates, assignRider, unassignRider } from './manualAssign.js';

/**
 * Admin endpoints for assigning a rider by hand (manualAssign.js), one set per
 * panel: mounted under the Food admin router with 'food' and under the Quick &
 * Medical admin router with 'quickCommerce', behind each router's own admin
 * and permission gates.
 */

const isObjectId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
  && mongoose.Types.ObjectId.isValid(value);

/** true/false, or the strings a form sends. Anything else is refused rather than guessed. */
const parseForce = (value) => {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ValidationError('force must be true or false');
};

/** Who did it, for the order history: id from the token, name from the admin record. */
async function adminOf(req) {
  const id = req.user?.userId || req.user?.id || null;
  let name = '';
  try {
    const { loadAdminCached } = await import('../../modules/food/admin/middlewares/foodAdmin.middleware.js');
    const admin = id ? await loadAdminCached(id) : null;
    name = admin?.name || admin?.email || '';
  } catch {
    // A name is a nicety for the history line; never a reason to fail the action.
  }
  return { id, name };
}

export const manualAssignControllers = (vertical) => ({
  /** GET /orders/:orderId/rider-candidates?q=&limit= */
  async riderCandidates(req, res, next) {
    try {
      const q = typeof req.query?.q === 'string' ? req.query.q : '';
      const limit = req.query?.limit !== undefined ? Number.parseInt(req.query.limit, 10) : undefined;
      if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
        throw new ValidationError('limit must be a positive number');
      }
      const data = await listRiderCandidates({ vertical, orderId: req.params.orderId, q, limit });
      return sendResponse(res, 200, 'Rider candidates', data);
    } catch (err) {
      return next(err);
    }
  },

  /** PATCH /orders/:orderId/assign-rider  { deliveryPartnerId, force? } */
  async assignRider(req, res, next) {
    try {
      const { deliveryPartnerId } = req.body || {};
      if (!isObjectId(deliveryPartnerId)) throw new ValidationError('A valid deliveryPartnerId is required');
      const force = parseForce(req.body?.force);
      const result = await assignRider({
        vertical,
        orderId: req.params.orderId,
        foodRiderId: deliveryPartnerId,
        admin: await adminOf(req),
        force,
      });
      return sendResponse(
        res,
        200,
        result.needsConfirmation ? 'Please confirm the assignment' : 'Rider assigned',
        result,
      );
    } catch (err) {
      return next(err);
    }
  },

  /** PATCH /orders/:orderId/unassign-rider */
  async unassignRider(req, res, next) {
    try {
      const result = await unassignRider({ vertical, orderId: req.params.orderId, admin: await adminOf(req) });
      return sendResponse(res, 200, 'Rider unassigned', result);
    } catch (err) {
      return next(err);
    }
  },
});
