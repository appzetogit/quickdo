const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Category = require('../models/Category');
const Service = require('../models/Service');
const { SERVICE_STATUS } = require('../utils/constants');

dotenv.config();
const connectDB = require('../config/db');

const seedAC = async () => {
  try {
    await connectDB();
    console.log('Connected to DB...');

    // 1. Find the AC Category
    // We look for 'AC', 'Air Conditioner', or slug 'ac'
    const category = await Category.findOne({
      $or: [
        { title: 'AC' },
        { slug: 'ac' },
        { title: /Air\s?Conditioner/i }
      ]
    });

    if (!category) {
      console.error('AC Category not found! Please create it first.');
      process.exit(1);
    }
    console.log(`Found Category: ${category.title} (${category._id})`);

    // 2. Define the "Master" AC Service Data
    // This matches user requirement: "inside page there is banners, promo cards, category grid"
    // And matches code: Grid clicks scroll to Sections.

    const acServiceData = {
      title: 'AC Services', // Generic title covering all
      slug: 'ac-services',  // Unique slug for this master page
      categoryId: category._id,
      categoryIds: [category._id],
      status: SERVICE_STATUS.ACTIVE,
      isPopular: true,
      rating: 4.84,
      totalBookings: 15400,
      iconUrl: '', // Host to provide or use default

      // PAGE LEVEL CONFIG
      page: {
        ratingTitle: 'AC Services',
        ratingValue: '4.84',
        bookingsText: '1.5M+ Bookings',
        paymentOffersEnabled: true,
        paymentOffers: [
          { code: 'ACNEW', title: '15% off on first booking', description: 'Use code ACNEW' }
        ],

        // Banners
        banners: [
          { imageUrl: '/assets/banners/ac-repair-banner.jpg', text: 'Summer Ready AC?' },
          { imageUrl: '/assets/banners/ac-install.jpg', text: 'Expert Installation' }
        ],

        // The Grid - Clicking these scrolls to the Section with matching Title
        serviceCategoriesGrid: [
          { title: 'Installation', imageUrl: '' },
          { title: 'Repair', imageUrl: '' },
          { title: 'Service', imageUrl: '' },
          { title: 'Gas Refill', imageUrl: '' } // Extra specific one
        ]
      },

      // SECTIONS containing CARDS
      sections: [
        // 1. INSTALLATION SECTION
        {
          title: 'Installation',
          subtitle: 'Professional installation with warranty', // Shows under title
          type: 'standard',
          cards: [
            {
              title: 'Split AC Installation',
              price: 1499,
              originalPrice: 1699,
              discount: '12% OFF',
              rating: '4.8',
              reviews: '12K',
              duration: '60 mins',
              description: 'Installation of indoor & outdoor units with standard pipe kit.',
              features: ['Indoor unit mounting', 'Outdoor unit mounting', 'Drilling & Wiring', 'Gas check'],
              imageUrl: '', // Asset URL
              badge: 'Bestseller'
            },
            {
              title: 'Window AC Installation',
              price: 699,
              originalPrice: 899,
              rating: '4.7',
              reviews: '5K',
              duration: '45 mins',
              description: 'Standard installation into existing window cavity.',
              features: ['Secure mounting', 'Gap filling', 'Power check'],
              imageUrl: ''
            },
            {
              title: 'AC Uninstallation',
              price: 499,
              duration: '30 mins',
              features: ['Gas lock', 'Safe removal'],
              imageUrl: ''
            }
          ]
        },

        // 2. REPAIR SECTION
        {
          title: 'Repair',
          subtitle: 'Expert diagnosis and quick fix',
          type: 'standard',
          cards: [
            {
              title: 'AC Not Cooling',
              price: 299,
              duration: '30 mins',
              description: 'Detailed diagnosis of cooling systems.',
              features: ['Gas leakage check', 'Compressor check', 'Visit charges only'],
              imageUrl: '',
              badge: 'High Demand'
            },
            {
              title: 'Water Leakage Repair',
              price: 399,
              duration: '45 mins',
              description: 'Fixing indoor unit water dripping.',
              features: ['Drain pipe cleaning', 'Level check', 'Leak fix'],
              imageUrl: ''
            },
            {
              title: 'Noise Issue',
              price: 299,
              features: ['Vibration check', 'Fan motor check'],
              imageUrl: ''
            }
          ]
        },

        // 3. SERVICE SECTION
        {
          title: 'Service',
          subtitle: 'Deep cleaning for fresh air',
          type: 'standard',
          cards: [
            {
              title: 'Split AC Power Jet Service',
              price: 599,
              originalPrice: 799,
              rating: '4.9',
              reviews: '25K',
              duration: '45 mins',
              description: 'High pressure cleaning of indoor and outdoor units.',
              features: ['Filter cleaning', 'Coil cleaning', 'Pressure wash'],
              imageUrl: '',
              badge: 'Recommended'
            },
            {
              title: 'Window AC Service',
              price: 499,
              duration: '45 mins',
              features: ['Pressure wash', 'Filter cleaning'],
              imageUrl: ''
            },
            {
              title: 'Anti-Rust Coating',
              price: 399,
              description: 'Protective coating for outdoor unit coils.',
              features: ['Prevents corrosion', 'Increases life'],
              imageUrl: ''
            }
          ]
        },

        // 4. GAS REFILL SECTION
        {
          title: 'Gas Refill',
          type: 'standard',
          cards: [
            {
              title: 'Complete Gas Refill',
              price: 2499,
              duration: '60 mins',
              features: ['Leakage fix included', 'Vacuuming', 'Gas charging'],
              imageUrl: ''
            },
            {
              title: 'Top-up Gas',
              price: 999,
              features: ['If pressure is low', 'Performance boost'],
              imageUrl: ''
            }
          ]
        }
      ]
    };

    // 3. Upsert into DB
    const existing = await Service.findOne({ slug: acServiceData.slug });
    if (existing) {
      console.log('Updating existing AC Services...');
      // Merge properties
      Object.assign(existing, acServiceData);
      await existing.save();
    } else {
      console.log('Creating NEW AC Services...');
      const newService = new Service(acServiceData);
      await newService.save();
    }

    console.log('SUCCESS: AC Services seeded!');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding AC:', error);
    process.exit(1);
  }
};

seedAC();
