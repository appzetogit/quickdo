/**
 * Give every food item a working image.
 *
 * Context: food media used to live on Cloudinary. That account is disabled, so
 * all 31 stored delivery URLs return 401 and the other 38 items never had an
 * image at all. This fetches a freely-licensed photo per dish from Wikimedia
 * Commons and stores it on local disk through the normal upload path, so the
 * result is byte-identical to what a restaurant uploading by hand would produce.
 *
 *   node scripts/backfill-food-images.mjs --dry-run   # show the mapping only
 *   node scripts/backfill-food-images.mjs             # fetch and write
 *   node scripts/backfill-food-images.mjs --only=Roti # single dish, by substring
 *
 * Licensing note: Commons images are free to use but most carry a CC-BY or
 * CC-BY-SA licence requiring attribution. Fine while testing; before a public
 * launch these should be replaced with owned or properly licensed photography.
 * The attribution URL for each file is recorded in `imageCredit` on the item.
 */
import '../src/config/env.js';
import mongoose from 'mongoose';
import axios from 'axios';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { saveImageFromUrl } from '../src/services/storage.service.js';

const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).toLowerCase() : null;
const force = process.argv.includes('--force');

const FOLDER = 'food/menu-items';

/**
 * Dish name -> Commons search term. First match wins, so these run specific
 * before generic: "Chicken Fried Rice" must beat both "chicken" and "rice".
 * The names in this database carry a lot of typos (Chicekn, Chesse, Cultes),
 * which is why these match loosely rather than on exact spelling.
 */
const TERMS = [
    [/fried\s*rice/i, 'fried rice dish'],
    [/jeera\s*rice/i, 'jeera rice'],
    [/plain\s*rice/i, 'steamed basmati rice'],
    [/butter\s*chicken/i, 'butter chicken'],
    [/tandoori\s*chick/i, 'tandoori chicken'],
    [/malai\s*tikka/i, 'chicken malai tikka'],
    [/chic\w*\s*tikka/i, 'chicken tikka'],
    [/rogan\s*josh/i, 'rogan josh'],
    [/lababdar|rahara|mughlai|do-?pyaza|kadhai\s*chick|lemon\s*chick|chic\w*\s*masala|chicken\s*curry/i, 'chicken curry indian'],
    [/chill?[iy]\s*chick/i, 'chilli chicken'],
    [/chic\w*\s*pakora|chic\w*\s*fry|tawa\s*chic/i, 'fried chicken pieces'],
    [/chic\w*\s*burger/i, 'chicken burger'],
    // Non-adjacent on purpose: "Chicken Grilled Sandwich" must not fall through
    // to the grilled-cheese rule below.
    [/chic\w*.*sandwich/i, 'chicken sandwich'],
    [/paneer\s*burger/i, 'paneer burger'],
    [/che?e?sse?\s*burger|cheese\s*burger/i, 'cheeseburger'],
    [/veg\s*burger/i, 'veggie burger'],
    [/grilled\s*sandwich|cheese\s*grilled/i, 'grilled cheese sandwich'],
    [/veg\s*sandwich/i, 'vegetable sandwich'],
    [/paneer\s*tikka/i, 'paneer tikka'],
    [/dal\s*makh/i, 'dal makhani'],
    [/rajma/i, 'rajma curry'],
    [/chana\s*chaat/i, 'chana chaat'],
    [/chana\s*masala/i, 'chana masala'],
    [/gobhi|gobi/i, 'gobi masala'],
    [/matar\s*mushroom|shahi\s*mushroom|lemon\s*mushroom|mushroom\s*masala/i, 'mushroom curry indian'],
    [/chat\s*papdi|papdi/i, 'papri chaat'],
    [/honey\s*chilli\s*potato/i, 'honey chilli potato'],
    [/french\s*fries/i, 'french fries'],
    [/spring\s*roll/i, 'spring roll'],
    [/cheese\s*pakora|veg\s*pakora|pakora/i, 'pakora'],
    [/cultes|cutlet/i, 'vegetable cutlet'],
    [/pao\s*bhaji|pav\s*bhaji/i, 'pav bhaji'],
    [/boondi\s*raita/i, 'boondi raita'],
    [/raita/i, 'raita'],
    [/plain\s*curd|curd/i, 'plain yogurt bowl'],
    [/green\s*salad|salad/i, 'green salad'],
    [/butter\s*naan/i, 'butter naan'],
    [/garlic\s*naan/i, 'garlic naan'],
    [/naan/i, 'naan bread'],
    [/lachha|parantha|paratha/i, 'paratha'],
    [/missi\s*roti/i, 'missi roti'],
    [/roti/i, 'roti chapati'],
    [/gulab\s*jamun/i, 'gulab jamun'],
    [/vanilla\s*shake/i, 'vanilla milkshake'],
    [/strawberry\s*shake/i, 'strawberry milkshake'],
    [/chocolate\s*shake/i, 'chocolate milkshake'],
    [/butter\s*scotch|butterscotch/i, 'butterscotch milkshake'],
    [/shake/i, 'milkshake'],
    [/egg/i, 'egg dish'],
    [/chic/i, 'chicken dish'],
    [/rice/i, 'cooked rice'],
];

