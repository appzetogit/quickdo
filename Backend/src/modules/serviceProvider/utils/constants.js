/**
 * Application Constants
 */

// User Roles
const USER_ROLES = {
  USER: 'USER',
  VENDOR: 'VENDOR',
  WORKER: 'WORKER',
  ADMIN: 'ADMIN'
};

// Token Types
const TOKEN_TYPES = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PHONE_VERIFICATION: 'PHONE_VERIFICATION',
  REFRESH_TOKEN: 'REFRESH_TOKEN'
};

// Vendor Approval Status
const VENDOR_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SUSPENDED: 'suspended'
};

// Worker Status
const WORKER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE'
};

// Booking Status
const BOOKING_STATUS = {
  SEARCHING: 'searching', // Initial search phase
  REQUESTED: 'requested', // Waiting for vendor to accept
  AWAITING_PAYMENT: 'awaiting_payment', // Accepted by vendor, waiting for user payment
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  ACCEPTED: 'accepted',
  ASSIGNED: 'assigned',
  JOURNEY_STARTED: 'journey_started',
  VISITED: 'visited',
  IN_PROGRESS: 'in_progress',
  WORK_DONE: 'work_done',
  COMPLETED: 'completed',
  NO_VENDORS: 'no_vendors', // No vendor/worker accepted in time
  CANCELLED: 'cancelled',
  REJECTED: 'rejected'
};

// Payment Status
const PAYMENT_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  COLLECTED_BY_VENDOR: 'collected_by_vendor',
  PLAN_COVERED: 'plan_covered' // For plan_benefit bookings until bill is finalized
};

/*
 * Payment methods where the customer's money was taken BEFORE the service, so
 * cancelling or timing out owes it back.
 *
 * One list for every refund path. Two copies of it had drifted: both omitted
 * 'online', which is exactly what verifyPaymentWebhook stores for a Razorpay
 * payment -- so a customer who paid online and then cancelled, or whose search
 * timed out, was never refunded.
 */
const PREPAID_PAYMENT_METHODS = Object.freeze(['wallet', 'online', 'razorpay', 'upi', 'card']);

/*
 * The most a refund may return: what was actually received.
 *
 * finalAmount is not that. It starts as the checkout total and is overwritten with
 * the bill total when the job is billed -- so a booking prepaid at Rs 1 and then
 * billed at Rs 2000 would refund Rs 2000 on cancel. paidAmount is recorded at payment
 * confirmation; bookings marked paid by a path that does not record it (legacy
 * rows, cash/QR confirmations) fall back to finalAmount as before.
 */
const refundableAmountOf = (booking) => {
  const paid = Number(booking?.paidAmount);
  if (Number.isFinite(paid) && paid > 0) return paid;
  return Math.max(0, Number(booking?.finalAmount) || 0);
};

// Service Status
const SERVICE_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  DELETED: 'deleted'
};

// Bill Status
const BILL_STATUS = {
  DRAFT: 'draft',
  GENERATED: 'generated',
  PAID: 'paid',
  CANCELLED: 'cancelled'
};

module.exports = {
  USER_ROLES,
  TOKEN_TYPES,
  VENDOR_STATUS,
  WORKER_STATUS,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  PREPAID_PAYMENT_METHODS,
  refundableAmountOf,
  SERVICE_STATUS,
  BILL_STATUS
};
