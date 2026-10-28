const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Service = require('../models/Service');
const Category = require('../models/Category');
const { SERVICE_STATUS } = require('../utils/constants');

dotenv.config();
const connectDB = require('../config/db');

// --- REAL BRAND LOGOS ---
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
  MorphyRichards: 'https://www.morphyrichards.co.uk/images/logo.png',
  Kenstar: 'https://seeklogo.com/images/K/kenstar-logo-077755DA26-seeklogo.com.png',
  Crompton: 'https://seeklogo.com/images/C/crompton-greaves-logo-4A44B5061B-seeklogo.com.png',
  Bajaj: 'https://seeklogo.com/images/B/bajaj-logo-8A19616D8A-seeklogo.com.png',
  Havells: 'https://seeklogo.com/images/H/havells-logo-99F5327C21-seeklogo.com.png',
  Racold: 'https://seeklogo.com/images/R/racold-logo-0F29367175-seeklogo.com.png',
  Pureit: 'https://seeklogo.com/images/P/pureit-logo-7E6E206303-seeklogo.com.png',
  Livpure: 'https://seeklogo.com/images/L/livpure-logo-22C42584C3-seeklogo.com.png',
  Generic: 'https://cdn-icons-png.flaticon.com/512/771/771234.png'
};

// --- REAL SERVICE IMAGES ---
const SERVICE_IMAGES = {
  // AC SPECIFIC IMAGES
  ac_split_install: 'https://media.istockphoto.com/id/1321743603/photo/technician-installing-air-conditioning-system.jpg?s=612x612&w=0&k=20&c=q_s_gQ-q_s_gQ-q_s_gQ=',
  ac_window_install: 'https://cdn.zeebiz.com/sites/default/files/styles/zeebiz_850x478/public/2023/04/17/237255-ac-repair.jpg',
  ac_uninstall: 'https://content.jdmagicbox.com/comp/service_catalogue/ac-uninstallation-services-100412.jpg',
  ac_not_cooling: 'https://www.urbancompany.com/blog/wp-content/uploads/2019/07/Checking-gas-pressure.jpg',
  ac_leakage: 'https://c8.alamy.com/comp/D8X7R9/air-conditioner-leaking-water-D8X7R9.jpg',
  ac_noise: 'https://thumbs.dreamstime.com/b/air-conditioner-repair-maintenance-technician-checking-air-conditioner-noise-air-conditioner-repair-maintenance-123.jpg',
  ac_jet_service: 'https://5.imimg.com/data5/SELLER/Default/2023/3/295328224/KW/OA/SR/3416172/ac-jet-cleaning-service-500x500.jpg',
  ac_foam_service: 'https://content3.jdmagicbox.com/comp/defaul/default-ac-foam-jet-service-7.jpg',
  ac_anti_rust: 'https://5.imimg.com/data5/SELLER/Default/2022/9/VK/VK/VK/52252528/ac-anti-rust-coating-service-500x500.jpg',

  // OTHER APPLIANCES (Kept generic for now as per request focus on AC)
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
        brands: ['Voltas', 'LG', 'Daikin', 'Hitachi', 'Samsung', 'BlueStar'],
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
        brands: ['LG', 'Samsung', 'IFB', 'Godrej', 'MorphyRichards'],
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
        brands: ['Kent', 'Aquaguard', 'Livpure', 'Pureit', 'BlueStar'],
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
        brands: ['AOSmith', 'Racold', 'Crompton', 'Bajaj', 'Havells'],
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

const seedBrandsWithImages = async () => {
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
          // Resolve Brand Logo
          // Use "Generic" if not found in map
          const logoUrl = BRAND_LOGOS[brand] || BRAND_LOGOS['Generic'];

          // Create Grid Item
          gridItems.push({
            title: brand,
            imageUrl: logoUrl,
            badge: ''
          });

          // Create Section
          sections.push({
            title: brand,
            anchorId: brand.toLowerCase().replace(/\s+/g, '-'),
            type: 'standard',
            cards: srvData.cardsTemplate(brand).map(card => {
              // Resolve Service Image
              let img = 'https://via.placeholder.com/150'; // Fallback

              // AC LOGIC - Specific Matches
              if (srvData.slug.includes('ac-repair')) {
                if (card.title.includes('Not Cooling')) img = SERVICE_IMAGES.ac_not_cooling;
                else if (card.title.includes('Leakage')) img = SERVICE_IMAGES.ac_leakage;
                else if (card.title.includes('Noise')) img = SERVICE_IMAGES.ac_noise;
                else img = SERVICE_IMAGES.ac_not_cooling; // default repair
              }
              else if (srvData.slug.includes('ac-cleaning')) {
                if (card.title.includes('Foam')) img = SERVICE_IMAGES.ac_foam_service;
                else if (card.title.includes('Anti-Rust')) img = SERVICE_IMAGES.ac_anti_rust;
                else img = SERVICE_IMAGES.ac_jet_service;
              }
              else if (srvData.slug.includes('ac-installation')) {
                if (card.title.includes('Window')) img = SERVICE_IMAGES.ac_window_install;
                else if (card.title.includes('Uninstallation')) img = SERVICE_IMAGES.ac_uninstall;
                else img = SERVICE_IMAGES.ac_split_install;
              }
              // OTHER APPLIANCES
              else if (srvData.slug.includes('microwave')) img = SERVICE_IMAGES.microwave;
              else if (srvData.slug.includes('fridge')) img = SERVICE_IMAGES.fridge_repair;
              else if (srvData.slug.includes('wm-')) img = SERVICE_IMAGES.wm_repair;
              else if (srvData.slug.includes('ro-')) img = SERVICE_IMAGES.ro;
              else if (srvData.slug.includes('geyser')) img = SERVICE_IMAGES.geyser;
              else if (srvData.slug.includes('cooler')) img = SERVICE_IMAGES.cooler;

              return {
                title: card.title,
                price: card.price,
                originalPrice: card.originalPrice || Math.round(card.price * 1.3),
                rating: '4.8',
                reviews: `${Math.floor(Math.random() * 50) + 1}k+`,
                duration: '45 mins',
                features: [card.description || 'Professional Service', '30 Days Warranty'],
                description: card.description || `Expert ${brand} service by verified professionals.`,
                imageUrl: img
              };
            })
          });
        }

        service.page = {
          ratingTitle: srvData.title,
          ratingValue: '4.85',
          bookingsText: '150K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [{ code: 'BRAND10', discount: '10%' }],
          banners: [{ imageUrl: 'https://img.freepik.com/free-vector/home-appliance-repair-service-banner_107791-3200.jpg', text: '' }],

          // GRID IS BRANDS
          serviceCategoriesGrid: gridItems
        };

        service.sections = sections;

        await service.save();
        console.log(`    Saved with ${sections.length} brand sections!`);
      }
    }

    console.log('\nBrand-Based Appliance Seeding Completed (With Images).');
    process.exit(0);

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedBrandsWithImages();
