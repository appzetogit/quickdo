/**
 * Quick-commerce payments live in the SHARED `payments` collection.
 *
 * This file used to define its own model on `qc_payments` -- a copy of the same schema
 * master already had, because quick-commerce is a fork of master's food module. That
 * meant "how much did we take yesterday" had to be asked separately per vertical and
 * no single query could produce a platform total.
 *
 * It is now a re-export of core/payments. That matters more than it looks: this module
 * reads Payment from here in eight places (payment.service.js, refund.service.js), so
 * re-exporting moves the READS and the WRITES together. Switching only the write would
 * have left quick-commerce writing to `payments` while still searching `qc_payments`,
 * and every lookup of a payment it had just created would miss.
 *
 * Rows are distinguished by `vertical: 'quickCommerce'`, set by
 * core/payments/payments.facade.js. See SUPERAPP_DATA_MODEL.md.
 *
 * Safe to do without a data migration: `qc_payments` was never created -- this module
 * had not run against the database when the cutover happened.
 */
export { Payment, PAYMENT_VERTICALS } from '../../../../../core/payments/models/payment.model.js';
