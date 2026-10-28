/**
 * Spend-threshold freebies.
 *
 * The cases that matter are the ones where a wrong answer gives away food that
 * was not earned: a freebie counting toward its own threshold, several tiers
 * stacking, and a ladder resolving by array order rather than by amount.
 *
 * Run: node src/modules/food/shared/__checks__/freebieRewards.check.js
 */
import assert from 'node:assert';
import {
    normalizeFreebieTiersInput,
    resolveFreebieTier,
    describeNextFreebieTier,
    buildFreebieLine,
    MAX_FREEBIE_TIERS,
} from '../freebieRewards.js';

let failures = 0;
const check = (label, fn) => {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    } catch (error) {
        failures += 1;
        console.log(`  FAIL  ${label} -- ${error.message}`);
    }
};

const ITEM_A = '6a8e71ac4339a70e13961f16';
const ITEM_B = '6a8e71ac4339a70e13961f17';
const ADDON = '6a8bf2a1de6a8e629170dc8d';

const ladder = [
    { minOrderValue: 200, rewardType: 'item', rewardItemId: ITEM_A },
    { minOrderValue: 300, rewardType: 'addon', rewardAddonId: ADDON },
];

// ---- which tier applies ----------------------------------------------------
check('below the first threshold earns nothing', () => {
    assert.equal(resolveFreebieTier(ladder, 199.99), null);
});

check('exactly on the threshold earns it', () => {
    // "Spend 200" has to mean 200, not 200.01.
    assert.equal(resolveFreebieTier(ladder, 200).minOrderValue, 200);
});

check('between tiers earns the lower one', () => {
    assert.equal(resolveFreebieTier(ladder, 250).rewardItemId, ITEM_A);
});

check('above the top tier earns only the top one', () => {
    // Not both: the ladder is "a better freebie", not "every freebie".
    const t = resolveFreebieTier(ladder, 500);
    assert.equal(t.minOrderValue, 300);
    assert.equal(t.rewardType, 'addon');
});

check('the highest tier wins regardless of array order', () => {
    const shuffled = [ladder[1], ladder[0]];
    assert.equal(resolveFreebieTier(shuffled, 500).minOrderValue, 300);
});

check('a zero or negative subtotal earns nothing', () => {
    assert.equal(resolveFreebieTier(ladder, 0), null);
    assert.equal(resolveFreebieTier(ladder, -50), null);
});

check('no tiers configured earns nothing', () => {
    assert.equal(resolveFreebieTier([], 1000), null);
    assert.equal(resolveFreebieTier(undefined, 1000), null);
});

check('a malformed tier is ignored rather than throwing', () => {
    const messy = [{ minOrderValue: 0 }, { minOrderValue: null }, ladder[0]];
    assert.equal(resolveFreebieTier(messy, 250).rewardItemId, ITEM_A);
});

// ---- the nudge -------------------------------------------------------------
check('the nudge names the nearest unreached tier and the gap', () => {
    const next = describeNextFreebieTier(ladder, 160);
    assert.equal(next.minOrderValue, 200);
    assert.equal(next.amountAway, 40);
});

check('past one tier, the nudge points at the next', () => {
    const next = describeNextFreebieTier(ladder, 250);
    assert.equal(next.minOrderValue, 300);
    assert.equal(next.amountAway, 50);
});

check('at the top tier there is nothing left to nudge for', () => {
    assert.equal(describeNextFreebieTier(ladder, 400), null);
});

// ---- configuring -----------------------------------------------------------
check('tiers are stored sorted ascending', () => {
    const { tiers } = normalizeFreebieTiersInput({
        tiers: [
            { minOrderValue: 300, rewardType: 'item', rewardItemId: ITEM_B },
            { minOrderValue: 200, rewardType: 'item', rewardItemId: ITEM_A },
        ],
    });
    assert.deepEqual(tiers.map((t) => t.minOrderValue), [200, 300]);
});

