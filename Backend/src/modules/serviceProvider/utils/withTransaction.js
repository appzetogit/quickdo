const mongoose = require('mongoose');

/**
 * Multi-document transaction helper for money paths.
 *
 * Every money flow here touches several collections at once — a booking, a
 * Transaction row, a partner wallet, a bill. Without a transaction a mid-flight
 * failure leaves those out of sync: cash collected but no earning credited, a
 * wallet debited for a booking that never got marked paid.
 *
 * USAGE — the callback receives a session and MUST thread it through every
 * single query it makes, or that query silently runs outside the transaction:
 *
 *   const out = await withTransaction(async (session) => {
 *     await Booking.findByIdAndUpdate(id, { ... }, { session });
 *     await Vendor.findByIdAndUpdate(vid, { $inc: {...} }, { session });
 *     const [txn] = await Transaction.create([{ ... }], { session });  // NOTE: array form
 *     return txn;
 *   });
 *
 * GOTCHA — Model.create(doc, { session }) does NOT work. That signature means
 * "create two documents". Always use the array form: Model.create([doc], { session }).
 *
 * GOTCHA — side effects that cannot be rolled back (push notifications, socket
 * emits, SMS, Razorpay API calls) belong OUTSIDE the callback. Do the DB work in
 * the transaction, then fire notifications after it commits.
 *
 * RETRIES — session.withTransaction() re-runs the callback on transient errors
 * (write conflicts, primary step-down). Keep the callback free of side effects
 * and safe to run twice.
 */

// null = not probed yet. Probed once per process, then cached.
let supported = null;

/**
 * Multi-document transactions require a replica set or a sharded cluster.
 * A standalone mongod rejects them with "Transaction numbers are only allowed
 * on a replica set member or mongos", so local single-node dev setups must
 * degrade instead of hard-failing every payment.
 */
const transactionsSupported = async () => {
  if (supported !== null) return supported;

  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    // setName => replica set member. isdbgrid => mongos (sharded cluster).
    supported = Boolean(info.setName || info.msg === 'isdbgrid');
  } catch (err) {
    console.error('[Txn] Could not probe deployment type:', err.message);
    supported = false;
  }

  if (!supported) {
    console.warn(
      '[Txn] ⚠️  MongoDB deployment is standalone — money paths will run WITHOUT ' +
      'transactions and are NOT atomic. Use a replica set (Atlas already is one) ' +
      'in production.'
    );
  }
  return supported;
};

/**
 * Thrown by abort() to roll back and hand a value back to the caller.
 * Returning normally from the callback COMMITS, so a validation failure
 * discovered mid-transaction must throw, not return.
 */
class TransactionAbort extends Error {
  constructor(payload) {
    super('TransactionAbort');
    this.name = 'TransactionAbort';
    this.payload = payload;
  }
}

/**
 * Bail out of the current transaction, rolling back everything written so far,
 * and make withTransaction() resolve to `payload`.
 *
 *   if (!debited) abort({ insufficient: true });
 */
const abort = (payload) => {
  throw new TransactionAbort(payload);
};

/**
 * Run `work` inside a transaction when the deployment supports one, otherwise
 * run it unwrapped so single-node dev environments still function.
 *
 * NOTE on the degraded path: with no transaction available there is nothing to
 * roll back, so an abort() leaves earlier writes in place. That is a dev-only
 * compromise — run a replica set anywhere real money moves.
 *
 * @param {(session: import('mongoose').ClientSession|undefined) => Promise<any>} work
 * @returns {Promise<any>} whatever `work` returns, or the abort() payload
 */
const withTransaction = async (work) => {
  if (!(await transactionsSupported())) {
    // Pass undefined, not null: `{ session: undefined }` is identical to omitting
    // the option, whereas null relies on driver truthiness checks.
    try {
      return await work(undefined);
    } catch (err) {
      if (err instanceof TransactionAbort) return err.payload;
      throw err;
    }
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    // withTransaction() already aborted the transaction before rethrowing.
    if (err instanceof TransactionAbort) return err.payload;
    throw err;
  } finally {
    await session.endSession();
  }
};

/**
 * Test seam — lets the unit test force a known deployment mode without a live DB.
 */
const __setSupportedForTests = (value) => { supported = value; };

module.exports = {
  withTransaction,
  transactionsSupported,
  abort,
  TransactionAbort,
  __setSupportedForTests
};
