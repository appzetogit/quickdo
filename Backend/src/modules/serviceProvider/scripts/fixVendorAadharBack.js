const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PLACEHOLDER_URL = 'https://placehold.co/400x250/e2e8f0/94a3b8?text=Aadhar+Back';

const run = async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/appzeto';
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('Connected.');

    const result = await mongoose.connection.db.collection('sp_vendors').updateMany(
      {
        $or: [
          { 'aadhar.backDocument': { $exists: false } },
          { 'aadhar.backDocument': null },
          { 'aadhar.backDocument': '' }
        ]
      },
      {
        $set: { 'aadhar.backDocument': PLACEHOLDER_URL }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} vendor(s) with placeholder Aadhar Back document.`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('Connection closed.');
  }
};

run();
