import { FoodBusinessSettings } from '../models/businessSettings.model.js';
import { overlayBusinessSettings, syncManagedFromLegacy } from '../../../../../../core/settings/platformProfile.service.js';
import { sendResponse } from '../../../../utils/response.js';
import { uploadImageBufferDetailed } from '../../../../services/cloudinary.service.js';

/** The web-config keys the admin panel may write. Anything else is ignored. */
const FIREBASE_WEB_FIELDS = [
    'apiKey', 'authDomain', 'projectId', 'storageBucket',
    'messagingSenderId', 'appId', 'measurementId', 'databaseURL', 'vapidKey'
];

/**
 * What the panel is told about the stored service account.
 *
 * Deliberately never the credential itself -- only enough to answer "is one
 * saved, and is it the project I think it is". Returning the private key so the
 * form could pre-fill it would put a push-and-database credential into every
 * admin's browser and every proxy log in between, to save retyping something
 * that is only ever replaced wholesale.
 */
const describeServiceAccount = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return { configured: false };

    try {
        const parsed = JSON.parse(value);
        return {
            configured: true,
            projectId: parsed.project_id || '',
            clientEmail: parsed.client_email || '',
            privateKeyId: parsed.private_key_id ? `…${String(parsed.private_key_id).slice(-6)}` : ''
        };
    } catch {
        // Stored but unparseable: say so rather than reporting it as working,
        // because push will fail at send time and the admin needs to know why.
        return { configured: true, invalid: true };
    }
};

const POWER_SCANNING_DEFAULT = {
    user: { themeColor: '#FA0272', fontFamily: 'Poppins' },
    restaurant: { themeColor: '#2563EB', fontFamily: 'Poppins' },
    delivery: { themeColor: '#00B761', fontFamily: 'Poppins' }
};

const POWER_SCANNING_FONT_OPTIONS = [
    'Poppins', 'Outfit', 'Inter', 'Roboto', 'Montserrat',
    'Nunito', 'Open Sans', 'Lato', 'Manrope', 'Raleway',
    'Merriweather', 'Playfair Display', 'Ubuntu', 'Rubik', 'Work Sans'
];

const normalizeHexColor = (value, fallback) => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : fallback;
};

const normalizeFontFamily = (value, fallback) => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    return POWER_SCANNING_FONT_OPTIONS.includes(raw) ? raw : fallback;
};

const normalizeOrderAcceptanceMinutes = (value, fallback = 4) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(1, Math.min(20, Math.round(numeric)));
};

const buildPowerScanningPayload = (payload = {}, existing = POWER_SCANNING_DEFAULT) => ({
    user: {
        themeColor: normalizeHexColor(payload?.user?.themeColor, existing?.user?.themeColor || POWER_SCANNING_DEFAULT.user.themeColor),
        fontFamily: normalizeFontFamily(payload?.user?.fontFamily, existing?.user?.fontFamily || POWER_SCANNING_DEFAULT.user.fontFamily)
    },
    restaurant: {
        themeColor: normalizeHexColor(payload?.restaurant?.themeColor, existing?.restaurant?.themeColor || POWER_SCANNING_DEFAULT.restaurant.themeColor),
        fontFamily: normalizeFontFamily(payload?.restaurant?.fontFamily, existing?.restaurant?.fontFamily || POWER_SCANNING_DEFAULT.restaurant.fontFamily)
    },
    delivery: {
        themeColor: normalizeHexColor(payload?.delivery?.themeColor, existing?.delivery?.themeColor || POWER_SCANNING_DEFAULT.delivery.themeColor),
        fontFamily: normalizeFontFamily(payload?.delivery?.fontFamily, existing?.delivery?.fontFamily || POWER_SCANNING_DEFAULT.delivery.fontFamily)
    }
});

const ensurePowerScanningOnSettings = (settingsDocOrPlain = null) => {
    const current = settingsDocOrPlain || {};
    const normalized = buildPowerScanningPayload(
        current?.powerScanning || {},
        current?.powerScanning || POWER_SCANNING_DEFAULT
    );
    return {
        ...current,
        powerScanning: normalized
    };
};

