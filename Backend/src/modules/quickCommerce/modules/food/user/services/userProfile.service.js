import { FoodUser } from '../../../../core/users/user.model.js';
import { AuthError, ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';

const parseIsoDateOrNull = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(`${String(value)}T00:00:00.000Z`);
    // Keep null for invalid; validation is handled by DTO, but be defensive.
    return Number.isNaN(d.getTime()) ? null : d;
};

export const getCurrentUserProfile = async (userId) => {
    const user = await FoodUser.findById(userId).lean();
    if (!user) throw new AuthError('Profile not found');
    return { user };
};

export const updateCurrentUserProfile = async (userId, body) => {
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    if (body.phone !== undefined) {
        const nextPhone = String(body.phone || '').trim();
        const currentPhone = String(user.phone || '').trim();
        // OTP login is phone-based in this project; don't allow changing it from profile edit.
        if (nextPhone && nextPhone !== currentPhone) {
            throw new ValidationError('Phone number cannot be changed');
        }
    }

    if (body.name !== undefined) user.name = String(body.name || '').trim();
    if (body.email !== undefined) {
        const nextEmail = String(body.email || '').trim().toLowerCase();
        if (nextEmail) {
            const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!EMAIL_REGEX.test(nextEmail)) {
                throw new ValidationError('Invalid email format');
            }
            const domainParts = nextEmail.split('@')[1].split('.');
            for (let i = 0; i < domainParts.length - 1; i++) {
                if (domainParts[i] === domainParts[i + 1] && domainParts[i].length > 0) {
                    throw new ValidationError('Invalid email domain structure (e.g., .com.com)');
                }
            }
            if (nextEmail.includes('..')) {
                throw new ValidationError('Email cannot contain consecutive dots');
            }
        }
        user.email = nextEmail;
    }
    if (body.profileImage !== undefined) user.profileImage = String(body.profileImage || '').trim();
    if (body.gender !== undefined) user.gender = String(body.gender || '').trim();

    const dob = parseIsoDateOrNull(body.dateOfBirth);
    if (dob !== undefined) user.dateOfBirth = dob;
    const ann = parseIsoDateOrNull(body.anniversary);
    if (ann !== undefined) user.anniversary = ann;

    await user.save();
    return { user: user.toObject() };
};

export const uploadCurrentUserProfileImage = async (userId, file) => {
    if (!file || !file.buffer) {
        throw new ValidationError('File is required');
    }
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    const url = await uploadImageBuffer(file.buffer, 'food/users/profile');
    user.profileImage = String(url || '').trim();
    await user.save();
    return { profileImage: user.profileImage, user: user.toObject() };
};

/**
 * The customer deletes their own account: a soft delete
 * (core/users/softDeleteCustomer.js), the same as the Food endpoint.
 */
export const deleteCurrentUserAccount = async (userId, { reason } = {}) => {
    const { softDeleteCustomer } = await import('../../../../../../core/users/softDeleteCustomer.js');
    const result = await softDeleteCustomer(userId, reason ? { reason } : {});
    if (!result) throw new AuthError('Profile not found');
    return { success: true, deletedAt: result.deletedAt };
};

