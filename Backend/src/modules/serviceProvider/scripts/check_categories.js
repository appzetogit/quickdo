const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Category = require('../models/Category');
const Service = require('../models/Service');

dotenv.config();
const connectDB = require('../config/db');

(async () => {
  try {
    await connectDB();
    console.log('Connected.');

    const categories = await Category.find({});
    console.log('--- CATEGORIES ---');
    categories.forEach(c => console.log(`${c.title} (${c.slug}) [_id: ${c._id}]`));

    const services = await Service.find({});
    console.log('--- SERVICES ---');
    services.forEach(s => console.log(`${s.title} (${s.slug}) [CatId: ${s.categoryId}]`));

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
