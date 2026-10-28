import mongoose from 'mongoose';

const foodHeroBannerSchema = new mongoose.Schema(
    {
        imageUrl: {
            type: String,
            required: true
        },
        publicId: {
            type: String,
            required: true
        },
        /**
         * Which Cloudinary resource type the asset was stored as.
         *
         * Needed at deletion: cloudinary.uploader.destroy() assumes 'image', so a
         * video banner would have its database record removed while the file
         * stayed in Cloudinary forever -- and the error is swallowed, so nothing
         * would ever say so. Defaults to 'image' for every banner that predates
         * video support, which is what they all are.
         */
        resourceType: {
            type: String,
            enum: ['image', 'video'],
            default: 'image'
        },
        title: {
            type: String
        },
        ctaText: {
            type: String
        },
        ctaLink: {
            type: String
        },
        linkedRestaurantIds: {
            type: [mongoose.Schema.Types.ObjectId],
            ref: 'FoodRestaurant',
            default: []
        },
        /**
         * Which app section this banner heads.
         *
         * Every banner created before this field existed is food's, which is
         * why the default is 'food' rather than a required choice -- the
         * existing rows keep working untouched and the customer app keeps
         * treating an unstamped banner as food.
         */
        module: {
            type: String,
            enum: ['food', 'taxi', 'quick_commerce', 'medical', 'porter', 'rental', 'services'],
            default: 'food',
            index: true,
            trim: true
        },
        sortOrder: {
            type: Number,
            default: 0,
            index: true
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        collection: 'food_hero_banners',
        timestamps: true
    }
);

foodHeroBannerSchema.index({ isActive: 1, sortOrder: 1 });
// The public read is always "active banners for one module, in order".
foodHeroBannerSchema.index({ module: 1, isActive: 1, sortOrder: 1 });

export const FoodHeroBanner = mongoose.model('FoodHeroBanner', foodHeroBannerSchema);