export async function getBusinessSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            // Create default settings if none exist
            settings = await FoodBusinessSettings.create({
                companyName: 'Switcheats',
                email: 'admin@switcheats.com'
            });
        }

        // Backend-side safety: always expose normalized powerScanning in public payload.
        const normalizedPowerScanning = buildPowerScanningPayload(
            settings?.powerScanning || {},
            settings?.powerScanning || POWER_SCANNING_DEFAULT
        );

        // Backfill old docs that might not have powerScanning persisted yet.
        const persistedPowerScanning = settings?.powerScanning || {};
        const wasMissingAnyModule =
            !persistedPowerScanning?.user ||
            !persistedPowerScanning?.restaurant ||
            !persistedPowerScanning?.delivery;
        if (wasMissingAnyModule) {
            settings.powerScanning = normalizedPowerScanning;
            await settings.save();
        }

        const payload = ensurePowerScanningOnSettings(settings.toObject());

        // Admins only. This same handler also serves /business-settings/public,
        // which is unauthenticated -- and while the description holds no secret,
        // the service account's client email names our admin-SDK identity and is
        // nobody's business but the operator's. The public route runs before the
        // admin middleware, so an absent req.user is what distinguishes them.
        //
        // The credential itself is never in `settings`: the schema's
        // `select: false` keeps it out, so this reads it separately and returns
        // only a description. Two steps rather than one is what makes it
        // impossible to accidentally spread the key into the response.
        if (req.user) {
            const withSecret = await FoodBusinessSettings.findById(settings._id)
                .select('+firebaseServiceAccount')
                .lean();
            payload.firebaseServiceAccount = describeServiceAccount(withSecret?.firebaseServiceAccount);
        }

        // Master settings win where set (core/settings/platformProfile.service.js).
        return sendResponse(res, 200, 'Business settings fetched successfully', await overlayBusinessSettings(payload));
    } catch (error) {
        next(error);
    }
}

export async function getPowerScanningSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne().lean();
        if (!settings) {
            settings = await FoodBusinessSettings.create({
                companyName: 'Switcheats',
                email: 'admin@switcheats.com'
            });
        }
        const payload = buildPowerScanningPayload(settings?.powerScanning || {}, settings?.powerScanning || POWER_SCANNING_DEFAULT);
        return sendResponse(res, 200, 'Power scanning settings fetched successfully', payload);
    } catch (error) {
        next(error);
    }
}

export async function updatePowerScanningSettings(req, res, next) {
    try {
        const payload = req.body || {};
        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings({
                companyName: 'Switcheats',
                email: 'admin@switcheats.com'
            });
        }

        settings.powerScanning = buildPowerScanningPayload(payload, settings.powerScanning || POWER_SCANNING_DEFAULT);
        await settings.save();

        return sendResponse(res, 200, 'Power scanning settings updated successfully', settings.powerScanning);
    } catch (error) {
        next(error);
    }
}

export async function getOrderAcceptanceSettings(req, res, next) {
    try {
        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = await FoodBusinessSettings.create({
                companyName: 'Switcheats',
                email: 'admin@switcheats.com'
            });
        }

        const minutes = normalizeOrderAcceptanceMinutes(settings.orderAcceptanceTimeMinutes);
        if (settings.orderAcceptanceTimeMinutes !== minutes) {
            settings.orderAcceptanceTimeMinutes = minutes;
            await settings.save();
        }

        return sendResponse(res, 200, 'Order acceptance settings fetched successfully', {
            orderAcceptanceTimeMinutes: minutes,
            acceptanceWindowSeconds: minutes * 60
        });
    } catch (error) {
        next(error);
    }
}

export async function updateOrderAcceptanceSettings(req, res, next) {
    try {
        const rawMinutes = req.body?.orderAcceptanceTimeMinutes;
        const numeric = Number(rawMinutes);
        if (!Number.isFinite(numeric)) {
            return res.status(400).json({ success: false, message: 'Order acceptance time is required' });
        }

        const minutes = Math.round(numeric);
        if (minutes < 1 || minutes > 20) {
            return res.status(400).json({ success: false, message: 'Order acceptance time must be between 1 and 20 minutes' });
        }

        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings();
        }

        settings.orderAcceptanceTimeMinutes = minutes;
        await settings.save();

        return sendResponse(res, 200, 'Order acceptance settings updated successfully', {
            orderAcceptanceTimeMinutes: minutes,
            acceptanceWindowSeconds: minutes * 60
        });
    } catch (error) {
        next(error);
    }
}

