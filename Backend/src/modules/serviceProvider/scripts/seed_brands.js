const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Service = require('../models/Service');
const Category = require('../models/Category');
const { SERVICE_STATUS } = require('../utils/constants');

dotenv.config();
const connectDB = require('../config/db');

// --- BRAND DATA ---
// --- BRAND DATA ---
const BRAND_LOGOS = {
  Samsung: 'https://cdn-icons-png.flaticon.com/512/5969/5969238.png',
  LG: 'https://cdn-icons-png.flaticon.com/512/882/882747.png',
  Sony: 'https://cdn.iconscout.com/icon/free/png-256/free-sony-logo-icon-download-in-svg-png-gif-file-formats--technology-social-media-company-brand-vol-6-pack-logos-icons-2945147.png',
  Whirlpool: 'https://laundry.co.ke/wp-content/uploads/2016/09/whirlpool-logo.jpg',
  Godrej: 'https://seeklogo.com/images/G/godrej-logo-C2DD51D569-seeklogo.com.png',
  Voltas: 'https://seeklogo.com/images/V/voltas-logo-BF3457D93D-seeklogo.com.png',
  Daikin: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Daikin_logo.svg/2560px-Daikin_logo.svg.png',
  Hitachi: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Hitachi_Logo.svg/1200px-Hitachi_Logo.svg.png',
  IFB: 'https://seeklogo.com/images/I/ifb-logo-0D29E161DF-seeklogo.com.png',
  Kent: 'https://www.kent.co.in/images/logo.png',
  Aquaguard: 'https://seeklogo.com/images/A/aquaguard-logo-5D12C288E3-seeklogo.com.png',
  BlueStar: 'https://seeklogo.com/images/B/blue-star-logo-E927BB604F-seeklogo.com.png',
  Haier: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Haier_logo_20130619.svg/2560px-Haier_logo_20130619.svg.png',
  Bosch: 'https://1000logos.net/wp-content/uploads/2017/01/Bosch-Logo.png',
  Symphony: 'https://seeklogo.com/images/S/symphony-logo-5E0E463283-seeklogo.com.png',
  AOSmith: 'https://logos-world.net/wp-content/uploads/2022/11/A.O.-Smith-Logo.png',
  Generic: 'https://cdn-icons-png.flaticon.com/512/771/771234.png'
};

const SERVICE_IMAGES = {
  ac_split: 'https://media.istockphoto.com/id/1190440285/photo/technician-repairing-air-conditioner-on-the-wall.jpg?s=612x612&w=0&k=20&c=LrwgD249i-iXyK253Y5gqGgYdO8aN9jK6XF2X5yZ5Gg=',
  ac_window: 'https://thumbs.dreamstime.com/b/technician-repairing-window-air-conditioner-technician-repairing-window-air-conditioner-screwdriver-169424683.jpg',
  ac_jet: 'https://content.jdmagicbox.com/comp/defaul/default-air-conditioner-repair-and-service-3.jpg',
  wm_repair: 'https://media.istockphoto.com/id/1152285496/photo/plumber-repairing-washing-machine.jpg?s=612x612&w=0&k=20&c=7d3O3qgX7gX0yZ7gW8Z9X6X8X9X0yZ7gW8Z9X6X8X9=',
  wm_install: 'https://m.media-amazon.com/images/I/61k1+g1GgWL._AC_UF1000,1000_QL80_.jpg',
  fridge_repair: 'https://media.istockphoto.com/id/1094052358/photo/male-technician-repairing-refrigerator.jpg?s=612x612&w=0&k=20&c=6X2yZ5GgYdO8aN9jK6XF2X5yZ5GgYdO8aN9jK6XF2X5=',
  microwave: 'https://media.istockphoto.com/id/1165691062/photo/serviceman-repairing-microwave-oven-in-kitchen.jpg?s=612x612&w=0&k=20&c=6X2yZ5GgYdO8aN9jK6XF2X5yZ5GgYdO8aN9jK6XF2X5=',
  ro: 'https://5.imimg.com/data5/SELLER/Default/2022/11/QO/QO/QO/12345678/ro-repair-service-500x500.jpg',
  geyser: 'https://content.jdmagicbox.com/comp/service_catalogue/geyser-repair-service-100223.jpg',
  cooler: 'https://5.imimg.com/data5/ANDROID/Default/2021/4/QK/QK/QK/12345678/air-cooler-repairing-service-500x500.jpg'
};

