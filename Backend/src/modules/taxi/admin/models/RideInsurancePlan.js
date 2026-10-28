import mongoose from 'mongoose';

/**
 * A ride insurance plan a rider can add when booking. Empty vehicle_type_ids /
 * zone_ids mean every vehicle / every zone. See common/rideInsurance.js.
 */
const rideInsurancePlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    provider: { type: String, trim: true, default: '' },
    terms_url: { type: String, trim: true, default: '' },
    cover_amount: { type: Number, min: 0, default: 0 },
    premium_type: { type: String, enum: ['flat', 'percent'], default: 'flat' },
    premium_value: { type: Number, min: 0, required: true },
    vehicle_type_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiVehicle' }],
    zone_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiZone' }],
    sort_order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

rideInsurancePlanSchema.index({ active: 1 });

export const RideInsurancePlan = mongoose.models.TaxiRideInsurancePlan
  || mongoose.model('TaxiRideInsurancePlan', rideInsurancePlanSchema);
