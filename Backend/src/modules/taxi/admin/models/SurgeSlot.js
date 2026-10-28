import mongoose from 'mongoose';

/**
 * A time-slot surge: in these zones, on these weekdays, between these times,
 * rides cost `percent` more -- for every vehicle (vehicle_type_ids empty) or
 * only those listed. See common/surgeSlot.js for how a slot is matched.
 */
const surgeSlotSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    zone_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiZone' }],
    vehicle_type_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TaxiVehicle' }],
    days: [{ type: Number, min: 0, max: 6 }],
    start_time: { type: String, required: true, trim: true },
    end_time: { type: String, required: true, trim: true },
    percent: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

surgeSlotSchema.index({ zone_ids: 1, active: 1 });

export const SurgeSlot = mongoose.models.TaxiSurgeSlot || mongoose.model('TaxiSurgeSlot', surgeSlotSchema);
