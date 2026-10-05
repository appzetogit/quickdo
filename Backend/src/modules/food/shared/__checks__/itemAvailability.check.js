/**
 * Self-check for per-item availability windows.
 * Run: node src/modules/food/shared/__checks__/itemAvailability.check.js
 */
import assert from 'node:assert/strict';
import {
    DAY_NAMES,
    describeTodaysWindow,
    getZonedDayAndMinutes,
    isItemAvailableAt,
    normalizeAvailabilityScheduleInput,
    normalizeTimeOfDay,
    normalizeWindowMode,
    WINDOW_MODES
} from '../itemAvailability.js';

const throws = (fn) => assert.throws(fn, { name: 'ValidationError' });

/** Build a schedule where only `day` is on, for `start`-`end`. */
const only = (day, start, end, extra = {}) => ({
    isEnabled: true,
    timezone: 'Asia/Kolkata',
    days: DAY_NAMES.map((d) => ({
        day: d,
        isAvailable: d === day,
        startTime: d === day ? start : '09:00',
        endTime: d === day ? end : '22:00'
    })),
    ...extra
});

/** A UTC instant for a given IST wall-clock time. IST is UTC+5:30, no DST. */
const ist = (iso) => new Date(`${iso}+05:30`);

// --- time parsing ---------------------------------------------------------
assert.equal(normalizeTimeOfDay('9:05'), '09:05');
assert.equal(normalizeTimeOfDay('23:59'), '23:59');
assert.equal(normalizeTimeOfDay('24:00', null), null);
assert.equal(normalizeTimeOfDay('12:60', null), null);
assert.equal(normalizeTimeOfDay('', 'x'), 'x');
assert.equal(normalizeTimeOfDay(null, 'x'), 'x');

// --- timezone: the whole reason this helper exists ------------------------
// 2026-08-24 is a Monday. 05:00 UTC is 10:30 IST the same day.
{
    const z = getZonedDayAndMinutes(new Date('2026-08-24T05:00:00Z'), 'Asia/Kolkata');
    assert.equal(z.day, 'Monday');
    assert.equal(z.minutes, 10 * 60 + 30);
}
// 20:00 UTC Monday is already 01:30 IST on Tuesday -- the case a UTC-naive
// implementation gets wrong.
{
    const z = getZonedDayAndMinutes(new Date('2026-08-24T20:00:00Z'), 'Asia/Kolkata');
    assert.equal(z.day, 'Tuesday');
    assert.equal(z.minutes, 90);
}
// An unknown zone must not throw; it falls back to IST.
assert.equal(getZonedDayAndMinutes(new Date('2026-08-24T05:00:00Z'), 'Not/AZone').day, 'Monday');

// --- disabled or absent means always available ----------------------------
assert.equal(isItemAvailableAt(undefined), true);
assert.equal(isItemAvailableAt(null), true);
assert.equal(isItemAvailableAt({ isEnabled: false, days: [] }), true);
// Enabled but with no day entries is treated as unrestricted rather than hiding.
assert.equal(isItemAvailableAt({ isEnabled: true, days: [] }), true);

// --- a normal daytime window ---------------------------------------------
{
    const breakfast = only('Monday', '08:00', '11:30');
    assert.equal(isItemAvailableAt(breakfast, ist('2026-08-24T08:00:00')), true);  // at open
    assert.equal(isItemAvailableAt(breakfast, ist('2026-08-24T10:00:00')), true);  // inside
    assert.equal(isItemAvailableAt(breakfast, ist('2026-08-24T07:59:00')), false); // before
    assert.equal(isItemAvailableAt(breakfast, ist('2026-08-24T11:30:00')), false); // end exclusive
    assert.equal(isItemAvailableAt(breakfast, ist('2026-08-25T10:00:00')), false); // Tuesday off
}

// --- overnight window: the case that breaks naive comparisons -------------
{
    const lateNight = only('Friday', '22:00', '02:00');
    // 2026-08-28 is a Friday.
    assert.equal(isItemAvailableAt(lateNight, ist('2026-08-28T22:00:00')), true);  // opens Friday
    assert.equal(isItemAvailableAt(lateNight, ist('2026-08-28T23:30:00')), true);  // before midnight
    assert.equal(isItemAvailableAt(lateNight, ist('2026-08-29T01:00:00')), true);  // Saturday tail
    assert.equal(isItemAvailableAt(lateNight, ist('2026-08-29T02:00:00')), false); // tail ended
    assert.equal(isItemAvailableAt(lateNight, ist('2026-08-28T21:59:00')), false); // before open
    // Saturday evening must NOT be covered: Saturday's own entry is off, and
    // Friday's window only lends its post-midnight tail.
    assert.equal(isItemAvailableAt(lateNight, ist('2026-08-29T23:00:00')), false);
}

