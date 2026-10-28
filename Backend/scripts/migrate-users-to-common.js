import mongoose from 'mongoose';
import { config } from '../src/config/env.js';

const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const toArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
};

const mergeUnique = (...values) => Array.from(new Set(values.flatMap(toArray).map((v) => String(v).trim()).filter(Boolean)));

const pickLatest = (a, b) => {
  const aTs = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
  const bTs = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
  return bTs > aTs ? b : a;
};

const mergeDocs = (base = {}, incoming = {}) => {
  const latest = pickLatest(base, incoming);
  return {
    ...base,
    ...incoming,
    ...latest,
    phone: normalizePhone(incoming.phone || base.phone),
    name: String(latest.name || base.name || '').trim(),
    email: String(latest.email || base.email || '').trim().toLowerCase(),
    role: String(incoming.role || base.role || 'USER').toUpperCase(),
    isActive: Boolean(base.isActive !== false && incoming.isActive !== false),
    isVerified: Boolean(base.isVerified || incoming.isVerified),
    fcmTokens: mergeUnique(base.fcmTokens, base.fcmTokenWeb, incoming.fcmTokens, incoming.fcmTokenWeb),
    fcmTokenMobile: mergeUnique(base.fcmTokenMobile, incoming.fcmTokenMobile),
    addresses: Array.isArray(latest.addresses) ? latest.addresses : (Array.isArray(base.addresses) ? base.addresses : []),
  };
};

const run = async () => {
  const dryRun = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
  await mongoose.connect(config.mongodbUri);
  const db = mongoose.connection.db;

  const foodCol = db.collection('food_users');
  const taxiCol = db.collection('taxiusers');
  const usersCol = db.collection('users');

  const [foodDocs, taxiDocs] = await Promise.all([
    foodCol.find({}).toArray(),
    taxiCol.find({}).toArray(),
  ]);

  const byPhone = new Map();
  const track = (doc, source) => {
    const phone = normalizePhone(doc.phone);
    if (!phone) return;
    const prev = byPhone.get(phone);
    if (!prev) {
      byPhone.set(phone, { merged: { ...doc, phone }, sources: [source] });
      return;
    }
    prev.merged = mergeDocs(prev.merged, { ...doc, phone });
    prev.sources.push(source);
  };

  foodDocs.forEach((d) => track(d, 'food_users'));
  taxiDocs.forEach((d) => track(d, 'taxiusers'));

  const operations = [];
  for (const [phone, entry] of byPhone.entries()) {
    const doc = {
      ...entry.merged,
      phone,
      _migration: {
        mergedFrom: entry.sources,
        mergedAt: new Date(),
      },
    };
    operations.push({
      updateOne: {
        filter: { phone },
        update: { $set: doc },
        upsert: true,
      },
    });
  }

  if (dryRun) {
    console.log(`[DRY RUN] food_users=${foodDocs.length}, taxiusers=${taxiDocs.length}, uniquePhones=${operations.length}`);
    await mongoose.disconnect();
    return;
  }

  if (operations.length > 0) {
    await usersCol.bulkWrite(operations, { ordered: false });
  }

  await usersCol.createIndex({ phone: 1 }, { unique: true });
  console.log(`[MIGRATION DONE] users upserted=${operations.length}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('[MIGRATION FAILED]', err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

