/**
 * Seed the four taxi ride types -- Mini, Sedan, SUV and Premium -- with default
 * prices (SOW plan §4.12).
 *
 *   node scripts/seed-taxi-vehicle-types.mjs            # dry run (default): report only
 *   node scripts/seed-taxi-vehicle-types.mjs --dry-run  # same
 *   node scripts/seed-taxi-vehicle-types.mjs --apply    # write
 *
 * Idempotent, and never overwrites an admin's work:
 *   - a vehicle type is matched by name (case-insensitive, taxi); one that
 *     exists is left exactly as it is;
 *   - a global price row (no zone, no service location) is created only for a
 *     type that has no taxi price row at all. Zone or city rows an admin adds
 *     later take priority over it (rideService.resolveSetPriceForRide).
 *
 * The prices are a starting point in rupees, in the SetPrice shape the admin
 * "Set Prices" form writes: base fare covers base_distance km, then per km and
 * per minute. Adjust them in the admin panel.
 *
 * Reads MONGO_URI / MONGODB_URI from the environment (.env).
 */
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_RIDE_TYPES = [
  {
    name: 'Mini',
    short_description: 'Compact hatchback, 4 seats',
    icon_types: 'car',
    capacity: 4,
    price: { base_price: 50, base_distance: 2, price_per_distance: 12, time_price: 1, waiting_charge: 1, free_waiting_before: 3 },
  },
  {
    name: 'Sedan',
    short_description: 'Comfortable sedan, 4 seats',
    icon_types: 'car',
    capacity: 4,
    price: { base_price: 70, base_distance: 2, price_per_distance: 15, time_price: 1.5, waiting_charge: 1.5, free_waiting_before: 3 },
  },
  {
    name: 'SUV',
    short_description: 'Spacious SUV, 6 seats',
    icon_types: 'suv',
    capacity: 6,
    price: { base_price: 100, base_distance: 2, price_per_distance: 20, time_price: 2, waiting_charge: 2, free_waiting_before: 3 },
  },
  {
    name: 'Premium',
    short_description: 'Premium sedan, top-rated drivers',
    icon_types: 'premium',
    capacity: 4,
    price: { base_price: 150, base_distance: 2, price_per_distance: 25, time_price: 2.5, waiting_charge: 2.5, free_waiting_before: 3 },
  },
];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const seedTaxiVehicleTypes = async ({ apply = false, log = console.log } = {}) => {
  const { Vehicle } = await import('../src/modules/taxi/admin/models/Vehicle.js');
  const { SetPrice } = await import('../src/modules/taxi/admin/models/SetPrice.js');

  const report = { vehiclesCreated: [], vehiclesKept: [], pricesCreated: [], pricesKept: [] };

  for (const type of DEFAULT_RIDE_TYPES) {
    let vehicle = await Vehicle.findOne({
      name: { $regex: `^${escapeRegex(type.name)}$`, $options: 'i' },
      transport_type: { $in: ['taxi', 'both'] },
    }).lean();

    if (vehicle) {
      report.vehiclesKept.push(type.name);
    } else {
      report.vehiclesCreated.push(type.name);
      if (apply) {
        vehicle = (await Vehicle.create({
          name: type.name,
          short_description: type.short_description,
          transport_type: 'taxi',
          is_taxi: 'taxi',
          dispatch_type: 'normal',
          icon_types: type.icon_types,
          capacity: type.capacity,
          status: 1,
          active: true,
        })).toObject();
      }
    }

    const hasPrice = vehicle
      ? await SetPrice.exists({ vehicle_type: vehicle._id, transport_type: { $in: ['taxi', 'both'] } })
      : false;
    if (hasPrice) {
      report.pricesKept.push(type.name);
      continue;
    }
    report.pricesCreated.push(type.name);
    if (apply && vehicle) {
      await SetPrice.create({
        vehicle_type: vehicle._id,
        zone_id: null,
        service_location_id: null,
        pricing_scope: 'ride',
        transport_type: 'taxi',
        payment_type: ['cash', 'online', 'wallet'],
        service_tax: 5,
        admin_commision_type: 1,
        admin_commision: 0,
        admin_commission_type_from_driver: 1,
        admin_commission_from_driver: 10,
        free_waiting_after: 0,
        ...type.price,
        active: 1,
        status: 'active',
      });
    }
  }

  log(`[ride-types] vehicle types: create ${report.vehiclesCreated.join(', ') || 'none'}; keep ${report.vehiclesKept.join(', ') || 'none'}`);
  log(`[ride-types] price rows: create ${report.pricesCreated.join(', ') || 'none'}; keep ${report.pricesKept.join(', ') || 'none'}`);
  if (!apply) log('[ride-types] dry run: nothing written (pass --apply to write)');
  return report;
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  dotenv.config({ path: path.resolve(here, '../.env') });
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI / MONGODB_URI is not set');
    process.exit(1);
  }
  mongoose.connect(uri)
    .then(() => seedTaxiVehicleTypes({ apply }))
    .then(() => mongoose.disconnect())
    .catch((err) => { console.error(err); process.exit(1); });
}
