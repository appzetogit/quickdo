/**
 * Demo pharmacies, so the medical flow has somebody to send a prescription to.
 *
 * Run:  node scripts/seed-medical-stores.js
 *       node scripts/seed-medical-stores.js --remove
 *
 * A prescription broadcast is only worth looking at when several shops are in
 * range and one is not, so these are placed at deliberate distances from each
 * zone's centre: a cluster inside the default 5 km, and one beyond it. Widening
 * the range in the admin panel then visibly pulls the far one in, which is the
 * one thing about that setting worth being able to demonstrate.
 *
 * Every row is marked by its owner email ending in `.seed@quickdrop.test`, and
 * nothing else on the platform uses that suffix. That is what --remove matches,
 * and it is the only thing that separates these from a real pharmacy, so do not
 * reuse the suffix for anything an operator typed.
 *
 * These are APPROVED and ACCEPTING ORDERS, because a pharmacy that is neither
 * is invisible to the flow they exist to exercise. That means a real customer
 * can send a real prescription to a shop that does not exist and will never
 * answer -- fine on a platform still being fitted out, and the reason --remove
 * exists. Take them out before you have customers who can find them.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const SEED_SUFFIX = '.seed@quickdrop.test';

/** Metres are easier to reason about than degrees when placing a shop. */
const offsetKm = (lat, lng, northKm, eastKm) => ({
    lat: Number((lat + northKm / 111).toFixed(6)),
    lng: Number((lng + eastKm / (111 * Math.cos((lat * Math.PI) / 180))).toFixed(6)),
});

/**
 * Zone centres, matched by name so a re-seed follows the zone rather than a
 * stored id. A zone that is not there is skipped, not invented: an invented one
 * would put shops somewhere the platform does not deliver.
 */
const PLACES = [
    {
        zone: /nagpur/i,
        city: 'Nagpur',
        state: 'Maharashtra',
        licencePrefix: 'MH-NAG-20B',
        shops: [
            { name: 'Sitabuldi Medical Stores', owner: 'Ravi Deshmukh', area: 'Sitabuldi', north: 0.3, east: 0.2 },
            { name: 'Apollo Chemist Dharampeth', owner: 'Sneha Joshi', area: 'Dharampeth', north: -0.9, east: 0.8 },
            { name: 'LifeCare Pharmacy', owner: 'Imran Shaikh', area: 'Sadar', north: 2.1, east: -1.1 },
            { name: 'Wellness Forever Medicals', owner: 'Priya Nair', area: 'Ramdaspeth', north: -3.4, east: -2.2 },
            // Deliberately outside the default 5 km, to prove the range setting
            // is doing something.
            { name: 'Hingna Road Drug House', owner: 'Manoj Patil', area: 'Hingna Road', north: -7.5, east: -4.0 },
        ],
    },
    {
        zone: /indore/i,
        city: 'Indore',
        state: 'Madhya Pradesh',
        licencePrefix: 'MP-IND-20B',
        shops: [
            { name: 'Vijay Nagar Medicos', owner: 'Ashok Verma', area: 'Vijay Nagar', north: 0.5, east: 0.4 },
            { name: 'Palasia Chemist & Druggist', owner: 'Rekha Sharma', area: 'Palasia', north: -1.6, east: 1.3 },
            { name: 'Sudama Nagar Pharmacy', owner: 'Farhan Qureshi', area: 'Sudama Nagar', north: -3.2, east: -2.4 },
        ],
    },
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const run = async () => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    await mongoose.connect(uri);

    const base = '../src/modules/quickCommerce/modules/food';
    const { FoodRestaurant } = await import(`${base}/restaurant/models/restaurant.model.js`);
    const { FoodZone } = await import(`${base}/admin/models/zone.model.js`);

    const removing = process.argv.includes('--remove');
    if (removing) {
        const doomed = await FoodRestaurant.find({ ownerEmail: { $regex: `${SEED_SUFFIX}$` } })
            .select('_id restaurantName').lean();
        if (!doomed.length) {
            console.log('Nothing to remove: no seeded pharmacies found.');
        } else {
            for (const row of doomed) console.log(`  removing ${row.restaurantName}`);
            const res = await FoodRestaurant.deleteMany({ ownerEmail: { $regex: `${SEED_SUFFIX}$` } });
            console.log(`Removed ${res.deletedCount} seeded pharmacies.`);
        }
        await mongoose.disconnect();
        return;
    }

    const zones = await FoodZone.find({ isActive: true }).lean();
    // A licence that is already expiring is a different test; these are current.
    const expiry = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000);
    let phoneSeq = 9800000200;
    let created = 0;
    let updated = 0;

    for (const place of PLACES) {
        const zone = zones.find((z) => place.zone.test(String(z.name || z.zoneName || '')));
        if (!zone) {
            console.log(`! no active zone matching ${place.zone} -- skipping ${place.city}`);
            continue;
        }
        const lats = (zone.coordinates || []).map((c) => Number(c.latitude));
        const lngs = (zone.coordinates || []).map((c) => Number(c.longitude));
        if (!lats.length || !lngs.length) {
            console.log(`! zone ${zone.name} has no polygon -- skipping ${place.city}`);
            continue;
        }
        const centre = {
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        };
        console.log(`\n${place.city} -- zone "${zone.name || zone.zoneName}" centred ${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)}`);

        for (const shop of place.shops) {
            const at = offsetKm(centre.lat, centre.lng, shop.north, shop.east);
            const email = `${slug(shop.name)}${SEED_SUFFIX}`;
            const phone = String(phoneSeq++);
            const km = Math.hypot(shop.north, shop.east).toFixed(1);

            const doc = {
                restaurantName: shop.name,
                ownerName: shop.owner,
                ownerEmail: email,
                ownerPhone: phone,
                primaryContactNumber: phone,
                storeType: 'pharmacy',
                // Onboarding refuses a pharmacy without one, and the drug-licence
                // register reads these -- a seeded shop with no licence would sit
                // in that screen as a compliance problem that is not real.
                drugLicenseNumber: `${place.licencePrefix}-${phone.slice(-4)}`,
                drugLicenseExpiry: expiry,
                drugLicenseImage: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=70',
                openingTime: '08:00',
                closingTime: '23:00',
                openDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
                isAcceptingOrders: true,
                autoAcceptOrders: false,
                outsideHoursOverride: false,
                estimatedDeliveryTime: '15-25 mins',
                estimatedDeliveryTimeMinutes: 15,
                status: 'approved',
                approvedAt: new Date(),
                zoneId: zone._id,
                profileImage: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=800&q=70',
                location: {
                    type: 'Point',
                    // GeoJSON is [lng, lat]; the flat pair below is what several
                    // older screens read, so both are written and must agree.
                    coordinates: [at.lng, at.lat],
                    latitude: at.lat,
                    longitude: at.lng,
                    formattedAddress: `${shop.area}, ${place.city}`,
                    address: `${shop.area}, ${place.city}`,
                    addressLine1: `${shop.area}, ${place.city}`,
                    area: shop.area,
                    city: place.city,
                    state: place.state,
                },
            };

            const existing = await FoodRestaurant.findOne({ ownerEmail: email }).select('_id').lean();
            await FoodRestaurant.updateOne({ ownerEmail: email }, { $set: doc }, { upsert: true });
            if (existing) updated += 1; else created += 1;
            console.log(`  ${existing ? 'updated' : 'created'}  ${shop.name.padEnd(32)} ~${km} km from centre`);
        }
    }

    console.log(`\n${created} created, ${updated} updated. Remove them with --remove.`);
    await mongoose.disconnect();
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
