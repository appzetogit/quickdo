/**
 * Checks for the money-path transaction helper.
 *
 *   node tests/transaction.test.js
 *
 * No database required — the session is faked so both deployment modes
 * (replica set and standalone) can be exercised deterministically.
 */
const assert = require('assert');
const mongoose = require('mongoose');
const {
  withTransaction,
  abort,
  TransactionAbort,
  __setSupportedForTests
} = require('../utils/withTransaction');

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push([true, name]);
  } catch (err) {
    results.push([false, `${name}\n    ${err.message}`]);
  }
};

// ── Fake session so we can observe commit/abort without a live replica set ──
const realStartSession = mongoose.startSession.bind(mongoose);
let lastSession = null;

const installFakeSession = () => {
  mongoose.startSession = async () => {
    const session = {
      committed: false,
      aborted: false,
      ended: false,
      // Mirrors the driver: run the callback, abort if it throws, else commit.
      withTransaction: async (fn) => {
        try {
          const out = await fn();
          session.committed = true;
          return out;
        } catch (err) {
          session.aborted = true;
          throw err;
        }
      },
      endSession: async () => { session.ended = true; }
    };
    lastSession = session;
    return session;
  };
};

const main = async () => {
  installFakeSession();

  // ── Transaction-capable deployment ──────────────────────────────────────
  __setSupportedForTests(true);

  await check('commits and returns the callback value on success', async () => {
    const out = await withTransaction(async (session) => {
      assert.ok(session, 'callback should receive a session');
      return { ok: 1 };
    });
    assert.deepStrictEqual(out, { ok: 1 });
    assert.strictEqual(lastSession.committed, true, 'should have committed');
    assert.strictEqual(lastSession.aborted, false, 'should not have aborted');
    assert.strictEqual(lastSession.ended, true, 'session must always be ended');
  });

  await check('abort() rolls back and resolves to the payload', async () => {
    const out = await withTransaction(async () => {
      abort({ insufficient: true });
      throw new Error('abort() must stop execution');
    });
    assert.deepStrictEqual(out, { insufficient: true });
    assert.strictEqual(lastSession.aborted, true, 'abort() must abort the transaction');
    assert.strictEqual(lastSession.committed, false, 'aborted txn must NOT commit');
    assert.strictEqual(lastSession.ended, true);
  });

  // This is the trap the money paths depend on: a plain `return` COMMITS.
  // If someone "simplifies" an abort() back into a return, the wallet claim it
  // was meant to undo would be committed instead.
  await check('a plain return commits (documents why error paths must abort)', async () => {
    await withTransaction(async () => ({ insufficient: true }));
    assert.strictEqual(lastSession.committed, true);
    assert.strictEqual(lastSession.aborted, false);
  });

  await check('real errors propagate and roll back', async () => {
    await assert.rejects(
      () => withTransaction(async () => { throw new Error('boom'); }),
      /boom/
    );
    assert.strictEqual(lastSession.aborted, true);
    assert.strictEqual(lastSession.ended, true, 'session must be ended even when throwing');
  });

  // ── Standalone deployment (no transaction support) ───────────────────────
  __setSupportedForTests(false);

  await check('degraded mode still runs the work, with no session', async () => {
    let received = 'unset';
    const out = await withTransaction(async (session) => {
      received = session;
      return { ok: 2 };
    });
    assert.deepStrictEqual(out, { ok: 2 });
    // undefined, not null: `{ session: undefined }` is identical to omitting it.
    assert.strictEqual(received, undefined);
  });

  await check('degraded mode still honours abort()', async () => {
    const out = await withTransaction(async () => abort({ nope: true }));
    assert.deepStrictEqual(out, { nope: true });
  });

  await check('degraded mode still propagates real errors', async () => {
    await assert.rejects(
      () => withTransaction(async () => { throw new Error('kaboom'); }),
      /kaboom/
    );
  });

  await check('TransactionAbort is distinguishable from ordinary errors', async () => {
    const e = new TransactionAbort({ a: 1 });
    assert.ok(e instanceof Error);
    assert.strictEqual(e.name, 'TransactionAbort');
    assert.deepStrictEqual(e.payload, { a: 1 });
  });

  // ── Source guard: Model.create(doc, { session }) silently means "two docs" ──
  // Mongoose reads create(a, b) as two documents to insert, so the options object
  // becomes a second (garbage) document AND the session is never applied — the
  // write escapes the transaction. Array form is mandatory.
  await check('no Model.create(doc, { session }) non-array form in controllers', async () => {
    const fs = require('fs');
    const path = require('path');

    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name))
        : (e.name.endsWith('.js') ? [path.join(d, e.name)] : []));

    // `.create({ ...anything... }, { session` — the broken shape.
    const bad = /\.create\(\s*\{[\s\S]{0,4000}?\}\s*,\s*\{[^}]*session/;

    const offenders = walk(path.join(__dirname, '../controllers'))
      .filter(f => bad.test(fs.readFileSync(f, 'utf8')));

    assert.deepStrictEqual(offenders, [],
      `these files pass a session to create() without the array form:\n${offenders.join('\n')}`);
  });

  mongoose.startSession = realStartSession;

  let failed = 0;
  for (const [ok, name] of results) {
    console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
};

main();
