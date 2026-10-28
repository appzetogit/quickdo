/**
 * Refuse to run source that looks like it has had code injected into it.
 *
 * Importing this module performs the check. It is the FIRST import in
 * server.js for that reason: ES modules are evaluated in the order they are
 * imported, so a payload sitting in any module imported after it never gets
 * evaluated. A check written as a statement in server.js would run after every
 * one of its imports had already executed, which is far too late.
 *
 * WHY THIS EXISTS
 *
 * An obfuscated payload has been committed to these repositories seven times,
 * always force-pushed under the repository owner's own name. Two shapes so far:
 *
 *   1. Appended to Frontend/vite.config.js after the closing `});`, on the same
 *      line, behind a wall of tab characters so an editor shows nothing. It is
 *      build-time code: `vite build` evaluates the config, so it runs on
 *      whatever machine builds the frontend.
 *
 *   2. Committed as `public/fonts/fa-solid-500.woff2` -- a file name that looks
 *      like an asset and is not one; Font Awesome's solid weight is 900. A
 *      .vscode/tasks.json was added alongside it to run it as a hidden
 *      background task, so opening the folder in an editor was enough.
 *
 * Both take their instructions from a blockchain indexer rather than a server
 * that can be seized, and both spawn processes. The frontend had a tripwire
 * after the third occurrence and it worked -- the build refused. Nothing
 * guarded the backend, which pm2 starts directly, before any build runs.
 *
 * WHAT IT LOOKS FOR
 *
 * Two signatures, both cheap, both specific to how this payload hides rather
 * than to what it does. Obfuscators change; hiding one enormous line behind
 * whitespace is what makes it invisible to a reviewer, and that is the part
 * worth detecting.
 *
 *   - a source line far longer than anything written by hand;
 *   - a file that is not source at all but begins with a long run of
 *     whitespace followed by code -- the disguised-asset trick.
 *
 * This is a tripwire, not a scanner. It catches this family cheaply and says
 * plainly what to do. It cannot prove a tree is clean, and it is no substitute
 * for finding out whose credential is doing the pushing.
 *
 * Run it by hand:  node scripts/sourceIntegrity.mjs
 */
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, '..');

/*
 * Kept in step with Frontend/scripts/check-source-integrity.mjs, which guards
 * the build the same way. Deliberately a second copy rather than a shared
 * import: they protect two different packages, and a guard that reaches across
 * a package boundary to find its own rules is one more thing that can be made
 * to not run.
 */
const MAX_LINE = 5000;
const MAX_TRAILING_WHITESPACE = 40;
const SCAN_EXTENSIONS = /\.(m?[jt]sx?|c?[jt]s|json|html)$/;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', 'uploads', 'logs']);

/** How much of a non-source file to look at. The disguise is at the front. */
const ASSET_PROBE_BYTES = 4096;
/** A real asset does not open with hundreds of spaces. */
const ASSET_WHITESPACE_RUN = 200;

const looksLikeCode = (text) => (
    /\brequire\s*\(/.test(text)
    || /\bglobal\s*[.[]/.test(text)
    || /\bprocess\s*\.\s*env\b/.test(text)
    || /\bconst\s+_0x[0-9a-f]+\s*=/i.test(text)
);

const scanSourceFile = (path, findings, root) => {
    let text;
    try {
        text = readFileSync(path, 'utf8');
    } catch {
        return; // unreadable or binary; nothing to judge
    }

    const shown = relative(root, path).split(sep).join('/');

    text.split('\n').forEach((line, index) => {
        const withoutTrailing = line.replace(/\s+$/, '');
        /*
         * Only whitespace that FOLLOWS real code counts. A blank line carrying
         * its block's indentation is ordinary formatting, whereas the payload
         * hides itself after the last real statement on the line.
         */
        const trailing = withoutTrailing.length === 0
            ? 0
            : line.length - withoutTrailing.length;

        if (line.length > MAX_LINE && !line.includes('data:')) {
            findings.push(`${shown}:${index + 1} - single line of ${line.length} characters`);
        } else if (trailing > MAX_TRAILING_WHITESPACE) {
            findings.push(`${shown}:${index + 1} - ${trailing} characters of trailing whitespace`);
        }
    });
};

/**
 * A file pretending to be an asset.
 *
 * Only the first few kilobytes are read, and only files that are NOT source:
 * a genuine font, image or archive begins with its own magic bytes, never with
 * a paragraph of spaces followed by `require(`.
 */
const scanAssetFile = (path, findings, root) => {
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
        if (leading < ASSET_WHITESPACE_RUN) return;
        if (!looksLikeCode(head)) return;

        const shown = relative(root, path).split(sep).join('/');
        findings.push(
            `${shown} - not the file it claims to be: ${leading} characters of `
            + 'whitespace, then code',
        );
    } catch {
        // Unreadable is not evidence of anything.
    } finally {
        closeSync(fd);
    }
};

const walk = (dir, findings, root) => {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        const full = join(dir, entry);
        let info;
        try {
            info = statSync(full);
        } catch {
            continue;
        }
        if (info.isDirectory()) walk(full, findings, root);
        else if (SCAN_EXTENSIONS.test(entry)) scanSourceFile(full, findings, root);
        else scanAssetFile(full, findings, root);
    }
};

/** Every signature found under `root`. Empty means nothing matched. */
export function findInjectedCode(root = backendRoot) {
    const findings = [];
    walk(root, findings, root);
    return findings;
}

export function reportFindings(findings) {
    console.error('\n[integrity] Refusing to start: source looks tampered with.\n');
    for (const finding of findings) console.error(`  ${finding}`);
    console.error(
        '\n  An obfuscated payload has repeatedly been committed to this project,'
        + '\n  hidden as one very long line behind whitespace, or as a file named'
        + '\n  after an asset. Inspect the lines above before running anything.'
        + '\n  If one is legitimate, reformat it rather than raising the threshold.\n'
    );
}

const findings = findInjectedCode(join(backendRoot, 'src'));
findings.push(...findInjectedCode(join(backendRoot, 'scripts')));
for (const file of ['server.js', 'package.json']) {
    scanSourceFile(join(backendRoot, file), findings, backendRoot);
}

if (findings.length > 0) {
    reportFindings(findings);
    process.exit(1);
}
