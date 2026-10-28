const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Category = require('../models/Category');
const Service = require('../models/Service');
const { SERVICE_STATUS } = require('../utils/constants');

dotenv.config();
const connectDB = require('../config/db');

const applianceData = {
  'AC': {
    installation: {
      title: 'AC Installation',
      cards: [
        { title: 'Split AC Installation', price: '1599', duration: '90 mins', description: 'Standard installation including indoor/outdoor unit mounting.' },
        { title: 'Window AC Installation', price: '799', duration: '60 mins', description: 'Woodwork not included.' },
        { title: 'Split AC Uninstallation', price: '699', duration: '45 mins' },
        { title: 'Window AC Uninstallation', price: '499', duration: '30 mins' }
      ]
    },
    repair: {
      title: 'AC Repair',
      cards: [
        { title: 'AC Not Cooling', price: '299', description: 'Diagnosis & Minor repair. Spare parts extra.' },
        { title: 'Water Leakage', price: '399', description: 'Drain pipe cleaning & fixing leakage.' },
        { title: 'Noise Issue', price: '299', description: 'Fixing vibration and noise issues.' }
      ]
    },
    service: {
      title: 'AC Service',
      cards: [
        { title: 'Split AC Power Jet Service', price: '699', description: 'Deep cleaning of indoor & outdoor units.' },
        { title: 'Window AC Service', price: '499', description: 'Deep cleaning with pressure wash.' },
        { title: 'Gas Refill', price: '2499', description: 'Complete gas recharge (R32/R410/R22)' }
      ]
    }
  },
  'Geyser': {
    installation: {
      title: 'Geyser Installation',
      cards: [
        { title: 'Geyser Installation (up to 25L)', price: '399', duration: '45 mins', description: 'Connectivity to existing points.' },
        { title: 'Geyser Uninstallation', price: '199', duration: '30 mins' }
      ]
    },
    repair: {
      title: 'Geyser Repair',
      cards: [
        { title: 'Water Not Heating', price: '249', description: 'Check thermostat and heating element.' },
        { title: 'Water Leakage', price: '249', description: 'Fix tank or pipe leakage.' }
      ]
    },
    service: {
      title: 'Geyser Service',
      cards: [
        { title: 'Geyser General Service', price: '399', description: 'Scaling removal & internal cleaning.' }
      ]
    }
  },
  'Washing machine': {
    installation: {
      title: 'Washing Machine Installation',
      cards: [
        { title: 'Fully Automatic Installation', price: '349', duration: '30 mins', description: 'Inlet/Outlet connection & Demo.' },
        { title: 'Semi Automatic Installation', price: '299', duration: '30 mins' }
      ]
    },
    repair: {
      title: 'Washing Machine Repair',
      cards: [
        { title: 'Motor Issue', price: '399', description: 'Washing/Spinning not working.' },
        { title: 'Drainage Issue', price: '299', description: 'Water not draining completely.' },
        { title: 'Noise/Vibration', price: '299', description: 'Drum balancing and checkup.' }
      ]
    },
    service: {
      title: 'Washing Machine Service',
      cards: [
        { title: 'Deep Cleaning (Top Load)', price: '699', description: 'Drum descaling & filter cleaning.' },
        { title: 'Deep Cleaning (Front Load)', price: '799', description: 'Drum descaling, gasket cleaning.' }
      ]
    }
  },
  'Fridge': {
    installation: {
      title: 'Refrigerator Installation',
      cards: [
        { title: 'Standard Installation', price: '199', duration: '30 mins', description: 'Placement & Demo' }
      ]
    },
    repair: {
      title: 'Refrigerator Repair',
      cards: [
        { title: 'Cooling Issue', price: '349', description: 'Gas check, thermostat check.' },
        { title: 'Water Leakage', price: '299', description: 'Drain tray cleaning & pipe fix.' }
      ]
    },
    service: {
      title: 'Refrigerator Service',
      cards: [
        { title: 'Deep Cleaning', price: '499', description: 'Interior and exterior cleaning.' }
      ]
    }
  },
  'Microwave': {
    installation: {
      title: 'Microwave Installation',
      cards: [
        { title: 'Wall Mount Installation', price: '399', duration: '45 mins', description: 'Wall bracket fixing.' }
      ]
    },
    repair: {
      title: 'Microwave Repair',
      cards: [
        { title: 'Not Heating', price: '349', description: 'Magnetron/Fuse check.' },
        { title: 'Touchpad Issue', price: '299', description: 'Keypad not working check.' }
      ]
    },
    service: {
      title: 'Microwave Service',
      cards: [
        { title: 'Deep Cleaning', price: '399', description: 'Cavity cleaning and odor removal.' }
      ]
    }
  },
  'R.O. Prufier': {
    installation: {
      title: 'RO Installation',
      cards: [
        { title: 'RO Installation', price: '499', duration: '60 mins', description: 'Wall mounting & connection.' },
        { title: 'RO Uninstallation', price: '299', duration: '30 mins' }
      ]
    },
    repair: {
      title: 'RO Repair',
      cards: [
        { title: 'Water Leakage', price: '299', description: 'Pipe/Filter housing check.' },
        { title: 'Motor Issue', price: '349', description: 'Booster pump check.' }
      ]
    },
    service: {
      title: 'RO Service',
      cards: [
        { title: 'Cartridge Replacement', price: '299', description: 'Spares cost extra.' },
        { title: 'Full Service', price: '499', description: 'Filter connection check & cleaning.' }
      ]
    }
  },
  'LCD': {
    installation: {
      title: 'TV Installation',
      cards: [
        { title: 'Wall Mount Installation (up to 43")', price: '399', duration: '45 mins' },
        { title: 'Wall Mount Installation (44"-55")', price: '599', duration: '60 mins' },
        { title: 'Table Top Installation', price: '249', duration: '30 mins' }
      ]
    },
    repair: {
      title: 'TV Repair',
      cards: [
        { title: 'Display Issue', price: '399', description: 'No picture/Lines on screen.' },
        { title: 'Sound Issue', price: '349', description: 'No sound/Distorted sound.' }
      ]
    },
    service: {
      title: 'TV Service',
      cards: [
        { title: 'General Checkup', price: '299', description: 'System diagnostics.' }
      ]
    }
  },
  'Cooler': {
    installation: {
      title: 'Cooler Installation',
      cards: [
        { title: 'Window Cooler Setup', price: '299', duration: '30 mins' }
      ]
    },
    repair: {
      title: 'Cooler Repair',
      cards: [
        { title: 'Motor Repair', price: '299', description: 'Fan motor check.' },
        { title: 'Pump Repair', price: '199', description: 'Water pump check.' }
      ]
    },
    service: {
      title: 'Cooler Service',
      cards: [
        { title: 'Pad Replacement', price: '199', description: 'Changing grass/honeycomb pads. (Pads extra)' },
        { title: 'Deep Cleaning', price: '399', description: 'Tank cleaning & paint.' }
      ]
    }

  }
};