const appliancesData = {
  'AC': {
    slugMatchers: ['ac', 'air-conditioner'],
    services: [
      {
        title: 'AC Repair',
        slug: 'ac-repair-service',
        // Brands as SubCategories
        brands: ['Voltas', 'LG', 'Daikin', 'Hitachi', 'Samsung', 'Godrej'],
        cardsTemplate: (brand) => [
          { title: `${brand} AC Not Cooling`, price: 349, description: `Expert diagnosis for ${brand} AC not cooling.` },
          { title: `${brand} AC Leakage Repair`, price: 449, description: 'Fixing water leakage issues.' },
          { title: `${brand} AC Noise Repair`, price: 299, description: 'Fixing vibration and noise.' }
        ]
      },
      {
        title: 'AC Service',
        slug: 'ac-cleaning-service',
        brands: ['Voltas', 'LG', 'Daikin', 'Hitachi', 'Samsung', 'Blue Star'],
        cardsTemplate: (brand) => [
          { title: `${brand} Power Jet Service`, price: 599, originalPrice: 999, description: `Deep cleaning for ${brand} Split AC.` },
          { title: `${brand} Foam Jet Service`, price: 799, originalPrice: 1299, description: '2X deeper cleaning with foam technology.' },
          { title: `${brand} Anti-Rust Coating`, price: 399, description: 'Protect outdoor unit from rust.' }
        ]
      },
      {
        title: 'AC Installation',
        slug: 'ac-installation-service',
        brands: ['Voltas', 'LG', 'Daikin', 'Hitachi', 'Samsung'],
        cardsTemplate: (brand) => [
          { title: `${brand} Split AC Installation`, price: 1499, description: `Standard installation for ${brand} Split AC.` },
          { title: `${brand} Window AC Installation`, price: 699, description: `Standard installation for ${brand} Window AC.` },
          { title: `${brand} AC Uninstallation`, price: 499, description: 'Safe removal of both units.' }
        ]
      }
    ]
  },
  'Washing machine': {
    slugMatchers: ['washing-machine'],
    services: [
      {
        title: 'Washing Machine Repair',
        slug: 'wm-repair',
        brands: ['LG', 'Samsung', 'Whirlpool', 'IFB', 'Godrej', 'Bosch'],
        cardsTemplate: (brand) => [
          { title: `${brand} Motor Repair`, price: 499, description: 'Diagnosis and repair of motor issues.' },
          { title: `${brand} Drum Issue`, price: 399, description: 'Fixing noise or stuck drum.' },
          { title: `${brand} PCB Repair`, price: 899, description: 'Circuit board repair/replacement.' }
        ]
      },
      {
        title: 'Washing Machine Installation',
        slug: 'wm-installation',
        brands: ['LG', 'Samsung', 'Whirlpool', 'IFB'],
        cardsTemplate: (brand) => [
          { title: `${brand} Installation`, price: 349, description: 'Inlet/Outlet connection and demo.' },
          { title: `${brand} Uninstallation`, price: 249 }
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
        brands: ['LG', 'Samsung', 'Whirlpool', 'Godrej', 'Haier'],
        cardsTemplate: (brand) => [
          { title: `${brand} Cooling Issue`, price: 349, description: `Gas check and compressor diagnostics for ${brand}.` },
          { title: `${brand} Water Leakage`, price: 299, description: 'Fixing drain blockage and leakage.' },
          { title: `${brand} Door Gasket Change`, price: 399, description: 'Replacement of door seal.' }
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
        brands: ['LG', 'Samsung', 'IFB', 'Godrej', 'Morphy Richards'],
        cardsTemplate: (brand) => [
          { title: `${brand} Not Heating`, price: 349, description: 'Magnetron and capacitor check.' },
          { title: `${brand} Touchpad Fault`, price: 299, description: 'Button/Touch panel repair.' }
        ]
      }
    ]
  },
  'R.O. Prufier': {
    slugMatchers: ['ro-prufier', 'water-purifier'],
    services: [
      {
        title: 'RO Service & Repair',
        slug: 'ro-service-full',
        brands: ['Kent', 'Aquaguard', 'Livpure', 'Pureit', 'Blue Star'],
        cardsTemplate: (brand) => [
          { title: `${brand} Filter Change`, price: 499, description: `Sediment/Carbon filter replacement for ${brand}.` },
          { title: `${brand} Membrane Change`, price: 1499, description: 'High quality membrane replacement.' },
          { title: `${brand} General Service`, price: 399, description: 'Complete cleaning and health check.' }
        ]
      }
    ]
  },
  'Geyser': {
    slugMatchers: ['geyser'],
    services: [
      {
        title: 'Geyser Repair & Service',
        slug: 'geyser-repair-service',
        brands: ['AO Smith', 'Racold', 'Crompton', 'Bajaj', 'Havells'],
        cardsTemplate: (brand) => [
          { title: `${brand} Not Heating`, price: 299, description: 'Thermostat and element check.' },
          { title: `${brand} Installation`, price: 399, description: 'Wall mounting and connection.' },
          { title: `${brand} Descaling`, price: 499, description: 'Tank cleaning for better heating.' }
        ]
      }
    ]
  },
  'Cooler': {
    slugMatchers: ['cooler'],
    services: [
      {
        title: 'Cooler Repair & Service',
        slug: 'cooler-repair-service',
        brands: ['Symphony', 'Kenstar', 'Bajaj', 'Crompton', 'Voltas'],
        cardsTemplate: (brand) => [
          { title: `${brand} Motor Repair`, price: 349, description: 'Fan motor repair or replacement.' },
          { title: `${brand} Pump Replacement`, price: 249, description: 'Water pump replacement.' },
          { title: `${brand} Grass/Pad Change`, price: 199, description: 'Cooling pad replacement (labour only).' }
        ]
      }
    ]
  }
};

const seedBrands = async () => {
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

      // Process Each Service
      for (const srvData of data.services) {
        console.log(`  > upserting Service: ${srvData.title}`);

        let service = await Service.findOne({ slug: srvData.slug });
        if (!service) {
          service = new Service({
            title: srvData.title,
            slug: srvData.slug,
            categoryId: category._id,
            categoryIds: [category._id],
            status: SERVICE_STATUS.ACTIVE,
            isPopular: true
          });
        } else {
          if (!service.categoryIds.includes(category._id)) {
            service.categoryIds.push(category._id);
          }
        }

        // Build Page Data & Sections based on BRANDS
        const sections = [];
        const gridItems = [];

        for (const brand of srvData.brands) {
          // Create Grid Item
          gridItems.push({
            title: brand,
            imageUrl: BRAND_LOGOS[brand] || 'https://via.placeholder.com/100?text=' + brand,
            badge: ''
          });

          // Create Section
          sections.push({
            title: brand,
            anchorId: brand.toLowerCase().replace(/\s+/g, '-'), // Anchor ID for scrolling
            type: 'standard',
            cards: srvData.cardsTemplate(brand).map(card => ({
              title: card.title,
              price: card.price,
              originalPrice: card.originalPrice || Math.round(card.price * 1.3),
              rating: '4.8',
              reviews: `${Math.floor(Math.random() * 50) + 1}k+`,
              duration: '45 mins',
              features: [card.description || 'Professional Service', '30 Days Warranty'],
              description: card.description || `Expert ${brand} service by verified professionals.`,
              imageUrl: ''
            }))
          });
        }

        service.page = {
          ratingTitle: srvData.title,
          ratingValue: '4.85',
          bookingsText: '150K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [{ code: 'BRAND10', discount: '10%' }],
          banners: [{ imageUrl: 'https://via.placeholder.com/600x200', text: '' }],

          // GRID IS BRANDS
          serviceCategoriesGrid: gridItems
        };

        service.sections = sections;

        await service.save();
        console.log(`    Saved with ${sections.length} brand sections!`);
      }
    }

    console.log('\nBrand-Based Appliance Seeding Completed.');
    process.exit(0);

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedBrands();
