// Billing audit: properties that must hold however the bill is computed,// checked across hand-picked edge cases and 4000 randomised carts.//// Run:  node src/modules/food/shared/billing.audit.mjs   (exits non-zero on failure)//// It also mirrors the bill layout the customer sees in Cart.jsx and// UserOrderDetails.jsx (P8), because a bill whose printed lines do not add up to// the printed total is a defect even when the amount charged is right. That// mirror is a copy of frontend logic -- if the display rule changes there,// change displaySum() here too.
import { computeBill, DEFAULT_PLATFORM_FEE_GST_RATE } from './billing.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const failures = [];
const counts = {};
function assert(prop, ok, scenario, detail) {
    counts[prop] = counts[prop] || { pass: 0, fail: 0 };
    counts[prop][ok ? 'pass' : 'fail'] += 1;
    if (!ok && failures.length < 12) failures.push({ prop, scenario, detail });
}

// The display rule used by Cart.jsx and UserOrderDetails.jsx.
function displaySum(b) {
    // Mirrors the shipped guard exactly, including the legacy fallback.
    const packBefore = Number(b.netPackagingFeeBeforeDiscount);
    const packInclusive = Number(b.packagingFee ?? 0) <= 0
        || (Number.isFinite(packBefore) && packBefore < Number(b.packagingFee ?? 0) - 0.005);
    const gross = b.pricesIncludeGst === true && packInclusive;
    const item = gross ? b.itemAmount : b.netItemAmountBeforeDiscount;
    const pack = gross ? b.packagingFee : b.netPackagingFeeBeforeDiscount;
    const disc = gross ? b.discount : b.discountOnNet;
    const gst = gross ? 0 : b.gstOnItems;
    return r2(item + pack + b.deliveryFee + (b.platformFee + b.platformFeeGst)
        + b.surgeAmount + gst - disc + b.tip + b.roundOff);
}

function audit(input, label) {
    const b = computeBill(input);
    const g = (input.gstRate ?? 0) / 100;
    const pfRate = input.platformFeeGstRate ?? DEFAULT_PLATFORM_FEE_GST_RATE;

    // P1 — every component adds up to what is charged.
    const parts = b.taxableAmount + b.gstOnItems + b.deliveryFee + b.surgeAmount
        + b.platformFee + b.platformFeeGst + b.tip + b.roundOff;
    assert('P1  components sum to grand total', near(parts, b.grandTotal), label,
        `parts ${r2(parts)} vs total ${b.grandTotal}`);

    // P2 — no negative money anywhere.
    const money = ['itemAmount','packagingFee','discount','netItemAmount','netPackagingFee',
        'taxableAmount','gstOnItems','deliveryFee','surgeAmount','platformFee','platformFeeGst',
        'tip','grandTotal','commissionBase'];
    const neg = money.filter((k) => Number(b[k]) < -0.0001);
    assert('P2  no negative amounts', neg.length === 0, label, `negative: ${neg.join(',')}`);

    // P3 — only the final figure is rounded, so round-off is under half a rupee.
    assert('P3  round-off within half a rupee', Math.abs(b.roundOff) <= 0.5 + 1e-9, label,
        `roundOff ${b.roundOff}`);

    // P4 — taxable base is exactly the two net lines.
    assert('P4  taxable = net items + net packaging',
        near(b.taxableAmount, r2(b.netItemAmount + b.netPackagingFee)), label,
        `${b.taxableAmount} vs ${r2(b.netItemAmount + b.netPackagingFee)}`);

    // P5 — the platform fee carries its own rate, independent of the food rate.
    assert('P5  platform fee GST = fee x its own rate',
        near(b.platformFeeGst, r2(b.platformFee * (Math.min(Math.max(pfRate, 0), 100) / 100))), label,
        `${b.platformFeeGst} vs ${r2(b.platformFee * (pfRate / 100))}`);

    // P6 — the coupon never exceeds what food + packaging are worth.
    assert('P6  discount capped at food + packaging',
        b.discount <= r2(b.itemAmount + b.packagingFee) + 0.011, label,
        `discount ${b.discount} vs ${r2(b.itemAmount + b.packagingFee)}`);

    // P7 — the net lines before and after the coupon differ by exactly discountOnNet,
    //      which is what lets a summary print item - discount + tax and land on the total.
    assert('P7  discountOnNet reconciles the net lines',
        near((b.netItemAmountBeforeDiscount + b.netPackagingFeeBeforeDiscount) - b.discountOnNet,
             b.netItemAmount + b.netPackagingFee), label,
        `before ${r2(b.netItemAmountBeforeDiscount + b.netPackagingFeeBeforeDiscount)} - ${b.discountOnNet}`);

    // P8 — the printed bill adds up to the printed total.
    assert('P8  displayed lines sum to total', near(displaySum(b), b.grandTotal), label,
        `displayed ${displaySum(b)} vs ${b.grandTotal}`);

    // P8b — an order placed before the pre-coupon packaging figure existed still
    //       prints a bill that adds up, via the exclusive fallback.
    const legacy = { ...b };
    delete legacy.netPackagingFeeBeforeDiscount;
    delete legacy.netItemAmountBeforeDiscount;
    delete legacy.discountOnNet;
    const legacySum = r2(legacy.netItemAmount + legacy.netPackagingFee + legacy.deliveryFee
        + (legacy.platformFee + legacy.platformFeeGst) + legacy.surgeAmount
        + legacy.gstOnItems + legacy.tip + legacy.roundOff);
    assert('P8b legacy bill (no pre-coupon fields) still adds up',
        near(legacySum, b.grandTotal), label, `legacy ${legacySum} vs ${b.grandTotal}`);

    const fullyExclusive = (input.gstInclusiveItemAmount ?? (input.pricesIncludeGst ? input.itemAmount : 0)) === 0;
    const fullyInclusive = input.pricesIncludeGst === true
        && (input.gstInclusiveItemAmount === undefined
            || input.gstInclusiveItemAmount >= (input.itemAmount ?? 0));

    // P9 — on an exclusive cart the tax is simply the rate applied to the base.
    if (fullyExclusive && !input.packagingBelongsToRestaurant) {
        assert('P9  exclusive: tax = rate x taxable base',
            near(b.gstOnItems, r2(b.taxableAmount * g), 0.02), label,
            `gst ${b.gstOnItems} vs ${r2(b.taxableAmount * g)}`);
        assert('P9b exclusive: net items = listed items after coupon',
            near(b.netItemAmount, r2(Math.max(0, (input.itemAmount ?? 0) - b.discount))), label,
            `net ${b.netItemAmount}`);
    }

    // P10 — on a fully inclusive cart the customer pays the listed price for the
    //       food: the tax comes out of it rather than being added to it.
    if (fullyInclusive && input.packagingBelongsToRestaurant && (input.packagingFee ?? 0) >= 0) {
        const listedAfterCoupon = r2(Math.max(0, (input.itemAmount ?? 0) + (input.packagingFee ?? 0) - b.discount));
        assert('P10 inclusive: taxable + tax = the listed price',
            near(b.taxableAmount + b.gstOnItems, listedAfterCoupon, 0.02), label,
            `${r2(b.taxableAmount + b.gstOnItems)} vs listed ${listedAfterCoupon}`);
    }

    // P11 — commission is charged on the food net of any tax inside it, never more.
    assert('P11 commission base never exceeds listed food',
        b.commissionBase <= b.itemAmount + 0.011, label,
        `base ${b.commissionBase} vs items ${b.itemAmount}`);
    if (fullyExclusive) {
        assert('P11b exclusive: commission base = listed food',
            near(b.commissionBase, b.itemAmount), label,
            `${b.commissionBase} vs ${b.itemAmount}`);
    }

    return b;
}

