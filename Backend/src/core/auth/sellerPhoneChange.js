/**
 * A signed-in seller changes its login number: the new number gets an OTP, and
 * only a verified code moves the account onto it.
 *
 * Shared by restaurants (Food, `food_restaurants`) and by stores and medical
 * stores (quick commerce), the same way sellerWebLogin.js is: each caller hands
 * in its own seller model and OTP scope.
 *
 * The login number is ownerPhone. Phone sign-in also matches
 * primaryContactNumber, so when that held the old number it moves too --
 * otherwise the old number would keep signing in. A primaryContactNumber that
 * was already a different number (a manager's, say) is left alone.
 *
 * A wrong code is a ValidationError (400), never an AuthError: the panel signs
 * the seller out on a 401, and a typo should not end the session.
 */
import mongoose from 'mongoose';
import { config } from '../../config/env.js';
import { createOrUpdateOtp, verifyOtp } from '../otp/otp.service.js';
import { ValidationError, NotFoundError } from './errors.js';

const last10 = (value) => String(value ?? '').replace(/\D/g, '').slice(-10);
const maskPhone = (phone) => (phone ? `******${phone.slice(-4)}` : '');
const exposeOtp = (otp) => (config.nodeEnv !== 'production' ? { otp } : {});

export const createSellerPhoneChange = ({ Model, otpScope, otpOptions = {} }) => {
    const endsWith = (field, phone) => ({ [field]: { $regex: new RegExp(`${phone}$`) } });

    /** The seller and the new number, once it is a number this seller may move to. */
    const prepare = async (sellerId, rawPhone) => {
        if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
            throw new ValidationError('Invalid account');
        }
        const seller = await Model.findById(sellerId).select('ownerPhone primaryContactNumber').lean();
        if (!seller) throw new NotFoundError('Account not found');

        const phone = last10(rawPhone);
        if (!/^[6-9]\d{9}$/.test(phone)) {
            throw new ValidationError('Enter a valid 10-digit mobile number.');
        }
        if (phone === last10(seller.ownerPhone)) {
            throw new ValidationError('This is already your login number.');
        }
        const taken = await Model.exists({
            _id: { $ne: seller._id },
            $or: [
                { ownerPhoneLast10: phone },
                endsWith('ownerPhone', phone),
                endsWith('primaryContactNumber', phone),
            ],
        });
        if (taken) {
            throw new ValidationError('This number is already registered with another account. Use a different number.');
        }
        return { seller, phone };
    };

    return {
        /** Step 1: send a code to the new number. */
        async requestOtp(sellerId, rawPhone) {
            const { phone } = await prepare(sellerId, rawPhone);
            const otp = await createOrUpdateOtp(phone, otpScope, otpOptions);
            return { phone, maskedPhone: maskPhone(phone), ...exposeOtp(otp) };
        },

        /** Step 2: the code from the new number; moves the account onto it. */
        async verify(sellerId, rawPhone, otp) {
            const { seller, phone } = await prepare(sellerId, rawPhone);
            const code = String(otp ?? '').replace(/\D/g, '');
            if (!code) throw new ValidationError('Enter the code we sent to your new number.');
            const result = await verifyOtp(phone, code, otpScope);
            if (!result.valid) {
                throw new ValidationError(result.reason || 'That code is not right. Try again.');
            }

            const set = { ownerPhone: phone, ownerPhoneDigits: phone, ownerPhoneLast10: phone };
            const oldPhone = last10(seller.ownerPhone);
            if (!seller.primaryContactNumber || last10(seller.primaryContactNumber) === oldPhone) {
                set.primaryContactNumber = phone;
            }
            await Model.updateOne({ _id: seller._id }, { $set: set });
            return { ownerPhone: phone, primaryContactNumber: set.primaryContactNumber ?? seller.primaryContactNumber };
        },
    };
};
