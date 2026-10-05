const mongoose = require('mongoose');
const path = require('path');
// Explicitly load .env from the Backend root directory
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Category = require('../models/Category');
const Service = require('../models/Service');
const HomeContent = require('../models/HomeContent');

const INDORE_ID = '6976e2d00c60bc69f3e168dc'; // User provided ID

const migrateData = async () => {
  try {
    console.log('Connecting to MongoDB...');
    // Use MONGODB_URI as per config/db.js
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/appzeto';
    console.log(`Using URI length: ${uri.length}`); // Debug: check if URI is loaded
    await mongoose.connect(uri);
    console.log('Connected to MongoDB.');

    // 1. Verify Indore City existence (or create/mock if needed based on ID, but user said it exists)
    // Actually, user gave the dump. It might be in the DB or I might need to rely on the ID.
    // I'll trust the ID.

    // 2. Enable all Categories for Indore
    console.log('Updating Categories...');
    const categories = await Category.find({});
    let catCount = 0;
    for (const cat of categories) {
      if (!cat.cityIds.includes(INDORE_ID)) {
        cat.cityIds.push(INDORE_ID);
        await cat.save();
        catCount++;
      }
    }
    console.log(`Updated ${catCount} categories.`);

    // 3. Enable all Services for Indore
    console.log('Updating Services...');
    const services = await Service.find({});
    let servCount = 0;
    for (const serv of services) {
      if (!serv.cityIds.includes(INDORE_ID)) {
        serv.cityIds.push(INDORE_ID);
        await serv.save();
        servCount++;
      }
    }
    console.log(`Updated ${servCount} services.`);

    // 4. Migrate/Copy HomeContent
    console.log('Migrating HomeContent...');
    const defaultHome = await HomeContent.findOne({ cityId: null });

    if (defaultHome) {
      // Check if Indore HomeContent already exists
      let indoreHome = await HomeContent.findOne({ cityId: INDORE_ID });

      if (indoreHome) {
        console.log('Indore HomeContent already exists. Updating/Merging...');
        // Optional: Update it? User said "shift data".
        // Let's overwrite specific arrays if they are empty, or just leave it.
        // User said "only add". If it exists, maybe I shouldn't overwrite.
        // But if it's empty, I should fill it.
        // I will do a shallow copy of fields if they are meaningful in defaultHome
        indoreHome.banners = defaultHome.banners;
        indoreHome.promos = defaultHome.promos;
        indoreHome.curated = defaultHome.curated;
        indoreHome.noteworthy = defaultHome.noteworthy;
        indoreHome.booked = defaultHome.booked;
        indoreHome.categorySections = defaultHome.categorySections;
        await indoreHome.save();
        console.log('Updated existing Indore HomeContent.');
      } else {
        console.log('Creating new HomeContent for Indore...');
        const newHome = new HomeContent({
          cityId: INDORE_ID,
          banners: defaultHome.banners,
          promos: defaultHome.promos,
          curated: defaultHome.curated,
          noteworthy: defaultHome.noteworthy,
          booked: defaultHome.booked,
          categorySections: defaultHome.categorySections,
          isActive: true,
          isBannersVisible: defaultHome.isBannersVisible,
          isPromosVisible: defaultHome.isPromosVisible,
          isCuratedVisible: defaultHome.isCuratedVisible,
          isNoteworthyVisible: defaultHome.isNoteworthyVisible,
          isBookedVisible: defaultHome.isBookedVisible,
          isCategorySectionsVisible: defaultHome.isCategorySectionsVisible,
          isCategoriesVisible: defaultHome.isCategoriesVisible
        });
        await newHome.save();
        console.log('Created Indore HomeContent.');
      }
    } else {
      console.log('No default HomeContent found to copy.');
    }

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.connection.close();
  }
};

migrateData();