const seed = async () => {
  try {
    await connectDB();
    console.log('Connected to DB...');

    // Get all categories from DB
    const categories = await Category.find({});

    for (const catName of Object.keys(applianceData)) {
      const category = categories.find(c => c.title.toLowerCase() === catName.toLowerCase() || c.slug === catName.toLowerCase().replace(/\s+/g, '-'));

      if (!category) {
        console.log(`Skipping ${catName} - Category not found in DB`);
        continue;
      }
      console.log(`Processing Category: ${category.title}...`);

      const servicesConfig = applianceData[catName];

      // Process Installation, Repair, Service
      const types = ['installation', 'repair', 'service'];

      for (const type of types) {
        const config = servicesConfig[type];
        if (!config) continue;

        const serviceTitle = config.title; // e.g., "AC Installation"
        // Generate a simplified slug to match what user likely expects or ensure uniqueness
        let serviceSlug = serviceTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

        // Check availability
        let service = await Service.findOne({ slug: serviceSlug });
        if (!service) {
          // Create new
          service = new Service({
            title: serviceTitle,
            slug: serviceSlug,
            categoryId: category._id,
            categoryIds: [category._id],
            status: SERVICE_STATUS.ACTIVE,
            isPopular: true,
            page: {
              banners: [],
              serviceCategoriesGrid: []
            }
          });
          console.log(`  Creating new service: ${serviceTitle}`);
        } else {
          console.log(`  Updating existing service: ${serviceTitle}`);
          // Update category link just in case
          if (!service.categoryIds.includes(category._id)) {
            service.categoryIds.push(category._id);
          }
        }

        // Populate Sections
        // We will create ONE main section with the relevant cards
        service.sections = [
          {
            title: config.title, // "AC Installation"
            type: 'standard',
            cards: config.cards.map(c => ({
              title: c.title,
              price: c.price,
              duration: c.duration,
              description: c.description || '',
              features: [c.description || 'Professional service', '30 days warranty'],
              rating: '4.8',
              reviews: '1k+'
            }))
          }
        ];

        // Also populate serviceCategoriesGrid (maybe to link back to siblings?)
        // User said "inside page ... category grid". Maybe related services?
        // Let's add the OTHER 2 types as grid items
        const related = types.filter(t => t !== type).map(t => ({
          title: servicesConfig[t].title,
          imageUrl: '', // placeholder
          badge: ''
        }));

        service.page.serviceCategoriesGrid = related;

        await service.save();
      }
    }

    console.log('Seeding completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

seed();
