/**
 * Partner sign-up for stores: one phone check that says where the partner
 * stands, then the application.
 *
 * Seller login refuses a pending or rejected seller outright, after the OTP has
 * already been used up, so nothing could tell a partner WHY they were refused
 * or let a rejected store fix its application. This path verifies the OTP
 * once and returns the state instead:
 *
 *   new       no seller on this number        -> fill in the application
 *   pending   applied, waiting for review     -> see what is still missing, update it
 *   rejected  turned down, with a reason      -> fix and resubmit
 *   approved  live                            -> signed in as normal
 *
 * Every state except approved gets an ONBOARDING token instead of a session.
 * It is signed with a secret derived from, but different to, the access-token
 * secret, so it cannot be presented anywhere a seller session is accepted --
 * it opens the application endpoints below and nothing else. The phone number
 * inside it is the one the OTP proved, which is why the application never
 * trusts a phone number from the request body.
 */
import jwt from 'jsonwebtoken';
import { config } from '../../../config/env.js';
import { ValidationError, AuthError } from '../../../core/auth/errors.js';
import { verifyOtp } from '../../../../../core/otp/otp.service.js';
import { FoodRestaurant } from '../restaurant/models/restaurant.model.js';
import {
    requestRestaurantOtp,
    findRestaurantByPhone,
    issueRestaurantSession,
} from '../../../core/auth/auth.service.js';
import {
    normalizePartnerType,
    partnerStateOf,
    evaluateApplication,
} from '../shared/partnerOnboarding.js';

const ONBOARDING_TTL = '6h';
const onboardingSecret = () => `${config.jwtAccessSecret}:partner-onboarding`;

const last10Of = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

export const signOnboardingToken = ({ phone, type }) => jwt.sign(
    { purpose: 'partner_onboarding', phone: last10Of(phone), type },
    onboardingSecret(),
    { expiresIn: ONBOARDING_TTL },
);

export function readOnboardingToken(token) {
    try {
        const decoded = jwt.verify(String(token || ''), onboardingSecret());
        if (decoded?.purpose !== 'partner_onboarding' || !decoded.phone) throw new Error('wrong purpose');
        return { phone: decoded.phone, type: normalizePartnerType(decoded.type) };
    } catch {
        throw new AuthError('Your sign-up session has expired. Verify your phone number again.');
    }
}

const typeOrThrow = (raw) => {
    const type = normalizePartnerType(raw);
    if (!type) throw new ValidationError('Choose Restaurant or Store.');
    if (type === 'restaurant') {
        throw new ValidationError('Restaurants sign up through the restaurant partner login.');
    }
    return type;
};

// ------------------------------------------------------------------ phone ---

export async function requestPartnerOtp({ phone, type }) {
    typeOrThrow(type);
    if (last10Of(phone).length !== 10) throw new ValidationError('Enter a valid 10-digit mobile number.');
    return requestRestaurantOtp(phone);
}

/** What the partner sees about their own application, for the form and status page. */
export function describeApplication(seller, type) {
    const s = seller ? (seller.toObject ? seller.toObject() : seller) : null;
    const checklist = evaluateApplication(type, s || {});
    if (!s) return { application: null, checklist };

    const loc = s.location || {};
    const coords = Array.isArray(loc.coordinates) ? loc.coordinates : [];
    return {
        application: {
            id: String(s._id),
            status: s.status,
            rejectionReason: s.status === 'rejected' ? (s.rejectionReason || '') : '',
            submittedAt: s.applicationSubmittedAt || s.createdAt || null,
            storeType: s.storeType,
            restaurantName: s.restaurantName || '',
            ownerName: s.ownerName || '',
            ownerEmail: s.ownerEmail || '',
            ownerPhone: s.ownerPhone || '',
            addressLine1: loc.addressLine1 || '',
            addressLine2: loc.addressLine2 || '',
            area: loc.area || '',
            city: loc.city || '',
            state: loc.state || '',
            pincode: loc.pincode || '',
            landmark: loc.landmark || '',
            formattedAddress: loc.formattedAddress || '',
            latitude: coords.length === 2 ? coords[1] : null,
            longitude: coords.length === 2 ? coords[0] : null,
            panNumber: s.panNumber || '',
            nameOnPan: s.nameOnPan || '',
            panImage: s.panImage || '',
            gstRegistered: s.gstRegistered === true,
            gstNumber: s.gstNumber || '',
            gstImage: s.gstImage || '',
            fssaiNumber: s.fssaiNumber || '',
            fssaiImage: s.fssaiImage || '',
            businessRegistrationImage: s.businessRegistrationImage || '',
            storeFrontImage: s.storePhotos?.front || '',
            storeInsideImage: s.storePhotos?.inside || '',
            storeSignboardImage: s.storePhotos?.signboard || '',
            accountHolderName: s.accountHolderName || '',
            accountNumber: s.accountNumber || '',
            ifscCode: s.ifscCode || '',
            upiId: s.upiId || '',
        },
        checklist,
    };
}

