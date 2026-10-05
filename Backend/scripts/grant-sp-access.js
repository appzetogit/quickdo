/**
 * Grant an existing admin access to the Service-Provider panel.
 *
 * The `admins` collection is shared by food, taxi and service-provider. Two things
 * gate the SP section, and an existing food/taxi admin usually has neither:
 *
 *   1. servicesAccess must include 'serviceProvider'
 *      (modules/serviceProvider/utils/serviceAccess.js)
 *   2. role must be 'super_admin'
 *      (cityManagement.routes.js does a path-less router.use(isSuperAdmin) and is
 *       mounted on /admin ahead of everything else, so it covers every SP endpoint)
 *
 * This never reads, prints or sets a password. Log in with the credentials you
 * already use; this only widens what that account may reach.
 *
 * Dry run by default.
 *
 *   node scripts/grant-sp-access.js --email=you@example.com
 *   node scripts/grant-sp-access.js --email=you@example.com --apply
 *   node scripts/grant-sp-access.js --list          # who exists, no secrets shown
 */

import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIST = args.includes('--list');
const EMAIL = (args.find((a) => a.startsWith('--email=')) || '').replace('--email=', '').trim().toLowerCase();

const URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!URI) {
    console.error('\nMONGO_URI / MONGODB_URI is not set.\n');
    process.exit(1);
}

const conn = await mongoose.createConnection(URI).asPromise();
const admins = conn.db.collection('admins');

// projection excludes every credential field -- this script has no business reading them
const SAFE = { password: 0, resetPasswordOtp: 0, resetPasswordExpires: 0 };

// Mirrors modules/serviceProvider/middleware/roleMiddleware.js isSuperAdmin. Keep the
// two in step -- a listing that disagrees with the running check is worse than none.
const SUPER_ROLES = new Set(['super_admin', 'super-admin', 'superadmin']);

const describe = (a) => {
    const access = Array.isArray(a.servicesAccess) ? a.servicesAccess : null;
    const spAllowed = !access || access.length === 0 || access.includes('serviceProvider');
    const role = String(a.role || '').trim().toLowerCase();
    const isSuper =
        SUPER_ROLES.has(role) ||
        a.adminLevel === 'platform_superadmin' ||
        a.adminLevel === 'sp_superadmin' ||
        (a.admin_type === 'superadmin' && role !== 'subadmin');

    const blockers = [];
    if (!spAllowed) blockers.push('needs serviceProvider in servicesAccess');
    if (!isSuper) blockers.push(`not a super-admin (role "${a.role || '(unset)'}", level "${a.adminLevel || '(unset)'}")`);
    return { access, spAllowed, isSuper, blockers };
};

if (LIST || !EMAIL) {
    const all = await admins.find({}, { projection: SAFE }).toArray();
    console.log(`\n${all.length} admin(s) in database "${conn.db.databaseName}":\n`);
    for (const a of all) {
        const d = describe(a);
        console.log(`  ${(a.email || '(no email)').padEnd(36)} ${d.blockers.length === 0 ? 'CAN use the SP panel' : 'blocked: ' + d.blockers.join('; ')}`);
    }
    if (!EMAIL) console.log('\nRe-run with --email=<address> to grant access.\n');
    await conn.close();
    process.exit(0);
}

const admin = await admins.findOne({ email: EMAIL }, { projection: SAFE });
if (!admin) {
    console.error(`\nNo admin with email "${EMAIL}" in database "${conn.db.databaseName}".`);
    console.error('Run with --list to see which accounts exist.\n');
    await conn.close();
    process.exit(1);
}

const before = describe(admin);
console.log(`\nadmin   : ${admin.email}`);
console.log(`database: ${conn.db.databaseName}`);
console.log(`current : role=${admin.role || '(unset)'}  servicesAccess=[${before.access ? before.access.join(', ') : 'unset'}]`);

if (before.blockers.length === 0) {
    console.log('\nAlready has everything it needs. Nothing to do.\n');
    await conn.close();
    process.exit(0);
}

const nextAccess = [...new Set([...(before.access || []), 'serviceProvider'])];
console.log(`\nwould set: role=super_admin  servicesAccess=[${nextAccess.join(', ')}]`);

if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.\n');
    await conn.close();
    process.exit(0);
}

await admins.updateOne({ _id: admin._id }, { $set: { servicesAccess: nextAccess, role: 'super_admin' } });
const after = describe(await admins.findOne({ _id: admin._id }, { projection: SAFE }));
console.log(`\napplied. SP panel access: ${after.blockers.length === 0 ? 'YES' : 'still blocked — ' + after.blockers.join('; ')}\n`);

await conn.close();
