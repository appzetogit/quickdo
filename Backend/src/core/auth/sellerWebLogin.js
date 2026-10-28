/**
 * Seller web-portal login: email + password, then an OTP to the phone on file.
 *
 * Shared by restaurants (Food, `food_restaurants`) and by stores and medical
 * stores (quick commerce, `qc_restaurants`). Each caller hands in its own seller
 * model and OTP scope and decides afterwards whether the proved seller may sign
 * in and how its session is issued.
 *
 * The app keeps the phone-OTP login. On the web the seller proves the password
 * first; only then is an OTP sent, to the ownerPhone already on the seller
 * (never a number from the request), so a leaked password alone gets nobody in.
 *
 * Step 1 hands back a short-lived signed ticket naming the seller. Resend and
 * verify need that ticket, so the OTP is checked against exactly the seller whose
 * password was proved, even when several sellers share an owner email.
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../../config/env.js';
import { createOrUpdateOtp, verifyOtp } from '../otp/otp.service.js';
import { ValidationError, AuthError } from './errors.js';

const TICKET_TTL = '10m';
export const INVALID_WEB_CREDENTIALS = 'Invalid email or password';
export const WEB_SESSION_EXPIRED = 'Your login session expired. Please sign in again.';
export const MIN_PORTAL_PASSWORD = 8;
export const MAX_PORTAL_PASSWORD = 128;

const last10 = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const sellerPhone = (seller) => last10(seller?.ownerPhone || seller?.primaryContactNumber);
const maskPhone = (phone) => (phone ? `******${phone.slice(-4)}` : '');
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exposeOtp = (otp) => (config.nodeEnv !== 'production' ? { otp } : {});

// Compared against when no seller matches, so a wrong email costs the same time
// as a wrong password and response timing does not reveal which emails exist.
let dummyPasswordHash = null;
const getDummyPasswordHash = () => {
    dummyPasswordHash ||= bcrypt.hash(crypto.randomBytes(16).toString('hex'), config.bcryptSaltRounds);
    return dummyPasswordHash;
};

export const hashPortalPassword = async (password) => {
    const salt = await bcrypt.genSalt(config.bcryptSaltRounds);
    return bcrypt.hash(String(password), salt);
};

/**
 * Admin action: set or replace a seller's portal password.
 * Refuses a seller with no owner email (the login ID) or owner phone (where the OTP goes).
 */
export const setSellerPortalPassword = async (Model, id, password) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid restaurant id');
    }
    const value = typeof password === 'string' ? password : '';
    if (value.length < MIN_PORTAL_PASSWORD || value.length > MAX_PORTAL_PASSWORD) {
        throw new ValidationError(`Password must be ${MIN_PORTAL_PASSWORD} to ${MAX_PORTAL_PASSWORD} characters`);
    }
    const seller = await Model.findById(id).select('ownerEmail ownerPhone primaryContactNumber').lean();
    if (!seller) return null;
    if (!String(seller.ownerEmail || '').trim()) {
        throw new ValidationError('Add an owner email first; it is the web login ID');
    }
    if (sellerPhone(seller).length !== 10) {
        throw new ValidationError('Add an owner phone first; the login OTP is sent there');
    }
    const portalPasswordSetAt = new Date();
    await Model.updateOne(
        { _id: id },
        { $set: { portalPassword: await hashPortalPassword(value), portalPasswordSetAt } },
    );
    return { portalPasswordSetAt };
};

/**
 * @param {object} opts
 * @param {import('mongoose').Model} opts.Model  seller model with portalPassword (select:false)
 * @param {string} opts.otpScope                 OTP scope; distinct from the app login's
 * @param {string} opts.ticketPurpose            names the ticket; also keys its secret
 * @param {object} [opts.otpOptions]             passed to createOrUpdateOtp (service attribution)
 */
export const createSellerWebLogin = ({ Model, otpScope, ticketPurpose, otpOptions }) => {
    // Derived from the access secret, so a ticket can never pass as an access
    // token or vice versa, and one vertical's ticket is useless on the other.
    const ticketSecret = () => `${config.jwtAccessSecret}:${ticketPurpose}`;

    const sendOtp = async (phone) => createOrUpdateOtp(phone, otpScope, otpOptions);

    /** Step 1. Returns the ticket, the masked phone and the seller whose password matched. */
    const requestOtp = async (email, password) => {
        const candidates = await Model.find({
            ownerEmail: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
        })
            .select('+portalPassword ownerPhone primaryContactNumber status storeType rejectionReason')
            .lean();

        let matched = null;
        for (const candidate of candidates) {
            if (!candidate.portalPassword) continue;
            // eslint-disable-next-line no-await-in-loop
            if (await bcrypt.compare(String(password), candidate.portalPassword)) {
                matched = candidate;
                break;
            }
        }
        if (!matched) {
            if (!candidates.some((c) => c.portalPassword)) {
                await bcrypt.compare(String(password), await getDummyPasswordHash());
            }
            throw new AuthError(INVALID_WEB_CREDENTIALS);
        }

        const phone = sellerPhone(matched);
        if (phone.length !== 10) {
            throw new ValidationError('No mobile number is registered for this account. Please contact support.');
        }
        delete matched.portalPassword;
        return { phone, seller: matched };
    };

    /** Called once the caller has accepted the seller: sends the OTP and signs the ticket. */
    const issueTicket = async ({ phone, seller }) => {
        const otp = await sendOtp(phone);
        const ticket = jwt.sign(
            { rid: String(seller._id), purpose: ticketPurpose },
            ticketSecret(),
            { expiresIn: TICKET_TTL },
        );
        return { ticket, maskedPhone: maskPhone(phone), ...exposeOtp(otp) };
    };

    const sellerFromTicket = async (ticket, email) => {
        let claims;
        try {
            claims = jwt.verify(String(ticket || ''), ticketSecret());
        } catch {
            throw new AuthError(WEB_SESSION_EXPIRED);
        }
        if (claims?.purpose !== ticketPurpose || !mongoose.Types.ObjectId.isValid(claims.rid)) {
            throw new AuthError(WEB_SESSION_EXPIRED);
        }
        const seller = await Model.findById(claims.rid);
        if (!seller || String(seller.ownerEmail || '').trim().toLowerCase() !== email) {
            throw new AuthError(WEB_SESSION_EXPIRED);
        }
        return seller;
    };

    /** Resend needs only the ticket: the password was already proved in step 1. */
    const resendOtp = async (ticket, email) => {
        const seller = await sellerFromTicket(ticket, email);
        const phone = sellerPhone(seller);
        const otp = await sendOtp(phone);
        return { maskedPhone: maskPhone(phone), ...exposeOtp(otp) };
    };

    /** Step 2. Returns the seller document and its phone once the OTP checks out. */
    const verify = async (ticket, email, otp) => {
        const seller = await sellerFromTicket(ticket, email);
        const phone = sellerPhone(seller);
        const result = await verifyOtp(phone, otp, otpScope);
        if (!result.valid) {
            throw new AuthError(result.reason || 'OTP verification failed');
        }
        return { seller, phone };
    };

    return { requestOtp, issueTicket, resendOtp, verify };
};
