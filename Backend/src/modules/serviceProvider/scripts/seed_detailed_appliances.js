const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Category = require('../models/Category');
const Service = require('../models/Service');
const { SERVICE_STATUS } = require('../utils/constants');

dotenv.config();
const connectDB = require('../config/db');

// DATA DEFINITION
// Structure: Category -> [Services]
// Each Service -> [SubCategories (Grid Items + Sections)] -> [Cards]

const appliancesData = {
  'AC': {
    slugMatchers: ['ac', 'air-conditioner'],
    services: [
      {
        title: 'AC Installation',
        slug: 'ac-installation-service', // Distinct slug
        iconUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766482645/appzeto/ac-install-icon.png',
        subCategories: [
          {
            title: 'Split AC',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766482645/appzeto/split-ac.png',
            cards: [
              { title: 'Standard Installation', price: 1499, duration: '60 mins', features: ['Indoor/Outdoor unit mounting', 'Drilling', 'Gas check'], description: 'Professional installation of Split AC.' },
              { title: 'Uninstallation', price: 599, duration: '30 mins', features: ['Gas pump down', 'Safe removal'] }
            ]
          },
          {
            title: 'Window AC',
            imageUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766482645/appzeto/window-ac.png',
            cards: [
              { title: 'Standard Installation', price: 699, duration: '45 mins', features: ['Woodwork excluded', 'Secure mounting'] },
              { title: 'Uninstallation', price: 399, duration: '30 mins' }
            ]
          }
        ]
      },
      {
        title: 'AC Repair',
        slug: 'ac-repair-service',
        iconUrl: 'https://res.cloudinary.com/shubhamcloudinary/image/upload/v1766482645/appzeto/ac-repair-icon.png',
        subCategories: [
          {
            title: 'Split AC',
            imageUrl: '',
            cards: [
              { title: 'AC Not Cooling', price: 299, description: 'Diagnosis of cooling issue.', features: ['Gas check', 'Compressor check'] },
              { title: 'Water Leakage', price: 399, features: ['Drain pipe cleaning', 'Leak fix'] }
            ]
          },
          {
            title: 'Window AC',
            imageUrl: '',
            cards: [
              { title: 'AC Not Cooling', price: 299, features: ['Fan motor check', 'Gas check'] },
              { title: 'Noise Issue', price: 299, features: ['Mounting check', 'Fan blade check'] }
            ]
          }
        ]
      },
      {
        title: 'AC Service',
        slug: 'ac-cleaning-service',
        iconUrl: '',
        subCategories: [
          {
            title: 'Split AC',
            imageUrl: '',
            cards: [
              { title: 'Power Jet Service', price: 599, originalPrice: 999, description: 'Deep cleaning with high pressure.', features: ['Inddor unit cleaning', 'Outdoor unit cleaning'] },
              { title: 'Foam Jet Service', price: 799, features: ['2x deeper cleaning', 'Anti-rust spray'] }
            ]
          },
          {
            title: 'Window AC',
            imageUrl: '',
            cards: [
              { title: 'Power Jet Service', price: 499, originalPrice: 799, features: ['Filter cleaning', 'Coil washing'] }
            ]
          }
        ]
      }
    ]
  },
  'Geyser': {
    slugMatchers: ['geyser'],
    services: [
      {
        title: 'Geyser Installation',
        slug: 'geyser-installation',
        subCategories: [
          { title: 'Standard Geyser', imageUrl: '', cards: [{ title: 'Installation', price: 399, features: ['Connection', 'Mounting'] }, { title: 'Uninstallation', price: 199 }] },
          { title: 'Instant Geyser', imageUrl: '', cards: [{ title: 'Installation', price: 299 }, { title: 'Uninstallation', price: 149 }] }
        ]
      },
      {
        title: 'Geyser Repair',
        slug: 'geyser-repair-service',
        subCategories: [
          { title: 'All Types', imageUrl: '', cards: [{ title: 'Not Heating', price: 249, features: ['Thermostat check', 'Element check'] }, { title: 'Leakage', price: 199 }] }
        ]
      },
      {
        title: 'Geyser Service',
        slug: 'geyser-service',
        subCategories: [
          { title: 'Standard', imageUrl: '', cards: [{ title: 'Descaling', price: 499, description: 'Removal of scaling from tank' }] }
        ]
      }
    ]
  },
  'Washing machine': {
    slugMatchers: ['washing-machine'],
    services: [
      {
        title: 'Washing Machine Installation',
        slug: 'wm-installation',
        subCategories: [
          { title: 'Top Load', imageUrl: '', cards: [{ title: 'Installation', price: 349 }] },
          { title: 'Front Load', imageUrl: '', cards: [{ title: 'Installation', price: 449 }] }
        ]
      },
      {
        title: 'Washing Machine Repair',
        slug: 'wm-repair',
        subCategories: [
          { title: 'Top Load', imageUrl: '', cards: [{ title: 'Motor Issue', price: 399 }, { title: 'Drain Issue', price: 299 }] },
          { title: 'Front Load', imageUrl: '', cards: [{ title: 'Drum Issue', price: 499 }, { title: 'Door Lock Issue', price: 349 }] },
          { title: 'Semi Automatic', imageUrl: '', cards: [{ title: 'Spinner Repair', price: 299 }] }
        ]
      }
    ]
  },
  'Fridge': {
    slugMatchers: ['fridge', 'refrigerator'],
    services: [
      {
        title: 'Refrigerator Repair',
        slug: 'fridge-repair',
        subCategories: [
          { title: 'Single Door', imageUrl: '', cards: [{ title: 'Cooling Issue', price: 349 }, { title: 'Gas Refill', price: 1999 }] },
          { title: 'Double Door', imageUrl: '', cards: [{ title: 'Cooling Issue', price: 449 }, { title: 'Gas Refill', price: 2499 }] }
        ]
      }
    ]
  },
  'Microwave': {
    slugMatchers: ['microwave'],
    services: [
      {
        title: 'Microwave Repair',
        slug: 'microwave-repair-service',
        subCategories: [
          { title: 'Solo/Grill', imageUrl: '', cards: [{ title: 'Not Heating', price: 349 }, { title: 'Button Issue', price: 299 }] },
          { title: 'Convection', imageUrl: '', cards: [{ title: 'Not Heating', price: 449 }, { title: 'PCB Repair', price: 599 }] }
        ]
      }
    ]
  },
  'R.O. Prufier': {
    slugMatchers: ['ro-prufier', 'water-purifier'],
    services: [
      {
        title: 'RO Service',
        slug: 'ro-service-val',
        subCategories: [
          { title: 'All Brands', imageUrl: '', cards: [{ title: 'Filter Change', price: 399 }, { title: 'Membrane Change', price: 1499 }] }
        ]
      },
      {
        title: 'RO Repair',
        slug: 'ro-repair-val',
        subCategories: [
          { title: 'All Brands', imageUrl: '', cards: [{ title: 'Leakage Fix', price: 299 }, { title: 'Motor Repair', price: 499 }] }
        ]
      },
      {
        title: 'RO Installation',
        slug: 'ro-installation',
        subCategories: [
          { title: 'All Brands', imageUrl: '', cards: [{ title: 'Installation', price: 499 }, { title: 'Uninstallation', price: 299 }] }
        ]
      }
    ]
  }
};