const termFor = (name) => {
    for (const [pattern, term] of TERMS) {
        if (pattern.test(name)) return term;
    }
    return 'indian food dish';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wikimedia rate-limits hard: firing 69 searches back to back earned a 429 on
 * all but nine of them. Space the requests out and back off when throttled.
 */
const PACE_MS = 1200;
const withRetry = async (label, fn) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            const status = error?.response?.status;
            if (status !== 429 && status !== 503) throw error;
            const backoff = 2000 * 2 ** attempt;
            console.log(`      (${label}: ${status}, retrying in ${backoff / 1000}s)`);
            await sleep(backoff);
        }
    }
    throw new Error('rate limited after 5 attempts');
};

/** Commons search, cached per term. Returns a list of candidate image URLs. */
const candidateCache = new Map();
const fetchCandidates = async (term) => {
    if (candidateCache.has(term)) return candidateCache.get(term);

    const { data } = await withRetry(`search ${term}`, () => axios.get('https://commons.wikimedia.org/w/api.php', {
        params: {
            action: 'query',
            format: 'json',
            generator: 'search',
            gsrsearch: `${term} filetype:bitmap`,
            gsrnamespace: 6,
            gsrlimit: 12,
            prop: 'imageinfo',
            iiprop: 'url|mime',
            iiurlwidth: 1200,
        },
        timeout: 30000,
        headers: { 'User-Agent': 'QuickDrop/1.0 (media seeding; contact: admin@quickdrop.com)' },
    }));

    const pages = Object.values(data?.query?.pages || {});
    const urls = pages
        .map((p) => p?.imageinfo?.[0])
        .filter((info) => info && /^image\/(jpeg|png|webp)$/.test(info.mime || ''))
        // thumburl, not the original: Commons originals are routinely 10-40MB
        // and would blow past the upload size limit.
        .map((info) => ({ url: info.thumburl || info.url, page: info.descriptionurl }))
        .filter((c) => c.url);

    candidateCache.set(term, urls);
    return urls;
};

const main = async () => {
    await connectDB();
    const db = mongoose.connection.db;
    const collection = db.collection('food_items');

    let items = await collection.find({}).project({ name: 1, image: 1 }).toArray();
    if (only) items = items.filter((i) => String(i.name || '').toLowerCase().includes(only));

    // Resume by default: a throttled run leaves most items untouched, and
    // re-fetching the ones that already succeeded just burns rate limit.
    if (!force) {
        const before = items.length;
        items = items.filter((i) => !/\/uploads\//.test(String(i.image || '')));
        const skipped = before - items.length;
        if (skipped > 0) console.log(`skipping ${skipped} item(s) that already have a local image (--force to redo)`);
    }

    console.log(`${items.length} items to process${dryRun ? ' (dry run)' : ''}\n`);

    // Round-robin within a term so five burgers do not all get one photo.
    const usedPerTerm = new Map();
    let ok = 0;
    let failed = 0;

    for (const item of items) {
        const name = String(item.name || '').trim();
        const term = termFor(name);
        const label = name.slice(0, 26).padEnd(26);

        if (dryRun) {
            console.log(`  ${label} -> ${term}`);
            continue;
        }

        try {
            const candidates = await fetchCandidates(term);
            if (candidates.length === 0) {
                console.log(`  ${label} !! no Commons result for "${term}"`);
                failed += 1;
                continue;
            }

            const index = usedPerTerm.get(term) || 0;
            usedPerTerm.set(term, index + 1);
            const chosen = candidates[index % candidates.length];

            const stored = await withRetry(`fetch ${name}`, () => saveImageFromUrl(chosen.url, FOLDER));

            await collection.updateOne(
                { _id: item._id },
                {
                    $set: {
                        image: stored.url,
                        images: [stored.url],
                        imageCredit: chosen.page || '',
                        updatedAt: new Date(),
                    },
                },
            );

            console.log(`  ${label} -> ${term.padEnd(24)} ${(stored.size / 1024).toFixed(0).padStart(4)}KB  ${stored.url}`);
            ok += 1;
            await sleep(PACE_MS);
        } catch (error) {
            console.log(`  ${label} !! ${error?.message || error}`);
            failed += 1;
        }
    }

    if (!dryRun) console.log(`\ndone: ${ok} updated, ${failed} failed`);
    await disconnectDB();
    process.exit(failed > 0 && ok === 0 ? 1 : 0);
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
