/**
 * Every image the platform stores comes back as WebP.
 *
 * Run: node tests/image-webp-everywhere.smoke.mjs
 *
 * There is one converter (services/storage.service.js) and several doors into
 * it, because the modules were written at different times against different
 * assumptions:
 *
 *   - storage.service.js itself, used by new code;
 *   - services/cloudinary.service.js, the shim food and quick commerce's ~60
 *     call sites still import under the old Cloudinary names;
 *   - utils/cloudinaryUpload.js, the same trick for taxi -- which until now was
 *     not a shim at all but a live POST to api.cloudinary.com, against an
 *     account that answers "cloud_name is disabled" to everything. Every taxi
 *     image upload was failing outright, and the one that mattered most, the
 *     driver selfie, explicitly asked to keep its original format.
 *
 * A door that skips the converter does not fail loudly. It stores a 4 MB JPEG,
 * serves it to every customer on the listing, and nobody notices until the
 * bandwidth bill or a slow phone does. So each door is checked here rather than
 * trusted.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const root = mkdtempSync(join(tmpdir(), 'webp-'));
process.env.UPLOAD_STORAGE_ROOT = root;
process.env.UPLOAD_BASE_URL = 'https://example.test/uploads';

const sharp = (await import('sharp')).default;
const storage = await import('../src/services/storage.service.js');
const shim = await import('../src/services/cloudinary.service.js');
const taxi = await import('../src/utils/cloudinaryUpload.js');

/** A real image, not a fake buffer: the converter reads actual pixels. */
const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 40, b: 40 } },
}).jpeg({ quality: 92 }).toBuffer();

const pngWithAlpha = await sharp({
    create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.4 } },
}).png().toBuffer();

const storedBytes = (relativePath) => readFileSync(join(root, relativePath));
/** WebP files start with RIFF....WEBP. */
const isWebp = (buffer) => buffer.subarray(0, 4).toString() === 'RIFF'
    && buffer.subarray(8, 12).toString() === 'WEBP';

console.log('\nthe converter itself');

await check('a JPEG becomes WebP, and smaller', async () => {
    const out = await storage.optimizeImageForStorage(jpeg, 'image/jpeg');
    assert.equal(out.mimeType, 'image/webp');
    assert.equal(out.extension, '.webp');
    assert.ok(isWebp(out.buffer), 'not a WebP file');
    assert.ok(out.buffer.length < jpeg.length, `${out.buffer.length} vs ${jpeg.length}`);
});

await check('transparency survives -- alpha goes lossless, not fringed', async () => {
    const out = await storage.optimizeImageForStorage(pngWithAlpha, 'image/png');
    assert.ok(isWebp(out.buffer));
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.hasAlpha, true, 'the alpha channel was dropped');
});

await check('a GIF is left alone so the animation survives', async () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    const out = await storage.optimizeImageForStorage(gif, 'image/gif');
    assert.equal(out.mimeType, 'image/gif');
    assert.equal(out.extension, '.gif');
});

console.log('\nevery door into it');

await check('storage.service saveImageBuffer -> .webp on disk', async () => {
    const stored = await storage.saveImageBuffer(jpeg, 'checks', { mimeType: 'image/jpeg' });
    assert.match(stored.path, /\.webp$/);
    assert.equal(stored.mimeType, 'image/webp');
    assert.ok(isWebp(storedBytes(stored.path)));
});

await check('the food/quick-commerce Cloudinary shim -> .webp on disk', async () => {
    const stored = await shim.uploadImageBufferDetailed(jpeg, 'checks');
    assert.match(stored.secure_url, /\.webp$/);
    assert.equal(stored.format, 'webp');
    assert.ok(isWebp(storedBytes(stored.public_id)));
});

await check('THE GAP: the taxi upload helper -> .webp on disk', async () => {
    // It used to POST to a Cloudinary account that is disabled, so this threw.
    const stored = await taxi.uploadBufferToCloudinary({
        buffer: jpeg,
        mimeType: 'image/jpeg',
        folder: 'taxi/drivers',
    });
    assert.match(stored.secureUrl, /\.webp$/);
    assert.equal(stored.format, 'webp');
    assert.ok(isWebp(storedBytes(stored.publicId)));
});

await check('  including the data-URL door the driver apps use', async () => {
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const stored = await taxi.uploadDataUrlToCloudinary({ dataUrl, folder: 'taxi/selfies' });
    assert.match(stored.secureUrl, /\.webp$/);
    assert.ok(isWebp(storedBytes(stored.publicId)));
});

await check('  and a caller asking to keep the original format still gets WebP', async () => {
    /*
     * The selfie upload passes `format: undefined`, meaning "keep the JPEG".
     * That was the one path deliberately opting out, and it is the highest
     * volume one on the platform.
     */
    const stored = await taxi.uploadBufferToCloudinary({
        buffer: jpeg,
        mimeType: 'image/jpeg',
        folder: 'taxi/selfies',
        format: undefined,
    });
    assert.match(stored.secureUrl, /\.webp$/);
    assert.ok(isWebp(storedBytes(stored.publicId)));
});

await check('THE UPLOAD BUG: a folder with a space (CLOUDINARY_FOLDER "Quick Drop-taxi") still uploads', async () => {
    // Every taxi admin upload was refused: "Folder may only contain letters,
    // numbers, /, _, and -".
    const stored = await taxi.uploadBufferToCloudinary({
        buffer: jpeg,
        mimeType: 'image/jpeg',
        folder: 'Quick Drop-taxi/app-modules',
    });
    assert.match(stored.publicId, /^Quick-Drop-taxi\/app-modules\//);
    assert.ok(isWebp(storedBytes(stored.publicId)));
});

await check('  and a folder cannot climb out of the upload root', () => {
    assert.equal(taxi.asStorageFolder('../../etc/passwd'), 'etc/passwd');
    assert.equal(taxi.asStorageFolder('a/./b'), 'a/b');
    assert.equal(taxi.asStorageFolder('a\\b c'), 'a/b-c');
    assert.equal(taxi.asStorageFolder('   '), 'taxi');
});

console.log('\nwhat must NOT be converted');

await check('a PDF is stored byte for byte', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
    const stored = await storage.saveDocumentFile(
        { buffer: pdf, mimetype: 'application/pdf', originalname: 'rx.pdf' },
        'checks',
    );
    assert.match(stored.path, /\.pdf$/);
    assert.deepEqual(storedBytes(stored.path), pdf, 'the PDF was altered');
});

await check('an unsupported image type is refused, not stored raw', async () => {
    await assert.rejects(
        () => storage.optimizeImageForStorage(Buffer.from('nope'), 'image/tiff'),
        /Unsupported image type/,
    );
});

rmSync(root, { recursive: true, force: true });
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
