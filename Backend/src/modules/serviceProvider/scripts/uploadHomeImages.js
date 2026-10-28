const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables FIRST before requiring any services
dotenv.config();

const connectDB = require('../config/db');
const HomeContent = require('../models/HomeContent');
const Category = require('../models/Category');
const { uploadFile } = require('../services/fileStorageService');

/**
 * Upload Home Page Images to Local Storage and Update Database
 * This script reads images from frontend assets and saves them to backend/upload folder,
 * then updates the HomeContent database with the file paths
 */

// Image mapping for home content
const homeImageMap = {
  // Banners
  banners: [
    {
      file: 'homepage-banner.png',
      path: 'Frontend/src/assets/images/pages/Home/Banner/homepage-banner.png',
      order: 0
    },
    {
      file: 'Winter-banner.png',
      path: 'Frontend/src/assets/images/pages/Home/Banner/Winter-banner.png',
      order: 1
    }
  ],
  
  // Most Booked Services images
  mostBooked: [
    {
      file: 'intense-bathroom-2.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/intense-bathroom-2.jpg',
      title: 'Intense cleaning (2 bathrooms)'
    },
    {
      file: 'intense-bathroom-3.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/intense-bathroom-3.jpg',
      title: 'Intense cleaning (3 bathrooms)'
    },
    {
      file: 'dreill&hang.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/dreill&hang.jpg',
      title: 'Drill & hang (wall decor)'
    },
    {
      file: 'roll-on-wax.webp',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/roll-on-wax.webp',
      title: 'Roll-on waxing (Full arms, legs & underarms)'
    },
    {
      file: 'tap-repai.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/tap-repai.jpg',
      title: 'Tap repair'
    },
    {
      file: 'automatic-top-load-machine.webp',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/automatic-top-load-machine.webp',
      title: 'Automatic top load machine check-up'
    },
    {
      file: 'spacula-waxing.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/spacula-waxing.jpg',
      title: 'Spatula waxing (Full arms)'
    },
    {
      file: 'fan-repairs.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/fan-repairs.jpg',
      title: 'Fan repair (ceiling/exhaust/wall)'
    },
    {
      file: 'switch-board.jpg',
      path: 'Frontend/src/assets/images/pages/Home/MostBookedServices/switch-board.jpg',
      title: 'Switch/socket replacement'
    }
  ],
  
  // New and Noteworthy images
  noteworthy: [
    {
      file: 'water-purifiers.png',
      path: 'Frontend/src/assets/images/pages/Home/NewAndNoteworthy/water-purifiers.png',
      title: 'Native Water Purifier'
    },
    {
      file: 'bathroom-cleaning.png',
      path: 'Frontend/src/assets/images/pages/Home/NewAndNoteworthy/bathroom-cleaning.png',
      title: 'Bathroom & Kitchen Cleaning'
    },
    {
      file: 'hair-studio.png',
      path: 'Frontend/src/assets/images/pages/Home/NewAndNoteworthy/hair-studio.png',
      title: 'Hair Studio for Women'
    },
    {
      file: 'ac-repair.png',
      path: 'Frontend/src/assets/images/pages/Home/NewAndNoteworthy/ac-repair.png',
      title: 'AC Service and Repair'
    }
  ],
  
  // Promo Carousel images
  promos: [
    {
      file: '1764052270908-bae94c.jpg',
      path: 'Frontend/src/assets/images/pages/Home/promo-carousel/1764052270908-bae94c.jpg',
      title: 'Shine your bathroom deserves',
      subtitle: '',
      buttonText: 'Book now',
      gradientClass: 'from-green-600 to-green-700',
      order: 6
    },
    {
      file: '1678450687690-81f922.jpg',
      path: 'Frontend/src/assets/images/pages/Home/promo-carousel/1678450687690-81f922.jpg',
      title: 'New Service',
      subtitle: 'Smart Home Installation - Get 20% off',
      buttonText: 'Explore',
      gradientClass: 'from-blue-600 to-blue-800',
      order: 1
    },
    {
      file: '1745822547742-760034.jpg',
      path: 'Frontend/src/assets/images/pages/Home/promo-carousel/1745822547742-760034.jpg',
      title: 'Emergency',
      subtitle: '24/7 Emergency Services',
      buttonText: 'Call Now',
      gradientClass: 'from-orange-600 to-orange-800',
      order: 2
    },
    {
      file: '1711428209166-2d42c0.jpg',
      path: 'Frontend/src/assets/images/pages/Home/promo-carousel/1711428209166-2d42c0.jpg',
      title: 'Special Offer',
      subtitle: 'Get amazing deals on all services',
      buttonText: 'Book now',
      gradientClass: 'from-blue-600 to-blue-800',
      order: 3
    },
    {
      file: '1762785595543-540198.jpg',
      path: 'Frontend/src/assets/images/pages/Home/promo-carousel/1762785595543-540198.jpg',
      title: 'Premium Services',
      subtitle: 'Experience the best',
      buttonText: 'Explore',
      gradientClass: 'from-indigo-600 to-indigo-800',
      order: 4
    },
    {
      file: '1678454437383-aa4984.jpg',
      path: 'Frontend/src/assets/images/pages/Home/promo-carousel/1678454437383-aa4984.jpg',
      title: 'Limited Time',
      subtitle: 'Hurry up! Limited offers',
      buttonText: 'Book now',
      gradientClass: 'from-pink-600 to-pink-800',
      order: 5
    }
  ]
};

