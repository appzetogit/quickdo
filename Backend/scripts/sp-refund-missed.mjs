/**
 * Find -- and with --commit, pay -- service-provider refunds that were owed and
 * never made.
 *
 * Two bugs kept prepaid customers' money (see services/bookingExpiry.js):
 * timed-out bookings were never refunded ('SUCCESS' vs 'success'), and bookings
 * paid 'online' then cancelled were not in the refund list.
 *
 * Usage:
 *   node scripts/sp-refund-missed.mjs            dry run: lists what is owed, writes nothing
 *   node scripts/sp-refund-missed.mjs --commit   refunds the clear cases to the wallet
 *
 * Clear cases (refunded in full): timed out; or cancelled by the user before the
 * journey started. Everything else that looks unrefunded is printed under REVIEW
 * and never touched -- the amount there depends on a cancellation fee a person
 * should decide.
 *
 * Idempotent: each refund claims its booking, so a second --commit pays nothing.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');

const uriFromEnv = () => {
    if (process.env.MONGO_URI) return process.env.MONGO_URI;
    const envPath = path.join(__dirname, '..', '.env');
    const m = fs.readFileSync(envPath, 'utf8').match(/^MONGODB_URI=(.*)$/m);
    if (!m) throw new Error('no MONGODB_URI');
    return m[1].trim();
};

async function run() {
    await mongoose.connect(uriFromEnv());
    console.log(`db=${mongoose.connection.db.databaseName}  mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}\n`);

    const Booking = require('../src/modules/serviceProvider/models/Booking.js');
    const Transaction = require('../src/modules/serviceProvider/models/Transaction.js');
    const { PREPAID_PAYMENT_METHODS, PAYMENT_STATUS, BOOKING_STATUS } = require('../src/modules/serviceProvider/utils/constants.js');
    const { classifyMissedRefund, refundMissedBooking } = require('../src/modules/serviceProvider/services/bookingExpiry.js');

    const candidates = await Booking.find({
        status: { $in: [BOOKING_STATUS.NO_VENDORS, BOOKING_STATUS.CANCELLED] },
        paymentStatus: PAYMENT_STATUS.SUCCESS,
        paymentMethod: { $in: PREPAID_PAYMENT_METHODS },
    })
        .select('_id bookingNumber userId status paymentStatus paymentMethod finalAmount cancelledBy journeyStartedAt cancelledAt')
        .lean();

    const refundIds = new Set(
        (await Transaction.distinct('bookingId', { type: 'refund', bookingId: { $in: candidates.map((c) => c._id) } })).map(String),
    );

    const owed = [];
    const review = [];
    for (const b of candidates) {
        const d = classifyMissedRefund(b, { hasRefundRow: refundIds.has(String(b._id)) });
        if (d.action === 'refund') owed.push({ b, amount: d.amount });
        else if (d.action === 'review') review.push({ b, reason: d.reason });
    }

    const total = owed.reduce((s, o) => s + o.amount, 0);
    console.log(`owed: ${owed.length} bookings, Rs ${Math.round(total * 100) / 100}`);
    for (const { b, amount } of owed) {
        console.log(`  ${b.bookingNumber}  ${b.status}  ${b.paymentMethod}  Rs ${amount}  user ${b.userId}  cancelled ${b.cancelledAt?.toISOString?.() || ''}`);
    }
    console.log(`\nREVIEW (not touched): ${review.length}`);
    for (const { b, reason } of review) {
        console.log(`  ${b.bookingNumber}  ${b.status}  ${b.paymentMethod}  Rs ${b.finalAmount}  ${reason}`);
    }

    if (!COMMIT) {
        console.log('\nDRY-RUN: nothing written. Re-run with --commit to refund the owed list.');
        await mongoose.disconnect();
        return;
    }

    let paid = 0;
    let paidTotal = 0;
    for (const { b } of owed) {
        const r = await refundMissedBooking(b._id);
        if (r.refunded) { paid += 1; paidTotal += r.amount; }
        else console.log(`  not refunded ${b.bookingNumber}: ${r.reason}`);
    }
    console.log(`\nrefunded ${paid} bookings, Rs ${Math.round(paidTotal * 100) / 100}`);
    await mongoose.disconnect();
}

run().catch(async (err) => {
    console.error(`ABORTED: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