// --- a window that wraps into a day which is itself enabled ---------------
{
    const everyDayLate = {
        isEnabled: true,
        timezone: 'Asia/Kolkata',
        days: DAY_NAMES.map((d) => ({ day: d, isAvailable: true, startTime: '18:00', endTime: '01:00' }))
    };
    assert.equal(isItemAvailableAt(everyDayLate, ist('2026-08-24T19:00:00')), true);
    assert.equal(isItemAvailableAt(everyDayLate, ist('2026-08-25T00:30:00')), true);  // yesterday's tail
    assert.equal(isItemAvailableAt(everyDayLate, ist('2026-08-25T02:00:00')), false); // gap
}

// --- start === end is treated as all day ----------------------------------
assert.equal(isItemAvailableAt(only('Monday', '00:00', '00:00'), ist('2026-08-24T13:00:00')), true);

// --- normalization --------------------------------------------------------
assert.equal(normalizeAvailabilityScheduleInput(undefined), undefined); // untouched on partial update
assert.deepEqual(normalizeAvailabilityScheduleInput(null).isEnabled, false);
{
    const n = normalizeAvailabilityScheduleInput({ isEnabled: true, days: [{ day: 'Mon', startTime: '8:00', endTime: '11:30' }] });
    assert.equal(n.isEnabled, true);
    assert.equal(n.days.length, 7);
    assert.equal(n.timezone, 'Asia/Kolkata');
    const mon = n.days.find((d) => d.day === 'Monday');
    assert.equal(mon.startTime, '08:00'); // padded
    assert.equal(mon.endTime, '11:30');
    // Days the caller omitted default to available with the default window.
    assert.equal(n.days.find((d) => d.day === 'Sunday').isAvailable, true);
}
{
    // The keyed form the outlet-timings screen already uses.
    const n = normalizeAvailabilityScheduleInput({
        isEnabled: true,
        days: { Monday: { isAvailable: true, startTime: '07:00', endTime: '10:00' } }
    });
    assert.equal(n.days.find((d) => d.day === 'Monday').startTime, '07:00');
}
// Garbage times fall back rather than storing something unparseable.
{
    const n = normalizeAvailabilityScheduleInput({ isEnabled: true, days: [{ day: 'Monday', startTime: 'nonsense', endTime: '99:99' }] });
    const mon = n.days.find((d) => d.day === 'Monday');
    assert.equal(mon.startTime, '09:00');
    assert.equal(mon.endTime, '22:00');
}
// An unknown timezone falls back rather than being stored and failing later.
assert.equal(normalizeAvailabilityScheduleInput({ isEnabled: true, timezone: 'Not/AZone' }).timezone, 'Asia/Kolkata');

throws(() => normalizeAvailabilityScheduleInput('nope'));
throws(() => normalizeAvailabilityScheduleInput([1, 2]));
// Enabled with every day off would hide the item forever.
throws(() => normalizeAvailabilityScheduleInput({
    isEnabled: true,
    days: DAY_NAMES.map((d) => ({ day: d, isAvailable: false }))
}));
// The same shape is fine while disabled.
assert.equal(
    normalizeAvailabilityScheduleInput({ isEnabled: false, days: DAY_NAMES.map((d) => ({ day: d, isAvailable: false })) }).isEnabled,
    false
);

// --- refusal message ------------------------------------------------------
assert.match(describeTodaysWindow(only('Monday', '08:00', '11:30'), ist('2026-08-24T13:00:00')), /08:00-11:30 on Monday/);
assert.match(describeTodaysWindow(only('Monday', '08:00', '11:30'), ist('2026-08-25T13:00:00')), /not available on Tuesday/);
assert.equal(describeTodaysWindow(null), '');

// --- the kitchen break: a window that means OFF, not ON ---------------------
/*
 * The bug this exists for. A restaurant wanting a dish off between noon and
 * three had one control, and it meant the opposite: the dish sold for exactly
 * those three hours and no others. A day now carries which way its window
 * reads.
 */

/** Every day on, with `day` carrying a closure from `start` to `end`. */
const breakOn = (day, start, end) => ({
    isEnabled: true,
    timezone: 'Asia/Kolkata',
    days: DAY_NAMES.map((d) => ({
        day: d,
        isAvailable: true,
        startTime: d === day ? start : '00:00',
        endTime: d === day ? end : '00:00',
        mode: d === day ? WINDOW_MODES.UNAVAILABLE : WINDOW_MODES.AVAILABLE
    }))
});

{
    // Monday, off 12:00-15:00.
    const s = breakOn('Monday', '12:00', '15:00');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T09:00:00')), true, 'morning is on');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T11:59:00')), true, 'right up to the break');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T12:00:00')), false, 'the break starts');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T14:59:00')), false, 'still in the break');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T15:00:00')), true, 'the break ends');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T22:00:00')), true, 'evening is on');
}

