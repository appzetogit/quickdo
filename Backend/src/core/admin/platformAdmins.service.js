/**
 * Admin accounts for every panel, in one place.
 *
 * Food, quick commerce and taxi each had an admin screen writing to the same
 * `admins` collection in three different shapes. This service is the one they
 * all use now: one account can be given any mix of panels, with the shared
 * permissions from adminAccessPolicy.js.
 */
import mongoose from 'mongoose';
import { FoodAdmin } from './admin.model.js';
import { ADMIN_LEVELS } from './adminHierarchy.constants.js';
import { getDescendantAdminIds } from './adminHierarchy.service.js';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_SERVICES,
  canAdminDelete,
  effectiveAdminLevel,
  effectiveServices,
  expandPermissions,
  sanitizePermissions,
  sanitizeServices,
} from './adminAccessPolicy.js';
import { invalidateAdminCache } from '../../modules/food/admin/middlewares/foodAdmin.middleware.js';
import { ApiError } from '../../utils/ApiError.js';

const ROLE = { OWNER: 'owner', FULL: 'full', CUSTOM: 'custom' };
const isId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ''));
const idList = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x?._id || x?.id || x || '').trim()).filter(isId))] : []);

/* ---------------------------------------------------------------- the caller */

export function describeCaller(admin) {
  const level = effectiveAdminLevel(admin);
  const owner = level === ADMIN_LEVELS.PLATFORM_SUPERADMIN;
  const superLike = level !== ADMIN_LEVELS.SUBADMIN;
  const permissions = superLike ? ['*'] : expandPermissions(admin.permissions);
  const services = owner ? ADMIN_SERVICES.map((s) => s.key) : effectiveServices(admin);
  const wildcard = permissions.includes('*');
  return {
    id: String(admin._id),
    name: admin.name || '',
    email: admin.email || '',
    adminLevel: level,
    isOwner: owner,
    isSuperAdmin: superLike,
    role: owner ? ROLE.OWNER : (wildcard ? ROLE.FULL : ROLE.CUSTOM),
    permissions,
    servicesAccess: services,
    canManageAdmins: wildcard || permissions.includes('subadmins.write'),
    canViewAdmins: wildcard || permissions.includes('subadmins.read'),
    canDelete: canAdminDelete(admin),
    serviceLocationIds: (admin.service_location_ids || []).map(String),
    foodZoneIds: (admin.food_zone_ids || []).map(String),
    qcZoneIds: (admin.qc_zone_ids || []).map(String),
    taxiZoneIds: (admin.taxi_zone_ids || []).map(String),
  };
}

const assertCanView = (caller) => {
  if (!caller.canViewAdmins) throw new ApiError(403, 'You do not have access to admin accounts');
};
const assertCanManage = (caller) => {
  if (!caller.canManageAdmins) throw new ApiError(403, 'You can view admin accounts but not change them');
};

async function scopeFilter(admin, caller) {
  if (caller.isOwner) return {};
  const ids = await getDescendantAdminIds(admin._id);
  return { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } };
}

async function assertManages(admin, caller, targetId) {
  if (!isId(targetId)) throw new ApiError(404, 'Admin account not found');
  if (String(targetId) === String(admin._id)) {
    throw new ApiError(400, 'You cannot change your own access. Ask another superadmin.');
  }
  if (caller.isOwner) return;
  const ids = await getDescendantAdminIds(admin._id);
  if (!ids.includes(String(targetId))) throw new ApiError(403, 'This admin is not one you created');
}

/* ------------------------------------------------------------- serialising */

function roleOf(doc) {
  const level = effectiveAdminLevel(doc);
  if (level === ADMIN_LEVELS.PLATFORM_SUPERADMIN) return ROLE.OWNER;
  if (level !== ADMIN_LEVELS.SUBADMIN) return ROLE.FULL;
  return expandPermissions(doc.permissions).includes('*') ? ROLE.FULL : ROLE.CUSTOM;
}

