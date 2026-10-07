/**
 * Reporting periods in Indian time.
 *
 * Every restaurant report, analytics series and settlement statement is cut on
 * IST calendar days, whatever timezone the server runs in. India has no
 * daylight saving, so a fixed +05:30 offset is exact; MongoDB is given the
 * IANA name (REPORT_TIMEZONE) for $dateTrunc / $dateToString so both sides
 * bucket identically.
 *
 * Nothing here knows about orders: food and quick commerce can both cut their
 * periods with it.
 */

export const REPORT_TIMEZONE = 'Asia/Kolkata';
const OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const GROUP_BY = Object.freeze(['day', 'week', 'month']);

export class PeriodError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

/** IST wall-clock parts of an instant. */
export function istParts(date) {
    const shifted = new Date(new Date(date).getTime() + OFFSET_MS);
    return {
        y: shifted.getUTCFullYear(),
        m: shifted.getUTCMonth(),
        d: shifted.getUTCDate(),
        dow: shifted.getUTCDay(),
    };
}

/** The instant an IST calendar day begins. Month/day may overflow, like Date.UTC. */
export const istMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - OFFSET_MS);

const pad = (n) => String(n).padStart(2, '0');
export const istDayKey = (date) => {
    const p = istParts(date);
    return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
};

/** 'YYYY-MM-DD' is an IST day; anything else Date can read is taken as given. */
export function parseDay(value) {
    if (value === undefined || value === null || value === '') return null;
    const s = String(value).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]) - 1;
        const d = Number(m[3]);
        const out = istMidnight(y, mo, d);
        // Reject 2026-02-31 and friends rather than rolling them over.
        const back = istParts(out);
        if (back.y !== y || back.m !== mo || back.d !== d) return null;
        return out;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * from/to are inclusive IST days. Returns [start, end) instants.
 *
 * Defaults to the last `defaultDays` days ending today. Refuses ranges longer
 * than `maxDays`, so one request cannot ask the database to scan years.
 */
export function parseRange({ from, to } = {}, { defaultDays = 30, maxDays = 366, now = new Date() } = {}) {
    const fromProvided = from !== undefined && from !== null && from !== '';
    const toProvided = to !== undefined && to !== null && to !== '';
    let toDay = toProvided ? parseDay(to) : null;
    if (toProvided && !toDay) throw new PeriodError('`to` must be a date (YYYY-MM-DD)');
    let fromDay = fromProvided ? parseDay(from) : null;
    if (fromProvided && !fromDay) throw new PeriodError('`from` must be a date (YYYY-MM-DD)');

    if (!toDay) {
        const p = istParts(now);
        toDay = istMidnight(p.y, p.m, p.d);
    } else {
        const p = istParts(toDay);
        toDay = istMidnight(p.y, p.m, p.d);
    }
    if (!fromDay) {
        const p = istParts(toDay);
        fromDay = istMidnight(p.y, p.m, p.d - (defaultDays - 1));
    } else {
        const p = istParts(fromDay);
        fromDay = istMidnight(p.y, p.m, p.d);
    }
    if (fromDay > toDay) throw new PeriodError('`from` must be on or before `to`');
    const end = new Date(toDay.getTime() + DAY_MS);
    const days = Math.round((end - fromDay) / DAY_MS);
    if (days > maxDays) throw new PeriodError(`A report can cover at most ${maxDays} days`);
    return { start: fromDay, end, from: istDayKey(fromDay), to: istDayKey(toDay), days };
}

export function normalizeGroupBy(value, fallback = 'day') {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return fallback;
    if (!GROUP_BY.includes(v)) throw new PeriodError('`groupBy` must be day, week or month');
    return v;
}

/** Start of the IST day / Monday-week / month containing `date`. */
export function bucketStart(date, groupBy) {
    const p = istParts(date);
    if (groupBy === 'month') return istMidnight(p.y, p.m, 1);
    if (groupBy === 'week') return istMidnight(p.y, p.m, p.d - ((p.dow + 6) % 7));
    return istMidnight(p.y, p.m, p.d);
}

function nextBucket(start, groupBy) {
    const p = istParts(start);
    if (groupBy === 'month') return istMidnight(p.y, p.m + 1, 1);
    if (groupBy === 'week') return istMidnight(p.y, p.m, p.d + 7);
    return istMidnight(p.y, p.m, p.d + 1);
}

export function bucketLabel(start, groupBy) {
    const p = istParts(start);
    if (groupBy === 'month') return `${MONTHS[p.m]} ${p.y}`;
    if (groupBy === 'week') return `Week of ${p.d} ${MONTHS[p.m]}`;
    return `${p.d} ${MONTHS[p.m]}`;
}

/** Every bucket overlapping [start, end), in order, so a chart has no gaps. */
export function listBuckets(start, end, groupBy) {
    const out = [];
    let cur = bucketStart(start, groupBy);
    let guard = 0;
    while (cur < end && guard < 1000) {
        const next = nextBucket(cur, groupBy);
        out.push({ key: istDayKey(cur), start: cur, end: next, label: bucketLabel(cur, groupBy) });
        cur = next;
        guard += 1;
    }
    return out;
}

/* ------------------------------------------------------------------------ */
/* Settlement cycles                                                        */
/* ------------------------------------------------------------------------ */

/**
 * A restaurant settlement cycle runs from the 15th of one month (00:00 IST) to
 * the 15th of the next, matching the "current cycle" the finance screen has
 * always shown (restaurantFinance.service getFixedCurrentCycleWindow). A cycle
 * is named by the month it starts in: "2026-09" is 15 Sep - 14 Oct 2026.
 */
export const CYCLE_START_DAY = 15;

const CYCLE_ID = /^(\d{4})-(\d{2})$/;

export function cycleIdFor(date = new Date()) {
    const p = istParts(date);
    let y = p.y;
    let m = p.m;
    if (p.d < CYCLE_START_DAY) {
        m -= 1;
        if (m < 0) { m = 11; y -= 1; }
    }
    return `${y}-${pad(m + 1)}`;
}

export function cycleWindow(id, { now = new Date() } = {}) {
    const match = CYCLE_ID.exec(String(id || '').trim());
    if (!match) throw new PeriodError('Settlement cycle must look like YYYY-MM');
    const y = Number(match[1]);
    const m = Number(match[2]) - 1;
    if (m < 0 || m > 11) throw new PeriodError('Settlement cycle must look like YYYY-MM');
    const start = istMidnight(y, m, CYCLE_START_DAY);
    const end = istMidnight(y, m + 1, CYCLE_START_DAY);
    const lastDay = new Date(end.getTime() - DAY_MS);
    const ep = istParts(lastDay);
    return {
        id: `${y}-${pad(m + 1)}`,
        start,
        end,
        from: istDayKey(start),
        to: istDayKey(lastDay),
        label: `${CYCLE_START_DAY} ${MONTHS[m]} ${y} - ${ep.d} ${MONTHS[ep.m]} ${ep.y}`,
        status: end <= now ? 'closed' : (start <= now ? 'open' : 'upcoming'),
    };
}

/** The latest `count` cycles, newest first, current (open) cycle included. */
export function recentCycles(count = 6, { now = new Date() } = {}) {
    const n = Math.max(1, Math.min(36, Number(count) || 6));
    const [y0, m0] = cycleIdFor(now).split('-').map(Number);
    const out = [];
    for (let i = 0; i < n; i += 1) {
        const d = new Date(Date.UTC(y0, m0 - 1 - i, 1));
        out.push(cycleWindow(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`, { now }));
    }
    return out;
}
