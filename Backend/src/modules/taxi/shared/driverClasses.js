/**
 * What a driver signs up to drive, and what that entitles them to.
 *
 * Onboarding asks one question first -- "what do you have?" -- and everything
 * downstream follows from the answer: which sub-options they are offered, which
 * vehicle types they may pick, which documents they must upload, and which job
 * streams they can be approved for.
 *
 * Kept as data in one module rather than as conditionals in five, because the
 * delivery app, the admin panel and the dispatcher all have to agree on it. A
 * fifth copy of "a bike can do food" is how they stop agreeing.
 */

/** What the driver owns. The first question onboarding asks. */
export const DRIVER_CLASSES = Object.freeze({
    TWO_WHEELER: 'two_wheeler',
    PASSENGER_TAXI: 'passenger_taxi',
});

export const DRIVER_CLASS_LIST = Object.freeze(Object.values(DRIVER_CLASSES));

/**
 * The capability a driver must hold to be sent each kind of job.
 *
 * Parcel delivery was removed (not in the SOW), and with it the `parcel`
 * capability and the parcel-vehicle class. Drivers already on file keep the
 * stored values; nothing grants them any more.
 */
export const SERVICE_CAPABILITIES = Object.freeze({
    TAXI: 'taxi',
    DELIVERY: 'delivery',
    QUICK_COMMERCE: 'quickCommerce',
});

/**
 * The sub-options under each class -- the tick-boxes the driver actually
 * chooses between -- and what each one grants.
 *
 * `capabilities` is what the ADMIN may grant on approval, not what the driver
 * gets by asking. Nothing here approves anybody.
 */
export const DRIVER_INTENTS = Object.freeze({
    // ---- I have a 2 wheeler -------------------------------------------------
    // A two-wheeler rider picks ONE of these two (see oneTwoWheelerIntent).
    // Bike Taxi is passengers only, a commercial registration of its own
    // (client, 2026-10-01). Keys unchanged for riders already on file (the
    // `_parcel` suffix is historical; parcel delivery was removed).
    food_daily_medical_parcel: {
        driverClass: DRIVER_CLASSES.TWO_WHEELER,
        label: 'Food + Daily needs + Medical',
        capabilities: [
            SERVICE_CAPABILITIES.DELIVERY,
            SERVICE_CAPABILITIES.QUICK_COMMERCE,
        ],
    },
    bike_taxi_parcel: {
        driverClass: DRIVER_CLASSES.TWO_WHEELER,
        label: 'Bike Taxi',
        capabilities: [SERVICE_CAPABILITIES.TAXI],
    },

    // ---- I have a taxi for passengers --------------------------------------
    three_wheeler: {
        driverClass: DRIVER_CLASSES.PASSENGER_TAXI,
        label: 'I have a 3 wheeler',
        capabilities: [SERVICE_CAPABILITIES.TAXI],
    },
    four_wheeler: {
        driverClass: DRIVER_CLASSES.PASSENGER_TAXI,
        label: 'I have a 4 wheeler',
        capabilities: [SERVICE_CAPABILITIES.TAXI],
    },
});

export const DRIVER_INTENT_LIST = Object.freeze(Object.keys(DRIVER_INTENTS));

/**
 * Which vehicle types a class may choose from, as `icon_types` on the vehicle
 * catalogue.
 *
 * Matched against the catalogue rather than hardcoding names, so adding an "EV
 * Scooty" in the admin panel offers it to two-wheeler drivers with no release.
 * A vehicle whose icon type is not listed anywhere is offered to nobody, which
 * is the safe direction: an unclassified vehicle must not turn up under
 * "4 wheeler".
 */
export const CLASS_VEHICLE_ICON_TYPES = Object.freeze({
    [DRIVER_CLASSES.TWO_WHEELER]: ['bike', 'scooty', 'scooter', 'ev_bike', 'evbike', 'motorcycle'],
    [DRIVER_CLASSES.PASSENGER_TAXI]: ['auto', 'car', 'sedan', 'suv', 'hatchback', 'xl'],
});

