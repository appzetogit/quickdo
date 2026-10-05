/**
 * Upload smoke test — the safety net for the multer 1.x -> 2.x major bump.
 *
 * multer 1.4.5-lts.2 is deprecated by its maintainers ("Multer 1.x is impacted by a
 * number of vulnerabilities, which have been patched in 2.x") and 2.x swaps the
 * multipart parser from busboy 0.x/dicer to busboy 1.x. That is a parser replacement
 * on every file-upload path in the app, and before this file NOTHING in the suite
 * exercised an upload — the bump would have shipped entirely unverified.
 *
 * This drives the real middleware modules over real HTTP with real multipart bodies,
 * rather than reconstructed config, so it fails if an upload path actually breaks.
 *
 * Covers the multer surface the codebase depends on:
 *   - memoryStorage + .single()                 src/middleware/upload.js
 *   - limits.fileSize -> LIMIT_FILE_SIZE        src/modules/quickCommerce/middleware/upload.js
 *   - .fields() with maxCount                   serviceProvider uploadMiddleware
 *   - fileFilter rejection                      serviceProvider uploadMiddleware
 *   - multer.MulterError still an instanceof    serviceProvider handleMulterError
 *   - diskStorage via { dest }                  taxi userSafety.routes
 *   - text fields alongside files in req.body   every registration form
 *
 * serviceProvider's module itself is not imported: it is CommonJS and constructs a
 * CloudinaryStorage at load time, which needs live credentials. Its multer surface is
 * reproduced here instead.
 *
 * No database required.
 *
 * Run:  node tests/upload.smoke.mjs
 */
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${name}`);
        passed += 1;
    } catch (err) {
        console.error(`  FAIL  ${name}\n        ${err.message}`);
        failed += 1;
    }
};

/** Start an app on an ephemeral port and hand back a post() bound to it. */
const serve = async (build) => {
    const app = express();
    build(app);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    return {
        post: (pathname, body) =>
            fetch(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', body }),
        close: () => new Promise((resolve) => server.close(resolve)),
    };
};

const fileOf = (bytes, name, type) => new File([bytes], name, { type });

// ── memoryStorage + .single() ─────────────────────────────────────────────────
await test('memoryStorage .single() parses the file into req.file.buffer', async () => {
    const { upload } = await import('../src/middleware/upload.js');
    const srv = await serve((app) => {
        app.post('/u', upload.single('image'), (req, res) => {
            res.json({
                name: req.file?.originalname,
                mime: req.file?.mimetype,
                body: Buffer.from(req.file?.buffer || []).toString('utf8'),
                field: req.body?.caption,
            });
        });
    });
    try {
        const fd = new FormData();
        fd.append('image', fileOf('hello-bytes', 'a.png', 'image/png'));
        fd.append('caption', 'a caption');
        const res = await srv.post('/u', fd);
        assert.equal(res.status, 200);
        const out = await res.json();
        assert.equal(out.name, 'a.png');
        assert.equal(out.mime, 'image/png');
        assert.equal(out.body, 'hello-bytes', 'file contents did not survive the parser');
        // Text fields must still land in req.body — every registration form relies on
        // reading them in the same handler as the file.
        assert.equal(out.field, 'a caption', 'non-file fields were lost');
    } finally {
        await srv.close();
    }
});

// ── limits.fileSize ───────────────────────────────────────────────────────────
await test('the quick-commerce size cap still raises LIMIT_FILE_SIZE', async () => {
    // Small cap via the module's own env knob, so the real module is under test.
    process.env.MAX_UPLOAD_BYTES = '1024';
    const { upload } = await import('../src/modules/quickCommerce/middleware/upload.js');
    const srv = await serve((app) => {
        app.post('/u', upload.single('image'), (req, res) => res.json({ ok: true }));
        app.use((err, _req, res, _next) => {
            res.status(400).json({ isMulterError: err instanceof multer.MulterError, code: err.code });
        });
    });
    try {
        const under = new FormData();
        under.append('image', fileOf('x'.repeat(100), 'small.png', 'image/png'));
        assert.equal((await srv.post('/u', under)).status, 200, 'a file under the cap was rejected');

        const over = new FormData();
        over.append('image', fileOf('x'.repeat(5000), 'big.png', 'image/png'));
        const res = await srv.post('/u', over);
        assert.equal(res.status, 400);
        const out = await res.json();
        // handleMulterError branches on both of these; if either changes shape the
        // admin panel shows a generic 500 instead of "file too large".
        assert.equal(out.isMulterError, true, 'error is no longer a multer.MulterError');
        assert.equal(out.code, 'LIMIT_FILE_SIZE');
    } finally {
        delete process.env.MAX_UPLOAD_BYTES;
        await srv.close();
    }
});

// ── .fields() + fileFilter + LIMIT_UNEXPECTED_FILE ────────────────────────────
await test('.fields() with maxCount, fileFilter and unexpected-field all behave', async () => {
    const documentFilter = (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only images and PDF/DOC files are allowed!'), false);
    };
    const uploadDocuments = multer({
        storage: multer.memoryStorage(),
        fileFilter: documentFilter,
        limits: { fileSize: 5 * 1024 * 1024 },
    }).fields([
        { name: 'aadhar', maxCount: 1 },
        { name: 'pan', maxCount: 1 },
        { name: 'otherDocuments', maxCount: 5 },
    ]);

    const srv = await serve((app) => {
        app.post('/d', uploadDocuments, (req, res) => {
            res.json({
                aadhar: req.files?.aadhar?.length || 0,
                others: req.files?.otherDocuments?.length || 0,
            });
        });
        app.use((err, _req, res, _next) => {
            res.status(400).json({ isMulterError: err instanceof multer.MulterError, code: err.code, msg: err.message });
        });
    });
    try {
        const fd = new FormData();
        fd.append('aadhar', fileOf('id', 'aadhar.pdf', 'application/pdf'));
        fd.append('otherDocuments', fileOf('a', 'a.png', 'image/png'));
        fd.append('otherDocuments', fileOf('b', 'b.png', 'image/png'));
        const out = await (await srv.post('/d', fd)).json();
        assert.equal(out.aadhar, 1);
        assert.equal(out.others, 2, 'multiple files on one field name were not all parsed');

        // fileFilter rejection surfaces as a plain Error, not a MulterError.
        const bad = new FormData();
        bad.append('aadhar', fileOf('exe', 'x.exe', 'application/x-msdownload'));
        const rejected = await (await srv.post('/d', bad)).json();
        assert.match(rejected.msg, /Only images and PDF\/DOC files are allowed/);

        // A field name not in the list must still be LIMIT_UNEXPECTED_FILE.
        const unexpected = new FormData();
        unexpected.append('nope', fileOf('x', 'x.png', 'image/png'));
        const un = await (await srv.post('/d', unexpected)).json();
        assert.equal(un.isMulterError, true);
        assert.equal(un.code, 'LIMIT_UNEXPECTED_FILE');
    } finally {
        await srv.close();
    }
});

// ── disk storage via { dest } ─────────────────────────────────────────────────
await test('{ dest } disk storage still writes the file to disk', async () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'multer-smoke-'));
    const diskUpload = multer({ dest });
    const srv = await serve((app) => {
        app.post('/s', diskUpload.single('evidence'), (req, res) =>
            res.json({ savedTo: req.file?.path, size: req.file?.size }));
    });
    try {
        const fd = new FormData();
        fd.append('evidence', fileOf('incident-data', 'clip.mp4', 'video/mp4'));
        const out = await (await srv.post('/s', fd)).json();
        assert.ok(out.savedTo, 'no path was written to req.file.path');
        assert.equal(fs.readFileSync(out.savedTo, 'utf8'), 'incident-data');
        assert.equal(out.size, Buffer.byteLength('incident-data'));
    } finally {
        await srv.close();
        fs.rmSync(dest, { recursive: true, force: true });
    }
});

// ── the parser that motivated the bump ────────────────────────────────────────
await test('multer runs on busboy 1.x (dicer, the 1.x vulnerability, is gone)', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const busboyVersion = require('busboy/package.json').version;
    assert.match(busboyVersion, /^1\./, `expected busboy 1.x, got ${busboyVersion}`);
    const multerVersion = require('multer/package.json').version;
    assert.match(multerVersion, /^2\./, `expected multer 2.x, got ${multerVersion}`);
    assert.throws(() => require.resolve('dicer'), 'dicer is still installed');
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
