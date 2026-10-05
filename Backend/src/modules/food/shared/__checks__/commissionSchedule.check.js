/**
 * Self-check for scheduled restaurant commission rates.
 * Run: node src/modules/food/shared/__checks__/commissionSchedule.check.js
 */
import assert from 'node:assert/strict';
import {
    COMMISSION_SOURCES,
    computeCommissionAmount,
    normalizeScheduleInput,
    resolveCommissionRate,
    scheduleCoversInstant,
} from '../commissionSchedule.js';

const throws = (fn, re) => assert.throws(fn, (e) => e.name === 'ValidationError' && (!re || re.test(e.message)));

const R1 = 'restaurant-1';
const R2 = 'restaurant-2';
const D = (s) => new Date(s);

const sched = (over = {}) => ({
    _id: over._id || 'sched',
    restaurantId: null,
    label: '',
    commission: { type: 'percentage', value: 20 },
    startsAt: D('2026-10-01T00:00:00Z'),
    endsAt: D('2026-10-10T00:00:00Z'),
    status: true,
    ...over,
});

const defaultRule = { defaultCommission: { type: 'percentage', value: 10 }, status: true };

// --- window maths ---------------------------------------------------------
assert.equal(scheduleCoversInstant(sched(), D('2026-10-05T00:00:00Z')), true);
assert.equal(scheduleCoversInstant(sched(), D('2026-10-01T00:00:00Z')), true);  // start inclusive
assert.equal(scheduleCoversInstant(sched(), D('2026-10-10T00:00:00Z')), false); // end exclusive
assert.equal(scheduleCoversInstant(sched(), D('2026-09-30T23:59:59Z')), false);
assert.equal(scheduleCoversInstant(sched({ status: false }), D('2026-10-05T00:00:00Z')), false);
assert.equal(scheduleCoversInstant(null, D('2026-10-05T00:00:00Z')), false);

// --- the client's scenario: 10% normally, 50% during the festival --------
{
    // Outside the window: the standing default applies.
    const before = resolveCommissionRate({
        defaultRule, schedules: [sched({ commission: { type: 'percentage', value: 50 } })],
        restaurantId: R1, at: D('2026-09-20T00:00:00Z'),
    });
    assert.equal(before.value, 10);
    assert.equal(before.source, COMMISSION_SOURCES.RESTAURANT_DEFAULT);
    assert.equal(computeCommissionAmount(300, before), 30);

    // Inside it: the festive rate applies. 50% of a ₹300 bill is ₹150.
    const during = resolveCommissionRate({
        defaultRule, schedules: [sched({ commission: { type: 'percentage', value: 50 } })],
        restaurantId: R1, at: D('2026-10-05T00:00:00Z'),
    });
    assert.equal(during.value, 50);
    assert.equal(during.source, COMMISSION_SOURCES.SCHEDULE_PLATFORM);
    assert.equal(computeCommissionAmount(300, during), 150);

    // And afterwards it reverts on its own, with nobody having to remember.
    const after = resolveCommissionRate({
        defaultRule, schedules: [sched({ commission: { type: 'percentage', value: 50 } })],
        restaurantId: R1, at: D('2026-10-11T00:00:00Z'),
    });
    assert.equal(after.value, 10);
}

// --- most specific wins ---------------------------------------------------
{
    const platform = sched({ _id: 'p', restaurantId: null, commission: { type: 'percentage', value: 30 } });
    const mine = sched({ _id: 'm', restaurantId: R1, commission: { type: 'percentage', value: 15 } });

    const r1 = resolveCommissionRate({ defaultRule, schedules: [platform, mine], restaurantId: R1, at: D('2026-10-05T00:00:00Z') });
    assert.equal(r1.value, 15, 'a restaurant-specific schedule beats a platform-wide one');
    assert.equal(r1.source, COMMISSION_SOURCES.SCHEDULE_RESTAURANT);

    // Another restaurant is unaffected by R1's private deal.
    const r2 = resolveCommissionRate({ defaultRule, schedules: [platform, mine], restaurantId: R2, at: D('2026-10-05T00:00:00Z') });
    assert.equal(r2.value, 30);
    assert.equal(r2.source, COMMISSION_SOURCES.SCHEDULE_PLATFORM);
}

