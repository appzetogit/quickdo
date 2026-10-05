/**
 * Every notification type the controllers emit must exist in the model's enum.
 *
 * A missing value fails silently in a way that is very hard to notice:
 * createNotification catches the mongoose validation error, logs it, and returns
 * -- so the calling flow succeeds, nothing surfaces to the user or the API, and
 * the notification is simply never delivered. Ten types had drifted out of the
 * enum this way, costing customers the "professional accepted" and "work
 * started" alerts and costing workers and vendors every earnings and withdrawal
 * alert.
 *
 * This scans the source for the types actually passed to createNotification
 * rather than restating a list, so a new type added to a controller without a
 * matching enum entry fails here instead of going quiet in production.
 *
 * Run: node src/modules/serviceProvider/__checks__/notificationTypes.check.js
 */
const fs = require('fs');
const path = require('path');

const MODULE_ROOT = path.resolve(__dirname, '..');

const readEnumValues = () => {
    const source = fs.readFileSync(path.join(MODULE_ROOT, 'models', 'Notification.js'), 'utf8');
    const start = source.indexOf('enum: [');
    if (start === -1) throw new Error('could not find the type enum in Notification.js');
    const end = source.indexOf(']', start);
    return new Set(source.slice(start, end).match(/'[a-zA-Z_]+'/g).map((v) => v.slice(1, -1)));
};

const jsFilesUnder = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsFilesUnder(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
};

const collectEmittedTypes = () => {
    const found = new Map();
    for (const file of jsFilesUnder(MODULE_ROOT)) {
        const source = fs.readFileSync(file, 'utf8');
        const calls = source.match(/createNotification\(\s*\{[\s\S]{0,800}?\}\s*\)/g) || [];
        for (const call of calls) {
            const match = call.match(/\btype:\s*'([a-zA-Z_]+)'/);
            if (!match) continue;
            const rel = path.relative(MODULE_ROOT, file).replace(/\\/g, '/');
            if (!found.has(match[1])) found.set(match[1], rel);
        }
    }
    return found;
};

const allowed = readEnumValues();
const emitted = collectEmittedTypes();

console.log(`  enum values                : ${allowed.size}`);
console.log(`  types emitted in the source: ${emitted.size}`);

const missing = [...emitted.entries()].filter(([type]) => !allowed.has(type));

if (missing.length) {
    console.log('\n  MISSING from the enum -- these notifications would be silently dropped:');
    for (const [type, file] of missing.sort()) {
        console.log(`    ${type.padEnd(28)} ${file}`);
    }
    console.log(`\n${missing.length} FAILED`);
    process.exit(1);
}

// Guard the scan itself: if the regex stops matching, this check would pass
// while testing nothing at all.
if (emitted.size === 0) {
    console.log('\n  FAILED: found no createNotification calls -- the scan is broken, not the code.');
    process.exit(1);
}

console.log('\nall emitted notification types exist in the enum');
process.exit(0);
