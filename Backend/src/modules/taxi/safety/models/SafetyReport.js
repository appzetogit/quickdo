import mongoose from 'mongoose';

const safetyReportSchema = new mongoose.Schema(
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
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    image: {
      type: String,
    },
    audio: {
      type: String,
    },
    status: {
      type: String,
      enum: ['pending', 'investigating', 'resolved', 'rejected'],
      default: 'pending',
    },
    admin_note: {
      type: String,
    },
    assigned_admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  { timestamps: true }
);

export default mongoose.model('SafetyReport', safetyReportSchema);
