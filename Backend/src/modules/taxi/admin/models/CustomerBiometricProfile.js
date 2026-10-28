import mongoose from "mongoose";

const biometricFingerSchema = new mongoose.Schema(
  {
    fingerCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    displayName: {
      type: String,
      default: "",
      trim: true,
    },
    hand: {
      type: String,
      enum: ["left", "right", "unknown"],
      default: "unknown",
    },
    templateFormat: {
      type: String,
      default: "vendor-template",
      trim: true,
    },
    templateEncrypted: {
      type: String,
      default: "",
      trim: true,
    },
    templateHash: {
      type: String,
      default: "",
      trim: true,
    },
    previewImage: {
      type: String,
      default: "",
      trim: true,
    },
    qualityScore: {
      type: Number,
      default: null,
      min: 0,
    },
    captureSource: {
      type: String,
      enum: ["phone_sensor", "usb_scanner", "bluetooth_scanner", "manual", "unknown"],
      default: "unknown",
    },
    deviceLabel: {
      type: String,
      default: "",
      trim: true,
    },
    scannerSerial: {
      type: String,
      default: "",
      trim: true,
    },
    sampleCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
    lastVerifiedAt: {
      type: Date,
      default: null,
    },
    verificationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

const biometricAuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
    },
    fingerCode: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    actorRole: {
      type: String,
      default: "",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    matchScore: {
      type: Number,
      default: null,
      min: 0,
    },
    verificationStatus: {
      type: String,
      default: "",
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const customerBiometricProfileSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaxiRentalBookingRequest",
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaxiUser",
      default: null,
      index: true,
    },
    serviceCenterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaxiServiceStore",
      required: true,
      index: true,
    },
    capturedByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaxiServiceCenterStaff",
      default: null,
    },
    enrollmentMode: {
      type: String,
      enum: ["thumbs_only", "optional", "all_ten"],
      default: "thumbs_only",
    },
    requiredFingerCount: {
      type: Number,
      default: 2,
      min: 1,
      max: 10,
    },
    status: {
      type: String,
      enum: ["not_started", "in_progress", "completed", "verified"],
      default: "not_started",
    },
    consentAccepted: {
      type: Boolean,
      default: false,
    },
    consentAcceptedAt: {
      type: Date,
      default: null,
    },
    consentNotes: {
      type: String,
      default: "",
      trim: true,
    },
    fingers: {
      type: [biometricFingerSchema],
      default: [],
    },
    verificationSummary: {
      lastVerifiedAt: {
        type: Date,
        default: null,
      },
      lastVerificationStatus: {
        type: String,
        default: "",
        trim: true,
      },
      lastVerifiedFingerCode: {
        type: String,
        default: "",
        trim: true,
        uppercase: true,
      },
      lastMatchScore: {
        type: Number,
        default: null,
        min: 0,
      },
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    auditLogs: {
      type: [biometricAuditLogSchema],
      default: [],
    },
  },
  { timestamps: true },
);

customerBiometricProfileSchema.index({ serviceCenterId: 1, createdAt: -1 });
customerBiometricProfileSchema.index({ userId: 1, updatedAt: -1 });

export const CustomerBiometricProfile =
  mongoose.models.TaxiCustomerBiometricProfile ||
  mongoose.model("TaxiCustomerBiometricProfile", customerBiometricProfileSchema);
