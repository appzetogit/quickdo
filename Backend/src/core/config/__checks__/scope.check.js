/**
 * Which override wins, and whether the system can say why.
 *
 * Run: node src/core/config/__checks__/scope.check.js
 *
 * Pure precedence, no database. Two things are worth pinning down:
 *
 *   1. more specific always wins -- PARTNER > ZONE > VERTICAL > GLOBAL, with no
 *      per-key exceptions, because a scheme an operator cannot predict is one
 *      they will not trust;
 *   2. a row scoped to somebody ELSE never wins just because its LEVEL outranks.
 *      That is the bug this is really guarding: 'partner' beats 'global', so a
 *      naive ranking hands a different partner's override to this one.
 */
import assert from 'node:assert/strict';
import { pickWinner, explain, candidateScopes, SCOPE_LEVELS } from '../scope.js';
import { coerce, assertScopeAllowed, definitionOf, SETTINGS } from '../registry.js';

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

const KEY = 'finance.cashLimit';
const row = (level, scopeId, value) => ({ level, scopeId, key: KEY, value });
const CTX = { partnerId: 'p1', zoneId: 'indore', vertical: 'taxi' };

// --- precedence --------------------------------------------------------------
console.log('\nprecedence: more specific always wins');

check('THE EXAMPLE: global 2000, taxi 2500, Indore 2200, partner 1500 -> 1500', () => {
    const rows = [
        row('global', '*', 2000),
        row('vertical', 'taxi', 2500),
        row('zone', 'indore', 2200),
        row('partner', 'p1', 1500),
    ];
    const w = pickWinner(rows, CTX);
    assert.equal(w.value, 1500);
    assert.equal(w.level, 'partner');
    assert.equal(w.source, 'Partner override');
});

check('without a partner override, the zone wins', () => {
    const rows = [row('global', '*', 2000), row('vertical', 'taxi', 2500), row('zone', 'indore', 2200)];
    assert.equal(pickWinner(rows, CTX).value, 2200);
});

check('without a zone override, the vertical wins', () => {
    assert.equal(pickWinner([row('global', '*', 2000), row('vertical', 'taxi', 2500)], CTX).value, 2500);
});

check('with nothing else, global wins', () => {
    assert.equal(pickWinner([row('global', '*', 2000)], CTX).value, 2000);
});

check('with nothing at all, nothing is found', () => {
    const w = pickWinner([], CTX);
    assert.equal(w.found, false);
    assert.equal(w.value, undefined);
});

check('row order in the result set does not change the winner', () => {
    const rows = [row('global', '*', 2000), row('partner', 'p1', 1500)];
    assert.equal(pickWinner(rows, CTX).value, 1500);
    assert.equal(pickWinner([...rows].reverse(), CTX).value, 1500);
});

// --- the bug this exists to not have -----------------------------------------
console.log('\nsomebody else\'s override never wins');

check('a DIFFERENT partner\'s override is ignored', () => {
    // 'partner' outranks 'global', so a naive ranking hands p2's limit to p1.
    const rows = [row('global', '*', 2000), row('partner', 'p2', 100)];
    const w = pickWinner(rows, CTX);
    assert.equal(w.value, 2000);
    assert.equal(w.level, 'global');
});

check('a different zone\'s override is ignored', () => {
    const rows = [row('global', '*', 2000), row('zone', 'bhopal', 999)];
    assert.equal(pickWinner(rows, CTX).value, 2000);
});

check('a different vertical\'s override is ignored', () => {
    const rows = [row('global', '*', 2000), row('vertical', 'food', 500)];
    assert.equal(pickWinner(rows, CTX).value, 2000);
});

check('a request with no zone does not match zone-scoped rows', () => {
    // Otherwise a global row read as a zone override, or vice versa.
    const rows = [row('global', '*', 2000), row('zone', 'indore', 2200)];
    assert.equal(pickWinner(rows, { vertical: 'taxi' }).value, 2000);
});

check('a request with no partner does not match partner-scoped rows', () => {
    const rows = [row('global', '*', 2000), row('partner', 'p1', 1500)];
    assert.equal(pickWinner(rows, { vertical: 'taxi' }).value, 2000);
});

// --- unset levels fall through -----------------------------------------------
console.log('\nan empty override falls through, it does not blank the setting');

check('a partner row with a null value falls through to the zone', () => {
    // Creating an empty override must not silently blank the setting for everyone
    // beneath it.
    const rows = [row('global', '*', 2000), row('zone', 'indore', 2200), row('partner', 'p1', null)];
    assert.equal(pickWinner(rows, CTX).value, 2200);
});

check('an undefined value also falls through', () => {
    const rows = [row('global', '*', 2000), row('partner', 'p1', undefined)];
    assert.equal(pickWinner(rows, CTX).value, 2000);
});