const seedDetailed = async () => {
  try {
    await connectDB();
    console.log('Connected to DB...');

    const categories = await Category.find({});

    for (const [key, data] of Object.entries(appliancesData)) {
      // Find Category
      const category = categories.find(c =>
        data.slugMatchers.some(matcher =>
          c.title.toLowerCase().includes(matcher.toLowerCase()) ||
          c.slug.includes(matcher)
        )
      );

      if (!category) {
        console.log(`Skipping ${key} - Category not found`);
        continue;
      }
      console.log(`\nProcessing Category: ${category.title}`);

      // Process Each Service (Installation, Repair, Service)
      for (const srvData of data.services) {
        console.log(`  > upserting Service: ${srvData.title}`);

        let service = await Service.findOne({ slug: srvData.slug });
        if (!service) {
          service = new Service({
            title: srvData.title,
            slug: srvData.slug,
            categoryId: category._id,
            categoryIds: [category._id], // Assuming Array
            status: SERVICE_STATUS.ACTIVE,
            isPopular: true
          });
        } else {
          // Ensure category mapping
          if (!service.categoryIds.includes(category._id)) {
            service.categoryIds.push(category._id);
          }
        }

        // Build Page Data
        service.page = {
          ratingTitle: srvData.title,
          ratingValue: '4.8',
          bookingsText: '50K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [{ code: 'SAVE10', discount: '10%' }],
          banners: [{ imageUrl: 'https://via.placeholder.com/600x200', text: '' }],

          // GRID - Based on SubCategories
          serviceCategoriesGrid: srvData.subCategories.map(sub => ({
            title: sub.title,
            imageUrl: sub.imageUrl || 'https://via.placeholder.com/100',
            badge: ''
          }))
        };

        // Build Sections - Matching Grid
        service.sections = srvData.subCategories.map(sub => ({
          title: sub.title,
          anchorId: sub.title.toLowerCase().replace(/\s+/g, '-'),
          type: 'standard',
          cards: sub.cards.map(card => ({
            title: card.title,
            price: card.price,
            originalPrice: card.originalPrice || Math.round(card.price * 1.2),
            rating: '4.8',
            reviews: '1k+',
            duration: card.duration || '30 mins',
            features: card.features || ['Professional Service'],
            description: card.description || `${card.title} by expert professionals.`,
            imageUrl: ''
          }))
        }));

        await service.save();
        console.log(`    Saved!`);
      }
    }

    console.log('\nDetailed Appliance Seeding Completed.');
    process.exit(0);

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedDetailed();
