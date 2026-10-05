require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Category = require('../models/Category');
const Service = require('../models/Service');
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

const uploadImageToCloudinary = async (imagePath, folder = 'electrician') => {
  try {
    if (!fs.existsSync(imagePath)) {
      console.warn(`Image not found: ${imagePath}`);
      return null;
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const result = await uploadFile(imageBuffer, {
      folder,
      public_id: path.basename(imagePath, path.extname(imagePath))
    });
    console.log(`Uploaded ${path.basename(imagePath)}: ${result.url}`);
    return result.url;
  } catch (error) {
    console.error(`Failed to upload ${imagePath}:`, error.message);
    return null;
  }
};

const seedElectricianService = async () => {
  try {
    console.log('Starting electrician service seeding...');

    // 1. Find or create Electricity category
    console.log('Checking for Electricity category...');
    let electricityCategory = await Category.findOne({ slug: 'electricity' });

    if (!electricityCategory) {
      console.log('Creating Electricity category...');
      electricityCategory = new Category({
        title: 'Electricity',
        slug: 'electricity',
        description: 'Professional electrical services including repairs, installations, and maintenance',
        iconUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/icons/services/electrician.png',
        imageUrl: null,
        isActive: true,
        showOnHome: true,
        homeOrder: 0
      });
      await electricityCategory.save();
      console.log('Electricity category created:', electricityCategory._id);
    } else {
      console.log('Electricity category already exists:', electricityCategory._id);
    }

    // 2. Upload images to cloudinary
    console.log('Uploading images to cloudinary...');
    const imageUploads = {};

    // Banner images
    const bannerImages = [
      { key: 'homeWiring', path: '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/home-wiring.jpg' },
      { key: 'electricalPanel', path: '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/electrical-panel-upgrade.jpg' },
      { key: 'smartHomeSetup', path: '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/smart home setup.jpg' }
    ];

    for (const banner of bannerImages) {
      imageUploads[banner.key] = await uploadImageToCloudinary(banner.path, 'electrician/banners');
    }

    // Use Homster Cloudinary URLs
    const organizedImageUrls = {
      homeWiring: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135138/Homster/electricity/service/home-wiring.jpg',
      electricalPanel: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135139/Homster/electricity/service/electrical-panel-upgrade.jpg',
      smartHomeSetup: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135140/Homster/electricity/service/smart-home-setup.jpg',
      switchSocket: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135141/Homster/electricity/service/switch-socket.jpg',
      fan: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135144/Homster/electricity/service/fan.png',
      light: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135146/Homster/electricity/service/light.jpg',
      wiring: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135147/Homster/electricity/service/wiring.jpg',
      mcb: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135149/Homster/electricity/service/mcb.jpg',
      inverter: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766135150/Homster/electricity/service/invertor.jpg'
    };

    Object.assign(imageUploads, organizedImageUrls);

    // 3. Create or update the service
    console.log('Creating/updating electrician service...');
    const serviceData = {
      title: 'Electrician Services',
      slug: 'electrician-services',
      categoryId: electricityCategory._id,
      categoryIds: [electricityCategory._id],
      iconUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/icons/services/electrician.png',
      routePath: '/user/electrician',
      page: {
        banners: [
          {
            imageUrl: imageUploads.homeWiring || 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/electrician/banners/home-wiring.jpg',
            text: 'Professional electrical services'
          },
          {
            imageUrl: imageUploads.electricalPanel || 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/electrician/banners/electrical-panel-upgrade.jpg',
            text: 'Expert electricians at your service'
          },
          {
            imageUrl: imageUploads.smartHomeSetup || 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766039523/electrician/banners/smart-home-setup.jpg',
            text: 'Safe and reliable solutions'
          }
        ],
        ratingTitle: 'Electrician Services',
        ratingValue: '4.82',
        bookingsText: '1.2 M bookings',
        paymentOffersEnabled: true,
        paymentOffers: [],
        serviceCategoriesGrid: [
          { title: 'Switch & socket', imageUrl: imageUploads.switchSocket || '' },
          { title: 'Fan', imageUrl: imageUploads.fan || '' },
          { title: 'Wall/ceiling light', imageUrl: imageUploads.light || '' },
          { title: 'Wiring', imageUrl: imageUploads.wiring || '' },
          { title: 'Doorbell', imageUrl: imageUploads.doorbell || '' },
          { title: 'MCB & submeter', imageUrl: imageUploads.mcb || '' },
          { title: 'Inverter & stabiliser', imageUrl: imageUploads.inverter || '' },
          { title: 'Appliance', imageUrl: imageUploads.appliance || '' },
          { title: 'Book a consultation', imageUrl: imageUploads.bookConsultation || '' }
        ]
      },
      sections: [
        {
          title: 'Electrical Repair',
          anchorId: 'electrical-repair',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: [
            {
              title: 'Fan Repair',
              subtitle: 'Ceiling/wall fan repair and maintenance',
              rating: '4.8',
              reviews: '2.1K',
              price: '199',
              originalPrice: '299',
              duration: '45 mins',
              options: '2 options',
              badge: 'POPULAR',
              description: 'Professional fan repair service including motor replacement, regulator fixing, and blade balancing',
              features: ['Motor repair/replacement', 'Regulator fixing', 'Blade balancing', 'Safety check']
            },
            {
              title: 'Switch & Socket Repair',
              subtitle: 'Electrical switch and socket repair',
              rating: '4.7',
              reviews: '1.8K',
              price: '149',
              originalPrice: '249',
              duration: '30 mins',
              options: '3 options',
              badge: 'QUICK',
              description: 'Complete switch and socket repair including faulty wiring, loose connections, and replacements',
              features: ['Switch repair', 'Socket repair', 'Wiring check', 'Safety testing']
            }
          ]
        },
        {
          title: 'Installation',
          anchorId: 'installation',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Smart Home',
          anchorId: 'smart-home',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Switch & Socket',
          anchorId: 'switch-socket',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: [
            {
              title: 'Switch Installation',
              subtitle: 'New switch installation and setup',
              rating: '4.9',
              reviews: '3.2K',
              price: '299',
              originalPrice: '399',
              duration: '60 mins',
              options: '4 options',
              badge: 'INSTALLATION',
              description: 'Professional switch installation with proper wiring and safety testing',
              features: ['Switch installation', 'Proper wiring', 'Safety testing', 'Quality assurance']
            },
            {
              title: 'Socket Installation',
              subtitle: 'New electrical socket installation',
              rating: '4.8',
              reviews: '2.7K',
              price: '349',
              originalPrice: '449',
              duration: '75 mins',
              options: '3 options',
              badge: 'INSTALLATION',
              description: 'Complete socket installation service with earthing and safety compliance',
              features: ['Socket installation', 'Earthing', 'Safety compliance', 'Load testing']
            }
          ]
        },
        {
          title: 'Fan',
          anchorId: 'fan',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: [
            {
              title: 'Ceiling Fan Installation',
              subtitle: 'New ceiling fan installation',
              rating: '4.8',
              reviews: '4.1K',
              price: '599',
              originalPrice: '799',
              duration: '90 mins',
              options: '5 options',
              badge: 'INSTALLATION',
              description: 'Complete ceiling fan installation with proper mounting and electrical connection',
              features: ['Fan installation', 'Mounting bracket', 'Electrical connection', 'Testing & balancing']
            },
            {
              title: 'Exhaust Fan Repair',
              subtitle: 'Bathroom/kitchen exhaust fan repair',
              rating: '4.7',
              reviews: '1.9K',
              price: '249',
              originalPrice: '349',
              duration: '45 mins',
              options: '2 options',
              badge: 'REPAIR',
              description: 'Exhaust fan repair including motor replacement and duct cleaning',
              features: ['Motor repair', 'Blade replacement', 'Duct cleaning', 'Noise reduction']
            }
          ]
        },
        {
          title: 'Wall/Ceiling Light',
          anchorId: 'wall-ceiling-light',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Wiring',
          anchorId: 'wiring',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Doorbell',
          anchorId: 'doorbell',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'MCB & Submeter',
          anchorId: 'mcb-submeter',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Inverter & Stabiliser',
          anchorId: 'inverter-stabiliser',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Appliance',
          anchorId: 'appliance',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        },
        {
          title: 'Book a Consultation',
          anchorId: 'consultation',
          navImageUrl: '',
          navBadge: '',
          type: 'standard',
          cards: []
        }
      ],
      basePrice: 0,
      duration: 60,
      unit: 'per service',
      status: 'active',
      isPopular: true,
      isFeatured: true,
      rating: 4.82,
      totalBookings: 1200000
    };

    // Check if service already exists
    let service = await Service.findOne({ slug: 'electrician-services' });

    if (service) {
      console.log('Updating existing electrician service...');
      Object.assign(service, serviceData);
      await service.save();
      console.log('Electrician service updated:', service._id);
    } else {
      console.log('Creating new electrician service...');
      service = new Service(serviceData);
      await service.save();
      console.log('Electrician service created:', service._id);
    }

    console.log('Electrician service seeding completed successfully!');

  } catch (error) {
    console.error('Error seeding electrician service:', error);
    throw error;
  }
};

// Run the seeding
const runSeeding = async () => {
  try {
    await connectDB();
    await seedElectricianService();
    console.log('Seeding completed successfully!');
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

module.exports = { seedElectricianService };
