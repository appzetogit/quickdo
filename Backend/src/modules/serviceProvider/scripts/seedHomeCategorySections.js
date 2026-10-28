require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('../models/Category');
const HomeContent = require('../models/HomeContent');
const { uploadFile } = require('../services/fileStorageService');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/appzeto');
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const uploadImageToCloudinary = async (imagePath, folder = 'categories') => {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Image not found: ${imagePath}`);
      return null;
    }

    const fs = require('fs');
    const imageBuffer = fs.readFileSync(imagePath);
    const result = await uploadFile(imageBuffer, {
      folder,
      public_id: require('path').basename(imagePath, require('path').extname(imagePath))
    });
    console.log(`Uploaded ${require('path').basename(imagePath)}`);
    return result.url;
  } catch (error) {
    console.error(`Failed to upload image:`, error.message);
    return null;
  }
};

const seedHomeCategorySections = async () => {
  try {
    console.log('Starting home category sections seeding...');

    // 1. Find or create categories
    console.log('Checking/creating categories...');

    const categoriesData = [
      { title: 'Electrical Installation & Repair', slug: 'electrical-installation-repair' },
      { title: 'Appliance Repair & Service', slug: 'appliance-repair-service' },
      { title: 'Home Repair & Installation', slug: 'home-repair-installation' },
      // Individual service categories
      { title: 'Home Wiring Installation', slug: 'home-wiring-installation' },
      { title: 'Panel Upgrade & Repair', slug: 'panel-upgrade-repair' },
      { title: 'Smart Home Setup', slug: 'smart-home-setup' },
      { title: 'AC Service and Repair', slug: 'ac-service-repair' },
      { title: 'Washing Machine Repair', slug: 'washing-machine-repair' },
      { title: 'Water Heater Repair', slug: 'water-heater-repair' },
      { title: 'Refrigerator Repair', slug: 'refrigerator-repair' },
      { title: 'Drill & Hang', slug: 'drill-hang' },
      { title: 'Tap Repair', slug: 'tap-repair' },
      { title: 'Fan Repair', slug: 'fan-repair' },
      { title: 'Switch & Socket Installation', slug: 'switch-socket-installation' }
    ];

    const categories = {};
    for (const catData of categoriesData) {
      let category = await Category.findOne({ slug: catData.slug });
      if (!category) {
        category = new Category({
          title: catData.title,
          slug: catData.slug,
          description: `${catData.title} services`,
          iconUrl: '',
          imageUrl: '',
          isActive: true,
          showOnHome: false,
          homeOrder: 0
        });
        await category.save();
        console.log(`Created category: ${catData.title}`);
      } else {
        console.log(`Category already exists: ${catData.title}`);
      }
      categories[catData.slug] = category;
    }

    // 2. Upload images (using placeholder URLs since we don't have local images)
    console.log('Setting up image URLs...');

    // 3. Create category sections data
    const categorySections = [
      {
        title: 'Electrical Installation & Repair',
        seeAllTargetCategoryId: categories['electrical-installation-repair']._id,
        order: 1,
        cards: [
          {
            title: 'Home Wiring Installation',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135138/Homster/electricity/service/home-wiring.jpg',
            badge: '',
            targetCategoryId: categories['home-wiring-installation']._id
          },
          {
            title: 'Panel Upgrade & Repair',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135139/Homster/electricity/service/electrical-panel-upgrade.jpg',
            badge: '',
            targetCategoryId: categories['panel-upgrade-repair']._id
          },
          {
            title: 'Smart Home Setup',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135140/Homster/electricity/service/smart-home-setup.jpg',
            badge: 'NEW',
            targetCategoryId: categories['smart-home-setup']._id
          }
        ]
      },
      {
        title: 'Appliance repair & service',
        seeAllTargetCategoryId: categories['appliance-repair-service']._id,
        order: 2,
        cards: [
          {
            title: 'AC Service and Repair',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135151/Homster/appliance/service/ac-repair.jpg',
            badge: '',
            targetCategoryId: categories['ac-service-repair']._id
          },
          {
            title: 'Washing Machine Repair',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135152/Homster/appliance/service/washing-machine-repair-.jpg',
            badge: '',
            targetCategoryId: categories['washing-machine-repair']._id
          },
          {
            title: 'Water Heater Repair',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135154/Homster/appliance/service/water-heater-repair.jpg',
            badge: '',
            targetCategoryId: categories['water-heater-repair']._id
          },
          {
            title: 'Refrigerator Repair',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135154/Homster/appliance/service/water-heater-repair.jpg',
            badge: '',
            targetCategoryId: categories['refrigerator-repair']._id
          }
        ]
      },
      {
        title: 'Home repair & installation',
        seeAllTargetCategoryId: categories['home-repair-installation']._id,
        order: 3,
        cards: [
          {
            title: 'Drill & hang (wall decor)',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135147/Homster/electricity/service/wiring.jpg',
            badge: '',
            targetCategoryId: categories['drill-hang']._id
          },
          {
            title: 'Tap repair',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135147/Homster/electricity/service/wiring.jpg',
            badge: '',
            targetCategoryId: categories['tap-repair']._id
          },
          {
            title: 'Fan repair, exhaust, etc.',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135144/Homster/electricity/service/fan.png',
            badge: '',
            targetCategoryId: categories['fan-repair']._id
          },
          {
            title: 'Switch & Socket Installation',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135141/Homster/electricity/service/switch-socket.jpg',
            badge: '',
            targetCategoryId: categories['switch-socket-installation']._id
          }
        ]
      }
    ];

    // 4. Update HomeContent
    console.log('Updating HomeContent with category sections...');

    let homeContent = await HomeContent.findOne();
    if (!homeContent) {
      homeContent = new HomeContent();
    }

    homeContent.categorySections = categorySections;
    await homeContent.save();

    console.log('HomeContent updated with category sections!');
    console.log(`Added ${categorySections.length} sections with ${categorySections.reduce((sum, s) => sum + s.cards.length, 0)} total cards`);

  } catch (error) {
    console.error('Error seeding home category sections:', error);
    throw error;
  }
};

// Run the seeding
const runSeeding = async () => {
  try {
    await connectDB();
    await seedHomeCategorySections();
    console.log('Category sections seeding completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

if (require.main === module) {
  runSeeding();
}

module.exports = { seedHomeCategorySections };
