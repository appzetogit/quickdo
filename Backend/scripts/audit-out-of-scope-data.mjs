/**
 * Read-only: how much live data do the features we are removing still hold?
 *
 * SOW_IMPLEMENTATION_PLAN.md §1 removes bus, pooling, rental, ride insurance,
 * dining, parcel, medical and fleet owners. The code goes; the collections stay
 * (they are archived and dropped much later, as a separate decision). Before a
 * removal ships, this says what would be orphaned, so a feature with real
 * customers or money in it gets a sign-off first instead of disappearing.
 *
 * Writes nothing. Prints counts only -- never documents, never credentials.
 *
 *   node scripts/audit-out-of-scope-data.mjs
 *   node scripts/audit-out-of-scope-data.mjs --json
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('MONGODB_URI / MONGO_URI is not set'); process.exit(1); }
const asJson = process.argv.includes('--json');

// Model names as they were registered, before the code was removed. Models with
// no explicit collection get mongoose's default name (lowercased, pluralised),
// which is what `collectionOf` reproduces.
const FEATURES = {
    bus: { models: ['TaxiBusService', 'TaxiBusDriver', 'TaxiBusBooking', 'TaxiBusSeatHold'] },
    pooling: {
        models: ['TaxiInstantPoolGroup', 'TaxiPoolingBooking', 'TaxiPoolingRoute', 'TaxiPoolingSeatReservation', 'TaxiPoolingVehicle'],
        refs: [{ model: 'TaxiRide', label: 'rides in a pool group', filter: { poolGroupId: { $ne: null } } }],
    },
    rental: { models: ['TaxiRentalBookingRequest', 'TaxiRentalPackageType', 'TaxiRentalQuoteRequest', 'TaxiRentalVehicleType'] },
    rideInsurance: {
        models: ['TaxiRideInsurancePlan'],
        refs: [{ model: 'TaxiRide', label: 'rides that charged insurance', filter: { insurance_fee: { $gt: 0 } } }],
    },
    dining: {
        models: ['FoodDiningCategory', 'FoodDiningRestaurant', 'FoodDiningBanner'],
        collections: ['qc_dining_categories', 'qc_dining_restaurants', 'qc_dining_banners'],
    },
    parcel: {
        models: [],
        refs: [{ model: 'TaxiRide', label: 'parcel rides', filter: { serviceType: 'parcel' } }],
    },
    medical: {
        models: [],
        collections: ['qc_medical_settings', 'medical_zones'],
        refs: [{ collection: 'qc_orders', label: 'prescription orders', filter: { prescriptionOnly: true } }],
    },
    fleetOwners: {
        models: ['TaxiOwner', 'TaxiOwnerBooking', 'TaxiOwnerNeededDocument', 'TaxiOwnerWalletTransaction', 'TaxiFleetVehicle'],
        refs: [{ model: 'TaxiDriver', label: 'drivers attached to an owner', filter: { owner_id: { $ne: null } } }],
    },
    intercity: {
        models: [],
        refs: [{ model: 'TaxiRide', label: 'intercity rides', filter: { serviceType: 'intercity' } }],
    },
};

const collectionOf = (modelName) => mongoose.pluralize()(modelName);

const safe = uri.replace(/\/\/[^@]*@/, '//<redacted>@');
await mongoose.connect(uri);
const db = mongoose.connection.db;
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

const count = async (name, filter = {}) => (existing.has(name) ? db.collection(name).countDocuments(filter) : null);

const report = { uri: safe, database: db.databaseName, features: {} };
for (const [feature, spec] of Object.entries(FEATURES)) {
    const names = [...(spec.models || []).map(collectionOf), ...(spec.collections || [])];
    const collections = {};
    for (const name of names) collections[name] = await count(name);
    const refs = {};
    for (const ref of spec.refs || []) {
        refs[ref.label] = await count(ref.collection || collectionOf(ref.model), ref.filter);
    }
    const total = [...Object.values(collections), ...Object.values(refs)].reduce((a, n) => a + (n || 0), 0);
    report.features[feature] = { total, collections, refs };
}
await mongoose.disconnect();

if (asJson) {
    console.log(JSON.stringify(report, null, 2));
} else {
    console.log(`URI: ${report.uri}\nDB:  ${report.database}\n`);
    for (const [feature, r] of Object.entries(report.features)) {
        console.log(`${r.total ? '!!' : 'ok'}  ${feature.padEnd(14)} ${r.total} document(s)`);
        for (const [name, n] of [...Object.entries(r.collections), ...Object.entries(r.refs)]) {
            console.log(`      ${String(n ?? '-').padStart(7)}  ${name}`);
        }
    }
    console.log('\n"!!" = live data. Get a sign-off and an archive (deploy/backup.sh) before that removal ships.');
    console.log('"-"  = collection does not exist.');
}