/** The narrower list, once a passenger driver has said 3 or 4 wheels. */
export const INTENT_VEHICLE_ICON_TYPES = Object.freeze({
    three_wheeler: ['auto'],
    four_wheeler: ['car', 'sedan', 'suv', 'hatchback', 'xl'],
});

const asArray = (value) => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

const clean = (value) => String(value || '').trim().toLowerCase();

/** The class, or null when the value is not one of ours. */
export const normalizeDriverClass = (value) => {
    const raw = clean(value);
    return DRIVER_CLASS_LIST.includes(raw) ? raw : null;
};

/**
 * The intents a driver actually chose, filtered to the ones that belong to
 * their class.
 *
 * Cross-class picks are dropped rather than rejected: a client that sends
 * "four_wheeler" alongside "I have a 2 wheeler" is confused, and silently
 * ignoring the impossible half is kinder than refusing the registration.
 */
export const normalizeDriverIntents = (value, driverClass = null) => {
    const wanted = normalizeDriverClass(driverClass);
    const seen = new Set();
    const out = [];

    for (const item of asArray(value)) {
        const key = clean(item);
        const intent = DRIVER_INTENTS[key];
        if (!intent || seen.has(key)) continue;
        if (wanted && intent.driverClass !== wanted) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
};

/**
 * The two 2-wheeler options are one choice, not two: keep the first picked.
 * Applied when a rider registers; riders already on file are left as they are.
 */
const TWO_WHEELER_INTENTS = ['food_daily_medical_parcel', 'bike_taxi_parcel'];
export const oneTwoWheelerIntent = (intents = []) => {
    let seen = false;
    return intents.filter((key) => {
        if (!TWO_WHEELER_INTENTS.includes(key)) return true;
        if (seen) return false;
        seen = true;
        return true;
    });
};

/**
 * What the admin could grant for these intents.
 *
 * The union, deduplicated. Used to pre-tick the approval screen -- the admin
 * still decides.
 */
export const capabilitiesForIntents = (intents = []) => {
    const out = new Set();
    for (const key of normalizeDriverIntents(intents)) {
        for (const capability of DRIVER_INTENTS[key].capabilities) out.add(capability);
    }
    return [...out];
};

/** The class implied by a set of intents, when they agree on one. */
export const classForIntents = (intents = []) => {
    const classes = new Set(
        normalizeDriverIntents(intents).map((key) => DRIVER_INTENTS[key].driverClass),
    );
    return classes.size === 1 ? [...classes][0] : null;
};

/**
 * The vehicle icon types a driver may choose from.
 *
 * Narrowed by intent where the intent is narrower than the class: a passenger
 * driver who said "3 wheeler" is offered autos, not every car in the catalogue.
 */
export const vehicleIconTypesFor = ({ driverClass, intents = [] } = {}) => {
    const chosen = normalizeDriverIntents(intents, driverClass);
    const narrowed = new Set();
    for (const key of chosen) {
        for (const icon of INTENT_VEHICLE_ICON_TYPES[key] || []) narrowed.add(icon);
    }
    if (narrowed.size) return [...narrowed];

    const cls = normalizeDriverClass(driverClass) || classForIntents(chosen);
    return cls ? [...CLASS_VEHICLE_ICON_TYPES[cls]] : [];
};

/**
 * Does a document apply to this driver?
 *
 * A document with no classes set applies to everyone, which is what every
 * document in the catalogue means today -- they predate this field, and
 * treating "unset" as "nobody" would empty the upload list on the day this
 * ships.
 */
export const documentAppliesTo = (document, driverClass) => {
    const applies = asArray(document?.applies_to).map(clean).filter(Boolean);
    if (!applies.length) return true;
    const cls = normalizeDriverClass(driverClass);
    return cls ? applies.includes(cls) : true;
};