// ── hand-picked edges ────────────────────────────────────────────────────────
const edges = [
    ['empty cart', { itemAmount: 0, gstRate: 5 }],
    ['zero GST rate', { itemAmount: 200, gstRate: 0, deliveryFee: 10, platformFee: 10 }],
    ['100% GST rate', { itemAmount: 200, gstRate: 100, deliveryFee: 10, platformFee: 10 }],
    ['coupon equals food', { itemAmount: 200, discount: 200, gstRate: 5, platformFee: 10 }],
    ['coupon exceeds food', { itemAmount: 200, discount: 500, gstRate: 5, platformFee: 10 }],
    ['coupon exceeds food+packaging', { itemAmount: 200, packagingFee: 20, discount: 9999, gstRate: 5 }],
    ['negative inputs', { itemAmount: -50, packagingFee: -5, deliveryFee: -10, discount: -3, gstRate: 5 }],
    ['tip above the cap', { itemAmount: 200, tip: 99999, gstRate: 5 }],
    ['inclusive, tiny amount', { itemAmount: 0.03, pricesIncludeGst: true, gstInclusiveItemAmount: 0.03, gstRate: 5 }],
    ['very large order', { itemAmount: 250000, gstRate: 5, deliveryFee: 200, platformFee: 50 }],
    ['inclusive flag but 0 inclusive', { itemAmount: 200, pricesIncludeGst: true, gstInclusiveItemAmount: 0, gstRate: 5 }],
    ['inclusive amount exceeds items', { itemAmount: 200, pricesIncludeGst: true, gstInclusiveItemAmount: 9999, gstRate: 5 }],
    ['restaurant packaging, inclusive', { itemAmount: 200, packagingFee: 30, pricesIncludeGst: true, gstInclusiveItemAmount: 200, packagingBelongsToRestaurant: true, gstRate: 5 }],
    ['platform packaging, inclusive', { itemAmount: 200, packagingFee: 30, pricesIncludeGst: true, gstInclusiveItemAmount: 200, packagingBelongsToRestaurant: false, gstRate: 5 }],
    ['everything at once', { itemAmount: 640.55, packagingFee: 35.5, deliveryFee: 42, platformFee: 12, surgeAmount: 18, discount: 125.75, tip: 40, gstRate: 5, platformFeeGstRate: 18, pricesIncludeGst: true, gstInclusiveItemAmount: 400.25, packagingBelongsToRestaurant: true }],
];
for (const [label, input] of edges) audit(input, label);