export async function updateBusinessSettings(req, res, next) {
    try {
        const data = req.body.data ? JSON.parse(req.body.data) : {};
        const {
            companyName, email, phoneCountryCode, phoneNumber, address, state, pincode, region,
            googleMapsApiKey, firebase, firebaseServiceAccount
        } = data;

        // Validation
        if (!companyName || companyName.trim().length < 2 || companyName.trim().length > 50) {
            return res.status(400).json({ success: false, message: 'Company name must be between 2 and 50 characters' });
        }
        if (!email || email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid email address (max 100 characters)' });
        }
        if (!phoneNumber || !/^\d{7,15}$/.test(phoneNumber.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid phone number (7-15 digits required)' });
        }
        if (address && address.length > 250) {
            return res.status(400).json({ success: false, message: 'Address is too long (max 250 characters)' });
        }
        if (state && state.length > 50) {
            return res.status(400).json({ success: false, message: 'State name is too long (max 50 characters)' });
        }
        if (pincode && !/^\d{4,10}$/.test(pincode.trim())) {
            return res.status(400).json({ success: false, message: 'Invalid pincode (4-10 digits required)' });
        }

        let settings = await FoodBusinessSettings.findOne();
        if (!settings) {
            settings = new FoodBusinessSettings();
        }

        if (companyName) settings.companyName = companyName;
        if (email) settings.email = email;
        if (phoneCountryCode || phoneNumber) {
            settings.phone = {
                countryCode: phoneCountryCode || settings.phone?.countryCode || '+91',
                number: phoneNumber || settings.phone?.number || ''
            };
        }
        if (address !== undefined) settings.address = address;
        if (state !== undefined) settings.state = state;
        if (pincode !== undefined) settings.pincode = pincode;
        if (region) settings.region = region;
        // Sent empty on purpose means "remove the key", which has to be
        // possible: a leaked key needs revoking here as well as in Google.
        if (googleMapsApiKey !== undefined) {
            settings.googleMapsApiKey = String(googleMapsApiKey || '').trim();
        }

        // Field by field off an allowlist, not a wholesale assign: the panel
        // posts a plain object, and letting it set arbitrary keys on a
        // subdocument is how `firebaseServiceAccount` would end up smuggled into
        // the public half.
        if (firebase && typeof firebase === 'object') {
            for (const key of FIREBASE_WEB_FIELDS) {
                if (firebase[key] !== undefined) {
                    settings.firebase[key] = String(firebase[key] || '').trim();
                }
            }
        }

        // Undefined means the form did not send one, which must leave the stored
        // credential alone -- the panel never receives it, so every ordinary save
        // would otherwise wipe it. Empty string is the explicit "remove it".
        if (firebaseServiceAccount !== undefined) {
            const raw = String(firebaseServiceAccount || '').trim();
            if (raw) {
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    return res.status(400).json({ success: false, message: 'Service account must be valid JSON' });
                }
                // Checked now rather than at 3am when push silently stops: these
                // three are what the FCM signing path actually reads.
                for (const field of ['project_id', 'client_email', 'private_key']) {
                    if (!parsed[field]) {
                        return res.status(400).json({ success: false, message: `Service account JSON is missing "${field}"` });
                    }
                }
                settings.firebaseServiceAccount = JSON.stringify(parsed);
            } else {
                settings.firebaseServiceAccount = '';
            }
        }

        // Handle file uploads
        if (req.files) {
            if (req.files.logo) {
                const logoResult = await uploadImageBufferDetailed(req.files.logo[0].buffer, 'business/logos');
                settings.logo = {
                    url: logoResult.secure_url,
                    publicId: logoResult.public_id
                };
            }
            if (req.files.favicon) {
                const faviconResult = await uploadImageBufferDetailed(req.files.favicon[0].buffer, 'business/favicons');
                settings.favicon = {
                    url: faviconResult.secure_url,
                    publicId: faviconResult.public_id
                };
            }
            if (req.files.restaurantLogo) {
                const restaurantLogoResult = await uploadImageBufferDetailed(req.files.restaurantLogo[0].buffer, 'business/restaurant/logos');
                settings.restaurantLogo = {
                    url: restaurantLogoResult.secure_url,
                    publicId: restaurantLogoResult.public_id
                };
            }
            if (req.files.restaurantFavicon) {
                const restaurantFaviconResult = await uploadImageBufferDetailed(req.files.restaurantFavicon[0].buffer, 'business/restaurant/favicons');
                settings.restaurantFavicon = {
                    url: restaurantFaviconResult.secure_url,
                    publicId: restaurantFaviconResult.public_id
                };
            }
            if (req.files.deliveryLogo) {
                const deliveryLogoResult = await uploadImageBufferDetailed(req.files.deliveryLogo[0].buffer, 'business/delivery/logos');
                settings.deliveryLogo = {
                    url: deliveryLogoResult.secure_url,
                    publicId: deliveryLogoResult.public_id
                };
            }
            if (req.files.deliveryFavicon) {
                const deliveryFaviconResult = await uploadImageBufferDetailed(req.files.deliveryFavicon[0].buffer, 'business/delivery/favicons');
                settings.deliveryFavicon = {
                    url: deliveryFaviconResult.secure_url,
                    publicId: deliveryFaviconResult.public_id
                };
            }
        }

        await settings.save();

        // A saved service account has to reach the running process, or push
        // keeps using the old project until someone restarts and nobody
        // connects the two.
        if (firebaseServiceAccount !== undefined) {
            const { clearCachedServiceAccount } = await import('../../../../core/notifications/firebase.service.js');
            clearCachedServiceAccount();
        }

        // The in-memory doc is now holding the credential we just set, and
        // returning it would hand the key straight back to the browser -- the
        // exact thing `select: false` exists to prevent. Swap it for the same
        // description the GET returns.
        const payload = settings.toObject();
        payload.firebaseServiceAccount = describeServiceAccount(settings.firebaseServiceAccount);

        await syncManagedFromLegacy({ name: companyName, email, phone: phoneNumber, address, state, pincode, logoUrl: settings.logo?.url, faviconUrl: settings.favicon?.url });
        return sendResponse(res, 200, 'Business settings updated successfully', await overlayBusinessSettings(payload));
    } catch (error) {
        next(error);
    }
}