export async function verifyPartnerOtp({ phone, otp, type: rawType }) {
    const type = typeOrThrow(rawType);
    const result = await verifyOtp(phone, otp, 'qc:restaurant');
    if (!result.valid) throw new AuthError(result.reason || 'That code is not right. Try again.');

    const seller = await findRestaurantByPhone(phone);
    const state = partnerStateOf(seller);

    const base = {
        state,
        type,
        phone: last10Of(phone),
        ...describeApplication(seller, type),
    };

    if (state === 'approved') {
        return { ...base, session: await issueRestaurantSession(seller) };
    }
    return { ...base, onboardingToken: signOnboardingToken({ phone, type }) };
}

// ------------------------------------------------------------ application ---

export async function getMyApplication(token) {
    const { phone, type } = readOnboardingToken(token);
    const seller = await findRestaurantByPhone(phone);
    return { state: partnerStateOf(seller), type, phone, ...describeApplication(seller, type) };
}

/** Upload one document or photo (image or PDF) for an application. */
export async function uploadPartnerDocument(token, file) {
    readOnboardingToken(token);
    if (!file) throw new ValidationError('Choose a file to upload.');
    const { saveDocumentFile } = await import('../../../../../services/storage.service.js');
    const stored = await saveDocumentFile(file, 'qc/partners');
    return { url: stored.url };
}

const str = (v) => (v === undefined || v === null ? undefined : String(v).trim());

/**
 * Fields an applicant may set on a pending or rejected application, mapped to
 * where they are stored. Status, commission, zone and anything an admin owns
 * are deliberately absent.
 */
function applicationUpdate(body = {}) {
    const set = {};
    const map = {
        restaurantName: 'restaurantName',
        ownerName: 'ownerName',
        ownerEmail: 'ownerEmail',
        panNumber: 'panNumber',
        nameOnPan: 'nameOnPan',
        panImage: 'panImage',
        gstNumber: 'gstNumber',
        gstImage: 'gstImage',
        fssaiNumber: 'fssaiNumber',
        fssaiImage: 'fssaiImage',
        businessRegistrationImage: 'businessRegistrationImage',
        storeFrontImage: 'storePhotos.front',
        storeInsideImage: 'storePhotos.inside',
        storeSignboardImage: 'storePhotos.signboard',
        accountHolderName: 'accountHolderName',
        accountNumber: 'accountNumber',
        ifscCode: 'ifscCode',
        upiId: 'upiId',
        addressLine1: 'location.addressLine1',
        addressLine2: 'location.addressLine2',
        area: 'location.area',
        city: 'location.city',
        state: 'location.state',
        pincode: 'location.pincode',
        landmark: 'location.landmark',
        formattedAddress: 'location.formattedAddress',
    };
    for (const [from, to] of Object.entries(map)) {
        const value = str(body[from]);
        if (value !== undefined) set[to] = from === 'panNumber' || from === 'ifscCode' ? value.toUpperCase() : value;
    }
    if (body.gstRegistered !== undefined) {
        set.gstRegistered = body.gstRegistered === true || body.gstRegistered === 'true';
    }
    const lat = Number(body.latitude);
    const lng = Number(body.longitude);
    if (body.latitude !== undefined && body.longitude !== undefined) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new ValidationError('Pick the store location on the map.');
        }
        set['location.type'] = 'Point';
        set['location.coordinates'] = [lng, lat];
        set['location.latitude'] = lat;
        set['location.longitude'] = lng;
    }
    return set;
}

/**
 * Submit a new application, or update / resubmit a pending or rejected one.
 * The phone number always comes from the token.
 */
export async function submitApplication(token, body = {}) {
    const { phone } = readOnboardingToken(token);
    const seller = await findRestaurantByPhone(phone);

    if (!seller) {
        const { validateRestaurantRegisterDto } = await import('../restaurant/validators/restaurant.validator.js');
        const { registerRestaurant } = await import('../restaurant/services/restaurant.service.js');
        const flat = Object.fromEntries(
            Object.entries(body).map(([k, v]) => [k, v === null || v === undefined ? undefined : typeof v === 'string' ? v : String(v)]),
        );
        const validated = validateRestaurantRegisterDto({
            pureVegRestaurant: 'false',
            ...flat,
            ownerPhone: phone,
            primaryContactNumber: phone,
            // A new seller cannot be a (legacy) pharmacy.
            storeType: flat.storeType === 'pharmacy' ? 'grocery' : (flat.storeType || 'grocery'),
        });
        await registerRestaurant(validated, {});
        return getMyApplication(token);
    }

    if (seller.status === 'approved') {
        throw new ValidationError('This store is already approved. Update its details from the partner app.');
    }

    const set = applicationUpdate(body);

    await FoodRestaurant.updateOne(
        { _id: seller._id },
        {
            $set: { ...set, status: 'pending', applicationSubmittedAt: new Date() },
            $unset: { rejectionReason: 1, rejectedAt: 1 },
        },
    );
    return getMyApplication(token);
}