{
    // The same hours the old way round, to show the two are opposites and that
    // the original meaning is untouched.
    const on = only('Monday', '12:00', '15:00');
    const off = breakOn('Monday', '12:00', '15:00');
    for (const at of ['2026-08-24T09:00:00', '2026-08-24T13:00:00', '2026-08-24T18:00:00']) {
        assert.notEqual(
            isItemAvailableAt(on, ist(at)),
            isItemAvailableAt(off, ist(at)),
            `both modes agree at ${at}, so the mode is being ignored`
        );
    }
}

{
    // A break running past midnight closes the tail of the following day.
    const s = breakOn('Monday', '23:00', '02:00');
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T22:59:00')), true);
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T23:30:00')), false, 'break started');
    assert.equal(isItemAvailableAt(s, ist('2026-08-25T01:30:00')), false, 'still shut after midnight');
    assert.equal(isItemAvailableAt(s, ist('2026-08-25T02:30:00')), true, 'open again on Tuesday');
}

{
    // A closure beats an overnight "available" window still running from
    // yesterday: whoever typed the closure meant it.
    const s = {
        isEnabled: true,
        timezone: 'Asia/Kolkata',
        days: DAY_NAMES.map((d) => {
            if (d === 'Monday') return { day: d, isAvailable: true, startTime: '22:00', endTime: '04:00', mode: 'available' };
            if (d === 'Tuesday') return { day: d, isAvailable: true, startTime: '00:00', endTime: '06:00', mode: 'unavailable' };
            return { day: d, isAvailable: false, startTime: '09:00', endTime: '22:00', mode: 'available' };
        })
    };
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T23:00:00')), true, 'Monday night window is open');
    assert.equal(isItemAvailableAt(s, ist('2026-08-25T01:00:00')), false, "Tuesday's closure wins");
}

{
    // A day switched off entirely is still off, whatever its mode says.
    const s = breakOn('Monday', '12:00', '15:00');
    s.days = s.days.map((d) => (d.day === 'Monday' ? { ...d, isAvailable: false } : d));
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T09:00:00')), false);
    assert.equal(isItemAvailableAt(s, ist('2026-08-24T13:00:00')), false);
}

// The refusal message says which way the window reads, or it reads as a lie.
assert.match(
    describeTodaysWindow(breakOn('Monday', '12:00', '15:00'), ist('2026-08-24T13:00:00')),
    /not available 12:00-15:00 on Monday/
);

// --- mode normalization ----------------------------------------------------
assert.equal(normalizeWindowMode('unavailable'), WINDOW_MODES.UNAVAILABLE);
assert.equal(normalizeWindowMode('UNAVAILABLE'), WINDOW_MODES.UNAVAILABLE);
assert.equal(normalizeWindowMode('off'), WINDOW_MODES.UNAVAILABLE, 'the word a panel might send');
assert.equal(normalizeWindowMode('break'), WINDOW_MODES.UNAVAILABLE);
assert.equal(normalizeWindowMode('available'), WINDOW_MODES.AVAILABLE);
// Anything unrecognised must read as 'available': that is what every schedule
// stored before modes existed means, and guessing 'unavailable' from a typo
// would hide an item its owner never closed.
assert.equal(normalizeWindowMode(undefined), WINDOW_MODES.AVAILABLE);
assert.equal(normalizeWindowMode(''), WINDOW_MODES.AVAILABLE);
assert.equal(normalizeWindowMode('nonsense'), WINDOW_MODES.AVAILABLE);
assert.equal(normalizeWindowMode(null), WINDOW_MODES.AVAILABLE);

{
    // It survives the round trip, and defaults on a day that omits it.
    const n = normalizeAvailabilityScheduleInput({
        isEnabled: true,
        days: [
            { day: 'Monday', startTime: '12:00', endTime: '15:00', mode: 'unavailable' },
            { day: 'Tuesday', startTime: '08:00', endTime: '11:00' }
        ]
    });
    assert.equal(n.days.find((d) => d.day === 'Monday').mode, 'unavailable');
    assert.equal(n.days.find((d) => d.day === 'Tuesday').mode, 'available');
    assert.equal(n.days.find((d) => d.day === 'Sunday').mode, 'available');
}

{
    // A schedule whose days are all closures is not "every day off" -- those
    // days are open either side of the break, and refusing to save it would be
    // refusing the ordinary case this feature was added for.
    const saved = normalizeAvailabilityScheduleInput({
        isEnabled: true,
        days: DAY_NAMES.map((d) => ({ day: d, startTime: '12:00', endTime: '15:00', mode: 'unavailable' }))
    });
    assert.equal(saved.isEnabled, true);
    assert.equal(isItemAvailableAt(saved, ist('2026-08-24T09:00:00')), true);
    assert.equal(isItemAvailableAt(saved, ist('2026-08-24T13:00:00')), false);
}

console.log('All item-availability checks passed.');
