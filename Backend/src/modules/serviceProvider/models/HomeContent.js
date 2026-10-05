const mongoose = require('mongoose');

/**
 * HomeContent Model
 * Manages homepage content: banners, promos, curated services, etc.
 */
const homeContentSchema = new mongoose.Schema({
  // City association - if null, considered default/fallback
  cityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SPCity',
    default: null,
    index: true
  },

  // Banners (main homepage banners)
  banners: [{
    imageUrl: {
      type: String,
      default: ''
    },
    text: {
      type: String,
      default: ''
    },
    targetCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPCategory',
      default: null
    },
    slug: {
      type: String,
      default: ''
    },
    targetServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPService',
      default: null
    },
    scrollToSection: {
      type: String,
      default: ''
    },
    order: {
      type: Number,
      default: 0
    }
  }],

  // Promo Carousel
  promos: [{
    title: {
      type: String,
      required: false,
      default: ''
    },
    subtitle: {
      type: String,
      default: ''
    },
    buttonText: {
      type: String,
      default: 'Explore'
    },
    gradientClass: {
      type: String,
      default: 'from-blue-600 to-blue-800'
    },
    imageUrl: {
      type: String,
      default: ''
    },
    targetCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPCategory',
      default: null
    },
    slug: {
      type: String,
      default: ''
    },
    targetServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPService',
      default: null
    },
    scrollToSection: {
      type: String,
      default: ''
    },
    order: {
      type: Number,
      default: 0
    }
  }],

  // Curated Services
  curated: [{
    title: {
      type: String,
      required: false,
      default: ''
    },
    gifUrl: {
      type: String,
      default: ''
    },
    youtubeUrl: {
      type: String,
      default: ''
    },
    order: {
      type: Number,
      default: 0
    }
  }],

  // New & Noteworthy
  noteworthy: [{
    title: {
      type: String,
      required: false,
      default: ''
    },
    imageUrl: {
      type: String,
      default: ''
    },
    targetCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPCategory',
      default: null
    },
    slug: {
      type: String,
      default: ''
    },
    targetServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPService',
      default: null
    },
    order: {
      type: Number,
      default: 0
    }
  }],

  // Most Booked Services
  booked: [{
    title: {
      type: String,
      required: false,
      default: ''
    },
    rating: {
      type: String,
      default: ''
    },
    reviews: {
      type: String,
      default: ''
    },
    price: {
      type: String,
      default: ''
    },
    originalPrice: {
      type: String,
      default: ''
    },
    discount: {
      type: String,
      default: ''
    },
    imageUrl: {
      type: String,
      default: ''
    },
    targetCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPCategory',
      default: null
    },
    slug: {
      type: String,
      default: ''
    },
    targetServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPService',
      default: null
    },
    order: {
      type: Number,
      default: 0
    }
  }],

  // Category Sections
  categorySections: [{
    title: {
      type: String,
      required: true
    },
    seeAllTargetCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPCategory',
      default: null
    },
    seeAllSlug: {
      type: String,
      default: ''
    },
    seeAllTargetServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SPService',
      default: null
    },
    cards: [{
      title: String,
      imageUrl: String,
      badge: String,
      price: String,
      originalPrice: String,
      discount: String,
      rating: String,
      reviews: String,
      targetCategoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SPCategory',
        default: null
      },
      slug: {
        type: String,
        default: ''
      },
      targetServiceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SPService',
        default: null
      }
    }],
    order: {
      type: Number,
      default: 0
    }
  }],

  // Status
  isActive: {
    type: Boolean,
    default: true
  },

  // Section Visibility
  isBannersVisible: { type: Boolean, default: true },
  isPromosVisible: { type: Boolean, default: true },
  isCuratedVisible: { type: Boolean, default: true },
  isNoteworthyVisible: { type: Boolean, default: true },
  isBookedVisible: { type: Boolean, default: true },
  isCategorySectionsVisible: { type: Boolean, default: true },
  isCategoriesVisible: { type: Boolean, default: true }
}, {
  timestamps: true
});

// Ensure only one home content document exists per city
homeContentSchema.statics.getHomeContent = async function (cityId = null) {
  let query = { cityId: null };

  if (cityId) {
    query = { cityId };
  }

  let homeContent = await this.findOne(query);

  // If requesting a specific city and no content exists, create it by copying default/empty
  if (!homeContent && cityId) {
    // Ideally we might copy from default here, but for now we create empty/default structure
    // Fetch default to see if we can copy basics? No, start fresh or based on migration.
    // Let's create a new entry for this city.
    homeContent = await this.create({ cityId });
  } else if (!homeContent && !cityId) {
    // Create default if it doesn't exist
    homeContent = await this.create({ cityId: null });
  }

  return homeContent;
};

module.exports = mongoose.models.SPHomeContent || mongoose.model('SPHomeContent', homeContentSchema, 'sp_home_contents');

