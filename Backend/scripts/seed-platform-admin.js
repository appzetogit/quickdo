/**
 * Create (or update) a platform super-admin that can reach every service panel.
 *
 * Credentials come from arguments, never from this file -- a password committed to
 * a repository is a password you have to rotate.
 *
 *   node scripts/seed-platform-admin.js --email=you@example.com --password='...'
 *   node scripts/seed-platform-admin.js --email=you@example.com --password='...' --apply
 *
 * Grants what the panels actually check:
 *   servicesAccess : food, quickCommerce, taxi, serviceProvider
 *   adminLevel     : platform_superadmin   (core/admin/adminHierarchy.service.js)
 *   admin_type     : superadmin
 *   role           : super_admin           (service-provider routes gate on this --
 *                    cityManagement.routes.js does a path-less router.use(isSuperAdmin)
 *                    mounted ahead of every other /admin route)
 *
 * Existing account with that email: password is UPDATED and access widened. It is
 * never downgraded and no other admin is touched.
 */

import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || '').replace(`--${n}=`, '');

const email = arg('email').trim().toLowerCase();
const password = arg('password');

if (!email || !password) {
    console.error('\nUsage: node scripts/seed-platform-admin.js --email=<address> --password=<password> [--apply]\n');
    process.exit(1);
}
if (password.length < 8) {
    console.warn(`\n  WARNING: that password is ${password.length} characters. This account is a platform`);
    console.warn('  super-admin on a live database -- it can reach every service panel.\n');
}

const URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!URI) {
    console.error('\nMONGO_URI / MONGODB_URI is not set.\n');
    process.exit(1);
}

await mongoose.connect(URI);
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');

const SERVICES = ['food', 'quickCommerce', 'taxi', 'serviceProvider'];
const existing = await FoodAdmin.findOne({ email });

console.log(`\ndatabase: ${mongoose.connection.db.databaseName}`);
console.log(`email   : ${email}`);
console.log(`action  : ${existing ? 'UPDATE existing admin (password reset, access widened)' : 'CREATE new admin'}`);
console.log(`grants  : servicesAccess=[${SERVICES.join(', ')}] adminLevel=platform_superadmin role=super_admin`);

if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.\n');
    await mongoose.disconnect();
    process.exit(0);
}

if (existing) {
    // Assigning triggers the schema's pre('save') bcrypt hook -- do not hash here.
    existing.password = password;
    existing.servicesAccess = [...new Set([...(existing.servicesAccess || []), ...SERVICES])];
    existing.adminLevel = 'platform_superadmin';
    existing.admin_type = 'superadmin';
    existing.role = 'super_admin';
    existing.isActive = true;
    if (!existing.name) existing.name = 'Platform Admin';
    await existing.save();
} else {
    await FoodAdmin.create({
        email,
        password,
        name: 'Platform Admin',
        isActive: true,
        servicesAccess: SERVICES,
        adminLevel: 'platform_superadmin',
        admin_type: 'superadmin',
        role: 'super_admin',
        permissions: ['*'],
    });
}

// Verify by the same path a login takes, rather than trusting the write.
const saved = await FoodAdmin.findOne({ email }).select('+password');
const ok = await saved.comparePassword(password);
console.log(`\nsaved. password verifies: ${ok ? 'YES' : 'NO — something is wrong'}`);
console.log(`  servicesAccess: [${(saved.servicesAccess || []).join(', ')}]`);
console.log(`  adminLevel    : ${saved.adminLevel}`);
console.log(`  role          : ${saved.role}\n`);

await mongoose.disconnect();
process.exit(ok ? 0 : 1);
