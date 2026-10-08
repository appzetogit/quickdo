import ms from 'ms';
import { ApiError } from '../../../../utils/ApiError.js';
import { Driver } from '../models/Driver.js';
import { FoodDeliveryPartner } from '../../../food/delivery/models/deliveryPartner.model.js';
import { signAccessToken, signRefreshToken } from '../../../../core/auth/token.util.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';
import { config } from '../../../../config/env.js';
import { getDriverActiveJobs } from '../../../../core/dispatch/jobFeed.js';
import { isUnifiedDispatchEnabled } from '../../../../core/dispatch/unifiedDispatch.js';

/**
 * GET /api/v1/taxi/drivers/jobs/active
 *
 * Every job the driver holds right now -- rides, food and grocery deliveries -- in one list,
 * so an app that shows both can restore its state after a restart without asking three
 * services. Works whether or not unified dispatch is on.
 */
export const getActiveJobs = async (req, res) => {
  const result = await getDriverActiveJobs(req.auth.sub);
  if (!result) throw new ApiError(404, 'Driver not found');
  res.json({ success: true, data: result });
};

/**
 * POST /api/v1/taxi/drivers/jobs/delivery-session
 *
 * A delivery-partner session for the signed-in driver's OWN linked delivery record, so the
 * driver app can accept and run a food or grocery job through the existing delivery
 * endpoints (/api/v1/food/delivery/*) without a second sign-in.
 *
 * The reverse of driverIdentityBridge (which lets a delivery token act as the linked driver
 * on /taxi). Same conditions, both ways: the two records must name each other, the delivery
 * record must be approved, and the driver must hold a delivery capability. Only while
 * UNIFIED_DISPATCH_ENABLED is on.
 */
export const createDeliverySession = async (req, res) => {
  if (!isUnifiedDispatchEnabled()) {
    throw new ApiError(404, 'Unified driver dispatch is not enabled');
  }

  const driver = await Driver.findById(req.auth.sub)
    .select('_id approve deletedAt serviceCapabilities legacyDeliveryPartnerId')
    .lean();
  if (!driver || driver.deletedAt) throw new ApiError(404, 'Driver not found');
  if (driver.approve === false) throw new ApiError(403, 'Your driver account is not approved yet.');

  const caps = Array.isArray(driver.serviceCapabilities) ? driver.serviceCapabilities : [];
  if (!caps.includes('delivery') && !caps.includes('quickCommerce')) {
    throw new ApiError(403, 'You are not registered for deliveries');
  }
  if (!driver.legacyDeliveryPartnerId) {
    throw new ApiError(409, 'Your delivery account is not linked to this driver account yet. Please contact support.');
  }

  const partner = await FoodDeliveryPartner.findById(driver.legacyDeliveryPartnerId)
    .select('_id status driverId')
    .lean();
  if (!partner || String(partner.driverId || '') !== String(driver._id)) {
    throw new ApiError(409, 'Your delivery account is not linked to this driver account yet. Please contact support.');
  }
  if (partner.status !== 'approved') {
    throw new ApiError(403, partner.status === 'rejected'
      ? 'Your delivery account has been rejected. Please contact support.'
      : 'Your delivery account is not approved yet.');
  }

  const payload = { userId: String(partner._id), role: 'DELIVERY_PARTNER' };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || '7d');
  await FoodRefreshToken.create({
    userId: partner._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + ttlMs),
  });

  res.status(201).json({
    success: true,
    data: {
      accessToken,
      refreshToken,
      role: 'DELIVERY_PARTNER',
      deliveryPartnerId: String(partner._id),
      // Refresh with POST /api/v1/auth/refresh-token, like any delivery-partner session.
      refreshEndpoint: '/api/v1/auth/refresh-token',
    },
  });
};
