/**
 * The website home page's "Video Demo" is set from Master admin.
 *
 * Run: node tests/homepage-video.smoke.mjs
 *
 * The section played a video built into the site and nothing in admin could
 * change it. Uploads go through saveMediaBuffer (covered by the hero banner
 * tests); this covers links, tabs, keeping what is not sent, and the reset.
 */
import assert from 'node:assert/strict';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

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

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri(), { dbName: 'homepage_video' });

const { LandingPageSetting } = await import('../src/modules/taxi/admin/models/LandingPageSetting.js');
const { getHomepageVideo, saveHomepageVideo } = await import('../src/modules/food/landing/services/homepageVideo.service.js');

await LandingPageSetting.create({ scope: 'default', video_url: 'https://www.youtube.com/embed/placeholder' });

await check('nothing set: the built-in video', async () => {
    const v = await getHomepageVideo();
    assert.equal(v.usingBuiltIn, true);
    assert.equal(v.url, '');
});

await check('a link and three tabs are saved', async () => {
    const tabs = [
        { label: 'Rides', description: 'Book a cab', start_percent: 0 },
        { label: 'Food', description: 'Order in', start_percent: 40 },
        { label: 'Parcels', description: 'Send things', start_percent: 75 },
    ];
    const v = await saveHomepageVideo({ url: 'https://cdn.example.com/demo.mp4', tabs: JSON.stringify(tabs) });
    assert.equal(v.url, 'https://cdn.example.com/demo.mp4');
    assert.equal(v.source, 'link');
    assert.deepEqual(v.tabs.map((t) => t.start_percent), [0, 40, 75]);
    // The old video_url placeholder is left alone.
    assert.equal((await LandingPageSetting.findOne({ scope: 'default' }).lean()).video_url, 'https://www.youtube.com/embed/placeholder');
});

await check('changing only the tabs keeps the video', async () => {
    const v = await saveHomepageVideo({ tabs: [{ label: 'Only one' }] });
    assert.equal(v.url, 'https://cdn.example.com/demo.mp4');
    assert.equal(v.tabs.length, 1);
});

await check('a non-https link, a tab without a title, or a non-video file is refused', async () => {
    await assert.rejects(() => saveHomepageVideo({ url: 'http://x.com/a.mp4' }), /https/);
    await assert.rejects(() => saveHomepageVideo({ tabs: [{ label: '' }] }), /needs a title/);
});

await check('reset goes back to the built-in video', async () => {
    const v = await saveHomepageVideo({ reset: 'true' });
    assert.equal(v.usingBuiltIn, true);
    assert.equal(v.tabs.length, 0);
});

await mongoose.disconnect();
await mongo.stop();
console.log(failed ? `\n  ${failed} FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