// ── randomised carts ─────────────────────────────────────────────────────────
let seed = 20260907;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

for (let i = 0; i < 4000; i++) {
    const items = r2(rnd() * 2000);
    const inclusiveShare = pick([0, 0, 1, 1, rnd()]);
    const input = {
        itemAmount: items,
        packagingFee: pick([0, 0, r2(rnd() * 60)]),
        deliveryFee: pick([0, r2(rnd() * 90)]),
        platformFee: pick([0, 10, r2(rnd() * 30)]),
        surgeAmount: pick([0, 0, r2(rnd() * 50)]),
        discount: pick([0, 0, r2(rnd() * items * 1.3)]),
        tip: pick([0, 0, r2(rnd() * 120)]),
        gstRate: pick([0, 5, 12, 18, 28]),
        platformFeeGstRate: pick([0, 5, 18]),
        pricesIncludeGst: inclusiveShare > 0,
        gstInclusiveItemAmount: r2(items * inclusiveShare),
        packagingBelongsToRestaurant: rnd() > 0.5,
    };
    audit(input, `random#${i}`);
}

// ── behavioural properties across whole families of carts ────────────────────
function family(label, base) {
    // A fully inclusive cart's total must not move when the GST rate changes:
    // the tax is inside the price either way.
    const incl = { ...base, pricesIncludeGst: true, gstInclusiveItemAmount: base.itemAmount, packagingBelongsToRestaurant: true };
    const a = computeBill({ ...incl, gstRate: 5 }).grandTotal;
    const bb = computeBill({ ...incl, gstRate: 18 }).grandTotal;
    assert('P12 inclusive total is independent of the GST rate', a === bb, label, `5% -> ${a}, 18% -> ${bb}`);

    // An exclusive cart's total must rise with the rate.
    const exc = { ...base, pricesIncludeGst: false, gstInclusiveItemAmount: 0 };
    const lo = computeBill({ ...exc, gstRate: 5 }).grandTotal;
    const hi = computeBill({ ...exc, gstRate: 18 }).grandTotal;
    assert('P13 exclusive total rises with the GST rate', hi >= lo, label, `5% -> ${lo}, 18% -> ${hi}`);

    // A tip is the rider's and untaxed, so it moves the total one-for-one.
    const noTip = computeBill({ ...exc, gstRate: 5, tip: 0 });
    const withTip = computeBill({ ...exc, gstRate: 5, tip: 50 });
    assert('P14 tip is untaxed and passes straight through',
        near(withTip.grandTotal - noTip.grandTotal, 50, 1.01), label,
        `delta ${withTip.grandTotal - noTip.grandTotal}`);

    // Delivery is the rider's too.
    const noDel = computeBill({ ...exc, gstRate: 5, deliveryFee: 0 });
    const withDel = computeBill({ ...exc, gstRate: 5, deliveryFee: 40 });
    assert('P15 delivery is untaxed and passes straight through',
        near(withDel.grandTotal - noDel.grandTotal, 40, 1.01), label,
        `delta ${withDel.grandTotal - noDel.grandTotal}`);

    // A bigger coupon can never raise the bill.
    let prev = Infinity;
    for (const d of [0, 25, 50, 100, 200]) {
        const t = computeBill({ ...exc, gstRate: 5, discount: d }).grandTotal;
        assert('P16 a larger coupon never raises the total', t <= prev + 0.011, label, `discount ${d} -> ${t}`);
        prev = t;
    }
}
family('modest cart', { itemAmount: 200, packagingFee: 20, deliveryFee: 10, platformFee: 10, surgeAmount: 0, tip: 0 });
family('large cart', { itemAmount: 1875.5, packagingFee: 45, deliveryFee: 60, platformFee: 25, surgeAmount: 30, tip: 0 });
family('no fees', { itemAmount: 349, packagingFee: 0, deliveryFee: 0, platformFee: 0, surgeAmount: 0, tip: 0 });

// ── report ───────────────────────────────────────────────────────────────────
console.log('PROPERTY                                            PASS    FAIL');
console.log('─'.repeat(70));
let totalFail = 0;
for (const [prop, c] of Object.entries(counts).sort()) {
    totalFail += c.fail;
    console.log(`${prop.padEnd(50)}${String(c.pass).padStart(6)}${String(c.fail).padStart(8)}${c.fail ? '  <-- FAIL' : ''}`);
}
console.log('─'.repeat(70));
console.log(totalFail === 0
    ? `ALL PROPERTIES HOLD across ${edges.length} edge cases + 4000 randomised carts`
    : `${totalFail} ASSERTION FAILURES`);
if (failures.length) {
    console.log('\nfirst failures:');
    for (const f of failures) console.log(`  ${f.prop}\n     scenario: ${f.scenario}\n     ${f.detail}`);
}
process.exit(totalFail === 0 ? 0 : 1);