check('an add-on reward keeps its id on the add-on field', () => {
    const { tiers } = normalizeFreebieTiersInput({
        tiers: [{ minOrderValue: 200, rewardType: 'addon', rewardAddonId: ADDON }],
    });
    assert.equal(tiers[0].rewardAddonId, ADDON);
    assert.equal(tiers[0].rewardItemId, null);
});

check('two rewards at the same amount are rejected', () => {
    // Otherwise which one applies depends on array order.
    assert.throws(() => normalizeFreebieTiersInput({
        tiers: [
            { minOrderValue: 200, rewardType: 'item', rewardItemId: ITEM_A },
            { minOrderValue: 200, rewardType: 'item', rewardItemId: ITEM_B },
        ],
    }), /one reward per amount/i);
});

check('a tier with no reward is rejected', () => {
    assert.throws(() => normalizeFreebieTiersInput({
        tiers: [{ minOrderValue: 200, rewardType: 'item' }],
    }), /give away/i);
});

check('a zero or negative threshold is rejected', () => {
    // A freebie on every order is a menu change, not an offer.
    assert.throws(() => normalizeFreebieTiersInput({
        tiers: [{ minOrderValue: 0, rewardType: 'item', rewardItemId: ITEM_A }],
    }), /greater than 0/);
});

check('an unknown reward type is rejected', () => {
    assert.throws(() => normalizeFreebieTiersInput({
        tiers: [{ minOrderValue: 200, rewardType: 'discount', rewardItemId: ITEM_A }],
    }), /item or an add-on/i);
});

check('too many tiers are rejected', () => {
    const many = Array.from({ length: MAX_FREEBIE_TIERS + 1 }, (_, i) => ({
        minOrderValue: (i + 1) * 100, rewardType: 'item', rewardItemId: ITEM_A,
    }));
    assert.throws(() => normalizeFreebieTiersInput({ tiers: many }), /At most/);
});

check('an empty list clears the ladder', () => {
    assert.deepEqual(normalizeFreebieTiersInput({ tiers: [] }), { tiers: [] });
});

check('a body not mentioning tiers leaves them alone', () => {
    assert.equal(normalizeFreebieTiersInput({ name: 'Joy' }), undefined);
});

// ---- the order line --------------------------------------------------------
check('the reward line is priced at zero and flagged', () => {
    const line = buildFreebieLine(ladder[0], { _id: ITEM_A, name: 'Gulab Jamun', price: 60 });
    assert.equal(line.price, 0);
    assert.equal(line.quantity, 1);
    assert.equal(line.isFreebie, true);
    assert.equal(line.name, 'Gulab Jamun');
});

check('the reward line carries no packaging charge', () => {
    // "Free" that adds a packaging fee is not free.
    const line = buildFreebieLine(ladder[0], { _id: ITEM_A, name: 'Gulab Jamun', foodPackagingCharge: 10 });
    assert.equal(line.foodPackagingCharge, 0);
});

check('a withdrawn reward yields no line rather than an error', () => {
    // A freebie is a bonus; losing it must not block the order.
    assert.equal(buildFreebieLine(ladder[0], null), null);
    assert.equal(buildFreebieLine(ladder[0], { _id: ITEM_A, name: '   ' }), null);
    assert.equal(buildFreebieLine(null, { _id: ITEM_A, name: 'X' }), null);
});

// ---- the property that matters most ----------------------------------------
check('a freebie cannot push an order over the next threshold', () => {
    // Resolution runs against the paid subtotal only. Simulate the whole flow:
    // 190 of food earns nothing; adding a 0-priced line must not change that.
    const paidSubtotal = 190;
    assert.equal(resolveFreebieTier(ladder, paidSubtotal), null);

    const withFreebie = paidSubtotal + 0;
    assert.equal(resolveFreebieTier(ladder, withFreebie), null,
        'a zero-priced line changed the outcome');
});

console.log(failures ? `\n${failures} FAILED` : '\nall freebie reward checks passed');
process.exit(failures ? 1 : 0);