// --- overlapping schedules of the same specificity: newest start wins -----
{
    const older = sched({ _id: 'a', startsAt: D('2026-10-01T00:00:00Z'), commission: { type: 'percentage', value: 20 } });
    const newer = sched({ _id: 'b', startsAt: D('2026-10-03T00:00:00Z'), commission: { type: 'percentage', value: 35 } });
    const r = resolveCommissionRate({ defaultRule, schedules: [older, newer], restaurantId: R1, at: D('2026-10-05T00:00:00Z') });
    assert.equal(r.value, 35);
    assert.equal(r.scheduleId, 'b');
}

// --- nothing configured at all -------------------------------------------
{
    const r = resolveCommissionRate({ defaultRule: null, schedules: [], restaurantId: R1, at: D('2026-10-05T00:00:00Z') });
    assert.equal(r.value, 0);
    assert.equal(r.source, COMMISSION_SOURCES.NONE);
    assert.equal(computeCommissionAmount(300, r), 0);
}
// A disabled default is not used.
assert.equal(
    resolveCommissionRate({ defaultRule: { ...defaultRule, status: false }, schedules: [], restaurantId: R1 }).source,
    COMMISSION_SOURCES.NONE
);

// --- the amount ----------------------------------------------------------
assert.equal(computeCommissionAmount(100, { type: 'percentage', value: 10 }), 10);  // the client's example
assert.equal(computeCommissionAmount(100, { type: 'amount', value: 15 }), 15);
assert.equal(computeCommissionAmount(0, { type: 'percentage', value: 50 }), 0);
// Never more than the bill it is charged against, however it is misconfigured.
assert.equal(computeCommissionAmount(100, { type: 'amount', value: 500 }), 100);
assert.equal(computeCommissionAmount(100, { type: 'percentage', value: 500 }), 100);
// Junk is 0, not NaN -- a NaN here would poison the order total.
assert.equal(computeCommissionAmount('abc', { type: 'percentage', value: 10 }), 0);
assert.equal(computeCommissionAmount(100, { type: 'percentage', value: 'abc' }), 0);
assert.equal(computeCommissionAmount(100, null), 0);
assert.equal(computeCommissionAmount(-50, { type: 'percentage', value: 10 }), 0);
// Rounded to paise.
assert.equal(computeCommissionAmount(99.99, { type: 'percentage', value: 10 }), 10);

// --- admin input ---------------------------------------------------------
{
    const n = normalizeScheduleInput({
        label: ' Diwali ', commission: { type: 'percentage', value: 30 },
        startsAt: '2026-10-01', endsAt: '2026-10-10',
    });
    assert.equal(n.label, 'Diwali');
    assert.equal(n.commission.value, 30);
    assert.equal(n.restaurantId, null);   // platform-wide
    assert.equal(n.status, true);
}
throws(() => normalizeScheduleInput({ commission: { value: -1 }, startsAt: '2026-10-01', endsAt: '2026-10-10' }), /0 or more/);
throws(() => normalizeScheduleInput({ commission: { type: 'percentage', value: 101 }, startsAt: '2026-10-01', endsAt: '2026-10-10' }), /cannot exceed 100/);
throws(() => normalizeScheduleInput({ commission: { value: 10 }, startsAt: 'nope', endsAt: '2026-10-10' }), /Start date is invalid/);
throws(() => normalizeScheduleInput({ commission: { value: 10 }, startsAt: '2026-10-01', endsAt: 'nope' }), /End date is invalid/);
throws(() => normalizeScheduleInput({ commission: { value: 10 }, startsAt: '2026-10-10', endsAt: '2026-10-01' }), /after the start date/);
throws(() => normalizeScheduleInput({ commission: { value: 10 }, startsAt: '2026-10-01', endsAt: '2026-10-01' }), /after the start date/);
// A flat amount above 100 is fine -- only percentages are capped.
assert.equal(normalizeScheduleInput({ commission: { type: 'amount', value: 250 }, startsAt: '2026-10-01', endsAt: '2026-10-10' }).commission.value, 250);

console.log('All commission-schedule checks passed.');
