/**
 * Outlet trading hours.
 *
 * Run: node src/modules/food/shared/__checks__/outletHours.check.js
 *
 * Times below are built as UTC instants and asserted against Asia/Kolkata,
 * which is +05:30 with no daylight saving -- so 03:30 UTC is 09:00 local. That
 * offset is the bug this guards: evaluating "09:00-22:00" against the server's
 * UTC clock put every outlet's hours five and a half hours out.
 */
import assert from 'node:assert/strict';
import {
    describeOutletHours,
    isOutletOpen,
    resolveOutletSchedule,
} from '../outletHours.js';

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

/** A UTC instant that reads as `hh:mm` in Kolkata on the given date. */
const istAt = (isoDate, hh, mm = 0) => {
    const utcMinutes = hh * 60 + mm - (5 * 60 + 30);
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCMinutes(d.getUTCMinutes() + utcMinutes);
    return d;
};

// 2026-09-07 is a Monday, 2026-09-13 a Sunday.
const MONDAY = '2026-09-07';
const SUNDAY = '2026-09-13';

const nineToTen = {
    timings: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day) => ({
        day, isOpen: true, openingTime: '09:00', closingTime: '22:00',
    })).concat([{ day: 'Sunday', isOpen: false, openingTime: '', closingTime: '' }]),
};

console.log('\nan outlet trading 09:00-22:00, closed Sunday');
check('open at 10:00 Monday', () =>
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(MONDAY, 10) }), true));
check('shut at 08:59 Monday', () =>
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(MONDAY, 8, 59) }), false));
check('shut at 22:00 Monday, the minute it closes', () =>
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(MONDAY, 22) }), false));
check('open at 21:59 Monday', () =>
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(MONDAY, 21, 59) }), true));
check('shut all day Sunday', () => {
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(SUNDAY, 13) }), false);
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(SUNDAY, 4) }), false);
});
check('shut at 04:00 Monday -- the reported case', () =>
    assert.equal(isOutletOpen({ timingsDoc: nineToTen, when: istAt(MONDAY, 4) }), false));

console.log('\nthe timezone, which is the whole point');
check('03:30 UTC is 09:00 in Kolkata, so the outlet is open', () =>
    assert.equal(isOutletOpen({
        timingsDoc: nineToTen,
        when: new Date('2026-09-07T03:30:00.000Z'),
    }), true));
check('03:29 UTC is 08:59 in Kolkata, so it is not', () =>
    assert.equal(isOutletOpen({
        timingsDoc: nineToTen,
        when: new Date('2026-09-07T03:29:00.000Z'),
    }), false));

console.log('\novernight hours');
const lateNight = {
    timings: [{ day: 'Monday', isOpen: true, openingTime: '18:00', closingTime: '02:00' }],
};
check('open at 23:00 Monday', () =>
    assert.equal(isOutletOpen({ timingsDoc: lateNight, when: istAt(MONDAY, 23) }), true));
check('still open at 01:00 Tuesday, on Monday row', () =>
    assert.equal(isOutletOpen({ timingsDoc: lateNight, when: istAt('2026-09-08', 1) }), true));
check('shut at 03:00 Tuesday', () =>
    assert.equal(isOutletOpen({ timingsDoc: lateNight, when: istAt('2026-09-08', 3) }), false));
check('shut at 17:00 Monday, before it opens', () =>
    assert.equal(isOutletOpen({ timingsDoc: lateNight, when: istAt(MONDAY, 17) }), false));

console.log('\nrestaurants that have said nothing');
check('no schedule at all means open, not closed', () => {
    const d = describeOutletHours({ when: istAt(MONDAY, 4) });
    assert.equal(d.isOpen, true);
    assert.equal(d.hasSchedule, false);
});
check('an empty timings array falls through to the flat fields', () => {
    const d = describeOutletHours({
        timingsDoc: { timings: [] },
        restaurant: { openingTime: '11:00', closingTime: '23:00' },
        when: istAt(MONDAY, 10),
    });
    assert.equal(d.isOpen, false);
    assert.equal(d.hasSchedule, true);
});
check('flat fields with openDays', () => {
    const restaurant = { openingTime: '09:00', closingTime: '18:00', openDays: ['Mon', 'Tue'] };
    assert.equal(isOutletOpen({ restaurant, when: istAt(MONDAY, 10) }), true);
    assert.equal(isOutletOpen({ restaurant, when: istAt('2026-09-09', 10) }), false, 'Wednesday');
});
check('per-day rows beat the flat fields', () => {
    // The panel writes rows; the flat fields are stale. The rows must win.
    const d = describeOutletHours({
        timingsDoc: nineToTen,
        restaurant: { openingTime: '00:00', closingTime: '23:59' },
        when: istAt(SUNDAY, 13),
    });
    assert.equal(d.isOpen, false, 'Sunday is closed per the rows');
});
check('a row marked open with no times is open all day', () =>
    assert.equal(isOutletOpen({
        timingsDoc: { timings: [{ day: 'Monday', isOpen: true }] },
        when: istAt(MONDAY, 4),
    }), true));

console.log('\nwhat the badge shows');
check('closed before opening reports opensAt', () => {
    const d = describeOutletHours({ timingsDoc: nineToTen, when: istAt(MONDAY, 7) });
    assert.equal(d.isOpen, false);
    assert.equal(d.opensAt, '09:00');
    assert.equal(d.closesAt, null);
});
check('open reports closesAt', () => {
    const d = describeOutletHours({ timingsDoc: nineToTen, when: istAt(MONDAY, 12) });
    assert.equal(d.isOpen, true);
    assert.equal(d.closesAt, '22:00');
    assert.equal(d.opensAt, null);
});
check('closed after closing does not claim it opens again today', () => {
    const d = describeOutletHours({ timingsDoc: nineToTen, when: istAt(MONDAY, 23) });
    assert.equal(d.isOpen, false);
    assert.equal(d.opensAt, null);
});

console.log('\nschedule resolution');
check('resolveOutletSchedule returns null when nothing is set', () =>
    assert.equal(resolveOutletSchedule({}), null));
check('unparseable day names are dropped, not guessed', () => {
    const s = resolveOutletSchedule({ timingsDoc: { timings: [{ day: 'Blursday', isOpen: true }] } });
    assert.equal(s, null, 'no usable rows falls through to the flat fields, which are absent');
});

console.log(failed ? `\n${failed} FAILED\n` : '\nall outlet hours checks passed\n');
process.exit(failed ? 1 : 0);
