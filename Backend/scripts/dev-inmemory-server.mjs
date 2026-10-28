// Boots the real backend against a throwaway in-memory MongoDB and seeds one
// platform superadmin, so the frontend can be driven end-to-end without pointing at
// Atlas. Nothing here writes to a real database.
//
// Run:  node scripts/dev-inmemory-server.mjs
// Then: cd ../Frontend && VITE_BACKEND_PROXY_TARGET=http://localhost:5000 npm run dev

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.MONGO_URI = mongod.getUri();
process.env.MONGODB_URI = mongod.getUri();
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '5000';
process.env.REDIS_ENABLED = 'false';
process.env.BULLMQ_ENABLED = 'false';

await import('../server.js');
await new Promise((r) => setTimeout(r, 3000));

await mongoose.connect(process.env.MONGO_URI);
const { FoodAdmin } = await import('../src/core/admin/admin.model.js');

const EMAIL = 'dev-admin@local.test';
const PASSWORD = 'DevAdmin123!';

if (!(await FoodAdmin.findOne({ email: EMAIL }))) {
    await FoodAdmin.create({
        email: EMAIL,
        password: PASSWORD,
        name: 'Dev Platform Admin',
        isActive: true,
        servicesAccess: ['food', 'quickCommerce', 'taxi', 'serviceProvider'],
        adminLevel: 'platform_superadmin',
        admin_type: 'superadmin',
        role: 'super_admin', // SP's isSuperAdmin re-reads this from the DB
        permissions: ['*'],
    });
}

console.log('\n────────────────────────────────────────────');
console.log(` in-memory backend up on :${process.env.PORT}`);
console.log(` admin login  ${EMAIL} / ${PASSWORD}`);
console.log('────────────────────────────────────────────\n');

process.on('SIGINT', async () => {
    await mongod.stop();
    process.exit(0);
});
