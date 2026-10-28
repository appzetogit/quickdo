const dotenv = require('dotenv');
const connectDB = require('../config/db');
const HomeContent = require('../models/HomeContent');

dotenv.config();

const checkHomeContent = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    const homeContent = await HomeContent.findOne();

    if (!homeContent) {
      console.log('❌ No HomeContent found in database');
    } else {
      console.log('✅ HomeContent found!\n');
      console.log('📊 HomeContent Data:');
      console.log('='.repeat(50));
      console.log(`Banners: ${homeContent.banners?.length || 0}`);
      console.log(`Promos: ${homeContent.promos?.length || 0}`);
      console.log(`Curated: ${homeContent.curated?.length || 0}`);
      console.log(`Noteworthy: ${homeContent.noteworthy?.length || 0}`);
      console.log(`Booked: ${homeContent.booked?.length || 0}`);
      console.log(`Category Sections: ${homeContent.categorySections?.length || 0}`);
      console.log('='.repeat(50));

      if (homeContent.banners && homeContent.banners.length > 0) {
        console.log('\n📸 Banners:');
        homeContent.banners.forEach((banner, i) => {
          console.log(`  ${i + 1}. ${banner.text || 'No text'}`);
          console.log(`     Image: ${banner.imageUrl ? '✅ Has URL' : '❌ No URL'}`);
        });
      }

      if (homeContent.booked && homeContent.booked.length > 0) {
        console.log('\n📦 Most Booked Services:');
        homeContent.booked.forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.title}`);
          console.log(`     Image: ${item.imageUrl ? '✅ Has URL' : '❌ No URL'}`);
        });
      }

      if (homeContent.noteworthy && homeContent.noteworthy.length > 0) {
        console.log('\n⭐ New and Noteworthy:');
        homeContent.noteworthy.forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.title}`);
          console.log(`     Image: ${item.imageUrl ? '✅ Has URL' : '❌ No URL'}`);
          console.log(`     Slug: ${item.slug || '❌ No Slug'}`);
          console.log(`     CatId: ${item.targetCategoryId || '❌ No CatId'}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
};

checkHomeContent();