function serialize(doc, names = {}) {
  const role = roleOf(doc);
  const active = doc.isActive !== false && doc.active !== false && String(doc.status || 'active') !== 'inactive';
  return {
    id: String(doc._id),
    name: doc.name || '',
    email: doc.email || '',
    phone: doc.phone || '',
    role,
    servicesAccess: role === ROLE.OWNER ? ADMIN_SERVICES.map((s) => s.key) : effectiveServices(doc),
    permissions: role === ROLE.CUSTOM ? sanitizePermissions(doc.permissions) : ['*'],
    serviceLocationIds: (doc.service_location_ids || []).map(String),
    foodZoneIds: (doc.food_zone_ids || []).map(String),
    qcZoneIds: (doc.qc_zone_ids || []).map(String),
    taxiZoneIds: (doc.taxi_zone_ids || []).map(String),
    canDelete: role === ROLE.OWNER ? true : doc.canDelete !== false,
    isActive: active,
    createdBy: doc.parentAdminId ? (names[String(doc.parentAdminId)] || 'Another admin') : null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

/* ------------------------------------------------------------------- reads */

export async function getMeta(admin) {
  const caller = describeCaller(admin);
  const services = ADMIN_SERVICES.filter((s) => caller.servicesAccess.includes(s.key));
  const grantable = (key) => caller.permissions.includes('*') || caller.permissions.includes(`${key}.read`);
  const catalog = ADMIN_PERMISSION_CATALOG.map((g) => ({
    group: g.group,
    resources: g.resources
      .filter((r) => grantable(r.key))
      .map((r) => ({
        ...r,
        services: r.services.filter((s) => caller.servicesAccess.includes(s)),
        canGrantWrite: caller.permissions.includes('*') || caller.permissions.includes(`${r.key}.write`),
      }))
      .filter((r) => r.services.length),
  })).filter((g) => g.resources.length);

  let serviceLocations = [];
  if (caller.servicesAccess.includes('taxi')) {
    try {
      const { ServiceLocation } = await import('../../modules/taxi/admin/models/ServiceLocation.js');
      const filter = caller.isSuperAdmin ? {} : { _id: { $in: caller.serviceLocationIds.filter(isId) } };
      const rows = await ServiceLocation.find(filter).select('name service_location_name').sort({ name: 1 }).lean();
      serviceLocations = rows.map((r) => ({ id: String(r._id), name: r.name || r.service_location_name || 'Unnamed' }));
    } catch {
      serviceLocations = [];
    }
  }

  // Zones for food and for quick commerce / medical, limited to the caller's own.
  const zonesOf = async (load, own) => {
    try {
      const Model = await load();
      const filter = caller.isSuperAdmin || !own.length ? {} : { _id: { $in: own.filter(isId) } };
      const rows = await Model.find(filter).select('name zoneName isActive').sort({ name: 1 }).lean();
      return rows.map((r) => ({ id: String(r._id), name: r.name || r.zoneName || 'Unnamed', isActive: r.isActive !== false }));
    } catch {
      return [];
    }
  };
  const foodZones = caller.servicesAccess.includes('food')
    ? await zonesOf(async () => (await import('../../modules/food/admin/models/zone.model.js')).FoodZone, caller.foodZoneIds)
    : [];
  // Quick and Medical draw separate zones; one list covers both, labelled.
  const qcZones = caller.servicesAccess.some((s) => s === 'quickCommerce' || s === 'medical')
    ? [
      ...(await zonesOf(async () => (await import('../../modules/quickCommerce/modules/food/admin/models/zone.model.js')).QCZone, caller.qcZoneIds))
        .map((z) => ({ ...z, name: `${z.name} · Quick` })),
      ...(await zonesOf(async () => {
        const { zoneModelFor } = await import('../../modules/quickCommerce/modules/food/shared/zoneServiceability.js');
        return zoneModelFor('medical');
      }, caller.qcZoneIds)).map((z) => ({ ...z, name: `${z.name} · Medical` })),
    ]
    : [];
  const taxiZones = caller.servicesAccess.includes('taxi')
    ? await zonesOf(async () => (await import('../../modules/taxi/driver/models/Zone.js')).Zone, caller.taxiZoneIds || [])
    : [];

  return {
    me: caller,
    services,
    catalog,
    serviceLocations,
    foodZones,
    qcZones,
    taxiZones,
    roles: [
      ...(caller.isOwner ? [{ key: ROLE.OWNER, label: 'Owner', hint: 'Everything, in every panel, including platform settings' }] : []),
      ...(caller.permissions.includes('*') ? [{ key: ROLE.FULL, label: 'Full access', hint: 'Everything inside the panels you pick' }] : []),
      { key: ROLE.CUSTOM, label: 'Custom', hint: 'Only the sections you tick' },
    ],
  };
}

export async function listAdmins(admin, query = {}) {
  const caller = describeCaller(admin);
  assertCanView(caller);

  const scope = await scopeFilter(admin, caller);
  const filter = { ...scope, _id: { ...(scope._id || {}), $ne: admin._id } };
  const q = String(query.q || '').trim();
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }

  const docs = await FoodAdmin.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  const parentIds = [...new Set(docs.map((d) => d.parentAdminId).filter(Boolean).map(String))];
  const parents = parentIds.length
    ? await FoodAdmin.find({ _id: { $in: parentIds } }).select('name email').lean()
    : [];
  const names = Object.fromEntries(parents.map((p) => [String(p._id), p.name || p.email]));

  let rows = docs.map((d) => serialize(d, names));
  const service = String(query.service || '').trim();
  if (service) rows = rows.filter((r) => r.servicesAccess.includes(service));
  const status = String(query.status || '').trim();
  if (status === 'active') rows = rows.filter((r) => r.isActive);
  if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
  const role = String(query.role || '').trim();
  if (role) rows = rows.filter((r) => r.role === role);

  return {
    results: rows,
    summary: {
      total: docs.length,
      active: docs.filter((d) => serialize(d).isActive).length,
      owners: docs.filter((d) => roleOf(d) === ROLE.OWNER).length,
      custom: docs.filter((d) => roleOf(d) === ROLE.CUSTOM).length,
    },
  };
}

export async function getAdmin(admin, id) {
  const caller = describeCaller(admin);
  assertCanView(caller);
  await assertManages(admin, caller, id);
  const doc = await FoodAdmin.findById(id).lean();
  if (!doc) throw new ApiError(404, 'Admin account not found');
  return serialize(doc);
}

/* ------------------------------------------------------------------ writes */

/**
 * Everything the form sends, checked against what the caller holds: nobody can
 * hand out a panel or a permission they do not have themselves.
 */
async function validatePayload(admin, caller, body, { creating }) {
  const role = [ROLE.OWNER, ROLE.FULL, ROLE.CUSTOM].includes(body.role) ? body.role : ROLE.CUSTOM;
  if (role === ROLE.OWNER && !caller.isOwner) throw new ApiError(403, 'Only an owner can create another owner');
  if (role === ROLE.FULL && !caller.permissions.includes('*')) {
    throw new ApiError(403, 'You cannot give full access; pick the sections instead');
  }

  const out = { role };
  if (body.name !== undefined || creating) {
    out.name = String(body.name || '').trim();
    if (!out.name) throw new ApiError(400, 'Enter a name');
  }
  if (body.email !== undefined || creating) {
    out.email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new ApiError(400, 'Enter a valid email address');
  }
  if (body.phone !== undefined) out.phone = String(body.phone || '').trim();

  if (body.password || creating) {
    const password = String(body.password || '');
    if (password.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
    if (body.password_confirmation !== undefined && body.password_confirmation !== password) {
      throw new ApiError(400, 'Passwords do not match');
    }
    out.password = password;
  }

  if (role === ROLE.OWNER) return out;

  // Off unless ticked when creating; left as it was when an edit omits it. An
  // admin without delete access cannot hand it out.
  if (body.canDelete !== undefined || creating) {
    out.canDelete = body.canDelete === true;
    if (out.canDelete && !caller.canDelete) {
      throw new ApiError(403, 'You cannot give delete access you do not have yourself');
    }
  }

  const services = sanitizeServices(body.servicesAccess);
  if (!services.length) throw new ApiError(400, 'Pick at least one panel');
  const outside = services.filter((s) => !caller.servicesAccess.includes(s));
  if (outside.length) throw new ApiError(403, `You do not have access to: ${outside.join(', ')}`);
  out.servicesAccess = services;

  if (role === ROLE.CUSTOM) {
    const permissions = sanitizePermissions(body.permissions);
    if (!permissions.length) throw new ApiError(400, 'Tick at least one section');
    if (!caller.permissions.includes('*')) {
      const beyond = permissions.filter((p) => !caller.permissions.includes(p));
      if (beyond.length) throw new ApiError(403, 'You cannot give permissions you do not have yourself');
    }
    out.permissions = permissions;
  } else {
    out.permissions = ['*'];
  }

  // Taxi scopes every list by service location and shows nothing without one.
  if (services.includes('taxi')) {
    const locations = idList(body.serviceLocationIds);
    if (!locations.length) throw new ApiError(400, 'Pick at least one taxi service location');
    if (!caller.isSuperAdmin) {
      const own = new Set(caller.serviceLocationIds);
      if (locations.some((l) => !own.has(l))) throw new ApiError(403, 'You cannot give service locations you do not have');
    }
    out.serviceLocationIds = locations;
  } else {
    out.serviceLocationIds = [];
  }

  // Food and quick commerce zones: empty means every zone. A limited caller can
  // only hand out zones they have, and cannot give "every zone".
  const zonesFor = (ids, own, enabled, label) => {
    if (!enabled) return [];
    const list = idList(ids);
    if (!caller.isSuperAdmin && own.length) {
      if (!list.length) throw new ApiError(403, `Pick the ${label} zones this admin may see`);
      const mine = new Set(own);
      if (list.some((z) => !mine.has(z))) throw new ApiError(403, `You cannot give ${label} zones you do not have`);
    }
    return list;
  };
  out.foodZoneIds = zonesFor(body.foodZoneIds, caller.foodZoneIds, services.includes('food'), 'food');
  out.qcZoneIds = zonesFor(body.qcZoneIds, caller.qcZoneIds, services.includes('quickCommerce') || services.includes('medical'), 'quick commerce');
  out.taxiZoneIds = zonesFor(body.taxiZoneIds, caller.taxiZoneIds || [], services.includes('taxi'), 'taxi');
  return out;
}

function applyTo(doc, data, admin) {
  if (data.name !== undefined) doc.name = data.name;
  if (data.email !== undefined) doc.email = data.email;
  if (data.phone !== undefined) doc.phone = data.phone;
  if (data.password) doc.password = data.password;
  // role 'ADMIN' is what every admin mount's requireRoles checks; taxi-made
  // accounts carried 'subadmin' / 'superadmin' and could not open the other panels.
  doc.role = 'ADMIN';
  if (data.role === ROLE.OWNER) {
    doc.adminLevel = ADMIN_LEVELS.PLATFORM_SUPERADMIN;
    doc.admin_type = 'superadmin';
    doc.module = null;
    doc.permissions = ['*'];
    doc.servicesAccess = ['food', 'quickCommerce', 'medical', 'taxi', 'serviceProvider'];
    doc.canDelete = true;
  } else {
    if (data.canDelete !== undefined) doc.canDelete = data.canDelete;
    doc.adminLevel = ADMIN_LEVELS.SUBADMIN;
    doc.admin_type = 'subadmin';
    doc.module = null;
    doc.permissions = data.permissions;
    doc.servicesAccess = data.servicesAccess;
    doc.service_location_ids = data.serviceLocationIds;
    doc.food_zone_ids = data.foodZoneIds || [];
    doc.qc_zone_ids = data.qcZoneIds || [];
    doc.taxi_zone_ids = data.taxiZoneIds || [];
    // A sub-admin without a parent reads as a legacy owner (resolveAdminLevel),
    // so every restricted account records who manages it.
    if (!doc.parentAdminId) doc.parentAdminId = admin._id;
  }
}

/** Taxi reads its own `active` / `status` fields, which this model does not declare. */
async function syncTaxiStatus(id, isActive) {
  await FoodAdmin.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(id)) },
    { $set: { active: isActive, status: isActive ? 'active' : 'inactive' } },
  );
}

