/**
 * Does the unified wallet agree with the money that is actually there?
 *
 * Read-only. Prints, for every rider, the old per-vertical figures beside the new
 * unified ones and flags anything that does not reconcile.
 *
 * The one check that matters: the taxi ledger (wallettransactions) is the only
 * append-only record of rider money on the platform, so its sum is the closest
 * thing to ground truth. If the unified balance cannot be explained by that sum
 * plus the delivery aggregates, something in the derivation is wrong.
 *
 *   node scripts/reconcile-rider-finance.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pad = (v, n) => String(v).padEnd(n);
const money = (v) => String(round2(v)).padStart(10);

const main = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(uri);

    const { getRiderFinance } = await import('../src/core/finance/riderFinance.service.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { WalletTransaction } = await import('../src/modules/taxi/driver/models/WalletTransaction.js');

    const drivers = await Driver.find({}).select('_id name phone wallet legacyDeliveryPartnerId legacyQcPartnerId').lean();
    console.log(`\n${drivers.length} rider(s) on production\n`);

    let problems = 0;

    for (const d of drivers) {
        const txns = await WalletTransaction.find({ driverId: d._id }).sort({ createdAt: 1 }).lean();
        const ledgerSum = round2(txns.reduce((t, x) => t + (Number(x.amount) || 0), 0));
        const snapshot = round2(d.wallet?.balance || 0);

        const finance = await getRiderFinance(d._id);
        const b = finance.breakdown;

        console.log('='.repeat(78));
        console.log(`${d.name || '(no name)'}   ${d.phone || ''}   ${d._id}`);
        console.log(`  linked: food=${finance.foodPartnerId || 'none'}  qc=${finance.qcPartnerId || 'none'}`);
        console.log('');
        console.log('  TAXI (the old source of truth)');
        console.log(`    wallet snapshot            ${money(snapshot)}`);
        console.log(`    ledger sum (${String(txns.length).padStart(2)} rows)       ${money(ledgerSum)}   ${Math.abs(snapshot - ledgerSum) < 0.005 ? 'agrees' : 'DIVERGED'}`);
        console.log(`    split -> owed to rider     ${money(b.taxi.walletPortion)}`);
        console.log(`    split -> cash they hold    ${money(b.taxi.cashHeldPortion)}`);
        console.log('');
        console.log('  DELIVERY (food + quick commerce, same collections)');
        console.log(`    earned                     ${money(b.delivery.totalEarned)}   (${b.delivery.totalDeliveries} delivered)`);
        console.log(`    bonus                      ${money(b.delivery.totalBonus)}`);
        console.log(`    withdrawn / pending        ${money(b.delivery.totalWithdrawn)} / ${round2(b.delivery.pendingWithdrawals)}`);
        console.log(`    cash collected - deposited ${money(b.delivery.grossCashCollected)} - ${round2(b.delivery.totalDeposited)}`);
        console.log(`    pocket (raw, unclamped)    ${money(b.delivery.pocketBalanceRaw)}`);
        console.log('');
        console.log('  UNIFIED (what every screen now shows)');
        console.log(`    wallet balance             ${money(finance.walletBalance)}`);
        console.log(`    cash in hand               ${money(finance.cashInHand)}`);
        console.log(`    shared cash limit          ${money(finance.cashLimit)}  available ${round2(finance.availableCashLimit)}`);
        console.log(`    blocked                    ${finance.isBlocked ? 'YES -> ' + finance.blockReason : 'no'}`);

        // Reconciliation: the unified figures must be reconstructible from the parts.
        const expectedBalance = Math.max(0, round2(b.taxi.walletPortion + b.delivery.pocketBalanceRaw));
        const expectedCash = Math.max(0, round2(b.taxi.cashHeldPortion + b.delivery.cashInHandRaw));

        const issues = [];
        if (Math.abs(snapshot - ledgerSum) >= 0.005) {
            issues.push(`taxi snapshot ${snapshot} does not match its ledger ${ledgerSum}`);
        }
        if (Math.abs(finance.walletBalance - expectedBalance) >= 0.005) {
            issues.push(`balance ${finance.walletBalance} != parts ${expectedBalance}`);
        }
        if (Math.abs(finance.cashInHand - expectedCash) >= 0.005) {
            issues.push(`cash ${finance.cashInHand} != parts ${expectedCash}`);
        }
        // A rider newly blocked by the shared ceiling is the intended behaviour
        // change, not a fault -- but it is the one that will generate calls, so it
        // is called out explicitly.
        if (finance.blockReason === 'cash_limit_reached') {
            issues.push('NEWLY BLOCKED by the shared cash ceiling (intended, but user-visible)');
        }

        console.log('');
        if (issues.length) {
            problems += 1;
            for (const i of issues) console.log(`  !! ${i}`);
        } else {
            console.log('  reconciles');
        }
    }

    console.log('='.repeat(78));
    console.log(problems ? `\n${problems} rider(s) need attention\n` : '\nevery rider reconciles\n');

    await mongoose.disconnect();
};

main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
