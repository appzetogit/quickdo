/**
 * Saving a dish in the portal must not move any base price.
 *
 * Run: node tests/portal-save-keeps-base.smoke.mjs
 *
 * Reported from the live portal. Margherita Pizza: bases 120/270/390 with the
 * dish carrying 10% off, so customers pay 108/243/351. The size editor shows the
 * SELLING price -- 108/243/351 -- and posts it back as each size's price with no
 * base alongside it. Both ends then took that as the base:
 *
 *   the sizes  each size's base became its own charged price
 *   the dish   basePrice was set to the cheapest CHARGED price, 120 -> 108
 *
 * so one save cut every base by the discount, and the next save cut it again.
 *
 * These run the real service against an in-memory Mongo, replaying exactly what
 * the portal posts.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let failed = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const main = async () => {
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'portal_save' });

    const { normalizeFoodVariantsInput } = await import('../src/modules/food/admin/services/foodVariant.service.js');

    // The dish exactly as production holds it.
    const stored = {
        formulationDiscountPercent: 10,
        formulationMarkupPercent: 0,
        variants: [
            { _id: 'v1', name: 'Small', price: 108, basePrice: 120 },
            { _id: 'v2', name: 'Medium', price: 243, basePrice: 270 },
            { _id: 'v3', name: 'Large', price: 351, basePrice: 390 },
        ],
    };

    // What ItemDetailsPage posts: the selling price, no basePrice.
    const asPortalPosts = (variants) => variants.map((v) => ({
        _id: v._id, name: v.name, price: v.price,
    }));

    console.log('\nsaving without changing anything');

    let saved = normalizeFoodVariantsInput(asPortalPosts(stored.variants), { existing: stored });

    check('every size keeps the base the restaurant set', () => {
        assert.deepEqual(
            saved.map((v) => v.basePrice),
            [120, 270, 390],
            `got ${saved.map((v) => v.basePrice).join('/')}`,
        );
    });

    check('what customers pay is untouched', () => {
        assert.deepEqual(saved.map((v) => v.price), [108, 243, 351]);
    });

    console.log('\nsaving five times over, as an impatient admin would');

    let state = { ...stored };
    for (let i = 0; i < 5; i += 1) {
        const out = normalizeFoodVariantsInput(asPortalPosts(state.variants), { existing: state });
        state = { ...state, variants: out.map((v, idx) => ({ ...v, _id: state.variants[idx]._id })) };
    }

    check('the bases have not drifted a paisa', () => {
        assert.deepEqual(
            state.variants.map((v) => v.basePrice),
            [120, 270, 390],
            `after 5 saves: ${state.variants.map((v) => v.basePrice).join('/')}`,
        );
    });

    console.log('\ndeliberately repricing a size');

    // The admin types 200 into Medium's price box. That is what a customer should
    // pay, so the base behind it is 200 / 0.9.
    const repriced = normalizeFoodVariantsInput(
        asPortalPosts(stored.variants).map((v) => (v.name === 'Medium' ? { ...v, price: 200 } : v)),
        { existing: stored },
    );

    check('the repriced size gets the base its new price implies', () => {
        const medium = repriced.find((v) => v.name === 'Medium');
        assert.equal(medium.basePrice, 222.22, '200 at 10% off comes from a base of 222.22');
    });

    check('the sizes that were not touched keep their bases', () => {
        assert.equal(repriced.find((v) => v.name === 'Small').basePrice, 120);
        assert.equal(repriced.find((v) => v.name === 'Large').basePrice, 390);
    });

    console.log('\na dish with no discount');

    const plain = {
        formulationDiscountPercent: 0,
        variants: [{ _id: 'p1', name: 'Regular', price: 150, basePrice: 150 }],
    };
    const plainSaved = normalizeFoodVariantsInput(asPortalPosts(plain.variants), { existing: plain });

    check('base and price stay equal', () => {
        assert.equal(plainSaved[0].basePrice, 150);
        assert.equal(plainSaved[0].price, 150);
    });

    console.log('\na brand new size added to a discounted dish');

    const withNew = normalizeFoodVariantsInput(
        [...asPortalPosts(stored.variants), { name: 'Party', price: 450 }],
        { existing: stored },
    );

    check('the new size prices off the discount, the others are untouched', () => {
        const party = withNew.find((v) => v.name === 'Party');
        assert.equal(party.basePrice, 500, '450 at 10% off comes from a base of 500');
        assert.deepEqual(
            withNew.filter((v) => v.name !== 'Party').map((v) => v.basePrice),
            [120, 270, 390],
        );
    });

    console.log('\na stale form reposting the charged price as the base');

    check('an explicit base equal to the prior CHARGED price is refused', () => {
        /*
         * How Margherita's Small actually lost its base. A panel still displaying
         * the post-adjustment figure in its base box posted 108 back as the base,
         * and "an explicit base always wins" took it -- writing the standing 10%
         * into the base permanently. It went 120 -> 108, and the next such save
         * would have made it 97.20.
         */
        const out = normalizeFoodVariantsInput(
            [{ _id: 'v1', name: 'Small', price: 108, basePrice: 108 }],
            { existing: { formulationDiscountPercent: 10, variants: [{ _id: 'v1', name: 'Small', price: 108, basePrice: 120 }] } },
        );
        assert.equal(out[0].basePrice, 120, 'the stored base must hold');
    });

    check('a genuine edit to a different base still lands', () => {
        const out = normalizeFoodVariantsInput(
            [{ _id: 'v1', name: 'Small', price: 108, basePrice: 130 }],
            { existing: { formulationDiscountPercent: 10, variants: [{ _id: 'v1', name: 'Small', price: 108, basePrice: 120 }] } },
        );
        assert.equal(out[0].basePrice, 130);
    });

    check('a genuine edit downward still lands', () => {
        const out = normalizeFoodVariantsInput(
            [{ _id: 'v1', name: 'Small', price: 108, basePrice: 90 }],
            { existing: { formulationDiscountPercent: 10, variants: [{ _id: 'v1', name: 'Small', price: 108, basePrice: 120 }] } },
        );
        assert.equal(out[0].basePrice, 90, 'the admin may still reprice downwards');
    });

    console.log('\na save must not erase the formulation price from the app');

    // Kadai Paneer as production holds it: 20% markup, so the base IS the charged
    // price and the strike is the only thing that makes the increase visible.
    const markupDish = {
        formulationMarkupPercent: 20,
        formulationDiscountPercent: 0,
        variants: [{ _id: 'm1', name: 'Full', price: 429.3, basePrice: 429.3, formulationStrikePrice: 515.16 }],
    };

    check('an ordinary save keeps the strike the run decided', () => {
        // What both panels post: no strike at all.
        const out = normalizeFoodVariantsInput([{ _id: 'm1', name: 'Full', price: 429.3 }], { existing: markupDish });
        assert.equal(out[0].formulationStrikePrice, 515.16, 'the markup would vanish from the app');
    });

    check('a deliberate reprice re-derives the strike from the new base', () => {
        const out = normalizeFoodVariantsInput(
            [{ _id: 'm1', name: 'Full', price: 500, basePrice: 500 }],
            { existing: markupDish },
        );
        assert.equal(out[0].basePrice, 500);
        assert.equal(out[0].formulationStrikePrice, 600, '20% on the NEW base of 500');
    });

    check('the Margherita case: a discount dish repriced leaves no stale strike', () => {
        // 120 -> 100 with 10% off. Carrying the old strike of 120 would advertise
        // "was 120" on a size that now has a base of 100.
        const out = normalizeFoodVariantsInput(
            [{ _id: 'd1', name: 'Small', price: 90, basePrice: 100 }],
            { existing: {
                formulationDiscountPercent: 10,
                variants: [{ _id: 'd1', name: 'Small', price: 108, basePrice: 120, formulationStrikePrice: 120 }],
            } },
        );
        assert.equal(out[0].basePrice, 100);
        assert.equal(out[0].price, 90);
        assert.equal(out[0].formulationStrikePrice, undefined, 'customers fall back to the base');
    });

    console.log('\na client that does send a real base');

    const explicit = normalizeFoodVariantsInput(
        [{ _id: 'v1', name: 'Small', price: 108, basePrice: 130 }],
        { existing: stored },
    );

    check('an explicit base wins over everything', () => {
        assert.equal(explicit[0].basePrice, 130);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
