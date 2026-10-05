/**
 * Creates or updates a SINGLE admin account. Nothing else is touched.
 *
 * Unlike seed-default-credentials.js (which also creates a demo user, restaurant and
 * delivery partner), this is safe to run against a live database.
 *
 * Usage:
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='strong-pass' node scripts/seed-admin-only.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { FoodAdmin } from '../src/core/admin/admin.model.js';

dotenv.config();

const email = String(process.env.SEED_ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.SEED_ADMIN_PASSWORD || '';
const name = process.env.SEED_ADMIN_NAME || 'K9 Admin';

if (!email || !password) {
  console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD. Aborting.');
  process.exit(1);
}

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Missing MONGODB_URI / MONGO_URI. Aborting.');
  process.exit(1);
}

try {
  await mongoose.connect(uri);

  let admin = await FoodAdmin.findOne({ email });
  const isNew = !admin;
  if (!admin) admin = new FoodAdmin({ email });

  admin.email = email;
  admin.name = name;
  admin.password = password; // hashed by the model's pre-save hook
  admin.isActive = true;
  admin.servicesAccess = ['food', 'quickCommerce', 'taxi'];
  // admin_type defaults to 'subadmin' with permissions: [] — without these the account gets
  // 403 "You do not have permission to access ..." on every taxi admin resource.
  admin.admin_type = 'superadmin';
  admin.permissions = ['*'];
  admin.adminLevel = 'platform_superadmin';
  admin.role = 'ADMIN';
  await admin.save();

  console.log(`${isNew ? 'CREATED' : 'UPDATED'} admin: ${admin.email} (id ${admin._id})`);
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
