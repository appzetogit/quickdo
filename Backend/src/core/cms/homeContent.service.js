import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';

/**
 * Every picture on the customer app's home screens, in one place
 * (Master > Banner & Settings > Home Screen Banners).
 *
 * Seven kinds of banner live in seven collections across Food and Quick, each
 * edited from a different screen. What an operator wants from one place is to
 * see what customers see on each home screen right now, pause something fast,
 * and know where to go to change it. Uploading and editing stay on each
 * service's own screen -- their forms differ (linked restaurants, zones,
 * schedules) -- except Quick's top banners, which have a working API and no
 * screen at all, so they are uploaded from here.
 *
 * Only what the app actually shows is listed, checked against the app:
 *   header    food_hero_banners, by `module`: the artwork at the top of each
 *             section's home (Food, Rides, Quick, Medical, Parcel, Rental,
 *             Services). The app asks for its section by name.
 *   foodPromo food_home_promotion_banners: the strip on Food's home.
 *   quickHero qc_hero_banners: the slider on Quick's home.
 *   quickTop  qc_top_banners: the top row on Quick's home.
 *   quickPromo qc_home_promotion_banners: the strip on Quick's home.
 * Taxi's own "banners" are push campaigns (Taxi > Promotions); the app's Rides
 * home shows no banner besides its header artwork.
 *
 * Each list is read under that service's "Banners & pages" permission.
 */

const SECTIONS = [
  ['food', 'Food'],
  ['taxi', 'Rides'],
  ['quick_commerce', 'Quick'],
  ['medical', 'Medical'],
  ['porter', 'Parcel'],
  ['rental', 'Rental'],
  ['services', 'Services'],
];

export const GROUPS = {
  header: {
    label: 'Section header artwork',
    where: 'The picture at the top of each section\'s home screen',
    service: 'food',
    collection: 'food_hero_banners',
    editPath: '/admin/food/banners',
  },
  foodPromo: {
    label: 'Food home promotion strip',
    where: 'Food home, below the categories',
    service: 'food',
    collection: 'food_home_promotion_banners',
    zones: 'food_zones',
    editPath: '/admin/food/promotional-banner',
  },
  quickHero: {
    label: 'Quick home slider',
    where: 'Quick home, the main slider',
    service: 'quickCommerce',
    collection: 'qc_hero_banners',
    editPath: '/admin/quick-commerce/banners',
  },
  quickTop: {
    label: 'Quick home top banners',
    where: 'Quick home, the row at the very top',
    service: 'quickCommerce',
    collection: 'qc_top_banners',
    editPath: null, // uploaded from the Master page itself
  },
  quickPromo: {
    label: 'Quick home promotion strip',
    where: 'Quick home, below the categories',
    service: 'quickCommerce',
    collection: 'qc_home_promotion_banners',
    zones: 'qc_zones',
    editPath: '/admin/quick-commerce/promotional-banner',
  },
};

const coll = (name) => mongoose.connection.collection(name);
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

const canSee = (admin, group, write = false) =>
  decideAdminAccess(admin, { service: GROUPS[group].service, resource: 'cms', write }).allowed;

/** Live now: switched on, and inside its dates when it has any. */
function stateOf(doc, now) {
  if (doc.isActive === false) return 'paused';
  if (doc.startDate && new Date(doc.startDate) > now) return 'scheduled';
  if (doc.endDate && new Date(doc.endDate) < now) return 'ended';
  return 'live';
}

async function zoneNames(collection, docs) {
  const ids = [...new Set(docs.map((d) => String(d.zoneId || '')).filter(isId))];
  if (!collection || !ids.length) return new Map();
  const rows = await coll(collection)
    .find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ name: 1, zoneName: 1 })
    .toArray();
  return new Map(rows.map((r) => [String(r._id), r.name || r.zoneName || '']));
}

function toItem(group, doc, zones, now) {
  return {
    id: String(doc._id),
    group,
    imageUrl: doc.imageUrl || doc.image || '',
    isVideo: doc.resourceType === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(String(doc.imageUrl || '')),
    title: doc.title || '',
    link: doc.ctaLink || '',
    section: group === 'header' ? doc.module || 'food' : null,
    zone: doc.zoneId ? zones.get(String(doc.zoneId)) || 'One zone' : null,
    startDate: doc.startDate || null,
    endDate: doc.endDate || null,
    order: Number(doc.sortOrder ?? doc.order ?? 0),
    state: stateOf(doc, now),
  };
}

export async function listHomeContent(admin) {
  const now = new Date();
  const groups = [];
  for (const [key, def] of Object.entries(GROUPS)) {
    if (!canSee(admin, key)) continue;
    const docs = await coll(def.collection).find({}).sort({ sortOrder: 1, order: 1, createdAt: -1 }).limit(500).toArray();
    const zones = await zoneNames(def.zones, docs);
    const items = docs.map((d) => toItem(key, d, zones, now));
    const group = {
      key,
      label: def.label,
      where: def.where,
      service: def.service,
      editPath: def.editPath,
      live: items.filter((i) => i.state === 'live').length,
      items,
    };
    if (key === 'header') {
      // Each section heads its own screen, so they are listed apart -- including
      // the sections that have nothing, which show a flat colour in the app.
      group.sections = SECTIONS.map(([id, label]) => ({
        id,
        label,
        items: items.filter((i) => i.section === id),
      }));
    }
    groups.push(group);
  }
  if (!groups.length) throw new ApiError(403, 'You do not have access to banners');
  return { groups };
}

/** Pause or resume one banner, in its own collection. */
export async function setHomeContentLive(admin, group, id, live) {
  const def = GROUPS[group];
  if (!def) throw new ApiError(404, 'Unknown banner group');
  if (!canSee(admin, group, true)) throw new ApiError(403, 'You can view these banners but not change them');
  if (!isId(id)) throw new ApiError(404, 'Banner not found');
  if (typeof live !== 'boolean') throw new ApiError(400, 'Say whether the banner should be live');
  const _id = new mongoose.Types.ObjectId(String(id));
  const res = await coll(def.collection).updateOne({ _id }, { $set: { isActive: live, updatedAt: new Date() } });
  if (!res.matchedCount) throw new ApiError(404, 'Banner not found');
  const doc = await coll(def.collection).findOne({ _id });
  const zones = await zoneNames(def.zones, [doc]);
  return toItem(group, doc, zones, new Date());
}

/** Whether this admin may upload Quick's top banners (Quick's "Banners & pages", write). */
export const canUploadQuickTop = (admin) => canSee(admin, 'quickTop', true);
