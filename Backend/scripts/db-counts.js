/** Read-only diagnostic: which DB are we on, and what's in it? */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('no uri'); process.exit(1); }

// Show host + db name only, never credentials.
const safe = uri.replace(/\/\/[^@]*@/, '//<redacted>@');
console.log('URI:', safe);

await mongoose.connect(uri);
const db = mongoose.connection.db;
console.log('Connected DB name:', db.databaseName);

const cols = await db.listCollections().toArray();
console.log('Collections:', cols.length);

const rows = [];
for (const c of cols) {
  const n = await db.collection(c.name).countDocuments();
  if (n > 0) rows.push([c.name, n]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log('--- non-empty collections ---');
for (const [name, n] of rows) console.log(`${String(n).padStart(7)}  ${name}`);
if (!rows.length) console.log('(all collections empty)');

await mongoose.disconnect();
