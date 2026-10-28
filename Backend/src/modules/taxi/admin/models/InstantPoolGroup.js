import mongoose from 'mongoose';

const poolRouteStopSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['pickup', 'drop'],
    required: true,
  },
  rideId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TaxiRide',
    required: true,
  },
  address: {
    type: String,
    required: true,
    trim: true,
  },
  coordinates: {
    type: [Number],
    required: true,
  },
  etaMinutes: {
    type: Number,
    default: 0,
  },
  passengerName: {
    type: String,
    default: 'Passenger',
  },
  otp: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'skipped'],
    default: 'pending',
  }
}, { _id: true });

const instantPoolGroupSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
      index: true,
    },
    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiVehicle',
      required: true,
    },
    activeRides: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxiRide',
      }
    ],
    totalCapacity: {
      type: Number,
      default: 4,
      min: 1,
    },
    occupiedSeats: {
      type: Number,
      default: 0,
      min: 0,
    },
    routeSequence: {
      type: [poolRouteStopSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['created', 'active', 'completed', 'cancelled'],
      default: 'created',
      index: true,
    },
    routeVersion: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

instantPoolGroupSchema.index({ status: 1 });

export const InstantPoolGroup =
  mongoose.models.TaxiInstantPoolGroup ||
  mongoose.model('TaxiInstantPoolGroup', instantPoolGroupSchema);
