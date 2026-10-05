/**
 * Runs the same aggregation-pipeline update the admin price adjuster uses,
 * against a real in-memory Mongo, and checks it scales base and variant prices
 * and comes back to the original on revert.
 *
 * Run: node tests/price-adjustment.smoke.mjs
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const MIN_RESULT_PRICE = 0.01;

const scale = (expr, factor) => ({
    $max: [MIN_RESULT_PRICE, { $round: [{ $multiply: [expr, factor] }, 2] }]
});

const applyFactor = (Model, filter, factor) =>
    Model.updateMany(filter, [
        {
            $set: {
                price: scale('$price', factor),
                variants: {
                    $map: {
                        input: { $ifNull: ['$variants', []] },
                        as: 'variant',
                        in: {
                            $mergeObjects: ['$$variant', { price: scale('$$variant.price', factor) }]
                        }
                    }
                }
            }
        }
    ]);

const server = await MongoMemoryServer.create();
await mongoose.connect(server.getUri(), { dbName: 'smoke' });

const Food = mongoose.model(
    'SmokeFood',
    new mongoose.Schema(
        {
            restaurantId: mongoose.Schema.Types.ObjectId,
            price: Number,
            variants: [new mongoose.Schema({ name: String, price: Number }, { _id: true })]
        },
        { collection: 'smoke_foods' }
    )
);

const restaurantA = new mongoose.Types.ObjectId();
const restaurantB = new mongoose.Types.ObjectId();

await Food.create([
    { restaurantId: restaurantA, price: 500, variants: [] },
    { restaurantId: restaurantA, price: 399, variants: [{ name: 'Half', price: 120 }, { name: 'Full', price: 220 }] },
    { restaurantId: restaurantB, price: 100, variants: [] }
]);

const priceOf = async (restaurantId, price) =>
    Food.findOne({ restaurantId, ...(price ? { price } : {}) }).lean();

// +10% across every restaurant.
await applyFactor(Food, {}, 1.1);
assert.equal((await Food.findOne({ restaurantId: restaurantB }).lean()).price, 110);

const withVariants = await Food.findOne({ 'variants.0': { $exists: true } }).lean();
assert.equal(withVariants.price, 438.9, 'base price scales');
assert.deepEqual(
    withVariants.variants.map((v) => v.price),
    [132, 242],
    'every variant price scales too'
);
assert.equal(withVariants.variants[0].name, 'Half', 'variant name survives the $mergeObjects');

// Reverting divides by the same factor and lands back on the originals.
await applyFactor(Food, {}, 1 / 1.1);
const reverted = await Food.findOne({ 'variants.0': { $exists: true } }).lean();
assert.equal(reverted.price, 399, 'revert restores the base price');
assert.deepEqual(reverted.variants.map((v) => v.price), [120, 220], 'revert restores variants');

// Scoping to one restaurant must leave the other alone.
await applyFactor(Food, { restaurantId: restaurantA }, 0.5);
assert.equal((await Food.findOne({ restaurantId: restaurantB }).lean()).price, 100, 'other restaurant untouched');
assert.equal((await priceOf(restaurantA, 250)).price, 250, 'scoped restaurant halved');

// A steep cut must never produce a free item.
await applyFactor(Food, { restaurantId: restaurantB }, 0.00001);
assert.equal((await Food.findOne({ restaurantId: restaurantB }).lean()).price, MIN_RESULT_PRICE, 'price floors instead of hitting 0');

await mongoose.disconnect();
await server.stop();
console.log('price-adjustment smoke: OK');
