const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import Models
const City = require('../models/City');
const Service = require('../models/Service');
const Category = require('../models/Category');
const HomeContent = require('../models/HomeContent');
const Admin = require('../models/Admin');

// Connect to Database
const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI is not defined in environment variables');

    await mongoose.connect(uri);
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err.message);
    process.exit(1);
  }
};

const migrate = async () => {
  await connectDB();

  try {
    console.log('Starting Migration to Multi-City Architecture...');

    // 1. Ensure Default City Exists
    console.log('Checking for Default City...');
    let defaultCity = await City.findOne({ isDefault: true });

    if (!defaultCity) {
      console.log('Creating Default City...');
      defaultCity = await City.create({
        name: 'Default City',
        slug: 'default-city',
        state: 'Default State',
        country: 'India',
        isDefault: true,
        isActive: true,
        displayOrder: 0
      });
      console.log(`Default City Created: ${defaultCity.name} (${defaultCity._id})`);
    } else {
      console.log(`Default City already exists: ${defaultCity.name} (${defaultCity._id})`);
    }

    const defaultCityId = defaultCity._id;

    // 2. Migrate Categories
    console.log('Migrating Categories...');
    const categoriesQuery = { $or: [{ cityIds: { $exists: false } }, { cityIds: { $size: 0 } }] };
    const categories = await Category.find(categoriesQuery); // Find categories with no cities
    console.log(`Found ${categories.length} categories to migrate.`);

    if (categories.length > 0) {
      const result = await Category.updateMany(
        categoriesQuery,
        { $addToSet: { cityIds: defaultCityId } }
      );
      console.log(`Updated ${result.modifiedCount} categories.`);
    }

    // 3. Migrate Services
    console.log('Migrating Services...');
    const servicesQuery = { $or: [{ cityIds: { $exists: false } }, { cityIds: { $size: 0 } }] };
    const services = await Service.find(servicesQuery);
    console.log(`Found ${services.length} services to migrate.`);

    if (services.length > 0) {
      const result = await Service.updateMany(
        servicesQuery,
        { $addToSet: { cityIds: defaultCityId } }
      );
      console.log(`Updated ${result.modifiedCount} services.`);
    }

    // 4. Migrate HomeContent
    console.log('Migrating HomeContent...');
    // Find HomeContent that has no cityId (legacy singleton)
    const homeContent = await HomeContent.findOne({ cityId: null });

    if (homeContent) {
      console.log('Found legacy HomeContent. Creating Default City HomeContent if missing...');

      // Check if Default City already has content
      const defaultCityContent = await HomeContent.findOne({ cityId: defaultCityId });

      if (!defaultCityContent) {
        // Clone the legacy content to the default city
        const contentData = homeContent.toObject();
        delete contentData._id;
        delete contentData.createdAt;
        delete contentData.updatedAt;
        contentData.cityId = defaultCityId;

        await HomeContent.create(contentData);
        console.log('Cloned legacy HomeContent to Default City.');
      } else {
        console.log('Default City HomeContent already exists. Skipping clone.');
      }
    } else {
      // If no legacy content, create a fresh one for default city
      const defaultCityContent = await HomeContent.findOne({ cityId: defaultCityId });
      if (!defaultCityContent) {
        await HomeContent.create({ cityId: defaultCityId });
        console.log('Created fresh HomeContent for Default City.');
      }
    }

    // 5. Migrate Admins (optional)
    console.log('Migrating Admins...');
    // We only migrate 'admin' role, not 'super_admin' (who stay global/null)
    const admins = await Admin.find({ role: 'admin', cityId: null });
    console.log(`Found ${admins.length} admins to migrate to Default City.`);

    if (admins.length > 0) {
      const result = await Admin.updateMany(
        { role: 'admin', cityId: null },
        { cityId: defaultCityId }
      );
      console.log(`Updated ${result.modifiedCount} admins.`);
    }

    console.log('Migration Completed Successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration Failed:', err);
    process.exit(1);
  }
};

migrate();
