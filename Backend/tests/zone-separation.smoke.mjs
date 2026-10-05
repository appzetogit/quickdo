/**
 * One vertical's zones must never be another's.
 *
 * Run: node tests/zone-separation.smoke.mjs
 *
 * Food, quick commerce (which is what /admin/medical edits) and taxi each draw
 * their own delivery zones, in their own panels, against their own maps. They
 * are three separate things that happen to share a shape, and the platform
 * keeps them apart in three ways -- a distinct mongoose model name, a distinct
 * collection, and a panel whose API calls are rewritten to its own vertical.
 *
 * If any of those slipped, the failure would be quiet and expensive: a zone
 * drawn in Medical would appear in Food, a seller's zoneId would resolve
 * against the wrong map, and an order would be refused as "we don't deliver
 * there" for an address the vertical plainly covers. Nothing would throw.
 *
 * Two of the three are checked here. The third -- the panel rewrite -- lives in
 * the browser (Frontend/src/services/api/axios.js) and is checked by reading
 * its rule rather than running it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const food = await import('../src/modules/food/admin/models/zone.model.js');
const qc = await import('../src/modules/quickCommerce/modules/food/admin/models/zone.model.js');
const taxi = await import('../src/modules/taxi/driver/models/Zone.js');

const zones = [
    { vertical: 'food', model: food.FoodZone },
    { vertical: 'quick commerce / medical', model: qc.QCZone },
    { vertical: 'taxi', model: taxi.Zone },
];

console.log('\nthree verticals, three zone stores');

for (const { vertical, model } of zones) {
    console.log(`  ${vertical.padEnd(26)} model ${model.modelName.padEnd(10)} collection ${model.collection.name}`);
}

check('no two verticals share a mongoose model', () => {
    const names = zones.map((z) => z.model.modelName);
    assert.equal(new Set(names).size, names.length, names.join(', '));
});

check('no two verticals share a collection', () => {
    const collections = zones.map((z) => z.model.collection.name);
    assert.equal(new Set(collections).size, collections.length, collections.join(', '));
});

check('quick commerce and medical read qc_zones, not food_zones', () => {
    // Medical is not a fourth vertical: a pharmacy is a quick-commerce seller,
    // so /admin/medical edits exactly this collection.
    assert.equal(qc.QCZone.collection.name, 'qc_zones');
    assert.notEqual(qc.QCZone.collection.name, food.FoodZone.collection.name);
});

check('the deprecated FoodZone export from the qc module IS the qc model', () => {
    // Four files still import it under that name. If it ever resolved to the
    // food model instead, quick commerce would silently read food's zones.
    assert.equal(qc.FoodZone, qc.QCZone);
    assert.equal(qc.FoodZone.collection.name, 'qc_zones');
});

console.log('\nthe panel that edits them');

const axiosSource = readFileSync(
    join(backendRoot, '..', 'Frontend', 'src', 'services', 'api', 'axios.js'),
    'utf8',
);

check('/admin/medical is routed to the quick-commerce API', () => {
    assert.match(axiosSource, /\{\s*base:\s*"\/admin\/medical",\s*scope:\s*"pharmacy"\s*\}/);
});

check('zones are NOT exempt from that rewrite', () => {
    /*
     * The rewrite turns /food/<x> into /qc/<x> for every path except a short
     * exemption list. If "zones" were ever added to it, the Medical panel would
     * read and WRITE food_zones while believing it was editing its own -- the
     * exact collision these models exist to prevent, arriving through the
     * browser rather than through mongoose.
     */
    const m = /const SHARED_FOOD_PREFIXES = \[([^\]]*)\]/.exec(axiosSource);
    assert.ok(m, 'the exemption list is gone; the rewrite rule has changed');
    const exempt = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    assert.ok(!exempt.includes('zones'), `zones is exempt from the rewrite: ${exempt.join(', ')}`);
});

console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
