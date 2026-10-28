import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { User } from '../src/modules/taxi/user/models/User.js';
import { listAdminUsersForPromotions } from '../src/modules/taxi/admin/promotions/services/promotionsService.js';
import { listUsers } from '../src/modules/taxi/admin/services/adminService.js';

dotenv.config();

const SAMPLE_LIMIT = Math.max(1, Number(process.env.DEBUG_TAXI_USER_SAMPLE_LIMIT || 5));

const connect = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI / MONGO_URI in environment.');
  }

  const dbName = process.env.MONGODB_DB_NAME || undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
};

const formatUser = (user = {}) => ({
  id: String(user._id || user.id || ''),
  name: String(user.name || '').trim(),
  phone: String(user.phone || user.mobile || '').trim(),
  email: String(user.email || '').trim(),
  active: user.active,
  deletedAt: user.deletedAt || null,
  createdAt: user.createdAt || null,
});

const printSection = (title, data) => {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
};

const run = async () => {
  await connect();

  const rawUsersCollection = mongoose.connection.collection('users');

  const [
    rawTotal,
    rawNonDeletedTotal,
    rawSample,
    taxiUserTotal,
    taxiUserNonDeletedTotal,
    taxiUserSample,
    promoUsers,
    adminUsersPage,
    blankNameCount,
  ] = await Promise.all([
    rawUsersCollection.countDocuments({}),
    rawUsersCollection.countDocuments({ deletedAt: null }),
    rawUsersCollection.find({}, { projection: { name: 1, phone: 1, email: 1, active: 1, deletedAt: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(SAMPLE_LIMIT)
      .toArray(),
    User.countDocuments({}),
    User.countDocuments({ deletedAt: null }),
    User.find({})
      .select('name phone email active deletedAt createdAt')
      .sort({ createdAt: -1 })
      .limit(SAMPLE_LIMIT)
      .lean(),
    listAdminUsersForPromotions(),
    listUsers({ page: 1, limit: SAMPLE_LIMIT, search: '' }),
    rawUsersCollection.countDocuments({
      deletedAt: null,
      $or: [
        { name: { $exists: false } },
        { name: null },
        { name: '' },
      ],
    }),
  ]);

  printSection('DB Connection', {
    dbName: mongoose.connection.db.databaseName,
    host: mongoose.connection.host,
    collectionChecked: 'users',
  });

  printSection('Raw users collection counts', {
    total: rawTotal,
    nonDeleted: rawNonDeletedTotal,
    blankNameNonDeleted: blankNameCount,
  });

  printSection('Taxi User model counts', {
    total: taxiUserTotal,
    nonDeleted: taxiUserNonDeletedTotal,
  });

  printSection('Raw users collection sample', rawSample.map(formatUser));
  printSection('Taxi User model sample', taxiUserSample.map(formatUser));

  printSection('Promo dropdown source', {
    count: promoUsers.length,
    sample: promoUsers.slice(0, SAMPLE_LIMIT).map(formatUser),
  });

  printSection('Admin users page source', {
    count: Number(adminUsersPage?.paginator?.total || 0),
    pageSize: Number(adminUsersPage?.paginator?.per_page || 0),
    sample: Array.isArray(adminUsersPage?.results) ? adminUsersPage.results.slice(0, SAMPLE_LIMIT).map(formatUser) : [],
  });
};

run()
  .catch((error) => {
    console.error('\nTaxi promo user diagnostic failed.');
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
