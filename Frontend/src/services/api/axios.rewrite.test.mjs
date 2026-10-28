// The /food -> /qc admin rewrite.
//
// This exists because the first version of the rewrite only moved /food/admin, so every
// admin screen calling a different prefix (banners, restaurants, delivery, zones) kept
// writing into food while the operator was looking at quick-commerce.
//
// Run: node Frontend/src/services/api/axios.rewrite.test.mjs

import assert from 'node:assert/strict';

const SHARED_FOOD_PREFIXES = ['auth'];

// Mirrors rewriteAdminVertical in axios.js. Kept as a copy rather than imported because
// axios.js pulls in the browser bundle; if you change one, change both.
const rewrite = (url, path) => {
    if (typeof url !== 'string' || !url) return url;
    if (!path.startsWith('/admin/quick-commerce')) return url;
    const shared = SHARED_FOOD_PREFIXES.join('|');
    return url.replace(new RegExp(`(^|/)food/(?!(?:${shared})(?:/|$))`), '$1qc/');
};

const QC = '/admin/quick-commerce/banners';
const FOOD = '/admin/food/banners';

let failures = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ok   ${name}`); }
    catch (err) { failures++; console.log(`  FAIL ${name}\n         ${err.message}`); }
};

console.log('\n[1] the reported bug: banners uploaded in QC went to food');
{
    check('banner upload moves to qc', () =>
        assert.equal(rewrite('/food/hero-banners/multiple', QC), '/qc/hero-banners/multiple'));
    check('banner list moves to qc', () =>
        assert.equal(rewrite('/food/hero-banners', QC), '/qc/hero-banners'));
    check('promotional banner moves to qc', () =>
        assert.equal(rewrite('/food/hero-banners/home-promotion', QC), '/qc/hero-banners/home-promotion'));
}

console.log('\n[2] every other prefix the admin panel uses');
for (const [from, to] of [
    ['/food/admin/business-settings', '/qc/admin/business-settings'],
    ['/food/restaurant/list', '/qc/restaurant/list'],
    ['/food/delivery/partners', '/qc/delivery/partners'],
    ['/food/orders/123', '/qc/orders/123'],
    ['/food/user/profile', '/qc/user/profile'],
    ['/food/notifications', '/qc/notifications'],
    ['/food/search?q=x', '/qc/search?q=x'],
    ['/food/dining/restaurants', '/qc/dining/restaurants'],
    ['/food/zones', '/qc/zones'],
    ['/food/pages-social-media/terms', '/qc/pages-social-media/terms'],
]) {
    check(`${from} -> ${to}`, () => assert.equal(rewrite(from, QC), to));
}

console.log('\n[3] auth stays shared, so one login covers every vertical');
{
    check('/food/auth/admin is NOT rewritten', () =>
        assert.equal(rewrite('/food/auth/admin/login', QC), '/food/auth/admin/login'));
    check('/food/auth exactly is NOT rewritten', () =>
        assert.equal(rewrite('/food/auth', QC), '/food/auth'));
    check('/auth/admin is untouched', () =>
        assert.equal(rewrite('/auth/admin/login', QC), '/auth/admin/login'));
    // The guard is a prefix boundary, not a substring: a route that merely STARTS with
    // the letters "auth" is a different route and must still move.
    check('/food/authors still moves (not the auth prefix)', () =>
        assert.equal(rewrite('/food/authors', QC), '/qc/authors'));
}

console.log('\n[4] the food panel is untouched — the regression that matters most');
for (const u of ['/food/hero-banners/multiple', '/food/admin/business-settings', '/food/restaurant/list']) {
    check(`${u} unchanged on /admin/food`, () => assert.equal(rewrite(u, FOOD), u));
}
check('unchanged on the taxi panel', () => assert.equal(rewrite('/food/hero-banners', '/taxi/admin'), '/food/hero-banners'));
check('unchanged on the SP panel', () => assert.equal(rewrite('/food/admin/x', '/admin/sp/dashboard'), '/food/admin/x'));

console.log('\n[5] it must not corrupt unrelated urls');
{
    check('only the FIRST segment is replaced', () =>
        assert.equal(rewrite('/food/admin/food/nested', QC), '/qc/admin/food/nested'));
    check('a bare /uploads is left alone', () =>
        assert.equal(rewrite('/uploads/image', QC), '/uploads/image'));
    check('absolute urls keep their host', () =>
        assert.equal(rewrite('https://api.example.com/food/admin/x', QC), 'https://api.example.com/qc/admin/x'));
    check('empty and non-string inputs survive', () => {
        assert.equal(rewrite('', QC), '');
        assert.equal(rewrite(undefined, QC), undefined);
    });
    check('"seafood" is not "food"', () =>
        assert.equal(rewrite('/seafood/admin/x', QC), '/seafood/admin/x'));
}


console.log('[6] the sidebar rebases its links to the current vertical');
{
    // Mirrors currentAdminBase / rebaseAdminMenu in AdminSidebar.jsx. The menu hardcodes
    // 68 /admin/food paths; unrebased, the QC sidebar shows food's links and clicking one
    // navigates the operator straight back out into food.
    const FOOD_ADMIN_BASE = '/admin/food';
    const REUSED = ['/admin/quick-commerce'];
    const currentAdminBase = (p = '') => REUSED.find((b) => p.startsWith(b)) || FOOD_ADMIN_BASE;
    const rebaseAdminMenu = (nodes, base) => {
        if (base === FOOD_ADMIN_BASE || !Array.isArray(nodes)) return nodes;
        const reb = (x) => (typeof x === 'string' && x.startsWith(FOOD_ADMIN_BASE)
            ? base + x.slice(FOOD_ADMIN_BASE.length) : x);
        return nodes.map((n) => ({
            ...n,
            ...(n.path ? { path: reb(n.path) } : {}),
            ...(n.items ? { items: rebaseAdminMenu(n.items, base) } : {}),
            ...(n.subItems ? { subItems: rebaseAdminMenu(n.subItems, base) } : {}),
        }));
    };

    check('QC path selects the QC base', () =>
        assert.equal(currentAdminBase('/admin/quick-commerce/orders'), '/admin/quick-commerce'));
    check('food path selects the food base', () =>
        assert.equal(currentAdminBase('/admin/food/orders'), '/admin/food'));

    const menu = [
        { type: 'link', label: 'Dashboard', path: '/admin/food' },
        { type: 'section', items: [
            { type: 'expandable', label: 'Banners', path: '/admin/food/banners',
              subItems: [{ label: 'Promo', path: '/admin/food/promotional-banner' }] },
        ] },
    ];
    const qc = rebaseAdminMenu(menu, '/admin/quick-commerce');

    check('top-level link rebased', () => assert.equal(qc[0].path, '/admin/quick-commerce'));
    check('nested item rebased', () => assert.equal(qc[1].items[0].path, '/admin/quick-commerce/banners'));
    check('deeply nested subItem rebased', () =>
        assert.equal(qc[1].items[0].subItems[0].path, '/admin/quick-commerce/promotional-banner'));
    check('the source menu is NOT mutated', () => {
        assert.equal(menu[0].path, '/admin/food');
        assert.equal(menu[1].items[0].subItems[0].path, '/admin/food/promotional-banner');
    });
    check('food menu returned untouched, same reference', () =>
        assert.equal(rebaseAdminMenu(menu, '/admin/food'), menu));
}
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
