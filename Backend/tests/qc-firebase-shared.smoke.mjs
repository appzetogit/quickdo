/**
 * Quick commerce uses the platform's Firebase, not a second copy that is never
 * initialised.
 *
 * Run: node tests/qc-firebase-shared.smoke.mjs
 *
 * quickCommerce/config/firebase.js held its own firebase-admin setup, and nothing
 * ever called its `initializeFirebaseRealtime()` -- server.js initialises only
 * the platform module. Its `db` and `messaging` stayed null, so every getter
 * threw "Firebase Realtime Database not initialized". Callers caught it, so
 * nothing crashed: quick-commerce and medical live order tracking just never
 * reached Firebase. Production's error log held 273 of them.
 */
import assert from 'node:assert/strict';

const qc = await import('../src/modules/quickCommerce/config/firebase.js');
const main = await import('../src/config/firebase.js');

let failed = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (err) { failed += 1; console.log(`  FAIL  ${label}\n        ${err.message}`); }
};

check('quick commerce reads the same Firebase the platform initialises', () => {
  // The same functions, so whatever server.js initialised is what QC gets --
  // there is no second module-local instance left to stay null.
  assert.equal(qc.getFirebaseDB, main.getFirebaseDB);
  assert.equal(qc.getFirebaseMessaging, main.getFirebaseMessaging);
  assert.equal(qc.initializeFirebaseRealtime, main.initializeFirebaseRealtime);
  assert.equal(qc.default, main.default);
});

check('an unconfigured Firebase returns null rather than throwing', () => {
  // Every caller in quick commerce checks `if (db)`. A getter that throws turns
  // "tracking unavailable" into an exception the caller has to know to catch.
  let db;
  assert.doesNotThrow(() => { db = qc.getFirebaseDB(); });
  assert.equal(db, null);
  let msg;
  assert.doesNotThrow(() => { msg = qc.getFirebaseMessaging(); });
  assert.equal(msg, null);
});

check('every name quick commerce imported is still exported', () => {
  for (const name of ['initializeFirebaseRealtime', 'getFirebaseDB', 'getFirebaseMessaging', 'default']) {
    assert.equal(typeof qc[name] === 'function' || typeof qc[name] === 'object', true, name);
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
