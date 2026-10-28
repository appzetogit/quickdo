/**
 * Which setting wins, and the ability to say why.
 *
 * Today a rule that applies to the whole platform is stored once per vertical --
 * `FoodFeeSettings`, its quick-commerce fork, taxi's `AdminBusinessSetting`, SP's
 * `Settings` -- so "the cash limit is 2000" is four facts that can disagree, and
 * an admin who changes one has changed it for one vertical. There is no way to
 * express "2000 everywhere, 2500 for taxi, 2200 in Indore, 1500 for this driver"
 * at all, and no way to answer "why is this partner's limit 1500?".
 *
 * This is the precedence, kept pure so it can be checked without a database and
 * without the models that will eventually feed it.
 *
 *     PARTNER  >  CITY/ZONE  >  VERTICAL  >  GLOBAL
 *
 * More specific always wins. The ordering is not negotiable per key: a scheme
 * where some keys resolve city-first and others vertical-first is one an operator
 * cannot hold in their head, and an operator who cannot predict the outcome will
 * not trust the panel.
 *
 * Every resolution reports the LEVEL it came from. That is not a nicety -- it is
 * the difference between a system that can be administered and one that has to be
 * debugged. "Effective 1500, source: partner override, set by X on the 3rd" is an
 * answer; "1500" is a mystery.
 */

/** Most specific first. Index order IS the precedence. */
export const SCOPE_LEVELS = Object.freeze(['partner', 'zone', 'vertical', 'global']);

export const SCOPE_LABELS = Object.freeze({
    partner: 'Partner override',
    zone: 'City / zone override',
    vertical: 'Vertical override',
    global: 'Global default',
});

/**
 * The scope identifiers to look for, in precedence order, for a given request.
 *
 * A level with no id is skipped rather than matched against null -- otherwise a
 * job with no zone would match every setting whose scopeId happens to be unset,
 * which is how a "global" row ends up being read as a zone override.
 */
export function candidateScopes({ partnerId, zoneId, vertical } = {}) {
    const out = [];
    if (partnerId) out.push({ level: 'partner', scopeId: String(partnerId) });
    if (zoneId) out.push({ level: 'zone', scopeId: String(zoneId) });
    if (vertical) out.push({ level: 'vertical', scopeId: String(vertical) });
    out.push({ level: 'global', scopeId: '*' });
    return out;
}

const rank = (level) => {
    const i = SCOPE_LEVELS.indexOf(level);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

/**
 * Pick the winning row for one key from whatever the store returned.
 *
 * @param {Array<{level: string, scopeId: string, key: string, value: any, updatedBy?: string, updatedAt?: Date}>} rows
 * @param {object} context  { partnerId, zoneId, vertical }
 * @returns {{found: boolean, value: any, level: string|null, scopeId: string|null, source: string|null, row: object|null}}
 *
 * Rows that do not match this context are IGNORED rather than ranked -- a setting
 * scoped to a different partner must not win just because 'partner' outranks
 * 'global'. That is the bug this function exists to not have.
 */
export function pickWinner(rows, context = {}) {
    const wanted = new Map(candidateScopes(context).map((s) => [`${s.level}:${s.scopeId}`, s]));

    let best = null;
    for (const row of Array.isArray(rows) ? rows : []) {
        const key = `${row?.level}:${row?.scopeId}`;
        if (!wanted.has(key)) continue;
        // Undefined and null are "not set". A level that exists but holds no value
        // must fall through to the next, or creating an empty override silently
        // blanks the setting for everyone under it.
        if (row?.value === undefined || row?.value === null) continue;
        if (!best || rank(row.level) < rank(best.level)) best = row;
    }

    if (!best) {
        return { found: false, value: undefined, level: null, scopeId: null, source: null, row: null };
    }

    return {
        found: true,
        value: best.value,
        level: best.level,
        scopeId: best.scopeId,
        source: SCOPE_LABELS[best.level] || best.level,
        row: best,
    };
}

/**
 * Every level's value for one key, most specific first -- what the admin panel
 * shows greyed out beneath the effective one, so an operator can see the whole
 * chain rather than guessing which override is in play.
 */
export function explain(rows, context = {}) {
    const scopes = candidateScopes(context);
    const byKey = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        byKey.set(`${row?.level}:${row?.scopeId}`, row);
    }

    const chain = scopes.map(({ level, scopeId }) => {
        const row = byKey.get(`${level}:${scopeId}`);
        const set = Boolean(row) && row.value !== undefined && row.value !== null;
        return {
            level,
            scopeId,
            label: SCOPE_LABELS[level],
            set,
            value: set ? row.value : undefined,
            updatedBy: row?.updatedBy || null,
            updatedAt: row?.updatedAt || null,
        };
    });

    const winner = pickWinner(rows, context);
    return {
        effective: winner.found ? winner.value : undefined,
        source: winner.source,
        level: winner.level,
        chain: chain.map((c) => ({ ...c, effective: winner.found && c.level === winner.level })),
    };
}

export const __testables = { rank };
