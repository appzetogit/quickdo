const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables FIRST before requiring any services
dotenv.config();

const connectDB = require('../config/db');
const Category = require('../models/Category');
const Service = require('../models/Service');
const { uploadFile } = require('../services/fileStorageService');

/**
 * Upload Icons to Local Storage and Update Database
 * This script reads icon files from frontend assets and saves them to backend/upload folder,
 * then updates the database with the file paths
 */

// Icon mapping: category slug -> icon filename
const categoryIconMap = {
  'electricity': 'electrician.png',
  'womens-salon-spa': 'womens-salon-spa-icon.png',
  'massage-for-men': 'massage-men-icon.png',
  'cleaning': 'cleaning-icon.png',
  'electrician-plumber-carpenter': 'electrician-plumber-carpenter-icon.png',
  'ac-appliance-repair': 'ac-appliance-repair-icon.png'
};

// Service icon mapping: service slug -> icon filename
const serviceIconMap = {
  // Electricity
  'electricity': 'electrician.png',

  // Women's Salon & Spa
  'salon-for-women': 'salon.png',
  'spa-for-women': 'spa.png',
  'hair-studio-for-women': 'hair.png',

  // Massage for Men
  'massage-for-men': 'massage-men-icon.png',

  // Cleaning
  'bathroom-kitchen-cleaning': 'bathroom-clean.png',
  'sofa-carpet-cleaning': 'sofa.png',

  // Electrician, Plumber & Carpenter
  'electrical-repair': 'electrician.png',
  'plumbing-services': 'plumber.png',
  'carpentry-work': 'carpenter.png',
  'installation-services': 'electrician.png', // Default to electrician

  // AC & Appliance Repair
  'ac': 'ac-icon.png',
  'washing-machine-repair': 'washing-machine-icon.png',
  'geyser-repair': 'geyser-icon.png',
  'water-purifier-repair': 'water-purifier-icon.png',
  'refrigerator-repair': 'refrigerator-icon.png',
  'microwave-repair': 'microwave-icon.png'
};

const uploadIcons = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Path to frontend icons folder
    const frontendPath = path.join(__dirname, '../../Frontend/src/assets/images/icons/services');

    if (!fs.existsSync(frontendPath)) {
      console.error(`❌ Icons folder not found at: ${frontendPath}`);
      console.log('Please ensure the Frontend folder exists and contains the icons.');
      process.exit(1);
    }

    console.log(`📁 Reading icons from: ${frontendPath}\n`);

    // ============================================
    // UPLOAD CATEGORY ICONS
    // ============================================
    console.log('📤 Uploading Category Icons...\n');

    const categories = await Category.find({});
    let categoryUpdates = 0;

    for (const category of categories) {
      const iconFileName = categoryIconMap[category.slug];

      if (!iconFileName) {
        console.log(`  ⏭️  No icon mapping for category: ${category.title} (${category.slug})`);
        continue;
      }

      const iconPath = path.join(frontendPath, iconFileName);

      if (!fs.existsSync(iconPath)) {
        console.log(`  ⚠️  Icon file not found: ${iconFileName} for category: ${category.title}`);
        continue;
      }

      // Read file
      const fileBuffer = fs.readFileSync(iconPath);

      // Upload to local storage
      console.log(`  📤 Uploading ${iconFileName} for ${category.title}...`);
      const uploadResult = await uploadFile(fileBuffer, {
        folder: 'icons/categories',
        public_id: `category-${category.slug}`,
        extension: path.extname(iconFileName).substring(1) || 'png',
        type: 'icon'
      });

      if (uploadResult.success) {
        // Update category in database
        category.homeIconUrl = uploadResult.url;
        await category.save();
        console.log(`  ✅ Updated ${category.title} with icon: ${uploadResult.url}`);
        categoryUpdates++;
      } else {
        console.log(`  ❌ Failed to upload icon for ${category.title}: ${uploadResult.error}`);
      }
    }

    console.log(`\n✅ Category icons updated: ${categoryUpdates}/${categories.length}\n`);

    // ============================================
    // UPLOAD SERVICE ICONS
    // ============================================
    console.log('📤 Uploading Service Icons...\n');

    const services = await Service.find({});
    let serviceUpdates = 0;

    for (const service of services) {
      const iconFileName = serviceIconMap[service.slug];

      if (!iconFileName) {
        console.log(`  ⏭️  No icon mapping for service: ${service.title} (${service.slug})`);
        continue;
      }

      const iconPath = path.join(frontendPath, iconFileName);

      if (!fs.existsSync(iconPath)) {
        console.log(`  ⚠️  Icon file not found: ${iconFileName} for service: ${service.title}`);
        continue;
      }

      // Read file
      const fileBuffer = fs.readFileSync(iconPath);

      // Upload to local storage
      console.log(`  📤 Uploading ${iconFileName} for ${service.title}...`);
      const uploadResult = await uploadFile(fileBuffer, {
        folder: 'icons/services',
        public_id: `service-${service.slug}`,
        extension: path.extname(iconFileName).substring(1) || 'png',
        type: 'icon'
      });

      if (uploadResult.success) {
        // Update service in database
        service.iconUrl = uploadResult.url;
        await service.save();
        console.log(`  ✅ Updated ${service.title} with icon: ${uploadResult.url}`);
        serviceUpdates++;
      } else {
        console.log(`  ❌ Failed to upload icon for ${service.title}: ${uploadResult.error}`);
      }
    }

    console.log(`\n✅ Service icons updated: ${serviceUpdates}/${services.length}\n`);

    // Summary
    console.log('='.repeat(50));
    console.log('📊 UPLOAD SUMMARY');
    console.log('='.repeat(50));
    console.log(`Categories updated: ${categoryUpdates}`);
    console.log(`Services updated: ${serviceUpdates}`);
    console.log('='.repeat(50));
    console.log('\n✅ Icon upload completed successfully!\n');

  } catch (error) {
    console.error('❌ Error uploading icons:', error);
    process.exit(1);
  } finally {
    // Close database connection
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Run upload script
uploadIcons();

