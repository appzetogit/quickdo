/**
 * Refuse to build source that looks like it has had code injected into it.
 *
 * Repeatedly now, an obfuscated build-time payload has been appended to
 * vite.config.js: one enormous single line, pushed off screen by a wall of
 * whitespace after the closing `});`, committed under a real author's name.
 * It is build-time code, so it targets exactly this moment -- the config is
 * evaluated by `vite build`, on whatever machine runs the build.
 *
 * Two signals, both cheap and both specific to how that payload hides:
 *
 *  1. A source line far longer than any hand-written line. Minified vendor
 *     code lives in node_modules and dist, which are not scanned.
 *  2. A long run of trailing whitespace, which is how the payload is pushed
 *     out of sight in an editor.
 *  3. A file that is not source at all, but opens with a wall of whitespace
 *     and then code. The same payload was later committed to the seller app as
 *     `public/fonts/fa-solid-500.woff2` -- a name that reads as an asset and is
 *     not one -- with an editor task added to run it. This guard would have
 *     walked straight past that, because it only looked at source extensions.
 *
 * This is a tripwire, not a scanner: it catches this family cheaply and says
 * plainly what to do. It cannot prove a tree is clean.
 *
 *   node scripts/check-source-integrity.mjs
 */
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Hand-written source stays well under this. Long data URIs are the one honest
// exception, so they are allowed explicitly rather than by raising the limit.
const MAX_LINE = 5000;
const MAX_TRAILING_WHITESPACE = 40;
const SCAN_EXTENSIONS = /\.(m?[jt]sx?|c?[jt]s|json|html)$/;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'build', 'coverage']);

/** How much of a non-source file to look at. The disguise is at the front. */
const ASSET_PROBE_BYTES = 4096;
/** A real font, image or archive does not open with hundreds of spaces. */
const ASSET_WHITESPACE_RUN = 200;

const looksLikeCode = (text) => (
    /\brequire\s*\(/.test(text)
    || /\bglobal\s*[.[]/.test(text)
    || /\bprocess\s*\.\s*env\b/.test(text)
    || /\bconst\s+_0x[0-9a-f]+\s*=/i.test(text)
);

const findings = [];

const scanFile = (path) => {
    let text;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        return; // unreadable or binary; nothing to judge
    }

    const shown = relative(root, path).split(sep).join('/');

    text.split('\n').forEach((line, index) => {
        const withoutTrailing = line.replace(/\s+$/, '');
        // Only whitespace that FOLLOWS real code counts. A blank line carrying
        // its block's indentation is ordinary formatting -- deeply nested JSX
        // is full of them -- whereas the payload hides itself after `});`.
        const trailing = withoutTrailing.length === 0
            ? 0
            : line.length - withoutTrailing.length;

        if (line.length > MAX_LINE && !line.includes('data:')) {
            findings.push(`${shown}:${index + 1} — single line of ${line.length} characters`);
        } else if (trailing > MAX_TRAILING_WHITESPACE) {
            findings.push(`${shown}:${index + 1} — ${trailing} characters of trailing whitespace`);
        }
    });
};

/**
 * A file pretending to be an asset.
 *
 * Only the first few kilobytes, and only files that are NOT source: a genuine
 * font or image begins with its own magic bytes, never with a paragraph of
 * spaces followed by `require(`.
 */
const scanAsset = (path) => {
    let fd;
    try {
        fd = openSync(path, 'r');
    } catch {
        return;
    }
    try {
        const buffer = Buffer.alloc(ASSET_PROBE_BYTES);
        const read = readSync(fd, buffer, 0, ASSET_PROBE_BYTES, 0);
        if (read <= 0) return;
        const head = buffer.toString('utf8', 0, read);
        const leading = head.length - head.replace(/^\s+/, '').length;
        if (leading < ASSET_WHITESPACE_RUN || !looksLikeCode(head)) return;
        const shown = relative(root, path).split(sep).join('/');
        findings.push(
            `${shown} \u2014 not the file it claims to be: ${leading} characters of `
            + 'whitespace, then code',
        );
    } catch {
        // Unreadable is not evidence of anything.
    } finally {
        closeSync(fd);
    }
};

const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        const full = join(dir, entry);
        let info;
        try {
            info = statSync(full);
        } catch {
            continue;
        }
        if (info.isDirectory()) walk(full);
        else if (SCAN_EXTENSIONS.test(entry)) scanFile(full);
        else scanAsset(full);
    }
};

walk(root);

if (findings.length > 0) {
    console.error('\n[integrity] Build stopped: source looks tampered with.\n');
    for (const finding of findings) console.error(`  ${finding}`);
    console.error(
        '\n  An obfuscated payload has repeatedly been appended to this project,'
        + '\n  always as one very long line hidden behind trailing whitespace.'
        + '\n  Inspect the lines above before building. If one is legitimate,'
        + '\n  reformat it rather than raising the threshold.\n'
    );
    process.exit(1);
}

console.log('[integrity] no injected-code signatures found');
