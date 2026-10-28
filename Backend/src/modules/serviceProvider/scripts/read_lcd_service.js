const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Service = require('../models/Service');
const Category = require('../models/Category');

dotenv.config();
const connectDB = require('../config/db');

(async () => {
  try {
    await connectDB();
    console.log('Connected.');

    // Find LCD Repair service
    const service = await Service.findOne({ slug: 'lcd-repair' }).populate('categoryId');

    if (!service) {
      console.log('LCD Repair service not found.');
    } else {
      console.log('--- SERVICE FOUND: LCD Repair ---');
      console.log(JSON.stringify(service, null, 2));
    }

    // Also look for "Installation" service under LCD category if possible
    const installation = await Service.findOne({ slug: 'installation' }); // Slug from previous ls output
    if (installation) {
      console.log('--- SERVICE FOUND: Installation ---');
      console.log(JSON.stringify(installation, null, 2));
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