const uploadHomeImages = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    const basePath = path.join(__dirname, '../..');
    const uploadedUrls = {
      banners: [],
      mostBooked: {},
      noteworthy: {},
      promos: []
    };

    // ============================================
    // UPLOAD BANNER IMAGES
    // ============================================
    console.log('📤 Uploading Banner Images...\n');
    
    for (const banner of homeImageMap.banners) {
      const imagePath = path.join(basePath, banner.path);
      
      if (!fs.existsSync(imagePath)) {
        console.log(`  ⚠️  Banner image not found: ${banner.file}`);
        continue;
      }

      const fileBuffer = fs.readFileSync(imagePath);
      console.log(`  📤 Uploading ${banner.file}...`);
      
      const uploadResult = await uploadFile(fileBuffer, {
        folder: 'home/banners',
        public_id: `banner-${banner.order}`,
        extension: path.extname(banner.file).substring(1) || 'png'
      });

      if (uploadResult.success) {
        uploadedUrls.banners.push({
          url: uploadResult.url,
          order: banner.order
        });
        console.log(`  ✅ Uploaded: ${uploadResult.url}`);
      } else {
        console.log(`  ❌ Failed: ${uploadResult.error}`);
      }
    }

    // ============================================
    // UPLOAD MOST BOOKED SERVICES IMAGES
    // ============================================
    console.log('\n📤 Uploading Most Booked Services Images...\n');
    
    for (const item of homeImageMap.mostBooked) {
      const imagePath = path.join(basePath, item.path);
      
      if (!fs.existsSync(imagePath)) {
        console.log(`  ⚠️  Image not found: ${item.file}`);
        continue;
      }

      const fileBuffer = fs.readFileSync(imagePath);
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      
      console.log(`  📤 Uploading ${item.file} for "${item.title}"...`);
      
      const uploadResult = await uploadFile(fileBuffer, {
        folder: 'home/most-booked',
        public_id: `most-booked-${slug}`,
        extension: path.extname(item.file).substring(1) || 'png'
      });

      if (uploadResult.success) {
        uploadedUrls.mostBooked[item.title] = uploadResult.url;
        console.log(`  ✅ Uploaded: ${uploadResult.url}`);
      } else {
        console.log(`  ❌ Failed: ${uploadResult.error}`);
      }
    }

    // ============================================
    // UPLOAD NEW AND NOTEWORTHY IMAGES
    // ============================================
    console.log('\n📤 Uploading New and Noteworthy Images...\n');
    
    for (const item of homeImageMap.noteworthy) {
      const imagePath = path.join(basePath, item.path);
      
      if (!fs.existsSync(imagePath)) {
        console.log(`  ⚠️  Image not found: ${item.file}`);
        continue;
      }

      const fileBuffer = fs.readFileSync(imagePath);
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      
      console.log(`  📤 Uploading ${item.file} for "${item.title}"...`);
      
      const uploadResult = await uploadFile(fileBuffer, {
        folder: 'home/noteworthy',
        public_id: `noteworthy-${slug}`,
        extension: path.extname(item.file).substring(1) || 'png'
      });

      if (uploadResult.success) {
        uploadedUrls.noteworthy[item.title] = uploadResult.url;
        console.log(`  ✅ Uploaded: ${uploadResult.url}`);
      } else {
        console.log(`  ❌ Failed: ${uploadResult.error}`);
      }
    }

    // ============================================
    // UPLOAD PROMO CAROUSEL IMAGES
    // ============================================
    console.log('\n📤 Uploading Promo Carousel Images...\n');
    
    for (const item of homeImageMap.promos) {
      const imagePath = path.join(basePath, item.path);
      
      if (!fs.existsSync(imagePath)) {
        console.log(`  ⚠️  Image not found: ${item.file}`);
        continue;
      }

      const fileBuffer = fs.readFileSync(imagePath);
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      
      console.log(`  📤 Uploading ${item.file} for "${item.title}"...`);
      
      const uploadResult = await uploadFile(fileBuffer, {
        folder: 'home/promos',
        public_id: `promo-${slug}`,
        extension: path.extname(item.file).substring(1) || 'png'
      });

      if (uploadResult.success) {
        uploadedUrls.promos.push({
          ...item,
          imageUrl: uploadResult.url
        });
        console.log(`  ✅ Uploaded: ${uploadResult.url}`);
      } else {
        console.log(`  ❌ Failed: ${uploadResult.error}`);
      }
    }

    // ============================================
    // UPDATE HOMECONTENT IN DATABASE
    // ============================================
    console.log('\n📝 Updating HomeContent in database...\n');

    const categories = await Category.find({});
    const electricityCat = categories.find(c => c.slug === 'electricity');
    const cleaningCat = categories.find(c => c.slug === 'cleaning');
    const salonCat = categories.find(c => c.slug === 'womens-salon-spa');
    const applianceCat = categories.find(c => c.slug === 'ac-appliance-repair');
    const repairCat = categories.find(c => c.slug === 'electrician-plumber-carpenter');

    let homeContent = await HomeContent.findOne();
    
    if (!homeContent) {
      homeContent = new HomeContent({});
    }

    // Update banners
    if (uploadedUrls.banners.length > 0) {
      homeContent.banners = [
        {
          imageUrl: uploadedUrls.banners.find(b => b.order === 0)?.url || '',
          text: 'Professional Home Services',
          targetCategoryId: electricityCat?._id || null,
          scrollToSection: '',
          order: 0
        },
        {
          imageUrl: uploadedUrls.banners.find(b => b.order === 1)?.url || '',
          text: 'Quality Services at Your Doorstep',
          targetCategoryId: cleaningCat?._id || null,
          scrollToSection: '',
          order: 1
        }
      ];
      console.log('  ✅ Updated banners');
    }

    // Update most booked services
    const mostBookedData = [
      {
        title: 'Intense cleaning (2 bathrooms)',
        rating: '4.79',
        reviews: '3.7M',
        price: '950',
        originalPrice: '1,038',
        discount: '8%',
        imageUrl: uploadedUrls.mostBooked['Intense cleaning (2 bathrooms)'] || '',
        targetCategoryId: cleaningCat?._id || null,
        order: 0
      },
      {
        title: 'AC Service',
        rating: '4.83',
        reviews: '280K',
        price: '500',
        originalPrice: '',
        discount: '',
        imageUrl: uploadedUrls.noteworthy['AC Service and Repair'] || '',
        targetCategoryId: applianceCat?._id || null,
        order: 1
      }
    ];

    homeContent.booked = mostBookedData;
    console.log('  ✅ Updated most booked services');

    // Update noteworthy
    const noteworthyData = [
      {
        title: 'Native Water Purifier',
        imageUrl: uploadedUrls.noteworthy['Native Water Purifier'] || '',
        targetCategoryId: applianceCat?._id || null,
        order: 0
      },
      {
        title: 'Bathroom & Kitchen Cleaning',
        imageUrl: uploadedUrls.noteworthy['Bathroom & Kitchen Cleaning'] || '',
        targetCategoryId: cleaningCat?._id || null,
        order: 1
      },
      {
        title: 'Hair Studio for Women',
        imageUrl: uploadedUrls.noteworthy['Hair Studio for Women'] || '',
        targetCategoryId: salonCat?._id || null,
        order: 2
      },
      {
        title: 'AC Service and Repair',
        imageUrl: uploadedUrls.noteworthy['AC Service and Repair'] || '',
        targetCategoryId: applianceCat?._id || null,
        order: 3
      }
    ];

    homeContent.noteworthy = noteworthyData;
    console.log('  ✅ Updated new and noteworthy');

    // Update promos
    if (uploadedUrls.promos.length > 0) {
      const promosData = uploadedUrls.promos.map((promo) => {
        // Map route to targetCategoryId based on route
        let targetCategoryId = null;
        if (promo.route === '/electrician' || promo.route === '/electricity') {
          targetCategoryId = electricityCat?._id || null;
        } else if (promo.route === '/ac-service') {
          targetCategoryId = applianceCat?._id || null;
        } else if (promo.route === '/salon-for-women') {
          targetCategoryId = salonCat?._id || null;
        } else if (promo.route === '/bathroom-kitchen-cleaning') {
          targetCategoryId = cleaningCat?._id || null;
        }

        return {
          title: promo.title,
          subtitle: promo.subtitle || '',
          buttonText: promo.buttonText || 'Explore',
          gradientClass: promo.gradientClass || 'from-blue-600 to-blue-800',
          imageUrl: promo.imageUrl || '',
          targetCategoryId: targetCategoryId,
          scrollToSection: '',
          order: promo.order || 0
        };
      });

      homeContent.promos = promosData;
      console.log(`  ✅ Updated promos: ${promosData.length} items`);
    }

    // Update category sections
    homeContent.categorySections = [
      {
        title: 'Home Appliances',
        seeAllTargetCategoryId: applianceCat?._id || null,
        cards: [
          {
            title: 'AC',
            imageUrl: '',
            badge: null,
            targetCategoryId: applianceCat?._id || null
          },
          {
            title: 'Washing Machine',
            imageUrl: '',
            badge: null,
            targetCategoryId: applianceCat?._id || null
          },
          {
            title: 'Refrigerator',
            imageUrl: '',
            badge: null,
            targetCategoryId: applianceCat?._id || null
          }
        ],
        order: 0
      },
      {
        title: 'Home Repairs',
        seeAllTargetCategoryId: repairCat?._id || null,
        cards: [
          {
            title: 'Electrical',
            imageUrl: '',
            badge: null,
            targetCategoryId: repairCat?._id || null
          },
          {
            title: 'Plumbing',
            imageUrl: '',
            badge: null,
            targetCategoryId: repairCat?._id || null
          },
          {
            title: 'Carpentry',
            imageUrl: '',
            badge: null,
            targetCategoryId: repairCat?._id || null
          }
        ],
        order: 1
      }
    ];
    console.log('  ✅ Updated category sections');

    await homeContent.save();
    console.log('\n✅ HomeContent updated in database\n');

    // Summary
    console.log('='.repeat(50));
    console.log('📊 UPLOAD SUMMARY');
    console.log('='.repeat(50));
    console.log(`Banners uploaded: ${uploadedUrls.banners.length}`);
    console.log(`Most Booked images uploaded: ${Object.keys(uploadedUrls.mostBooked).length}`);
    console.log(`Noteworthy images uploaded: ${Object.keys(uploadedUrls.noteworthy).length}`);
    console.log('='.repeat(50));
    console.log('\n✅ Home images upload completed successfully!\n');

  } catch (error) {
    console.error('❌ Error uploading home images:', error);
    process.exit(1);
  } finally {
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

uploadHomeImages();

