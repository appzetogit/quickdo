/**
 * Seed bookable services for every Service-Provider category.
 *
 * Why: the catalogue had 29 categories but only 2 services, so tapping almost
 * any category in the customer app produced "Nothing available here yet" and
 * nothing could be booked. `getPublicServices` does fall back to synthesising
 * cards from Brands, but only when a brand exists for that category — most had
 * none either.
 *
 * Shape: Category -> Brand -> UserService. `SPUserService.brandId` is required,
 * so a brand is ensured per category before its services are written.
 *
 * Safety:
 *  - Dry run by default. Nothing is written without --apply.
 *  - Idempotent: a category that already has services is skipped, and services
 *    are matched by (brandId, title) so re-running does not duplicate.
 *  - Additive only. Nothing is updated, renamed or deleted.
 *
 * Usage:
 *   node scripts/sp-seed-services.js            # dry run, prints the plan
 *   node scripts/sp-seed-services.js --apply
 */

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

/** Rupees. GST is applied on top by the booking flow. */
const CATALOGUE = {
  'AC Service and Repair': [
    ['AC Service (Split)', 599, '1 unit', 'Deep clean of filters, coils and drain, plus performance check.'],
    ['AC Service (Window)', 499, '1 unit', 'Full service including filter and coil cleaning.'],
    ['AC Gas Refill', 2499, '1 unit', 'Leak check, vacuuming and refrigerant top-up.'],
    ['AC Installation', 1499, '1 unit', 'Mounting, piping and test run. Materials extra.'],
    ['AC Uninstallation', 799, '1 unit', 'Safe removal with gas recovery.'],
    ['AC Not Cooling — Diagnosis', 299, 'visit', 'Technician visit and fault diagnosis.'],
  ],
  'AC & Appliance Repair': [
    ['Appliance Diagnosis Visit', 299, 'visit', 'On-site inspection and estimate.'],
    ['AC Repair', 799, '1 unit', 'Fault repair for split and window units.'],
    ['Refrigerator Repair', 699, '1 unit', 'Cooling, compressor and thermostat faults.'],
    ['Washing Machine Repair', 649, '1 unit', 'Drainage, drum and motor issues.'],
  ],
  AC: [
    ['AC Deep Clean', 699, '1 unit', 'Jet cleaning of indoor and outdoor units.'],
    ['AC Repair Visit', 349, 'visit', 'Diagnosis with repair estimate.'],
    ['AC Installation', 1499, '1 unit', 'Standard split AC installation.'],
  ],
  Cooler: [
    ['Cooler Service', 449, '1 unit', 'Pad cleaning, pump check and water flush.'],
    ['Cooler Repair', 399, '1 unit', 'Motor, pump and fan repairs.'],
    ['Cooler Installation', 349, '1 unit', 'Placement, water line and power connection.'],
  ],
  LED: [
    ['LED TV Repair', 799, '1 unit', 'Panel, backlight and board diagnosis.'],
    ['LED TV Wall Mounting', 599, '1 unit', 'Bracket fitting and cable management.'],
    ['LED Light Installation', 199, 'point', 'Per-point fitting of LED lights.'],
  ],
  'Kitchen Chimney': [
    ['Chimney Deep Clean', 699, '1 unit', 'Degreasing of filters, motor and duct.'],
    ['Chimney Repair', 599, '1 unit', 'Suction, motor and switch faults.'],
    ['Chimney Installation', 899, '1 unit', 'Mounting and duct fitting.'],
  ],
  'Washing Machine': [
    ['Washing Machine Service', 549, '1 unit', 'Drum clean and full function check.'],
    ['Washing Machine Repair', 649, '1 unit', 'Drainage, spin and motor faults.'],
    ['Washing Machine Installation', 399, '1 unit', 'Inlet, outlet and levelling.'],
  ],
  'Washing Machine Repair': [
    ['Front Load Repair', 749, '1 unit', 'Door lock, drum bearing and drainage.'],
    ['Top Load Repair', 649, '1 unit', 'Motor, timer and spin faults.'],
    ['Drainage Fix', 449, '1 unit', 'Blocked or leaking drain repair.'],
  ],
  Fridge: [
    ['Fridge Service', 549, '1 unit', 'Coil clean, gas pressure and thermostat check.'],
    ['Fridge Repair', 699, '1 unit', 'Cooling and compressor faults.'],
    ['Fridge Gas Refill', 1899, '1 unit', 'Leak detection and refrigerant charge.'],
  ],
  'Refrigerator Repair': [
    ['Single Door Repair', 599, '1 unit', 'Cooling, thermostat and door seal.'],
    ['Double Door Repair', 749, '1 unit', 'Cooling, fan and defrost faults.'],
    ['Compressor Replacement', 2999, '1 unit', 'Compressor swap with gas charging.'],
  ],
  'R.O. Prufier': [
    ['RO Service', 499, '1 unit', 'Filter clean, TDS check and sanitisation.'],
    ['RO Filter Replacement', 899, '1 unit', 'Sediment and carbon filter change.'],
    ['RO Installation', 599, '1 unit', 'Mounting, plumbing and test run.'],
  ],
  Microwave: [
    ['Microwave Repair', 599, '1 unit', 'Heating, magnetron and panel faults.'],
    ['Microwave Service', 399, '1 unit', 'Cleaning and safety check.'],
  ],
  'Water Heater Repair': [
    ['Geyser Repair', 549, '1 unit', 'Heating element and thermostat faults.'],
    ['Geyser Installation', 649, '1 unit', 'Mounting, plumbing and electrical.'],
    ['Geyser Service', 449, '1 unit', 'Descaling and safety valve check.'],
  ],
  'Fan Repair': [
    ['Ceiling Fan Repair', 299, '1 unit', 'Winding, capacitor and regulator.'],
    ['Ceiling Fan Installation', 249, '1 unit', 'Mounting and wiring.'],
    ['Exhaust Fan Installation', 349, '1 unit', 'Cut-out, fitting and wiring.'],
  ],
  'Switch & Socket Installation': [
    ['Switch Replacement', 149, 'point', 'Per switch or socket replaced.'],
    ['New Socket Point', 299, 'point', 'New point with wiring up to 3 metres.'],
    ['Switchboard Repair', 399, '1 unit', 'Loose contacts and sparking fixed.'],
  ],
  'Tap Repair': [
    ['Tap Repair', 199, '1 unit', 'Leak and washer replacement.'],
    ['Tap Installation', 249, '1 unit', 'New tap fitting.'],
    ['Mixer Tap Installation', 399, '1 unit', 'Wall or deck mixer fitting.'],
  ],
  'Drill & Hang': [
    ['Wall Drilling', 149, 'point', 'Per hole, up to concrete.'],
    ['Photo / Mirror Hanging', 199, 'item', 'Levelled and anchored.'],
    ['Shelf Mounting', 349, 'item', 'Bracket fitting and levelling.'],
  ],
  'Home Wiring Installation': [
    ['New Wiring Point', 449, 'point', 'Concealed or surface wiring per point.'],
    ['Full House Rewiring — Survey', 299, 'visit', 'Site survey and written estimate.'],
    ['MCB Installation', 549, '1 unit', 'MCB fitting and load balancing.'],
  ],
  'Panel Upgrade & Repair': [
    ['Distribution Board Repair', 699, '1 unit', 'Breaker and busbar faults.'],
    ['Panel Upgrade', 2499, '1 unit', 'Higher-capacity board with new breakers.'],
    ['Earthing Check', 399, 'visit', 'Earth resistance test and fix.'],
  ],
  'Electrical Installation & Repair': [
    ['Electrician Visit', 249, 'visit', 'Diagnosis with estimate.'],
    ['Light Fitting Installation', 199, 'point', 'Per light point.'],
    ['Inverter Installation', 999, '1 unit', 'Inverter and battery connection.'],
  ],
  Electricity: [
    ['Electrician Visit', 249, 'visit', 'General electrical diagnosis.'],
    ['Power Failure Diagnosis', 349, 'visit', 'Tracing and repairing a dead circuit.'],
    ['Wiring Repair', 449, 'point', 'Faulty wiring repaired per point.'],
  ],
  'Electrician, Plumber & Carpenter': [
    ['Electrician Visit', 249, 'visit', 'Diagnosis and minor repairs.'],
    ['Plumber Visit', 249, 'visit', 'Leaks, taps and drainage.'],
    ['Carpenter Visit', 299, 'visit', 'Hinges, handles and minor repairs.'],
    ['Door Lock Replacement', 449, '1 unit', 'Lock removal and refitting.'],
  ],
  'Appliance Repair & Service': [
    ['Appliance Diagnosis', 299, 'visit', 'On-site inspection and estimate.'],
    ['General Appliance Repair', 649, '1 unit', 'Repair of common home appliances.'],
    ['Annual Maintenance Visit', 899, 'visit', 'Scheduled service of major appliances.'],
  ],
  'Home Repair & Installation': [
    ['Handyman Visit', 299, 'visit', 'Small jobs around the home.'],
    ['Furniture Assembly', 499, 'item', 'Flat-pack assembly per item.'],
    ['Curtain Rod Installation', 249, 'item', 'Drilling and fitting.'],
  ],
  'Smart Home Setup': [
    ['Smart Light Setup', 399, 'point', 'Fitting and app pairing.'],
    ['Smart Lock Installation', 1299, '1 unit', 'Fitting and configuration.'],
    ['Wi-Fi Camera Installation', 899, '1 unit', 'Mounting, wiring and app setup.'],
  ],
  Cleaning: [
    ['Bathroom Deep Clean', 599, 'room', 'Descaling, scrubbing and sanitising.'],
    ['Kitchen Deep Clean', 899, 'room', 'Degreasing of surfaces and cabinets.'],
    ['Full Home Deep Clean', 2999, 'home', 'Whole-home clean for up to 2BHK.'],
    ['Sofa Shampooing', 499, 'seat', 'Per seat wet shampoo and vacuum.'],
  ],
  "Women's Salon & Spa": [
    ['Waxing — Full Arms & Legs', 799, 'session', 'At-home waxing session.'],
    ['Facial — Fruit', 899, 'session', 'Cleanse, scrub, massage and pack.'],
    ['Manicure & Pedicure', 999, 'session', 'Complete hand and foot care.'],
    ['Hair Spa', 1099, 'session', 'Deep conditioning treatment.'],
  ],
  'Massage for Men': [
    ['Full Body Massage — 60 min', 1299, 'session', 'Relaxation massage at home.'],
    ['Head & Shoulder Massage', 599, 'session', '30-minute stress relief.'],
    ['Foot Massage', 699, 'session', '45-minute reflexology.'],
  ],
};

