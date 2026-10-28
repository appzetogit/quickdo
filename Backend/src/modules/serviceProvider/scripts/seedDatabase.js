const dotenv = require('dotenv');
const connectDB = require('../config/db');
const Category = require('../models/Category');
const Service = require('../models/Service');
const HomeContent = require('../models/HomeContent');
const { SERVICE_STATUS } = require('../utils/constants');

dotenv.config();

/**
 * Seed Database with Initial Data
 * This script populates the database with hardcoded categories and services
 */
const seedDatabase = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Clear existing data (optional - comment out if you want to keep existing data)
    // await Category.deleteMany({});
    // await Service.deleteMany({});
    // console.log('🗑️  Cleared existing data\n');

    // ============================================
    // CATEGORIES
    // ============================================
    console.log('📦 Seeding Categories...');

    const categoriesData = [
      {
        title: 'Electricity',
        slug: 'electricity',
        homeIconUrl: '', // Will be set from frontend assets
        homeBadge: null,
        hasSaleBadge: false,
        showOnHome: true,
        homeOrder: 0,
        description: 'Professional electrical services for your home and office',
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true
      },
      {
        title: "Women's Salon & Spa",
        slug: 'womens-salon-spa',
        homeIconUrl: '',
        homeBadge: 'POPULAR',
        hasSaleBadge: true,
        showOnHome: true,
        homeOrder: 1,
        description: 'Complete salon and spa services for women',
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true
      },
      {
        title: 'Massage for Men',
        slug: 'massage-for-men',
        homeIconUrl: '',
        homeBadge: null,
        hasSaleBadge: false,
        showOnHome: true,
        homeOrder: 2,
        description: 'Professional massage services for men',
        status: SERVICE_STATUS.ACTIVE,
        isPopular: false
      },
      {
        title: 'Cleaning',
        slug: 'cleaning',
        homeIconUrl: '',
        homeBadge: 'NEW',
        hasSaleBadge: false,
        showOnHome: true,
        homeOrder: 3,
        description: 'Professional cleaning services for your home',
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true
      },
      {
        title: 'Electrician, Plumber & Carpenter',
        slug: 'electrician-plumber-carpenter',
        homeIconUrl: '',
        homeBadge: null,
        hasSaleBadge: false,
        showOnHome: true,
        homeOrder: 4,
        description: 'Complete home repair and maintenance services',
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true
      },
      {
        title: 'AC & Appliance Repair',
        slug: 'ac-appliance-repair',
        homeIconUrl: '',
        homeBadge: null,
        hasSaleBadge: false,
        showOnHome: true,
        homeOrder: 5,
        description: 'AC and appliance repair and maintenance services',
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true
      }
    ];

    const createdCategories = [];
    for (const catData of categoriesData) {
      const existing = await Category.findOne({ slug: catData.slug });
      if (existing) {
        console.log(`  ⏭️  Category "${catData.title}" already exists, skipping...`);
        createdCategories.push(existing);
      } else {
        const category = await Category.create(catData);
        console.log(`  ✅ Created category: ${category.title}`);
        createdCategories.push(category);
      }
    }

    console.log(`\n✅ Categories seeded: ${createdCategories.length}\n`);

    // ============================================
    // SERVICES
    // ============================================
    console.log('📦 Seeding Services...');

    // Find category IDs
    const electricityCategory = createdCategories.find(c => c.slug === 'electricity');
    const salonCategory = createdCategories.find(c => c.slug === 'womens-salon-spa');
    const massageCategory = createdCategories.find(c => c.slug === 'massage-for-men');
    const cleaningCategory = createdCategories.find(c => c.slug === 'cleaning');
    const repairCategory = createdCategories.find(c => c.slug === 'electrician-plumber-carpenter');
    const applianceCategory = createdCategories.find(c => c.slug === 'ac-appliance-repair');

    const servicesData = [
      // Electricity - No modal, category itself is the service
      {
        title: 'Electricity',
        slug: 'electricity',
        categoryIds: [electricityCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 200,
        discountPrice: null,
        page: {
          ratingTitle: 'Electricity',
          ratingValue: '4.85',
          bookingsText: '150K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: []
        },
        sections: [],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.85,
        totalBookings: 150000
      },

      // Women's Salon & Spa - Modal sub-services
      {
        title: 'Salon for Women',
        slug: 'salon-for-women',
        categoryIds: [salonCategory._id],
        iconUrl: '',
        badge: 'POPULAR',
        basePrice: 800,
        discountPrice: null,
        page: {
          ratingTitle: 'Salon Prime',
          ratingValue: '4.85',
          bookingsText: '15.9 M bookings',
          paymentOffersEnabled: true,
          paymentOffers: [
            {
              title: 'UPI Offer',
              discount: '10% OFF',
              code: 'UPI10',
              description: 'Get 10% off on UPI payments',
              iconUrl: ''
            },
            {
              title: 'Wallet Offer',
              discount: '5% OFF',
              code: 'WALLET5',
              description: 'Get 5% off on wallet payments',
              iconUrl: ''
            }
          ],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Super saver packages', imageUrl: '', badge: 'Upto 25% OFF' },
            { title: 'Waxing & threading', imageUrl: '', badge: 'Offer' },
            { title: 'Korean facial', imageUrl: '', badge: '' },
            { title: 'Signature facials', imageUrl: '', badge: '' },
            { title: 'Ayurvedic facial', imageUrl: '', badge: '' },
            { title: 'Cleanup', imageUrl: '', badge: '' },
            { title: 'Pedicure & manicure', imageUrl: '', badge: '' },
            { title: 'Hair, bleach & detan', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Super saver packages',
            anchorId: 'super-saver-packages',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Make your own package',
                rating: '4.85',
                reviews: '7.3M',
                price: '2,920',
                originalPrice: '3,894',
                discount: '25%',
                duration: '3 hrs 50 mins',
                features: [
                  'Waxing: Full arms (including underarms) - Chocolate Roll on, Fu...',
                  'Facial & cleanup: Glass skin hydration facial',
                  'Pedicure: Elysian Candle Spa pedicure',
                  'Facial hair removal: Eyebrow, Upper lip - Threading'
                ],
                imageUrl: ''
              },
              {
                title: 'Wax & glow',
                rating: '4.85',
                reviews: '6.1M',
                price: '2,316',
                originalPrice: '2,895',
                discount: '20%',
                duration: '2 hrs 30 mins',
                features: [
                  'Waxing: Full arms (including underarms) - Chocolate Roll on, Fu...',
                  'Facial & cleanup: Glass skin hydration facial',
                  'Facial hair removal: Eyebrow, Upper lip - Threading'
                ],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Waxing & threading',
            anchorId: 'waxing-threading',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Roll-on waxing',
                subtitle: 'Roll-on waxing starting at',
                price: '799',
                originalPrice: '1,098',
                rating: '4.87',
                reviews: '47K',
                description: 'Full arms, legs & underarms',
                features: [
                  'Hygienic & single-use with no risk of burns',
                  'Two wax types for you to pick from: RICA or white chocolate'
                ],
                options: '2 options',
                badge: 'Price Drop',
                imageUrl: ''
              },
              {
                title: 'Spatula waxing',
                subtitle: 'Spatula waxing starting at',
                price: '599',
                originalPrice: '638',
                rating: '4.86',
                reviews: '31K',
                description: 'Full arms, legs & underarms',
                features: [
                  'Traditional method with expert care',
                  'Suitable for all skin types'
                ],
                options: '2 options',
                badge: 'Price Drop',
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Korean facial',
            anchorId: 'korean-facial',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Korean Glass hydration facial',
                rating: '4.84',
                reviews: '32K',
                price: '1,699',
                duration: '1 hr 20 mins',
                badge: 'BESTSELLER',
                features: [
                  'Papaya & red algae boost collagen & deeply hydrate the skin',
                  '25 mins of shoulder, half leg & back massage included'
                ],
                options: '1 option',
                imageUrl: '',
                imageText: {
                  titleLines: ['Boost', "your skin's", 'moisture'],
                  subtitle: 'Papaya Extracts exfoliate & renew skin surface'
                }
              },
              {
                title: 'Korean Radiance facial',
                rating: '4.82',
                reviews: '28K',
                price: '1,499',
                duration: '1 hr 15 mins',
                features: [
                  'Advanced Korean skincare technology',
                  'Deep cleansing and hydration'
                ],
                options: '1 option',
                imageUrl: '',
                imageText: {
                  titleLines: ['Restore', "your skin's", 'luminosity'],
                  subtitle: 'Advanced Korean techniques'
                }
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.85,
        totalBookings: 15900000
      },
      {
        title: 'Spa for Women',
        slug: 'spa-for-women',
        categoryIds: [salonCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 2500,
        discountPrice: null,
        page: {
          ratingTitle: 'Spa for Women',
          ratingValue: '4.92',
          bookingsText: '120K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: []
        },
        sections: [],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.92,
        totalBookings: 120000
      },
      {
        title: 'Hair Studio for Women',
        slug: 'hair-studio-for-women',
        categoryIds: [salonCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 600,
        discountPrice: null,
        page: {
          ratingTitle: 'Hair Studio',
          ratingValue: '4.89',
          bookingsText: '180K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: []
        },
        sections: [],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.89,
        totalBookings: 180000
      },

      // Massage for Men - No modal, category itself is the service
      {
        title: 'Massage for Men',
        slug: 'massage-for-men',
        categoryIds: [massageCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 1500,
        discountPrice: null,
        page: {
          ratingTitle: 'Massage for Men',
          ratingValue: '4.80',
          bookingsText: '120K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: []
        },
        sections: [],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.8,
        totalBookings: 120000
      },

      // Cleaning - Modal sub-services
      {
        title: 'Bathroom & Kitchen Cleaning',
        slug: 'bathroom-kitchen-cleaning',
        categoryIds: [cleaningCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 1200,
        discountPrice: null,
        page: {
          ratingTitle: 'Bathroom & Kitchen Cleaning',
          ratingValue: '4.75',
          bookingsText: '1.2M+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: []
        },
        sections: [],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.75,
        totalBookings: 1200000
      },
      {
        title: 'Sofa & Carpet Cleaning',
        slug: 'sofa-carpet-cleaning',
        categoryIds: [cleaningCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 1500,
        discountPrice: null,
        page: {
          ratingTitle: 'Sofa & Carpet Cleaning',
          ratingValue: '4.73',
          bookingsText: '850K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [
            {
              title: 'UPI Offer',
              discount: '10% OFF',
              code: 'UPI10',
              description: 'Get 10% off on UPI payments',
              iconUrl: ''
            }
          ],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Sofa cleaning', imageUrl: '', badge: '' },
            { title: 'Carpet', imageUrl: '', badge: '' },
            { title: 'Dining table', imageUrl: '', badge: '' },
            { title: 'Mattress', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Sofa cleaning',
            anchorId: 'sofa-cleaning',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Sofa cleaning',
                rating: '4.85',
                reviews: '400K',
                price: '499',
                duration: '40 mins',
                features: [
                  'Dry vacuuming to remove crumbs & dirt particles',
                  'Wet shampooing on fabric sofa to remove stains & spillages'
                ],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Carpet',
            anchorId: 'carpet',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Carpet cleaning',
                rating: '4.80',
                reviews: '109K',
                price: '399',
                options: '5 options',
                features: [
                  'Dry vacuuming to remove crumbs & dirt particles',
                  'Wet shampooing & vacuuming to remove tough stains and spillages'
                ],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.73,
        totalBookings: 850000
      },

      // Electrician, Plumber & Carpenter - Modal sub-services
      {
        title: 'Electrical Repair',
        slug: 'electrical-repair',
        categoryIds: [repairCategory._id],
        iconUrl: '',
        badge: 'bestseller',
        basePrice: 200,
        discountPrice: null,
        page: {
          ratingTitle: 'Electrical Repair',
          ratingValue: '4.82',
          bookingsText: '180K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Installation', imageUrl: '', badge: '' },
            { title: 'Services', imageUrl: '', badge: '' },
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Maintenance', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Installation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Ceiling Fan Installation',
                rating: '4.85',
                reviews: '12K',
                price: '149',
                duration: '30 mins',
                features: ['Standard installation', 'Wiring check included'],
                imageUrl: ''
              },
              {
                title: 'Switchboard Installation',
                rating: '4.80',
                reviews: '8K',
                price: '299',
                duration: '45 mins',
                features: ['Up to 6 modules', 'Safety check'],
                imageUrl: ''
              },
              {
                title: 'Inverter Installation',
                rating: '4.88',
                reviews: '5K',
                price: '599',
                duration: '60 mins',
                features: ['Battery connection', 'Load testing'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Services',
            anchorId: 'services',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Wiring Upgrade',
                rating: '4.85',
                reviews: '2K',
                price: '999',
                duration: '2 hrs',
                features: ['Per room', 'Standard copper wiring'],
                imageUrl: ''
              },
              {
                title: 'Earthing Installation/Check',
                rating: '4.92',
                reviews: '1.5K',
                price: '1499',
                duration: '3 hrs',
                features: ['Deep rod installation', 'Safety check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Fan Repair (Noise/Speed)',
                rating: '4.75',
                reviews: '15K',
                price: '199',
                duration: '45 mins',
                features: ['Capacitor check', 'Bearing check'],
                imageUrl: ''
              },
              {
                title: 'Switch/Socket Repair',
                rating: '4.82',
                reviews: '20K',
                price: '99',
                duration: '20 mins',
                features: ['Per unit', 'Replacement not included'],
                imageUrl: ''
              },
              {
                title: 'Fuse/MCB Repair',
                rating: '4.90',
                reviews: '3K',
                price: '249',
                duration: '30 mins',
                features: ['Circuit check', 'Safety assurance'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Maintenance',
            anchorId: 'maintenance',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Full Home Electrical Audit',
                rating: '4.95',
                reviews: '2K',
                price: '499',
                duration: '60 mins',
                features: ['Wiring health check', 'Appliance load check', 'Safety audit'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.82,
        totalBookings: 180000
      },
      {
        title: 'Plumbing Services',
        slug: 'plumbing-services',
        categoryIds: [repairCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 300,
        discountPrice: null,
        page: {
          ratingTitle: 'Plumbing Services',
          ratingValue: '4.78',
          bookingsText: '250K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Installation', imageUrl: '', badge: '' },
            { title: 'Services', imageUrl: '', badge: '' },
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Maintenance', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Installation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Tap Installation',
                rating: '4.80',
                reviews: '50K',
                price: '149',
                duration: '30 mins',
                features: ['Standard Tap', 'Leak check'],
                imageUrl: ''
              },
              {
                title: 'Wash Basin Installation',
                rating: '4.75',
                reviews: '10K',
                price: '599',
                duration: '60 mins',
                features: ['Secure mounting', 'Pipe connection'],
                imageUrl: ''
              },
              {
                title: 'Western Commode Installation',
                rating: '4.85',
                reviews: '5K',
                price: '899',
                duration: '90 mins',
                features: ['Grouting', 'Level check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Services',
            anchorId: 'services',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Water Tank Cleaning (500L-1000L)',
                rating: '4.88',
                reviews: '5K',
                price: '999',
                duration: '60 mins',
                features: ['Mechanized cleaning', 'Sludge removal', 'Disinfection'],
                imageUrl: ''
              },
              {
                title: 'Drain Cleaning',
                rating: '4.85',
                reviews: '20K',
                price: '349',
                duration: '30 mins',
                features: ['Acid wash', 'High pressure flow'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Tap Repair',
                rating: '4.78',
                reviews: '60K',
                price: '129',
                duration: '30 mins',
                features: ['Washer replacement', 'Leak fix'],
                imageUrl: ''
              },
              {
                title: 'Pipe Leakage Fix',
                rating: '4.82',
                reviews: '25K',
                price: '299',
                duration: '45 mins',
                features: ['Diagnosis', 'Minor patch work'],
                imageUrl: ''
              },
              {
                title: 'Flush Tank Repair',
                rating: '4.76',
                reviews: '12K',
                price: '349',
                duration: '40 mins',
                features: ['Siphon check', 'Valve replacement'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Maintenance',
            anchorId: 'maintenance',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Full Bathroom Plumbing Check',
                rating: '4.90',
                reviews: '3K',
                price: '399',
                duration: '45 mins',
                features: ['Leak detection', 'Pressure check', 'Fixture check'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.78,
        totalBookings: 250000
      },
      {
        title: 'Carpentry Work',
        slug: 'carpentry-work',
        categoryIds: [repairCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 500,
        discountPrice: null,
        page: {
          ratingTitle: 'Carpentry Work',
          ratingValue: '4.76',
          bookingsText: '95K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Installation', imageUrl: '', badge: '' },
            { title: 'Services', imageUrl: '', badge: '' },
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Maintenance', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Installation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Curtain Rod Installation',
                rating: '4.80',
                reviews: '15K',
                price: '199',
                duration: '30 mins',
                features: ['Per rod', 'Drilling included'],
                imageUrl: ''
              },
              {
                title: 'Lock Installation',
                rating: '4.85',
                reviews: '5K',
                price: '349',
                duration: '45 mins',
                features: ['Door handle/lock', 'Secure fitting'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Services',
            anchorId: 'services',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Furniture Polishing',
                rating: '4.85',
                reviews: '2K',
                price: '1499',
                duration: '3 hrs',
                features: ['Dining Table (6 seater)', 'Buffing and Waxing'],
                imageUrl: ''
              },
              {
                title: 'Bed Assembly',
                rating: '4.88',
                reviews: '2K',
                price: '599',
                duration: '90 mins',
                features: ['Queen/King size', 'Hydraulic check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Door Repair/Adjustment',
                rating: '4.75',
                reviews: '10K',
                price: '299',
                duration: '45 mins',
                features: ['Hinge fixing', 'Alignment'],
                imageUrl: ''
              },
              {
                title: 'Drawer Repair',
                rating: '4.70',
                reviews: '8K',
                price: '249',
                duration: '30 mins',
                features: ['Channel replacement', 'Alignment'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Maintenance',
            anchorId: 'maintenance',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Furniture Tightening Service',
                rating: '4.80',
                reviews: '1K',
                price: '399',
                duration: '45 mins',
                features: ['Tightening loose screws', 'Checking hinges', 'General stability'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: false,
        rating: 4.76,
        totalBookings: 95000
      },
      {
        title: 'Installation Services',
        slug: 'installation-services',
        categoryIds: [repairCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 400,
        discountPrice: null,
        page: {
          ratingTitle: 'Installation Services',
          ratingValue: '4.81',
          bookingsText: '110K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: []
        },
        sections: [],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.81,
        totalBookings: 110000
      },

      // AC & Appliance Repair - Modal sub-services (from ACApplianceModal)
      {
        title: 'AC',
        slug: 'ac',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 500,
        discountPrice: null,
        page: {
          ratingTitle: 'AC Service',
          ratingValue: '4.83',
          bookingsText: '280K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [
            {
              title: 'UPI Offer',
              discount: '10% OFF',
              code: 'UPI10',
              description: 'Get 10% off on UPI payments',
              iconUrl: ''
            }
          ],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Super saver packages', imageUrl: '', badge: '' },
            { title: 'Service', imageUrl: '', badge: '' },
            { title: 'Repair & gas refill', imageUrl: '', badge: '' },
            { title: 'Installation/uninstallation', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Super saver packages',
            anchorId: 'super-saver-packages',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Foam-jet service (2 ACs)',
                rating: '4.77',
                reviews: '1.8M reviews',
                price: '1,098',
                originalPrice: '1,298',
                duration: '1 hr 30 mins',
                description: 'Dust-free filters & better airflow',
                features: [
                  'Applicable for both window or split ACs',
                  'Indoor unit deep cleaning with foam & jet spray'
                ]
              },
              {
                title: 'Foam-jet service (3 ACs)',
                rating: '4.77',
                reviews: '1.8M reviews',
                price: '1,647',
                originalPrice: '1,947',
                duration: '2 hrs',
                description: 'Dust-free filters & better airflow',
                features: [
                  'Applicable for both window or split ACs',
                  'Indoor unit deep cleaning with foam & jet spray'
                ]
              },
              {
                title: 'Foam-jet service (5 ACs)',
                rating: '4.77',
                reviews: '1.8M reviews',
                price: '2,745',
                originalPrice: '3,245',
                duration: '3 hrs 45 mins',
                description: 'Dust-free filters & better airflow',
                features: [
                  'Applicable for both window or split ACs',
                  'Indoor unit deep cleaning with foam & jet spray'
                ]
              }
            ]
          },
          {
            title: 'Service',
            anchorId: 'service',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Foam-jet AC service',
                description: 'Dust-free filters & better airflow',
                rating: '4.77',
                reviews: '1.8M reviews',
                price: '649',
                priceText: 'Starts at ₹649',
                offer: 'Add more & save up to 15%',
                options: '6 options',
                features: [
                  'Applicable for both window & split ACs',
                  'Indoor unit deep cleaning with foam & jet spray'
                ],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Repair & gas refill',
            anchorId: 'repair-gas-refill',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'AC less/no cooling repair',
                rating: '4.76',
                reviews: '473K reviews',
                price: '299',
                duration: '2 hrs 30 mins',
                label: 'NO COOLING',
                imageUrl: ''
              },
              {
                title: 'AC power issue repair',
                rating: '4.73',
                reviews: '124K reviews',
                price: '299',
                duration: '60 mins',
                label: 'NO POWER',
                imageUrl: ''
              },
              {
                title: 'AC noise/smell repair',
                rating: '4.77',
                reviews: '36K reviews',
                price: '499',
                duration: '60 mins',
                label: 'NOISE & ODOUR',
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Installation/uninstallation',
            anchorId: 'installation-uninstallation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Split AC installation',
                rating: '4.70',
                reviews: '111K reviews',
                price: '1,699',
                duration: '2 hrs',
                imageUrl: ''
              },
              {
                title: 'Window AC installation',
                rating: '4.79',
                reviews: '13K reviews',
                price: '799',
                duration: '2 hrs',
                imageUrl: ''
              },
              {
                title: 'Split AC uninstallation',
                rating: '4.82',
                reviews: '113K reviews',
                price: '649',
                duration: '60 mins',
                imageUrl: ''
              },
              {
                title: 'Window AC uninstallation',
                rating: '4.85',
                reviews: '10K reviews',
                price: '699',
                duration: '60 mins',
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.83,
        totalBookings: 280000
      },
      {
        title: 'Washing Machine Repair',
        slug: 'washing-machine-repair',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 400,
        discountPrice: null,
        page: {
          ratingTitle: 'Washing Machine Repair',
          ratingValue: '4.79',
          bookingsText: '195K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Installation', imageUrl: '', badge: '' },
            { title: 'Cleaning', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Machine not starting/power issue',
                rating: '4.80',
                reviews: '15K',
                price: '399',
                duration: '45 mins',
                features: ['Circuit check', 'Power cord check'],
                imageUrl: ''
              },
              {
                title: 'Water leakage',
                rating: '4.78',
                reviews: '12K',
                price: '349',
                duration: '40 mins',
                features: ['Pipe check', 'Seal replacement check'],
                imageUrl: ''
              },
              {
                title: 'Noise/Vibration issue',
                rating: '4.75',
                reviews: '10K',
                price: '399',
                duration: '45 mins',
                features: ['Drum balance', 'Suspension check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Installation/Uninstallation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Installation',
                rating: '4.85',
                reviews: '20K',
                price: '449',
                duration: '30 mins',
                features: ['Inlet/Outlet connection', 'Demo', 'Leveling'],
                imageUrl: ''
              },
              {
                title: 'Uninstallation',
                rating: '4.82',
                reviews: '5K',
                price: '299',
                duration: '20 mins',
                features: ['Safe removal', 'Pipe packing'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Maintenance',
            anchorId: 'maintenance',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Deep Drum Cleaning',
                rating: '4.90',
                reviews: '8K',
                price: '699',
                duration: '60 mins',
                features: ['Scale removal', 'Disinfection', 'Smell removal'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.79,
        totalBookings: 195000
      },
      {
        title: 'Geyser Repair',
        slug: 'geyser-repair',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 350,
        discountPrice: null,
        page: {
          ratingTitle: 'Geyser Repair',
          ratingValue: '4.77',
          bookingsText: '125K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Installation', imageUrl: '', badge: '' },
            { title: 'Service', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Water not heating',
                rating: '4.77',
                reviews: '10K',
                price: '349',
                duration: '45 mins',
                features: ['Element check', 'Thermostat check'],
                imageUrl: ''
              },
              {
                title: 'Water leakage',
                rating: '4.75',
                reviews: '8K',
                price: '299',
                duration: '40 mins',
                features: ['Tank check', 'Valve check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Installation/Uninstallation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Geyser Installation',
                rating: '4.82',
                reviews: '15K',
                price: '549',
                duration: '45 mins',
                features: ['Wall mounting', 'Connection'],
                imageUrl: ''
              },
              {
                title: 'Geyser Uninstallation',
                rating: '4.80',
                reviews: '4K',
                price: '299',
                duration: '20 mins',
                features: ['Safe removal'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Service',
            anchorId: 'service',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Geyser Servicing',
                rating: '4.85',
                reviews: '6K',
                price: '499',
                duration: '60 mins',
                features: ['Descaling', 'Tank cleaning', 'Safety valve check'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: false,
        rating: 4.77,
        totalBookings: 125000
      },
      {
        title: 'Water Purifier Repair',
        slug: 'water-purifier-repair',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 300,
        discountPrice: null,
        page: {
          ratingTitle: 'Water Purifier Repair',
          ratingValue: '4.80',
          bookingsText: '90K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Service', imageUrl: '', badge: '' },
            { title: 'Installation', imageUrl: '', badge: '' },
            { title: 'Repairs', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Services',
            anchorId: 'services',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Regular Service',
                rating: '4.85',
                reviews: '12K',
                price: '399',
                duration: '45 mins',
                features: ['Filter cleaning', 'TDS check', 'Exterior cleaning'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Installation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Installation',
                rating: '4.82',
                reviews: '8K',
                price: '499',
                duration: '45 mins',
                features: ['Mounting', 'Inlet connection'],
                imageUrl: ''
              },
              {
                title: 'Uninstallation',
                rating: '4.80',
                reviews: '3K',
                price: '299',
                duration: '20 mins',
                features: ['Safe removal'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Filter Change',
                rating: '4.88',
                reviews: '15K',
                price: '199',
                duration: '30 mins',
                features: ['Labour only', 'Spares extra'],
                imageUrl: ''
              },
              {
                title: 'Leakage Repair',
                rating: '4.75',
                reviews: '5K',
                price: '299',
                duration: '30 mins',
                features: ['Pipe check', 'Housing check'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: false,
        rating: 4.8,
        totalBookings: 90000
      },
      {
        title: 'Refrigerator Repair',
        slug: 'refrigerator-repair',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 450,
        discountPrice: null,
        page: {
          ratingTitle: 'Refrigerator Repair',
          ratingValue: '4.81',
          bookingsText: '165K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Service', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Cooling issue',
                rating: '4.81',
                reviews: '25K',
                price: '449',
                duration: '45 mins',
                features: ['Gas check', 'Compressor check'],
                imageUrl: ''
              },
              {
                title: 'Water leakage',
                rating: '4.76',
                reviews: '10K',
                price: '349',
                duration: '30 mins',
                features: ['Drain check', 'Seal usage'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Maintenance',
            anchorId: 'maintenance',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'General Servicing',
                rating: '4.85',
                reviews: '5K',
                price: '599',
                duration: '60 mins',
                features: ['Coil cleaning', 'Tray cleaning'],
                imageUrl: ''
              },
              {
                title: 'Gas Refill',
                rating: '4.88',
                reviews: '8K',
                price: '1999',
                duration: '60 mins',
                features: ['Complete refill', 'Leak check'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.81,
        totalBookings: 165000
      },
      {
        title: 'Microwave Repair',
        slug: 'microwave-repair',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: null,
        basePrice: 250,
        discountPrice: null,
        page: {
          ratingTitle: 'Microwave Repair',
          ratingValue: '4.79',
          bookingsText: '75K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Service', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Not heating',
                rating: '4.79',
                reviews: '8K',
                price: '299',
                duration: '45 mins',
                features: ['Magnetron check', 'Capacitor check'],
                imageUrl: ''
              },
              {
                title: 'Buttons not working',
                rating: '4.75',
                reviews: '5K',
                price: '249',
                duration: '30 mins',
                features: ['Panel check', 'Membrane check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Service',
            anchorId: 'service',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Deep Cleaning',
                rating: '4.82',
                reviews: '3K',
                price: '399',
                duration: '45 mins',
                features: ['Grease removal', 'Odor removal'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: false,
        rating: 4.79,
        totalBookings: 75000
      },
      {
        title: 'Television/LCD Repair',
        slug: 'tv-lcd-repair',
        categoryIds: [applianceCategory._id],
        iconUrl: '',
        badge: 'NEW',
        basePrice: 350,
        discountPrice: null,
        page: {
          ratingTitle: 'TV/LCD Repair',
          ratingValue: '4.80',
          bookingsText: '50K+ Bookings',
          paymentOffersEnabled: true,
          paymentOffers: [],
          banners: [],
          serviceCategoriesGrid: [
            { title: 'Repairs', imageUrl: '', badge: '' },
            { title: 'Installation', imageUrl: '', badge: '' }
          ]
        },
        sections: [
          {
            title: 'Repairs',
            anchorId: 'repairs',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'Display not working',
                rating: '4.80',
                reviews: '5K',
                price: '399',
                duration: '45 mins',
                features: ['Signal check', 'Screen check'],
                imageUrl: ''
              },
              {
                title: 'Sound issue',
                rating: '4.78',
                reviews: '3K',
                price: '349',
                duration: '40 mins',
                features: ['Speaker check', 'Audio board check'],
                imageUrl: ''
              },
              {
                title: 'Power issue',
                rating: '4.82',
                reviews: '4K',
                price: '299',
                duration: '30 mins',
                features: ['Power supply check', 'Cord check'],
                imageUrl: ''
              }
            ]
          },
          {
            title: 'Installation/Uninstallation',
            anchorId: 'installation',
            navImageUrl: '',
            navBadge: '',
            type: 'standard',
            cards: [
              {
                title: 'TV Installation (Wall Mount)',
                rating: '4.85',
                reviews: '10K',
                price: '499',
                duration: '45 mins',
                features: ['Secure mounting', 'Level check'],
                imageUrl: ''
              },
              {
                title: 'TV Uninstallation',
                rating: '4.82',
                reviews: '2K',
                price: '299',
                duration: '30 mins',
                features: ['Safe removal', 'Packaging help'],
                imageUrl: ''
              }
            ]
          }
        ],
        status: SERVICE_STATUS.ACTIVE,
        isPopular: true,
        rating: 4.80,
        totalBookings: 50000
      }
    ];

    // Delete old services that are no longer in the seed data
    // Get all slugs from seed data
    const seedSlugs = servicesData.map(s => s.slug);

    // Find services that are not in the seed data (old services to be removed)
    const oldServices = await Service.find({
      slug: { $nin: seedSlugs }
    });

    if (oldServices.length > 0) {
      console.log(`\n🗑️  Removing ${oldServices.length} old services that are no longer in seed data...`);
      for (const oldSvc of oldServices) {
        console.log(`  🗑️  Deleting: ${oldSvc.title} (${oldSvc.slug})`);
        await Service.findByIdAndDelete(oldSvc._id);
      }
      console.log(`✅ Removed ${oldServices.length} old services\n`);
    }

    const createdServices = [];
    for (const svcData of servicesData) {
      const existing = await Service.findOne({ slug: svcData.slug });
      if (existing) {
        // Update existing service with new data
        Object.assign(existing, svcData);
        await existing.save();
        console.log(`  ✅ Updated service: ${existing.title}`);
        createdServices.push(existing);
      } else {
        const service = await Service.create(svcData);
        console.log(`  ✅ Created service: ${service.title}`);
        createdServices.push(service);
      }
    }

    console.log(`\n✅ Services seeded: ${createdServices.length}\n`);

    // ============================================
    // HOME CONTENT
    // ============================================
    console.log('📦 Seeding Home Content...');

    // Get or create home content
    let homeContent = await HomeContent.findOne();
    if (!homeContent) {
      // Get category IDs for references
      const electricityCat = createdCategories.find(c => c.slug === 'electricity');
      const salonCat = createdCategories.find(c => c.slug === 'womens-salon-spa');
      const cleaningCat = createdCategories.find(c => c.slug === 'cleaning');
      const repairCat = createdCategories.find(c => c.slug === 'electrician-plumber-carpenter');
      const applianceCat = createdCategories.find(c => c.slug === 'ac-appliance-repair');

      const homeContentData = {
        banners: [
          {
            imageUrl: '', // Will be set from admin panel
            text: 'Professional Home Services',
            targetCategoryId: electricityCat?._id || null,
            scrollToSection: '',
            order: 0
          },
          {
            imageUrl: '', // Will be set from admin panel
            text: 'Quality Services at Your Doorstep',
            targetCategoryId: cleaningCat?._id || null,
            scrollToSection: '',
            order: 1
          }
        ],
        promos: [
          {
            title: 'Special Offer',
            subtitle: 'Get 20% off on your first booking',
            buttonText: 'Explore',
            gradientClass: 'from-blue-600 to-blue-800',
            imageUrl: '',
            targetCategoryId: salonCat?._id || null,
            scrollToSection: '',
            order: 0
          }
        ],
        curated: [
          {
            title: 'Top Rated Services',
            gifUrl: '',
            youtubeUrl: '',
            targetCategoryId: repairCat?._id || null,
            order: 0
          }
        ],
        noteworthy: [
          {
            title: 'New Services',
            imageUrl: '',
            targetCategoryId: applianceCat?._id || null,
            order: 0
          }
        ],
        booked: [
          {
            title: 'Intense cleaning (2 bathrooms)',
            rating: '4.79',
            reviews: '3.7M',
            price: '950',
            originalPrice: '1,038',
            discount: '8%',
            imageUrl: '',
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
            imageUrl: '',
            targetCategoryId: applianceCat?._id || null,
            order: 1
          }
        ],
        categorySections: [
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
        ],
        isActive: true
      };

      homeContent = await HomeContent.create(homeContentData);
      console.log('  ✅ Created home content');
    } else {
      console.log('  ⏭️  Home content already exists, skipping...');
    }

    console.log(`\n✅ Home content seeded\n`);

    // Summary
    console.log('='.repeat(50));
    console.log('📊 SEEDING SUMMARY');
    console.log('='.repeat(50));
    console.log(`Categories: ${createdCategories.length}`);
    console.log(`Services: ${createdServices.length}`);
    console.log(`Home Content: ${homeContent ? 1 : 0}`);
    console.log('='.repeat(50));
    console.log('\n✅ Database seeding completed successfully!\n');

  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    // Close database connection
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Run seed script
seedDatabase();
