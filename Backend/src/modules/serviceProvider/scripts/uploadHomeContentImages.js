require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { uploadFile } = require('../services/fileStorageService');

const homeContentSections = [
  {
    name: 'banner',
    displayName: 'Banner',
    images: [
      '../Frontend/src/assets/images/pages/Home/Banner/homepage-banner.png',
      '../Frontend/src/assets/images/pages/Home/Banner/Winter-banner.png'
    ]
  },
  {
    name: 'curated-services',
    displayName: 'Curated Services',
    images: [
      '../Frontend/src/assets/images/pages/Home/CuratedServices/ac-repair-service.jpg',
      '../Frontend/src/assets/images/pages/Home/CuratedServices/electrical-panel-upgrade.jpg',
      '../Frontend/src/assets/images/pages/Home/CuratedServices/home-wiring.jpg',
      '../Frontend/src/assets/images/pages/Home/CuratedServices/smart home setup.jpg'
    ]
  },
  {
    name: 'most-booked-services',
    displayName: 'Most Booked Services',
    images: [
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/automatic-top-load-machine.webp',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/dreill&hang.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/fan-repairs.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/haircut-men.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/intense-bathroom-2.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/intense-bathroom-3.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/roll-on-wax.webp',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/spacula-waxing.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/switch-board.jpg',
      '../Frontend/src/assets/images/pages/Home/MostBookedServices/tap-repai.jpg'
    ]
  },
  {
    name: 'new-and-noteworthy',
    displayName: 'New And Noteworthy',
    images: [
      '../Frontend/src/assets/images/pages/Home/NewAndNoteworthy/ac-repair.png',
      '../Frontend/src/assets/images/pages/Home/NewAndNoteworthy/bathroom-cleaning.png',
      '../Frontend/src/assets/images/pages/Home/NewAndNoteworthy/hair-studio.png',
      '../Frontend/src/assets/images/pages/Home/NewAndNoteworthy/water-purifiers.png'
    ]
  },
  {
    name: 'promo-carousel',
    displayName: 'Promo Carousel',
    images: [
      '../Frontend/src/assets/images/pages/Home/promo-carousel/1678450687690-81f922.jpg',
      '../Frontend/src/assets/images/pages/Home/promo-carousel/1678454437383-aa4984.jpg',
      '../Frontend/src/assets/images/pages/Home/promo-carousel/1711428209166-2d42c0.jpg',
      '../Frontend/src/assets/images/pages/Home/promo-carousel/1745822547742-760034.jpg',
      '../Frontend/src/assets/images/pages/Home/promo-carousel/1762785595543-540198.jpg',
      '../Frontend/src/assets/images/pages/Home/promo-carousel/1764052270908-bae94c.jpg'
    ]
  },
  {
    name: 'electrical-installation-repair',
    displayName: 'Electrical Installation & Repair',
    images: [
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/home-wiring.jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/electrical-panel-upgrade.jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/smart home setup.jpg'
    ]
  },
  {
    name: 'appliance-repair-service',
    displayName: 'Appliance Repair & Service',
    images: [
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ApplianceServices/ac-repair.jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ApplianceServices/washing-machine-repair].jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ApplianceServices/water heater repair.jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ApplianceServices/refrigator-repair.jpg'
    ]
  },
  {
    name: 'home-repair-installation',
    displayName: 'Home Repair & Installation',
    images: [
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/wiring.jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/fan.png',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/switch&socket.jpg',
      '../Frontend/src/assets/images/pages/Home/ServiceCategorySection/ElectricalServices/switch-socket.jpg'
    ]
  }
];

const uploadedImages = {};

const uploadHomeContentImages = async () => {
  try {
    console.log('🚀 Starting homepage content images upload to Cloudinary...\n');

    for (const section of homeContentSections) {
      console.log(`📁 Processing section: ${section.name} (${section.displayName})`);
      uploadedImages[section.name] = [];

      for (const imagePath of section.images) {
        if (!fs.existsSync(imagePath)) {
          console.log(`    ⚠️  Image not found: ${path.basename(imagePath)}`);
          continue;
        }

        try {
          console.log(`    📤 Uploading: ${path.basename(imagePath)}`);

          const imageBuffer = fs.readFileSync(imagePath);
          const result = await uploadFile(imageBuffer, {
            folder: `Homster/HomeContent/${section.name}`,
            public_id: path.basename(imagePath, path.extname(imagePath)).replace(/[^a-zA-Z0-9-_]/g, '-')
          });

          if (result.success) {
            uploadedImages[section.name].push({
              filename: path.basename(imagePath),
              url: result.url
            });
            console.log(`    ✅ Uploaded: ${result.url}`);
          } else {
            console.log(`    ❌ Failed: ${path.basename(imagePath)} - ${result.error}`);
          }
        } catch (error) {
          console.log(`    ❌ Error uploading ${path.basename(imagePath)}:`, error.message);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      console.log(`✅ Completed section: ${section.name}\n`);
    }

    // Save the uploaded URLs to a file for reference
    const outputPath = path.join(process.cwd(), 'homster-home-content-urls.json');
    fs.writeFileSync(outputPath, JSON.stringify(uploadedImages, null, 2));
    console.log(`📄 Saved uploaded URLs to: ${outputPath}`);

    console.log('\n🎉 All homepage content images uploaded successfully!');
    console.log('📋 Summary:');
    Object.keys(uploadedImages).forEach(section => {
      const count = uploadedImages[section].length;
      console.log(`  ${section}: ${count} images`);
    });

  } catch (error) {
    console.error('❌ Error uploading images:', error);
    throw error;
  }
};

// Run the upload
const runUpload = async () => {
  try {
    await uploadHomeContentImages();
    console.log('\n🎯 Next step: Update seeding scripts with these Homster HomeContent URLs');
  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  runUpload();
}

module.exports = { uploadHomeContentImages, uploadedImages };