/** Used for any category not named above, so nothing is left empty. */
const GENERIC = (title) => [
  [`${title} — Inspection`, 299, 'visit', `Technician visit for ${title.toLowerCase()} with a written estimate.`],
  [`${title} — Standard Service`, 599, '1 unit', `Routine ${title.toLowerCase()} service by a verified professional.`],
  [`${title} — Repair`, 749, '1 unit', `Repair work for ${title.toLowerCase()}. Parts charged separately.`],
];

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME || undefined,
  });
  const db = mongoose.connection.db;
  console.log(`db: ${db.databaseName}   mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const categories = db.collection('sp_categories');
  const brands = db.collection('sp_brands');
  const services = db.collection('sp_user_services');

  const allCategories = await categories.find({ status: 'active' }).toArray();

  let brandsCreated = 0;
  let servicesCreated = 0;
  let skipped = 0;

  for (const category of allCategories) {
    const existing = await services.countDocuments({ categoryId: category._id });
    if (existing > 0) {
      console.log(`skip  ${category.title} — already has ${existing} service(s)`);
      skipped += 1;
      continue;
    }

    // Reuse a brand already linked to this category; otherwise make one named
    // after the category, which reads naturally in the "brand filter" row.
    let brand = await brands.findOne({
      $or: [{ categoryIds: category._id }, { categoryId: category._id }],
      status: 'active',
    });

    if (!brand) {
      let slug = slugify(category.title);
      if (await brands.findOne({ slug })) slug = `${slug}-services`;

      const doc = {
        title: category.title,
        slug,
        categoryIds: [category._id],
        categoryId: category._id,
        cityIds: [],
        iconUrl: category.homeIconUrl || null,
        status: 'active',
        basePrice: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (APPLY) {
        const res = await brands.insertOne(doc);
        brand = { ...doc, _id: res.insertedId };
      } else {
        brand = { ...doc, _id: 'DRY_RUN' };
      }
      brandsCreated += 1;
      console.log(`brand ${category.title} — created`);
    }

    const rows = CATALOGUE[category.title] || GENERIC(category.title);
    for (const [title, price, unit, description] of rows) {
      if (APPLY) {
        const already = await services.findOne({ brandId: brand._id, title });
        if (already) continue;
        await services.insertOne({
          brandId: brand._id,
          categoryId: category._id,
          title,
          iconUrl: category.homeIconUrl || null,
          basePrice: price,
          gstPercentage: 18,
          pricingUnit: unit,
          description,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      servicesCreated += 1;
    }
    console.log(`  +${rows.length} services under ${category.title}`);
  }

  console.log(
    `\ncategories ${allCategories.length} · skipped ${skipped} · ` +
      `brands ${brandsCreated} · services ${servicesCreated}`,
  );
  if (!APPLY) console.log('\nDRY RUN — nothing written. Re-run with --apply.');

  await mongoose.disconnect();
};

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
