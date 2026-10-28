require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const updateToSuperAdmin = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const email = 'admin@admin.com'; // The email from the user's previous request

    const admin = await Admin.findOne({ email });

    if (!admin) {
      console.log(`Admin with email ${email} not found.`);
      process.exit(1);
    }

    // Direct update to avoid any schema validation issues if enum wasn't updated yet in memory schema (though we did update file)
    // But using mongoose model save is safer if we want middleware.
    // However, since we defined enum in schema, we can just update.

    const result = await Admin.updateOne(
      { email },
      { $set: { role: 'super_admin' } }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Successfully updated ${email} to 'super_admin'.`);
    } else {
      console.log(`⚠️ Admin ${email} was found but role was not modified (maybe already super_admin?).`);
      console.log('Current role:', admin.role);
    }

  } catch (error) {
    console.error('Error updating admin:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  }
};

updateToSuperAdmin();
