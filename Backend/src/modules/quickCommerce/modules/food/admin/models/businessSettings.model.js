import mongoose from 'mongoose';

const businessSettingsSchema = new mongoose.Schema(
    {
        companyName: { type: String, required: true, default: 'Switcheats' },
        email: { type: String, required: true, default: 'admin@switcheats.com' },
        phone: {
            countryCode: { type: String, default: '+91' },
            number: { type: String, default: '' }
        },
        address: { type: String, default: '' },
        state: { type: String, default: '' },
        pincode: { type: String, default: '' },
        region: { type: String, default: 'India' },
        logo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        favicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        restaurantLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        restaurantFavicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        deliveryLogo: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        deliveryFavicon: {
            url: { type: String, default: '' },
            publicId: { type: String, default: '' }
        },
        powerScanning: {
            user: {
                themeColor: { type: String, default: '#FA0272' },
                fontFamily: { type: String, default: 'Poppins' }
            },
            restaurant: {
                themeColor: { type: String, default: '#2563EB' },
                fontFamily: { type: String, default: 'Poppins' }
            },
            delivery: {
                themeColor: { type: String, default: '#00B761' },
                fontFamily: { type: String, default: 'Poppins' }
            }
        },
        orderAcceptanceTimeMinutes: { type: Number, default: 4, min: 1, max: 20 },
        /**
         * Google Maps browser key, set once here instead of baked into each
         * build's environment.
         *
         * It is served publicly and that is correct — a Maps browser key is
         * read by the browser and cannot be hidden. What protects it is an
         * HTTP-referrer restriction in the Google Cloud console, not secrecy,
         * so a key pasted here must be restricted to your domains or anyone can
         * spend your quota.
         */
        googleMapsApiKey: { type: String, default: '', trim: true },
        /**
         * Firebase *web* config, set here rather than baked into each build.
         *
         * Every value in this block is public by design: Firebase ships them in
         * the client bundle of every web and mobile app, and they identify the
         * project rather than authorise anything. What guards a Firebase project
         * is its security rules and the API key's referrer/app restrictions, not
         * keeping these strings secret.
         *
         * The service account is emphatically not in here -- see below.
         */
        firebase: {
            apiKey: { type: String, default: '', trim: true },
            authDomain: { type: String, default: '', trim: true },
            projectId: { type: String, default: '', trim: true },
            storageBucket: { type: String, default: '', trim: true },
            messagingSenderId: { type: String, default: '', trim: true },
            appId: { type: String, default: '', trim: true },
            measurementId: { type: String, default: '', trim: true },
            databaseURL: { type: String, default: '', trim: true },
            /** Public half of the VAPID pair. The private half stays with Google. */
            vapidKey: { type: String, default: '', trim: true }
        },
        /**
         * Firebase service account JSON: a server credential that can send push
         * to every device and read the whole database.
         *
         * `select: false` is the point of this field rather than a detail. The
         * public settings endpoint serves findOne() unprojected, so any ordinary
         * field added here becomes world-readable the moment it is written.
         * Excluding it at the schema level means it cannot leak through a call
         * site somebody forgot to project -- it has to be asked for by name,
         * which only the notification service and the admin save path do.
         */
        firebaseServiceAccount: { type: String, default: '', select: false }
    },
    { timestamps: true }
);

export const FoodBusinessSettings = mongoose.models.QCBusinessSettings || mongoose.model('QCBusinessSettings', businessSettingsSchema, 'qc_business_settingses');
