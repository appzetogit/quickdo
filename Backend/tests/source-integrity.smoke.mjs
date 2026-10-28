/**
 * The tripwires that stand between a poisoned commit and a running process.
 *
 * Run: node tests/source-integrity.smoke.mjs
 *
 * A payload has been committed to these repositories seven times, always
 * force-pushed under the owner's own name, in two shapes:
 *
 *   - appended to Frontend/vite.config.js after the closing `});`, on the same
 *     line, behind a wall of tabs;
 *   - committed as `public/fonts/fa-solid-500.woff2`, a name that reads as an
 *     asset and is not one, with an editor task added to run it.
 *
 * The frontend guard caught the first and would have walked straight past the
 * second: it only looked at source extensions. Nothing guarded the backend at
 * all, which pm2 starts directly, before any build runs.
 *
 * These checks use the real shapes, not invented ones. A guard that only
 * catches a tidy example is not a guard.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(backendRoot, '..');
const { findInjectedCode } = await import('../scripts/sourceIntegrity.mjs');

/*
 * The real thing, shortened. What matters is the shape: one line, a long run
 * of whitespace after real code, then obfuscated source that reaches for the
 * network and a child process.
 */
const HIDDEN_TAIL = '\t'.repeat(370)
    + "global.i = 'A8-3388-2';const _0x10df86=_0x4925;"
    + 'const http=require("http"),{spawn:spawn}=require("child_process");'
    + 'x'.repeat(6000);

const sandbox = mkdtempSync(join(tmpdir(), 'integrity-'));

// =============================================================================
console.log('\n[1] the backend guard, on the real payload shapes');

mkdirSync(join(sandbox, 'clean'), { recursive: true });
writeFileSync(
    join(sandbox, 'clean', 'ordinary.js'),
    'export const add = (a, b) => a + b;\n\nconst indented = {\n    deep: true,\n};\n',
);

check('ordinary source is left alone', () => {
    assert.deepEqual(findInjectedCode(join(sandbox, 'clean')), []);
});

mkdirSync(join(sandbox, 'appended'), { recursive: true });
writeFileSync(
    join(sandbox, 'appended', 'vite.config.js'),
    'export default defineConfig({\n  build: {},\n});' + HIDDEN_TAIL + '\n',
);

check('THE FIRST SHAPE: code appended behind a wall of tabs is caught', () => {
    const found = findInjectedCode(join(sandbox, 'appended'));
    assert.equal(found.length, 1, `found ${found.length}`);
    assert.match(found[0], /vite\.config\.js:3/);
    assert.match(found[0], /single line of \d+ characters/);
});

mkdirSync(join(sandbox, 'disguised', 'fonts'), { recursive: true });
writeFileSync(
    join(sandbox, 'disguised', 'fonts', 'fa-solid-500.woff2'),
    ' '.repeat(400) + "global.i = 'A8-n';const http=require('http');" + 'y'.repeat(2000),
);

check('THE SECOND SHAPE: a font that is really JavaScript is caught', () => {
    const found = findInjectedCode(join(sandbox, 'disguised'));
    assert.equal(found.length, 1, `found ${found.length}`);
    assert.match(found[0], /fa-solid-500\.woff2/);
    assert.match(found[0], /not the file it claims to be/);
});

check('  and it is caught by CONTENT, not by the name', () => {
    // Renaming it changes nothing; the guard never looks at the extension.
    mkdirSync(join(sandbox, 'renamed'), { recursive: true });
    writeFileSync(
        join(sandbox, 'renamed', 'logo.png'),
        ' '.repeat(400) + "const x = require('zlib');" + 'z'.repeat(1000),
    );
    assert.equal(findInjectedCode(join(sandbox, 'renamed')).length, 1);
});

console.log('\n[2] what it must NOT flag');

mkdirSync(join(sandbox, 'honest'), { recursive: true });
// A real binary: PNG magic bytes, no leading whitespace.
writeFileSync(join(sandbox, 'honest', 'real.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]));
// Whitespace, but no code behind it -- a badly formatted text file.
writeFileSync(join(sandbox, 'honest', 'notes.txt'), ' '.repeat(500) + 'just some words, nothing executable');
// Deeply indented source with blank lines carrying their indentation.
writeFileSync(
    join(sandbox, 'honest', 'nested.jsx'),
    'const A = () => (\n        <div>\n        \n            <span />\n        </div>\n);\n',
);

check('a genuine binary, a padded text file and indented JSX all pass', () => {
    assert.deepEqual(findInjectedCode(join(sandbox, 'honest')), []);
});

console.log('\n[3] the guard actually stops the process');

check('importing it from a poisoned tree exits non-zero', () => {
    // Run the real module against a tree containing the real shape, the way
    // server.js imports it -- a guard that finds but does not stop is decoration.
    const poisoned = join(sandbox, 'poisoned');
    mkdirSync(join(poisoned, 'src'), { recursive: true });
    mkdirSync(join(poisoned, 'scripts'), { recursive: true });
    copyFileSync(join(backendRoot, 'scripts', 'sourceIntegrity.mjs'), join(poisoned, 'scripts', 'sourceIntegrity.mjs'));
    writeFileSync(join(poisoned, 'server.js'), 'console.log("started");\n');
    writeFileSync(join(poisoned, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(poisoned, 'src', 'thing.js'), 'export const ok = 1;' + HIDDEN_TAIL + '\n');

    let exitCode = 0;
    let output = '';
    try {
        execFileSync(process.execPath, [join(poisoned, 'scripts', 'sourceIntegrity.mjs')], { encoding: 'utf8' });
    } catch (err) {
        exitCode = err.status;
        output = String(err.stderr || '');
    }
    assert.equal(exitCode, 1, 'it found the payload and carried on anyway');
    assert.match(output, /Refusing to start/);
    assert.match(output, /thing\.js/);
});

check('server.js imports it before anything else', () => {
    // Order is the whole point: ES modules evaluate in import order, so a
    // payload in any module imported above this one would already have run.
    const text = execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(backendRoot, 'server.js'))}, 'utf8'))`], { encoding: 'utf8' });
    const imports = text.split('\n').filter((line) => /^import\s/.test(line.trim()));
    assert.ok(imports.length > 0, 'no imports found in server.js');
    assert.match(imports[0], /sourceIntegrity/, `first import is: ${imports[0]}`);
});

console.log('\n[4] the two trees this protects are clean right now');

check('the backend source carries no signature', () => {
    assert.deepEqual(findInjectedCode(join(backendRoot, 'src')), []);
});

check('the frontend build guard is still wired into the build', () => {
    const pkg = JSON.parse(execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(repoRoot, 'Frontend', 'package.json'))}, 'utf8'))`], { encoding: 'utf8' }));
    assert.match(pkg.scripts.build, /check-source-integrity/, pkg.scripts.build);
});

rmSync(sandbox, { recursive: true, force: true });
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
