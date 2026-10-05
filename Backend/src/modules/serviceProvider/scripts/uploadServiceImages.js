const dotenv = require('dotenv');
dotenv.config();

const path = require('path');
const fs = require('fs');
const connectDB = require('../config/db');
const Service = require('../models/Service');
const { uploadFile } = require('../services/fileStorageService');

/**
 * Upload Service Section Images to Local Storage
 * This script uploads service section images to backend/upload folder and updates the database
 */
const uploadServiceImages = async () => {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    const frontendPath = path.join(__dirname, '../../Frontend/src/assets/images/pages/Home/ServiceCategorySection');

    // Image mappings: service slug -> section -> card -> image path
    const imageMappings = {
      'salon-for-women': {
        sections: [
          {
            title: 'Waxing & threading',
            cards: [
              {
                title: 'Roll-on waxing',
                imagePath: path.join(frontendPath, 'SalonForWomen/salon-1.jpg')
              },
              {
                title: 'Spatula waxing',
                imagePath: path.join(frontendPath, 'SalonForWomen/salon-2.jpg')
              }
            ]
          },
          {
            title: 'Korean facial',
            cards: [
              {
                title: 'Korean Glass hydration facial',
                imagePath: path.join(frontendPath, 'SalonForWomen/salon-3.jpg')
              },
              {
                title: 'Korean Radiance facial',
                imagePath: path.join(frontendPath, 'SalonForWomen/salon-4.jpg')
              }
            ]
          }
        ],
        serviceCategoriesGrid: [
          { title: 'Super saver packages', imagePath: path.join(frontendPath, 'SalonForWomen/salon-1.jpg') },
          { title: 'Waxing & threading', imagePath: path.join(frontendPath, 'SalonForWomen/salon-2.jpg') },
          { title: 'Korean facial', imagePath: path.join(frontendPath, 'SalonForWomen/salon-3.jpg') },
          { title: 'Signature facials', imagePath: path.join(frontendPath, 'SalonForWomen/salon-4.jpg') },
          { title: 'Ayurvedic facial', imagePath: path.join(frontendPath, 'SalonForWomen/salon-3.jpg') },
          { title: 'Cleanup', imagePath: path.join(frontendPath, 'SalonForWomen/cleanup.jpg') },
          { title: 'Pedicure & manicure', imagePath: path.join(frontendPath, 'SalonForWomen/salon-5.jpg') },
          { title: 'Hair, bleach & detan', imagePath: path.join(frontendPath, 'SalonForWomen/salon-6.jpg') }
        ]
      },
      'ac': {
        sections: [
          {
            title: 'Service',
            cards: [
              {
                title: 'Foam-jet AC service',
                imagePath: path.join(frontendPath, 'ApplianceServices/ac-repair.jpg')
              }
            ]
          }
        ],
        serviceCategoriesGrid: [
          { title: 'Super saver packages', imagePath: path.join(frontendPath, 'ApplianceServices/ac-repair.jpg') },
          { title: 'Service', imagePath: path.join(frontendPath, 'ApplianceServices/ac-repair.jpg') },
          { title: 'Repair & gas refill', imagePath: path.join(frontendPath, 'ApplianceServices/ac-repair.jpg') },
          { title: 'Installation/uninstallation', imagePath: path.join(frontendPath, 'ApplianceServices/ac-repair.jpg') }
        ]
      },
      'sofa-carpet-cleaning': {
        sections: [
          {
            title: 'Sofa cleaning',
            cards: [
              {
                title: 'Sofa cleaning',
                imagePath: path.join(frontendPath, 'CleaningEssentials/sofa-cleaning.jpg')
              }
            ]
          },
          {
            title: 'Carpet',
            cards: [
              {
                title: 'Carpet cleaning',
                imagePath: path.join(frontendPath, 'CleaningEssentials/carpet.jpg')
              }
            ]
          }
        ],
        serviceCategoriesGrid: [
          { title: 'Sofa cleaning', imagePath: path.join(frontendPath, 'CleaningEssentials/sofa-cleaning.jpg') },
          { title: 'Carpet', imagePath: path.join(frontendPath, 'CleaningEssentials/carpet.jpg') },
          { title: 'Dining table', imagePath: path.join(frontendPath, 'CleaningEssentials/dining-table.jpg') },
          { title: 'Mattress', imagePath: path.join(frontendPath, 'CleaningEssentials/mattress.jpg') }
        ]
      }
    };

    console.log('📤 Uploading service section images...\n');

    for (const [serviceSlug, mappings] of Object.entries(imageMappings)) {
      const service = await Service.findOne({ slug: serviceSlug });
      if (!service) {
        console.log(`  ⚠️  Service "${serviceSlug}" not found, skipping...`);
        continue;
      }

      console.log(`\n📦 Processing service: ${service.title} (${serviceSlug})`);

      let updated = false;

      // Update sections images
      if (mappings.sections && service.sections) {
        for (const sectionMapping of mappings.sections) {
          const section = service.sections.find(s => s.title === sectionMapping.title);
          if (!section) continue;

          for (const cardMapping of sectionMapping.cards) {
            const card = section.cards.find(c => c.title === cardMapping.title);
            if (!card) continue;

            if (fs.existsSync(cardMapping.imagePath)) {
              try {
                const imageBuffer = fs.readFileSync(cardMapping.imagePath);
                // Sanitize public_id: remove special characters, replace spaces with hyphens
                const sanitizeId = (str) => str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
                const folderPath = `images/services/${serviceSlug}/sections/${sanitizeId(sectionMapping.title)}`;
                const filename = sanitizeId(cardMapping.title);
                const uploadResult = await uploadFile(imageBuffer, {
                  folder: folderPath,
                  public_id: filename,
                  extension: path.extname(cardMapping.imagePath).substring(1) || 'jpg'
                });

                if (uploadResult.success) {
                  card.imageUrl = uploadResult.url;
                  updated = true;
                  console.log(`    ✅ Uploaded: ${cardMapping.title} -> ${uploadResult.url}`);
                } else {
                  console.error(`    ❌ Error uploading ${cardMapping.title}: ${uploadResult.error}`);
                }
              } catch (error) {
                console.error(`    ❌ Error uploading ${cardMapping.title}:`, error.message);
              }
            } else {
              console.log(`    ⚠️  Image not found: ${cardMapping.imagePath}`);
            }
          }
        }
      }

      // Update serviceCategoriesGrid images
      if (mappings.serviceCategoriesGrid && service.page && service.page.serviceCategoriesGrid) {
        for (const gridMapping of mappings.serviceCategoriesGrid) {
          const gridItem = service.page.serviceCategoriesGrid.find(g => g.title === gridMapping.title);
          if (!gridItem) continue;

          if (fs.existsSync(gridMapping.imagePath)) {
            try {
              const imageBuffer = fs.readFileSync(gridMapping.imagePath);
              // Sanitize public_id: remove special characters, replace spaces with hyphens
              const sanitizeId = (str) => str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
              const folderPath = `images/services/${serviceSlug}/categories`;
              const filename = sanitizeId(gridMapping.title);
              const uploadResult = await uploadFile(imageBuffer, {
                folder: folderPath,
                public_id: filename,
                extension: path.extname(gridMapping.imagePath).substring(1) || 'jpg'
              });

              if (uploadResult.success) {
                gridItem.imageUrl = uploadResult.url;
                updated = true;
                console.log(`    ✅ Uploaded category grid: ${gridMapping.title} -> ${uploadResult.url}`);
              } else {
                console.error(`    ❌ Error uploading category grid ${gridMapping.title}: ${uploadResult.error}`);
              }
            } catch (error) {
              console.error(`    ❌ Error uploading category grid ${gridMapping.title}:`, error.message);
            }
          } else {
            console.log(`    ⚠️  Image not found: ${gridMapping.imagePath}`);
          }
        }
      }

      if (updated) {
        await service.save();
        console.log(`  ✅ Updated service: ${service.title}`);
      }
    }

    console.log('\n✅ Service images upload completed!\n');

  } catch (error) {
    console.error('❌ Error uploading service images:', error);
    process.exit(1);
  } finally {
    const mongoose = require('mongoose');
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
};

// Run upload script
uploadServiceImages();

