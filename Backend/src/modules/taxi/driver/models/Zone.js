import mongoose from 'mongoose';

const zoneSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    service_location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiServiceLocation',
      default: null,
    },
    unit: {
      type: String,
      default: 'km',
      trim: true,
    },
    peak_zone_ride_count: {
      type: Number,
      default: null,
    },
    peak_zone_radius: {
      type: Number,
      default: null,
    },
    peak_zone_selection_duration: {
      type: Number,
      default: null,
    },
    peak_zone_duration: {
      type: Number,
      default: null,
    },
    peak_zone_surge_percentage: {
      type: Number,
      default: null,
    },
    ride_surge_enabled: {
      type: Boolean,
      default: false,
    },
    maximum_distance_for_regular_rides: {
      type: Number,
      default: null,
    },
    maximum_distance_for_outstation_rides: {
      type: Number,
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      default: 'active',
      trim: true,
    },
    boundary_mode: {
      type: String,
      enum: ['polygon', 'circle'],
      default: 'polygon',
      trim: true,
    },
    circle_center: {
      lat: {
        type: Number,
        default: null,
      },
      lng: {
        type: Number,
        default: null,
      },
    },
    circle_radius_meters: {
      type: Number,
      default: null,
    },
    /**
     * Landmarks the rider app offers as destinations inside this zone.
     *
     * Ordered as the admin arranged them -- the first few are what a
     * phone has room for, so the order is the admin's editorial choice
     * and is not re-sorted on write.
     */
    popular_places: [
      {
        name: { type: String, trim: true, default: '' },
        /** Cloudinary URL from the admin panel's shared upload. */
        image: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
        location: {
          lat: { type: Number, default: null },
          lng: { type: Number, default: null },
        },
        /** Hidden without being deleted, for a place that closes. */
        active: { type: Boolean, default: true },
      },
    ],
    geometry: {
      type: {
        type: String,
        enum: ['Polygon'],
        required: true,
      },
      coordinates: {
        type: [[[Number]]],
        required: true,
      },
    },
  },
  { 
    timestamps: true,
  },
);

zoneSchema.index({ geometry: '2dsphere' });

export const Zone = mongoose.models.TaxiZone || mongoose.model('TaxiZone', zoneSchema);