export async function createAdmin(admin, body = {}) {
  const caller = describeCaller(admin);
  assertCanManage(caller);
  const data = await validatePayload(admin, caller, body, { creating: true });
  if (await FoodAdmin.exists({ email: data.email })) throw new ApiError(409, 'An admin with this email already exists');

  const doc = new FoodAdmin({ parentAdminId: admin._id, isActive: body.isActive !== false });
  applyTo(doc, data, admin);
  await doc.save();
  await syncTaxiStatus(doc._id, doc.isActive !== false);
  return serialize(doc.toObject());
}

export async function updateAdmin(admin, id, body = {}) {
  const caller = describeCaller(admin);
  assertCanManage(caller);
  await assertManages(admin, caller, id);
  const doc = await FoodAdmin.findById(id);
  if (!doc) throw new ApiError(404, 'Admin account not found');
  if (roleOf(doc) === ROLE.OWNER && !caller.isOwner) throw new ApiError(403, 'Only an owner can change an owner');

  const data = await validatePayload(admin, caller, body, { creating: false });
  if (data.email && data.email !== doc.email && (await FoodAdmin.exists({ email: data.email, _id: { $ne: doc._id } }))) {
    throw new ApiError(409, 'An admin with this email already exists');
  }
  applyTo(doc, data, admin);
  if (body.isActive !== undefined) doc.isActive = body.isActive !== false;
  await doc.save();
  await syncTaxiStatus(doc._id, doc.isActive !== false);
  invalidateAdminCache(id);
  return serialize(doc.toObject());
}

