/**
 * A prescription may be a PDF, and a PDF must come back out byte for byte.
 *
 * Run: node tests/prescription-pdf-upload.smoke.mjs
 *
 * Prescriptions were photograph-only, because every upload went through
 * saveImageFile: an image-only whitelist followed by the optimiser, which
 * re-encodes what it is given as WebP. A PDF sent that way is refused, and a
 * PDF that somehow got past the whitelist would be re-encoded into a blank
 * image where a legal document used to be.
 *
 * saveDocumentFile is the separate path. Images keep the optimised route;
 * a PDF is written exactly as sent, because someone may have to produce it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// A real, minimal PDF: header, one object, trailer. Byte-compared below, so it
// has to be something a reader would actually accept.
const PDF_BYTES = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'latin1',
);

const uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qd-uploads-'));
// The name the config actually reads. Set before the storage module is
// imported, since it resolves the root once at load.
process.env.UPLOAD_STORAGE_ROOT = uploadRoot;

const storage = await import('../src/modules/quickCommerce/services/storage.service.js');

let failures = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (err) {
        failures += 1;
        console.log(`  FAIL ${label}\n       ${err.message}`);
    }
};
const rejects = async (fn, pattern) => {
    let threw = null;
    try { await fn(); } catch (err) { threw = err; }
    assert.ok(threw, 'expected this to be refused');
    assert.match(threw.message, pattern);
};

const pdf = () => ({ buffer: PDF_BYTES, mimetype: 'application/pdf', originalname: 'rx.pdf' });

console.log('\na PDF prescription');
let stored = null;
await check('is accepted, where the image-only path refuses it', async () => {
    stored = await storage.saveDocumentFile(pdf(), 'prescriptions');
    assert.ok(stored.url, 'no url returned');
    assert.equal(stored.mimeType, 'application/pdf');
});
await check('THE POINT: it is stored byte for byte, not re-encoded into a blank image', async () => {
    const onDisk = await fs.readFile(path.join(uploadRoot, stored.path));
    assert.deepEqual(onDisk, PDF_BYTES);
    assert.ok(onDisk.subarray(0, 5).toString('latin1') === '%PDF-', 'the file is no longer a PDF');
});
await check('and keeps a .pdf name, so a browser opens it rather than downloading junk', () =>
    assert.match(stored.path, /\.pdf$/));

console.log('\nwhat the old path does with the same file');
await check('saveImageFile still refuses it, so avatars and menu photos are unaffected', () =>
    rejects(() => storage.saveImageFile(pdf(), 'prescriptions'), /JPEG, PNG, WebP/));

console.log('\na photographed prescription still takes the optimised route');
await check('a PNG is accepted and converted as before', async () => {
    // A 1x1 PNG.
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    const out = await storage.saveDocumentFile(
        { buffer: png, mimetype: 'image/png', originalname: 'rx.png' },
        'prescriptions',
    );
    assert.notEqual(out.mimeType, 'application/pdf');
    assert.doesNotMatch(out.path, /\.pdf$/);
});

console.log('\nanything else');
await check('a file that is neither is refused with words a customer can act on', () =>
    rejects(
        () => storage.saveDocumentFile(
            { buffer: Buffer.from('MZ'), mimetype: 'application/x-msdownload', originalname: 'x.exe' },
            'prescriptions',
        ),
        /photo .*or a PDF/i,
    ));
await check('an empty upload is refused', () =>
    rejects(() => storage.saveDocumentFile({ buffer: Buffer.alloc(0), mimetype: 'application/pdf' }, 'prescriptions'),
        /File is required/));

await fs.rm(uploadRoot, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