check('a value of ZERO is a real value and does NOT fall through', () => {
    // 0 means "no ceiling" for the cash limit. Treating it as unset would silently
    // reinstate a limit an admin deliberately removed.
    const rows = [row('global', '*', 2000), row('partner', 'p1', 0)];
    assert.equal(pickWinner(rows, CTX).value, 0);
});

check('a value of FALSE is a real value and does not fall through', () => {
    const rows = [
        { level: 'global', scopeId: '*', key: 'x', value: true },
        { level: 'partner', scopeId: 'p1', key: 'x', value: false },
    ];
    assert.equal(pickWinner(rows, CTX).value, false);
});

// --- explainability ----------------------------------------------------------
console.log('\nthe chain is explainable, not just resolvable');

check('explain reports the effective value AND where it came from', () => {
    const rows = [row('global', '*', 2000), row('vertical', 'taxi', 2500), row('partner', 'p1', 1500)];
    const e = explain(rows, CTX);
    assert.equal(e.effective, 1500);
    assert.equal(e.source, 'Partner override');
});

check('the chain lists every level, most specific first, marking which are set', () => {
    const rows = [row('global', '*', 2000), row('partner', 'p1', 1500)];
    const e = explain(rows, CTX);
    assert.deepEqual(e.chain.map((c) => c.level), ['partner', 'zone', 'vertical', 'global']);
    assert.equal(e.chain[0].set, true);
    assert.equal(e.chain[1].set, false);
    assert.equal(e.chain[3].set, true);
});

check('exactly one level in the chain is marked effective', () => {
    const rows = [row('global', '*', 2000), row('zone', 'indore', 2200), row('partner', 'p1', 1500)];
    const e = explain(rows, CTX);
    assert.equal(e.chain.filter((c) => c.effective).length, 1);
    assert.equal(e.chain.find((c) => c.effective).level, 'partner');
});

check('candidate scopes are always most-specific-first and always end at global', () => {
    const s = candidateScopes(CTX);
    assert.deepEqual(s.map((x) => x.level), ['partner', 'zone', 'vertical', 'global']);
    assert.equal(s[s.length - 1].scopeId, '*');
});

check('the declared precedence order is the one used', () => {
    assert.deepEqual([...SCOPE_LEVELS], ['partner', 'zone', 'vertical', 'global']);
});

// --- the registry ------------------------------------------------------------
console.log('\nthe registry buys back the schema a key/value store gives away');

check('an unknown key is refused, not stored', () => {
    assert.throws(() => coerce('finance.cash_limt', 2000), /Unknown setting/);
});

check('a number setting refuses a non-number', () => {
    assert.throws(() => coerce(KEY, 'two thousand'), /must be a number/);
});

check('a number setting enforces its bounds', () => {
    assert.throws(() => coerce(KEY, -5), /at least 0/);
    assert.throws(() => coerce('assignment.maxConcurrentJobs', 99), /at most 5/);
});

check('a boolean setting accepts the usual spellings', () => {
    assert.equal(coerce('partner.requireKyc', 'yes'), true);
    assert.equal(coerce('partner.requireKyc', 'off'), false);
    assert.equal(coerce('partner.requireKyc', true), true);
});

check('a boolean setting refuses nonsense rather than guessing', () => {
    assert.throws(() => coerce('partner.requireKyc', 'maybe'), /must be true or false/);
});

check('null clears an override and is preserved, not coerced to 0', () => {
    assert.equal(coerce(KEY, null), null);
    assert.equal(coerce(KEY, ''), null);
});

check('a global-only setting cannot be overridden per partner', () => {
    // Storing it would create a row that looks like an override and wins nothing.
    assert.throws(() => assertScopeAllowed('platform.maintenanceMode', 'partner'), /cannot be set at the partner level/);
    assert.equal(assertScopeAllowed('platform.maintenanceMode', 'global'), true);
});

check('the cash limit IS overridable at every level', () => {
    for (const level of SCOPE_LEVELS) assert.equal(assertScopeAllowed(KEY, level), true);
});

check('every registered setting declares a type, a default and its scopes', () => {
    for (const [key, def] of Object.entries(SETTINGS)) {
        assert.ok(def.type, `${key} has no type`);
        assert.ok('default' in def, `${key} has no default`);
        assert.ok(Array.isArray(def.scopes) && def.scopes.length, `${key} has no scopes`);
        for (const s of def.scopes) assert.ok(SCOPE_LEVELS.includes(s), `${key} allows unknown scope ${s}`);
    }
});

check('a missing setting resolves to its DEFAULT, never to zero', () => {
    // Reading a missing cash limit as 0 is how "no row" becomes "no ceiling" --
    // or, with the comparison reversed, "block everyone".
    assert.equal(definitionOf(KEY).default, 0);
    assert.equal(definitionOf('assignment.maxConcurrentJobs').default, 1);
    assert.equal(definitionOf('finance.minimumWalletBalance').default, null);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
