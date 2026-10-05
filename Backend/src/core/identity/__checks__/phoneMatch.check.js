/**
 * Whether two records are the same person -- checked on the cases that decide
 * whether a stranger inherits somebody's wallet.
 *
 * Run: node src/core/identity/__checks__/phoneMatch.check.js
 *
 * Pure matching, no database. An identity merge is the one operation in this
 * migration that reverting a commit does not undo, so the two directions are not
 * equally bad and the checks are weighted accordingly:
 *
 *   a false CONFLICT  sends a real customer to a manual review queue
 *   a false AGREEMENT merges two strangers' order history, addresses and wallet
 *
 * Everything below exists to make the second one hard.
 */
import assert from 'node:assert/strict';
import { toTenDigits, nameKey, namesAgree, emailsAgree, classifyMatch } from '../phoneMatch.js';

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

// --- the join key -------------------------------------------------------------
console.log('\nthe phone suffix, from what these collections actually contain');

check('every formatting of one number gives the same key', () => {
    const forms = ['+919876543210', '919876543210', '09876543210', '9876543210',
        '+91 98765 43210', '98765-43210', ' +91-98765 43210 '];
    const keys = new Set(forms.map(toTenDigits));
    assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(', ')}`);
    assert.equal([...keys][0], '9876543210');
});

check('fewer than ten digits is REFUSED, not matched loosely', () => {
    // A seven-digit suffix would collide with thousands of people, and "probably
    // the same person" is not a standard to merge wallets on.
    assert.equal(toTenDigits('7654321'), null);
    assert.equal(toTenDigits('12345'), null);
    assert.equal(toTenDigits(''), null);
    assert.equal(toTenDigits(null), null);
    assert.equal(toTenDigits(undefined), null);
});

check('exactly ten digits is usable', () => {
    assert.equal(toTenDigits('9876543210'), '9876543210');
});

check('a longer international number still yields its last ten', () => {
    assert.equal(toTenDigits('+1 415 555 0123'), '4155550123');
});

check('letters and junk do not decide identity', () => {
    assert.equal(toTenDigits('tel:+91-98765-43210 (mobile)'), '9876543210');
});

// --- names: generous, but not blind -------------------------------------------
console.log('\nnames agree unless there is evidence they do not');

check('identical names agree', () => {
    assert.equal(namesAgree('Asha Kumari', 'Asha Kumari'), true);
});

check('formatting and case do not create a conflict', () => {
    assert.equal(namesAgree('ASHA  KUMARI', 'asha kumari'), true);
    assert.equal(namesAgree('Asha Kumari.', 'Asha Kumari'), true);
});

check('a shortened name agrees with the full one', () => {
    assert.equal(namesAgree('Asha', 'Asha Kumari'), true);
    assert.equal(namesAgree('Asha Kumari', 'Asha'), true);
});

check('a shared surname agrees', () => {
    assert.equal(namesAgree('Asha Kumari', 'A Kumari'), true);
});

check('a missing name on either side is NOT evidence of anything', () => {
    assert.equal(namesAgree('', 'Asha Kumari'), true);
    assert.equal(namesAgree('Asha Kumari', null), true);
    assert.equal(namesAgree(undefined, undefined), true);
});

check('THE ONE THAT MATTERS: two different people do not agree', () => {
    // A recycled phone number. This is the case that, unflagged, hands a
    // stranger the previous owner's order history and wallet.
    assert.equal(namesAgree('Asha Kumari', 'Rahul Verma'), false);
});

check('an initial alone is not a match', () => {
    // Otherwise "A Kumari" would agree with "A Verma" on the shared token "A",
    // and almost any two names would agree.
    assert.equal(namesAgree('A Kumari', 'A Verma'), false);
});

check('short particles do not manufacture agreement', () => {
    assert.equal(namesAgree('bin Salim', 'bin Rashid'), false);
});

// --- emails: exact or absent --------------------------------------------------
console.log('\nemails');

check('identical emails agree, case and space insensitively', () => {
    assert.equal(emailsAgree(' Asha@Example.com ', 'asha@example.com'), true);
});

check('a missing email is not evidence', () => {
    assert.equal(emailsAgree('', 'asha@example.com'), true);
    assert.equal(emailsAgree(null, undefined), true);
});

check('different emails disagree -- no near-miss guessing', () => {
    assert.equal(emailsAgree('asha@example.com', 'rahul@example.com'), false);
});

// --- the classification -------------------------------------------------------
console.log('\nwhat happens to one satellite record');

const user = (over = {}) => ({ _id: 'p1', name: 'Asha Kumari', email: 'asha@example.com', ...over });

check('already linked is left alone', () => {
    assert.equal(classifyMatch({ phone: '9876543210', platformUserId: 'x' }, []).bucket, 'LINKED');
});

check('no phone to match on is UNUSABLE', () => {
    assert.equal(classifyMatch({ phone: '123' }, []).bucket, 'UNUSABLE');
    assert.equal(classifyMatch({}, []).bucket, 'UNUSABLE');
});

check('one clean match is SAFE', () => {
    const v = classifyMatch({ phone: '+919876543210', name: 'Asha' }, [user()]);
    assert.equal(v.bucket, 'SAFE');
});

check('no candidate at all is SAFE -- creating one is unambiguous', () => {
    assert.equal(classifyMatch({ phone: '9876543210', name: 'Asha' }, []).bucket, 'SAFE');
});

check('THE BUG IN THE EXISTING SCRIPT: two candidates is AMBIGUOUS, never a pick', () => {
    /*
     * link-user-identities.js indexes with `if (!map.has(s)) map.set(s, u._id)`,
     * so the second user sharing a suffix is discarded and the satellite links to
     * whichever the collection scan happened to return first. This refuses instead.
     */
    const v = classifyMatch({ phone: '9876543210', name: 'Asha' }, [user(), user({ _id: 'p2', name: 'Asha Kumari' })]);
    assert.equal(v.bucket, 'AMBIGUOUS');
});

check('ambiguity beats agreement -- two candidates that BOTH match is still ambiguous', () => {
    const v = classifyMatch({ phone: '9876543210', name: 'Asha Kumari' },
        [user({ _id: 'p1' }), user({ _id: 'p2' })]);
    assert.equal(v.bucket, 'AMBIGUOUS');
});

check('a recycled number is CONFLICTING, not silently merged', () => {
    const v = classifyMatch({ phone: '9876543210', name: 'Rahul Verma' }, [user()]);
    assert.equal(v.bucket, 'CONFLICTING');
    assert.match(v.reason, /different people/);
});

check('disagreeing emails are CONFLICTING even when names agree', () => {
    const v = classifyMatch(
        { phone: '9876543210', name: 'Asha Kumari', email: 'someone.else@example.com' },
        [user()],
    );
    assert.equal(v.bucket, 'CONFLICTING');
    assert.match(v.reason, /emails/);
});

check('a satellite with no name is SAFE against a named platform user', () => {
    // Common: the satellite was created by an OTP login that never asked for a name.
    assert.equal(classifyMatch({ phone: '9876543210' }, [user()]).bucket, 'SAFE');
});

check('every bucket is one of the five declared', () => {
    const buckets = new Set([
        classifyMatch({ phone: '9876543210', platformUserId: 'x' }, []).bucket,
        classifyMatch({ phone: '12' }, []).bucket,
        classifyMatch({ phone: '9876543210' }, []).bucket,
        classifyMatch({ phone: '9876543210' }, [user(), user({ _id: 'p2' })]).bucket,
        classifyMatch({ phone: '9876543210', name: 'Rahul Verma' }, [user()]).bucket,
    ]);
    assert.deepEqual([...buckets].sort(), ['AMBIGUOUS', 'CONFLICTING', 'LINKED', 'SAFE', 'UNUSABLE']);
});

console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
process.exit(failed ? 1 : 0);
