/**
 * Deciding whether two records are the same person, from a phone number.
 *
 * The platform joins its four customer identities on the last ten digits of a
 * phone number. That is a heuristic, and `SUPERAPP_DATA_MODEL.md` is clear it
 * should eventually be replaced by an explicit `platformUserId`. Until then the
 * heuristic is what decides whether two rows get merged -- and a merge is the one
 * operation here that reverting a commit does not undo.
 *
 * So the rules live in one tested place rather than being re-implemented in each
 * script that needs them. `identityLink.service.js` and
 * `scripts/analyse-identity-merge.mjs` both had their own copy of the ten-digit
 * rule before this existed.
 *
 * The asymmetry worth understanding: `namesAgree` is deliberately GENEROUS. The
 * question it answers is not "are these written the same" but "is there positive
 * evidence these are DIFFERENT people". A false conflict sends a real customer to
 * a manual review queue, which is an inconvenience; a false agreement merges two
 * strangers' order history, addresses and wallet, which is not.
 */

/**
 * The last ten digits, which is the join key the platform already uses.
 *
 * Handles what these collections actually contain: '+91 98765 43210',
 * '919876543210', '09876543210', '98765-43210'. Non-digits are stripped first, so
 * formatting never decides identity.
 *
 * Anything with FEWER than ten digits returns null rather than being matched
 * loosely. A seven-digit suffix would collide with thousands of people, and
 * "probably the same person" is not a standard to merge wallets on.
 */
export const toTenDigits = (phone) => {
    const digits = String(phone ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
};

/** Normalise a name for comparison only. Never for storage. */
export const nameKey = (name) => String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Name particles: connective words that appear IN names without identifying
 * anybody. A shared one is not evidence of a shared identity.
 *
 * Length alone does not catch these -- 'bin', 'van' and 'ibn' are all three
 * characters, the same as real given names like 'Ram', 'Lee' and 'Ali'. So they
 * are named rather than filtered by size, and the list holds only particles,
 * never names.
 *
 * Found by a check: 'bin Salim' and 'bin Rashid' agreed on the shared token
 * 'bin', which would have classified two different people as SAFE and merged
 * their wallets automatically.
 */
const PARTICLES = new Set([
    'bin', 'bint', 'ibn', 'ben', 'abu', 'umm',
    'van', 'von', 'der', 'den', 'das', 'dos', 'del', 'della', 'della',
    'mac', 'mcc', 'the', 'and',
]);

const identifyingTokens = (key) => key
    .split(' ')
    .filter((t) => t.length > 2 && !PARTICLES.has(t));

/**
 * Do these two names plausibly belong to one person?
 *
 *   - either side missing    -> true. Absence is not evidence.
 *   - identical              -> true
 *   - one contains the other -> true. "Asha" vs "Asha Kumari".
 *   - a shared IDENTIFYING token -> true. "Asha Kumari" vs "A Kumari".
 *   - otherwise              -> false
 *
 * Short tokens are ignored when looking for a shared one: an initial ('A') is not
 * evidence, and treating it as such would make almost any two names agree.
 */
export const namesAgree = (a, b) => {
    const x = nameKey(a);
    const y = nameKey(b);
    if (!x || !y) return true;
    if (x === y) return true;
    if (x.includes(y) || y.includes(x)) return true;
    const xs = new Set(identifyingTokens(x));
    return identifyingTokens(y).some((t) => xs.has(t));
};

/** Emails are exact or absent. There is no near-miss worth guessing at. */
export const emailsAgree = (a, b) => {
    const x = String(a ?? '').toLowerCase().trim();
    const y = String(b ?? '').toLowerCase().trim();
    if (!x || !y) return true;
    return x === y;
};

/**
 * What should happen to one satellite record.
 *
 * @param {{phone: any, name?: any, email?: any, platformUserId?: any}} satellite
 * @param {Array<{_id: any, name?: any, email?: any}>} candidates  platform users sharing the suffix
 * @returns {{bucket: 'LINKED'|'UNUSABLE'|'AMBIGUOUS'|'CONFLICTING'|'SAFE', reason: string|null}}
 *
 * SAFE covers both "one clean match" and "no match at all" -- creating a new
 * platform identity for a phone nobody else has is unambiguous.
 */
export function classifyMatch(satellite, candidates = []) {
    if (satellite?.platformUserId) return { bucket: 'LINKED', reason: null };

    const suffix = toTenDigits(satellite?.phone);
    if (!suffix) return { bucket: 'UNUSABLE', reason: 'fewer than ten digits' };

    if (candidates.length > 1) {
        return { bucket: 'AMBIGUOUS', reason: 'several platform users share this phone' };
    }
    if (candidates.length === 0) {
        return { bucket: 'SAFE', reason: 'no existing platform user for this phone' };
    }

    const [match] = candidates;
    if (!namesAgree(satellite.name, match.name)) {
        return { bucket: 'CONFLICTING', reason: 'names look like different people' };
    }
    if (!emailsAgree(satellite.email, match.email)) {
        return { bucket: 'CONFLICTING', reason: 'emails disagree' };
    }
    return { bucket: 'SAFE', reason: 'one match, evidence agrees' };
}