export async function setAdminStatus(admin, id, isActive) {
  const caller = describeCaller(admin);
  assertCanManage(caller);
  await assertManages(admin, caller, id);
  const doc = await FoodAdmin.findById(id);
  if (!doc) throw new ApiError(404, 'Admin account not found');
  if (roleOf(doc) === ROLE.OWNER && !caller.isOwner) throw new ApiError(403, 'Only an owner can change an owner');
  doc.isActive = isActive !== false;
  await doc.save();
  await syncTaxiStatus(doc._id, doc.isActive);
  invalidateAdminCache(id);
  return serialize(doc.toObject());
}

export async function deleteAdmin(admin, id) {
  const caller = describeCaller(admin);
  assertCanManage(caller);
  if (!caller.canDelete) throw new ApiError(403, 'You do not have delete access. Ask an owner to turn it on for your account');
  await assertManages(admin, caller, id);
  const doc = await FoodAdmin.findById(id).lean();
  if (!doc) throw new ApiError(404, 'Admin account not found');
  if (roleOf(doc) === ROLE.OWNER) {
    if (!caller.isOwner) throw new ApiError(403, 'Only an owner can remove an owner');
    const owners = (await FoodAdmin.find({}).select('role adminLevel admin_type parentAdminId servicesAccess').lean())
      .filter((d) => roleOf(d) === ROLE.OWNER);
    if (owners.length <= 1) throw new ApiError(400, 'This is the last owner account and cannot be removed');
  }
  // The people this admin created stay, managed by whoever removed them.
  await FoodAdmin.updateMany({ parentAdminId: doc._id }, { $set: { parentAdminId: admin._id } });
  await FoodAdmin.deleteOne({ _id: doc._id });
  invalidateAdminCache(id);
  return { deleted: true };
}
