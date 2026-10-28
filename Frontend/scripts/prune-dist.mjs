/**
 * Delete every dist asset the current build no longer references.
 *
 * Reachability, not age: chunk filenames are content-hashed, so a chunk that
 * did not change keeps its old filename -- and its old mtime -- across builds
 * while still being referenced. An mtime-based prune (`-mtime +14`) would
 * delete live files. Instead this walks the reference graph from index.html:
 * every `assets/<name>.<hash>.<ext>` mentioned inside a kept file is kept,
 * transitively, and everything else in dist/assets goes.
 *
 * Safe to run while the site is serving. A session still on a pruned build
 * hits a chunk 404, and the stale-build reloader (src/app/staleBuildReload.js)
 * reloads it onto the current build -- that reloader existing is WHY pruning
 * is safe, so do not run this against a deployment that predates it.
 *
 * Runs automatically after `npm run build`; run manually with
 *   node scripts/prune-dist.mjs [--dry-run]
 */
import { chmodSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const assetsDir = join(dist, 'assets');
const dryRun = process.argv.includes('--dry-run');

let allAssets;
try {
    allAssets = readdirSync(assetsDir);
} catch {
    console.log('[prune-dist] no dist/assets; nothing to do');
    process.exit(0);
}

// Anything a kept file can mention: js/css chunks and hashed static assets.
//
// Both spellings count. index.html and Vite's preload map write `assets/X.js`,
// but a chunk importing a sibling writes `./X.js` -- and a lazy page with no
// dependencies of its own is referenced ONLY that way. Matching just the first
// spelling deleted such pages after every build (the /partner page 404'd and
// the stale-build reloader spun the browser in a reload loop).
const REF = /(?:assets\/|\.\/)([A-Za-z0-9._-]+\.(?:js|css|woff2?|ttf|png|jpe?g|webp|svg|gif|mp4|webm|json))/g;

const referencesIn = (filePath) => {
    const names = new Set();
    let text;
    try {
        text = readFileSync(filePath, 'utf8');
    } catch {
        return names; // binary asset; references nothing
    }
    for (const match of text.matchAll(REF)) names.add(match[1]);
    return names;
};

// BFS from index.html. Only js/css can carry further references, but binary
// assets they name must be kept too.
const keep = new Set();
const queue = [];
for (const name of referencesIn(join(dist, 'index.html'))) {
    if (!keep.has(name)) { keep.add(name); queue.push(name); }
}
while (queue.length) {
    const name = queue.pop();
    if (!/\.(js|css)$/.test(name)) continue;
    for (const ref of referencesIn(join(assetsDir, name))) {
        if (!keep.has(ref)) { keep.add(ref); queue.push(ref); }
    }
}

if (keep.size === 0) {
    // A broken index.html referencing nothing means the build failed upstream;
    // deleting everything on that signal would take the site down properly.
    console.error('[prune-dist] index.html references no assets -- refusing to prune');
    process.exit(1);
}

// A tab opened before a deploy still asks for the previous build's chunks when
// it opens a page. Deleting them at once broke every such page ("server not
// working" on the admin panel after each deploy), so an unreferenced file is
// kept until it is this old.
const GRACE_MS = Number(process.env.PRUNE_GRACE_DAYS || 3) * 24 * 60 * 60 * 1000;
const now = Date.now();

let removed = 0;
let freed = 0;
let graced = 0;
for (const name of allAssets) {
    const full = join(assetsDir, name);
    if (keep.has(name)) {
        // Stamp what this build uses, so a file's age below means "since the
        // last build that used it", not "since it was first built".
        if (!dryRun) { try { utimesSync(full, new Date(), new Date()); } catch { /* best-effort */ } }
        continue;
    }
    let mtimeMs = 0;
    try { mtimeMs = statSync(full).mtimeMs; } catch { /* stat is best-effort */ }
    if (now - mtimeMs < GRACE_MS) { graced += 1; continue; }
    try { freed += statSync(full).size; } catch { /* stat is best-effort */ }
    if (!dryRun) unlinkSync(full);
    removed += 1;
}

console.log(
    `[prune-dist] kept ${keep.size} (+${graced} from recent builds), ${dryRun ? 'would remove' : 'removed'} ${removed} ` +
    `(${(freed / 1024 / 1024).toFixed(1)} MB)`
);

/*
 * nginx reads dist as another user, so every folder must be listable and
 * every file readable by it. On 11 Sep dist/assets was left 700 after a
 * deploy and the whole site went blank: index.html loaded, and every script
 * under /assets/ answered 404 ("stat() failed (13: Permission denied)").
 * Put the modes back on each build, whatever tightened them.
 */
if (!dryRun) {
    const open = (dir) => {
        chmodSync(dir, 0o755);
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) open(full);
            else if (entry.isFile()) chmodSync(full, 0o644);
        }
    };
    try {
        open(dist);
    } catch (err) {
        console.error(`[prune-dist] could not open up dist permissions: ${err.message}`);
    }
}
