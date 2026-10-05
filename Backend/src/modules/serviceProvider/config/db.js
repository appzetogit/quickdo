const mongoose = require('mongoose');

/**
 * Connect to MongoDB
 */
const connectDB = async () => {
  try {
    // Standalone scripts only. Inside the server process master's connectDB() has
    // already run on this same mongoose singleton — a second connect() would open a
    // second pool, so bail out instead.
    if (mongoose.connection.readyState !== 0) {
      return mongoose.connection;
    }

    const conn = await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    if (error.name === 'MongooseServerSelectionError' || error.message.includes('connect ECONNREFUSED') || error.message.includes('querySrv ETIMEOUT')) {
      console.error('💡 TIP: If you switched networks (e.g., Office Wi-Fi), make sure your IP is whitelisted in MongoDB Atlas (Network Access -> Add 0.0.0.0/0).');
    }
    process.exit(1);
  }
};

module.exports = connectDB;

