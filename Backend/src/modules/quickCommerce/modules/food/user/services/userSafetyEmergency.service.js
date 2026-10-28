import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodSafetyEmergencyReport } from '../../admin/models/safetyEmergencyReport.model.js';
import { alertAdmins, ALERT_KINDS, line, rupees } from '../../../../../../core/notifications/adminAlerts.js';

export const createSafetyEmergencyReport = async (userId, message) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const user = await FoodUser.findById(id).select('name email phone').lean();
    if (!user) {
        throw new ValidationError('User not found');
    }

    const created = await FoodSafetyEmergencyReport.create({
        userId: new mongoose.Types.ObjectId(id),
        userName: user.name || '',
        userEmail: user.email || '',
        userPhone: user.phone || '',
        message: String(message || '').trim(),
        status: 'unread',
        priority: 'medium'
    });

    alertAdmins({
        kind: ALERT_KINDS.SOS,
        module: 'quickCommerce',
        title: 'SOS from a customer',
        body: line(created.userName, created.userPhone, created.message),
        link: '/admin/quick-commerce/safety-emergency-reports',
        refId: String(created._id),
    });

    return { report: created.toObject() };
};

export const listMySafetyEmergencyReports = async (userId, query = {}) => {
    const id = String(userId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('User not found');
    }
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { userId: new mongoose.Types.ObjectId(id) };
    const [list, total] = await Promise.all([
        FoodSafetyEmergencyReport.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        FoodSafetyEmergencyReport.countDocuments(filter)
    ]);

    return {
        safetyEmergencies: list || [],
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 }
    };
};

