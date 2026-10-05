const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const { USER_ROLES } = require('../utils/constants');

/**
 * Only a party to the booking may act on its payment.
 *
 * The cash-collection routes (/bookings/cash/:id/...) sat behind `authenticate`
 * alone. Any logged-in account -- a customer, any vendor, any worker -- could, for
 * ANY booking id:
 *   - set its price (initiate / initiate-online take totalAmount from the body),
 *   - confirm cash or a manual QR payment, which marks it paid and credits the
 *     partner's earnings from the bill.
 * The partner setting the final amount is by design (they bill the customer at the
 * door); anyone else doing it is not.
 *
 * @param {'partner'|'customer'|'any'} who
 *   partner  -- the vendor or worker assigned to the booking
 *   customer -- the customer who made it
 *   any      -- either, or an admin (read-only status)
 */
const ADMIN_ROLES = new Set([USER_ROLES.ADMIN, 'admin', 'super_admin']);

const requireBookingParty = (who) => async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const booking = await Booking.findById(id).select('userId vendorId workerId').lean();
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const role = req.userRole;
    const me = String(req.user?.id || req.user?._id || '');
    const isVendor = role === USER_ROLES.VENDOR && booking.vendorId && String(booking.vendorId) === me;
    const isWorker = role === USER_ROLES.WORKER && booking.workerId && String(booking.workerId) === me;
    const isCustomer = role === USER_ROLES.USER && booking.userId && String(booking.userId) === me;
    const isAdmin = ADMIN_ROLES.has(role);

    const allowed =
      (who === 'partner' && (isVendor || isWorker)) ||
      (who === 'customer' && isCustomer) ||
      (who === 'any' && (isVendor || isWorker || isCustomer || isAdmin));

    if (!allowed) {
      // 404, not 403: do not confirm to a stranger that the booking exists.
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    return next();
  } catch (err) {
    console.error('[BookingParty] check failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not verify access to this booking' });
  }
};

module.exports = { requireBookingParty };
