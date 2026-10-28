import { Vehicle } from '../../../taxi/admin/models/Vehicle.js';
import { DriverNeededDocument } from '../../../taxi/admin/models/DriverNeededDocument.js';
import {
    DRIVER_CLASSES,
    DRIVER_INTENTS,
    documentAppliesTo,
    normalizeDriverClass,
    normalizeDriverIntents,
    vehicleIconTypesFor,
} from '../../../taxi/shared/driverClasses.js';

/**
 * What the registration screen has to ask THIS driver for.
 *
 * The delivery app used to ship a fixed list of four vehicle types and four
 * documents, identical for everyone. A car driver was offered "bicycle", a
 * parcel driver was never offered a truck, and nobody could be asked for a
 * commercial badge without a new app release.
 *
 * Both lists are admin data: the vehicle catalogue and the needed-document
 * catalogue, filtered by what the driver said they have. Adding an "EV Scooty"
 * or a "Goods permit" in the panel reaches the next applicant with no release.
 */

const iconKey = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');

const serializeVehicle = (vehicle) => ({
    id: String(vehicle._id),
    name: vehicle.name || '',
    iconType: vehicle.icon_types || '',
    transportType: vehicle.transport_type || '',
    image: vehicle.image || vehicle.map_icon || '',
    capacity: Number(vehicle.capacity || 0),
});

const serializeDocument = (doc) => ({
    id: String(doc._id),
    name: doc.name || '',
    /*
     * What the app names this document's uploads by (doc_<key>_front). The
     * admin form sets field_key only on vehicle fields, never on documents, so
     * every document went out keyed '' -- and nothing the admin added to the
     * catalogue could be uploaded, because doc__front matches no document.
     * The slug is unique and always present, so it is the key when none is set.
     */
    key: doc.field_key || doc.slug || '',
    /** 'single' or 'double' — whether a back image is wanted too. */
    imageType: doc.image_type || 'single',
    fieldType: doc.field_type || 'text',
    placeholder: doc.placeholder || '',
    helpText: doc.help_text || '',
    sortOrder: Number(doc.sort_order || 0),
    isRequired: doc.is_required !== false,
    appliesTo: Array.isArray(doc.applies_to) ? doc.applies_to : [],
});

/**
 * The choices on offer, as data, so the app does not hardcode the tree.
 *
 * Labels live with the rule in `driverClasses.js`; this hands them over.
 */
export const listOnboardingOptions = () => ({
    classes: [
        {
            key: DRIVER_CLASSES.TWO_WHEELER,
            label: 'I have a 2 Wheeler',
            // Pick one option (radio) or several (tick-boxes).
            singleChoice: true,
            intents: Object.entries(DRIVER_INTENTS)
                .filter(([, v]) => v.driverClass === DRIVER_CLASSES.TWO_WHEELER)
                .map(([key, v]) => ({ key, label: v.label })),
        },
        {
            key: DRIVER_CLASSES.PASSENGER_TAXI,
            label: 'Taxi for passenger delivery',
            // Pick one option (radio) or several (tick-boxes).
            singleChoice: true,
            intents: Object.entries(DRIVER_INTENTS)
                .filter(([, v]) => v.driverClass === DRIVER_CLASSES.PASSENGER_TAXI)
                .map(([key, v]) => ({ key, label: v.label })),
        },
        {
            key: DRIVER_CLASSES.PARCEL_VEHICLE,
            label: 'Vehicle for parcel delivery',
            // Pick one option (radio) or several (tick-boxes).
            singleChoice: false,
            intents: Object.entries(DRIVER_INTENTS)
                .filter(([, v]) => v.driverClass === DRIVER_CLASSES.PARCEL_VEHICLE)
                .map(([key, v]) => ({ key, label: v.label })),
        },
    ],
});

/**
 * The vehicle types and documents for one class + set of intents.
 *
 * A class that matches no vehicle in the catalogue returns an empty list rather
 * than the whole fleet: offering a bike rider a truck because nothing matched
 * is worse than offering nothing and saying so.
 */
export const getOnboardingRequirements = async ({ driverClass, intents } = {}) => {
    const cls = normalizeDriverClass(driverClass);
    const chosen = normalizeDriverIntents(intents, cls);
    const wantedIcons = new Set(vehicleIconTypesFor({ driverClass: cls, intents: chosen }).map(iconKey));

    const [vehicles, documents] = await Promise.all([
        // `status` on a vehicle is a NUMBER (1 active, 0 not), kept in step with
        // the `active` boolean by a pre-save hook. Filtering it against the
        // string 'inactive' is a cast error, not an empty result.
        Vehicle.find({ status: { $ne: 0 } })
            .select('name icon_types transport_type image map_icon capacity')
            .lean(),
        // Documents only. The same collection also holds `vehicle_field` rows —
        // Operating City, Brand / Make, Year — which are text fields on the
        // vehicle, not papers anyone uploads. Returning them as documents asked
        // the applicant to photograph their car's model year.
        DriverNeededDocument.find({ active: true, template_type: 'document' })
            .select('name slug field_key image_type field_type placeholder help_text sort_order applies_to is_required')
            .sort({ sort_order: 1, name: 1 })
            .lean(),
    ]);

    const offered = wantedIcons.size
        ? vehicles.filter((v) => wantedIcons.has(iconKey(v.icon_types)))
        : [];

    return {
        driverClass: cls || '',
        intents: chosen,
        vehicleTypes: offered.map(serializeVehicle),
        documents: documents.filter((doc) => documentAppliesTo(doc, cls)).map(serializeDocument),
    };
};
