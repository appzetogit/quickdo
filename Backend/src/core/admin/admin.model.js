import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config } from '../../config/env.js';
import { ADMIN_LEVELS, ADMIN_MODULES } from './adminHierarchy.constants.js';

const adminSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },
        password: {
            type: String,
            required: true
        },
        name: { type: String, trim: true, default: '' },
        phone: { type: String, trim: true, default: '' },
        profileImage: { type: String, trim: true, default: '' },
        fcmTokens: {
            type: [String],
            default: []
        },
        fcmTokenMobile: {
            type: [String],
            default: []
        },
        role: {
            type: String,
            default: 'ADMIN'
        },
        isActive: {
            type: Boolean,
            default: true
        },
        servicesAccess: {
            type: [String],
            enum: ['food', 'quickCommerce', 'medical', 'taxi', 'serviceProvider'],
            default: ['food']
        },
        // --- Admin Hierarchy Fields ---
        adminLevel: {
            type: String,
            enum: Object.values(ADMIN_LEVELS),
            default: ADMIN_LEVELS.SUBADMIN
        },
        module: {
            type: String,
            enum: [...Object.values(ADMIN_MODULES), null],
            default: null
        },
        parentAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodAdmin',
            default: null,
            index: true
        },
        admin_type: {
            type: String,
            enum: ['superadmin', 'subadmin'],
            default: 'subadmin'
        },
        permissions: {
            type: [String],
            default: []
        },
        /*
         * Whether this admin may delete anything -- zones, restaurants, vehicles,
         * items, anything -- in any panel. Separate from `permissions` because
         * "can edit" and "can destroy" are different trust levels: an admin can
         * run a section day to day without being able to wipe it. Enforced in
         * adminAccessPolicy.decideAdminAccess. Defaults to true so accounts made
         * before the switch keep what they could already do; the form starts
         * new sub-admins with it off.
         */
        canDelete: {
            type: Boolean,
            default: true
        },
        food_zone_ids: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'FoodZone'
                }
            ],
            default: []
        },
        // Quick commerce and medical zones (qc_zones) a sub-admin is limited to; empty = all.
        qc_zone_ids: {
            type: [mongoose.Schema.Types.ObjectId],
            default: []
        },
        // Taxi zones (taxi_zones) a sub-admin runs in Master > zone settings; empty = all.
        taxi_zone_ids: {
            type: [mongoose.Schema.Types.ObjectId],
            default: []
        },
        // taxi compatibility fields
        service_location_ids: {
            type: [mongoose.Schema.Types.ObjectId],
            default: []
        },
        zone_ids: {
            type: [mongoose.Schema.Types.ObjectId],
            default: []
        }
    },
    {
        collection: 'admins',
        timestamps: true
    }
);

adminSchema.index({ servicesAccess: 1 });
adminSchema.index({ adminLevel: 1, module: 1 });
adminSchema.index({ parentAdminId: 1, module: 1 });

adminSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        return next();
    }

    const salt = await bcrypt.genSalt(config.bcryptSaltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

adminSchema.methods.comparePassword = function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

export const FoodAdmin = mongoose.models.FoodAdmin || mongoose.model('FoodAdmin', adminSchema);
