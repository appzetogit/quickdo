import mongoose from 'mongoose';

const emergencySettingSchema = new mongoose.Schema(
  {
    enable_sos: {
      type: Boolean,
      default: true,
    },
    enable_ride_check: {
      type: Boolean,
      default: true,
    },
    popup_interval_minutes: {
      type: Number,
      default: 15,
    },
    max_trusted_contacts: {
      type: Number,
      default: 5,
    },
    emergency_helpline: {
      type: String,
      default: '911',
    },
    alert_timeout_minutes: {
      type: Number,
      default: 5, // time before auto escalation
    },
  },
  { timestamps: true }
);

export default mongoose.model('EmergencySetting', emergencySettingSchema);
