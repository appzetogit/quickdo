import mongoose from 'mongoose';

const rideCheckLogSchema = new mongoose.Schema(
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
    popup_time: {
      type: Date,
      required: true,
    },
    user_response: {
      type: String,
      enum: ['safe', 'need_help', 'no_response'],
      default: 'no_response',
    },
    response_time: {
      type: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model('RideCheckLog', rideCheckLogSchema);
