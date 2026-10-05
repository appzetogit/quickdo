import mongoose from 'mongoose';

const serviceStoreSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    zone_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiZone',
      required: true,
      index: true,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
      index: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    owner_name: {
      type: String,
      default: '',
      trim: true,
    },
    owner_phone: {
      type: String,
      default: '',
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    active: {
      type: Boolean,
      default: true,
    },
    fcmTokenWeb: {
      type: String,
      default: '',
      trim: true,
    },
    fcmTokenMobile: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

serviceStoreSchema.index({ location: '2dsphere' });
serviceStoreSchema.index({ name: 1, zone_id: 1 });

export const ServiceStore =
  mongoose.models.TaxiServiceStore || mongoose.model('TaxiServiceStore', serviceStoreSchema);
