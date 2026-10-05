import mongoose from 'mongoose';

const emergencyAlertSchema = new mongoose.Schema(
  {
    trip_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ride',
      required: true,
      index: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    ride_status: {
      type: String,
    },
    alert_type: {
      type: String,
      enum: ['sos_button', 'ride_check_missed', 'ride_check_help'],
      default: 'sos_button',
    },
    status: {
      type: String,
      enum: ['pending', 'investigating', 'resolved', 'false_alarm'],
      default: 'pending',
    },
    resolved_at: {
      type: Date,
    },
    admin_notes: {
      type: String,
    },
    resolved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  { timestamps: true }
);

emergencyAlertSchema.index({ location: '2dsphere' });

export default mongoose.model('EmergencyAlert', emergencyAlertSchema);
