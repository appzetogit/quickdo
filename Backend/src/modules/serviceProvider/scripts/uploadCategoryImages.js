require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { uploadFile } = require('../services/fileStorageService');

const categories = [
  {
    name: 'electricity',
    displayName: 'Electricity',
    icon: '../Frontend/src/assets/images/icons/services/electrician.png'
  },
  {
    name: 'lcd',
    displayName: 'LCD',
    icon: '../Frontend/src/assets/images/icons/services/ac-icon.png'
  }
];

const uploadedImages = {};

const uploadCategoryImages = async () => {
  try {
    console.log('🚀 Starting category icons upload to Cloudinary...\n');

    for (const category of categories) {
      console.log(`📁 Processing category: ${category.name} (${category.displayName})`);
      uploadedImages[category.name] = {
        icon: null
      };

      // Upload category icon to Homster/{category}/icons/
      if (fs.existsSync(category.icon)) {
        console.log(`  📤 Uploading category icon: ${path.basename(category.icon)}`);
        const iconBuffer = fs.readFileSync(category.icon);
        const iconResult = await uploadFile(iconBuffer, {
          folder: `Homster/${category.name}/icons`,
          public_id: `${category.name}-icon`,
          overwrite: true
        });

        if (iconResult.success) {
          uploadedImages[category.name].icon = iconResult.url;
          console.log(`  ✅ Icon uploaded: ${iconResult.url}`);
        } else {
          console.log(`  ❌ Icon upload failed: ${iconResult.error}`);
        }
      } else {
        console.log(`  ⚠️  Icon not found: ${category.icon}`);
      }

      console.log(`✅ Completed category: ${category.name}\n`);
    }

    // Save the uploaded URLs to a file for reference
    const outputPath = path.join(process.cwd(), 'homster-category-icons.json');
    fs.writeFileSync(outputPath, JSON.stringify(uploadedImages, null, 2));
    console.log(`📄 Saved uploaded URLs to: ${outputPath}`);

    console.log('\n🎉 All category icons uploaded successfully!');
    console.log('📋 Summary:');
    Object.keys(uploadedImages).forEach(category => {
      const iconUploaded = uploadedImages[category].icon ? 1 : 0;
      console.log(`  ${category}: ${iconUploaded} icon`);
    });

  } catch (error) {
    console.error('❌ Error uploading images:', error);
    throw error;
  }
};

// Run the upload
const runUpload = async () => {
  try {
    await uploadCategoryImages();
    console.log('\n🎯 Next step: Update seeding scripts with these Homster Cloudinary URLs');
  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  runUpload();
}

module.exports = { uploadCategoryImages, uploadedImages };