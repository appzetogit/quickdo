/**
 * Self-check for the driver-class vocabulary.
 * Run: node src/modules/taxi/shared/__checks__/driverClasses.check.js
 */
import assert from 'node:assert/strict';
import {
    CLASS_VEHICLE_ICON_TYPES,
    DRIVER_CLASSES,
    SERVICE_CAPABILITIES,
    capabilitiesForIntents,
    classForIntents,
    documentAppliesTo,
    normalizeDriverClass,
    normalizeDriverIntents,
    vehicleIconTypesFor,
} from '../driverClasses.js';

// --- classes -------------------------------------------------------------
assert.equal(normalizeDriverClass('two_wheeler'), 'two_wheeler');
assert.equal(normalizeDriverClass('  TWO_WHEELER '), 'two_wheeler');
assert.equal(normalizeDriverClass('spaceship'), null);
assert.equal(normalizeDriverClass(undefined), null);

// --- intents are filtered to their own class -----------------------------
assert.deepEqual(
    normalizeDriverIntents(['food_daily_medical_parcel', 'bike_taxi_parcel'], 'two_wheeler'),
    ['food_daily_medical_parcel', 'bike_taxi_parcel'],
);
// A four-wheeler pick under "I have a 2 wheeler" is dropped, not fatal.
assert.deepEqual(
    normalizeDriverIntents(['food_daily_medical_parcel', 'four_wheeler'], 'two_wheeler'),
    ['food_daily_medical_parcel'],
);
// Junk and duplicates go.
assert.deepEqual(normalizeDriverIntents(['three_wheeler', 'three_wheeler', 'nonsense']), [
    'three_wheeler',
]);
assert.deepEqual(normalizeDriverIntents(undefined), []);

// --- what an admin could grant -------------------------------------------
{
    const caps = capabilitiesForIntents(['food_daily_medical_parcel']);
    assert.ok(caps.includes(SERVICE_CAPABILITIES.DELIVERY));
    assert.ok(caps.includes(SERVICE_CAPABILITIES.QUICK_COMMERCE));
    // The whole point: a food rider is NOT granted passenger rides.
    assert.ok(!caps.includes(SERVICE_CAPABILITIES.TAXI));
}
{
    const caps = capabilitiesForIntents(['bike_taxi_parcel']);
    assert.ok(caps.includes(SERVICE_CAPABILITIES.TAXI));
    // A bike-taxi rider is not granted food.
    assert.ok(!caps.includes(SERVICE_CAPABILITIES.DELIVERY));
}
// Parcel delivery was removed: its old intents grant nothing and the
// parcel-vehicle class is no longer recognised.
assert.deepEqual(capabilitiesForIntents(['parcel_delivery', 'heavy_parcel_delivery']), []);
assert.equal(normalizeDriverClass('parcel_vehicle'), null);
assert.equal(SERVICE_CAPABILITIES.PARCEL, undefined);
// Both two-wheeler options together grant everything a bike can do.
{
    const caps = capabilitiesForIntents(['food_daily_medical_parcel', 'bike_taxi_parcel']);
    assert.ok(caps.includes(SERVICE_CAPABILITIES.DELIVERY));
    assert.ok(caps.includes(SERVICE_CAPABILITIES.TAXI));
}

// --- class inferred from intents -----------------------------------------
assert.equal(classForIntents(['three_wheeler', 'four_wheeler']), DRIVER_CLASSES.PASSENGER_TAXI);
assert.equal(classForIntents(['three_wheeler', 'bike_taxi_parcel']), null);
assert.equal(classForIntents([]), null);

// --- which vehicles each driver is offered -------------------------------
{
    // 3 wheeler means autos, not every car in the catalogue.
    const icons = vehicleIconTypesFor({ driverClass: 'passenger_taxi', intents: ['three_wheeler'] });
    assert.deepEqual(icons, ['auto']);
}
{
    const icons = vehicleIconTypesFor({ driverClass: 'passenger_taxi', intents: ['four_wheeler'] });
    assert.ok(icons.includes('sedan'));
    assert.ok(!icons.includes('auto'));
}
{
    // Both: autos and cars.
    const icons = vehicleIconTypesFor({
        driverClass: 'passenger_taxi',
        intents: ['three_wheeler', 'four_wheeler'],
    });
    assert.ok(icons.includes('auto'));
    assert.ok(icons.includes('suv'));
}
{
    // Two-wheeler intents do not narrow, so the class list stands.
    const icons = vehicleIconTypesFor({
        driverClass: 'two_wheeler',
        intents: ['food_daily_medical_parcel'],
    });
    assert.deepEqual(icons, CLASS_VEHICLE_ICON_TYPES.two_wheeler);
}
// No class, no intents: offer nothing rather than everything.
assert.deepEqual(vehicleIconTypesFor({}), []);

// --- documents -----------------------------------------------------------
// Unset means "everyone", so the catalogue that predates this field still works.
assert.equal(documentAppliesTo({}, 'two_wheeler'), true);
assert.equal(documentAppliesTo({ applies_to: [] }, 'two_wheeler'), true);
assert.equal(documentAppliesTo({ applies_to: ['two_wheeler'] }, 'two_wheeler'), true);
assert.equal(documentAppliesTo({ applies_to: ['two_wheeler'] }, 'passenger_taxi'), false);
assert.equal(
    documentAppliesTo({ applies_to: ['two_wheeler', 'passenger_taxi'] }, 'passenger_taxi'),
    true,
);
// A driver with no class yet sees everything, rather than an empty list.
assert.equal(documentAppliesTo({ applies_to: ['two_wheeler'] }, null), true);

console.log('driverClasses.check.js OK');
